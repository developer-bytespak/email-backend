import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';

export interface SendGridWebhookEvent {
  email: string;
  timestamp: number;
  event: string;
  sg_message_id?: string;
  sg_event_id?: string;
  reason?: string;
  status?: string;
  url?: string;
  asm_group_id?: number;
  bounce_classification?: string;
  type?: string;
  category?: string[];
  // Additional fields for processed/deferred events
  attempt?: number;        // Retry attempt number (for deferred)
  response?: string;      // SMTP response message
  smtp_id?: string;       // SMTP transaction ID
  useragent?: string;     // User agent (for opens)
  ip?: string;            // IP address (for opens/clicks)
  drop_reason?: string;   // Reason for dropped emails
  template_id?: string;  // SendGrid template ID
  custom_args?: Record<string, string>; // Custom arguments
}

@Injectable()
export class BounceManagementService {
  private readonly logger = new Logger(BounceManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Process webhook event from SendGrid
   */
  async processWebhookEvent(event: SendGridWebhookEvent): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Find EmailLog by messageId
    if (!event.sg_message_id) {
      this.logger.warn('Webhook event missing sg_message_id:', event);
      return;
    }

    const emailLog = await scrapingClient.emailLog.findUnique({
      where: { messageId: event.sg_message_id },
      include: {
        contact: true,
      },
    });

    if (!emailLog) {
      this.logger.warn(`EmailLog not found for messageId: ${event.sg_message_id}`);
      return;
    }

    // Route to appropriate handler based on event type
    switch (event.event) {
      case 'processed':
        await this.handleProcessed(event, emailLog);
        break;
      case 'deferred':
        await this.handleDeferred(event, emailLog);
        break;
      case 'open':
        await this.handleOpen(event, emailLog);
        break;
      case 'click':
        await this.handleClick(event, emailLog);
        break;
      case 'delivered':
        await this.handleDelivered(event, emailLog);
        break;
      case 'bounce':
        await this.handleBounce(event, emailLog);
        break;
      case 'blocked':
        await this.handleBlocked(event, emailLog);
        break;
      case 'dropped':
        await this.handleDropped(event, emailLog);
        break;
      case 'spamreport':
        await this.handleSpamReport(event, emailLog);
        break;
      case 'unsubscribe':
        await this.handleUnsubscribe(event, emailLog);
        break;
      default:
        this.logger.debug(`Unhandled webhook event type: ${event.event}`);
    }
  }

  /**
   * Handle processed event - SendGrid accepted and queued the email
   */
  private async handleProcessed(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'processed',
        processedAt: new Date(event.timestamp * 1000),
        smtpId: event.smtp_id,
        templateId: event.template_id,
        customArgs: event.custom_args ? JSON.parse(JSON.stringify(event.custom_args)) : null,
      },
    });

    this.logger.log(`✅ Email processed by SendGrid (EmailLog ID: ${emailLog.id})`);
  }

  /**
   * Handle deferred event - Temporary failure, will retry
   */
  private async handleDeferred(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'deferred',
        deferredAt: new Date(event.timestamp * 1000),
        retryAttempt: event.attempt || 1,
      },
    });

    this.logger.warn(
      `⏸️ Email deferred (EmailLog ID: ${emailLog.id}, Attempt: ${event.attempt || 1}, Response: ${event.response || 'N/A'})`
    );
  }

  /**
   * Handle open event
   */
  private async handleOpen(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Check if already recorded
    const existing = await scrapingClient.emailEngagement.findFirst({
      where: {
        emailLogId: emailLog.id,
        engagementType: 'open',
        // Could add timestamp check to avoid exact duplicates
      },
    });

    if (!existing) {
      await scrapingClient.emailEngagement.create({
        data: {
          emailLogId: emailLog.id,
          contactId: emailLog.contactId,
          engagementType: 'open',
          engagedAt: new Date(event.timestamp * 1000), // Convert Unix timestamp
        },
      });

      this.logger.log(`✅ Email open recorded from webhook (EmailLog ID: ${emailLog.id})`);
    }
  }

  /**
   * Handle click event
   */
  private async handleClick(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    if (!event.url) {
      return;
    }

    await scrapingClient.emailEngagement.create({
      data: {
        emailLogId: emailLog.id,
        contactId: emailLog.contactId,
        engagementType: 'click',
        url: event.url,
        engagedAt: new Date(event.timestamp * 1000),
      },
    });

    this.logger.log(`✅ Email click recorded from webhook (EmailLog ID: ${emailLog.id}, URL: ${event.url})`);
  }

  /**
   * Handle delivered event
   */
  private async handleDelivered(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'delivered',
        deliveredAt: new Date(event.timestamp * 1000),
      },
    });

    this.logger.log(`✅ Email delivered (EmailLog ID: ${emailLog.id})`);
  }

  /**
   * Handle bounce event
   */
  private async handleBounce(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'bounced',
      },
    });

    // Check if hard bounce
    const isHardBounce = event.bounce_classification === '1' || // Invalid address
                         event.bounce_classification === '10' || // Blocked
                         event.type === 'bounce';

    if (isHardBounce) {
      // Update contact status
      await scrapingClient.contact.update({
        where: { id: emailLog.contactId },
        data: { status: 'bounced' },
      });

      this.logger.warn(`⚠️ Hard bounce detected (EmailLog ID: ${emailLog.id}, Contact ID: ${emailLog.contactId})`);
    }

    this.logger.log(`✅ Bounce processed (EmailLog ID: ${emailLog.id}, Type: ${event.type})`);
  }

  /**
   * Handle blocked event
   */
  private async handleBlocked(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'blocked',
      },
    });

    this.logger.log(`✅ Email blocked (EmailLog ID: ${emailLog.id})`);
  }

  /**
   * Handle dropped event
   */
  private async handleDropped(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'dropped',
      },
    });

    this.logger.log(`✅ Email dropped (EmailLog ID: ${emailLog.id})`);
  }

  /**
   * Handle spam report event
   */
  private async handleSpamReport(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'spamreport',
      },
    });

    this.logger.warn(`⚠️ Spam report received (EmailLog ID: ${emailLog.id})`);
  }

  /**
   * Handle unsubscribe event
   */
  private async handleUnsubscribe(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Check if already unsubscribed
    const existing = await scrapingClient.emailUnsubscribe.findUnique({
      where: { contactId: emailLog.contactId },
    });

    if (!existing) {
      await scrapingClient.emailUnsubscribe.create({
        data: {
          contactId: emailLog.contactId,
          unsubscribeEmailLogId: emailLog.id,
          unsubscribedAt: new Date(event.timestamp * 1000),
        },
      });

      this.logger.log(`✅ Unsubscribe recorded from webhook (Contact ID: ${emailLog.contactId})`);
    }
  }

  /**
   * Get bounce statistics for a client
   */
  async getBounceStats(clientId: number): Promise<{
    total: number;
    bounced: number;
    blocked: number;
    dropped: number;
    spamreport: number;
    bounceRate: number;
  }> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const emailLogs = await scrapingClient.emailLog.findMany({
      where: {
        clientId,
      },
      select: {
        status: true,
      },
    });

    const total = emailLogs.length;
    const bounced = emailLogs.filter(log => log.status === 'bounced').length;
    const blocked = emailLogs.filter(log => log.status === 'blocked').length;
    const dropped = emailLogs.filter(log => log.status === 'dropped').length;
    const spamreport = emailLogs.filter(log => log.status === 'spamreport').length;

    return {
      total,
      bounced,
      blocked,
      dropped,
      spamreport,
      bounceRate: total > 0 ? (bounced / total) * 100 : 0,
    };
  }
}

