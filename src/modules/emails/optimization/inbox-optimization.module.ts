import { Module } from '@nestjs/common';
import { InboxOptimizationService } from './inbox-optimization.service';
import { InboxOptimizationController } from './inbox-optimization.controller';
import { PrismaModule } from '../../../config/prisma.module';
import { SummarizationModule } from '../../summarization/summarization.module';

@Module({
  imports: [PrismaModule, SummarizationModule],
  controllers: [InboxOptimizationController],
  providers: [InboxOptimizationService],
  exports: [InboxOptimizationService],
})
export class InboxOptimizationModule {}

