import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ContactStatus, ScrapeMethod } from '@prisma/client';
import { CheerioScraperService } from './scrapers/cheerio.scraper';
import { PlaywrightScraperService } from './scrapers/playwright.scraper';
import { GoogleSearchService } from './scrapers/google-search.service';

export interface ScrapeResult {
  contactId: number;
  success: boolean;
  scrapedData?: any;
  error?: string;
}

interface BatchScrapeResult {
  total: number;
  successful: number;
  failed: number;
  results: ScrapeResult[];
}

@Injectable()
export class ScrapingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cheerioScraper: CheerioScraperService,
    private readonly playwrightScraper: PlaywrightScraperService,
    private readonly googleSearch: GoogleSearchService,
  ) {}

  /**
   * Convert technical error messages to user-friendly messages
   */
  private getUserFriendlyErrorMessage(error: any): string {
    // Extract error message from various error formats
    let errorMessage = 'Unknown error';
    if (error?.message) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error?.toString) {
      errorMessage = error.toString();
    }
    
    // Also check for nested errors (common in wrapped errors)
    if (error?.cause?.message) {
      errorMessage = `${errorMessage}. ${error.cause.message}`;
    }
    
    const lowerError = errorMessage.toLowerCase();

    // Network/Connection errors - check timeout first as it's most common
    if (lowerError.includes('timeout') || lowerError.includes('timed out') || lowerError.includes('timeout exceeded')) {
      return 'The website took too long to respond. The site might be slow or temporarily unavailable.';
    }
    if (lowerError.includes('econnrefused') || lowerError.includes('connection refused')) {
      return 'Could not connect to the website. The site might be down or blocking our requests.';
    }
    if (lowerError.includes('enotfound') || lowerError.includes('getaddrinfo')) {
      return 'The website address could not be found. Please check if the URL is correct.';
    }
    if (lowerError.includes('network') || lowerError.includes('network error')) {
      return 'A network error occurred while trying to access the website.';
    }

    // HTTP errors
    if (lowerError.includes('404') || lowerError.includes('not found')) {
      return 'The website page was not found. The URL might be incorrect or the page may have been removed.';
    }
    if (lowerError.includes('403') || lowerError.includes('forbidden')) {
      return 'Access to the website was denied. The site may be blocking automated access.';
    }
    if (lowerError.includes('401') || lowerError.includes('unauthorized')) {
      return 'Access to the website requires authentication.';
    }
    if (lowerError.includes('500') || lowerError.includes('internal server error')) {
      return 'The website server encountered an error. Please try again later.';
    }
    if (lowerError.includes('429') || lowerError.includes('too many requests')) {
      return 'Too many requests were sent. Please wait a moment and try again.';
    }

    // Scraping-specific errors
    if (lowerError.includes('no search results') || lowerError.includes('no results found')) {
      return 'Could not find the business website through search. The business information may be incomplete.';
    }
    if (lowerError.includes('invalid email') || lowerError.includes('email extraction')) {
      return 'Could not extract a valid email address from the website.';
    }
    if (lowerError.includes('all attempts exhausted') || 
        lowerError.includes('after 5 attempts') || 
        lowerError.includes('after 3 attempts')) {
      return 'Unable to access the website. The site may be blocking automated access or temporarily unavailable.';
    }
    if (lowerError.includes('cloudflare') && (lowerError.includes('blocking') || lowerError.includes('not resolved'))) {
      return 'Unable to access the website. The site is protected by security measures that are blocking automated access.';
    }
    if (lowerError.includes('blocking all automated access')) {
      return 'Unable to access the website. The site is blocking automated access attempts.';
    }
    if (lowerError.includes('playwright') && lowerError.includes('failed')) {
      return 'The website requires advanced browser features that could not be loaded.';
    }
    if (lowerError.includes('cheerio') && lowerError.includes('failed')) {
      return 'Could not read the website content. The site might use advanced features that require a browser.';
    }

    // Domain/URL errors
    if (lowerError.includes('invalid url') || lowerError.includes('malformed url')) {
      return 'The website address is invalid or incorrectly formatted.';
    }
    if (lowerError.includes('domain') && lowerError.includes('extraction')) {
      return 'Could not extract a valid website domain from the email address.';
    }

    // Generic fallback
    if (lowerError.includes('unknown') || lowerError.length < 10) {
      return 'An unexpected error occurred while scraping the website. Please try again later.';
    }

    // Return a simplified version of the error if it's somewhat readable
    return `Could not scrape the website: ${errorMessage.split(':').pop()?.trim() || 'Unknown error'}`;
  }

  /**
   * Discover website URL for a contact without scraping
   * Only works for contacts with business_search method
   */
  async discoverWebsite(contactId: number): Promise<{
    success: boolean;
    data?: {
      discoveredWebsite: string;
      confidence: 'high' | 'medium' | 'low';
      method: 'business_search';
      businessName: string;
      searchQuery: string;
    };
    error?: string;
  }> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      const contact = await scrapingClient.contact.findUnique({
        where: { id: contactId },
      });

      if (!contact) {
        return {
          success: false,
          error: `Contact with ID ${contactId} not found`,
        };
      }

      // Only allow discovery for business_search method
      if (contact.scrapeMethod !== 'business_search') {
        return {
          success: false,
          error: `Discovery only available for business_search method. Current method: ${contact.scrapeMethod}`,
        };
      }

      // If contact already has a website, return it
      if (contact.website) {
        return {
          success: true,
          data: {
            discoveredWebsite: contact.website,
            confidence: 'high',
            method: 'business_search',
            businessName: contact.businessName || '',
            searchQuery: '',
          },
        };
      }

      if (!contact.businessName) {
        return {
          success: false,
          error: 'Business name required for website discovery',
        };
      }

      // Build search query (same logic as scrapeFromBusinessSearch)
      const searchTerms = [
        contact.businessName,
        contact.state,
        contact.zipCode,
      ].filter(Boolean);
      const searchQuery = searchTerms.join(' ');

      // Search for the business using Google (same as scrapeFromBusinessSearch)
      const searchResults = await this.googleSearch.searchByBusinessName(
        contact.businessName,
        contact.state || undefined,
        contact.zipCode || undefined
      );

      if (!searchResults.searchSuccess || !searchResults.results?.length) {
        return {
          success: false,
          error: `No search results found for business: ${searchQuery}`,
        };
      }

      // Get the first result URL
      const discoveredUrl = searchResults.results[0].url;

      // Determine confidence based on result quality
      let confidence: 'high' | 'medium' | 'low' = 'medium';
      if (searchResults.results.length >= 3) {
        confidence = 'high';
      } else if (searchResults.results.length === 1) {
        confidence = 'low';
      }

      return {
        success: true,
        data: {
          discoveredWebsite: discoveredUrl,
          confidence,
          method: 'business_search',
          businessName: contact.businessName,
          searchQuery,
        },
      };
    } catch (error) {
      console.error(`[DISCOVER] Website discovery failed for contact ${contactId}:`, error);
      return {
        success: false,
        error: `Website discovery failed: ${error.message}`,
      };
    }
  }

  /**
   * Scrape a single contact by ID
   */
  async scrapeContact(contactId: number, confirmedWebsite?: string): Promise<ScrapeResult> {
    try {
      // Get scraping client that uses session pool (port 5432)
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Get contact with validation data using session pool
      const contact = await scrapingClient.contact.findUnique({
        where: { id: contactId },
        include: {
          csvUpload: true,
        },
      });

      if (!contact) {
        throw new NotFoundException(`Contact with ID ${contactId} not found`);
      }

      // Check if contact is ready to scrape
      if (contact.status !== 'ready_to_scrape') {
        throw new BadRequestException(
          `Contact status is '${contact.status}'. Expected 'ready_to_scrape'`,
        );
      }

      // Check if contact has a scrape method
      if (!contact.scrapeMethod) {
        throw new BadRequestException(
          `Contact has no scrape method assigned. Run validation first.`,
        );
      }

      // Update status to scraping using session pool
      await scrapingClient.contact.update({
        where: { id: contactId },
        data: { status: 'scraping' as ContactStatus },
      });

      // Execute scraping based on method
      let scrapedData;
      switch (contact.scrapeMethod) {
        case 'direct_url':
          scrapedData = await this.scrapeDirectUrl(contact);
          break;
        case 'email_domain':
          scrapedData = await this.scrapeFromEmailDomain(contact);
          break;
        case 'business_search':
          scrapedData = await this.scrapeFromBusinessSearch(contact, confirmedWebsite);
          break;
        default:
          throw new BadRequestException(
            `Unknown scrape method: ${contact.scrapeMethod}`,
          );
      }

      // Save scraped data to database using session pool
      const savedScrapedData = await scrapingClient.scrapedData.create({
        data: {
          contactId: contact.id,
          method: contact.scrapeMethod!,
          url: scrapedData.url || contact.website || '',
          searchQuery: scrapedData.searchQuery,
          discoveredUrl: scrapedData.discoveredUrl,
          homepageText: scrapedData.homepageText,
          homepageHtml: scrapedData.homepageHtml,
          servicesText: scrapedData.servicesText,
          servicesHtml: scrapedData.servicesHtml,
          productsText: scrapedData.productsText,
          productsHtml: scrapedData.productsHtml,
          contactText: scrapedData.contactText,
          contactHtml: scrapedData.contactHtml,
          extractedEmails: scrapedData.extractedEmails || [],
          extractedPhones: scrapedData.extractedPhones || [],
          pageTitle: scrapedData.pageTitle,
          metaDescription: scrapedData.metaDescription,
          keywords: [], // TODO: Extract keywords from content
          scrapeSuccess: scrapedData.scrapeSuccess,
          errorMessage: scrapedData.errorMessage,
        },
      });

      // Update contact status to scraped using session pool
      await scrapingClient.contact.update({
        where: { id: contactId },
        data: { status: 'scraped' as ContactStatus },
      });

      return {
        contactId: contact.id,
        success: true,
        scrapedData: savedScrapedData,
      };
    } catch (error) {
      // Get user-friendly error message
      const userFriendlyError = this.getUserFriendlyErrorMessage(error);
      console.log(`[SCRAPE] Error for contact ${contactId}:`, error?.message || error);
      console.log(`[SCRAPE] User-friendly error message:`, userFriendlyError);
      
      // Update contact status to scrape_failed and create ScrapedData record
      try {
        const scrapingClient = await this.prisma.getScrapingClient();
        
        // Get contact info for creating ScrapedData record
        const contact = await scrapingClient.contact.findUnique({
          where: { id: contactId },
        });

        if (contact) {
          // Create ScrapedData record with failure information
          const scrapedDataRecord = await scrapingClient.scrapedData.create({
            data: {
              contactId: contact.id,
              method: contact.scrapeMethod || 'direct_url',
              url: contact.website || '',
              scrapeSuccess: false,
              errorMessage: userFriendlyError,
            },
          });
          console.log(`[SCRAPE] Created ScrapedData record ${scrapedDataRecord.id} with errorMessage:`, scrapedDataRecord.errorMessage);

          // Update contact status to scrape_failed
          await scrapingClient.contact.update({
            where: { id: contactId },
            data: { 
              status: 'scrape_failed' as ContactStatus,
            },
          });
        }
      } catch (updateError) {
        console.error('Failed to update contact status to scrape_failed:', updateError);
      }

      return {
        contactId,
        success: false,
        error: userFriendlyError,
      };
    }
  }

  /**
   * Scrape multiple contacts in batch with parallel processing
   * Optimized: Uses controlled concurrency instead of sequential processing
   */
  async scrapeBatch(uploadId: number, limit: number = 20): Promise<BatchScrapeResult> {
    // Get CSV upload to verify it exists
    const csvUpload = await this.prisma.csvUpload.findUnique({
      where: { id: uploadId },
    });

    if (!csvUpload) {
      throw new NotFoundException(`CSV upload with ID ${uploadId} not found`);
    }

    // Get contacts ready to scrape, ordered by priority
    const contacts = await this.prisma.contact.findMany({
      where: {
        csvUploadId: uploadId,
        status: 'ready_to_scrape',
      },
      orderBy: {
        scrapePriority: 'asc',
      },
      take: limit,
    });

    if (contacts.length === 0) {
      return {
        total: 0,
        successful: 0,
        failed: 0,
        results: [],
      };
    }

    // Process contacts in parallel with controlled concurrency
    const concurrency = Math.min(5, contacts.length); // Max 5 concurrent operations
    const results: ScrapeResult[] = [];
    let successful = 0;
    let failed = 0;

    // Process contacts in chunks to control concurrency
    for (let i = 0; i < contacts.length; i += concurrency) {
      const chunk = contacts.slice(i, i + concurrency);
      
      // Process chunk in parallel
      const chunkPromises = chunk.map(async (contact) => {
        try {
          const result = await this.scrapeContact(contact.id);
          return result;
        } catch (error) {
          return {
            contactId: contact.id,
            success: false,
            error: error.message || 'Unknown error',
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      
      // Process results
      chunkResults.forEach(result => {
        results.push(result);
        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      });

      // Add delay between chunks to avoid overwhelming servers
      if (i + concurrency < contacts.length) {
        await this.sleep(2000); // 2 second delay between chunks
      }
    }

    return {
      total: contacts.length,
      successful,
      failed,
      results,
    };
  }

  /**
   * Get scraping statistics for an upload
   */
  async getUploadStats(uploadId: number) {
    let contacts: Array<any>;
    try {
      // Prefer session-pooled client to avoid PgBouncer prepared statement issues
      const scrapingClient = await this.prisma.getScrapingClient();
      contacts = await scrapingClient.contact.groupBy({
        by: ['status'],
        where: { csvUploadId: uploadId },
        _count: { _all: true },
      } as any);
    } catch (error: any) {
      // Fallback to pooled client if direct session is unreachable (e.g., P1001) or other connection hiccups
      contacts = await this.prisma.contact.groupBy({
        by: ['status'],
        where: { csvUploadId: uploadId },
        _count: { _all: true },
      } as any);
    }

    const stats = {
      uploadId,
      totalContacts: 0,
      readyToScrape: 0,
      scraping: 0,
      scraped: 0,
      scrapeFailed: 0,
      byStatus: {} as Record<string, number>,
    };

    contacts.forEach((group) => {
      const count = typeof (group as any)._count === 'number' ? (group as any)._count : (group as any)._count?._all ?? 0;
      stats.totalContacts += count;
      stats.byStatus[group.status] = count;

      // Map to specific stats
      if (group.status === 'ready_to_scrape') stats.readyToScrape = count;
      if (group.status === 'scraping') stats.scraping = count;
      if (group.status === 'scraped') stats.scraped = count;
      if (group.status === 'scrape_failed') stats.scrapeFailed = count;
    });

    return stats;
  }

  /**
   * Detect if a website is a Single Page Application (SPA) that needs JavaScript execution
   */
  private async detectSPA(url: string): Promise<boolean> {
    try {
      // Quick check with Cheerio to see if it's likely a SPA
      const response = await this.cheerioScraper.scrapeUrl(url);
      
      // Check for common SPA indicators
      const html = response.html.toLowerCase();
      
      // React indicators
      const hasReactRoot = html.includes('id="root"') || html.includes('id="app"');
      const hasReactScripts = html.includes('react') || html.includes('_react') || html.includes('react-dom');
      const hasVueIndicators = html.includes('vue') || html.includes('v-') || html.includes('@vue');
      const hasAngularIndicators = html.includes('angular') || html.includes('ng-') || html.includes('@angular');
      
      // Check if content is minimal (typical of SPAs)
      const contentLength = response.content.trim().length;
      const isMinimalContent = contentLength < 500; // Very little static content
      
      // Check for common SPA frameworks in meta tags or scripts
      const hasSPAMeta = html.includes('next.js') || html.includes('nuxt') || html.includes('gatsby') || 
                        html.includes('svelte') || html.includes('preact');
      
      const isSPA = (hasReactRoot && (hasReactScripts || isMinimalContent)) || 
                   hasVueIndicators || 
                   hasAngularIndicators || 
                   hasSPAMeta ||
                   (isMinimalContent && hasReactRoot);
      
      console.log(`[SPA-DETECT] URL: ${url}, isSPA: ${isSPA}, contentLength: ${contentLength}, hasReactRoot: ${hasReactRoot}`);
      
      return isSPA;
    } catch (error) {
      console.log(`[SPA-DETECT] Error detecting SPA for ${url}, defaulting to Playwright:`, error.message);
      // If we can't detect, default to Playwright for better coverage
      return true;
    }
  }

  /**
   * Priority 1: Scrape directly from website URL
   */
  private async scrapeDirectUrl(contact: any): Promise<any> {
    console.log(`[SCRAPE] Direct URL scraping for: ${contact.website}`);
    
    try {
      // Check if this is likely a SPA/React site that needs Playwright
      const isSPA = await this.detectSPA(contact.website);
      
      // Scrape homepage first
      let homepageData;
      if (isSPA) {
        console.log(`[SCRAPE] Detected SPA/React site, using Playwright for: ${contact.website}`);
        homepageData = await this.playwrightScraper.scrapeUrl(contact.website);
      } else {
        try {
          homepageData = await this.cheerioScraper.scrapeUrl(contact.website);
        } catch (cheerioError) {
          console.log(`[SCRAPE] Cheerio failed, trying Playwright for: ${contact.website}`);
          homepageData = await this.playwrightScraper.scrapeUrl(contact.website);
        }
      }

      // Discover and scrape additional pages (uses homepageData.html - already scraped!)
      const additionalPages = await this.discoverAndScrapePages(contact.website, homepageData);
      
      // Enrich emails/phones with footer and contact page data if missing from homepage
      let extractedEmails = homepageData.extractedEmails || [];
      let extractedPhones = homepageData.extractedPhones || [];
      
      // First, try to extract from footer if missing
      if (homepageData.html && (extractedEmails.length === 0 || extractedPhones.length === 0)) {
        const footerContact = this.extractFooterContactInfo(homepageData.html);
        
        // Add footer emails if not already found
        if (footerContact.emails.length > 0 && extractedEmails.length === 0) {
          extractedEmails = [...new Set([...extractedEmails, ...footerContact.emails])];
          console.log(`[SCRAPE] Enriched with ${footerContact.emails.length} emails from footer`);
        }
        
        // Add footer phones if not already found
        if (footerContact.phones.length > 0 && extractedPhones.length === 0) {
          extractedPhones = [...new Set([...extractedPhones, ...footerContact.phones])];
          console.log(`[SCRAPE] Enriched with ${footerContact.phones.length} phones from footer`);
        }
      }
      
      // If still missing, try contact page data
      if (additionalPages.contact) {
        const contactEmails = additionalPages.contact.extractedEmails || [];
        const contactPhones = additionalPages.contact.extractedPhones || [];
        
        // Add contact page emails if not already found
        if (contactEmails.length > 0 && extractedEmails.length === 0) {
          extractedEmails = [...new Set([...extractedEmails, ...contactEmails])];
          console.log(`[SCRAPE] Enriched with ${contactEmails.length} emails from contact page`);
        }
        
        // Add contact page phones if not already found
        if (contactPhones.length > 0 && extractedPhones.length === 0) {
          extractedPhones = [...new Set([...extractedPhones, ...contactPhones])];
          console.log(`[SCRAPE] Enriched with ${contactPhones.length} phones from contact page`);
        }
      }
      
      return {
        method: 'direct_url',
        url: contact.website,
        homepageText: homepageData.content,
        homepageHtml: homepageData.html,
        servicesText: additionalPages.services?.content || null,
        servicesHtml: additionalPages.services?.html || null,
        productsText: additionalPages.products?.content || null,
        productsHtml: additionalPages.products?.html || null,
        contactText: additionalPages.contact?.content || null,
        contactHtml: additionalPages.contact?.html || null,
        extractedEmails: extractedEmails, // Enriched with contact page emails if needed
        extractedPhones: extractedPhones, // Enriched with contact page phones if needed
        pageTitle: homepageData.title,
        metaDescription: homepageData.metaDescription,
        scrapeSuccess: homepageData.scrapeSuccess,
        timestamp: homepageData.timestamp,
      };
    } catch (error) {
      console.error(`[SCRAPE] Direct URL scraping failed for ${contact.website}:`, error);
      throw new Error(`Direct URL scraping failed: ${error.message}`);
    }
  }

  /**
   * Priority 2: Search by email domain, then scrape
   */
  private async scrapeFromEmailDomain(contact: any): Promise<any> {
    console.log(`[SCRAPE] Email domain search for: ${contact.email}`);
    
    // Extract domain from email
    const domain = contact.email?.split('@')[1];
    if (!domain) {
      throw new BadRequestException('Invalid email for domain extraction');
    }

    try {
      // Search for the domain using Google
      const searchResults = await this.googleSearch.searchByDomain(domain);
      
      if (!searchResults.searchSuccess || !searchResults.results?.length) {
        throw new Error(`No search results found for domain: ${domain}`);
      }

      // Get the first result URL
      const discoveredUrl = searchResults.results[0].url;
      
      // Scrape the discovered URL (try Cheerio first, fallback to Playwright)
      let homepageData;
      try {
        homepageData = await this.cheerioScraper.scrapeUrl(discoveredUrl);
      } catch (cheerioError) {
        console.log(`[SCRAPE] Cheerio failed for discovered URL, trying Playwright: ${discoveredUrl}`);
        homepageData = await this.playwrightScraper.scrapeUrl(discoveredUrl);
      }

      // Discover and scrape additional pages
      const additionalPages = await this.discoverAndScrapePages(discoveredUrl, homepageData);
      
      // Enrich emails/phones with footer and contact page data if missing from homepage
      let extractedEmails = homepageData.extractedEmails || [];
      let extractedPhones = homepageData.extractedPhones || [];
      
      // First, try to extract from footer if missing
      if (homepageData.html && (extractedEmails.length === 0 || extractedPhones.length === 0)) {
        const footerContact = this.extractFooterContactInfo(homepageData.html);
        
        // Add footer emails if not already found
        if (footerContact.emails.length > 0 && extractedEmails.length === 0) {
          extractedEmails = [...new Set([...extractedEmails, ...footerContact.emails])];
          console.log(`[SCRAPE] Enriched with ${footerContact.emails.length} emails from footer`);
        }
        
        // Add footer phones if not already found
        if (footerContact.phones.length > 0 && extractedPhones.length === 0) {
          extractedPhones = [...new Set([...extractedPhones, ...footerContact.phones])];
          console.log(`[SCRAPE] Enriched with ${footerContact.phones.length} phones from footer`);
        }
      }
      
      // If still missing, try contact page data
      if (additionalPages.contact) {
        const contactEmails = additionalPages.contact.extractedEmails || [];
        const contactPhones = additionalPages.contact.extractedPhones || [];
        
        // Add contact page emails if not already found
        if (contactEmails.length > 0 && extractedEmails.length === 0) {
          extractedEmails = [...new Set([...extractedEmails, ...contactEmails])];
          console.log(`[SCRAPE] Enriched with ${contactEmails.length} emails from contact page`);
        }
        
        // Add contact page phones if not already found
        if (contactPhones.length > 0 && extractedPhones.length === 0) {
          extractedPhones = [...new Set([...extractedPhones, ...contactPhones])];
          console.log(`[SCRAPE] Enriched with ${contactPhones.length} phones from contact page`);
        }
      }
      
      return {
        method: 'email_domain',
        searchQuery: `site:${domain}`,
        discoveredUrl,
        homepageText: homepageData.content,
        homepageHtml: homepageData.html,
        servicesText: additionalPages.services?.content || null,
        servicesHtml: additionalPages.services?.html || null,
        productsText: additionalPages.products?.content || null,
        productsHtml: additionalPages.products?.html || null,
        contactText: additionalPages.contact?.content || null,
        contactHtml: additionalPages.contact?.html || null,
        extractedEmails: extractedEmails, // Enriched with contact page emails if needed
        extractedPhones: extractedPhones, // Enriched with contact page phones if needed
        pageTitle: homepageData.title,
        metaDescription: homepageData.metaDescription,
        scrapeSuccess: homepageData.scrapeSuccess,
        timestamp: homepageData.timestamp,
      };
    } catch (error) {
      console.error(`[SCRAPE] Email domain search failed for ${contact.email}:`, error);
      throw new Error(`Email domain search failed: ${error.message}`);
    }
  }

  /**
   * Priority 3: Search by business name + location, then scrape
   * @param contact - Contact to scrape
   * @param confirmedWebsite - Optional: Pre-discovered website URL (skip search)
   */
  private async scrapeFromBusinessSearch(contact: any, confirmedWebsite?: string): Promise<any> {
    console.log(`[SCRAPE] Business search for: ${contact.businessName}`);
    
    let discoveredUrl: string;
    let searchQuery: string;

    // If confirmedWebsite is provided, use it directly (skip discovery)
    if (confirmedWebsite) {
      console.log(`[SCRAPE] Using confirmed website: ${confirmedWebsite}`);
      discoveredUrl = confirmedWebsite;
      searchQuery = `Confirmed: ${confirmedWebsite}`;
    } else {
      // Original discovery logic
      const searchTerms = [
        contact.businessName,
        contact.state,
        contact.zipCode,
      ].filter(Boolean);
      searchQuery = searchTerms.join(' ');

      try {
        // Search for the business using Google
        const searchResults = await this.googleSearch.searchByBusinessName(
          contact.businessName,
          contact.state,
          contact.zipCode
        );
        
        if (!searchResults.searchSuccess || !searchResults.results?.length) {
          throw new Error(`No search results found for business: ${searchQuery}`);
        }

        // Get the first result URL
        discoveredUrl = searchResults.results[0].url;
      } catch (error) {
        console.error(`[SCRAPE] Business search failed for ${contact.businessName}:`, error);
        throw new Error(`Business search failed: ${error.message}`);
      }
    }

    try {
      
      // Scrape the discovered URL (try Cheerio first, fallback to Playwright)
      let homepageData;
      try {
        homepageData = await this.cheerioScraper.scrapeUrl(discoveredUrl);
      } catch (cheerioError) {
        console.log(`[SCRAPE] Cheerio failed for discovered URL, trying Playwright: ${discoveredUrl}`);
        homepageData = await this.playwrightScraper.scrapeUrl(discoveredUrl);
      }

      // Discover and scrape additional pages
      const additionalPages = await this.discoverAndScrapePages(discoveredUrl, homepageData);
      
      // Enrich emails/phones with footer and contact page data if missing from homepage
      let extractedEmails = homepageData.extractedEmails || [];
      let extractedPhones = homepageData.extractedPhones || [];
      
      // First, try to extract from footer if missing
      if (homepageData.html && (extractedEmails.length === 0 || extractedPhones.length === 0)) {
        const footerContact = this.extractFooterContactInfo(homepageData.html);
        
        // Add footer emails if not already found
        if (footerContact.emails.length > 0 && extractedEmails.length === 0) {
          extractedEmails = [...new Set([...extractedEmails, ...footerContact.emails])];
          console.log(`[SCRAPE] Enriched with ${footerContact.emails.length} emails from footer`);
        }
        
        // Add footer phones if not already found
        if (footerContact.phones.length > 0 && extractedPhones.length === 0) {
          extractedPhones = [...new Set([...extractedPhones, ...footerContact.phones])];
          console.log(`[SCRAPE] Enriched with ${footerContact.phones.length} phones from footer`);
        }
      }
      
      // If still missing, try contact page data
      if (additionalPages.contact) {
        const contactEmails = additionalPages.contact.extractedEmails || [];
        const contactPhones = additionalPages.contact.extractedPhones || [];
        
        // Add contact page emails if not already found
        if (contactEmails.length > 0 && extractedEmails.length === 0) {
          extractedEmails = [...new Set([...extractedEmails, ...contactEmails])];
          console.log(`[SCRAPE] Enriched with ${contactEmails.length} emails from contact page`);
        }
        
        // Add contact page phones if not already found
        if (contactPhones.length > 0 && extractedPhones.length === 0) {
          extractedPhones = [...new Set([...extractedPhones, ...contactPhones])];
          console.log(`[SCRAPE] Enriched with ${contactPhones.length} phones from contact page`);
        }
      }
      
      return {
        method: 'business_search',
        searchQuery,
        discoveredUrl,
        homepageText: homepageData.content,
        homepageHtml: homepageData.html,
        servicesText: additionalPages.services?.content || null,
        servicesHtml: additionalPages.services?.html || null,
        productsText: additionalPages.products?.content || null,
        productsHtml: additionalPages.products?.html || null,
        contactText: additionalPages.contact?.content || null,
        contactHtml: additionalPages.contact?.html || null,
        extractedEmails: extractedEmails, // Enriched with contact page emails if needed
        extractedPhones: extractedPhones, // Enriched with contact page phones if needed
        pageTitle: homepageData.title,
        metaDescription: homepageData.metaDescription,
        scrapeSuccess: homepageData.scrapeSuccess,
        timestamp: homepageData.timestamp,
      };
    } catch (error) {
      console.error(`[SCRAPE] Business search scraping failed for ${contact.businessName}:`, error);
      throw new Error(`Business search scraping failed: ${error.message}`);
    }
  }

  /**
   * Utility: Sleep function for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract navigation links with labels from homepage HTML
   * Uses already-scraped HTML - no re-scraping needed!
   */
  private extractNavigationLinksFromHtml(html: string, baseUrl: string): Array<{url: string, label: string, source: string}> {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const baseUrlObj = new URL(baseUrl);
    const baseDomain = baseUrlObj.hostname.replace(/^www\./, ''); // Normalize domain (remove www)
    const basePath = baseUrlObj.pathname === '/' ? '' : baseUrlObj.pathname;
    const links: Array<{url: string, label: string, source: string}> = [];
    
    // Priority areas: nav, header, main menu (most important)
    const prioritySelectors = [
      'nav a[href]',
      'header a[href]',
      '.navbar a[href]',
      '.menu a[href]',
      '.navigation a[href]',
      '[role="navigation"] a[href]',
      '.main-menu a[href]',
      '.primary-menu a[href]',
      '.wp-block-button a[href]' // WordPress block buttons
    ];
    
    // Secondary areas: footer (less important but still useful)
    const secondarySelectors = [
      'footer a[href]',
      '.footer a[href]'
    ];
    
    const normalizeUrl = (url: string): string => {
      try {
        const urlObj = new URL(url);
        // Normalize hostname (remove www)
        const normalizedHost = urlObj.hostname.replace(/^www\./, '');
        return `${urlObj.protocol}//${normalizedHost}${urlObj.pathname}${urlObj.search}`;
      } catch {
        return url;
      }
    };
    
    const isHomepage = (url: string): boolean => {
      const normalized = normalizeUrl(url);
      const baseNormalized = normalizeUrl(baseUrl);
      return normalized === baseNormalized || normalized === `${baseNormalized}/` || normalized === `${baseNormalized.replace(/\/$/, '')}/`;
    };
    
    const extractLinks = (selector: string, source: string) => {
      $(selector).each((_: any, element: any) => {
        const $el = $(element);
        const href = $el.attr('href');
        const label = $el.text().trim();
        
        // Extract links even if they don't have visible text (label can be empty)
        if (href) {
          try {
            const fullUrl = new URL(href, baseUrl).href;
            const linkDomain = new URL(fullUrl).hostname.replace(/^www\./, ''); // Normalize
            
            // Only internal links, exclude anchors, mailto, tel, and homepage itself
            if (linkDomain === baseDomain && 
                !href.startsWith('#') && 
                !href.startsWith('mailto:') && 
                !href.startsWith('tel:') &&
                !isHomepage(fullUrl)) {
              links.push({
                url: fullUrl,
                label: label ? label.toLowerCase() : '',
                source: source
              });
            }
          } catch (e) {
            // Invalid URL, skip
          }
        }
      });
    };
    
    // Extract from priority areas first
    prioritySelectors.forEach(selector => {
      extractLinks(selector, 'navigation');
    });
    
    // Extract from secondary areas
    secondarySelectors.forEach(selector => {
      extractLinks(selector, 'footer');
    });
    
    // Remove duplicates (same URL), prefer navigation source
    const uniqueLinks = new Map<string, {url: string, label: string, source: string}>();
    links.forEach(link => {
      const normalizedUrl = normalizeUrl(link.url);
      if (!uniqueLinks.has(normalizedUrl)) {
        uniqueLinks.set(normalizedUrl, link);
      } else {
        // If duplicate, prefer navigation source over footer
        const existing = uniqueLinks.get(normalizedUrl)!;
        if (link.source === 'navigation' && existing.source === 'footer') {
          uniqueLinks.set(normalizedUrl, link);
        }
      }
    });
    
    return Array.from(uniqueLinks.values());
  }

  /**
   * Extract contact info (emails and phones) from footer HTML
   */
  private extractFooterContactInfo(html: string): {emails: string[], phones: string[]} {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    
    // Get footer text
    const footerText = $('footer').text() || '';
    
    // Extract emails from footer
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emailMatches = footerText.match(emailRegex) || [];
    const footerEmails = (emailMatches as string[]).filter((email: string) => {
      // Filter out common non-business emails
      return !email.includes('example.com') && !email.includes('test.com');
    });
    
    // Extract phones from footer (matches patterns like +1 (617) 383-7474, (617) 383-7474, 617-383-7474, etc.)
    const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
    const phoneMatches = footerText.match(phoneRegex) || [];
    const footerPhones = (phoneMatches as string[]).map((p: string) => p.trim());
    
    return {
      emails: [...new Set(footerEmails)], // Remove duplicates
      phones: [...new Set(footerPhones)] // Remove duplicates
    };
  }

  /**
   * Discover and scrape additional pages (services, products, contact)
   */
  private async discoverAndScrapePages(baseUrl: string, homepageData: any): Promise<any> {
    const additionalPages: any = {};
    
    try {
      // STEP 1: Extract navigation links with labels from homepage HTML (already scraped!)
      console.log(`[SCRAPE] Extracting navigation links from homepage HTML...`);
      
      let navLinksWithLabels: Array<{url: string, label: string, source: string}> = [];
      
      // Use homepage HTML if available (most efficient - already scraped!)
      if (homepageData.html) {
        navLinksWithLabels = this.extractNavigationLinksFromHtml(homepageData.html, baseUrl);
        console.log(`[SCRAPE] Extracted ${navLinksWithLabels.length} navigation links from HTML`);
      } else {
        // Fallback: use basic links if HTML not available
        console.log(`[SCRAPE] Homepage HTML not available, using basic link extraction`);
        const internalLinks = homepageData.links || [];
        navLinksWithLabels = internalLinks.map((url: string) => ({
          url,
          label: '',
          source: 'fallback'
        }));
      }
      
      // STEP 2: Map links to page categories using enhanced findPageUrls (with labels)
      const pageUrls = this.findPageUrls(baseUrl, navLinksWithLabels);
      console.log(`[SCRAPE] Mapped pages:`, Object.keys(pageUrls));
      
      // If no pages found through links, try common URL patterns
      if (Object.keys(pageUrls).length === 0) {
        console.log(`[SCRAPE] No pages found through links, trying common URL patterns`);
        const commonUrls = this.generateCommonUrls(baseUrl);
        Object.assign(pageUrls, commonUrls);
      }
      
      // Scrape each discovered page
      for (const [pageType, url] of Object.entries(pageUrls)) {
        if (url && typeof url === 'string' && this.isValidScrapingUrl(url)) {
          // Skip login/auth pages (shouldn't happen due to exclusion, but double-check)
          const urlLower = url.toLowerCase();
          if (urlLower.includes('/login') || urlLower.includes('/signin') || 
              urlLower.includes('/sign-in') || urlLower.includes('/auth') ||
              urlLower.includes('/signup') || urlLower.includes('/register')) {
            console.log(`[SCRAPE] Skipping login/auth page: ${url}`);
            continue;
          }
          
          try {
            console.log(`[SCRAPE] Scraping ${pageType} page: ${url}`);
            
            // Check if this page is likely a SPA and use appropriate scraper
            const isSPA = await this.detectSPA(url);
            let pageData;
            
            if (isSPA) {
              console.log(`[SCRAPE] Detected SPA for ${pageType} page, using Playwright`);
              pageData = await this.playwrightScraper.scrapeUrl(url);
            } else {
              // Try Cheerio first, fallback to Playwright
              try {
                pageData = await this.cheerioScraper.scrapeUrl(url);
              } catch (cheerioError) {
                console.log(`[SCRAPE] Cheerio failed for ${pageType}, using Playwright`);
                pageData = await this.playwrightScraper.scrapeUrl(url);
              }
            }
            
            additionalPages[pageType] = {
              content: pageData.content,
              html: pageData.html,
              title: pageData.title,
              url: url,
              // Store extracted emails/phones from contact page for enrichment
              extractedEmails: pageData.extractedEmails || [],
              extractedPhones: pageData.extractedPhones || []
            };
            
            // Add delay between page requests
            await this.sleep(1000);
            
          } catch (error) {
            console.log(`[SCRAPE] Failed to scrape ${pageType} page: ${url} - ${error.message}`);
          }
        }
      }
      
    } catch (error) {
      console.log(`[SCRAPE] Page discovery failed: ${error.message}`);
    }
    
    return additionalPages;
  }

  /**
   * Check if homepage data suggests it's a SPA
   */
  private isLikelySPA(homepageData: any): boolean {
    const contentLength = homepageData.content?.trim().length || 0;
    const hasReactRoot = homepageData.html?.includes('id="root"') || homepageData.html?.includes('id="app"');
    return contentLength < 500 || hasReactRoot;
  }

  /**
   * Generate common URL patterns to try when link discovery fails
   */
  private generateCommonUrls(baseUrl: string): any {
    const baseUrlObj = new URL(baseUrl);
    const basePath = baseUrlObj.pathname.endsWith('/') ? baseUrlObj.pathname.slice(0, -1) : baseUrlObj.pathname;
    
    return {
      services: `${baseUrlObj.protocol}//${baseUrlObj.host}${basePath}/services`,
      products: `${baseUrlObj.protocol}//${baseUrlObj.host}${basePath}/products`,
      contact: `${baseUrlObj.protocol}//${baseUrlObj.host}${basePath}/contact`,
    };
  }

  /**
   * Simple fuzzy matching for URL patterns
   */
  private fuzzyMatch(pathname: string, pattern: string): boolean {
    const cleanPath = pathname.replace(/[^a-z]/g, '');
    const cleanPattern = pattern.replace(/[^a-z]/g, '');
    
    // Check if pattern words are contained in pathname
    const patternWords = cleanPattern.split('').filter(char => char !== '');
    const pathWords = cleanPath.split('').filter(char => char !== '');
    
    // Simple similarity check
    let matches = 0;
    for (const word of patternWords) {
      if (pathWords.includes(word)) {
        matches++;
      }
    }
    
    return matches >= Math.min(3, patternWords.length);
  }

  /**
   * Find potential page URLs from internal links - Enhanced with label matching
   */
  private findPageUrls(baseUrl: string, links: string[] | Array<{url: string, label: string, source: string}>): any {
    const baseDomain = new URL(baseUrl).hostname;
    const pageUrls: any = {};
    
    // Convert to unified format if needed
    const linksWithLabels: Array<{url: string, label: string, source: string}> = links.map(link => {
      if (typeof link === 'string') {
        return { url: link, label: '', source: 'fallback' };
      }
      return link;
    });
    
    // Enhanced page patterns with keywords for label matching
    const pagePatterns = {
      services: {
        urlPatterns: [
          '/services', '/service', '/what-we-do', '/our-services',
          '/offerings', '/solutions', '/expertise', '/capabilities',
          '/what-we-offer', '/our-work', '/specialties', '/practice-areas'
        ],
        labelKeywords: ['service', 'services', 'what we do', 'our services', 'offerings', 
                       'solutions', 'expertise', 'capabilities', 'specialties', 'practice']
      },
      products: {
        urlPatterns: [
          '/products', '/product', '/catalog', '/portfolio',
          '/gallery', '/work', '/projects', '/showcase',
          '/case-studies', '/examples'
        ],
        labelKeywords: ['product', 'products', 'catalog', 'portfolio', 'gallery', 
                       'work', 'projects', 'showcase', 'case study', 'examples']
      },
      contact: {
        urlPatterns: [
          '/contact', '/contact-us', '/get-in-touch', '/reach-us',
          '/location', '/locations', '/office', '/offices'
        ],
        labelKeywords: ['contact', 'get in touch', 'reach us', 'reach out', 
                       'connect', 'location', 'office', 'address', 'about us', 'about']
      }
    };
    
    // Exclude login/auth pages from mapping
    const excludedPaths = ['/login', '/signin', '/sign-in', '/auth', '/signup', '/sign-up', '/register', '/account', '/dashboard', '/admin'];
    
    // Check each link for page patterns
    for (const link of linksWithLabels) {
      try {
        const linkUrl = new URL(link.url);
        const pathname = linkUrl.pathname.toLowerCase();
        const label = link.label.toLowerCase();
        
        // Skip login/auth pages
        const isExcluded = excludedPaths.some(excluded => pathname.includes(excluded)) || 
                          label.includes('login') || label.includes('sign in') || 
                          label.includes('sign up') || label.includes('register');
        if (isExcluded) {
          continue;
        }
        
        // Check if link is from same domain
        if (linkUrl.hostname === baseDomain) {
          // Check for services pages
          if (!pageUrls.services) {
            let matched = false;
            
            // First check label keywords (strongest signal)
            for (const keyword of pagePatterns.services.labelKeywords) {
              if (label.includes(keyword)) {
                pageUrls.services = link.url;
                console.log(`[SCRAPE] Mapped services page by label "${link.label}": ${link.url}`);
                matched = true;
                break;
              }
            }
            
            // If no label match, check URL patterns
            if (!matched) {
              for (const pattern of pagePatterns.services.urlPatterns) {
                if (pathname.includes(pattern) || 
                    pathname.includes(pattern.replace('/', '')) ||
                    this.fuzzyMatch(pathname, pattern)) {
                  pageUrls.services = link.url;
                  console.log(`[SCRAPE] Mapped services page by URL pattern: ${link.url}`);
                  break;
                }
              }
            }
          }
          
          // Check for products pages
          if (!pageUrls.products) {
            let matched = false;
            
            // First check label keywords
            for (const keyword of pagePatterns.products.labelKeywords) {
              if (label.includes(keyword)) {
                pageUrls.products = link.url;
                console.log(`[SCRAPE] Mapped products page by label "${link.label}": ${link.url}`);
                matched = true;
                break;
              }
            }
            
            // If no label match, check URL patterns
            if (!matched) {
              for (const pattern of pagePatterns.products.urlPatterns) {
                if (pathname.includes(pattern) || 
                    pathname.includes(pattern.replace('/', '')) ||
                    this.fuzzyMatch(pathname, pattern)) {
                  pageUrls.products = link.url;
                  console.log(`[SCRAPE] Mapped products page by URL pattern: ${link.url}`);
                  break;
                }
              }
            }
          }
          
          // Check for contact pages
          if (!pageUrls.contact) {
            let matched = false;
            
            // First check label keywords
            for (const keyword of pagePatterns.contact.labelKeywords) {
              if (label.includes(keyword)) {
                pageUrls.contact = link.url;
                console.log(`[SCRAPE] Mapped contact page by label "${link.label}": ${link.url}`);
                matched = true;
                break;
              }
            }
            
            // If no label match, check URL patterns
            if (!matched) {
              for (const pattern of pagePatterns.contact.urlPatterns) {
                if (pathname.includes(pattern) || 
                    pathname.includes(pattern.replace('/', '')) ||
                    this.fuzzyMatch(pathname, pattern)) {
                  pageUrls.contact = link.url;
                  console.log(`[SCRAPE] Mapped contact page by URL pattern: ${link.url}`);
                  break;
                }
              }
            }
          }
        }
      } catch (error) {
        // Invalid URL, skip
        continue;
      }
    }
    
    return pageUrls;
  }

  /**
   * Validate if URL is safe to scrape
   */
  private isValidScrapingUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      
      // Must be HTTP/HTTPS
      if (!urlObj.protocol.startsWith('http')) {
        return false;
      }
      
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
      
      return true;
    } catch (error) {
      // Invalid URL
      return false;
    }
  }

  /**
   * Get all contacts ready to scrape for an upload
   */
  async getReadyToScrapeContacts(uploadId: number, limit?: number) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        csvUploadId: uploadId,
        status: 'ready_to_scrape',
      },
      orderBy: {
        scrapePriority: 'asc',
      },
      take: limit,
    });

    // Get latest ScrapedData for each contact to include errorMessage
    const contactIds = contacts.map(c => c.id);
    if (contactIds.length === 0) {
      return contacts;
    }

    const allFailedScrapedData = await this.prisma.scrapedData.findMany({
      where: {
        contactId: { in: contactIds },
        scrapeSuccess: false,
      },
      orderBy: {
        scrapedAt: 'desc',
      },
    });

    // Group by contactId and get the latest one (first in desc order) for each contact
    const latestScrapedDataMap = new Map<number, any>();
    for (const sd of allFailedScrapedData) {
      if (!latestScrapedDataMap.has(sd.contactId)) {
        latestScrapedDataMap.set(sd.contactId, sd);
      }
    }

    // Create a map of contactId -> latest errorMessage
    const errorMessageMap = new Map(
      Array.from(latestScrapedDataMap.values()).map(sd => [sd.contactId, sd.errorMessage])
    );

    // Add errorMessage to contacts
    return contacts.map(contact => ({
      ...contact,
      errorMessage: errorMessageMap.get(contact.id) || null,
    }));
  }

  /**
   * Get all contacts for an upload (all statuses) with error messages
   */
  async getAllContacts(uploadId: number, limit?: number) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        csvUploadId: uploadId,
      },
      orderBy: {
        scrapePriority: 'asc',
      },
      take: limit,
    });

    // Get latest ScrapedData for each contact to include errorMessage
    const contactIds = contacts.map(c => c.id);
    if (contactIds.length === 0) {
      return contacts;
    }

    const allFailedScrapedData = await this.prisma.scrapedData.findMany({
      where: {
        contactId: { in: contactIds },
        scrapeSuccess: false,
      },
      orderBy: {
        scrapedAt: 'desc',
      },
    });

    // Group by contactId and get the latest one (first in desc order) for each contact
    const latestScrapedDataMap = new Map<number, any>();
    for (const sd of allFailedScrapedData) {
      if (!latestScrapedDataMap.has(sd.contactId)) {
        latestScrapedDataMap.set(sd.contactId, sd);
      }
    }

    // Create a map of contactId -> latest errorMessage
    const errorMessageMap = new Map(
      Array.from(latestScrapedDataMap.values()).map(sd => [sd.contactId, sd.errorMessage])
    );

    // Add errorMessage to contacts
    return contacts.map(contact => ({
      ...contact,
      errorMessage: errorMessageMap.get(contact.id) || null,
    }));
  }

  /**
   * Reset a contact's scraping status (for retry)
   */
  async resetContactStatus(contactId: number) {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found`);
    }

    // Only allow reset if status is scrape_failed
    if (contact.status !== 'scrape_failed') {
      throw new BadRequestException(
        `Can only reset contacts with status 'scrape_failed'. Current status: ${contact.status}`,
      );
    }

    return this.prisma.contact.update({
      where: { id: contactId },
      data: { status: 'ready_to_scrape' as ContactStatus },
    });
  }
}