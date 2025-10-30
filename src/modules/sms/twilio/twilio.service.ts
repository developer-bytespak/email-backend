import { Injectable, Logger } from '@nestjs/common';
import Twilio from 'twilio';

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
  private readonly client: Twilio.Twilio;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      this.logger.warn('Twilio credentials are not set.');
    }

    this.client = Twilio(accountSid || '', authToken || '');
  }

  getFromIdentity(): { from?: string; messagingServiceSid?: string } {
    const from = process.env.TWILIO_FROM_NUMBER;
    const messagingServiceSid = process.env.MESSAGING_SERVICE_SID;

    if (messagingServiceSid) return { messagingServiceSid };
    if (from) return { from };
    return {};
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const testOverride = process.env.SMS_TEST_TO;
    const to = input.to || testOverride || '';

    const fromIdentity = this.getFromIdentity();

    const message = await this.client.messages.create({
      ...fromIdentity,
      to,
      body: input.body,
      statusCallback: input.statusCallback,
    } as any);

    return {
      sid: message.sid,
      status: message.status,
      to: message.to,
      errorCode: (message as any).errorCode ?? null,
      errorMessage: (message as any).errorMessage ?? null,
    };
  }
}


