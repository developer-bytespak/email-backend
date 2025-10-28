import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import {
  ScrapingHistoryQueryDto,
  ScrapingHistoryResponseDto,
  UploadHistoryResponseDto,
  ContactHistoryResponseDto,
  ScrapingAnalyticsDto,
  ScrapingHistoryItemDto,
  ScrapingAttemptDto,
} from './dto/scraping-history.dto';

@Injectable()
export class ScrapingHistoryService {
  private readonly logger = new Logger(ScrapingHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get scraping history for a client with pagination and filtering
   */
  async getClientScrapingHistory(
    clientId: number,
    query: ScrapingHistoryQueryDto,
  ): Promise<ScrapingHistoryResponseDto> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const {
      status = 'all',
      method,
      dateFrom,
      dateTo,
      businessName,
      page = 1,
      limit = 50,
      sortBy = 'scrapedAt',
      sortOrder = 'desc',
    } = query;

    // Build where clause
    const whereClause: any = {
      contact: {
        csvUpload: {
          clientId,
        },
      },
    };

    // Add status filter
    if (status !== 'all') {
      whereClause.scrapeSuccess = status === 'success';
    }

    // Add method filter
    if (method) {
      whereClause.method = method;
    }

    // Add date range filter
    if (dateFrom || dateTo) {
      whereClause.scrapedAt = {};
      if (dateFrom) {
        whereClause.scrapedAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        whereClause.scrapedAt.lte = new Date(dateTo);
      }
    }

    // Add business name filter
    if (businessName) {
      whereClause.contact.businessName = {
        contains: businessName,
        mode: 'insensitive',
      };
    }

    // Build order by clause
    const orderBy: any = {};
    if (sortBy === 'scrapedAt') {
      orderBy.scrapedAt = sortOrder;
    } else if (sortBy === 'businessName') {
      orderBy.contact = { businessName: sortOrder };
    } else if (sortBy === 'method') {
      orderBy.method = sortOrder;
    }

    // Get total count
    const totalCount = await scrapingClient.scrapedData.count({
      where: whereClause,
    });

    // Get paginated results
    const skip = (page - 1) * limit;
    const scrapedData = await scrapingClient.scrapedData.findMany({
      where: whereClause,
      orderBy,
      skip,
      take: limit,
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            email: true,
            website: true,
            status: true,
          },
        },
      },
    });

    // Transform to DTO format
    const recentActivity: ScrapingHistoryItemDto[] = scrapedData.map((data) => {
      const pagesScraped = this.getPagesScraped(data);
      const contentLength = this.calculateContentLength(data);

      return {
        id: data.id,
        contactId: data.contactId,
        businessName: data.contact.businessName,
        email: data.contact.email || '',
        website: data.contact.website || '',
        scrapedAt: data.scrapedAt,
        method: data.method,
        success: data.scrapeSuccess,
        errorMessage: data.errorMessage || undefined,
        discoveredUrl: data.discoveredUrl || undefined,
        pagesScraped,
        extractedEmails: data.extractedEmails?.length || 0,
        extractedPhones: data.extractedPhones?.length || 0,
        contentLength,
      };
    });

    // Get success/failure counts
    const successfulCount = await scrapingClient.scrapedData.count({
      where: { ...whereClause, scrapeSuccess: true },
    });

    const failedCount = await scrapingClient.scrapedData.count({
      where: { ...whereClause, scrapeSuccess: false },
    });

    return {
      totalScrapes: totalCount,
      successfulScrapes: successfulCount,
      failedScrapes: failedCount,
      recentActivity,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount,
      },
    };
  }

  /**
   * Get scraping history for a specific upload
   */
  async getUploadScrapingHistory(uploadId: number): Promise<UploadHistoryResponseDto> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Get upload details
    const upload = await scrapingClient.csvUpload.findUnique({
      where: { id: uploadId },
      select: {
        id: true,
        fileName: true,
        createdAt: true,
      },
    });

    if (!upload) {
      throw new NotFoundException(`Upload with ID ${uploadId} not found`);
    }

    // Get all scraping data for this upload
    const scrapedData = await scrapingClient.scrapedData.findMany({
      where: {
        contact: {
          csvUploadId: uploadId,
        },
      },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            email: true,
            website: true,
            status: true,
          },
        },
      },
      orderBy: {
        scrapedAt: 'desc',
      },
    });

    // Transform to DTO format
    const scrapingHistory: ScrapingHistoryItemDto[] = scrapedData.map((data) => {
      const pagesScraped = this.getPagesScraped(data);
      const contentLength = this.calculateContentLength(data);

      return {
        id: data.id,
        contactId: data.contactId,
        businessName: data.contact.businessName,
        email: data.contact.email || '',
        website: data.contact.website || '',
        scrapedAt: data.scrapedAt,
        method: data.method,
        success: data.scrapeSuccess,
        errorMessage: data.errorMessage || undefined,
        discoveredUrl: data.discoveredUrl || undefined,
        pagesScraped,
        extractedEmails: data.extractedEmails?.length || 0,
        extractedPhones: data.extractedPhones?.length || 0,
        contentLength,
      };
    });

    // Calculate summary statistics
    const total = scrapedData.length;
    const successful = scrapedData.filter((data) => data.scrapeSuccess).length;
    const failed = total - successful;
    const avgTime = this.calculateAverageProcessingTime(scrapedData);

    return {
      uploadId: upload.id,
      uploadName: upload.fileName,
      scrapingHistory,
      summary: {
        total,
        successful,
        failed,
        avgTime,
      },
    };
  }

  /**
   * Get detailed scraping history for a specific contact
   */
  async getContactScrapingHistory(contactId: number): Promise<ContactHistoryResponseDto> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Get contact details
    const contact = await scrapingClient.contact.findUnique({
      where: { id: contactId },
      select: {
        id: true,
        businessName: true,
        status: true,
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found`);
    }

    // Get all scraping attempts for this contact
    const scrapedData = await scrapingClient.scrapedData.findMany({
      where: { contactId },
      orderBy: {
        scrapedAt: 'desc',
      },
    });

    // Transform to DTO format
    const scrapingAttempts: ScrapingAttemptDto[] = scrapedData.map((data, index) => {
      const pagesScraped = this.getPagesScraped(data);
      const contentLength = this.calculateContentLength(data);
      const dataQuality = this.determineDataQuality(contentLength);

      return {
        attemptNumber: scrapedData.length - index,
        scrapedAt: data.scrapedAt,
        method: data.method,
        success: data.scrapeSuccess,
        errorMessage: data.errorMessage || undefined,
        discoveredUrl: data.discoveredUrl || undefined,
        pagesScraped,
        dataQuality,
      };
    });

    return {
      contactId: contact.id,
      businessName: contact.businessName,
      scrapingAttempts,
      currentStatus: contact.status,
    };
  }

  /**
   * Get scraping analytics for a client
   */
  async getScrapingAnalytics(clientId: number): Promise<ScrapingAnalyticsDto> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // Get all scraping data for the client
    const scrapedData = await scrapingClient.scrapedData.findMany({
      where: {
        contact: {
          csvUpload: {
            clientId,
          },
        },
      },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
          },
        },
      },
    });

    // Calculate basic statistics
    const totalScrapes = scrapedData.length;
    const successfulScrapes = scrapedData.filter((data) => data.scrapeSuccess).length;
    const successRate = totalScrapes > 0 ? (successfulScrapes / totalScrapes) * 100 : 0;

    // Calculate method breakdown
    const methodBreakdown = {
      direct_url: this.calculateMethodStats(scrapedData, 'direct_url'),
      email_domain: this.calculateMethodStats(scrapedData, 'email_domain'),
      business_search: this.calculateMethodStats(scrapedData, 'business_search'),
    };

    // Calculate daily activity (last 30 days)
    const dailyActivity = this.calculateDailyActivity(scrapedData);

    // Calculate top failed reasons
    const topFailedReasons = this.calculateTopFailedReasons(scrapedData);

    // Calculate content quality distribution
    const contentQuality = this.calculateContentQualityDistribution(scrapedData);

    return {
      totalScrapes,
      successRate,
      avgScrapingTime: 0, // TODO: Implement if processing time is tracked
      methodBreakdown,
      dailyActivity,
      topFailedReasons,
      contentQuality,
    };
  }

  /**
   * Helper method to determine which pages were scraped
   */
  private getPagesScraped(data: any): string[] {
    const pages: string[] = [];
    
    if (data.homepageText) pages.push('homepage');
    if (data.servicesText) pages.push('services');
    if (data.productsText) pages.push('products');
    if (data.contactText) pages.push('contact');
    
    return pages;
  }

  /**
   * Helper method to calculate total content length
   */
  private calculateContentLength(data: any): number {
    let length = 0;
    
    if (data.homepageText) length += data.homepageText.length;
    if (data.servicesText) length += data.servicesText.length;
    if (data.productsText) length += data.productsText.length;
    if (data.contactText) length += data.contactText.length;
    
    return length;
  }

  /**
   * Helper method to determine data quality based on content length
   */
  private determineDataQuality(contentLength: number): 'high' | 'medium' | 'low' {
    if (contentLength > 1000) return 'high';
    if (contentLength > 500) return 'medium';
    return 'low';
  }

  /**
   * Helper method to calculate average processing time
   */
  private calculateAverageProcessingTime(data: any[]): number {
    // TODO: Implement if processing time is tracked in the future
    return 0;
  }

  /**
   * Helper method to calculate method statistics
   */
  private calculateMethodStats(data: any[], method: string): { count: number; successRate: number } {
    const methodData = data.filter((item) => item.method === method);
    const count = methodData.length;
    const successful = methodData.filter((item) => item.scrapeSuccess).length;
    const successRate = count > 0 ? (successful / count) * 100 : 0;

    return { count, successRate };
  }

  /**
   * Helper method to calculate daily activity
   */
  private calculateDailyActivity(data: any[]): Array<{
    date: string;
    totalScrapes: number;
    successfulScrapes: number;
    failedScrapes: number;
  }> {
    const dailyStats: Map<string, { total: number; successful: number; failed: number }> = new Map();

    data.forEach((item) => {
      const date = item.scrapedAt.toISOString().split('T')[0];
      const existing = dailyStats.get(date) || { total: 0, successful: 0, failed: 0 };
      
      existing.total++;
      if (item.scrapeSuccess) {
        existing.successful++;
      } else {
        existing.failed++;
      }
      
      dailyStats.set(date, existing);
    });

    // Convert to array and sort by date
    return Array.from(dailyStats.entries())
      .map(([date, stats]) => ({
        date,
        totalScrapes: stats.total,
        successfulScrapes: stats.successful,
        failedScrapes: stats.failed,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30); // Last 30 days
  }

  /**
   * Helper method to calculate top failed reasons
   */
  private calculateTopFailedReasons(data: any[]): Array<{
    reason: string;
    count: number;
    percentage: number;
  }> {
    const failedData = data.filter((item) => !item.scrapeSuccess);
    const reasonCounts: Map<string, number> = new Map();

    failedData.forEach((item) => {
      const reason = item.errorMessage || 'Unknown error';
      const count = reasonCounts.get(reason) || 0;
      reasonCounts.set(reason, count + 1);
    });

    const total = failedData.length;
    return Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 reasons
  }

  /**
   * Helper method to calculate content quality distribution
   */
  private calculateContentQualityDistribution(data: any[]): {
    highQuality: number;
    mediumQuality: number;
    lowQuality: number;
  } {
    let highQuality = 0;
    let mediumQuality = 0;
    let lowQuality = 0;

    data.forEach((item) => {
      const contentLength = this.calculateContentLength(item);
      const quality = this.determineDataQuality(contentLength);
      
      if (quality === 'high') highQuality++;
      else if (quality === 'medium') mediumQuality++;
      else lowQuality++;
    });

    return {
      highQuality,
      mediumQuality,
      lowQuality,
    };
  }
}
