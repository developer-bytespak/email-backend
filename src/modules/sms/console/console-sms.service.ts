import { Injectable, Logger } from '@nestjs/common';

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
export class ConsoleSmsService {
  private readonly logger = new Logger(ConsoleSmsService.name);

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const sid = `console_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Extract OTP code from message body
    const otpMatch = input.body.match(/\d{4,10}/);
    const otpCode = otpMatch ? otpMatch[0] : 'N/A';

    // Log to console with clear formatting
    this.logger.log('\n' + '='.repeat(80));
    this.logger.log('📱 SMS MESSAGE (Console Mode - Not Actually Sent)');
    this.logger.log('='.repeat(80));
    this.logger.log(`To: ${input.to}`);
    this.logger.log(`Message: ${input.body}`);
    this.logger.log(`Message SID: ${sid}`);
    this.logger.log('='.repeat(80));
    this.logger.log(`\n📱 SMS OTP (Copy this code):`);
    this.logger.log(`   ${otpCode}\n`);

    return {
      sid,
      status: 'sent',
      to: input.to,
      errorCode: null,
      errorMessage: null,
    };
  }
}

