import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { EmailGenerationService } from './generation/email-generation.service';
import { SendGridService } from './delivery/sendgrid/sendgrid.service';
import { InboxOptimizationService } from './optimization/inbox-optimization.service';
import { UnsubscribeService } from './unsubscribe/unsubscribe.service';
import { EmailTrackingService } from './tracking/email-tracking.service';

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailGenerationService: EmailGenerationService,
    private readonly sendGridService: SendGridService,
    private readonly optimizationService: InboxOptimizationService,
    private readonly unsubscribeService: UnsubscribeService,
    private readonly trackingService: EmailTrackingService,
  ) {}

  /**
   * Send an email draft (ENHANCED with spam check, tracking, unsubscribe check)
   */
  async sendEmailDraft(draftId: number): Promise<any> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // 1. PRE-SEND VALIDATION
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
        throw new BadRequestException('Email draft is not in a sendable state');
      }

      const contact = draft.contact;
      const clientEmail = draft.clientEmail;

      // Check if contact is unsubscribed
      const isUnsubscribed = await this.unsubscribeService.isUnsubscribed(contact.id);
      if (isUnsubscribed) {
        throw new BadRequestException('Contact has unsubscribed from emails');
      }

      // Validate SendGrid configuration
      this.sendGridService.validateEmailConfig(clientEmail);

      // Check rate limits
      if (clientEmail.currentCounter >= clientEmail.limit) {
        throw new BadRequestException('Rate limit exceeded for this email account');
      }

      // 2. SPAM OPTIMIZATION
      // Note: draft.bodyText contains Gemini-generated email content based on contact summarization
      const spamCheck = await this.optimizationService.checkSpamScore(draft.bodyText);
      
      if (spamCheck.blocked) {
        // If spam score >= threshold, try to auto-optimize with Gemini
        this.logger.warn(`🚫 Email blocked due to spam score: ${spamCheck.score}. Attempting auto-optimization...`);
        
        try {
          const optimized = await this.optimizationService.optimizeContent(
            draft.bodyText,
            draft.subjectLines?.[0] || ''
          );
          
          if (optimized.optimizedContent) {
            // Update draft with optimized content
            await scrapingClient.emailDraft.update({
              where: { id: draftId },
              data: {
                bodyText: optimized.optimizedContent,
              },
            });
            
            // Re-check spam score
            const recheck = await this.optimizationService.checkSpamScore(optimized.optimizedContent);
            if (recheck.blocked) {
              throw new BadRequestException({
                message: `Email blocked: Spam score still too high after optimization (${recheck.score}). Please edit manually.`,
                spamScore: recheck.score,
                suggestions: recheck.suggestions,
                optimizedContent: optimized.optimizedContent,
              });
            }
            
            // Use optimized content
            draft.bodyText = optimized.optimizedContent;
            this.logger.log(`✅ Email auto-optimized successfully (new score: ${recheck.score})`);
          } else {
            throw new BadRequestException({
              message: `Email blocked: Spam score too high (${spamCheck.score}). Please optimize content.`,
              spamScore: spamCheck.score,
              suggestions: spamCheck.suggestions,
            });
          }
        } catch (error) {
          if (error instanceof BadRequestException) {
            throw error;
          }
          // If optimization fails, throw original error
          throw new BadRequestException({
            message: `Email blocked: Spam score too high (${spamCheck.score}). Please optimize content.`,
            spamScore: spamCheck.score,
            suggestions: spamCheck.suggestions,
          });
        }
      }

      // Log warning if score is high but not blocked
      if (spamCheck.score >= 50) {
        this.logger.warn(`⚠️ High spam score detected: ${spamCheck.score} (Draft ID: ${draftId})`);
      }

      // 3. CONTENT PREPARATION
      const trackingToken = this.trackingService.generateTrackingToken();
      const unsubscribeToken = this.unsubscribeService.generateUnsubscribeToken();
      
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      
      // Convert plain text to HTML format (handles newlines properly)
      let processedBody = this.sendGridService.convertTextToHtml(draft.bodyText);
      
      // DISABLED: Custom click tracking - using SendGrid's native click tracking instead
      // SendGrid automatically wraps links when clickTracking is enabled in trackingSettings
      // This prevents duplicate tracking and ensures better deliverability
      // processedBody = this.sendGridService.replaceLinksWithTracking(
      //   processedBody,
      //   trackingToken,
      //   baseUrl
      // );
      
      // Note: Unsubscribe link will be injected by sendEmail method

      // 4. CREATE EMAILLOG FIRST (before sending)
      // This allows us to include emailLogId in custom args for reliable webhook matching
      const emailLog = await scrapingClient.emailLog.create({
        data: {
          emailDraftId: draftId,
          contactId: contact.id,
          status: 'pending', // Will be updated to 'delivered' via webhook
          messageId: `temp_${Date.now()}`, // Temporary, will be updated with actual messageId
          trackingPixelToken: trackingToken,
          unsubscribeToken: unsubscribeToken, // Store unsubscribe token
          spamScore: spamCheck.score,
          sentVia: 'sendgrid',
          sentAt: new Date(),
        },
      });

      // 5. SEND VIA SENDGRID
      // Use client-specific API key if available, otherwise use global
      const apiKey = clientEmail.sendgridApiKey || process.env.SENDGRID_API_KEY;
      if (apiKey && apiKey !== process.env.SENDGRID_API_KEY) {
        this.sendGridService.setApiKey(apiKey);
      }

      const sendResult = await this.sendGridService.sendEmail(
        contact.email || '',
        clientEmail.emailAddress,
        draft.subjectLines?.[0] || '',
        processedBody,
        {
          unsubscribeToken,
          trackingPixelToken: trackingToken,
          emailLogId: emailLog.id, // Pass EmailLog ID for webhook matching
        }
      );

      // 6. UPDATE EMAILLOG with actual messageId from SendGrid response
      await scrapingClient.emailLog.update({
        where: { id: emailLog.id },
        data: { messageId: sendResult.messageId },
      });

      // 7. UPDATE STATUSES
      await scrapingClient.emailDraft.update({
        where: { id: draftId },
        data: { status: 'sent' },
      });

      await scrapingClient.contact.update({
        where: { id: contact.id },
        data: { status: 'sent' },
      });

      // Increment counter
      await scrapingClient.clientEmail.update({
        where: { id: clientEmail.id },
        data: {
          currentCounter: { increment: 1 },
          totalCounter: { increment: 1 },
        },
      });

      this.logger.log(`✅ Email sent successfully (Draft ID: ${draftId}, Log ID: ${emailLog.id}, Message ID: ${sendResult.messageId})`);

      return {
        success: true,
        emailLogId: emailLog.id,
        messageId: sendResult.messageId,
        spamScore: spamCheck.score,
        message: 'Email sent successfully',
      };

    } catch (error) {
      this.logger.error(`❌ Failed to send email draft ${draftId}:`, error);
      throw error;
    }
  }

  // COMMENTED OUT - Campaign management deferred to Phase 2
  // /**
  //  * Create a campaign (collection of email drafts)
  //  */
  // async createCampaign(campaignData: {
  //   name: string;
  //   description?: string;
  //   contactIds: number[];
  //   clientEmailId: number;
  //   tone?: 'friendly' | 'professional' | 'pro_friendly';
  // }) {
  //   try {
  //     const scrapingClient = await this.prisma.getScrapingClient();
  //     
  //     // Generate email drafts for all contacts
  //     const results: any[] = [];
  //     for (const contactId of campaignData.contactIds) {
  //       // Get the latest summary for this contact
  //       const summary = await scrapingClient.summary.findFirst({
  //         where: { contactId },
  //         orderBy: { createdAt: 'desc' },
  //       });

  //       if (summary) {
  //         const result = await this.emailGenerationService.generateEmailDraft({
  //           contactId,
  //           summaryId: summary.id,
  //           clientEmailId: campaignData.clientEmailId,
  //           tone: campaignData.tone || 'pro_friendly',
  //         });
  //         results.push(result);
  //       }
  //     }

  //     this.logger.log(`✅ Campaign created with ${results.length} email drafts`);

  //     return {
  //       campaignId: 'campaign_' + Date.now(),
  //       name: campaignData.name,
  //       description: campaignData.description,
  //       totalDrafts: results.length,
  //       successfulDrafts: results.filter(r => r.success).length,
  //       failedDrafts: results.filter(r => !r.success).length,
  //       results,
  //     };

  //   } catch (error) {
  //     this.logger.error('❌ Failed to create campaign:', error);
  //     throw error;
  //   }
  // }

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

  // COMMENTED OUT - Campaign management deferred to Phase 2
  // /**
  //  * Get campaign details
  //  */
  // async getCampaign(id: string) {
  //   // TODO: Implement campaign retrieval from database
  //   return {
  //     id,
  //     name: 'Sample Campaign',
  //     status: 'active',
  //     totalEmails: 0,
  //     sentEmails: 0,
  //     openedEmails: 0,
  //   };
  // }

  /**
   * Get email drafts scoped to a specific client (optionally filtered by clientEmailId)
   */
  async getDraftsForClient(clientId: number, clientEmailId?: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    const where: Prisma.EmailDraftWhereInput = {
      OR: [
        { clientId },
        { clientEmail: { clientId } },
      ],
    };

    if (clientEmailId !== undefined) {
      where.clientEmailId = clientEmailId;
    }

    return scrapingClient.emailDraft.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            email: true,
            phone: true,
            website: true,
          },
        },
        summary: {
          select: {
            id: true,
            summaryText: true,
            painPoints: true,
            strengths: true,
            opportunities: true,
            keywords: true,
          },
        },
        clientEmail: {
          select: {
            id: true,
            emailAddress: true,
            clientId: true,
          },
        },
      },
    });
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

  /**
   * Get email logs (history) for a specific clientEmailId
   * Returns all emails sent from this email address with full details
   */
  async getEmailLogsByClientEmailId(clientEmailId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Verify clientEmail exists
    const clientEmail = await scrapingClient.clientEmail.findUnique({
      where: { id: clientEmailId },
      select: { id: true, emailAddress: true, status: true },
    });

    if (!clientEmail) {
      throw new NotFoundException(`ClientEmail with ID ${clientEmailId} not found`);
    }

    // Get all email logs for this clientEmailId (via emailDraft relation)
    const logs = await scrapingClient.emailLog.findMany({
      where: {
        emailDraft: {
          clientEmailId: clientEmailId,
        },
      },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            email: true,
            phone: true,
          },
        },
        emailDraft: {
          select: {
            id: true,
            subjectLines: true,
            bodyText: true,
            status: true,
            createdAt: true,
            clientEmail: {
              select: {
                id: true,
                emailAddress: true,
                status: true,
                currentCounter: true,
                totalCounter: true,
                limit: true,
              },
            },
          },
        },
        emailEngagements: {
          select: {
            id: true,
            engagementType: true,
            engagedAt: true,
            url: true,
          },
          orderBy: { engagedAt: 'desc' },
        },
      },
      orderBy: { sentAt: 'desc' }, // Newest first
    });

    this.logger.log(`✅ Retrieved ${logs.length} email logs for ClientEmail ${clientEmailId}`);

    return logs;
  }

  /**
   * Get all client emails for a specific client
   */
  async getClientEmails(clientId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    const emails = await scrapingClient.clientEmail.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        emailAddress: true,
        status: true,
        currentCounter: true,
        totalCounter: true,
        limit: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return emails;
  }

  /**
   * Create a new client email
   */
  async createClientEmail(clientId: number, createDto: { emailAddress: string; providerSettings?: string }): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();

    try {
      // Check if email already exists for this client
      const existing = await scrapingClient.clientEmail.findFirst({
        where: {
          clientId,
          emailAddress: createDto.emailAddress,
        },
      });

      if (existing) {
        throw new BadRequestException('Email address already exists for this client');
      }

      const clientEmail = await scrapingClient.clientEmail.create({
        data: {
          clientId,
          emailAddress: createDto.emailAddress,
          providerSettings: createDto.providerSettings,
          status: 'active',
          limit: 500,
          currentCounter: 0,
          totalCounter: 0,
        },
        select: {
          id: true,
          emailAddress: true,
          status: true,
          currentCounter: true,
          totalCounter: true,
          limit: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      this.logger.log(`✅ Created client email ${clientEmail.id} for client ${clientId}`);

      return clientEmail;
    } catch (error) {
      // Handle Prisma unique constraint errors
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // Check if it's a Prisma unique constraint error
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2002') {
          // Unique constraint violation
          const meta = (error as any).meta;
          if (meta?.target?.includes('emailAddress')) {
            throw new BadRequestException('Email address already exists for this client');
          }
        }
      }
      
      this.logger.error(`Failed to create client email: ${error}`);
      throw new BadRequestException('Failed to create email address. Please try again.');
    }
  }

  /**
   * Delete a client email
   */
  async deleteClientEmail(clientId: number, id: number): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Verify the email belongs to the client
    const clientEmail = await scrapingClient.clientEmail.findUnique({
      where: { id },
    });

    if (!clientEmail) {
      throw new NotFoundException(`Client email with ID ${id} not found`);
    }

    if (clientEmail.clientId !== clientId) {
      throw new BadRequestException('You do not have permission to delete this email');
    }

    // Check if there are any drafts using this email
    const draftCount = await scrapingClient.emailDraft.count({
      where: { clientEmailId: id },
    });

    if (draftCount > 0) {
      throw new BadRequestException(`Cannot delete email: ${draftCount} draft(s) are using this email address`);
    }

    await scrapingClient.clientEmail.delete({
      where: { id },
    });

    this.logger.log(`✅ Deleted client email ${id} for client ${clientId}`);
  }
}
