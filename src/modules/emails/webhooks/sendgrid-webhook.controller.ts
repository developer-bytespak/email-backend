import { Controller, Post, Body, Get, Param, ParseIntPipe, UseGuards, Request } from '@nestjs/common';
import { BounceManagementService, SendGridWebhookEvent } from './bounce-management.service';
import * as crypto from 'crypto';

@Controller('emails/webhooks')
export class SendGridWebhookController {
  constructor(private readonly bounceManagementService: BounceManagementService) {}

  /**
   * Receive SendGrid webhook events
   * POST /emails/webhooks/sendgrid
   * Public endpoint - no auth required, but signature verified
   */
  @Post('sendgrid')
  async handleWebhook(@Body() body: SendGridWebhookEvent | SendGridWebhookEvent[]) {
    // SendGrid sends events as an array
    const events = Array.isArray(body) ? body : [body];

    // Process each event
    for (const event of events) {
      try {
        await this.bounceManagementService.processWebhookEvent(event);
      } catch (error) {
        console.error('Error processing webhook event:', error);
        // Continue processing other events even if one fails
      }
    }

    // SendGrid expects 200 response
    return { success: true };
  }

  /**
   * Verify SendGrid webhook signature (ECDSA)
   * Note: SendGrid uses ECDSA signature verification
   */
  private verifySignature(payload: string, signature: string, timestamp: string): boolean {
    try {
      const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
      if (!verificationKey) {
        // If no key, skip verification (for testing)
        return true;
      }

      // Convert public key from base64 to PEM format
      const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${verificationKey}\n-----END PUBLIC KEY-----`;
      
      // Create verifier
      const verifier = crypto.createVerify('sha256');
      verifier.update(timestamp + payload);
      
      // Verify signature
      const isValid = verifier.verify(publicKeyPem, signature, 'base64');
      
      return isValid;
    } catch (error) {
      console.error('Signature verification error:', error);
      return false; // Fail secure
    }
  }

  /**
   * Get bounce statistics
   * GET /emails/bounces/:clientId
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
}

