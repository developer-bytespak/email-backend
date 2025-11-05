import { Controller, Post, Body, Get, Param, Query, ParseIntPipe, HttpException, HttpStatus } from '@nestjs/common';
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
   * Get all email drafts from database
   */
  @Get('drafts')
  async getAllEmailDrafts() {
    try {
      const drafts = await this.emailsService.getAllEmailDrafts();
      
      return {
        message: 'All email drafts retrieved successfully',
        success: true,
        count: drafts.length,
        data: drafts,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve email drafts',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
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
