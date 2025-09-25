import { Module } from '@nestjs/common';
import { SummarizationService } from './summarization.service';

@Module({
  providers: [SummarizationService],
  exports: [SummarizationService],
})
export class SummarizationModule {}
