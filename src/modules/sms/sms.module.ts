import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { TwilioService } from './twilio/twilio.service';
import { SmsGenerationModule } from './generation/sms-generation.module';

@Module({
  imports: [SmsGenerationModule],
  controllers: [SmsController],
  providers: [SmsService, TwilioService],
  exports: [SmsService],
})
export class SmsModule {}
