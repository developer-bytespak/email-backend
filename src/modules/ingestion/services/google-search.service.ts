import { Injectable, Logger } from '@nestjs/common';

export interface GoogleSearchResponse {
  items?: GoogleSearchResult[];
  searchInformation?: {
    totalResults: string;
    searchTime: number;
  };
  error?: {
    code: number;
    message: string;
  };
}

export interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
  displayLink: string;
}

@Injectable()
export class GoogleSearchService {
  private readonly logger = new Logger(GoogleSearchService.name);

  async searchBusinessWebsite(businessName: string): Promise<string | null> {
    try {
      const searchQuery = `${businessName} official website`;
      const results = await this.performSearch(searchQuery);

      if (results && results.length > 0) {
        // Return the first result that looks like a business website
        for (const result of results) {
          if (this.isBusinessWebsite(result)) {
            return result.link;
          }
        }

        // If no business website found, return the first result
        return results[0].link;
      }

      return null;
    } catch (error) {
      console.error('Google Search API error:', error);
      return null;
    }
  }

  private async performSearch(query: string): Promise<GoogleSearchResult[]> {
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    const baseUrl = 'https://www.googleapis.com/customsearch/v1';
    const defaultNumResults = 5;
    const timeout = 10000;

    if (!apiKey || !searchEngineId) {
      this.logger.warn('Google Search API credentials not configured');
      return [];
    }

    const searchUrl = `${baseUrl}?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=${defaultNumResults}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EmailSystemBot/1.0)',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: GoogleSearchResponse = await response.json();
      return data.items || [];
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private isBusinessWebsite(result: GoogleSearchResult): boolean {
    const link = result.link.toLowerCase();
    const title = result.title.toLowerCase();
    const snippet = result.snippet.toLowerCase();

    // Check for business website indicators
    const businessIndicators = [
      'official website',
      'company website',
      'business website',
      'corporate website',
      'homepage',
    ];

    const socialMediaIndicators = [
      'facebook.com',
      'twitter.com',
      'linkedin.com',
      'instagram.com',
      'youtube.com',
    ];

    // Skip social media links
    if (socialMediaIndicators.some((indicator) => link.includes(indicator))) {
      return false;
    }

    // Prefer results with business indicators
    return businessIndicators.some(
      (indicator) => title.includes(indicator) || snippet.includes(indicator),
    );
  }

  async getSearchStats(): Promise<{
    totalResults: number;
    searchTime: string;
  } | null> {
    try {
      const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
      const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
      const baseUrl = 'https://www.googleapis.com/customsearch/v1';

      if (!apiKey || !searchEngineId) {
        this.logger.warn('Google Search API credentials not configured');
        return null;
      }

      const testQuery = 'test search';
      const searchUrl = `${baseUrl}?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(testQuery)}&num=1`;

      const response = await fetch(searchUrl);
      const data: GoogleSearchResponse = await response.json();

      return {
        totalResults: parseInt(data.searchInformation?.totalResults || '0'),
        searchTime: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Failed to get search stats:', error);
      return null;
    }
  }
}
