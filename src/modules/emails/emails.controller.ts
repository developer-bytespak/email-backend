import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { EmailsService } from './emails.service';

@Controller('emails')
export class EmailsController {
  constructor(private readonly emailsService: EmailsService) {}

  @Post('send')
  async sendEmail(@Body() emailData: any) {
    return this.emailsService.sendEmail(emailData);
  }

  @Post('campaign')
  async createCampaign(@Body() campaignData: any) {
    return this.emailsService.createCampaign(campaignData);
  }

  @Get('templates')
  async getTemplates() {
    return this.emailsService.getTemplates();
  }

  @Get('campaigns/:id')
  async getCampaign(@Param('id') id: string) {
    return this.emailsService.getCampaign(id);
  }
}
