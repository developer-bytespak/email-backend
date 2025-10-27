import { Module } from '@nestjs/common';
import { EmailGenerationController } from './email-generation.controller';
import { EmailGenerationService } from './email-generation.service';
import { PrismaModule } from '../../../config/prisma.module';
import { LlmClientService } from '../../summarization/llm-client/llm-client.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmailGenerationController],
  providers: [EmailGenerationService, LlmClientService],
  exports: [EmailGenerationService],
})
export class EmailGenerationModule {}
