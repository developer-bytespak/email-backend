import { Controller, Post, Body, Get, Param, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { InboxOptimizationService, SpamCheckResult, OptimizationSuggestions } from './inbox-optimization.service';
import { PrismaService } from '../../../config/prisma.service';

export class CheckSpamDto {
  @IsOptional()
  @IsNumber()
  draftId?: number;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  subjectLine?: string;
}

export class OptimizeDto {
  @IsOptional()
  @IsNumber()
  draftId?: number;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  subjectLine?: string;
}

@Controller('emails/optimization')
export class InboxOptimizationController {
  constructor(
    private readonly optimizationService: InboxOptimizationService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Check email for spam score
   * POST /emails/optimization/check
   * Body: { "draftId": 1 } OR { "content": "...", "subjectLine": "..." }
   */
  @Post('check')
  async checkSpam(
    @Body() checkDto: CheckSpamDto,
  ): Promise<{ success: boolean; data: SpamCheckResult }> {
    let content: string;
    let subjectLine: string | undefined;

    // If draftId is provided, fetch from database
    if (checkDto.draftId) {
      const scrapingClient = await this.prisma.getScrapingClient();
      const draft = await scrapingClient.emailDraft.findUnique({
        where: { id: checkDto.draftId },
        select: {
          subjectLine: true,
          bodyText: true,
          icebreaker: true,
          productsRelevant: true,
        },
      });

      if (!draft) {
        throw new BadRequestException(`EmailDraft with ID ${checkDto.draftId} not found`);
      }

      // Combine all email content for spam check
      content = draft.bodyText;
      subjectLine = draft.subjectLine;
      
      // Include icebreaker and productsRelevant if they exist
      if (draft.icebreaker) {
        content = `${draft.icebreaker}\n\n${content}`;
      }
      if (draft.productsRelevant) {
        content = `${content}\n\n${draft.productsRelevant}`;
      }
    } else if (checkDto.content) {
      // Fallback to body content if no draftId
      content = checkDto.content;
      subjectLine = checkDto.subjectLine;
    } else {
      throw new BadRequestException('Either draftId or content must be provided in request body');
    }

    const result = await this.optimizationService.checkSpamScore(content);
    
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Get optimization suggestions (with Gemini optimization if score >= threshold)
   * POST /emails/optimization/suggest
   * Body: { "draftId": 1 } OR { "content": "...", "subjectLine": "..." }
   */
  @Post('suggest')
  async getSuggestions(
    @Body() optimizeDto: OptimizeDto,
  ): Promise<{ success: boolean; data: OptimizationSuggestions }> {
    let content: string;
    let subjectLine: string | undefined;

    // If draftId is provided, fetch from database
    if (optimizeDto.draftId) {
      const scrapingClient = await this.prisma.getScrapingClient();
      const draft = await scrapingClient.emailDraft.findUnique({
        where: { id: optimizeDto.draftId },
        select: {
          subjectLine: true,
          bodyText: true,
          icebreaker: true,
          productsRelevant: true,
        },
      });

      if (!draft) {
        throw new BadRequestException(`EmailDraft with ID ${optimizeDto.draftId} not found`);
      }

      // Combine all email content for optimization
      content = draft.bodyText;
      subjectLine = draft.subjectLine;
      
      // Include icebreaker and productsRelevant if they exist
      if (draft.icebreaker) {
        content = `${draft.icebreaker}\n\n${content}`;
      }
      if (draft.productsRelevant) {
        content = `${content}\n\n${draft.productsRelevant}`;
      }
    } else if (optimizeDto.content) {
      // Fallback to body content if no draftId
      content = optimizeDto.content;
      subjectLine = optimizeDto.subjectLine;
    } else {
      throw new BadRequestException('Either draftId or content must be provided in request body');
    }

    const result = await this.optimizationService.optimizeContent(
      content,
      subjectLine,
    );
    
    return {
      success: true,
      data: result,
    };
  }

}

