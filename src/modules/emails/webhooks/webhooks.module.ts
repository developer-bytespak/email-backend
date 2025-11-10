import { Module } from '@nestjs/common';
import { SendGridWebhookController } from './sendgrid-webhook.controller';
import { BounceManagementService } from './bounce-management.service';
import { WebhookRouterService } from './services/webhook-router.service';
import { SendGridSignatureGuard } from './guards/sendgrid-signature.guard';
import { WebhookDeduplicationInterceptor } from './interceptors/webhook-deduplication.interceptor';
import { PrismaModule } from '../../../config/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SendGridWebhookController],
  providers: [
    BounceManagementService,
    WebhookRouterService,
    SendGridSignatureGuard,
    WebhookDeduplicationInterceptor,
  ],
  exports: [BounceManagementService, WebhookRouterService],
})
export class WebhooksModule {}

