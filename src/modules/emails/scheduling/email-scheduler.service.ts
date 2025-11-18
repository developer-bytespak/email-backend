import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { SendGridService } from '../delivery/sendgrid/sendgrid.service';
import { InboxOptimizationService } from '../optimization/inbox-optimization.service';
import { UnsubscribeService } from '../unsubscribe/unsubscribe.service';
import { EmailTrackingService } from '../tracking/email-tracking.service';

@Injectable()
export class EmailSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(EmailSchedulerService.name);
  private readonly SCHEDULER_INTERVAL = parseInt(process.env.EMAIL_SCHEDULER_INTERVAL || '300000'); // 5 minutes
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sendGridService: SendGridService,
    private readonly optimizationService: InboxOptimizationService,
    private readonly unsubscribeService: UnsubscribeService,
    private readonly trackingService: EmailTrackingService,
  ) {}

  /**
   * Start background job on module init
   */
  onModuleInit() {
    this.logger.log('📧 Email scheduler initialized');
    this.startScheduler();
  }

  /**
   * Start the background scheduler
   */
  private startScheduler() {
    // Process queue immediately on startup
    this.processQueue().catch(err => {
      this.logger.error('Initial queue processing failed:', err);
    });

    // Then process every N minutes
    this.intervalId = setInterval(() => {
      this.processQueue().catch(err => {
        this.logger.error('Queue processing failed:', err);
      });
    }, this.SCHEDULER_INTERVAL);

    this.logger.log(`✅ Email scheduler started (interval: ${this.SCHEDULER_INTERVAL / 1000}s)`);
  }

  /**
   * Schedule email for later sending
   */
  async scheduleEmail(draftId: number, scheduledAt: Date): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Check if already in queue
    const existing = await scrapingClient.emailQueue.findUnique({
      where: { emailDraftId: draftId },
    });

    if (existing) {
      // Update existing queue entry
      return await scrapingClient.emailQueue.update({
        where: { emailDraftId: draftId },
        data: {
          scheduledAt,
          status: 'pending',
          priority: this.calculatePriority(scheduledAt),
        },
      });
    }

    // Create new queue entry
    return await scrapingClient.emailQueue.create({
      data: {
        emailDraftId: draftId,
        scheduledAt,
        status: 'pending',
        priority: this.calculatePriority(scheduledAt),
      },
    });
  }

  /**
   * Calculate priority based on scheduled time (FIFO)
   * Uses relative seconds from base date to fit in INT4 (max ~68 years from base)
   */
  private calculatePriority(scheduledAt: Date): number {
    // Lower number = higher priority
    // Use relative priority: seconds since base date (fits in INT4)
    const baseDate = new Date('2020-01-01T00:00:00Z');
    const secondsSinceBase = Math.floor((scheduledAt.getTime() - baseDate.getTime()) / 1000);
    return secondsSinceBase; // This will fit in INT4 (max value: 2,147,483,647 seconds ≈ 68 years)
  }

  /**
   * Process email queue (runs in background)
   */
  async processQueue(): Promise<void> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Get pending emails ready to send (FIFO order)
      // Filter: retryCount < 3 (retryCount defaults to 0, so null check not needed)
      const queueItems = await scrapingClient.emailQueue.findMany({
        where: {
          status: 'pending',
          scheduledAt: {
            lte: new Date(), // Scheduled time has passed
          },
          retryCount: { lt: 3 }, // retryCount defaults to 0, so this covers all cases
        },
        include: {
          emailDraft: {
            include: {
              contact: true,
              clientEmail: true,
            },
          },
        },
        orderBy: [
          { priority: 'asc' },
          { scheduledAt: 'asc' },
          { createdAt: 'asc' },
        ],
        take: 10, // Process 10 at a time
      });

      if (queueItems.length === 0) {
        return; // Nothing to process
      }

      this.logger.log(`📧 Processing ${queueItems.length} queued emails...`);

      // Process each email
      for (const queueItem of queueItems) {
        await this.processQueueItem(queueItem);
        
        // Add random delay between sends (5-10 minutes)
        const delay = this.calculateDelay();
        await this.sleep(delay);
      }
    } catch (error) {
      this.logger.error('Error processing queue:', error);
    }
  }

  /**
   * Process a single queue item
   */
  private async processQueueItem(queueItem: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    try {
      const draft = queueItem.emailDraft;
      const contact = draft.contact;
      const clientEmail = draft.clientEmail;

      // Check if contact is unsubscribed
      const isUnsubscribed = await this.unsubscribeService.isUnsubscribed(contact.id);
      if (isUnsubscribed) {
        this.logger.warn(`⏭️ Skipping email for unsubscribed contact ${contact.id}`);
        await scrapingClient.emailQueue.update({
          where: { id: queueItem.id },
          data: { status: 'sent' }, // Mark as sent (skipped)
        });
        return;
      }

      // Check rate limits
      if (!this.checkRateLimits(clientEmail)) {
        this.logger.warn(`⏸️ Rate limit reached for ClientEmail ${clientEmail.id}, skipping...`);
        return; // Skip this one, will retry later
      }

      // Check spam score
      const spamCheck = await this.optimizationService.checkSpamScore(draft.bodyText);
      if (spamCheck.blocked) {
        this.logger.warn(`🚫 Email blocked due to spam score: ${spamCheck.score}`);
        await scrapingClient.emailQueue.update({
          where: { id: queueItem.id },
          data: { status: 'failed' },
        });
        throw new Error(`Spam score too high: ${spamCheck.score}`);
      }

      // Generate tokens
      const trackingToken = this.trackingService.generateTrackingToken();
      const unsubscribeToken = this.unsubscribeService.generateUnsubscribeToken();

      // Prepare email content
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      
      // Convert plain text to HTML format (handles newlines properly)
      let processedBody = this.sendGridService.convertTextToHtml(draft.bodyText);
      
      // Replace links with tracking URLs
      processedBody = this.sendGridService.replaceLinksWithTracking(processedBody, trackingToken, baseUrl);
      
      // Note: Unsubscribe link will be injected by sendEmail method

      // Create EmailLog FIRST (before sending)
      // This allows us to include emailLogId in custom args for reliable webhook matching
      const emailLog = await scrapingClient.emailLog.create({
        data: {
          emailDraftId: draft.id,
          contactId: contact.id,
          status: 'pending',
          messageId: `temp_${Date.now()}`, // Temporary, will be updated with actual messageId
          trackingPixelToken: trackingToken,
          unsubscribeToken: unsubscribeToken, // Store unsubscribe token
          spamScore: spamCheck.score,
          sentVia: 'sendgrid',
          sentAt: new Date(),
        },
      });

      // Send via SendGrid
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

      // Update EmailLog with actual messageId from SendGrid response
      await scrapingClient.emailLog.update({
        where: { id: emailLog.id },
        data: { messageId: sendResult.messageId },
      });

      // Update draft status
      await scrapingClient.emailDraft.update({
        where: { id: draft.id },
        data: { status: 'sent' },
      });

      // Update contact status
      await scrapingClient.contact.update({
        where: { id: contact.id },
        data: { status: 'sent' },
      });

      // Update queue status
      await scrapingClient.emailQueue.update({
        where: { id: queueItem.id },
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

      this.logger.log(`✅ Queued email sent (Queue ID: ${queueItem.id}, EmailLog ID: ${emailLog.id})`);
    } catch (error) {
      this.logger.error(`❌ Failed to send queued email ${queueItem.id}:`, error);
      
      // Handle retry
      await this.handleRetry(queueItem);
    }
  }

  /**
   * Check rate limits
   */
  private checkRateLimits(clientEmail: any): boolean {
    return clientEmail.currentCounter < clientEmail.limit;
  }

  /**
   * Calculate random delay (5-10 minutes)
   */
  private calculateDelay(): number {
    const minDelay = 5 * 60 * 1000; // 5 minutes
    const maxDelay = 10 * 60 * 1000; // 10 minutes
    return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  }

  /**
   * Handle retry logic
   */
  private async handleRetry(queueItem: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const retryCount = (queueItem.retryCount || 0) + 1;
    
    if (retryCount >= 3) {
      // Max retries reached
      await scrapingClient.emailQueue.update({
        where: { id: queueItem.id },
        data: { status: 'failed' },
      });
      return;
    }

    // Exponential backoff: 5min, 10min, 15min
    const backoffMinutes = retryCount * 5;
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

    await scrapingClient.emailQueue.update({
      where: { id: queueItem.id },
      data: {
        retryCount,
        nextRetryAt,
        status: 'pending', // Keep as pending for retry
      },
    });

    this.logger.log(`🔄 Scheduled retry ${retryCount}/3 for queue item ${queueItem.id} at ${nextRetryAt}`);
  }

  /**
   * Get queue statistics
   */
  async getQueueStatus(): Promise<{
    pending: number;
    sent: number;
    failed: number;
    nextProcessing: Date;
  }> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const [pending, sent, failed] = await Promise.all([
      scrapingClient.emailQueue.count({ where: { status: 'pending' } }),
      scrapingClient.emailQueue.count({ where: { status: 'sent' } }),
      scrapingClient.emailQueue.count({ where: { status: 'failed' } }),
    ]);

    const nextProcessing = new Date(Date.now() + this.SCHEDULER_INTERVAL);

    return {
      pending,
      sent,
      failed,
      nextProcessing,
    };
  }

  /**
   * Get all queued emails with details
   */
  async getAllQueuedEmails(status?: 'pending' | 'sent' | 'failed'): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const where: any = {};
    if (status) {
      where.status = status;
    }
    
    return await scrapingClient.emailQueue.findMany({
      where,
      include: {
        emailDraft: {
          include: {
            contact: {
              select: {
                id: true,
                businessName: true,
                email: true,
              },
            },
            clientEmail: {
              select: {
                id: true,
                emailAddress: true,
              },
            },
          },
        },
      },
      orderBy: [
        { priority: 'asc' },
        { scheduledAt: 'asc' },
        { createdAt: 'asc' },
      ],
    });
  }

  /**
   * Remove from queue
   */
  async removeFromQueue(draftId: number): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailQueue.delete({
      where: { emailDraftId: draftId },
    });
  }

  /**
   * Utility: Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

