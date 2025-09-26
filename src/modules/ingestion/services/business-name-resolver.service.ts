import { Injectable } from '@nestjs/common';
import { GoogleSearchService } from './google-search.service';

export interface BusinessNameResolutionResult {
  website?: string;
  confidence: 'high' | 'medium' | 'low';
  error?: string;
}

@Injectable()
export class BusinessNameResolverService {
  constructor(private readonly googleSearchService: GoogleSearchService) {}

  /**
   * Resolves business name to website using Google Search API
   */
  async resolveBusinessNameToWebsite(businessName: string): Promise<BusinessNameResolutionResult> {
    if (!businessName || businessName.trim().length < 2) {
      return {
        confidence: 'low',
        error: 'Business name is too short'
      };
    }

    try {
      const website = await this.googleSearchService.searchBusinessWebsite(businessName);
      
      if (website) {
        // Validate that the website is accessible
        const isAccessible = await this.isWebsiteAccessible(website);
        
        if (isAccessible) {
          return {
            website,
            confidence: 'high'
          };
        } else {
          return {
            website,
            confidence: 'medium',
            error: 'Website found but not accessible'
          };
        }
      }

      return {
        confidence: 'low',
        error: 'No website found for business name'
      };
    } catch (error) {
      return {
        confidence: 'low',
        error: `Business name resolution failed: ${error.message}`
      };
    }
  }

  /**
   * Validates business name format and content
   */
  validateBusinessName(businessName: string): { isValid: boolean; reason?: string } {
    if (!businessName || typeof businessName !== 'string') {
      return {
        isValid: false,
        reason: 'Business name is required'
      };
    }

    const trimmed = businessName.trim();

    if (trimmed.length < 2) {
      return {
        isValid: false,
        reason: 'Business name must be at least 2 characters long'
      };
    }

    if (trimmed.length > 100) {
      return {
        isValid: false,
        reason: 'Business name must be less than 100 characters'
      };
    }

    // Check for invalid characters
    const invalidChars = /[<>{}[\]\\|`~!@#$%^&*()+=\/]/;
    if (invalidChars.test(trimmed)) {
      return {
        isValid: false,
        reason: 'Business name contains invalid characters'
      };
    }

    return {
      isValid: true
    };
  }

  /**
   * Normalizes business name for consistent processing
   */
  normalizeBusinessName(businessName: string): string {
    return businessName
      .trim()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/[^\w\s\-&.,]/g, '') // Remove special characters except common business name chars
      .trim();
  }

  /**
   * Extracts potential business names from text
   */
  extractBusinessNames(text: string): string[] {
    // Simple extraction - in production, you might use NLP libraries
    const words = text.split(/\s+/);
    const businessNames: string[] = [];
    
    // Look for patterns like "Company Name LLC", "Business Name Inc", etc.
    const businessSuffixes = ['LLC', 'Inc', 'Corp', 'Ltd', 'Co', 'Company', 'Business'];
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (businessSuffixes.some(suffix => word.toLowerCase().includes(suffix.toLowerCase()))) {
        // Extract the preceding words as potential business name
        const startIndex = Math.max(0, i - 3);
        const businessName = words.slice(startIndex, i + 1).join(' ');
        if (businessName.length > 2) {
          businessNames.push(businessName);
        }
      }
    }
    
    return businessNames;
  }

  /**
   * Checks if a business name looks legitimate
   */
  isLegitimateBusinessName(businessName: string): boolean {
    const normalized = this.normalizeBusinessName(businessName);
    
    // Check for common non-business patterns
    const nonBusinessPatterns = [
      /^\d+$/, // Just numbers
      /^[a-z]$/i, // Single letter
      /test/i, // Test entries
      /example/i, // Example entries
      /sample/i, // Sample entries
      /dummy/i, // Dummy entries
      /fake/i, // Fake entries
    ];

    return !nonBusinessPatterns.some(pattern => pattern.test(normalized));
  }

  /**
   * Checks if website is accessible
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
      return false;
    }
  }
}
