import { Injectable } from '@nestjs/common';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { ProxyManagerService } from './proxy-manager.service';

@Injectable()
export class PlaywrightScraperService {
  private browser: Browser | null = null;

  constructor(
    private readonly proxyManager: ProxyManagerService,
  ) {}

  /**
   * Scrape a website using Playwright (for dynamic/JS-heavy pages)
   */
  async scrapeUrl(url: string): Promise<any> {
    console.log(`[PLAYWRIGHT] Scraping dynamic URL: ${url}`);
    
    let page: Page | null = null;
    let context: BrowserContext | null = null;
    
    // Add protocol if missing
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    
    // Limit total attempts across all proxies (max 2 different proxies - reduced for faster failure)
    const maxTotalAttempts = this.proxyManager.hasProxies() ? 2 : 1;
    let cloudflareBlockCount = 0;
    const maxCloudflareBlocks = 1; // Stop immediately on first Cloudflare block
    
    // Try with proxy rotation if available
    for (let attempt = 0; attempt < maxTotalAttempts; attempt++) {
      let proxy: any = null;
      try {
        // Launch browser if not already running
        // Use non-headless mode for better Cloudflare bypass (set ENABLE_VISIBLE_BROWSER=true in .env)
        const useHeadless = process.env.ENABLE_VISIBLE_BROWSER !== 'true';
        
        if (!this.browser) {
          this.browser = await chromium.launch({
            headless: useHeadless,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-blink-features=AutomationControlled', // Hide automation
              '--disable-features=IsolateOrigins,site-per-process',
              '--disable-web-security',
              '--disable-features=VizDisplayCompositor',
              '--disable-infobars', // Hide "Chrome is being controlled by automated test software"
              '--window-size=1920,1080',
              '--start-maximized',
            ]
          });
        }

        // Get proxy for this request (rotates automatically)
        proxy = this.proxyManager.getNextProxy();
        const playwrightProxy = this.proxyManager.getPlaywrightProxy(proxy);
        
        if (proxy) {
          console.log(`[PLAYWRIGHT] Using proxy: ${proxy.server} (attempt ${attempt + 1}/${maxTotalAttempts})`);
        } else {
          console.log(`[PLAYWRIGHT] No proxy configured, using direct connection`);
        }

        // Get realistic user agent
        const userAgent = this.getRandomUserAgent();
        
        // Create new context with stealth settings
        const contextOptions: any = {
          userAgent: userAgent,
          viewport: { width: 1920, height: 1080 },
          screen: { width: 1920, height: 1080 },
          deviceScaleFactor: 1,
          locale: 'en-US',
          timezoneId: 'America/New_York',
          permissions: [],
          geolocation: { longitude: -74.006, latitude: 40.7128 }, // NYC coordinates
          colorScheme: 'light' as const,
          extraHTTPHeaders: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
          },
        };
        
        if (playwrightProxy) {
          contextOptions.proxy = playwrightProxy;
        }
        
        context = await this.browser.newContext(contextOptions);
        page = await context.newPage();
        
        // Remove webdriver detection
        await page.addInitScript(() => {
          // Override navigator.webdriver
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
          });
          
          // Override chrome object
          (window as any).chrome = {
            runtime: {},
          };
          
          // Override permissions
          const originalQuery = (window.navigator as any).permissions.query;
          (window.navigator as any).permissions.query = (parameters: any) => (
            parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission } as PermissionStatus) :
              originalQuery(parameters)
          );
          
          // Override plugins
          Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
          });
          
          // Override languages
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en'],
          });
        });
      
        // Block images, fonts, media, and other heavy resources to speed up scraping
        // We only need text content, so blocking these resources won't affect our scraping
        await page.route('**/*', (route) => {
          const resourceType = route.request().resourceType();
          // Block images, fonts, media files, but allow documents, scripts, stylesheets, and xhr/fetch
          if (['image', 'font', 'media'].includes(resourceType)) {
            route.abort();
          } else {
            route.continue();
          }
        });
        
        // Add random delay to appear more human-like (1-3 seconds)
        const randomDelay = Math.floor(Math.random() * 2000) + 1000;
        await page.waitForTimeout(randomDelay);
        
        // Navigate to page with realistic behavior
        await page.goto(fullUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 45000, // Increased timeout for Cloudflare challenges
          referer: 'https://www.google.com/', // Add referer to look like coming from Google
        });
        
        console.log(`[PLAYWRIGHT] DOM loaded for ${url}, waiting for text content...`);
        
        // Wait for body to be present
        try {
          await page.waitForSelector('body', { timeout: 10000 });
        } catch (waitError) {
          console.log(`[PLAYWRIGHT] Body selector timeout for ${url}, proceeding...`);
        }
        
        // Check if Cloudflare challenge page is present
        const isCloudflareChallenge = await page.evaluate(() => {
          const bodyText = document.body.textContent || '';
          return bodyText.includes('Please enable cookies') || 
                 bodyText.includes('Checking your browser') ||
                 bodyText.includes('Just a moment') ||
                 bodyText.includes('DDoS protection by Cloudflare') ||
                 bodyText.includes('you have been blocked') ||
                 document.title.includes('Just a moment') ||
                 document.title.includes('Please Wait');
        });
        
        if (isCloudflareChallenge) {
          console.log(`[PLAYWRIGHT] Cloudflare challenge detected, attempting to bypass...`);
          
          // Simulate human-like interactions while waiting
          try {
            // Move mouse randomly
            await page.mouse.move(Math.random() * 500, Math.random() * 500);
            await page.waitForTimeout(1000);
            
            // Scroll a bit
            await page.evaluate(() => {
              window.scrollBy(0, Math.random() * 200);
            });
            await page.waitForTimeout(1000);
          } catch (e) {
            // Ignore interaction errors
          }
          
          // Wait for Cloudflare challenge with multiple checks (up to 30 seconds)
          let challengeResolved = false;
          const maxWaitTime = 30000; // 30 seconds
          const checkInterval = 2000; // Check every 2 seconds
          const maxChecks = Math.floor(maxWaitTime / checkInterval);
          
          for (let check = 0; check < maxChecks; check++) {
            await page.waitForTimeout(checkInterval);
            
            // Check if challenge is resolved
            const stillBlocked = await page.evaluate(() => {
              const bodyText = document.body.textContent || '';
              const title = document.title.toLowerCase();
              return bodyText.includes('Please enable cookies') || 
                     bodyText.includes('Checking your browser') ||
                     bodyText.includes('Just a moment') ||
                     bodyText.includes('you have been blocked') ||
                     title.includes('just a moment') ||
                     title.includes('please wait');
            });
            
            if (!stillBlocked) {
              challengeResolved = true;
              console.log(`[PLAYWRIGHT] Cloudflare challenge resolved after ${(check + 1) * 2} seconds`);
              break;
            }
            
            // Simulate more interactions every few checks
            if (check % 3 === 0) {
              try {
                await page.mouse.move(Math.random() * 800, Math.random() * 600);
                await page.waitForTimeout(500);
              } catch (e) {
                // Ignore
              }
            }
          }
          
          if (!challengeResolved) {
            // Final check after waiting
            const finalCheck = await page.evaluate(() => {
              const bodyText = document.body.textContent || '';
              return !bodyText.includes('Please enable cookies') && 
                     !bodyText.includes('Checking your browser') &&
                     !bodyText.includes('Just a moment') &&
                     !bodyText.includes('you have been blocked');
            });
            
            if (!finalCheck) {
              throw new Error('Unable to access website. Cloudflare challenge not resolved after 30 seconds - site may be blocking automated access');
            }
          }
          
          // Wait for navigation after challenge (Cloudflare often redirects)
          try {
            await page.waitForNavigation({ 
              waitUntil: 'domcontentloaded', 
              timeout: 10000 
            }).catch(() => {
              // Navigation might not happen, that's okay
            });
          } catch (e) {
            // Ignore navigation timeout
          }
          
          // Wait a bit more for page to fully load after challenge
          await page.waitForTimeout(2000);
        }
        
        // Wait for any JavaScript-rendered content
        await page.waitForTimeout(3000);
        
        // Final check - make sure we're not still on a challenge page
        const finalChallengeCheck = await page.evaluate(() => {
          const bodyText = document.body.textContent || '';
          return bodyText.includes('Please enable cookies') || 
                 bodyText.includes('Checking your browser') ||
                 bodyText.includes('Just a moment') ||
                 bodyText.includes('you have been blocked');
        });
        
        if (finalChallengeCheck) {
          throw new Error('Unable to access website. Still blocked by Cloudflare security challenge after all attempts.');
        }
        
        // Extract content
        const title = await page.title();
        const metaDescription = await page.$eval('meta[name="description"]', 
          el => el.getAttribute('content')).catch(() => null);
        
        // Get page content
        const content = await page.evaluate(() => {
          // Remove script and style elements
          const scripts = document.querySelectorAll('script, style');
          scripts.forEach(el => el.remove());
          
          // Get main content with better selectors for SPAs
          const contentSelectors = [
            'main', 'article', '.content', '.main-content', 
            '#content', '.post', '.entry', '#root', '#app',
            '.container', '.wrapper', '.page', 'body'
          ];
          
          for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent && element.textContent.trim().length > 100) {
              return element.textContent || '';
            }
          }
          
          // Fallback to body content
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
      
      // Close page and context after successful scrape
      if (page) {
        await page.close();
      }
      if (context) {
        await context.close();
      }
      
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
        const isCloudflareBlock = errorMessage.includes('Cloudflare') || 
                                  errorMessage.includes('challenge not resolved') ||
                                  errorMessage.includes('Still on Cloudflare');
        
        console.error(`[PLAYWRIGHT] Scraping failed for ${url} (attempt ${attempt + 1}/${maxTotalAttempts}):`, errorMessage);
        
        // Close context and page on error
        if (page) {
          try {
            await page.close();
          } catch (e) {
            // Ignore close errors
          }
        }
        if (context) {
          try {
            await context.close();
          } catch (e) {
            // Ignore close errors
          }
        }
        
        // Track Cloudflare blocks
        if (isCloudflareBlock) {
          cloudflareBlockCount++;
          console.log(`[PLAYWRIGHT] Cloudflare block count: ${cloudflareBlockCount}/${maxCloudflareBlocks}`);
          
          // If Cloudflare blocks multiple times, site is likely blocking all automated access
          if (cloudflareBlockCount >= maxCloudflareBlocks) {
            throw new Error(`Unable to access website. Site is blocking all automated access via Cloudflare after trying ${cloudflareBlockCount} proxies.`);
          }
          
          // Don't mark proxy as failed for Cloudflare - it's the site, not the proxy
          // Just continue to next proxy
        } else {
          // For non-Cloudflare errors, mark proxy as failed
          if (proxy) {
            this.proxyManager.markProxyFailed(proxy);
          }
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
   * Get random user agent (updated to recent Chrome versions)
   */
  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
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
