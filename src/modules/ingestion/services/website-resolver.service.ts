import { Injectable } from '@nestjs/common';
import { GoogleSearchService } from './google-search.service';

export interface WebsiteResolutionResult {
  website?: string;
  source: 'direct' | 'email_domain' | 'google_search' | 'failed';
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}

@Injectable()
export class WebsiteResolverService {
  constructor(private readonly googleSearchService: GoogleSearchService) {}

  /**
   * Resolves website using the complete pipeline
   */
  async resolveWebsite(
    businessName?: string,
    email?: string,
    website?: string
  ): Promise<WebsiteResolutionResult> {
    // Step 1: Direct Website Validation
    if (website) {
      const directResult = await this.validateDirectWebsite(website);
      if (directResult.confidence === 'high') {
        return directResult;
      }
    }

    // Step 2: Email Domain Inference
    if (email) {
      const emailResult = await this.inferWebsiteFromEmail(email);
      if (emailResult.confidence === 'high') {
        return emailResult;
      }
    }

    // Step 3: Business Name Resolution
    if (businessName) {
      const businessResult = await this.resolveWebsiteFromBusinessName(businessName);
      if (businessResult.confidence === 'high') {
        return businessResult;
      }
    }

    return {
      source: 'failed',
      confidence: 'low',
      error: 'Unable to resolve website from any available source'
    };
  }

  /**
   * Validates if a website is accessible
   */
  async validateDirectWebsite(website: string): Promise<WebsiteResolutionResult> {
    try {
      const normalizedUrl = this.normalizeUrl(website);
      const isAccessible = await this.isWebsiteAccessible(normalizedUrl);
      
      if (isAccessible) {
        return {
          website: normalizedUrl,
          source: 'direct',
          confidence: 'high'
        };
      }

      return {
        source: 'direct',
        confidence: 'low',
        error: 'Website is not accessible'
      };
    } catch (error) {
      return {
        source: 'direct',
        confidence: 'low',
        error: `Website validation failed: ${error.message}`
      };
    }
  }

  /**
   * Infers website from email domain
   */
  async inferWebsiteFromEmail(email: string): Promise<WebsiteResolutionResult> {
    try {
      const domain = this.extractDomainFromEmail(email);
      
      if (!domain) {
        return {
          source: 'email_domain',
          confidence: 'low',
          error: 'Invalid email format'
        };
      }

      // Skip free email domains
      if (this.isFreeEmailDomain(domain)) {
        return {
          source: 'email_domain',
          confidence: 'low',
          error: 'Free email domain detected'
        };
      }

      const website = `https://${domain}`;
      const isAccessible = await this.isWebsiteAccessible(website);
      
      if (isAccessible) {
        return {
          website,
          source: 'email_domain',
          confidence: 'high'
        };
      }

      return {
        source: 'email_domain',
        confidence: 'low',
        error: 'Email domain is not accessible'
      };
    } catch (error) {
      return {
        source: 'email_domain',
        confidence: 'low',
        error: `Email domain inference failed: ${error.message}`
      };
    }
  }

  /**
   * Resolves website from business name using Google Search
   */
  async resolveWebsiteFromBusinessName(businessName: string): Promise<WebsiteResolutionResult> {
    try {
      const website = await this.googleSearchService.searchBusinessWebsite(businessName);
      
      if (website) {
        const isAccessible = await this.isWebsiteAccessible(website);
        
        if (isAccessible) {
          return {
            website,
            source: 'google_search',
            confidence: 'high'
          };
        }
      }

      return {
        source: 'google_search',
        confidence: 'low',
        error: 'Business name could not be resolved to website'
      };
    } catch (error) {
      return {
        source: 'google_search',
        confidence: 'low',
        error: `Business name resolution failed: ${error.message}`
      };
    }
  }

  /**
   * Checks if a website is accessible
   */
  private async isWebsiteAccessible(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EmailSystemBot/1.0)'
        }
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      // If HEAD request fails, try GET request
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; EmailSystemBot/1.0)'
          }
        });

        clearTimeout(timeoutId);
        return response.ok;
      } catch (getError) {
        return false;
      }
    }
  }

  /**
   * Normalizes URL format
   */
  private normalizeUrl(url: string): string {
    let normalized = url.trim().toLowerCase();
    
    // Add protocol if missing
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    
    // Remove trailing slash
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    
    return normalized;
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
    const freeDomains = [
      'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
      'protonmail.com', 'icloud.com', 'aol.com', 'live.com',
      'msn.com', 'zoho.com', 'mail.com', 'yandex.com'
    ];
    
    return freeDomains.includes(domain.toLowerCase());
  }
}
