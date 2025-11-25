import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { TwilioService } from './twilio/twilio.service';
import { OtpService } from '../../common/services/otp.service';
import { parsePhoneNumberFromString, CountryCode } from 'libphonenumber-js';

// Temporary types until Prisma client is regenerated
type SenderVerificationStatus = 'pending' | 'verified' | 'expired' | 'rejected';
type SenderType = 'email' | 'sms';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly otpResendIntervalMs = Number(process.env.SENDER_VERIFICATION_RESEND_SECONDS || '60') * 1000;
  private readonly maxOtpAttempts = Number(process.env.SENDER_VERIFICATION_MAX_ATTEMPTS || '5');

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilioService: TwilioService,
    private readonly otpService: OtpService,
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
      const verificationStatus = (clientSms as any).verificationStatus;
      if (verificationStatus !== 'verified') {
        throw new BadRequestException('SMS number must be verified before sending.');
      }

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
        ...({ verificationStatus: 'verified' } as any),
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

  /**
   * Get all client SMS numbers for a specific client
   */
  /**
   * Get all client SMS numbers for a specific client
   * Includes both verified ClientSms records and pending verifications
   */
  async getClientSms(clientId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Get verified ClientSms records
    const verifiedSms = await scrapingClient.clientSms.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phoneNumber: true,
        status: true,
        ...({
          verificationStatus: true,
          verificationMethod: true,
          verifiedAt: true,
          lastOtpSentAt: true,
        } as any),
        currentCounter: true,
        totalCounter: true,
        limit: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Get pending verifications (no ClientSms record yet)
    // Note: This requires the migration that adds emailAddress/phoneNumber to SenderVerification
    let pendingVerifications: any[] = [];
    try {
      // Check if SenderVerification model exists and has phoneNumber column
      const testQuery = await scrapingClient.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'SenderVerification' 
            AND column_name = 'phoneNumber'
        ) as exists
      `;
      
      if (testQuery[0]?.exists) {
        // Column exists, use Prisma query
        pendingVerifications = await (scrapingClient as any).senderVerification.findMany({
          where: {
            clientId,
            senderType: 'sms',
            status: 'pending',
            clientSmsId: null,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            phoneNumber: true,
            lastOtpSentAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      } else {
        // Migration not applied - column doesn't exist
        this.logger.warn('SenderVerification.phoneNumber column not found. Migration 20251125211530_add_temporary_verification_storage needs to be applied.');
        pendingVerifications = [];
      }
    } catch (error: any) {
      // If query fails for other reasons, log and return empty array
      this.logger.warn('Error checking for phoneNumber column (returning empty pending verifications):', error?.message || error);
      pendingVerifications = [];
    }

    // Transform pending verifications to match ClientSms structure
    const pendingSms = pendingVerifications.map((v: any) => ({
      id: null, // No ClientSms record yet
      phoneNumber: v.phoneNumber,
      status: 'inactive',
      verificationStatus: 'pending',
      verificationMethod: 'otp',
      verifiedAt: null,
      lastOtpSentAt: v.lastOtpSentAt,
      currentCounter: 0,
      totalCounter: 0,
      limit: null,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      verificationId: v.id, // Store verification ID for frontend
    }));

    // Combine and sort by creation date (newest first)
    const allSms = [...verifiedSms, ...pendingSms].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return allSms;
  }

  /**
   * Create a new client SMS number
   */
  async createClientSms(
    clientId: number,
    createDto: { phoneNumber: string; providerSettings?: string; countryCode?: string },
  ): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();

    try {
      const normalized = this.normalizePhoneNumber(createDto.phoneNumber, createDto.countryCode);

      // Check if phone number already exists for this client (verified)
      const existing = await scrapingClient.clientSms.findFirst({
        where: {
          clientId,
          phoneNumber: normalized.e164,
        },
      });

      if (existing) {
        throw new BadRequestException('Phone number already exists for this client');
      }

      // Check if there's already a pending verification for this phone number
      const existingVerification = await (scrapingClient as any).senderVerification.findFirst({
        where: {
          clientId,
          phoneNumber: normalized.e164,
          status: 'pending',
          senderType: 'sms',
        },
      });

      if (existingVerification) {
        // Resend OTP for existing pending verification
        await this.sendSmsVerificationOtpForPending(clientId, existingVerification.id, true);
        
        return {
          id: null, // No ClientSms record yet
          phoneNumber: normalized.e164,
          status: 'inactive',
          verificationStatus: 'pending',
          verificationMethod: 'otp',
          verifiedAt: null,
          lastOtpSentAt: existingVerification.lastOtpSentAt,
          currentCounter: 0,
          totalCounter: 0,
          limit: null,
          createdAt: existingVerification.createdAt,
          updatedAt: existingVerification.updatedAt,
          verificationId: existingVerification.id, // Store verification ID for frontend
        };
      }

      // Create temporary verification record and send OTP (NO ClientSms record yet)
      const code = this.otpService.generateCode();
      const hash = this.otpService.hashCode(code);
      const expiresAt = this.otpService.getExpiry();
      const now = new Date();

      const verification = await (scrapingClient as any).senderVerification.create({
        data: {
          senderType: 'sms',
          clientId,
          phoneNumber: normalized.e164,
          otpHash: hash,
          otpExpiresAt: expiresAt,
          attemptCount: 0,
          status: 'pending',
          verificationMethod: 'otp',
          lastOtpSentAt: now,
        },
      });

      // Send OTP via SMS
      try {
        await this.twilioService.sendSms({
          to: normalized.e164,
          body: `Your verification code is ${code}. It expires in 10 minutes.`,
        });

        this.otpService.logSend('sms', this.otpService.maskTarget(normalized.e164), expiresAt);
      } catch (error: any) {
        this.logger.error(`Failed to send OTP via Twilio: ${error.message || error}`);
        
        // Clean up the verification record if SMS sending failed
        try {
          await (scrapingClient as any).senderVerification.deleteMany({
            where: { id: verification.id },
          });
        } catch (cleanupError) {
          this.logger.warn(`Failed to cleanup verification record: ${cleanupError}`);
        }

        // Provide user-friendly error messages
        if (error.message?.includes('credentials') || error.message?.includes('authentication')) {
          throw new BadRequestException('SMS service is not properly configured. Please contact support.');
        }
        if (error.message?.includes('Invalid') || error.message?.includes('phone number')) {
          throw new BadRequestException(`Invalid phone number format: ${normalized.e164}. Please check the number and try again.`);
        }
        if (error.message?.includes('from') || error.message?.includes('sender')) {
          throw new BadRequestException('SMS sender number is not configured. Please contact support.');
        }
        
        throw new BadRequestException(`Failed to send verification code: ${error.message || 'Unknown error'}. Please try again.`);
      }

      // Return temporary structure (no ClientSms record yet)
      return {
        id: null, // No ClientSms record yet
        phoneNumber: normalized.e164,
        status: 'inactive',
        verificationStatus: 'pending',
        verificationMethod: 'otp',
        verifiedAt: null,
        lastOtpSentAt: now,
        currentCounter: 0,
        totalCounter: 0,
        limit: null,
        createdAt: now,
        updatedAt: now,
        verificationId: verification.id, // Store verification ID for frontend
      };
    } catch (error: any) {
      // Re-throw BadRequestException to preserve the original error message
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // Check if it's a Prisma unique constraint error
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2002') {
          // Unique constraint violation
          const meta = (error as any).meta;
          if (meta?.target?.includes('phoneNumber')) {
            throw new BadRequestException('Phone number already exists for this client');
          }
        }
      }
      
      // Check if it's a phone number validation error
      if (error?.message?.includes('phone number') || error?.message?.includes('Phone number')) {
        throw new BadRequestException(error.message);
      }
      
      // Check if it's a Twilio/SMS configuration error
      if (error?.message?.includes('Twilio') || error?.message?.includes('SMS service') || error?.message?.includes('sender')) {
        throw new BadRequestException(error.message);
      }
      
      this.logger.error(`Failed to create client SMS: ${error?.message || error}`);
      throw new BadRequestException(error?.message || 'Failed to create phone number. Please try again.');
    }
  }

  /**
   * Delete a client SMS number
   */
  async deleteClientSms(clientId: number, id: number): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Verify the SMS number belongs to the client
    const clientSms = await scrapingClient.clientSms.findUnique({
      where: { id },
    });

    if (!clientSms) {
      throw new NotFoundException(`Client SMS with ID ${id} not found`);
    }

    if (clientSms.clientId !== clientId) {
      throw new BadRequestException('You do not have permission to delete this SMS number');
    }

    // Check if there are any drafts using this SMS number
    const draftCount = await scrapingClient.smsDraft.count({
      where: { clientSmsId: id },
    });

    if (draftCount > 0) {
      throw new BadRequestException(`Cannot delete SMS number: ${draftCount} draft(s) are using this phone number`);
    }

    await scrapingClient.clientSms.delete({
      where: { id },
    });

    this.logger.log(`✅ Deleted client SMS ${id} for client ${clientId}`);
  }

  async requestSmsOtp(clientId: number, identifier: number | { verificationId: number }) {
    // Support both old flow (clientSmsId) and new flow (verificationId)
    if (typeof identifier === 'object' && identifier.verificationId) {
      return this.sendSmsVerificationOtpForPending(clientId, identifier.verificationId);
    }
    // Old flow: clientSmsId (backward compatibility)
    return this.sendSmsVerificationOtp(clientId, identifier as number);
  }

  async verifySmsOtp(clientId: number, identifier: number | { verificationId: number }, code: string) {
    const scrapingClient = await this.prisma.getScrapingClient();
    let verification: any;
    let phoneNumber: string;
    let providerSettings: string | undefined;

    // Support both old flow (clientSmsId) and new flow (verificationId)
    if (typeof identifier === 'object' && identifier.verificationId) {
      // New flow: Verify by verificationId (no ClientSms exists yet)
      verification = await (scrapingClient as any).senderVerification.findUnique({
        where: { id: identifier.verificationId },
      });

      if (!verification || verification.clientId !== clientId) {
        throw new NotFoundException('Verification not found for this client.');
      }

      if (verification.senderType !== 'sms') {
        throw new BadRequestException('Invalid verification type.');
      }

      if (!verification.phoneNumber) {
        throw new BadRequestException('Phone number not found in verification record.');
      }

      phoneNumber = verification.phoneNumber;
      // Provider settings would need to be passed separately or stored in verification
      // For now, we'll use undefined and let it be set later if needed
    } else {
      // Old flow: Verify by clientSmsId (backward compatibility)
      const clientSmsId = identifier as number;
      const clientSms = await scrapingClient.clientSms.findUnique({
        where: { id: clientSmsId },
      });

      if (!clientSms || clientSms.clientId !== clientId) {
        throw new NotFoundException('Phone number not found for this client.');
      }

      const verificationStatus = (clientSms as any).verificationStatus;
      if (verificationStatus === 'verified') {
        return {
          success: true,
          message: 'Phone number already verified.',
        };
      }

      verification = await (scrapingClient as any).senderVerification.findUnique({
        where: { clientSmsId: clientSmsId },
      });

      if (!verification) {
        throw new BadRequestException('No OTP found for this phone number. Request a new code.');
      }

      phoneNumber = clientSms.phoneNumber;
      providerSettings = clientSms.providerSettings || undefined;
    }

    // Common verification logic
    if (verification.status === 'rejected') {
      throw new BadRequestException('Maximum attempts exceeded. Request a new code.');
    }

    if (verification.status === 'verified') {
      // If already verified and ClientSms exists, just return success
      if (typeof identifier === 'number') {
        const clientSms = await scrapingClient.clientSms.findUnique({
          where: { id: identifier },
        });
        if (clientSms) {
          await scrapingClient.clientSms.update({
            where: { id: identifier },
            data: {
              ...({
                verificationStatus: 'verified',
                verifiedAt: verification.verifiedAt || new Date(),
              } as any),
              status: 'active',
            },
          });
        }
      }
      return {
        success: true,
        message: 'Phone number verified.',
      };
    }

    if (this.otpService.isExpired(verification.otpExpiresAt)) {
      await (scrapingClient as any).senderVerification.update({
        where: { id: verification.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('OTP expired. Request a new code.');
    }

    const hashed = this.otpService.hashCode(code);
    if (hashed !== verification.otpHash) {
      const attempts = verification.attemptCount + 1;
      const status: SenderVerificationStatus =
        attempts >= this.maxOtpAttempts ? 'rejected' : 'pending';

      await (scrapingClient as any).senderVerification.update({
        where: { id: verification.id },
        data: {
          attemptCount: attempts,
          status,
        },
      });

      if (status === 'rejected') {
        throw new BadRequestException('OTP invalid. Maximum attempts reached. Request a new code.');
      }

      throw new BadRequestException('Invalid OTP. Please try again.');
    }

    // OTP is valid - proceed with verification
    const verifiedAt = new Date();
    
    // Update verification record
    await (scrapingClient as any).senderVerification.update({
      where: { id: verification.id },
      data: {
        status: 'verified',
        verifiedAt,
        attemptCount: verification.attemptCount + 1,
      },
    });

    // Handle creation/update of ClientSms
    if (typeof identifier === 'object' && identifier.verificationId) {
      // New flow: Create ClientSms record after verification
      const clientSms = await scrapingClient.clientSms.create({
        data: {
          clientId,
          phoneNumber,
          providerSettings,
          status: 'active',
          ...({
            verificationStatus: 'verified',
            verificationMethod: 'otp',
            verifiedAt,
          } as any),
          limit: null, // No limit by default
          currentCounter: 0,
          totalCounter: 0,
        },
        select: {
          id: true,
          phoneNumber: true,
          status: true,
          ...({
            verificationStatus: true,
            verificationMethod: true,
            verifiedAt: true,
            lastOtpSentAt: true,
          } as any),
          currentCounter: true,
          totalCounter: true,
          limit: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Link verification to ClientSms
      await (scrapingClient as any).senderVerification.update({
        where: { id: verification.id },
        data: { clientSmsId: clientSms.id },
      });

      this.logger.log(`📱 Phone ${phoneNumber} verified and ClientSms ${clientSms.id} created for client ${clientId}`);
    } else {
      // Old flow: Update existing ClientSms
      const clientSmsId = identifier as number;
      await scrapingClient.clientSms.update({
        where: { id: clientSmsId },
        data: {
          ...({
            verificationStatus: 'verified',
            verifiedAt,
          } as any),
          status: 'active',
        },
      });

      this.logger.log(`📱 Phone ${phoneNumber} verified for client ${clientId}`);
    }

    return {
      success: true,
      message: 'Phone number verified successfully.',
    };
  }

  private async sendSmsVerificationOtpForPending(clientId: number, verificationId: number, bypassRateLimit = false) {
    const scrapingClient = await this.prisma.getScrapingClient();

    const verification = await (scrapingClient as any).senderVerification.findUnique({
      where: { id: verificationId },
    });

    if (!verification || verification.clientId !== clientId) {
      throw new NotFoundException('Verification not found for this client.');
    }

    if (verification.senderType !== 'sms') {
      throw new BadRequestException('Invalid verification type.');
    }

    if (verification.status === 'verified') {
      return {
        success: true,
        message: 'Phone number already verified.',
      };
    }

    if (!verification.phoneNumber) {
      throw new BadRequestException('Phone number not found in verification record.');
    }

    // Rate limiting check
    if (
      !bypassRateLimit &&
      verification.lastOtpSentAt &&
      Date.now() - verification.lastOtpSentAt.getTime() < this.otpResendIntervalMs
    ) {
      const waitSeconds = Math.ceil(
        (this.otpResendIntervalMs - (Date.now() - verification.lastOtpSentAt.getTime())) / 1000,
      );
      throw new BadRequestException(`OTP already sent. Please wait ${waitSeconds}s before retrying.`);
    }

    const code = this.otpService.generateCode();
    const hash = this.otpService.hashCode(code);
    const expiresAt = this.otpService.getExpiry();
    const now = new Date();

    // Ensure phone number is in E.164 format
    let phoneNumberE164: string = String(verification.phoneNumber || '');

    // If phoneNumber doesn't start with +, normalize it
    if (!phoneNumberE164.startsWith('+')) {
      let normalized: { e164: string; countryCode: string; nationalNumber: string } | null = null;
      const commonCountries = ['PK', 'US', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR'];
      
      for (const country of commonCountries) {
        try {
          normalized = this.normalizePhoneNumber(phoneNumberE164, country);
          if (normalized) {
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!normalized) {
        try {
          normalized = this.normalizePhoneNumber(phoneNumberE164);
        } catch (error) {
          throw new BadRequestException(
            `Invalid phone number format. Please delete and re-add this number with the correct country code.`
          );
        }
      }
      
      if (!normalized) {
        throw new BadRequestException(
          `Invalid phone number format. Please delete and re-add this number with the correct country code.`
        );
      }
      
      phoneNumberE164 = String(normalized.e164);
    }

    // Update verification record with new OTP
    await (scrapingClient as any).senderVerification.update({
      where: { id: verificationId },
      data: {
        otpHash: hash,
        otpExpiresAt: expiresAt,
        attemptCount: 0,
        status: 'pending',
        lastOtpSentAt: now,
        phoneNumber: phoneNumberE164, // Update to normalized format
      },
    });

    // Send OTP via SMS
    try {
      await this.twilioService.sendSms({
        to: phoneNumberE164,
        body: `Your verification code is ${code}. It expires in 10 minutes.`,
      });

      this.otpService.logSend('sms', this.otpService.maskTarget(phoneNumberE164), expiresAt);
    } catch (error: any) {
      this.logger.error(`Failed to send OTP via Twilio: ${error.message || error}`);
      
      // Provide user-friendly error messages
      if (error.message?.includes('credentials') || error.message?.includes('authentication')) {
        throw new BadRequestException('SMS service is not properly configured. Please contact support.');
      }
      if (error.message?.includes('Invalid') || error.message?.includes('phone number')) {
        throw new BadRequestException(`Invalid phone number format: ${phoneNumberE164}. Please check the number and try again.`);
      }
      if (error.message?.includes('from') || error.message?.includes('sender')) {
        throw new BadRequestException('SMS sender number is not configured. Please contact support.');
      }
      
      throw new BadRequestException(`Failed to send verification code: ${error.message || 'Unknown error'}. Please try again.`);
    }

    return {
      success: true,
      maskedTarget: this.otpService.maskTarget(phoneNumberE164),
      expiresAt,
    };
  }

  private async sendSmsVerificationOtp(clientId: number, clientSmsId: number, bypassRateLimit = false) {
    const scrapingClient = await this.prisma.getScrapingClient();

    const clientSms = await scrapingClient.clientSms.findUnique({
      where: { id: clientSmsId },
      select: {
        id: true,
        clientId: true,
        phoneNumber: true,
        ...({
          verificationStatus: true,
          lastOtpSentAt: true,
        } as any),
      },
    });

    const clientSmsAny = clientSms as any;
    if (!clientSms || clientSmsAny.clientId !== clientId) {
      throw new NotFoundException('Phone number not found for this client.');
    }

    const verificationStatus = (clientSms as any).verificationStatus;
    if (verificationStatus === 'verified') {
      return {
        success: true,
        message: 'Phone number already verified.',
      };
    }

    const lastOtpSentAt = (clientSms as any).lastOtpSentAt;
    if (
      !bypassRateLimit &&
      lastOtpSentAt &&
      Date.now() - lastOtpSentAt.getTime() < this.otpResendIntervalMs
    ) {
      const waitSeconds = Math.ceil(
        (this.otpResendIntervalMs - (Date.now() - lastOtpSentAt.getTime())) / 1000,
      );
      throw new BadRequestException(`OTP already sent. Please wait ${waitSeconds}s before retrying.`);
    }

    // Ensure phone number is in E.164 format for Twilio
    let phoneNumberE164: string = String(clientSms.phoneNumber || '');

    // If phoneNumber doesn't start with +, normalize it
    if (!phoneNumberE164.startsWith('+')) {
      let normalized: { e164: string; countryCode: string; nationalNumber: string } | null = null;
      const commonCountries = ['PK', 'US', 'GB', 'IN', 'CA', 'AU', 'DE', 'FR']; // Common countries
      
      // Try to normalize with common country codes
      for (const country of commonCountries) {
        try {
          normalized = this.normalizePhoneNumber(phoneNumberE164, country);
          if (normalized) {
            break;
          }
        } catch {
          // Try next country
          continue;
        }
      }
      
      // If all common countries failed, try default (US)
      if (!normalized) {
        try {
          normalized = this.normalizePhoneNumber(phoneNumberE164);
        } catch (error) {
          throw new BadRequestException(
            `Invalid phone number format. Please delete and re-add this number with the correct country code. The number "${phoneNumberE164}" could not be automatically normalized.`
          );
        }
      }
      
      if (!normalized) {
        throw new BadRequestException(
          `Invalid phone number format. Please delete and re-add this number with the correct country code.`
        );
      }
      
      phoneNumberE164 = String(normalized.e164);
      
      // Update the database with normalized E.164 format
      await scrapingClient.clientSms.update({
        where: { id: clientSmsId },
        data: {
          phoneNumber: phoneNumberE164,
        },
      });
    }

    const code = this.otpService.generateCode();
    const hash = this.otpService.hashCode(code);
    const expiresAt = this.otpService.getExpiry();
    const now = new Date();

    await (scrapingClient as any).senderVerification.upsert({
      where: { clientSmsId: clientSmsId },
      update: {
        otpHash: hash,
        otpExpiresAt: expiresAt,
        attemptCount: 0,
        status: 'pending',
        verificationMethod: 'otp',
        senderType: 'sms' as SenderType,
        lastOtpSentAt: now,
        clientId, // Ensure clientId is set
        phoneNumber: phoneNumberE164, // Store phone for audit
      },
      create: {
        senderType: 'sms',
        clientId,
        clientSmsId,
        phoneNumber: phoneNumberE164, // Store phone for audit
        otpHash: hash,
        otpExpiresAt: expiresAt,
        attemptCount: 0,
        status: 'pending',
        verificationMethod: 'otp',
        lastOtpSentAt: now,
      },
    });

    await scrapingClient.clientSms.update({
      where: { id: clientSmsId },
      data: {
        ...({
          verificationStatus: 'pending',
          verificationMethod: 'otp',
          lastOtpSentAt: now,
        } as any),
        status: 'inactive',
      },
    });

    try {
      await this.twilioService.sendSms({
        to: phoneNumberE164,
        body: `Your verification code is ${code}. It expires in 10 minutes.`,
      });

      this.otpService.logSend('sms', this.otpService.maskTarget(phoneNumberE164), expiresAt);

      return {
        success: true,
        maskedTarget: this.otpService.maskTarget(phoneNumberE164),
        expiresAt,
      };
    } catch (error: any) {
      this.logger.error(`Failed to send OTP via Twilio: ${error.message || error}`);
      
      // Clean up the verification record if SMS sending failed
      try {
        await (scrapingClient as any).senderVerification.deleteMany({
          where: { clientSmsId: clientSmsId },
        });
      } catch (cleanupError) {
        this.logger.warn(`Failed to cleanup verification record: ${cleanupError}`);
      }

      // Provide user-friendly error messages
      if (error.message?.includes('credentials') || error.message?.includes('authentication')) {
        throw new BadRequestException('SMS service is not properly configured. Please contact support.');
      }
      if (error.message?.includes('Invalid') || error.message?.includes('phone number')) {
        throw new BadRequestException(`Invalid phone number format: ${phoneNumberE164}. Please check the number and try again.`);
      }
      if (error.message?.includes('from') || error.message?.includes('sender')) {
        throw new BadRequestException('SMS sender number is not configured. Please contact support.');
      }
      
      throw new BadRequestException(`Failed to send verification code: ${error.message || 'Unknown error'}. Please try again.`);
    }
  }

  private normalizePhoneNumber(rawInput: string, countryCode?: string) {
    if (!rawInput || !rawInput.trim()) {
      throw new BadRequestException('Phone number is required.');
    }

    const trimmed = rawInput.trim();
    const normalizedCountry: CountryCode =
      (countryCode?.toUpperCase() as CountryCode) ||
      ((process.env.DEFAULT_PHONE_COUNTRY || 'US') as CountryCode);

    const parserCountry =
      trimmed.startsWith('+') || trimmed.startsWith('00')
        ? undefined
        : normalizedCountry;

    const phoneNumber = parsePhoneNumberFromString(trimmed, parserCountry);
    if (!phoneNumber || !phoneNumber.isValid()) {
      throw new BadRequestException('Invalid phone number. Please enter a valid number with country code.');
    }

    if (phoneNumber.nationalNumber.length !== 10) {
      throw new BadRequestException('Phone number must be 10 digits.');
    }

    return {
      e164: phoneNumber.number,
      countryCode: (phoneNumber.country || normalizedCountry) as string,
      nationalNumber: phoneNumber.nationalNumber.toString(),
    };
  }

  /**
   * Parse a phone number in E.164 format to extract country code and national number
   * Useful for UI display and validation
   */
  parsePhoneNumber(e164Number: string): {
    e164: string;
    countryCode: string;
    nationalNumber: string;
  } | null {
    if (!e164Number || !e164Number.startsWith('+')) {
      return null;
    }

    try {
      const phoneNumber = parsePhoneNumberFromString(e164Number);
      if (!phoneNumber || !phoneNumber.isValid()) {
        return null;
      }

      return {
        e164: phoneNumber.number,
        countryCode: phoneNumber.country || '',
        nationalNumber: phoneNumber.nationalNumber.toString(),
      };
    } catch (error) {
      return null;
    }
  }
}
