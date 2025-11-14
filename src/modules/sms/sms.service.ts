import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { TwilioService } from './twilio/twilio.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilioService: TwilioService,
  ) {}

  // Legacy methods (keeping for backward compatibility)
  async sendSms(smsData: any) {
    // TODO: Implement SMS sending logic
    return {
      message: 'SMS sent successfully',
      smsId: 'sms_' + Date.now(),
    };
  }

  async scheduleSms(scheduleData: any) {
    // TODO: Implement SMS scheduling
    return {
      scheduleId: 'schedule_' + Date.now(),
      ...scheduleData,
    };
  }

  async getSmsStatus(id: string) {
    // TODO: Implement SMS status retrieval
    return {
      id,
      status: 'delivered',
    };
  }

  /**
   * Get SMS status flags for multiple contacts
   * Returns latest draft id and delivery status (if available)
   */
  async getBulkStatus(contactIds: number[]): Promise<{
    success: boolean;
    data: Array<{
      contactId: number;
      hasSmsDraft: boolean;
      smsDraftId: number | null;
      smsStatus: string | null;
    }>;
  }> {
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return { success: true, data: [] };
    }

    const scrapingClient = await this.prisma;

    const smsDrafts = await scrapingClient.smsDraft.findMany({
      where: { contactId: { in: contactIds } },
      select: { id: true, contactId: true, status: true },
      orderBy: { createdAt: 'desc' },
    });

    const smsDraftIds = smsDrafts.map((draft) => draft.id);
    const smsLogs =
      smsDraftIds.length > 0
        ? await scrapingClient.smsLog.findMany({
            where: { smsDraftId: { in: smsDraftIds } },
            select: { smsDraftId: true, status: true },
            orderBy: { sentAt: 'desc' },
          })
        : [];

    const smsDraftMap = new Map<number, number>();
    const smsDraftStatusMap = new Map<number, string>();
    smsDrafts.forEach((draft) => {
      if (!smsDraftMap.has(draft.contactId)) {
        smsDraftMap.set(draft.contactId, draft.id);
        smsDraftStatusMap.set(draft.contactId, draft.status);
      }
    });

    const smsSentMap = new Map<number, boolean>();
    smsLogs.forEach((log) => {
      if (!smsSentMap.has(log.smsDraftId)) {
        const isSent = log.status === 'success' || log.status === 'delivered';
        smsSentMap.set(log.smsDraftId, isSent);
      }
    });

    const data = contactIds.map((contactId) => {
      const smsDraftId = smsDraftMap.get(contactId) || null;
      const smsWasSent = smsDraftId ? smsSentMap.get(smsDraftId) || false : false;
      const smsDraftStatus = smsDraftStatusMap.get(contactId);

      let smsStatus: string | null = null;
      if (smsWasSent) {
        smsStatus = 'sent';
      } else if (smsDraftStatus) {
        smsStatus = smsDraftStatus;
      }

      return {
        contactId,
        hasSmsDraft: smsDraftMap.has(contactId),
        smsDraftId,
        smsStatus,
      };
    });

    return {
      success: true,
      data,
    };
  }

  /**
   * Send an existing SMS draft via Twilio and create a log
   * Updated to use clientSms relation and rate limiting
   */
  async sendDraft(draftId: number): Promise<any> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();

      // Load draft with clientSms relation (like Email loads clientEmail)
      const draft = await scrapingClient.smsDraft.findUnique({
        where: { id: draftId },
        include: {
          contact: {
            select: {
              id: true,
              phone: true,
            },
          },
          clientSms: true, // Load relation like Email loads clientEmail
        },
      });

      if (!draft) {
        throw new NotFoundException(`SMS draft with ID ${draftId} not found`);
      }

      if (draft.status !== 'draft' && draft.status !== 'ready') {
        throw new BadRequestException('SMS draft is not in a sendable state');
      }

      // Get clientSms - use from relation or auto-select as fallback
      let clientSms = draft.clientSms;

      // Auto-select if draft has no clientSmsId (backward compatibility)
      if (!clientSms) {
        const contact = await scrapingClient.contact.findUnique({
          where: { id: draft.contactId },
          include: {
            csvUpload: {
              select: {
                clientId: true,
              },
            },
          },
        });

        if (!contact || !contact.csvUpload) {
          throw new BadRequestException('Contact does not have an associated client');
        }

        const autoSelectedClientSms = await this.selectAvailableClientSms(contact.csvUpload.clientId);
        if (!autoSelectedClientSms) {
          throw new BadRequestException('No available ClientSms found for sending');
        }

        clientSms = autoSelectedClientSms;
        this.logger.log(`📱 Auto-selected ClientSms ${clientSms!.id} (${clientSms!.phoneNumber}) for draft ${draftId}`);
      }

      // Ensure clientSms is not null (TypeScript guard)
      if (!clientSms) {
        throw new BadRequestException('ClientSms is required for sending SMS');
      }

      // Validate clientSms status
      if (clientSms.status !== 'active') {
        throw new BadRequestException(`ClientSms with ID ${clientSms.id} is not active`);
      }

      // Check and reset daily counter if needed
      if (this.shouldResetCounter(clientSms.timestamp)) {
        await scrapingClient.clientSms.update({
          where: { id: clientSms.id },
          data: {
            currentCounter: 0,
            timestamp: new Date(),
          },
        });
        clientSms.currentCounter = 0;
        this.logger.log(`🔄 Reset daily counter for ClientSms ${clientSms.id}`);
      }

      // Check rate limits
      if (clientSms.limit !== null && clientSms.currentCounter >= clientSms.limit) {
        throw new BadRequestException('Rate limit exceeded for this SMS number');
      }

      const chosenTo = process.env.SMS_TEST_TO || draft.contact?.phone;
      if (!chosenTo) {
        throw new BadRequestException('Recipient phone number is missing');
      }

      const statusCallback = process.env.SMS_STATUS_CALLBACK_URL; // optional

      if (statusCallback) {
        this.logger.log(`📞 Sending SMS with status callback URL: ${statusCallback}`);
      } else {
        this.logger.warn('⚠️ SMS_STATUS_CALLBACK_URL not set - delivery status updates will not be received!');
      }

      const twilioResp = await this.twilioService.sendSms({
        to: chosenTo,
        body: draft.messageText,
        statusCallback,
      });

      this.logger.log(`✅ SMS sent successfully. MessageSid: ${twilioResp.sid}, Status: ${twilioResp.status}`);
      this.logger.log(`💾 Storing MessageSid in database: ${twilioResp.sid}`);

      // Create SMS log with clientSmsId
      const log = await scrapingClient.smsLog.create({
        data: {
          smsDraftId: draft.id,
          contactId: draft.contactId,
          clientSmsId: clientSms.id,
          status: twilioResp.errorCode ? 'failed' : 'success',
          providerResponse: twilioResp as any,
          sentAt: new Date(),
        },
      });

      // Verify the MessageSid was stored correctly
      const storedResponse = log.providerResponse as any;
      this.logger.log(`✅ SMS Log created with ID: ${log.id}, Stored MessageSid: ${storedResponse?.sid}`);

      // Update draft status
      await scrapingClient.smsDraft.update({
        where: { id: draft.id },
        data: { status: 'sent' },
      });

      // Increment counters for ClientSms
      await scrapingClient.clientSms.update({
        where: { id: clientSms.id },
        data: {
          currentCounter: { increment: 1 },
          totalCounter: { increment: 1 },
          timestamp: new Date(),
        },
      });

      this.logger.log(`✅ SMS sent successfully (Draft ID: ${draftId}, Log ID: ${log.id}, ClientSms ID: ${clientSms.id})`);

      return {
        success: true,
        smsLogId: log.id,
        messageSid: twilioResp.sid,
        message: 'SMS sent successfully',
      };
    } catch (error) {
      this.logger.error(`❌ Failed to send SMS draft ${draftId}:`, error);
      throw error;
    }
  }

  /**
   * Select an available ClientSms for a given client
   * Prioritizes least-used and respects limits
   */
  private async selectAvailableClientSms(clientId: number): Promise<any | null> {
    const scrapingClient = await this.prisma.getScrapingClient();

    const clientSmsList = await scrapingClient.clientSms.findMany({
      where: {
        clientId,
        status: 'active',
      },
      orderBy: [
        { currentCounter: 'asc' }, // Prioritize least-used
        { totalCounter: 'asc' },
      ],
    });

    // Find first available (not at limit)
    for (const clientSms of clientSmsList) {
      // Reset counter if needed
      if (this.shouldResetCounter(clientSms.timestamp)) {
        await scrapingClient.clientSms.update({
          where: { id: clientSms.id },
          data: {
            currentCounter: 0,
            timestamp: new Date(),
          },
        });
        clientSms.currentCounter = 0;
      }

      // Check if within limit (null limit means no limit)
      if (clientSms.limit === null || clientSms.currentCounter < clientSms.limit) {
        return clientSms;
      }
    }

    return null;
  }

  /**
   * Check if counter should be reset (24-hour interval)
   */
  private shouldResetCounter(timestamp: Date | null): boolean {
    if (!timestamp) {
      return true; // Reset if no timestamp
    }

    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    return diffHours >= 24; // Reset if 24 hours or more have passed
  }

  /**
   * Update SMS log status based on Twilio webhook callback
   * Maps Twilio statuses to SmsLogStatus enum and updates the database
   */
  async updateSmsStatus(
    messageSid: string,
    messageStatus: string,
    errorCode?: string,
    errorMessage?: string,
  ) {
    const db = this.prisma;

    try {
      this.logger.log(`🔍 Looking for SMS log with MessageSid: ${messageSid}`);
      
      // Find the SmsLog by MessageSid stored in providerResponse
      // Note: Prisma doesn't support direct JSON field filtering in WHERE clause,
      // so we query recent logs and filter in memory
      // First try: Only query logs that haven't been delivered yet (status: success or failed)
      let recentLogs = await db.smsLog.findMany({
        where: {
          status: {
            in: ['success', 'failed'], // Only update logs that are still in initial state
          },
        },
        select: {
          id: true,
          providerResponse: true,
          status: true,
        },
        orderBy: {
          sentAt: 'desc',
        },
        take: 1000, // Limit to recent 1000 logs for performance
      });

      // If not found, search ALL recent logs (including delivered/undelivered) - for debugging
      if (recentLogs.length === 0 || !recentLogs.find(log => {
        const response = log.providerResponse as any;
        return response?.sid === messageSid;
      })) {
        this.logger.log(`🔍 Not found in pending logs, searching all recent logs...`);
        recentLogs = await db.smsLog.findMany({
          select: {
            id: true,
            providerResponse: true,
            status: true,
          },
          orderBy: {
            sentAt: 'desc',
          },
          take: 100, // Check last 100 logs regardless of status
        });
      }

      this.logger.log(`📋 Found ${recentLogs.length} recent logs to check`);

      // Find the log with matching MessageSid
      const matchingLog = recentLogs.find((log) => {
        const response = log.providerResponse as any;
        const storedSid = response?.sid;
        
        // Log for debugging
        if (storedSid && storedSid === messageSid) {
          this.logger.log(`✅ Found matching log! Log ID: ${log.id}, Current status: ${log.status}`);
        }
        
        return storedSid === messageSid;
      });

      if (!matchingLog) {
        // Log all recent log SIDs for debugging
        const recentSids = recentLogs.map(log => {
          const response = log.providerResponse as any;
          return response?.sid || 'NO_SID';
        });
        this.logger.warn(`❌ No SmsLog found with MessageSid: ${messageSid}`);
        this.logger.warn(`📋 Recent log SIDs: ${recentSids.slice(0, 10).join(', ')}`);
        this.logger.warn(`🔍 Checked ${recentLogs.length} recent logs`);
        return;
      }

      // Map Twilio status to SmsLogStatus enum
      let newStatus: 'success' | 'failed' | 'delivered' | 'undelivered';
      
      switch (messageStatus.toLowerCase()) {
        case 'delivered':
          newStatus = 'delivered';
          break;
        case 'failed':
          // Message failed to send (Twilio error)
          newStatus = 'failed';
          break;
        case 'undelivered':
          // Message sent but not delivered to recipient
          newStatus = 'undelivered';
          break;
        case 'sent':
        case 'queued':
        case 'sending':
          // Keep as 'success' for intermediate states
          newStatus = 'success';
          break;
        default:
          this.logger.warn(`Unknown Twilio status: ${messageStatus}, keeping current status`);
          return;
      }

      // Update providerResponse with latest status info
      const currentResponse = (matchingLog.providerResponse as any) || {};
      const updatedResponse = {
        ...currentResponse,
        status: messageStatus,
        ...(errorCode && { errorCode }),
        ...(errorMessage && { errorMessage }),
      };

      // Update the log
      const updated = await db.smsLog.update({
        where: { id: matchingLog.id },
        data: {
          status: newStatus,
          providerResponse: updatedResponse,
        },
      });

      this.logger.log(
        `✅ Updated SMS log ${matchingLog.id} status: ${matchingLog.status} → ${newStatus} (MessageSid: ${messageSid})`,
      );
      this.logger.log(`✅ Database update confirmed. New status: ${updated.status}`);
    } catch (error) {
      this.logger.error(`Failed to update SMS status for MessageSid ${messageSid}:`, error);
      throw error;
    }
  }

  /**
   * Get SMS logs (history) for a specific clientSmsId
   * Returns all SMS sent from this SMS number with full details
   */
  async getSmsLogsByClientSmsId(clientSmsId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Verify clientSms exists
    const clientSms = await scrapingClient.clientSms.findUnique({
      where: { id: clientSmsId },
      select: { id: true, phoneNumber: true, status: true },
    });

    if (!clientSms) {
      throw new NotFoundException(`ClientSms with ID ${clientSmsId} not found`);
    }

    // Get all SMS logs for this clientSmsId
    const logs = await scrapingClient.smsLog.findMany({
      where: { clientSmsId },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            phone: true,
            email: true,
          },
        },
        smsDraft: {
          select: {
            id: true,
            messageText: true,
            status: true,
            createdAt: true,
          },
        },
        clientSms: {
          select: {
            id: true,
            phoneNumber: true,
            status: true,
            currentCounter: true,
            totalCounter: true,
            limit: true,
          },
        },
      },
      orderBy: { sentAt: 'desc' }, // Newest first
    });

    this.logger.log(`✅ Retrieved ${logs.length} SMS logs for ClientSms ${clientSmsId}`);

    return logs;
  }
}
