import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';

export interface SendGridWebhookEvent {
  email: string;
  timestamp: number | string; // SendGrid can send as ISO string or Unix timestamp
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
   * Parse timestamp from SendGrid webhook (handles both ISO string and Unix timestamp)
   */
  private parseTimestamp(timestamp: number | string): Date {
    if (typeof timestamp === 'string') {
      return new Date(timestamp);
    }
    // Unix timestamp in seconds, convert to milliseconds
    return new Date(timestamp * 1000);
  }

  /**
   * Process webhook event from SendGrid
   */
  async processWebhookEvent(event: SendGridWebhookEvent): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Log webhook event - using timestamp-based matching (like frontend)
    this.logger.debug(
      `📥 Webhook event received: ${event.event}, ` +
      `sg_message_id: ${event.sg_message_id}, ` +
      `email: ${event.email}, ` +
      `timestamp: ${this.parseTimestamp(event.timestamp).toISOString()}`
    );
    
    let emailLog: any = null;

    // PRIMARY STRATEGY: Match by sg_message_id (timestamp-based approach)
    // SendGrid always includes sg_message_id, making this the most reliable method
    if (event.sg_message_id) {
      // Try exact match first
      emailLog = await scrapingClient.emailLog.findUnique({
        where: { messageId: event.sg_message_id },
        include: { contact: true },
      });
      
      if (emailLog) {
        this.logger.debug(`✅ Matched EmailLog by exact messageId: ${event.sg_message_id}`);
      } else {
        // Try base messageId (extract part before first dot)
        // sg_message_id format: "baseId.recvd-..." or "baseId"
        const baseMessageId = event.sg_message_id.split('.')[0];
        if (baseMessageId !== event.sg_message_id) {
          emailLog = await scrapingClient.emailLog.findUnique({
            where: { messageId: baseMessageId },
            include: { contact: true },
          });
          
          if (emailLog) {
            this.logger.debug(`✅ Matched EmailLog by base messageId: ${baseMessageId}`);
          }
        }
      }
    }

    if (!emailLog) {
      this.logger.warn(
        `❌ EmailLog not found for webhook event. ` +
        `sg_message_id: ${event.sg_message_id}, ` +
        `email: ${event.email}, ` +
        `event: ${event.event}, ` +
        `timestamp: ${this.parseTimestamp(event.timestamp).toISOString()}`
      );
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
   * Uses timestamp-based logic (like frontend) - never downgrades status
   */
  private async handleProcessed(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const eventTimestamp = this.parseTimestamp(event.timestamp);
    const existingDeliveredAt = emailLog.deliveredAt ? new Date(emailLog.deliveredAt) : null;
    const existingProcessedAt = emailLog.processedAt ? new Date(emailLog.processedAt) : null;
    
    // TIMESTAMP-BASED LOGIC (like frontend): Never downgrade status
    // Rule: Only update status to 'processed' if current status is 'pending' or 'processed'
    // This ensures status only moves forward, never backward (like frontend event ordering)
    const shouldUpdateStatus = 
      emailLog.status === 'pending' || 
      emailLog.status === 'processed';
    
    // Enhanced logging for status transitions
    this.logger.debug(
      `📊 Processed event status check: EmailLog ID: ${emailLog.id}, ` +
      `Current status: ${emailLog.status}, ` +
      `Event timestamp: ${eventTimestamp.toISOString()}, ` +
      `Existing deliveredAt: ${existingDeliveredAt?.toISOString() || 'null'}, ` +
      `Existing processedAt: ${existingProcessedAt?.toISOString() || 'null'}, ` +
      `Should update status: ${shouldUpdateStatus}`
    );
    
    if (!shouldUpdateStatus) {
      this.logger.debug(
        `⏭️ Skipping status update for processed event (EmailLog ID: ${emailLog.id}, ` +
        `Current status: ${emailLog.status} - will not downgrade from delivered/bounced/etc)`
      );
    }
    
    // Build update data - always update processedAt (it's a timestamp, not status)
    const updateData: any = {
      processedAt: eventTimestamp,
      smtpId: event.smtp_id,
      templateId: event.template_id,
    };
    
    // Only update status if conditions are met (prevent downgrading from delivered)
    if (shouldUpdateStatus) {
      updateData.status = 'processed';
    }
    
    // Only store customArgs if present and not empty (avoid storing null/undefined)
    if (event.custom_args && Object.keys(event.custom_args).length > 0) {
      updateData.customArgs = event.custom_args;
    }
    // If no custom_args, don't include the field (Prisma will keep existing value)
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: updateData,
    });

    // Log the final status after update
    const updatedLog = await scrapingClient.emailLog.findUnique({
      where: { id: emailLog.id },
      select: { status: true },
    });
    
    this.logger.log(
      `✅ Email processed by SendGrid (EmailLog ID: ${emailLog.id}, ` +
      `Status: ${updatedLog?.status || 'unknown'}, ` +
      `ProcessedAt: ${this.parseTimestamp(event.timestamp).toISOString()})`
    );
  }

  /**
   * Handle deferred event - Temporary failure, will retry
   */
  private async handleDeferred(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Build update data
    const updateData: any = {
      status: 'deferred',
      deferredAt: this.parseTimestamp(event.timestamp),
      retryAttempt: event.attempt || 1,
    };
    
    // Only store customArgs if present and not empty (avoid storing null/undefined)
    if (event.custom_args && Object.keys(event.custom_args).length > 0) {
      updateData.customArgs = event.custom_args;
    }
    // If no custom_args, don't include the field (Prisma will keep existing value)
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: updateData,
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
          engagedAt: this.parseTimestamp(event.timestamp),
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
        engagedAt: this.parseTimestamp(event.timestamp),
      },
    });

    this.logger.log(`✅ Email click recorded from webhook (EmailLog ID: ${emailLog.id}, URL: ${event.url})`);
  }

  /**
   * Handle delivered event
   * Uses timestamp-based logic (like frontend) - always updates to delivered
   * This is the final delivery status and should never be downgraded
   */
  private async handleDelivered(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const eventTimestamp = this.parseTimestamp(event.timestamp);
    const existingDeliveredAt = emailLog.deliveredAt ? new Date(emailLog.deliveredAt) : null;
    const existingProcessedAt = emailLog.processedAt ? new Date(emailLog.processedAt) : null;
    
    // TIMESTAMP-BASED LOGIC (like frontend): Always update to 'delivered'
    // This is the final delivery status - never downgrade from this
    // Only update deliveredAt if this event is newer (handle duplicate webhooks)
    const shouldUpdateDeliveredAt = !existingDeliveredAt || eventTimestamp >= existingDeliveredAt;
    
    // Enhanced logging for status transitions
    this.logger.debug(
      `📊 Delivered event status check: EmailLog ID: ${emailLog.id}, ` +
      `Current status: ${emailLog.status}, ` +
      `Event timestamp: ${eventTimestamp.toISOString()}, ` +
      `Existing deliveredAt: ${existingDeliveredAt?.toISOString() || 'null'}, ` +
      `Existing processedAt: ${existingProcessedAt?.toISOString() || 'null'}, ` +
      `Will always set status to: delivered`
    );
    
    // Build update data
    const updateData: any = {
      status: 'delivered', // Always update to delivered (this is the final delivery status)
    };
    
    // Only update deliveredAt if this is a new or later delivery event
    if (shouldUpdateDeliveredAt) {
      updateData.deliveredAt = eventTimestamp;
    }
    
    // Only store customArgs if present and not empty (avoid storing null/undefined)
    if (event.custom_args && Object.keys(event.custom_args).length > 0) {
      updateData.customArgs = event.custom_args;
    }
    // If no custom_args, don't include the field (Prisma will keep existing value)
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: updateData,
    });

    // Log the final status after update
    const updatedLog = await scrapingClient.emailLog.findUnique({
      where: { id: emailLog.id },
      select: { status: true, deliveredAt: true, processedAt: true },
    });
    
    this.logger.log(
      `✅ Email delivered (EmailLog ID: ${emailLog.id}, ` +
      `Status: ${updatedLog?.status || 'unknown'}, ` +
      `DeliveredAt: ${updatedLog?.deliveredAt ? new Date(updatedLog.deliveredAt).toISOString() : 'null'}, ` +
      `ProcessedAt: ${updatedLog?.processedAt ? new Date(updatedLog.processedAt).toISOString() : 'null'})`
    );
  }

  /**
   * Handle bounce event
   */
  private async handleBounce(event: SendGridWebhookEvent, emailLog: any): Promise<void> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Classify bounce type
    const bounceType = this.classifyBounceType(event.bounce_classification);
    
    // Store bounce details in providerResponse
    const existingResponse = (emailLog.providerResponse as any) || {};
    const bounceDetails = {
      type: bounceType, // 'hard' or 'soft'
      classification: event.bounce_classification || 'unknown',
      reason: event.reason || null,
      timestamp: this.parseTimestamp(event.timestamp).toISOString(),
    };
    
    await scrapingClient.emailLog.update({
      where: { id: emailLog.id },
      data: {
        status: 'bounced', // Same status for both hard and soft
        providerResponse: {
          ...existingResponse,
          bounce: bounceDetails,
        },
      },
    });

    // Hard bounces: Update contact status (permanent failure - remove from future sends)
    if (bounceType === 'hard') {
      await scrapingClient.contact.update({
        where: { id: emailLog.contactId },
        data: { status: 'bounced' },
      });

      this.logger.warn(
        `⚠️ Hard bounce detected (EmailLog ID: ${emailLog.id}, ` +
        `Contact ID: ${emailLog.contactId}, ` +
        `Classification: ${event.bounce_classification}, ` +
        `Reason: ${event.reason || 'N/A'})`
      );
    } else {
      // Soft bounces: Log but don't mark contact as bounced (may retry later)
      this.logger.warn(
        `⏸️ Soft bounce detected (EmailLog ID: ${emailLog.id}, ` +
        `Classification: ${event.bounce_classification}, ` +
        `Reason: ${event.reason || 'N/A'})`
      );
    }

    this.logger.log(
      `✅ Bounce processed (EmailLog ID: ${emailLog.id}, Type: ${bounceType}, Classification: ${event.bounce_classification})`
    );
  }

  /**
   * Classify bounce as hard or soft based on SendGrid's bounce_classification
   */
  private classifyBounceType(classification?: string): 'hard' | 'soft' {
    if (!classification) {
      return 'hard'; // Default to hard if unknown (fail-safe)
    }

    // Hard bounce classifications (permanent failures - remove from list)
    const hardBounceCodes = ['1', '10', '11', '13'];
    
    if (hardBounceCodes.includes(classification)) {
      return 'hard';
    }

    // Soft bounce classifications (temporary failures - may retry)
    // Codes: 2, 3, 4, 5, 6, 7, 8, 9
    return 'soft';
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
          unsubscribedAt: this.parseTimestamp(event.timestamp),
        },
      });

      this.logger.log(`✅ Unsubscribe recorded from webhook (Contact ID: ${emailLog.contactId})`);
    }
  }

  /**
   * Get bounce statistics for a client (with hard/soft breakdown)
   */
  async getBounceStats(clientId: number): Promise<{
    total: number;
    bounced: number;
    hardBounces: number;
    softBounces: number;
    blocked: number;
    dropped: number;
    spamreport: number;
    bounceRate: number;
    hardBounceRate: number;
    softBounceRate: number;
  }> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const emailLogs = await scrapingClient.emailLog.findMany({
      where: {
        clientId,
      },
      select: {
        status: true,
        providerResponse: true,
      },
    });

    const total = emailLogs.length;
    const bounced = emailLogs.filter(log => log.status === 'bounced').length;
    
    // Count hard vs soft bounces from providerResponse
    let hardBounces = 0;
    let softBounces = 0;
    
    emailLogs.forEach(log => {
      if (log.status === 'bounced' && log.providerResponse) {
        const bounceData = (log.providerResponse as any)?.bounce;
        if (bounceData?.type === 'hard') {
          hardBounces++;
        } else if (bounceData?.type === 'soft') {
          softBounces++;
        }
      }
    });
    
    const blocked = emailLogs.filter(log => log.status === 'blocked').length;
    const dropped = emailLogs.filter(log => log.status === 'dropped').length;
    const spamreport = emailLogs.filter(log => log.status === 'spamreport').length;

    return {
      total,
      bounced,
      hardBounces,
      softBounces,
      blocked,
      dropped,
      spamreport,
      bounceRate: total > 0 ? (bounced / total) * 100 : 0,
      hardBounceRate: total > 0 ? (hardBounces / total) * 100 : 0,
      softBounceRate: total > 0 ? (softBounces / total) * 100 : 0,
    };
  }
}

