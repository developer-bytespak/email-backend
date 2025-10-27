import { Controller, Post, Body, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { EmailsService } from './emails.service';

export class SendEmailDraftDto {
  draftId: number;
}

export class CreateCampaignDto {
  name: string;
  description?: string;
  contactIds: number[];
  clientEmailId: number;
  tone?: 'friendly' | 'professional' | 'pro_friendly';
}

@Controller('emails')
export class EmailsController {
  constructor(private readonly emailsService: EmailsService) {}

  /**
   * Send an email draft
   */
  @Post('send-draft')
  async sendEmailDraft(@Body() sendEmailDraftDto: SendEmailDraftDto) {
    return this.emailsService.sendEmailDraft(sendEmailDraftDto.draftId);
  }

  /**
   * Create a campaign with AI-generated email drafts
   */
  @Post('campaign')
  async createCampaign(@Body() campaignData: CreateCampaignDto) {
    return this.emailsService.createCampaign(campaignData);
  }

  /**
   * Get available email templates
   */
  @Get('templates')
  async getTemplates() {
    return this.emailsService.getTemplates();
  }

  /**
   * Get campaign details
   */
  @Get('campaigns/:id')
  async getCampaign(@Param('id') id: string) {
    return this.emailsService.getCampaign(id);
  }

  /**
   * Get email analytics
   */
  @Get('analytics')
  async getEmailAnalytics(
    @Query('contactId', ParseIntPipe) contactId?: number,
    @Query('campaignId') campaignId?: string
  ) {
    return this.emailsService.getEmailAnalytics(contactId, campaignId);
  }
}
