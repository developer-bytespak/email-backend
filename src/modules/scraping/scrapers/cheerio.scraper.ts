import { Injectable } from '@nestjs/common';
import axios, { AxiosProxyConfig } from 'axios';
import * as cheerio from 'cheerio';
import { ProxyManagerService } from './proxy-manager.service';

@Injectable()
export class CheerioScraperService {
  constructor(
    private readonly proxyManager: ProxyManagerService,
  ) {}

  /**
   * Scrape a website using Cheerio (fast, for static content)
   */
  async scrapeUrl(url: string): Promise<any> {
    console.log(`[CHEERIO] Scraping URL: ${url}`);
    
    // Add protocol if missing
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    
    // Limit total attempts across all proxies (max 2 different proxies - reduced for faster failure)
    const maxTotalAttempts = this.proxyManager.hasProxies() ? 2 : 1;
    
    // Try with proxy rotation if available
    for (let attempt = 0; attempt < maxTotalAttempts; attempt++) {
      let proxy: any = null;
      try {
        // Get proxy for this request (rotates automatically)
        proxy = this.proxyManager.getNextProxy();
        const axiosProxy = this.proxyManager.getAxiosProxy(proxy);
        
        if (proxy) {
          console.log(`[CHEERIO] Using proxy: ${proxy.server} (attempt ${attempt + 1}/${maxTotalAttempts})`);
        } else {
          console.log(`[CHEERIO] No proxy configured, using direct connection`);
        }
        
        // Build request config
        const requestConfig: any = {
          headers: {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
          },
          timeout: 15000, // 15 second timeout
          maxRedirects: 5,
        };
        
        // Add proxy if available
        // Note: For HTTPS sites, use HTTP proxy protocol (not HTTPS)
        if (axiosProxy) {
          requestConfig.proxy = {
            protocol: 'http', // Always use HTTP protocol for proxy, even for HTTPS sites
            host: axiosProxy.host,
            port: axiosProxy.port,
            auth: axiosProxy.auth,
          } as AxiosProxyConfig;
        }
        
        // Make HTTP request with proper headers
        const response = await axios.get(fullUrl, requestConfig);

        // Parse HTML with Cheerio
        const $ = cheerio.load(response.data);
        
        // Extract content
        const title = $('title').text().trim();
        const metaDescription = $('meta[name="description"]').attr('content') || null;
        
        // Remove script and style elements
        $('script, style, nav, header, footer').remove();
        
        // Get main content
        const content = this.extractMainContent($);
        const html = $.html();
        
        // Extract emails and phones
        const extractedEmails = this.extractEmails(content);
        const extractedPhones = this.extractPhones(content);
        
        // Extract internal links
        const links = this.extractInternalLinks($, fullUrl);
        
        return {
          url: fullUrl,
          title,
          content: this.cleanText(content),
          html,
          metaDescription,
          extractedEmails,
          extractedPhones,
          links,
          scrapeSuccess: true,
          timestamp: new Date().toISOString(),
        };
        
      } catch (error) {
        const errorMessage = error.message || String(error);
        const isSSLProtocolError = errorMessage.includes('EPROTO') || 
                                   errorMessage.includes('wrong version number') ||
                                   errorMessage.includes('SSL routines');
        
        console.error(`[CHEERIO] Scraping failed for ${url} (attempt ${attempt + 1}/${maxTotalAttempts}):`, errorMessage);
        
        // For SSL/protocol errors, mark proxy as failed (proxy might not support HTTPS properly)
        if (isSSLProtocolError && proxy) {
          this.proxyManager.markProxyFailed(proxy);
          console.log(`[CHEERIO] Proxy ${proxy.server} failed SSL handshake, marking as failed`);
        } else if (!isSSLProtocolError && proxy) {
          // For other errors, also mark as failed
          this.proxyManager.markProxyFailed(proxy);
        }
        
        // If this was the last attempt, throw error
        if (attempt === maxTotalAttempts - 1) {
          throw new Error(`Unable to access website after ${maxTotalAttempts} proxy attempts. The site may be blocking automated access or temporarily unavailable.`);
        }
        
        // Wait a bit before retrying with next proxy
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // This should never be reached, but TypeScript needs it
    throw new Error(`Unable to access website after ${maxTotalAttempts} attempts. All proxy attempts exhausted.`);
  }

  /**
   * Extract main content from the page
   */
  private extractMainContent($: cheerio.CheerioAPI): string {
    // Try different content selectors in order of preference
    const contentSelectors = [
      'main',
      'article',
      '.content',
      '.main-content',
      '#content',
      '.post',
      '.entry',
      'body'
    ];
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        return element.text();
      }
    }
    
    return $('body').text();
  }

  /**
   * Extract clean text from HTML
   */
  extractText(html: string): string {
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer').remove();
    return this.cleanText($('body').text());
  }

  /**
   * Extract emails from text content
   */
  extractEmails(text: string): string[] {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = text.match(emailRegex) || [];
    return [...new Set(emails)]; // Remove duplicates
  }

  /**
   * Extract phone numbers from text content
   */
  extractPhones(text: string): string[] {
    const phoneRegex = /(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
    const phones = text.match(phoneRegex) || [];
    return [...new Set(phones)]; // Remove duplicates
  }

  /**
   * Extract internal links from the page
   */
  private extractInternalLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
    const baseDomain = new URL(baseUrl).hostname;
    const links: string[] = [];
    
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        try {
          const fullUrl = new URL(href, baseUrl).href;
          const linkDomain = new URL(fullUrl).hostname;
          
          // Only include internal links
          if (linkDomain === baseDomain) {
            links.push(fullUrl);
          }
        } catch (error) {
          // Invalid URL, skip
        }
      }
    });
    
    return [...new Set(links)]; // Remove duplicates
  }

  /**
   * Clean and normalize text content
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();
  }

  /**
   * Get random user agent
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }
}
