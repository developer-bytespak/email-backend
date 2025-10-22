import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class GoogleSearchService {
  private readonly apiKey: string;
  private readonly searchEngineId: string;
  private readonly baseUrl = 'https://www.googleapis.com/customsearch/v1';

  constructor() {
    this.apiKey = process.env.GOOGLE_API_KEY || '';
    this.searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';
    
    if (!this.apiKey || !this.searchEngineId) {
      console.warn('[GOOGLE] Missing Google Search API credentials');
    }
  }

  /**
   * Search for a business using Google Custom Search API
   */
  async searchBusiness(query: string): Promise<any> {
    console.log(`[GOOGLE] Searching for: ${query}`);
    
    if (!this.apiKey || !this.searchEngineId) {
      throw new Error('Google Search API credentials not configured');
    }

    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          key: this.apiKey,
          cx: this.searchEngineId,
          q: query,
          num: 10, // Maximum results per request
        },
        timeout: 10000, // 10 second timeout
      });

      const results = response.data.items?.map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
      })) || [];

      return {
        query,
        results,
        searchSuccess: true,
        totalResults: response.data.searchInformation?.totalResults || 0,
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      console.error(`[GOOGLE] Search failed for query "${query}":`, error.message);
      
      // Return empty results instead of throwing error
      return {
        query,
        results: [],
        searchSuccess: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Search by email domain
   */
  async searchByDomain(domain: string): Promise<any> {
    const query = `site:${domain}`;
    return this.searchBusiness(query);
  }

  /**
   * Search by business name and location (with smart location handling)
   */
  async searchByBusinessName(businessName: string, state?: string, zipCode?: string): Promise<any> {
    // Try multiple search query variations
    const searchQueries = this.buildSearchQueries(businessName, state, zipCode);
    
    for (const query of searchQueries) {
      console.log(`[GOOGLE] Trying search query: "${query}"`);
      
      // Get search results
      const searchResults = await this.searchBusiness(query);
      
      // Filter out invalid results (PDFs, documents, 404s, etc.)
      if (searchResults.results && searchResults.results.length > 0) {
        const validResults = searchResults.results.filter(result => 
          this.isValidWebsiteUrl(result.url)
        );
        
        if (validResults.length > 0) {
          console.log(`[GOOGLE] Found ${validResults.length} valid results with query: "${query}"`);
          return {
            ...searchResults,
            results: validResults
          };
        }
      }
      
      // Add small delay between search attempts
      await this.sleep(1000);
    }
    
    // If no valid results from any query, return last attempt
    console.log(`[GOOGLE] No valid results found with any search query`);
    return await this.searchBusiness(searchQueries[searchQueries.length - 1]);
  }

  /**
   * Build multiple search query variations
   */
  private buildSearchQueries(businessName: string, state?: string, zipCode?: string): string[] {
    const queries: string[] = [];
    
    // Query 1: Full location (business name + state + zipcode)
    if (state && zipCode) {
      queries.push(`${businessName} ${state} ${zipCode}`);
    }
    
    // Query 2: Business name + state only
    if (state) {
      queries.push(`${businessName} ${state}`);
    }
    
    // Query 3: Business name + zipcode only
    if (zipCode) {
      queries.push(`${businessName} ${zipCode}`);
    }
    
    // Query 4: Business name only
    queries.push(businessName);
    
    // Query 5: Business name with quotes (exact match)
    queries.push(`"${businessName}"`);
    
    // Remove duplicates and return
    return [...new Set(queries)];
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if URL is a valid website (not PDF, document, etc.)
   */
  private isValidWebsiteUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      
      // Filter out common non-website file types
      const invalidExtensions = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', 
        '.ppt', '.pptx', '.txt', '.csv', '.zip'
      ];
      
      const pathname = urlObj.pathname.toLowerCase();
      const hasInvalidExtension = invalidExtensions.some(ext => 
        pathname.endsWith(ext)
      );
      
      if (hasInvalidExtension) {
        return false;
      }
      
      // Filter out common non-website domains
      const invalidDomains = [
        'google.com', 'youtube.com', 'facebook.com', 
        'linkedin.com', 'twitter.com', 'instagram.com'
      ];
      
      const hostname = urlObj.hostname.toLowerCase();
      const hasInvalidDomain = invalidDomains.some(domain => 
        hostname.includes(domain)
      );
      
      if (hasInvalidDomain) {
        return false;
      }
      
      // Must be HTTP/HTTPS
      if (!urlObj.protocol.startsWith('http')) {
        return false;
      }
      
      return true;
    } catch (error) {
      // Invalid URL
      return false;
    }
  }

  /**
   * Check if Google Search API is configured
   */
  isConfigured(): boolean {
    return !!(this.apiKey && this.searchEngineId);
  }
}
