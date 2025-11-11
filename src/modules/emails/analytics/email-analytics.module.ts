import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../config/prisma.module';
import { EmailAnalyticsController } from './email-analytics.controller';
import { EmailAnalyticsService } from './email-analytics.service';

@Module({
  imports: [PrismaModule],
  controllers: [EmailAnalyticsController],
  providers: [EmailAnalyticsService],
  exports: [EmailAnalyticsService],
})
export class EmailAnalyticsModule {}


