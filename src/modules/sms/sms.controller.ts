import { Controller, Post, Body, Get, Param, ParseIntPipe, HttpException, HttpStatus } from '@nestjs/common';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * Generate SMS draft for a contact using their summary
   * POST /sms/generate/:contactId/:summaryId
   */
  @Post('generate/:contactId/:summaryId')
  async generateSmsDraft(
    @Param('contactId', ParseIntPipe) contactId: number,
    @Param('summaryId', ParseIntPipe) summaryId: number,
  ) {
    try {
      const result = await this.smsService.generateSmsDraft(contactId, summaryId);
      
      return {
        message: 'SMS draft generated successfully',
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'SMS generation failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get SMS drafts for a contact
   * GET /sms/drafts/:contactId
   */
  @Get('drafts/:contactId')
  async getSmsDrafts(@Param('contactId', ParseIntPipe) contactId: number) {
    try {
      const drafts = await this.smsService.getSmsDrafts(contactId);
      
      return {
        message: 'SMS drafts retrieved successfully',
        success: true,
        count: drafts.length,
        data: drafts,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve SMS drafts',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get a specific SMS draft
   * GET /sms/draft/:smsDraftId
   */
  @Get('draft/:smsDraftId')
  async getSmsDraft(@Param('smsDraftId', ParseIntPipe) smsDraftId: number) {
    try {
      const draft = await this.smsService.getSmsDraft(smsDraftId);
      
      return {
        message: 'SMS draft retrieved successfully',
        success: true,
        data: draft,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve SMS draft',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Legacy endpoints (keeping for backward compatibility)
  @Post('send')
  async sendSms(@Body() smsData: any) {
    return this.smsService.sendSms(smsData);
  }

  @Post('schedule')
  async scheduleSms(@Body() scheduleData: any) {
    return this.smsService.scheduleSms(scheduleData);
  }

  @Get('status/:id')
  async getSmsStatus(@Param('id') id: string) {
    return this.smsService.getSmsStatus(id);
  }
}
