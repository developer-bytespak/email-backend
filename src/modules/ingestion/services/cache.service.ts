import { Injectable, Logger } from '@nestjs/common';

export interface CacheItem<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly cache = new Map<string, CacheItem<any>>();
  private readonly stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  /**
   * Gets value from cache
   */
  get<T>(key: string): T | null {
    const item = this.cache.get(key);

    if (!item) {
      this.stats.misses++;
      return null;
    }

    // Check if item has expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }

    this.stats.hits++;
    return item.value;
  }

  /**
   * Sets value in cache
   */
  set<T>(key: string, value: T, ttl: number = 3600000): void {
    // Default 1 hour
    const item: CacheItem<T> = {
      value,
      timestamp: Date.now(),
      ttl,
    };

    this.cache.set(key, item);
  }

  /**
   * Gets value from cache or executes function and caches result
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl: number = 3600000,
  ): Promise<T> {
    const cached = this.get<T>(key);

    if (cached !== null) {
      return cached;
    }

    try {
      const value = await factory();
      this.set(key, value, ttl);
      return value;
    } catch (error) {
      this.logger.error(
        `Failed to execute factory function for key ${key}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Deletes value from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clears all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.logger.log('Cache cleared');
  }

  /**
   * Checks if key exists in cache
   */
  has(key: string): boolean {
    const item = this.cache.get(key);

    if (!item) {
      return false;
    }

    // Check if item has expired
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      this.stats.evictions++;
      return false;
    }

    return true;
  }

  /**
   * Gets cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      evictions: this.stats.evictions,
    };
  }

  /**
   * Cleans expired entries from cache
   */
  cleanExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        this.cache.delete(key);
        cleaned++;
        this.stats.evictions++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned ${cleaned} expired cache entries`);
    }

    return cleaned;
  }

  /**
   * Gets all cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Gets cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Caches website validation results
   */
  async cacheWebsiteValidation(
    url: string,
    isValid: boolean,
    ttl: number = 3600000,
  ): Promise<void> {
    const key = `website:${url}`;
    this.set(key, { isValid, timestamp: Date.now() }, ttl);
  }

  /**
   * Gets cached website validation result
   */
  getCachedWebsiteValidation(
    url: string,
  ): { isValid: boolean; timestamp: number } | null {
    const key = `website:${url}`;
    return this.get(key);
  }

  /**
   * Caches email validation results
   */
  async cacheEmailValidation(
    email: string,
    result: any,
    ttl: number = 86400000,
  ): Promise<void> {
    // 24 hours
    const key = `email:${email}`;
    this.set(key, result, ttl);
  }

  /**
   * Gets cached email validation result
   */
  getCachedEmailValidation(email: string): any {
    const key = `email:${email}`;
    return this.get(key);
  }

  /**
   * Caches Google Search results
   */
  async cacheGoogleSearchResult(
    query: string,
    result: any,
    ttl: number = 86400000,
  ): Promise<void> {
    // 24 hours
    const key = `google:${query}`;
    this.set(key, result, ttl);
  }

  /**
   * Gets cached Google Search result
   */
  getCachedGoogleSearchResult(query: string): any {
    const key = `google:${query}`;
    return this.get(key);
  }

  /**
   * Caches DNS validation results
   */
  async cacheDnsValidation(
    domain: string,
    result: any,
    ttl: number = 86400000,
  ): Promise<void> {
    // 24 hours
    const key = `dns:${domain}`;
    this.set(key, result, ttl);
  }

  /**
   * Gets cached DNS validation result
   */
  getCachedDnsValidation(domain: string): any {
    const key = `dns:${domain}`;
    return this.get(key);
  }

  /**
   * Caches duplicate detection results
   */
  async cacheDuplicateDetection(
    hash: string,
    result: any,
    ttl: number = 3600000,
  ): Promise<void> {
    // 1 hour
    const key = `duplicate:${hash}`;
    this.set(key, result, ttl);
  }

  /**
   * Gets cached duplicate detection result
   */
  getCachedDuplicateDetection(hash: string): any {
    const key = `duplicate:${hash}`;
    return this.get(key);
  }

  /**
   * Sets up automatic cache cleanup
   */
  startCleanupInterval(intervalMs: number = 300000): void {
    // Default 5 minutes
    setInterval(() => {
      const cleaned = this.cleanExpired();
      if (cleaned > 0) {
        this.logger.debug(
          `Automatic cleanup: removed ${cleaned} expired entries`,
        );
      }
    }, intervalMs);

    this.logger.log(`Started automatic cache cleanup every ${intervalMs}ms`);
  }

  /**
   * Gets cache memory usage estimate
   */
  getMemoryUsage(): { estimatedSize: number; entryCount: number } {
    let estimatedSize = 0;

    for (const [key, item] of this.cache.entries()) {
      estimatedSize += key.length * 2; // Approximate string size
      estimatedSize += JSON.stringify(item).length * 2; // Approximate object size
    }

    return {
      estimatedSize,
      entryCount: this.cache.size,
    };
  }

  /**
   * Evicts least recently used entries
   */
  evictLRU(maxSize: number): number {
    if (this.cache.size <= maxSize) {
      return 0;
    }

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toEvict = entries.slice(0, this.cache.size - maxSize);
    let evicted = 0;

    for (const [key] of toEvict) {
      if (this.cache.delete(key)) {
        evicted++;
        this.stats.evictions++;
      }
    }

    this.logger.debug(`Evicted ${evicted} LRU entries`);
    return evicted;
  }

  /**
   * Resets cache statistics
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.evictions = 0;
    this.logger.log('Cache statistics reset');
  }
}
