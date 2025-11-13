import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ValidationPipe,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { SmsGenerationService, SmsGenerationRequest } from './sms-generation.service';

export class GenerateSmsDto {
  @IsNumber()
  contactId: number;

  @IsNumber()
  summaryId: number;

  @IsNumber()
  clientSmsId: number;
}

export class UpdateSmsDraftDto {
  @IsOptional()
  @IsString()
  messageText?: string;
}

@Controller('sms/generation')
export class SmsGenerationController {
  constructor(
    private readonly smsGenerationService: SmsGenerationService,
  ) {}

  /**
   * Generate a new SMS draft using AI summary
   */
  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  async generateSmsDraft(@Body(ValidationPipe) generateSmsDto: GenerateSmsDto) {
    const request: SmsGenerationRequest = {
      contactId: generateSmsDto.contactId,
      summaryId: generateSmsDto.summaryId,
      clientSmsId: generateSmsDto.clientSmsId,
    };

    return await this.smsGenerationService.generateSmsDraft(request);
  }

  /**
   * Get a specific SMS draft by ID
   */
  @Get('drafts/:id')
  async getSmsDraft(@Param('id', ParseIntPipe) draftId: number) {
    return await this.smsGenerationService.getSmsDraft(draftId);
  }

  /**
   * Update an SMS draft
   */
  @Put('drafts/:id')
  async updateSmsDraft(
    @Param('id', ParseIntPipe) draftId: number,
    @Body(ValidationPipe) updateDto: UpdateSmsDraftDto,
  ) {
    return await this.smsGenerationService.updateSmsDraft(draftId, updateDto);
  }

  /**
   * Get all SMS drafts for a specific contact
   */
  @Get('contacts/:contactId/drafts')
  async getContactSmsDrafts(@Param('contactId', ParseIntPipe) contactId: number) {
    return await this.smsGenerationService.getContactSmsDrafts(contactId);
  }

  /**
   * Get all SMS drafts for a specific clientSmsId
   */
  @Get('client-sms/:clientSmsId/drafts')
  async getClientSmsDrafts(@Param('clientSmsId', ParseIntPipe) clientSmsId: number) {
    return await this.smsGenerationService.getClientSmsDrafts(clientSmsId);
  }

  /**
   * Bulk generate SMS drafts for multiple contacts
   */
  @Post('bulk-generate')
  @HttpCode(HttpStatus.CREATED)
  async bulkGenerateSmsDrafts(@Body() requests: GenerateSmsDto[]) {
    const results: any[] = [];

    for (const request of requests) {
      const result = await this.smsGenerationService.generateSmsDraft({
        contactId: request.contactId,
        summaryId: request.summaryId,
        clientSmsId: request.clientSmsId,
      });
      results.push(result);
    }

    return {
      totalProcessed: requests.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}

