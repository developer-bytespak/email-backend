import { Module } from '@nestjs/common';
import { EmailSchedulerService } from './email-scheduler.service';
import { EmailSchedulerController } from './email-scheduler.controller';
import { PrismaModule } from '../../../config/prisma.module';
import { SendGridModule } from '../delivery/sendgrid/sendgrid.module';
import { InboxOptimizationModule } from '../optimization/inbox-optimization.module';
import { UnsubscribeModule } from '../unsubscribe/unsubscribe.module';
import { EmailTrackingModule } from '../tracking/email-tracking.module';

@Module({
  imports: [
    PrismaModule,
    SendGridModule,
    InboxOptimizationModule,
    UnsubscribeModule,
    EmailTrackingModule,
  ],
  controllers: [EmailSchedulerController],
  providers: [EmailSchedulerService],
  exports: [EmailSchedulerService],
})
export class EmailSchedulerModule {}

