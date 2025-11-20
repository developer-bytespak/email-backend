import { Controller, Post, Body, Get, Delete, Param, ParseIntPipe, Query } from '@nestjs/common';
import { IsNumber, IsDateString, IsArray, IsOptional, ValidateNested, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { EmailSchedulerService } from './email-scheduler.service';

export class ScheduleEmailDto {
  @IsNumber()
  draftId: number;

  @IsDateString()
  scheduledAt: string; // ISO date string
}

export class ScheduleBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsNumber({}, { each: true })
  draftIds: number[];

  @IsDateString()
  startTime: string; // ISO date string - when to start sending

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  clientEmailIds?: number[]; // Optional: which mailboxes to use
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
   * Schedule multiple emails with mailbox selection and proportional distribution
   * POST /emails/schedule/batch
   */
  @Post('batch')
  async scheduleBatch(@Body() batchDto: ScheduleBatchDto) {
    const startTime = new Date(batchDto.startTime);
    const results = await this.schedulerService.scheduleBatch(
      batchDto.draftIds,
      startTime,
      batchDto.clientEmailIds // Pass selected mailboxes (or undefined to use existing)
    );
    
    return {
      success: true,
      message: `${batchDto.draftIds.length} emails scheduled successfully`,
      count: results.length,
      mailboxesUsed: batchDto.clientEmailIds?.length || 'existing',
      data: results,
    };
  }

  /**
   * Get queue status
   * GET /emails/schedule/queue/status
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
   * Get all queued emails
   * GET /emails/schedule/queue
   * Optional query param: ?status=pending|sent|failed
   */
  @Get('queue')
  async getAllQueuedEmails(@Query('status') status?: string) {
    const validStatus = status && ['pending', 'sent', 'failed'].includes(status) 
      ? status as 'pending' | 'sent' | 'failed' 
      : undefined;
    
    const queuedEmails = await this.schedulerService.getAllQueuedEmails(validStatus);
    
    return {
      success: true,
      message: 'Queued emails retrieved successfully',
      count: queuedEmails.length,
      data: queuedEmails,
    };
  }

  /**
   * Remove from queue (dequeue)
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

