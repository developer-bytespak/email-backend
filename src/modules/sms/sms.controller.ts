import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { SmsService } from './sms.service';

@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

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
