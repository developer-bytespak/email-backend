import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { LlmClientService } from '../summarization/llm-client/llm-client.service';
import { TwilioService } from './twilio/twilio.service';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmClient: LlmClientService,
    private readonly twilioService: TwilioService,
  ) {}

  /**
   * Generate SMS draft using Gemini AI based on business summary
   */
  async generateSmsDraft(contactId: number, summaryId: number): Promise<any> {
    try {
      // Get scraping client to avoid prepared statement conflicts
      const scrapingClient = await this.prisma;
      
      // Get contact and summary data
      const contact = await scrapingClient.contact.findUnique({
        where: { id: contactId },
        select: {
          id: true,
          businessName: true,
          email: true,
          phone: true,
          website: true,
          status: true,
        },
      });

      if (!contact) {
        throw new NotFoundException(`Contact with ID ${contactId} not found`);
      }

      const summary = await scrapingClient.summary.findUnique({
        where: { id: summaryId },
        select: {
          id: true,
          contactId: true,
          summaryText: true,
          painPoints: true,
          strengths: true,
          opportunities: true,
          keywords: true,
          aiModel: true,
        },
      });

      if (!summary) {
        throw new NotFoundException(`Summary with ID ${summaryId} not found`);
      }

      if (summary.contactId !== contactId) {
        throw new BadRequestException('Summary does not belong to the specified contact');
      }

      // Check if contact has phone number
      // if (!contact.phone) {
      //   throw new BadRequestException('Contact does not have a phone number for SMS');
      // }

      // Generate SMS content using Gemini AI
      const smsContent = await this.generateSmsContent(summary, contact);

      // Save SMS draft to database
      const smsDraft = await scrapingClient.smsDraft.create({
        data: {
          contactId: contactId,
          summaryId: summaryId,
          messageText: smsContent,
          status: 'draft',
        },
      });

      this.logger.log(`✅ SMS draft generated for contact ${contactId} (${smsContent.length} characters)`);

      return {
        success: true,
        smsDraft,
        message: 'SMS draft generated successfully',
        characterCount: smsContent.length,
      };

    } catch (error) {
      this.logger.error(`❌ SMS generation failed for contact ${contactId}:`, error);
      throw error;
    }
  }

  /**
   * Generate SMS content using Gemini AI with the provided prompt
   */
  private async generateSmsContent(summary: any, contact: any): Promise<string> {
    const smsPrompt = `
You are an expert SMS copywriter who creates concise, high-converting business outreach texts that always sound fresh and human.

🎯 Task:
Convert the provided business summary into a short, compelling SMS outreach message.

💡 Requirements:
- Strictly under 160 characters.
- Professional yet conversational — sound like a real person, not an ad.
- Include a clear, soft call-to-action (e.g., "Worth a quick look?", "Want details?", "Open to a chat?").
- Highlight a specific value or pain point that would matter to the business.
- Avoid generic phrases ("Let's connect", "Hope you're well") and spammy terms ("free", "discount", "limited").
- Use natural phrasing, contractions, and variety in sentence rhythm.
- Randomize tone slightly each time (rotate between Friendly, Confident, Curious, Value-Focused, or Direct).
- Vary structure — do NOT always follow the same formula.

🧩 Structure Options (choose randomly each time):
1. [Hook + Value + CTA]
2. [Pain point + Solution + CTA]
3. [Question + Benefit + CTA]
4. [Observation + Insight + CTA]
5. [Compliment + Offer + CTA]

📘 Input Data:
- Company: ${contact.businessName}
- Website: ${contact.website || 'N/A'}
- Business Summary: ${summary.summaryText}
- Pain Points: ${summary.painPoints.join(', ')}
- Opportunities: ${summary.opportunities.join(', ')}
- Keywords: ${summary.keywords.join(', ')}

🎁 Output:
Only return the final SMS text (no labels, no explanations).

🧠 Example Outputs (should vary each time):
"Valor helps homeowners avoid HVAC downtime with proactive installs. Seamless + fast. Worth chatting?"
"Keeping HVAC jobs steady is tough—Valor's system automates it. Want a quick demo?"
"Love Valor's focus on service-first installs. We've got a way to boost lead flow—curious?"
`;

    try {
      // Use the existing Gemini integration - create a custom method for SMS
      const response = await this.callGeminiForSms(smsPrompt);
      
      // Clean the response (remove any extra formatting)
      const smsMessage = response.trim().replace(/^["']|["']$/g, '');
      
      // Validate character limit
      if (smsMessage.length > 160) {
        this.logger.warn(`SMS message exceeds 160 characters (${smsMessage.length}), truncating...`);
        return smsMessage.substring(0, 157) + '...';
      }
      
      return smsMessage;
      
    } catch (error) {
      this.logger.error('Failed to generate SMS content with Gemini:', error);
      
      // Fallback SMS if Gemini fails
      return `Hi ${contact.businessName}! We help businesses like yours grow. Interested in learning more? Reply YES.`;
    }
  }

  /**
   * Call Gemini API for SMS generation (wrapper around LlmClientService)
   */
  private async callGeminiForSms(prompt: string): Promise<string> {
    // Use the proper LlmClientService method for SMS generation
    return await this.llmClient.generateSmsContent(prompt);
  }

  /**
   * Get SMS drafts for a contact
   */
  async getSmsDrafts(contactId: number): Promise<any[]> {
    const scrapingClient = await this.prisma;
    
    return await scrapingClient.smsDraft.findMany({
      where: { contactId },
      orderBy: { createdAt: 'desc' },
      include: {
        summary: {
          select: {
            summaryText: true,
            painPoints: true,
            opportunities: true,
          },
        },
      },
    });
  }

  /**
   * Get a specific SMS draft
   */
  async getSmsDraft(smsDraftId: number): Promise<any> {
    const scrapingClient = await this.prisma;
    
    const smsDraft = await scrapingClient.smsDraft.findUnique({
      where: { id: smsDraftId },
      include: {
        contact: {
          select: {
            businessName: true,
            phone: true,
            email: true,
          },
        },
        summary: {
          select: {
            summaryText: true,
            painPoints: true,
            opportunities: true,
          },
        },
      },
    });

    if (!smsDraft) {
      throw new NotFoundException(`SMS draft with ID ${smsDraftId} not found`);
    }

    return smsDraft;
  }

  /**
   * Get all SMS drafts from database
   */
  async getAllSmsDrafts(): Promise<any[]> {
    const scrapingClient = await this.prisma;
    
    return await scrapingClient.smsDraft.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            phone: true,
            email: true,
          },
        },
        summary: {
          select: {
            id: true,
            summaryText: true,
            painPoints: true,
            opportunities: true,
          },
        },
      },
    });
  }

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
   */
  async sendDraft(smsDraftId: number, overrideTo?: string) {
    // Use main pooled client to avoid DIRECT_URL issues
    const db = this.prisma;

    const draft = await db.smsDraft.findUnique({
      where: { id: smsDraftId },
      include: {
        contact: { select: { id: true, phone: true } },
      },
    });

    if (!draft) throw new NotFoundException(`SMS draft with ID ${smsDraftId} not found`);

    const chosenTo = overrideTo || process.env.SMS_TEST_TO || draft.contact?.phone;
    if (!chosenTo) throw new BadRequestException('Recipient phone number is missing');

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

    const log = await db.smsLog.create({
      data: {
        smsDraftId: draft.id,
        contactId: draft.contactId,
        status: twilioResp.errorCode ? 'failed' : 'success',
        providerResponse: twilioResp as any,
        sentAt: new Date(),
      },
    });
    
    // Verify the MessageSid was stored correctly
    const storedResponse = log.providerResponse as any;
    this.logger.log(`✅ SMS Log created with ID: ${log.id}, Stored MessageSid: ${storedResponse?.sid}`);

    // Optionally mark draft as sent
    try {
      await db.smsDraft.update({
        where: { id: draft.id },
        data: { status: 'sent' },
      });
    } catch (e) {
      this.logger.warn('Failed to update draft status to sent');
    }

    return { twilio: twilioResp, log };
  }

  /**
   * Update an SMS draft (only while status is 'draft')
   */
  async updateSmsDraft(smsDraftId: number, updates: { messageText?: string }) {
    const db = this.prisma;

    const draft = await db.smsDraft.findUnique({ where: { id: smsDraftId } });
    if (!draft) throw new NotFoundException(`SMS draft with ID ${smsDraftId} not found`);
    if (draft.status !== 'draft') throw new BadRequestException('Only drafts with status "draft" can be edited');

    const data: any = {};
    if (typeof updates.messageText === 'string') {
      const trimmed = updates.messageText.trim().replace(/^\s+|\s+$/g, '');
      if (trimmed.length === 0) throw new BadRequestException('messageText cannot be empty');
      if (trimmed.length > 160) throw new BadRequestException('messageText must be 160 characters or less');
      data.messageText = trimmed;
    }

    if (Object.keys(data).length === 0) {
      return draft; // nothing to update
    }

    const updated = await db.smsDraft.update({ where: { id: smsDraftId }, data });
    return updated;
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
}
