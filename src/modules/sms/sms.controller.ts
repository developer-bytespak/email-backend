import { Controller, Post, Body, HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { IsNumber } from 'class-validator';
import { SmsService } from './sms.service';

export class SendSmsDraftDto {
  @IsNumber()
  draftId: number;
}

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * Send an SMS draft
   * POST /sms/send-draft
   * Body: { draftId: number }
   */
  @Post('send-draft')
  async sendDraft(@Body(ValidationPipe) sendDto: SendSmsDraftDto) {
    try {
      const result = await this.smsService.sendDraft(sendDto.draftId);
      return {
        message: 'SMS send initiated',
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to send SMS draft',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get SMS status for multiple contacts
   * POST /sms/bulk-status
   */
  @Post('bulk-status')
  async getBulkStatus(@Body() body: { contactIds: number[] }) {
    try {
      const result = await this.smsService.getBulkStatus(body.contactIds);
      return {
        message: 'SMS status retrieved successfully',
        success: true,
        count: result.data.length,
        data: result.data,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve SMS status',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
