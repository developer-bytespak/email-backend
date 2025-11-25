import { Module } from '@nestjs/common';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';
import { EmailGenerationModule } from './generation/email-generation.module';
import { SendGridModule } from './delivery/sendgrid/sendgrid.module';
import { InboxOptimizationModule } from './optimization/inbox-optimization.module';
import { UnsubscribeModule } from './unsubscribe/unsubscribe.module';
import { EmailTrackingModule } from './tracking/email-tracking.module';
import { EmailSchedulerModule } from './scheduling/email-scheduler.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { EmailAnalyticsModule } from './analytics/email-analytics.module';
import { QueueRealtimeModule } from './realtime/queue-realtime.module';
import { ValidationModule } from '../validation/validation.module';
import { OtpService } from '../../common/services/otp.service';

@Module({
  imports: [
    EmailGenerationModule,
    SendGridModule,
    InboxOptimizationModule,
    UnsubscribeModule,
    EmailTrackingModule,
    EmailSchedulerModule,
    WebhooksModule,
    EmailAnalyticsModule,
    QueueRealtimeModule,
    ValidationModule,
  ],
  controllers: [EmailsController],
  providers: [EmailsService, OtpService],
  exports: [EmailsService],
})
export class EmailsModule {}
