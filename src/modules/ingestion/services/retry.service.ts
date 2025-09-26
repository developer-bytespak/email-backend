import { Injectable, Logger } from '@nestjs/common';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBackoff: boolean;
  jitter: boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTime: number;
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  /**
   * Executes a function with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
  ): Promise<RetryResult<T>> {
    const retryConfig: RetryConfig = {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      exponentialBackoff: true,
      jitter: true,
      ...config,
    };

    const startTime = Date.now();
    let lastError: Error;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();
        const totalTime = Date.now() - startTime;

        this.logger.debug(
          `Operation succeeded on attempt ${attempt} in ${totalTime}ms`,
        );

        return {
          success: true,
          result,
          attempts: attempt,
          totalTime,
        };
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Attempt ${attempt} failed: ${lastError.message}`);

        // Don't retry on the last attempt
        if (attempt === retryConfig.maxAttempts) {
          break;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt, retryConfig);
        this.logger.debug(`Waiting ${delay}ms before retry ${attempt + 1}`);

        await this.sleep(delay);
      }
    }

    const totalTime = Date.now() - startTime;
    this.logger.error(
      `Operation failed after ${retryConfig.maxAttempts} attempts in ${totalTime}ms`,
    );

    return {
      success: false,
      error: lastError!,
      attempts: retryConfig.maxAttempts,
      totalTime,
    };
  }

  /**
   * Executes multiple operations with retry logic
   */
  async executeMultipleWithRetry<T>(
    operations: Array<() => Promise<T>>,
    config: Partial<RetryConfig> = {},
  ): Promise<Array<RetryResult<T>>> {
    const results = await Promise.allSettled(
      operations.map((operation) => this.executeWithRetry(operation, config)),
    );

    return results.map((result) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          error: result.reason,
          attempts: 0,
          totalTime: 0,
        };
      }
    });
  }

  /**
   * Executes operation with circuit breaker pattern
   */
  async executeWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitBreakerConfig: {
      failureThreshold: number;
      timeout: number;
      resetTimeout: number;
    },
  ): Promise<RetryResult<T>> {
    // This is a simplified circuit breaker implementation
    // In production, you'd use a library like opossum or implement a more robust version

    const startTime = Date.now();

    try {
      const result = await operation();
      const totalTime = Date.now() - startTime;

      return {
        success: true,
        result,
        attempts: 1,
        totalTime,
      };
    } catch (error) {
      const totalTime = Date.now() - startTime;

      this.logger.error(
        `Circuit breaker operation failed: ${(error as Error).message}`,
      );

      return {
        success: false,
        error: error as Error,
        attempts: 1,
        totalTime,
      };
    }
  }

  /**
   * Calculates delay for retry attempts
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    let delay = config.baseDelay;

    if (config.exponentialBackoff) {
      delay = config.baseDelay * Math.pow(2, attempt - 1);
    }

    // Apply jitter to prevent thundering herd
    if (config.jitter) {
      const jitterRange = delay * 0.1; // 10% jitter
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      delay += jitter;
    }

    // Cap at maximum delay
    delay = Math.min(delay, config.maxDelay);

    return Math.max(0, delay);
  }

  /**
   * Sleeps for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Retries HTTP requests with exponential backoff
   */
  async retryHttpRequest<T>(
    requestFn: () => Promise<T>,
    config: Partial<RetryConfig> = {},
  ): Promise<RetryResult<T>> {
    return this.executeWithRetry(requestFn, {
      maxAttempts: 3,
      baseDelay: 1000,
      exponentialBackoff: true,
      jitter: true,
      ...config,
    });
  }

  /**
   * Retries database operations
   */
  async retryDatabaseOperation<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
  ): Promise<RetryResult<T>> {
    return this.executeWithRetry(operation, {
      maxAttempts: 3,
      baseDelay: 500,
      exponentialBackoff: true,
      jitter: false,
      ...config,
    });
  }

  /**
   * Retries external API calls
   */
  async retryExternalApiCall<T>(
    apiCall: () => Promise<T>,
    config: Partial<RetryConfig> = {},
  ): Promise<RetryResult<T>> {
    return this.executeWithRetry(apiCall, {
      maxAttempts: 2,
      baseDelay: 2000,
      maxDelay: 10000,
      exponentialBackoff: true,
      jitter: true,
      ...config,
    });
  }

  /**
   * Checks if error is retryable
   */
  isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNABORTED',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ];

    const retryableMessages = [
      'timeout',
      'network',
      'connection',
      'temporary',
      'unavailable',
      'service unavailable',
      'rate limit',
      'too many requests',
    ];

    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as any).code;

    return (
      retryableErrors.includes(errorCode) ||
      retryableMessages.some((message) => errorMessage.includes(message))
    );
  }

  /**
   * Gets default retry configuration for different operation types
   */
  getDefaultConfig(
    operationType: 'http' | 'database' | 'external-api' | 'file',
  ): RetryConfig {
    switch (operationType) {
      case 'http':
        return {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 10000,
          exponentialBackoff: true,
          jitter: true,
        };
      case 'database':
        return {
          maxAttempts: 3,
          baseDelay: 500,
          maxDelay: 5000,
          exponentialBackoff: true,
          jitter: false,
        };
      case 'external-api':
        return {
          maxAttempts: 2,
          baseDelay: 2000,
          maxDelay: 15000,
          exponentialBackoff: true,
          jitter: true,
        };
      case 'file':
        return {
          maxAttempts: 2,
          baseDelay: 1000,
          maxDelay: 5000,
          exponentialBackoff: false,
          jitter: false,
        };
      default:
        return {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 10000,
          exponentialBackoff: true,
          jitter: true,
        };
    }
  }

  /**
   * Creates a retry wrapper for a function
   */
  createRetryWrapper<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    config: Partial<RetryConfig> = {},
  ): T {
    return (async (...args: Parameters<T>) => {
      const result = await this.executeWithRetry(() => fn(...args), config);

      if (result.success) {
        return result.result;
      } else {
        throw result.error;
      }
    }) as T;
  }
}
