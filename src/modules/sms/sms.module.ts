import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { LlmClientService } from '../summarization/llm-client/llm-client.service';
import { TwilioService } from './twilio/twilio.service';

@Module({
  controllers: [SmsController],
  providers: [SmsService, LlmClientService, TwilioService],
  exports: [SmsService],
})
export class SmsModule {}
