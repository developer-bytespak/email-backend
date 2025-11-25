import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import Twilio from 'twilio';
import { ConsoleSmsService } from '../console/console-sms.service';

type SendSmsInput = {
  to: string;
  body: string;
  statusCallback?: string;
};

type SendSmsResult = {
  sid: string;
  status?: string;
  to: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

@Injectable()
export class TwilioService {
  private readonly logger = new Logger(TwilioService.name);
  private readonly client: Twilio.Twilio | null;
  private readonly accountSid: string | undefined;
  private readonly authToken: string | undefined;
  private readonly useConsoleMode: boolean;

  constructor(
    @Optional() private readonly consoleSmsService?: ConsoleSmsService,
  ) {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    
    // Prioritize console mode if explicitly set
    // Otherwise, use console mode if credentials are missing
    const explicitConsoleMode = process.env.SMS_PROVIDER === 'console';
    const missingCredentials = !this.accountSid || !this.authToken;
    
    this.useConsoleMode = explicitConsoleMode || missingCredentials;

    if (this.useConsoleMode) {
      if (explicitConsoleMode) {
        this.logger.log('📱 Using Console SMS Service (SMS_PROVIDER=console set)');
      } else {
        this.logger.log('📱 Using Console SMS Service (Twilio credentials missing)');
      }
      this.client = null;
    } else {
      this.logger.log('✅ Twilio credentials loaded - using Twilio SMS Service');
      this.client = Twilio(this.accountSid || '', this.authToken || '');
    }
  }

  getFromIdentity(): { from?: string; messagingServiceSid?: string } {
    const from = process.env.TWILIO_FROM_NUMBER;
    const messagingServiceSid = process.env.MESSAGING_SERVICE_SID;

    if (messagingServiceSid) {
      this.logger.debug(`Using Messaging Service SID: ${messagingServiceSid}`);
      return { messagingServiceSid };
    }
    if (from) {
      this.logger.debug(`Using From Number: ${from}`);
      return { from };
    }
    
    this.logger.warn('⚠️ No Twilio sender configured (neither TWILIO_FROM_NUMBER nor MESSAGING_SERVICE_SID is set)');
    return {};
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    // Use console mode if configured or if credentials are missing
    if (this.useConsoleMode) {
      if (!this.consoleSmsService) {
        throw new BadRequestException('Console SMS service not available. Please configure Twilio credentials or add ConsoleSmsService to the module.');
      }
      return this.consoleSmsService.sendSms(input);
    }

    // Validate credentials
    if (!this.accountSid || !this.authToken) {
      throw new BadRequestException('Twilio credentials are not configured. Please set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.');
    }

    // Validate sender configuration
    const fromIdentity = this.getFromIdentity();
    if (!fromIdentity.from && !fromIdentity.messagingServiceSid) {
      throw new BadRequestException('Twilio sender is not configured. Please set either TWILIO_FROM_NUMBER or MESSAGING_SERVICE_SID environment variable.');
    }

    const testOverride = process.env.SMS_TEST_TO;
    const to = input.to || testOverride || '';

    if (!to) {
      throw new BadRequestException('Recipient phone number is required.');
    }

    if (!this.client) {
      throw new BadRequestException('Twilio client not initialized.');
    }

    try {
      this.logger.debug(`Sending SMS to ${to} via Twilio`);
      
      const message = await this.client.messages.create({
        ...fromIdentity,
        to,
        body: input.body,
        statusCallback: input.statusCallback,
      } as any);

      this.logger.log(`✅ SMS sent successfully. SID: ${message.sid}, Status: ${message.status}`);

      return {
        sid: message.sid,
        status: message.status,
        to: message.to,
        errorCode: (message as any).errorCode ?? null,
        errorMessage: (message as any).errorMessage ?? null,
      };
    } catch (error: any) {
      this.logger.error(`❌ Twilio SMS send failed: ${error.message || error}`);
      
      // Provide more specific error messages
      if (error.code === 20003 || error.message?.includes('authentication')) {
        throw new BadRequestException('Twilio authentication failed. Please check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
      }
      if (error.code === 21211 || error.message?.includes('Invalid') || error.message?.includes('phone number')) {
        throw new BadRequestException(`Invalid phone number format: ${to}. Please ensure the number is in E.164 format (e.g., +1234567890).`);
      }
      if (error.code === 21608 || error.message?.includes('from') || error.message?.includes('sender')) {
        throw new BadRequestException('Invalid Twilio sender configuration. Please check TWILIO_FROM_NUMBER or MESSAGING_SERVICE_SID.');
      }
      
      throw new BadRequestException(`Failed to send SMS: ${error.message || 'Unknown error'}`);
    }
  }
}


