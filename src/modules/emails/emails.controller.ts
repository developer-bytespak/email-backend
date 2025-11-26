import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  Delete,
  ParseIntPipe,
  HttpException,
  HttpStatus,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  Request,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, IsArray, IsIn, IsEmail, Length } from 'class-validator';
import { EmailsService } from './emails.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../config/prisma.service';

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

export class CreateClientEmailDto {
  @IsEmail()
  emailAddress: string;

  @IsOptional()
  @IsString()
  providerSettings?: string;
}

export class VerifyEmailOtpDto {
  @IsString()
  @Length(4, 10)
  code: string;
}

@Controller('emails')
export class EmailsController {
  constructor(
    private readonly emailsService: EmailsService,
    private readonly prisma: PrismaService,
  ) {}

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
  @UseGuards(JwtAuthGuard)
  @Get('drafts')
  async getAllEmailDrafts(
    @Request() req,
    @Query('clientEmailId') clientEmailIdParam?: string,
  ) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    let clientEmailId: number | undefined;
    if (clientEmailIdParam !== undefined) {
      clientEmailId = Number(clientEmailIdParam);
      if (!Number.isInteger(clientEmailId)) {
        throw new BadRequestException('clientEmailId must be a numeric value');
      }
    }

    try {
      const drafts = await this.emailsService.getDraftsForClient(clientId, clientEmailId);
      
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

  /**
   * Get email logs (history) for a specific clientEmailId
   * GET /emails/logs/client-email/:clientEmailId
   * Returns all emails sent from this email address
   * @deprecated Use getEmailLogsByClient instead for better performance
   */
  @Get('logs/client-email/:clientEmailId')
  async getEmailLogs(@Param('clientEmailId', ParseIntPipe) clientEmailId: number) {
    try {
      const logs = await this.emailsService.getEmailLogsByClientEmailId(clientEmailId);
      return {
        message: 'Email logs retrieved successfully',
        success: true,
        count: logs.length,
        data: logs,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve email logs',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all email logs for a specific client
   * GET /emails/logs/client/:clientId?limit=100&offset=0&dateFrom=2025-01-01&dateTo=2025-12-31&includeFullBody=false
   * Returns all emails sent from any email address belonging to this client
   * OPTIMIZED: Single query instead of N queries (one per clientEmailId)
   * OPTIMIZED: Reduced payload size, pagination, and date filtering
   * 
   * Query Parameters:
   * - limit: Number of records to return (default: 100, max: 500)
   * - offset: Number of records to skip (default: 0)
   * - dateFrom: Start date (ISO string, default: 90 days ago)
   * - dateTo: End date (ISO string, default: now)
   * - includeFullBody: Include full email body text (default: false, reduces payload significantly)
   */
  @Get('logs/client/:clientId')
  async getEmailLogsByClient(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('includeFullBody') includeFullBody?: string,
  ) {
    try {
      const limitNum = limit ? Math.min(parseInt(limit, 10), 500) : 100; // Max 500 records
      const offsetNum = offset ? parseInt(offset, 10) : 0;
      const includeFullBodyBool = includeFullBody === 'true' || includeFullBody === '1';
      
      const result = await this.emailsService.getEmailLogsByClientId(clientId, {
        limit: limitNum,
        offset: offsetNum,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
        includeFullBody: includeFullBodyBool,
      });
      
      return {
        message: 'Email logs retrieved successfully',
        success: true,
        count: result.logs.length,
        total: result.total,
        limit: limitNum,
        offset: offsetNum,
        data: result.logs,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve email logs',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all client emails for authenticated user
   * GET /emails/client-emails
   */
  @UseGuards(JwtAuthGuard)
  @Get('client-emails')
  async getClientEmails(@Request() req) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      const emails = await this.emailsService.getClientEmails(clientId);
      return {
        message: 'Client emails retrieved successfully',
        success: true,
        count: emails.length,
        data: emails,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve client emails',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Create a new client email
   * POST /emails/client-emails
   */
  @UseGuards(JwtAuthGuard)
  @Post('client-emails')
  async createClientEmail(@Request() req, @Body() createDto: CreateClientEmailDto) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      const clientEmail = await this.emailsService.createClientEmail(clientId, createDto);
      return {
        message: 'Client email created successfully',
        success: true,
        data: clientEmail,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to create client email',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('client-emails/:id/request-otp')
  async requestEmailOtp(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      // Try to determine if this is a clientEmailId or verificationId
      // First check if it's a ClientEmail, otherwise treat as verificationId
      const scrapingClient = await this.prisma.getScrapingClient();
      const clientEmail = await scrapingClient.clientEmail.findUnique({
        where: { id },
      });

      let identifier: number | { verificationId: number };
      if (clientEmail && clientEmail.clientId === clientId) {
        // Old flow: clientEmailId exists
        identifier = id;
      } else {
        // New flow: treat as verificationId
        identifier = { verificationId: id };
      }

      const result = await this.emailsService.requestEmailOtp(clientId, identifier);
      return {
        message: 'Verification code sent.',
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to send verification code',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('client-emails/:id/verify-otp')
  async verifyEmailOtp(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() verifyDto: VerifyEmailOtpDto,
  ) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      // Try to determine if this is a clientEmailId or verificationId
      // First check if it's a ClientEmail, otherwise treat as verificationId
      const scrapingClient = await this.prisma.getScrapingClient();
      const clientEmail = await scrapingClient.clientEmail.findUnique({
        where: { id },
      });

      let identifier: number | { verificationId: number };
      if (clientEmail && clientEmail.clientId === clientId) {
        // Old flow: clientEmailId exists
        identifier = id;
      } else {
        // New flow: treat as verificationId
        identifier = { verificationId: id };
      }

      const result = await this.emailsService.verifyEmailOtp(clientId, identifier, verifyDto.code);
      return {
        message: result.message || 'Email verified successfully',
        success: true,
        data: result,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to verify email',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete a client email
   * DELETE /emails/client-emails/:id
   */
  @UseGuards(JwtAuthGuard)
  @Delete('client-emails/:id')
  async deleteClientEmail(@Request() req, @Param('id', ParseIntPipe) id: number) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      await this.emailsService.deleteClientEmail(clientId, id);
      return {
        message: 'Client email deleted successfully',
        success: true,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to delete client email',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Delete a pending email verification
   * DELETE /emails/pending-verifications/:verificationId
   */
  @UseGuards(JwtAuthGuard)
  @Delete('pending-verifications/:verificationId')
  async deletePendingEmailVerification(@Request() req, @Param('verificationId', ParseIntPipe) verificationId: number) {
    const clientId = req.user?.id;
    if (!clientId) {
      throw new UnauthorizedException('Client authentication required');
    }

    try {
      await this.emailsService.deletePendingEmailVerification(clientId, verificationId);
      return {
        message: 'Pending email verification deleted successfully',
        success: true,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to delete pending verification',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
