import { Controller, Post, Param, ParseIntPipe, Body, HttpException, HttpStatus } from '@nestjs/common';
import { SmsService } from '../sms.service';

@Controller('sms')
export class SmsTwilioController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * Send an existing SMS draft via Twilio (optional body: { to?: string })
   */
  @Post('send-draft/:smsDraftId')
  async sendDraft(
    @Param('smsDraftId', ParseIntPipe) smsDraftId: number,
    @Body('to') to?: string,
  ) {
    try {
      const result = await this.smsService.sendDraft(smsDraftId, to);
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
}


