import { Controller, Post, Get, Body, Param, Query, HttpException, HttpStatus, HttpCode, ValidationPipe } from '@nestjs/common';
import { IsArray, IsNumber } from 'class-validator';
import { SummarizationService } from './summarization.service';

export class BulkSummarizeDto {
  @IsArray()
  @IsNumber({}, { each: true })
  contactIds: number[];
}

@Controller('summarization')
export class SummarizationController {
  constructor(private readonly summarizationService: SummarizationService) {}

  /**
   * Summarize a specific contact's scraped data
   */
  @Post('contact/:contactId')
  async summarizeContact(@Param('contactId') contactId: number) {
    try {
      const result = await this.summarizationService.summarizeContact(contactId);
      
      if (!result.success) {
        throw new HttpException(result.error || 'Summarization failed', HttpStatus.BAD_REQUEST);
      }
      
      return {
        message: 'Contact summarized successfully',
        contactId: result.contactId,
        success: true,
        data: result.summaryData
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Summarization failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get summary for a specific contact
   */
  @Get('contact/:contactId')
  async getContactSummary(@Param('contactId') contactId: number) {
    try {
      const summary = await this.summarizationService.getContactSummary(contactId);
      
      if (!summary) {
        throw new HttpException('No summary found for this contact', HttpStatus.NOT_FOUND);
      }
      
      return {
        message: 'Summary retrieved successfully',
        success: true,
        data: summary
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve summary',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get all summaries for a client
   */
  @Get('client/:clientId')
  async getClientSummaries(@Param('clientId') clientId: number) {
    try {
      const summaries = await this.summarizationService.getClientSummaries(clientId);
      
      return {
        message: 'Client summaries retrieved successfully',
        success: true,
        count: summaries.length,
        data: summaries
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to retrieve client summaries',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Test summarization with custom content (for testing purposes)
   */
  @Post('test')
  async testSummarization(@Query('content') content: string) {
    try {
      if (!content) {
        throw new HttpException('Content parameter is required', HttpStatus.BAD_REQUEST);
      }
      
      const result = await this.summarizationService.generateSummary(content);
      
      return {
        message: 'Test summarization completed',
        success: true,
        data: result
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Test summarization failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Bulk generate summaries for multiple contacts
   * POST /summarization/bulk-generate
   * Body: { contactIds: number[] }
   * Uses queue system with 40 second delay between requests
   */
  @Post('bulk-generate')
  @HttpCode(HttpStatus.CREATED)
  async bulkSummarizeContacts(@Body(ValidationPipe) bulkDto: BulkSummarizeDto) {
    try {
      const startTime = Date.now();
      const totalRequests = bulkDto.contactIds.length;
      const estimatedTimePerRequest = 40; // seconds (rate limit delay)
      const estimatedTotalTime = totalRequests * estimatedTimePerRequest;
      
      // Log initial estimate
      console.log(
        `📊 Starting bulk summarization for ${totalRequests} contacts | ` +
        `Estimated time: ${estimatedTotalTime}s (${Math.round(estimatedTotalTime / 60)} minutes)`
      );
      
      const result = await this.summarizationService.bulkSummarizeContacts(bulkDto.contactIds);
      
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      
      return {
        message: 'Bulk summarization completed',
        success: true,
        totalProcessed: result.totalProcessed,
        successful: result.successful,
        failed: result.failed,
        totalTimeSeconds: totalTime,
        estimatedTimeSeconds: estimatedTotalTime,
        results: result.results,
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Bulk summarization failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
