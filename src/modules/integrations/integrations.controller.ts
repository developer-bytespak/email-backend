import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post('webhook')
  async handleWebhook(@Body() webhookData: any) {
    return this.integrationsService.handleWebhook(webhookData);
  }

  @Get('webhooks')
  async getWebhooks() {
    return this.integrationsService.getWebhooks();
  }

  @Post('sync')
  async syncData(@Body() syncData: any) {
    return this.integrationsService.syncData(syncData);
  }
}
