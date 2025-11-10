import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class SendGridSignatureGuard implements CanActivate {
  private readonly logger = new Logger(SendGridSignatureGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Get signature and timestamp from headers
    const signature = request.headers['x-twilio-email-event-webhook-signature'] as string;
    const timestamp = request.headers['x-twilio-email-event-webhook-timestamp'] as string;
    
    // Get verification key from environment
    const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    
    // Skip verification if no key configured (for testing/development)
    if (!verificationKey) {
      this.logger.warn('⚠️ SENDGRID_WEBHOOK_VERIFICATION_KEY not set - skipping signature verification');
      return true;
    }
    
    // Both signature and timestamp are required for verification
    if (!signature || !timestamp) {
      this.logger.error('Missing webhook signature or timestamp');
      throw new UnauthorizedException('Missing webhook signature or timestamp');
    }
    
    // Get raw body (Buffer from express.raw middleware)
    const rawBody = request.body as Buffer;
    if (!rawBody) {
      this.logger.error('Missing raw request body');
      throw new UnauthorizedException('Missing request body');
    }
    
    // Verify signature
    const isValid = this.verifySignature(rawBody, signature, timestamp, verificationKey);
    
    if (!isValid) {
      this.logger.error('Invalid webhook signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    
    // Parse JSON body for downstream handlers
    try {
      request.body = JSON.parse(rawBody.toString());
    } catch (error) {
      this.logger.error('Failed to parse webhook body as JSON');
      throw new UnauthorizedException('Invalid webhook payload');
    }
    
    this.logger.debug('✅ Webhook signature verified');
    return true;
  }
  
  private verifySignature(
    payload: Buffer,
    signature: string,
    timestamp: string,
    verificationKey: string
  ): boolean {
    try {
      // Convert public key from base64 to PEM format
      const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${verificationKey}\n-----END PUBLIC KEY-----`;
      
      // Create verifier
      const verifier = crypto.createVerify('sha256');
      
      // SendGrid signs: timestamp + payload
      verifier.update(timestamp);
      verifier.update(payload);
      
      // Verify signature
      const isValid = verifier.verify(publicKeyPem, signature, 'base64');
      
      return isValid;
    } catch (error) {
      this.logger.error('Signature verification error:', error);
      return false;
    }
  }
}

