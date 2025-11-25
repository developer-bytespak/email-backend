import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';

// Temporary types until Prisma client is regenerated
type SenderVerificationStatus = 'pending' | 'verified' | 'expired' | 'rejected';
type SenderType = 'email' | 'sms';
import { EmailGenerationService } from './generation/email-generation.service';
import { SendGridService } from './delivery/sendgrid/sendgrid.service';
import { InboxOptimizationService } from './optimization/inbox-optimization.service';
import { UnsubscribeService } from './unsubscribe/unsubscribe.service';
import { EmailTrackingService } from './tracking/email-tracking.service';
import { ValidationService } from '../validation/validation.service';
import { OtpService } from '../../common/services/otp.service';

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);
  private readonly otpResendIntervalMs = Number(process.env.SENDER_VERIFICATION_RESEND_SECONDS || '60') * 1000;
  private readonly maxOtpAttempts = Number(process.env.SENDER_VERIFICATION_MAX_ATTEMPTS || '5');
  private readonly verificationFromEmail = process.env.VERIFICATION_EMAIL_FROM || 'verify@bytesplatform.com';
  private readonly verificationEmailSubject =
    process.env.VERIFICATION_EMAIL_SUBJECT || 'Verify your sending email';

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailGenerationService: EmailGenerationService,
    private readonly sendGridService: SendGridService,
    private readonly optimizationService: InboxOptimizationService,
    private readonly unsubscribeService: UnsubscribeService,
    private readonly trackingService: EmailTrackingService,
    private readonly validationService: ValidationService,
    private readonly otpService: OtpService,
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

      const verificationStatus = (clientEmail as any).verificationStatus;
      if (verificationStatus !== 'verified') {
        throw new BadRequestException('Email address must be verified before sending.');
      }

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
   * Get all email logs for a specific clientId
   * Returns all emails sent from any email address belonging to this client
   * OPTIMIZED: Single query instead of N queries (one per clientEmailId)
   * OPTIMIZED: Reduced payload size by excluding unused fields
   * OPTIMIZED: Pagination and date filtering for better performance
   */
  async getEmailLogsByClientId(
    clientId: number,
    options?: {
      limit?: number;
      offset?: number;
      dateFrom?: Date;
      dateTo?: Date;
      includeFullBody?: boolean; // For detail view - load body on demand
    }
  ): Promise<{ logs: any[]; total: number }> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Verify client exists
    const client = await scrapingClient.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException(`Client with ID ${clientId} not found`);
    }

    // Build where clause with date filtering
    const where: any = {
      emailDraft: {
        clientEmail: {
          clientId: clientId,
        },
      },
    };

    // Add date range filtering (default to last 90 days if not specified)
    if (options?.dateFrom || options?.dateTo) {
      where.sentAt = {};
      if (options.dateFrom) {
        where.sentAt.gte = options.dateFrom;
      }
      if (options.dateTo) {
        where.sentAt.lte = options.dateTo;
      }
    } else if (!options?.dateFrom && !options?.dateTo) {
      // Default to last 90 days for better performance
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      where.sentAt = { gte: ninetyDaysAgo };
    }

    // Get total count first (for pagination)
    const total = await scrapingClient.emailLog.count({ where });

    // OPTIMIZED: Only select necessary fields to reduce payload size
    const logs = await scrapingClient.emailLog.findMany({
      where,
      select: {
        // Only essential EmailLog fields (removed unused: providerResponse, tokens, messageId, etc.)
        id: true,
        contactId: true,
        status: true,
        sentAt: true,
        // Optional: only if needed for detail view
        ...(options?.includeFullBody && {
          deliveredAt: true,
          spamScore: true,
        }),
        contact: {
          select: {
            id: true,
            businessName: true,
            email: true,
            // Removed: phone (not displayed in history list)
          },
        },
        emailDraft: {
          select: {
            id: true,
            subjectLines: true, // Only first one is used, but array is small
            // Conditionally include bodyText (large field - exclude from list view)
            ...(options?.includeFullBody ? {
              bodyText: true,
            } : {}),
            // Only emailAddress from clientEmail (removed: id, status, counters, limit)
            clientEmail: {
              select: {
                emailAddress: true, // Only field used in history list
                // Removed: id, status, currentCounter, totalCounter, limit (not displayed)
              },
            },
            // Removed: status, createdAt (not used in history list)
          },
        },
        // Include engagements for counting (we'll transform to counts)
        emailEngagements: {
          select: {
            engagementType: true, // Only need type for counting
            // Removed: id, engagedAt, url (not used in history list)
          },
        },
      },
      orderBy: { sentAt: 'desc' }, // Newest first
      take: options?.limit || 100, // Default limit: 100 records
      skip: options?.offset || 0,
    });

    // Transform to add engagement counts and remove full engagements array
    const logsWithCounts = logs.map((log) => {
      const opens = log.emailEngagements?.filter((e: any) => e.engagementType === 'open').length || 0;
      const clicks = log.emailEngagements?.filter((e: any) => e.engagementType === 'click').length || 0;
      
      // Remove emailEngagements array, add counts instead
      const { emailEngagements, ...logWithoutEngagements } = log as any;
      return {
        ...logWithoutEngagements,
        // Add engagement counts instead of full array
        opens,
        clicks,
      };
    });

    this.logger.log(
      `✅ Retrieved ${logsWithCounts.length} of ${total} email logs for Client ${clientId} (offset: ${options?.offset || 0}, limit: ${options?.limit || 100})`
    );

    return { logs: logsWithCounts, total };
  }

  /**
   * Get all client emails for a specific client
   * Includes both verified ClientEmail records and pending verifications
   */
  async getClientEmails(clientId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Get verified ClientEmail records
    const verifiedEmails = await scrapingClient.clientEmail.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        emailAddress: true,
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

    // Get pending verifications (no ClientEmail record yet)
    // Note: This requires the migration that adds emailAddress/phoneNumber to SenderVerification
    let pendingVerifications: any[] = [];
    try {
      // Check if SenderVerification model exists and has emailAddress column
      const testQuery = await scrapingClient.$queryRaw<Array<{ exists: boolean }>>`
        SELECT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'SenderVerification' 
            AND column_name = 'emailAddress'
        ) as exists
      `;
      
      if (testQuery[0]?.exists) {
        // Column exists, use Prisma query
        pendingVerifications = await (scrapingClient as any).senderVerification.findMany({
          where: {
            clientId,
            senderType: 'email',
            status: 'pending',
            clientEmailId: null,
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            emailAddress: true,
            lastOtpSentAt: true,
            createdAt: true,
            updatedAt: true,
          },
        });
      } else {
        // Migration not applied - column doesn't exist
        this.logger.warn('SenderVerification.emailAddress column not found. Migration 20251125211530_add_temporary_verification_storage needs to be applied.');
        pendingVerifications = [];
      }
    } catch (error: any) {
      // If query fails for other reasons, log and return empty array
      this.logger.warn('Error checking for emailAddress column (returning empty pending verifications):', error?.message || error);
      pendingVerifications = [];
    }

    // Transform pending verifications to match ClientEmail structure
    const pendingEmails = pendingVerifications.map((v: any) => ({
      id: null, // No ClientEmail record yet
      emailAddress: v.emailAddress,
      status: 'inactive',
      verificationStatus: 'pending',
      verificationMethod: 'otp',
      verifiedAt: null,
      lastOtpSentAt: v.lastOtpSentAt,
      currentCounter: 0,
      totalCounter: 0,
      limit: 500,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      verificationId: v.id, // Store verification ID for frontend
    }));

    // Combine and sort by creation date (newest first)
    const allEmails = [...verifiedEmails, ...pendingEmails].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return allEmails;
  }

  /**
   * Create a new client email
   */
  async createClientEmail(clientId: number, createDto: { emailAddress: string; providerSettings?: string }): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();

    try {
      const emailIsDeliverable = await this.validationService.validateEmail(createDto.emailAddress);
      if (!emailIsDeliverable) {
        throw new BadRequestException('Email domain is not accepting mail. Please use a valid mailbox.');
      }

      // Check if email already exists for this client (verified)
      const existing = await scrapingClient.clientEmail.findFirst({
        where: {
          clientId,
          emailAddress: createDto.emailAddress,
        },
      });

      if (existing) {
        throw new BadRequestException('Email address already exists for this client');
      }

      // Check if there's already a pending verification for this email
      const existingVerification = await (scrapingClient as any).senderVerification.findFirst({
        where: {
          clientId,
          emailAddress: createDto.emailAddress,
          status: 'pending',
          senderType: 'email',
        },
      });

      if (existingVerification) {
        // Resend OTP for existing pending verification
        await this.sendEmailVerificationOtpForPending(clientId, existingVerification.id, true);
        
        return {
          id: null, // No ClientEmail record yet
          emailAddress: createDto.emailAddress,
          status: 'inactive',
          verificationStatus: 'pending',
          verificationMethod: 'otp',
          verifiedAt: null,
          lastOtpSentAt: existingVerification.lastOtpSentAt,
          currentCounter: 0,
          totalCounter: 0,
          limit: 500,
          createdAt: existingVerification.createdAt,
          updatedAt: existingVerification.updatedAt,
          verificationId: existingVerification.id, // Store verification ID for frontend
        };
      }

      // Create temporary verification record and send OTP (NO ClientEmail record yet)
      const code = this.otpService.generateCode();
      const hash = this.otpService.hashCode(code);
      const expiresAt = this.otpService.getExpiry();
      const now = new Date();

      const verification = await (scrapingClient as any).senderVerification.create({
        data: {
          senderType: 'email',
          clientId,
          emailAddress: createDto.emailAddress,
          otpHash: hash,
          otpExpiresAt: expiresAt,
          attemptCount: 0,
          status: 'pending',
          verificationMethod: 'otp',
          lastOtpSentAt: now,
        },
      });

      // Send OTP email
      const html = `
        <p>Hi there,</p>
        <p>Use the code below to verify <strong>${createDto.emailAddress}</strong> for sending emails.</p>
        <p style="font-size: 24px; letter-spacing: 4px;"><strong>${code}</strong></p>
        <p>This code expires in 10 minutes. If you did not request this, please ignore the email.</p>
      `;

      await this.sendGridService.sendEmail(
        createDto.emailAddress,
        this.verificationFromEmail,
        this.verificationEmailSubject,
        html,
      );

      this.otpService.logSend('email', this.otpService.maskTarget(createDto.emailAddress), expiresAt);

      // Return temporary structure (no ClientEmail record yet)
      return {
        id: null, // No ClientEmail record yet
        emailAddress: createDto.emailAddress,
        status: 'inactive',
        verificationStatus: 'pending',
        verificationMethod: 'otp',
        verifiedAt: null,
        lastOtpSentAt: now,
        currentCounter: 0,
        totalCounter: 0,
        limit: 500,
        createdAt: now,
        updatedAt: now,
        verificationId: verification.id, // Store verification ID for frontend
      };
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

  async requestEmailOtp(clientId: number, identifier: number | { verificationId: number }) {
    // Support both old flow (clientEmailId) and new flow (verificationId)
    if (typeof identifier === 'object' && identifier.verificationId) {
      return this.sendEmailVerificationOtpForPending(clientId, identifier.verificationId);
    }
    // Old flow: clientEmailId (backward compatibility)
    return this.sendEmailVerificationOtp(clientId, identifier as number);
  }

  async verifyEmailOtp(clientId: number, identifier: number | { verificationId: number }, code: string) {
    const scrapingClient = await this.prisma.getScrapingClient();
    let verification: any;
    let emailAddress: string;
    let providerSettings: string | undefined;

    // Support both old flow (clientEmailId) and new flow (verificationId)
    if (typeof identifier === 'object' && identifier.verificationId) {
      // New flow: Verify by verificationId (no ClientEmail exists yet)
      verification = await (scrapingClient as any).senderVerification.findUnique({
        where: { id: identifier.verificationId },
      });

      if (!verification || verification.clientId !== clientId) {
        throw new NotFoundException('Verification not found for this client.');
      }

      if (verification.senderType !== 'email') {
        throw new BadRequestException('Invalid verification type.');
      }

      if (!verification.emailAddress) {
        throw new BadRequestException('Email address not found in verification record.');
      }

      emailAddress = verification.emailAddress;
      // Provider settings would need to be passed separately or stored in verification
      // For now, we'll use undefined and let it be set later if needed
    } else {
      // Old flow: Verify by clientEmailId (backward compatibility)
      const clientEmailId = identifier as number;
      const clientEmail = await scrapingClient.clientEmail.findUnique({
        where: { id: clientEmailId },
        include: {
          client: true,
        },
      });

      if (!clientEmail || clientEmail.clientId !== clientId) {
        throw new NotFoundException('Email address not found for this client.');
      }

      const verificationStatus = (clientEmail as any).verificationStatus;
      if (verificationStatus === 'verified') {
        return {
          success: true,
          message: 'Email already verified.',
        };
      }

      verification = await (scrapingClient as any).senderVerification.findUnique({
        where: { clientEmailId: clientEmailId },
      });

      if (!verification) {
        throw new BadRequestException('No OTP found for this email. Please request a new code.');
      }

      emailAddress = clientEmail.emailAddress;
      providerSettings = clientEmail.providerSettings || undefined;
    }

    // Common verification logic
    if (verification.status === 'rejected') {
      throw new BadRequestException('Maximum attempts exceeded. Please request a new OTP.');
    }

    if (verification.status === 'verified') {
      // If already verified and ClientEmail exists, just return success
      if (typeof identifier === 'number') {
        const clientEmail = await scrapingClient.clientEmail.findUnique({
          where: { id: identifier },
        });
        if (clientEmail) {
          await scrapingClient.clientEmail.update({
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
        message: 'Email verified.',
      };
    }

    if (this.otpService.isExpired(verification.otpExpiresAt)) {
      await (scrapingClient as any).senderVerification.update({
        where: { id: verification.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException('OTP has expired. Please request a new code.');
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

    // Handle creation/update of ClientEmail
    if (typeof identifier === 'object' && identifier.verificationId) {
      // New flow: Create ClientEmail record after verification
      const clientEmail = await scrapingClient.clientEmail.create({
        data: {
          clientId,
          emailAddress,
          providerSettings,
          status: 'active',
          ...({
            verificationStatus: 'verified',
            verificationMethod: 'otp',
            verifiedAt,
          } as any),
          limit: 500,
          currentCounter: 0,
          totalCounter: 0,
        },
        select: {
          id: true,
          emailAddress: true,
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

      // Link verification to ClientEmail
      await (scrapingClient as any).senderVerification.update({
        where: { id: verification.id },
        data: { clientEmailId: clientEmail.id },
      });

      this.logger.log(`📧 Email ${emailAddress} verified and ClientEmail ${clientEmail.id} created for client ${clientId}`);
    } else {
      // Old flow: Update existing ClientEmail
      const clientEmailId = identifier as number;
      await scrapingClient.clientEmail.update({
        where: { id: clientEmailId },
        data: {
          ...({
            verificationStatus: 'verified',
            verifiedAt,
          } as any),
          status: 'active',
        },
      });

      this.logger.log(`📧 Email ${emailAddress} verified for client ${clientId}`);
    }

    return {
      success: true,
      message: 'Email verified successfully.',
    };
  }

  private async sendEmailVerificationOtpForPending(clientId: number, verificationId: number, bypassRateLimit = false) {
    const scrapingClient = await this.prisma.getScrapingClient();

    const verification = await (scrapingClient as any).senderVerification.findUnique({
      where: { id: verificationId },
    });

    if (!verification || verification.clientId !== clientId) {
      throw new NotFoundException('Verification not found for this client.');
    }

    if (verification.senderType !== 'email') {
      throw new BadRequestException('Invalid verification type.');
    }

    if (verification.status === 'verified') {
      return {
        success: true,
        message: 'Email already verified.',
      };
    }

    if (!verification.emailAddress) {
      throw new BadRequestException('Email address not found in verification record.');
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

    // Update verification record with new OTP
    await (scrapingClient as any).senderVerification.update({
      where: { id: verificationId },
      data: {
        otpHash: hash,
        otpExpiresAt: expiresAt,
        attemptCount: 0,
        status: 'pending',
        lastOtpSentAt: now,
      },
    });

    // Send OTP email
    const html = `
      <p>Hi there,</p>
      <p>Use the code below to verify <strong>${verification.emailAddress}</strong> for sending emails.</p>
      <p style="font-size: 24px; letter-spacing: 4px;"><strong>${code}</strong></p>
      <p>This code expires in 10 minutes. If you did not request this, please ignore the email.</p>
    `;

    await this.sendGridService.sendEmail(
      verification.emailAddress,
      this.verificationFromEmail,
      this.verificationEmailSubject,
      html,
    );

    this.otpService.logSend('email', this.otpService.maskTarget(verification.emailAddress), expiresAt);

    return {
      success: true,
      maskedTarget: this.otpService.maskTarget(verification.emailAddress),
      expiresAt,
    };
  }

  private async sendEmailVerificationOtp(clientId: number, clientEmailId: number, bypassRateLimit = false) {
    const scrapingClient = await this.prisma.getScrapingClient();

    const clientEmail = await scrapingClient.clientEmail.findUnique({
      where: { id: clientEmailId },
    });

    if (!clientEmail || clientEmail.clientId !== clientId) {
      throw new NotFoundException('Email address not found for this client.');
    }

    const verificationStatus = (clientEmail as any).verificationStatus;
    if (verificationStatus === 'verified') {
      return {
        success: true,
        message: 'Email already verified.',
      };
    }

    const lastOtpSentAt = (clientEmail as any).lastOtpSentAt;
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

    const code = this.otpService.generateCode();
    const hash = this.otpService.hashCode(code);
    const expiresAt = this.otpService.getExpiry();
    const now = new Date();

    await (scrapingClient as any).senderVerification.upsert({
      where: { clientEmailId: clientEmailId },
      update: {
        otpHash: hash,
        otpExpiresAt: expiresAt,
        attemptCount: 0,
        status: 'pending',
        verificationMethod: 'otp',
        senderType: 'email' as SenderType,
        lastOtpSentAt: now,
        clientId, // Ensure clientId is set
        emailAddress: clientEmail.emailAddress, // Store email for audit
      },
      create: {
        senderType: 'email',
        clientId,
        clientEmailId,
        emailAddress: clientEmail.emailAddress, // Store email for audit
        otpHash: hash,
        otpExpiresAt: expiresAt,
        attemptCount: 0,
        status: 'pending',
        verificationMethod: 'otp',
        lastOtpSentAt: now,
      },
    });

    await scrapingClient.clientEmail.update({
      where: { id: clientEmailId },
      data: {
        ...({
          verificationStatus: 'pending',
          verificationMethod: 'otp',
          lastOtpSentAt: now,
        } as any),
        status: 'inactive',
      },
    });

    const html = `
      <p>Hi there,</p>
      <p>Use the code below to verify <strong>${clientEmail.emailAddress}</strong> for sending emails.</p>
      <p style="font-size: 24px; letter-spacing: 4px;"><strong>${code}</strong></p>
      <p>This code expires in 10 minutes. If you did not request this, please ignore the email.</p>
    `;

    await this.sendGridService.sendEmail(
      clientEmail.emailAddress,
      this.verificationFromEmail,
      this.verificationEmailSubject,
      html,
    );

    this.otpService.logSend('email', this.otpService.maskTarget(clientEmail.emailAddress), expiresAt);

    return {
      success: true,
      maskedTarget: this.otpService.maskTarget(clientEmail.emailAddress),
      expiresAt,
    };
  }
}
