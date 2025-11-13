import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    ParseIntPipe,
    Query,
  } from '@nestjs/common';
  import { ScrapingService, ScrapeResult } from './scraping.service';
  
  @Controller('scraping')
  export class ScrapingController {
    constructor(private readonly scrapingService: ScrapingService) {}
  
    /**
     * Scrape a single contact by ID
     * POST /scraping/scrape/:contactId
     */
    @Post('scrape/:contactId')
    async scrapeContact(@Param('contactId', ParseIntPipe) contactId: number) {
      const result = await this.scrapingService.scrapeContact(contactId);
      
      return {
        message: result.success 
          ? 'Contact scraped successfully' 
          : 'Scraping failed',
        contactId: result.contactId,
        success: result.success,
        data: result.scrapedData,
        error: result.error,
      };
    }
  
    /**
     * Scrape multiple contacts in batch
     * POST /scraping/batch
     * Body: { uploadId: number, limit?: number }
     */
    @Post('batch')
    async scrapeBatch(
      @Body('uploadId', ParseIntPipe) uploadId: number,
      @Body('limit') limit?: number,
    ) {
      const batchLimit = limit && limit > 0 ? Math.min(limit, 100) : 20;
      
      const result = await this.scrapingService.scrapeBatch(uploadId, batchLimit);
      
      return {
        message: `Batch scraping completed. ${result.successful} successful, ${result.failed} failed`,
        uploadId,
        limit: batchLimit,
        summary: {
          total: result.total,
          successful: result.successful,
          failed: result.failed,
        },
        results: result.results,
      };
    }
  
    /**
     * Get scraping statistics for an upload
     * GET /scraping/stats/:uploadId
     */
    @Get('stats/:uploadId')
    async getUploadStats(@Param('uploadId', ParseIntPipe) uploadId: number) {
      const stats = await this.scrapingService.getUploadStats(uploadId);
      
      return {
        message: 'Scraping statistics retrieved successfully',
        stats,
      };
    }
  
    /**
     * Get contacts ready to scrape for an upload
     * GET /scraping/ready/:uploadId?limit=20
     */
    @Get('ready/:uploadId')
    async getReadyToScrape(
      @Param('uploadId', ParseIntPipe) uploadId: number,
      @Query('limit', ParseIntPipe) limit?: number,
    ) {
      const contacts = await this.scrapingService.getReadyToScrapeContacts(
        uploadId,
        limit,
      );
      
      return {
        message: 'Ready-to-scrape contacts retrieved successfully',
        uploadId,
        count: contacts.length,
        contacts,
      };
    }

    /**
     * Get all contacts for an upload (all statuses)
     * GET /scraping/all/:uploadId?limit=20
     */
    @Get('all/:uploadId')
    async getAllContacts(
      @Param('uploadId', ParseIntPipe) uploadId: number,
      @Query('limit', ParseIntPipe) limit?: number,
    ) {
      const contacts = await this.scrapingService.getAllContacts(
        uploadId,
        limit,
      );
      
      return {
        message: 'All contacts retrieved successfully',
        uploadId,
        count: contacts.length,
        contacts,
      };
    }

    /**
     * Reset a contact's scraping status (for retry)
     * POST /scraping/reset/:contactId
     */
    @Post('reset/:contactId')
    async resetContactStatus(
      @Param('contactId', ParseIntPipe) contactId: number,
    ) {
      const contact = await this.scrapingService.resetContactStatus(contactId);
      
      return {
        message: 'Contact status reset to ready_to_scrape',
        contactId: contact.id,
        status: contact.status,
      };
    }
  }