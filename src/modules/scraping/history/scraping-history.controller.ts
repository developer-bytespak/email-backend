import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ScrapingHistoryService } from './scraping-history.service';
import {
  ScrapingHistoryQueryDto,
  ScrapingHistoryResponseDto,
  UploadHistoryResponseDto,
  ContactHistoryResponseDto,
  ScrapingAnalyticsDto,
} from './dto/scraping-history.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('scraping/history')
@UseGuards(JwtAuthGuard)
export class ScrapingHistoryController {
  constructor(private readonly scrapingHistoryService: ScrapingHistoryService) {}

  /**
   * Get scraping history for a client with pagination and filtering
   * GET /scraping/history/client/:clientId
   */
  @Get('client/:clientId')
  async getClientScrapingHistory(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Query() query: ScrapingHistoryQueryDto,
  ): Promise<ScrapingHistoryResponseDto> {
    return this.scrapingHistoryService.getClientScrapingHistory(clientId, query);
  }

  /**
   * Get scraping history for a specific upload
   * GET /scraping/history/upload/:uploadId
   */
  @Get('upload/:uploadId')
  async getUploadScrapingHistory(
    @Param('uploadId', ParseIntPipe) uploadId: number,
  ): Promise<UploadHistoryResponseDto> {
    return this.scrapingHistoryService.getUploadScrapingHistory(uploadId);
  }

  /**
   * Get detailed scraping history for a specific contact
   * GET /scraping/history/contact/:contactId
   */
  @Get('contact/:contactId')
  async getContactScrapingHistory(
    @Param('contactId', ParseIntPipe) contactId: number,
  ): Promise<ContactHistoryResponseDto> {
    return this.scrapingHistoryService.getContactScrapingHistory(contactId);
  }

  /**
   * Get scraping analytics for a client
   * GET /scraping/history/analytics/:clientId
   */
  @Get('analytics/:clientId')
  async getScrapingAnalytics(
    @Param('clientId', ParseIntPipe) clientId: number,
  ): Promise<ScrapingAnalyticsDto> {
    return this.scrapingHistoryService.getScrapingAnalytics(clientId);
  }
}
