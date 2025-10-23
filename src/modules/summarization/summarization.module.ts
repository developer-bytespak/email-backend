import { Module } from '@nestjs/common';
import { SummarizationService } from './summarization.service';
import { SummarizationController } from './summarization.controller';
import { LlmClientService } from './llm-client/llm-client.service';

@Module({
  controllers: [SummarizationController],
  providers: [SummarizationService, LlmClientService],
  exports: [SummarizationService, LlmClientService],
})
export class SummarizationModule {}
