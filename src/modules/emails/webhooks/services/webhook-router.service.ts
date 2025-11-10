import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SendGridWebhookEvent } from '../bounce-management.service';

interface WebhookHandler {
  name: string;
  handle: (events: SendGridWebhookEvent[]) => Promise<void>;
  priority?: number; // Lower = higher priority
}

@Injectable()
export class WebhookRouterService {
  private readonly logger = new Logger(WebhookRouterService.name);
  private readonly handlers: WebhookHandler[] = [];
  private readonly secondaryWebhookUrls: string[] = [];

  constructor() {
    // Load secondary webhook URLs from environment
    const urls = process.env.SENDGRID_SECONDARY_WEBHOOK_URLS;
    if (urls) {
      this.secondaryWebhookUrls = urls.split(',').map(url => url.trim()).filter(Boolean);
    }
  }

  /**
   * Register a webhook handler
   */
  registerHandler(handler: WebhookHandler): void {
    this.handlers.push(handler);
    this.handlers.sort((a, b) => (a.priority || 100) - (b.priority || 100));
    this.logger.log(`Registered webhook handler: ${handler.name}`);
  }

  /**
   * Route webhook events to all registered handlers
   * Primary handler (BounceManagementService) is called synchronously
   * Secondary handlers are called asynchronously
   */
  async routeWebhookEvents(events: SendGridWebhookEvent[]): Promise<void> {
    // Route to registered handlers (async, fire-and-forget)
    for (const handler of this.handlers) {
      handler.handle(events).catch(error => {
        this.logger.error(`Error in handler ${handler.name}:`, error);
      });
    }

    // Forward to external webhook URLs (async, fire-and-forget)
    if (this.secondaryWebhookUrls.length > 0) {
      this.forwardToExternalWebhooks(events).catch(error => {
        this.logger.error('Error forwarding to external webhooks:', error);
      });
    }
  }

  private async forwardToExternalWebhooks(events: SendGridWebhookEvent[]): Promise<void> {
    for (const url of this.secondaryWebhookUrls) {
      try {
        await axios.post(url, events, {
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-From': 'sendgrid-primary-webhook',
            'X-Event-Count': events.length.toString(),
          },
          timeout: 5000, // 5 second timeout
        });
        
        this.logger.debug(`✅ Forwarded ${events.length} events to ${url}`);
      } catch (error: any) {
        this.logger.warn(`⚠️ Failed to forward to ${url}:`, error.message);
        // Don't throw - continue with other webhooks
      }
    }
  }

  /**
   * Get routing statistics
   */
  getRoutingStats(): {
    registeredHandlers: number;
    externalWebhooks: number;
    handlerNames: string[];
  } {
    return {
      registeredHandlers: this.handlers.length,
      externalWebhooks: this.secondaryWebhookUrls.length,
      handlerNames: this.handlers.map(h => h.name),
    };
  }
}

