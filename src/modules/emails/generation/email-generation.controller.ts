import { 
  Controller, 
  Post, 
  Get, 
  Put, 
  Body, 
  Param, 
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  ValidationPipe
} from '@nestjs/common';
import { IsNumber, IsOptional, IsIn } from 'class-validator';
import { EmailGenerationService, EmailGenerationRequest } from './email-generation.service';
import type { EmailTone } from './email-generation.service';

export class GenerateEmailDto {
  @IsNumber()
  contactId: number;

  @IsNumber()
  summaryId: number;

  @IsNumber()
  clientId: number;

  @IsOptional()
  @IsNumber()
  clientEmailId?: number;

  @IsOptional()
  @IsIn(['friendly', 'professional', 'pro_friendly'])
  tone?: EmailTone;
}

export class UpdateEmailDraftDto {
  @IsOptional()
  subjectLines?: string[];

  @IsOptional()
  bodyText?: string;

  @IsOptional()
  icebreaker?: string;

  @IsOptional()
  productsRelevant?: string;

  @IsOptional()
  @IsNumber()
  clientEmailId?: number;
}

@Controller('emails/generation')
export class EmailGenerationController {
  constructor(
    private readonly emailGenerationService: EmailGenerationService,
  ) {}

  /**
   * Generate a new email draft using AI summary
   */
  @Post('generate')
  @HttpCode(HttpStatus.CREATED)
  async generateEmailDraft(@Body(ValidationPipe) generateEmailDto: GenerateEmailDto) {
    const request: EmailGenerationRequest = {
      contactId: generateEmailDto.contactId,
      summaryId: generateEmailDto.summaryId,
      clientId: generateEmailDto.clientId,
      clientEmailId: generateEmailDto.clientEmailId,
      tone: generateEmailDto.tone || 'pro_friendly',
    };

    return await this.emailGenerationService.generateEmailDraft(request);
  }

  /**
   * Get a specific email draft by ID
   */
  @Get('drafts/:id')
  async getEmailDraft(@Param('id', ParseIntPipe) draftId: number) {
    return await this.emailGenerationService.getEmailDraft(draftId);
  }

  /**
   * Update an email draft
   */
  @Put('drafts/:id')
  async updateEmailDraft(
    @Param('id', ParseIntPipe) draftId: number,
    @Body(ValidationPipe) updateDto: UpdateEmailDraftDto
  ) {
    return await this.emailGenerationService.updateEmailDraft(draftId, updateDto);
  }

  /**
   * Get all email drafts for a specific contact
   */
  @Get('contacts/:contactId/drafts')
  async getContactEmailDrafts(@Param('contactId', ParseIntPipe) contactId: number) {
    return await this.emailGenerationService.getContactEmailDrafts(contactId);
  }

  /**
   * Get available tone options
   */
  @Get('tones')
  getAvailableTones() {
    return {
      tones: [
        {
          value: 'friendly',
          label: 'Friendly',
          description: 'Casual and warm tone with conversational language'
        },
        {
          value: 'professional',
          label: 'Professional',
          description: 'Formal business tone maintaining credibility and expertise'
        },
        {
          value: 'pro_friendly',
          label: 'Professional + Friendly',
          description: 'Balanced tone that\'s professional yet warm and approachable'
        }
      ]
    };
  }

  /**
   * Bulk generate email drafts for multiple contacts
   * Uses queue system with 40 second delay between requests
   */
  @Post('bulk-generate')
  @HttpCode(HttpStatus.CREATED)
  async bulkGenerateEmailDrafts(@Body() requests: GenerateEmailDto[]) {
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
      
      // this.logger.log(
      //   `📧 Generating email ${currentIndex}/${totalRequests} | ` +
      //   `Elapsed: ${elapsedTime}s | ` +
      //   `Estimated remaining: ${estimatedTimeRemaining}s`
      // );
      
      const result = await this.emailGenerationService.generateEmailDraft({
        contactId: request.contactId,
        summaryId: request.summaryId,
        clientId: request.clientId,
        clientEmailId: request.clientEmailId,
        tone: request.tone || 'pro_friendly',
      });
      results.push(result);
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);

    return {
      totalProcessed: requests.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      totalTimeSeconds: totalTime,
      estimatedTimeSeconds: estimatedTotalTime,
      results,
    };
  }

  /**
   * Get bulk status for multiple contacts (summary, email draft, SMS draft status)
   * POST /emails/generation/bulk-status
   * Body: { contactIds: number[] }
   */
  @Post('bulk-status')
  async getBulkStatus(@Body() body: { contactIds: number[] }) {
    return await this.emailGenerationService.getBulkStatus(body.contactIds, {
      includeSms: false,
    });
  }
}
