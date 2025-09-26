import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'dns/promises';

export interface DnsValidationResult {
  isValid: boolean;
  hasMxRecord: boolean;
  hasARecord: boolean;
  mxRecords?: string[];
  aRecords?: string[];
  error?: string;
  timestamp?: number;
}

export interface EmailDomainValidationResult {
  domain: string;
  isValid: boolean;
  hasMxRecord: boolean;
  hasARecord: boolean;
  isFreeEmail: boolean;
  credibilityScore: number;
  error?: string;
}

@Injectable()
export class DnsValidationService {
  private readonly logger = new Logger(DnsValidationService.name);
  private readonly cache = new Map<string, DnsValidationResult>();
  private readonly cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours

  private readonly freeEmailDomains = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'protonmail.com',
    'icloud.com',
    'aol.com',
    'live.com',
    'msn.com',
    'zoho.com',
    'mail.com',
    'yandex.com',
    'gmx.com',
    'web.de',
    'tutanota.com',
    'fastmail.com',
  ];

  /**
   * Validates email domain using DNS MX and A records
   */
  async validateEmailDomain(
    email: string,
  ): Promise<EmailDomainValidationResult> {
    const domain = this.extractDomainFromEmail(email);

    if (!domain) {
      return {
        domain: '',
        isValid: false,
        hasMxRecord: false,
        hasARecord: false,
        isFreeEmail: false,
        credibilityScore: 0,
        error: 'Invalid email format',
      };
    }

    const isFreeEmail = this.isFreeEmailDomain(domain);
    const dnsResult = await this.validateDomainDns(domain);
    const credibilityScore = this.calculateDomainCredibility(domain, dnsResult);

    return {
      domain,
      isValid: dnsResult.isValid,
      hasMxRecord: dnsResult.hasMxRecord,
      hasARecord: dnsResult.hasARecord,
      isFreeEmail,
      credibilityScore,
      error: dnsResult.error,
    };
  }

  /**
   * Validates domain DNS records
   */
  async validateDomainDns(domain: string): Promise<DnsValidationResult> {
    // Check cache first
    const cached = this.getCachedResult(domain);
    if (cached) {
      return cached;
    }

    try {
      const [mxRecords, aRecords] = await Promise.allSettled([
        this.getMxRecords(domain),
        this.getARecords(domain),
      ]);

      const result: DnsValidationResult = {
        isValid: false,
        hasMxRecord: false,
        hasARecord: false,
      };

      // Process MX records
      if (mxRecords.status === 'fulfilled' && mxRecords.value.length > 0) {
        result.hasMxRecord = true;
        result.mxRecords = mxRecords.value;
      }

      // Process A records
      if (aRecords.status === 'fulfilled' && aRecords.value.length > 0) {
        result.hasARecord = true;
        result.aRecords = aRecords.value;
      }

      // Domain is valid if it has either MX or A records
      result.isValid = result.hasMxRecord || result.hasARecord;

      // Cache the result
      this.setCachedResult(domain, result);

      return result;
    } catch (error) {
      const result: DnsValidationResult = {
        isValid: false,
        hasMxRecord: false,
        hasARecord: false,
        error: `DNS validation failed: ${error.message}`,
      };

      this.logger.error(
        `DNS validation failed for domain ${domain}: ${error.message}`,
      );
      return result;
    }
  }

  /**
   * Gets MX records for a domain
   */
  private async getMxRecords(domain: string): Promise<string[]> {
    try {
      const mxRecords = await dns.resolveMx(domain);
      return mxRecords.map((record) => record.exchange);
    } catch (error) {
      this.logger.debug(`No MX records found for domain ${domain}`);
      return [];
    }
  }

  /**
   * Gets A records for a domain
   */
  private async getARecords(domain: string): Promise<string[]> {
    try {
      const aRecords = await dns.resolve4(domain);
      return aRecords;
    } catch (error) {
      this.logger.debug(`No A records found for domain ${domain}`);
      return [];
    }
  }

  /**
   * Validates multiple email domains in batch
   */
  async validateEmailDomainsBatch(
    emails: string[],
  ): Promise<EmailDomainValidationResult[]> {
    const domains = emails.map((email) => this.extractDomainFromEmail(email));
    const uniqueDomains = [...new Set(domains.filter((domain) => domain))];

    const domainResults = await Promise.allSettled(
      uniqueDomains.map((domain) =>
        domain
          ? this.validateDomainDns(domain)
          : Promise.resolve({
              isValid: false,
              hasMxRecord: false,
              hasARecord: false,
              error: 'Invalid domain',
            }),
      ),
    );

    const domainMap = new Map<string, DnsValidationResult>();
    uniqueDomains.forEach((domain, index) => {
      if (!domain) return; // Skip null domains
      const result = domainResults[index];
      if (result.status === 'fulfilled') {
        domainMap.set(domain, result.value);
      } else {
        domainMap.set(domain, {
          isValid: false,
          hasMxRecord: false,
          hasARecord: false,
          error: `Validation failed: ${result.reason}`,
        });
      }
    });

    return emails.map((email) => {
      const domain = this.extractDomainFromEmail(email);
      if (!domain) {
        return {
          domain: '',
          isValid: false,
          hasMxRecord: false,
          hasARecord: false,
          isFreeEmail: false,
          credibilityScore: 0,
          error: 'Invalid email format',
        };
      }

      const dnsResult = domainMap.get(domain) || {
        isValid: false,
        hasMxRecord: false,
        hasARecord: false,
        error: 'Domain not found',
      };

      return {
        domain,
        isValid: dnsResult.isValid,
        hasMxRecord: dnsResult.hasMxRecord,
        hasARecord: dnsResult.hasARecord,
        isFreeEmail: this.isFreeEmailDomain(domain),
        credibilityScore: this.calculateDomainCredibility(domain, dnsResult),
        error: dnsResult.error,
      };
    });
  }

  /**
   * Extracts domain from email address
   */
  private extractDomainFromEmail(email: string): string | null {
    const emailRegex = /^[^\s@]+@([^\s@]+)$/;
    const match = email.match(emailRegex);
    return match ? match[1] : null;
  }

  /**
   * Checks if domain is a free email provider
   */
  private isFreeEmailDomain(domain: string): boolean {
    return this.freeEmailDomains.includes(domain.toLowerCase());
  }

  /**
   * Calculates domain credibility score
   */
  private calculateDomainCredibility(
    domain: string,
    dnsResult: DnsValidationResult,
  ): number {
    let score = 0;

    // Base score for valid domain
    if (dnsResult.isValid) {
      score += 5;
    }

    // Bonus for MX records (indicates email hosting)
    if (dnsResult.hasMxRecord) {
      score += 3;
    }

    // Bonus for A records (indicates web hosting)
    if (dnsResult.hasARecord) {
      score += 2;
    }

    // Penalty for free email domains
    if (this.isFreeEmailDomain(domain)) {
      score = 0;
    }

    // Bonus for shorter domains (more premium)
    if (domain.length < 10) {
      score += 2;
    } else if (domain.length < 15) {
      score += 1;
    }

    // Penalty for numbers in domain
    if (/\d/.test(domain)) {
      score -= 1;
    }

    // Penalty for hyphens
    if (/-/.test(domain)) {
      score -= 1;
    }

    return Math.max(0, Math.min(10, score));
  }

  /**
   * Gets cached DNS validation result
   */
  private getCachedResult(domain: string): DnsValidationResult | null {
    const cached = this.cache.get(domain);
    if (
      cached &&
      cached.timestamp &&
      Date.now() - cached.timestamp < this.cacheTimeout
    ) {
      return cached;
    }
    return null;
  }

  /**
   * Sets cached DNS validation result
   */
  private setCachedResult(domain: string, result: DnsValidationResult): void {
    const cached = {
      ...result,
      timestamp: Date.now(),
    };
    this.cache.set(domain, cached);
  }

  /**
   * Clears DNS cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('DNS cache cleared');
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): { size: number; domains: string[] } {
    return {
      size: this.cache.size,
      domains: Array.from(this.cache.keys()),
    };
  }

  /**
   * Validates domain format
   */
  validateDomainFormat(domain: string): boolean {
    const domainRegex =
      /^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$/;
    return domainRegex.test(domain);
  }

  /**
   * Gets list of free email domains
   */
  getFreeEmailDomains(): string[] {
    return [...this.freeEmailDomains];
  }

  /**
   * Checks if domain is likely a business domain
   */
  isBusinessDomain(domain: string): boolean {
    if (this.isFreeEmailDomain(domain)) {
      return false;
    }

    // Check for common business TLDs
    const businessTlds = ['.com', '.org', '.net', '.co', '.biz', '.info'];
    return businessTlds.some((tld) => domain.toLowerCase().endsWith(tld));
  }
}
