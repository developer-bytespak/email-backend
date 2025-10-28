import { IsOptional, IsString, IsNumber, IsEnum, IsDateString, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ScrapeMethod } from '@prisma/client';

export class ScrapingHistoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  clientId?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  uploadId?: number;

  @IsOptional()
  @IsEnum(['success', 'failed', 'all'])
  status?: 'success' | 'failed' | 'all';

  @IsOptional()
  @IsEnum(['direct_url', 'email_domain', 'business_search'])
  method?: ScrapeMethod;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsEnum(['scrapedAt', 'businessName', 'method'])
  sortBy?: 'scrapedAt' | 'businessName' | 'method';

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class ScrapingHistoryItemDto {
  id: number;
  contactId: number;
  businessName: string;
  email: string;
  website: string;
  scrapedAt: Date;
  method: ScrapeMethod;
  success: boolean;
  errorMessage?: string | null;
  discoveredUrl?: string | null;
  pagesScraped: string[];
  extractedEmails: number;
  extractedPhones: number;
  contentLength: number;
  processingTime?: number;
}

export class ScrapingAttemptDto {
  attemptNumber: number;
  scrapedAt: Date;
  method: ScrapeMethod;
  success: boolean;
  errorMessage?: string | null;
  discoveredUrl?: string | null;
  pagesScraped: string[];
  dataQuality: 'high' | 'medium' | 'low';
}

export class ScrapingHistoryResponseDto {
  totalScrapes: number;
  successfulScrapes: number;
  failedScrapes: number;
  recentActivity: ScrapingHistoryItemDto[];
  pagination: {
    page: number;
    limit: number;
    totalPages: number;
    totalItems: number;
  };
}

export class UploadHistoryResponseDto {
  uploadId: number;
  uploadName: string;
  scrapingHistory: ScrapingHistoryItemDto[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    avgTime: number;
  };
}

export class ContactHistoryResponseDto {
  contactId: number;
  businessName: string;
  scrapingAttempts: ScrapingAttemptDto[];
  currentStatus: string;
}

export class ScrapingAnalyticsDto {
  totalScrapes: number;
  successRate: number;
  avgScrapingTime: number;
  methodBreakdown: {
    direct_url: { count: number; successRate: number };
    email_domain: { count: number; successRate: number };
    business_search: { count: number; successRate: number };
  };
  dailyActivity: Array<{
    date: string;
    totalScrapes: number;
    successfulScrapes: number;
    failedScrapes: number;
  }>;
  topFailedReasons: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  contentQuality: {
    highQuality: number;
    mediumQuality: number;
    lowQuality: number;
  };
}
