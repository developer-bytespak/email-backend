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
  clientEmailId: number;

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
   */
  @Post('bulk-generate')
  @HttpCode(HttpStatus.CREATED)
  async bulkGenerateEmailDrafts(@Body() requests: GenerateEmailDto[]) {
    const results: any[] = [];
    
    for (const request of requests) {
      const result = await this.emailGenerationService.generateEmailDraft({
        contactId: request.contactId,
        summaryId: request.summaryId,
        clientEmailId: request.clientEmailId,
        tone: request.tone || 'pro_friendly',
      });
      results.push(result);
    }

    return {
      totalProcessed: requests.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
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
