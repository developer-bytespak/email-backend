import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { LlmClientService } from '../summarization/llm-client/llm-client.service';

@Module({
  controllers: [SmsController],
  providers: [SmsService, LlmClientService],
  exports: [SmsService],
})
export class SmsModule {}
