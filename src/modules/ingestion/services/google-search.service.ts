import { Injectable } from '@nestjs/common';
import { googleSearchConfig, GoogleSearchResponse, GoogleSearchResult } from '../config/google-search.config';

@Injectable()
export class GoogleSearchService {
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
    const searchUrl = `${googleSearchConfig.baseUrl}?key=${googleSearchConfig.apiKey}&cx=${googleSearchConfig.cseId}&q=${encodeURIComponent(query)}&num=${googleSearchConfig.defaultNumResults}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), googleSearchConfig.timeout);
    
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
    if (socialMediaIndicators.some(indicator => link.includes(indicator))) {
      return false;
    }
    
    // Prefer results with business indicators
    return businessIndicators.some(indicator => 
      title.includes(indicator) || snippet.includes(indicator)
    );
  }

  async getSearchStats(): Promise<{ totalResults: number; searchTime: string } | null> {
    try {
      const testQuery = 'test search';
      const searchUrl = `${googleSearchConfig.baseUrl}?key=${googleSearchConfig.apiKey}&cx=${googleSearchConfig.cseId}&q=${encodeURIComponent(testQuery)}&num=1`;
      
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
