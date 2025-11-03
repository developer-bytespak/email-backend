import { Controller, Post, Body, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, IsArray, IsIn } from 'class-validator';
import { EmailsService } from './emails.service';

export class SendEmailDraftDto {
  @IsNumber()
  draftId: number;
}

export class CreateCampaignDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsNumber({}, { each: true })
  contactIds: number[];

  @IsNumber()
  clientEmailId: number;

  @IsOptional()
  @IsIn(['friendly', 'professional', 'pro_friendly'])
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
   * Get available email templates
   */
  @Get('templates')
  async getTemplates() {
    return this.emailsService.getTemplates();
  }

  // COMMENTED OUT - Campaign management deferred to Phase 2
  // /**
  //  * Create a campaign with AI-generated email drafts
  //  */
  // @Post('campaign')
  // async createCampaign(@Body() campaignData: CreateCampaignDto) {
  //   return this.emailsService.createCampaign(campaignData);
  // }

  // /**
  //  * Get campaign details
  //  */
  // @Get('campaigns/:id')
  // async getCampaign(@Param('id') id: string) {
  //   return this.emailsService.getCampaign(id);
  // }

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
