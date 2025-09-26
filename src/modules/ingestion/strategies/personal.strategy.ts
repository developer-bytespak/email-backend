import { Injectable } from '@nestjs/common';
import { Contact } from '@prisma/client';
import {
  ProcessingStrategy,
  ValidationResult,
} from './processing-strategy.interface';
import { GoogleSearchService } from '../services/google-search.service';

@Injectable()
export class PersonalStrategy implements ProcessingStrategy {
  constructor(private readonly googleSearchService: GoogleSearchService) {}
  getPlanName(): string {
    return 'personal';
  }

  getFeatures() {
    return {
      websiteResolution: true,
      googleSearchAPI: true,
      emailValidation: true,
      businessNameResolution: true,
    };
  }

  async validateContact(contact: Contact): Promise<ValidationResult> {
    // Personal plan: Comprehensive validation

    // Check mandatory fields
    const hasRequiredField =
      contact.businessName || contact.email || contact.website;
    if (!hasRequiredField) {
      return {
        isValid: false,
        reason: 'At least one of businessName, email, or website is required',
      };
    }

    // Validate email if present
    if (contact.email) {
      const emailValidation = this.validateEmail(contact.email);
      if (!emailValidation.isValid) {
        return {
          isValid: false,
          reason: emailValidation.reason,
        };
      }
    }

    // Validate website if present
    if (contact.website) {
      const websiteValidation = await this.validateWebsite(contact.website);
      if (!websiteValidation.isValid) {
        return {
          isValid: false,
          reason: websiteValidation.reason,
        };
      }
    }

    // Validate business name if present
    if (contact.businessName) {
      const businessNameValidation = this.validateBusinessName(
        contact.businessName,
      );
      if (!businessNameValidation.isValid) {
        return {
          isValid: false,
          reason: businessNameValidation.reason,
        };
      }
    }

    return {
      isValid: true,
    };
  }

  async resolveWebsite(contact: Contact): Promise<string | null> {
    // Personal plan: Full website resolution pipeline

    // Step 1: Direct website validation
    if (contact.website) {
      const isValid = await this.isWebsiteAccessible(contact.website);
      if (isValid) {
        return contact.website;
      }
    }

    // Step 2: Email domain inference
    if (contact.email) {
      const inferredWebsite = await this.inferWebsiteFromEmail(contact.email);
      if (inferredWebsite) {
        return inferredWebsite;
      }
    }

    // Step 3: Business name resolution (Google Search API)
    if (contact.businessName) {
      const resolvedWebsite = await this.resolveWebsiteFromBusinessName(
        contact.businessName,
      );
      if (resolvedWebsite) {
        return resolvedWebsite;
      }
    }

    return null;
  }

  shouldProcessWebsite(contact: Contact): boolean {
    // Personal plan: Always process websites
    return true;
  }

  private validateEmail(email: string): ValidationResult {
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        isValid: false,
        reason: 'Invalid email format',
      };
    }

    return {
      isValid: true,
    };
  }

  private async validateWebsite(website: string): Promise<ValidationResult> {
    // Basic URL format validation
    try {
      new URL(website);
    } catch {
      return {
        isValid: false,
        reason: 'Invalid URL format',
      };
    }

    // Check if website is accessible
    const isAccessible = await this.isWebsiteAccessible(website);
    if (!isAccessible) {
      return {
        isValid: false,
        reason: 'Website is not accessible',
      };
    }

    return {
      isValid: true,
    };
  }

  private validateBusinessName(businessName: string): ValidationResult {
    if (businessName.length < 2) {
      return {
        isValid: false,
        reason: 'Business name must be at least 2 characters long',
      };
    }

    return {
      isValid: true,
    };
  }

  private async isWebsiteAccessible(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EmailSystemBot/1.0)',
        },
      });

      clearTimeout(timeoutId);

      // Consider 2xx and 3xx status codes as accessible
      return response.status >= 200 && response.status < 400;
    } catch (error) {
      console.warn(
        `Website accessibility check failed for ${url}:`,
        error.message,
      );
      return false;
    }
  }

  private async inferWebsiteFromEmail(email: string): Promise<string | null> {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return null;

    // Skip free email domains
    const freeEmailDomains = [
      'gmail.com',
      'yahoo.com',
      'hotmail.com',
      'outlook.com',
      'protonmail.com',
      'icloud.com',
      'aol.com',
      'live.com',
    ];

    if (freeEmailDomains.includes(domain)) {
      return null;
    }

    const website = `https://${domain}`;
    const isAccessible = await this.isWebsiteAccessible(website);

    return isAccessible ? website : null;
  }

  private async resolveWebsiteFromBusinessName(
    businessName: string,
  ): Promise<string | null> {
    try {
      const website =
        await this.googleSearchService.searchBusinessWebsite(businessName);

      if (website) {
        // Validate that the website is accessible
        const isAccessible = await this.isWebsiteAccessible(website);
        if (isAccessible) {
          return website;
        }
      }

      return null;
    } catch (error) {
      console.error('Website resolution error:', error);
      return null;
    }
  }
}
