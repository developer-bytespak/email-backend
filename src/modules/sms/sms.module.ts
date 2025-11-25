import { Module } from '@nestjs/common';
import { SmsController } from './sms.controller';
import { SmsService } from './sms.service';
import { TwilioService } from './twilio/twilio.service';
import { ConsoleSmsService } from './console/console-sms.service';
import { SmsGenerationModule } from './generation/sms-generation.module';
import { OtpService } from '../../common/services/otp.service';

@Module({
  imports: [SmsGenerationModule],
  controllers: [SmsController],
  providers: [SmsService, TwilioService, ConsoleSmsService, OtpService],
  exports: [SmsService],
})
export class SmsModule {}
