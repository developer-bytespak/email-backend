import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EmailGenerationService } from './generation/email-generation.service';

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailGenerationService: EmailGenerationService,
  ) {}

  /**
   * Send an email draft
   */
  async sendEmailDraft(draftId: number): Promise<any> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Get the email draft
      const draft = await scrapingClient.emailDraft.findUnique({
        where: { id: draftId },
        include: {
          contact: true,
          clientEmail: true,
        },
      });

      if (!draft) {
        throw new NotFoundException(`Email draft with ID ${draftId} not found`);
      }

      if (draft.status !== 'draft' && draft.status !== 'ready') {
        throw new Error('Email draft is not in a sendable state');
      }

      // TODO: Implement actual email sending logic here
      // This would integrate with your email provider (SendGrid, Mailgun, etc.)
      
      // For now, simulate sending
      const emailLog = await scrapingClient.emailLog.create({
        data: {
          emailDraftId: draftId,
          contactId: draft.contactId,
          status: 'success',
          providerResponse: { messageId: 'simulated_' + Date.now() },
          sentAt: new Date(),
        },
      });

      // Update draft status to sent
      await scrapingClient.emailDraft.update({
        where: { id: draftId },
        data: { status: 'sent' },
      });

      // Update contact status
      await scrapingClient.contact.update({
        where: { id: draft.contactId },
        data: { status: 'sent' },
      });

      this.logger.log(`✅ Email sent successfully (Draft ID: ${draftId}, Log ID: ${emailLog.id})`);

      return {
        success: true,
        emailLogId: emailLog.id,
        message: 'Email sent successfully',
      };

    } catch (error) {
      this.logger.error(`❌ Failed to send email draft ${draftId}:`, error);
      throw error;
    }
  }

  /**
   * Create a campaign (collection of email drafts)
   */
  async createCampaign(campaignData: {
    name: string;
    description?: string;
    contactIds: number[];
    clientEmailId: number;
    tone?: 'friendly' | 'professional' | 'pro_friendly';
  }) {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Generate email drafts for all contacts
      const results: any[] = [];
      for (const contactId of campaignData.contactIds) {
        // Get the latest summary for this contact
        const summary = await scrapingClient.summary.findFirst({
          where: { contactId },
          orderBy: { createdAt: 'desc' },
        });

        if (summary) {
          const result = await this.emailGenerationService.generateEmailDraft({
            contactId,
            summaryId: summary.id,
            clientEmailId: campaignData.clientEmailId,
            tone: campaignData.tone || 'pro_friendly',
          });
          results.push(result);
        }
      }

      this.logger.log(`✅ Campaign created with ${results.length} email drafts`);

      return {
        campaignId: 'campaign_' + Date.now(),
        name: campaignData.name,
        description: campaignData.description,
        totalDrafts: results.length,
        successfulDrafts: results.filter(r => r.success).length,
        failedDrafts: results.filter(r => !r.success).length,
        results,
      };

    } catch (error) {
      this.logger.error('❌ Failed to create campaign:', error);
      throw error;
    }
  }

  /**
   * Get email templates (now using AI-generated content)
   */
  async getTemplates() {
    return [
      {
        id: 'ai_generated',
        name: 'AI-Generated Personalized',
        description: 'Dynamically generated emails based on business analysis',
        type: 'ai_personalized',
      },
      {
        id: 'friendly_tone',
        name: 'Friendly Outreach',
        description: 'Warm and conversational tone',
        type: 'tone_template',
        tone: 'friendly',
      },
      {
        id: 'professional_tone',
        name: 'Professional Outreach',
        description: 'Formal business tone',
        type: 'tone_template',
        tone: 'professional',
      },
      {
        id: 'pro_friendly_tone',
        name: 'Professional + Friendly',
        description: 'Balanced professional yet warm tone',
        type: 'tone_template',
        tone: 'pro_friendly',
      },
    ];
  }

  /**
   * Get campaign details
   */
  async getCampaign(id: string) {
    // TODO: Implement campaign retrieval from database
    return {
      id,
      name: 'Sample Campaign',
      status: 'active',
      totalEmails: 0,
      sentEmails: 0,
      openedEmails: 0,
    };
  }

  /**
   * Get email analytics for a campaign or contact
   */
  async getEmailAnalytics(contactId?: number, campaignId?: string) {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    if (contactId) {
      // Get analytics for specific contact
      const emailLogs = await scrapingClient.emailLog.findMany({
        where: { contactId },
        include: {
          emailDraft: {
            include: {
              contact: true,
            },
          },
        },
      });

      return {
        contactId,
        totalEmails: emailLogs.length,
        successfulEmails: emailLogs.filter(log => log.status === 'success').length,
        failedEmails: emailLogs.filter(log => log.status === 'failed').length,
        bouncedEmails: emailLogs.filter(log => log.status === 'bounced').length,
        logs: emailLogs,
      };
    }

    // TODO: Implement campaign-level analytics
    return {
      campaignId,
      totalEmails: 0,
      sentEmails: 0,
      openedEmails: 0,
      clickedEmails: 0,
    };
  }
}
