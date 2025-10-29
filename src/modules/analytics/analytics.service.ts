import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get dashboard statistics for a client
   * Returns: CSV Uploads, Scraping Jobs, Total Records, Success Rate
   * With change indicators compared to previous period (last 30 days)
   * Optimized: Uses single transaction with parallel queries
   */
  async getDashboardStats(clientId: number) {
    // Calculate date ranges
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Execute all queries in parallel using Promise.all for better performance
    const [
      // CSV Uploads
      totalCsvUploads,
      csvUploadsLast30Days,
      csvUploadsPrevious30Days,
      
      // Scraping Jobs
      totalScrapingJobs,
      scrapingJobsLast30Days,
      scrapingJobsPrevious30Days,
      
      // Total Records
      totalRecords,
      totalRecordsLast30Days,
      totalRecordsPrevious30Days,
      
      // Success Rate
      successfulScrapes,
      totalScrapeAttempts,
      successfulScrapesLast30Days,
      scrapeAttemptsLast30Days,
      successfulScrapesPrevious30Days,
      scrapeAttemptsPrevious30Days,
    ] = await Promise.all([
      // CSV Uploads
      this.prisma.csvUpload.count({ where: { clientId } }),
      this.prisma.csvUpload.count({
        where: { clientId, createdAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.csvUpload.count({
        where: { clientId, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),
      
      // Scraping Jobs
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: { in: ['scraped', 'scrape_failed', 'scraping'] },
        },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: { in: ['scraped', 'scrape_failed', 'scraping'] },
          updatedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: { in: ['scraped', 'scrape_failed', 'scraping'] },
          updatedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
      
      // Total Records
      this.prisma.contact.count({
        where: { csvUpload: { clientId } },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId, createdAt: { gte: thirtyDaysAgo } },
        },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId, createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
        },
      }),
      
      // Success Rate
      this.prisma.contact.count({
        where: { csvUpload: { clientId }, status: 'scraped' },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: { in: ['scraped', 'scrape_failed'] },
        },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: 'scraped',
          updatedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: { in: ['scraped', 'scrape_failed'] },
          updatedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: 'scraped',
          updatedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
      this.prisma.contact.count({
        where: {
          csvUpload: { clientId },
          status: { in: ['scraped', 'scrape_failed'] },
          updatedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
      }),
    ]);

    // Calculate changes
    const csvUploadsChange = csvUploadsPrevious30Days === 0
      ? (csvUploadsLast30Days > 0 ? `+${csvUploadsLast30Days}` : '0')
      : `${csvUploadsLast30Days >= csvUploadsPrevious30Days ? '+' : ''}${csvUploadsLast30Days - csvUploadsPrevious30Days}`;

    const scrapingJobsChange = scrapingJobsPrevious30Days === 0
      ? (scrapingJobsLast30Days > 0 ? `+${scrapingJobsLast30Days}` : '0')
      : `${scrapingJobsLast30Days >= scrapingJobsPrevious30Days ? '+' : ''}${scrapingJobsLast30Days - scrapingJobsPrevious30Days}`;

    const totalRecordsChangePercent = totalRecordsPrevious30Days === 0
      ? (totalRecordsLast30Days > 0 ? `+${totalRecordsLast30Days}` : '0')
      : totalRecords === 0
      ? '0%'
      : `${totalRecordsLast30Days >= totalRecordsPrevious30Days ? '+' : ''}${Math.round(((totalRecordsLast30Days - totalRecordsPrevious30Days) / (totalRecordsPrevious30Days || 1)) * 100)}%`;

    const successRate = totalScrapeAttempts > 0
      ? Math.round((successfulScrapes / totalScrapeAttempts) * 100)
      : 0;

    const successRateLast30Days = scrapeAttemptsLast30Days > 0
      ? Math.round((successfulScrapesLast30Days / scrapeAttemptsLast30Days) * 100)
      : 0;

    const successRatePrevious30Days = scrapeAttemptsPrevious30Days > 0
      ? Math.round((successfulScrapesPrevious30Days / scrapeAttemptsPrevious30Days) * 100)
      : 0;

    const successRateChange = `${successRateLast30Days >= successRatePrevious30Days ? '+' : ''}${successRateLast30Days - successRatePrevious30Days}%`;

    return {
      csvUploads: {
        value: totalCsvUploads.toString(),
        change: csvUploadsChange,
      },
      scrapingJobs: {
        value: totalScrapingJobs.toString(),
        change: scrapingJobsChange,
      },
      totalRecords: {
        value: totalRecords.toString(),
        change: totalRecordsChangePercent,
      },
      successRate: {
        value: `${successRate}%`,
        change: successRateChange,
      },
    };
  }

  async getCampaignMetrics(campaignId: string) {
    // TODO: Implement campaign metrics retrieval
    return {
      campaignId,
      openRate: 0.25,
      clickRate: 0.05,
      conversionRate: 0.02,
      generatedAt: new Date(),
    };
  }

  async generateReport(query: any) {
    // TODO: Implement report generation
    return {
      reportId: 'report_' + Date.now(),
      query,
      generatedAt: new Date(),
    };
  }

  async exportData(exportId: string) {
    // TODO: Implement data export
    return {
      exportId,
      status: 'completed',
      downloadUrl: '/exports/' + exportId,
    };
  }
}
