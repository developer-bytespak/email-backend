import { Module } from '@nestjs/common';
import { SendGridWebhookController } from './sendgrid-webhook.controller';
import { BounceManagementService } from './bounce-management.service';
import { PrismaModule } from '../../../config/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SendGridWebhookController],
  providers: [BounceManagementService],
  exports: [BounceManagementService],
})
export class WebhooksModule {}

