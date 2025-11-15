import { Controller, Post, Get, Body, Param, Delete, HttpException, HttpStatus, ValidationPipe, ParseIntPipe, UseGuards, Request, UnauthorizedException } from '@nestjs/common';
import { IsNumber, IsString, IsOptional } from 'class-validator';
import { SmsService } from './sms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export class SendSmsDraftDto {
  @IsNumber()
  draftId: number;
}

export class CreateClientSmsDto {
  @IsString()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  providerSettings?: string;
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

  /**
   * Get SMS logs (history) for a specific clientSmsId
   * GET /sms/logs/client-sms/:clientSmsId
   * Returns all SMS sent from this SMS number
   */
  @Get('logs/client-sms/:clientSmsId')
  async getSmsLogs(@Param('clientSmsId', ParseIntPipe) clientSmsId: number) {
    try {
      const logs = await this.smsService.getSmsLogsByClientSmsId(clientSmsId);
      return {
        message: 'SMS logs retrieved successfully',
        success: true,
        count: logs.length,
        data: logs,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve SMS logs',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all client SMS numbers for authenticated user
   * GET /sms/client-sms
   */
  @UseGuards(JwtAuthGuard)
  @Get('client-sms')
  async getClientSms(@Request() req) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      const smsNumbers = await this.smsService.getClientSms(clientId);
      return {
        message: 'Client SMS numbers retrieved successfully',
        success: true,
        count: smsNumbers.length,
        data: smsNumbers,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve client SMS numbers',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Create a new client SMS number
   * POST /sms/client-sms
   */
  @UseGuards(JwtAuthGuard)
  @Post('client-sms')
  async createClientSms(@Request() req, @Body(ValidationPipe) createDto: CreateClientSmsDto) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      const clientSms = await this.smsService.createClientSms(clientId, createDto);
      return {
        message: 'Client SMS number created successfully',
        success: true,
        data: clientSms,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to create client SMS number',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete a client SMS number
   * DELETE /sms/client-sms/:id
   */
  @UseGuards(JwtAuthGuard)
  @Delete('client-sms/:id')
  async deleteClientSms(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      await this.smsService.deleteClientSms(clientId, id);
      return {
        message: 'Client SMS number deleted successfully',
        success: true,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to delete client SMS number',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
