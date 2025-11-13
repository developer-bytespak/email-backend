import { Module } from '@nestjs/common';
import { SmsGenerationController } from './sms-generation.controller';
import { SmsGenerationService } from './sms-generation.service';
import { PrismaModule } from '../../../config/prisma.module';
import { LlmClientService } from '../../summarization/llm-client/llm-client.service';

@Module({
  imports: [PrismaModule],
  controllers: [SmsGenerationController],
  providers: [SmsGenerationService, LlmClientService],
  exports: [SmsGenerationService],
})
export class SmsGenerationModule {}

