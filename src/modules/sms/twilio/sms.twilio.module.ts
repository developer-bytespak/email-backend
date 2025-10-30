import { Module } from '@nestjs/common';
import { SmsTwilioController } from './sms.twilio.controller';
import { SmsModule } from '../sms.module';

@Module({
  imports: [SmsModule],
  controllers: [SmsTwilioController],
})
export class SmsTwilioModule {}


