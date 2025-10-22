import { Injectable } from '@nestjs/common';
import { chromium, Browser, Page } from 'playwright';

@Injectable()
export class PlaywrightScraperService {
  private browser: Browser | null = null;

  /**
   * Scrape a website using Playwright (for dynamic/JS-heavy pages)
   */
  async scrapeUrl(url: string): Promise<any> {
    console.log(`[PLAYWRIGHT] Scraping dynamic URL: ${url}`);
    
    let page: Page | null = null;
    
    try {
      // Add protocol if missing
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      
      // Launch browser if not already running
      if (!this.browser) {
        this.browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
          ]
        });
      }

      // Create new page with user agent
      const context = await this.browser.newContext({
        userAgent: this.getRandomUserAgent(),
      });
      page = await context.newPage();
      
      // Set viewport
      await page.setViewportSize({ width: 1920, height: 1080 });
      
      // Navigate to page
      await page.goto(fullUrl, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });
      
      // Wait for content to load
      await page.waitForTimeout(2000);
      
      // Extract content
      const title = await page.title();
      const metaDescription = await page.$eval('meta[name="description"]', 
        el => el.getAttribute('content')).catch(() => null);
      
      // Get page content
      const content = await page.evaluate(() => {
        // Remove script and style elements
        const scripts = document.querySelectorAll('script, style, nav, header, footer');
        scripts.forEach(el => el.remove());
        
        // Get main content
        const contentSelectors = [
          'main', 'article', '.content', '.main-content', 
          '#content', '.post', '.entry', 'body'
        ];
        
        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            return element.textContent || '';
          }
        }
        
        return document.body.textContent || '';
      });
      
      // Get HTML content
      const html = await page.content();
      
      // Extract emails and phones
      const extractedEmails = this.extractEmails(content);
      const extractedPhones = this.extractPhones(content);
      
      // Extract links
      const links = await page.evaluate(() => {
        const linkElements = document.querySelectorAll('a[href]');
        return Array.from(linkElements)
          .map(el => el.getAttribute('href'))
          .filter(href => href && href.startsWith('http'));
      });
      
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
      console.error(`[PLAYWRIGHT] Scraping failed for ${url}:`, error.message);
      throw new Error(`Playwright scraping failed: ${error.message}`);
    } finally {
      if (page) {
        await page.close();
      }
    }
  }

  /**
   * Extract clean text from HTML
   */
  extractText(html: string): string {
    // This would be used for post-processing HTML content
    return this.cleanText(html.replace(/<[^>]*>/g, ''));
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
   * Check if page requires JavaScript (dynamic content)
   */
  async isDynamicPage(url: string): Promise<boolean> {
    try {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      
      if (!this.browser) {
        this.browser = await chromium.launch({ headless: true });
      }
      
      const page = await this.browser.newPage();
      
      // Navigate with JavaScript disabled
      await page.goto(fullUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });
      
      const contentLength = (await page.content()).length;
      await page.close();
      
      // If content is very short, likely needs JS
      return contentLength < 1000;
      
    } catch (error) {
      console.error(`[PLAYWRIGHT] Dynamic check failed for ${url}:`, error.message);
      return false;
    }
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

  /**
   * Cleanup browser instance
   */
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
