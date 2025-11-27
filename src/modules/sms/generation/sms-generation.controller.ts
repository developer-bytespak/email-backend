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
  clientId: number;

  @IsOptional()
  @IsNumber()
  clientSmsId?: number;
}

export class UpdateSmsDraftDto {
  @IsOptional()
  @IsString()
  messageText?: string;

  @IsOptional()
  @IsNumber()
  clientSmsId?: number;
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
      clientId: generateSmsDto.clientId,
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
   * Get all SMS drafts for a specific clientId
   */
  @Get('client/:clientId/drafts')
  async getClientSmsDrafts(@Param('clientId', ParseIntPipe) clientId: number) {
    return await this.smsGenerationService.getClientSmsDrafts(clientId);
  }

  /**
   * Bulk generate SMS drafts for multiple contacts
   * Uses queue system with 40 second delay between requests (via llmClient)
   */
  @Post('bulk-generate')
  @HttpCode(HttpStatus.CREATED)
  async bulkGenerateSmsDrafts(@Body() requests: GenerateSmsDto[]) {
    const startTime = Date.now();
    const results: any[] = [];
    const totalRequests = requests.length;
    const estimatedTimePerRequest = 40; // seconds (rate limit delay)
    const estimatedTotalTime = totalRequests * estimatedTimePerRequest;

    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      const currentIndex = i + 1;
      const elapsedTime = Math.round((Date.now() - startTime) / 1000);
      const estimatedTimeRemaining = Math.max(0, (totalRequests - currentIndex) * estimatedTimePerRequest);
      
      console.log(
        `📱 Generating SMS ${currentIndex}/${totalRequests} | ` +
        `Elapsed: ${elapsedTime}s | ` +
        `Estimated remaining: ${estimatedTimeRemaining}s`
      );
      
      const result = await this.smsGenerationService.generateSmsDraft({
        contactId: request.contactId,
        summaryId: request.summaryId,
        clientId: request.clientId,
        clientSmsId: request.clientSmsId,
      });
      results.push(result);
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);

    return {
      totalProcessed: requests.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      totalTimeSeconds: totalTime,
      estimatedTimeSeconds: estimatedTotalTime,
      results,
    };
  }
}

