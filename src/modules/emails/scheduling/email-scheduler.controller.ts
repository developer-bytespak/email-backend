import { Controller, Post, Body, Get, Delete, Param, ParseIntPipe } from '@nestjs/common';
import { IsNumber, IsDateString } from 'class-validator';
import { EmailSchedulerService } from './email-scheduler.service';

export class ScheduleEmailDto {
  @IsNumber()
  draftId: number;

  @IsDateString()
  scheduledAt: string; // ISO date string
}

@Controller('emails/schedule')
export class EmailSchedulerController {
  constructor(private readonly schedulerService: EmailSchedulerService) {}

  /**
   * Schedule email for later
   * POST /emails/schedule
   */
  @Post()
  async scheduleEmail(@Body() scheduleDto: ScheduleEmailDto) {
    const scheduledAt = new Date(scheduleDto.scheduledAt);
    const result = await this.schedulerService.scheduleEmail(scheduleDto.draftId, scheduledAt);
    
    return {
      success: true,
      message: 'Email scheduled successfully',
      data: result,
    };
  }

  /**
   * Get queue status
   * GET /emails/queue/status
   */
  @Get('queue/status')
  async getQueueStatus() {
    const status = await this.schedulerService.getQueueStatus();
    
    return {
      success: true,
      message: 'Queue status retrieved',
      data: status,
    };
  }

  /**
   * Remove from queue
   * DELETE /emails/schedule/queue/:draftId
   */
  @Delete('queue/:draftId')
  async removeFromQueue(@Param('draftId', ParseIntPipe) draftId: number) {
    await this.schedulerService.removeFromQueue(draftId);
    
    return {
      success: true,
      message: 'Email removed from queue',
    };
  }
}

