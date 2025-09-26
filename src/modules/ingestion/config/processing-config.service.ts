import { Injectable } from '@nestjs/common';

export interface ProcessingConfig {
  maxFileSize: number;
  maxRecordsPerFile: number;
  processingTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  batchSize: number;
  concurrentProcessing: number;
}

export interface PlanFeatures {
  websiteResolution: boolean;
  googleSearchAPI: boolean;
  emailValidation: boolean;
  businessNameResolution: boolean;
  advancedDuplicateDetection: boolean;
  externalAPIs: boolean;
}

@Injectable()
export class ProcessingConfigService {
  private readonly defaultConfig: ProcessingConfig = {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxRecordsPerFile: 10000,
    processingTimeout: 30 * 60 * 1000, // 30 minutes
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
    batchSize: 100,
    concurrentProcessing: 5,
  };

  private readonly planFeatures: Record<string, PlanFeatures> = {
    promotional: {
      websiteResolution: false,
      googleSearchAPI: false,
      emailValidation: true,
      businessNameResolution: false,
      advancedDuplicateDetection: false,
      externalAPIs: false,
    },
    personal: {
      websiteResolution: true,
      googleSearchAPI: true,
      emailValidation: true,
      businessNameResolution: true,
      advancedDuplicateDetection: true,
      externalAPIs: true,
    },
  };

  /**
   * Gets processing configuration
   */
  getProcessingConfig(): ProcessingConfig {
    return {
      ...this.defaultConfig,
      maxFileSize: parseInt(
        process.env.MAX_FILE_SIZE || this.defaultConfig.maxFileSize.toString(),
      ),
      maxRecordsPerFile: parseInt(
        process.env.MAX_RECORDS_PER_FILE ||
          this.defaultConfig.maxRecordsPerFile.toString(),
      ),
      processingTimeout: parseInt(
        process.env.PROCESSING_TIMEOUT ||
          this.defaultConfig.processingTimeout.toString(),
      ),
      retryAttempts: parseInt(
        process.env.RETRY_ATTEMPTS ||
          this.defaultConfig.retryAttempts.toString(),
      ),
      retryDelay: parseInt(
        process.env.RETRY_DELAY || this.defaultConfig.retryDelay.toString(),
      ),
      batchSize: parseInt(
        process.env.BATCH_SIZE || this.defaultConfig.batchSize.toString(),
      ),
      concurrentProcessing: parseInt(
        process.env.CONCURRENT_PROCESSING ||
          this.defaultConfig.concurrentProcessing.toString(),
      ),
    };
  }

  /**
   * Gets plan features for a specific plan
   */
  getPlanFeatures(planName: string): PlanFeatures {
    return this.planFeatures[planName] || this.planFeatures.promotional;
  }

  /**
   * Checks if a feature is enabled for a plan
   */
  isFeatureEnabled(planName: string, feature: keyof PlanFeatures): boolean {
    const features = this.getPlanFeatures(planName);
    return features[feature];
  }

  /**
   * Gets processing strategy based on plan
   */
  getProcessingStrategy(planName: string): 'basic' | 'advanced' {
    const features = this.getPlanFeatures(planName);
    return features.externalAPIs ? 'advanced' : 'basic';
  }

  /**
   * Gets rate limits for external APIs
   */
  getRateLimits(): Record<string, { requests: number; window: number }> {
    return {
      googleSearch: {
        requests: parseInt(process.env.GOOGLE_SEARCH_RATE_LIMIT || '100'),
        window: parseInt(process.env.GOOGLE_SEARCH_WINDOW || '86400000'), // 24 hours
      },
      websiteValidation: {
        requests: parseInt(process.env.WEBSITE_VALIDATION_RATE_LIMIT || '1000'),
        window: parseInt(process.env.WEBSITE_VALIDATION_WINDOW || '3600000'), // 1 hour
      },
    };
  }

  /**
   * Gets timeout configurations
   */
  getTimeouts(): Record<string, number> {
    return {
      websiteValidation: parseInt(
        process.env.WEBSITE_VALIDATION_TIMEOUT || '10000',
      ), // 10 seconds
      googleSearch: parseInt(process.env.GOOGLE_SEARCH_TIMEOUT || '5000'), // 5 seconds
      emailValidation: parseInt(process.env.EMAIL_VALIDATION_TIMEOUT || '3000'), // 3 seconds
      dnsLookup: parseInt(process.env.DNS_LOOKUP_TIMEOUT || '5000'), // 5 seconds
    };
  }

  /**
   * Gets caching configurations
   */
  getCacheConfig(): Record<string, { ttl: number; maxSize: number }> {
    return {
      websiteValidation: {
        ttl: parseInt(process.env.WEBSITE_CACHE_TTL || '3600000'), // 1 hour
        maxSize: parseInt(process.env.WEBSITE_CACHE_MAX_SIZE || '10000'),
      },
      emailValidation: {
        ttl: parseInt(process.env.EMAIL_CACHE_TTL || '86400000'), // 24 hours
        maxSize: parseInt(process.env.EMAIL_CACHE_MAX_SIZE || '50000'),
      },
      googleSearch: {
        ttl: parseInt(process.env.GOOGLE_CACHE_TTL || '86400000'), // 24 hours
        maxSize: parseInt(process.env.GOOGLE_CACHE_MAX_SIZE || '5000'),
      },
    };
  }

  /**
   * Gets validation rules
   */
  getValidationRules(): Record<string, any> {
    return {
      email: {
        minLength: 5,
        maxLength: 254,
        allowedDomains: process.env.ALLOWED_EMAIL_DOMAINS?.split(',') || [],
        blockedDomains: process.env.BLOCKED_EMAIL_DOMAINS?.split(',') || [],
      },
      businessName: {
        minLength: 2,
        maxLength: 100,
        allowedCharacters: /^[\w\s\-&.,'()]+$/,
        blockedWords: process.env.BLOCKED_BUSINESS_WORDS?.split(',') || [
          'test',
          'example',
          'sample',
          'dummy',
        ],
      },
      website: {
        minLength: 10,
        maxLength: 500,
        allowedProtocols: ['http:', 'https:'],
        blockedDomains: process.env.BLOCKED_WEBSITE_DOMAINS?.split(',') || [],
      },
      phone: {
        minLength: 10,
        maxLength: 15,
        allowedFormats: ['+1234567890', '1234567890', '(123) 456-7890'],
      },
    };
  }

  /**
   * Gets error handling configuration
   */
  getErrorHandlingConfig(): Record<string, any> {
    return {
      maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
      retryDelay: parseInt(process.env.RETRY_DELAY || '1000'),
      exponentialBackoff: process.env.EXPONENTIAL_BACKOFF === 'true',
      circuitBreakerThreshold: parseInt(
        process.env.CIRCUIT_BREAKER_THRESHOLD || '5',
      ),
      circuitBreakerTimeout: parseInt(
        process.env.CIRCUIT_BREAKER_TIMEOUT || '60000',
      ),
    };
  }

  /**
   * Updates configuration at runtime
   */
  updateConfig(updates: Partial<ProcessingConfig>): void {
    Object.assign(this.defaultConfig, updates);
  }

  /**
   * Validates configuration values
   */
  validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const config = this.getProcessingConfig();

    if (config.maxFileSize <= 0) {
      errors.push('Max file size must be greater than 0');
    }

    if (config.maxRecordsPerFile <= 0) {
      errors.push('Max records per file must be greater than 0');
    }

    if (config.processingTimeout <= 0) {
      errors.push('Processing timeout must be greater than 0');
    }

    if (config.retryAttempts < 0) {
      errors.push('Retry attempts cannot be negative');
    }

    if (config.batchSize <= 0) {
      errors.push('Batch size must be greater than 0');
    }

    if (config.concurrentProcessing <= 0) {
      errors.push('Concurrent processing must be greater than 0');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
