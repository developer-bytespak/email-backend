import { 
  Controller, 
  Post, 
  Body, 
  Get, 
  Param, 
  ParseIntPipe,
  UseGuards,
  UseInterceptors,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { BounceManagementService, SendGridWebhookEvent } from './bounce-management.service';
import { SendGridSignatureGuard } from './guards/sendgrid-signature.guard';
import { WebhookDeduplicationInterceptor } from './interceptors/webhook-deduplication.interceptor';
import { WebhookRouterService } from './services/webhook-router.service';

@Controller('emails/webhooks')
export class SendGridWebhookController {
  constructor(
    private readonly bounceManagementService: BounceManagementService,
    private readonly webhookRouter: WebhookRouterService,
  ) {}

  /**
   * Receive SendGrid webhook events
   * POST /emails/webhooks/sendgrid
   * 
   * Middleware chain:
   * 1. Raw body parser (in main.ts) - Preserves raw body for signature verification
   * 2. SendGridSignatureGuard - Verifies webhook signature
   * 3. WebhookDeduplicationInterceptor - Removes duplicate events
   * 4. Primary handler - BounceManagementService (synchronous)
   * 5. Secondary routing - WebhookRouterService (asynchronous)
   */
  @UseGuards(SendGridSignatureGuard)
  @UseInterceptors(WebhookDeduplicationInterceptor)
  @Post('sendgrid')
  async handleWebhook(
    @Body() body: SendGridWebhookEvent | SendGridWebhookEvent[],
    @Req() request: Request,
  ) {
    // Body is already parsed by SendGridSignatureGuard after verification
    // Body is already deduplicated by WebhookDeduplicationInterceptor
    const events = Array.isArray(body) ? body : [body];

    const startTime = Date.now();

    // Process each event with primary handler (synchronous)
    let processedCount = 0;
    let errorCount = 0;

    for (const event of events) {
      try {
        await this.bounceManagementService.processWebhookEvent(event);
        processedCount++;
      } catch (error) {
        errorCount++;
        console.error(`Error processing webhook event ${event.sg_event_id}:`, error);
        // Continue processing other events even if one fails
      }
    }

    // Route to secondary handlers and external webhooks (asynchronous, fire-and-forget)
    this.webhookRouter.routeWebhookEvents(events).catch(error => {
      console.error('Error routing to secondary webhooks:', error);
    });

    const processingTime = Date.now() - startTime;

    // SendGrid expects 200 response quickly (within 5 seconds)
    return { 
      success: true, 
      processed: processedCount,
      errors: errorCount,
      total: events.length,
      processingTimeMs: processingTime,
    };
  }

  // COMMENTED OUT: Signature verification moved to SendGridSignatureGuard
  // /**
  //  * Verify SendGrid webhook signature (ECDSA)
  //  * Note: SendGrid uses ECDSA signature verification
  //  */
  // private verifySignature(payload: string, signature: string, timestamp: string): boolean {
  //   try {
  //     const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  //     if (!verificationKey) {
  //       // If no key, skip verification (for testing)
  //       return true;
  //     }

  //     // Convert public key from base64 to PEM format
  //     const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${verificationKey}\n-----END PUBLIC KEY-----`;
      
  //     // Create verifier
  //     const verifier = crypto.createVerify('sha256');
  //     verifier.update(timestamp + payload);
      
  //     // Verify signature
  //     const isValid = verifier.verify(publicKeyPem, signature, 'base64');
      
  //     return isValid;
  //   } catch (error) {
  //     console.error('Signature verification error:', error);
  //     return false; // Fail secure
  //   }
  // }

  /**
   * Get bounce statistics
   * GET /emails/webhooks/bounces/:clientId
   */
  @Get('bounces/:clientId')
  async getBounceStats(@Param('clientId', ParseIntPipe) clientId: number) {
    const stats = await this.bounceManagementService.getBounceStats(clientId);
    
    return {
      success: true,
      message: 'Bounce statistics retrieved',
      data: stats,
    };
  }

  /**
   * Get webhook routing statistics
   * GET /emails/webhooks/routing/stats
   */
  @Get('routing/stats')
  async getRoutingStats() {
    return {
      success: true,
      data: this.webhookRouter.getRoutingStats(),
    };
  }
}

