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
   * Scrape a single contact by ID
   */
  async scrapeContact(contactId: number): Promise<ScrapeResult> {
    try {
      // Get contact with validation data
      const contact = await this.prisma.contact.findUnique({
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

      // Update status to scraping
      await this.prisma.contact.update({
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
          scrapedData = await this.scrapeFromBusinessSearch(contact);
          break;
        default:
          throw new BadRequestException(
            `Unknown scrape method: ${contact.scrapeMethod}`,
          );
      }

      // Save scraped data to database
      const savedScrapedData = await this.prisma.scrapedData.create({
        data: {
          contactId: contact.id,
          method: contact.scrapeMethod,
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

      // Update contact status to scraped
      await this.prisma.contact.update({
        where: { id: contactId },
        data: { status: 'scraped' as ContactStatus },
      });

      return {
        contactId: contact.id,
        success: true,
        scrapedData: savedScrapedData,
      };
    } catch (error) {
      // Update contact status to scrape_failed
      await this.prisma.contact.update({
        where: { id: contactId },
        data: { 
          status: 'scrape_failed' as ContactStatus,
        },
      });

      return {
        contactId,
        success: false,
        error: error.message || 'Unknown scraping error',
      };
    }
  }

  /**
   * Scrape multiple contacts in batch
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

    // Scrape each contact
    const results: ScrapeResult[] = [];
    let successful = 0;
    let failed = 0;

    for (const contact of contacts) {
      try {
        const result = await this.scrapeContact(contact.id);
        results.push(result);

        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        results.push({
          contactId: contact.id,
          success: false,
          error: error.message || 'Unknown error',
        });
        failed++;
      }

      // Add small delay between requests to avoid overwhelming servers
      await this.sleep(1000); // 1 second delay
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
    const contacts = await this.prisma.contact.groupBy({
      by: ['status'],
      where: { csvUploadId: uploadId },
      _count: true,
    });

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
      const count = group._count;
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
   * Priority 1: Scrape directly from website URL
   */
  private async scrapeDirectUrl(contact: any): Promise<any> {
    console.log(`[SCRAPE] Direct URL scraping for: ${contact.website}`);
    
    try {
      // Scrape homepage first
      let homepageData;
      try {
        homepageData = await this.cheerioScraper.scrapeUrl(contact.website);
      } catch (cheerioError) {
        console.log(`[SCRAPE] Cheerio failed, trying Playwright for: ${contact.website}`);
        homepageData = await this.playwrightScraper.scrapeUrl(contact.website);
      }

      // Discover and scrape additional pages
      const additionalPages = await this.discoverAndScrapePages(contact.website, homepageData);
      
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
        extractedEmails: homepageData.extractedEmails,
        extractedPhones: homepageData.extractedPhones,
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
        extractedEmails: homepageData.extractedEmails,
        extractedPhones: homepageData.extractedPhones,
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
   */
  private async scrapeFromBusinessSearch(contact: any): Promise<any> {
    console.log(`[SCRAPE] Business search for: ${contact.businessName}`);
    
    // Build search query
    const searchTerms = [
      contact.businessName,
      contact.state,
      contact.zipCode,
    ].filter(Boolean);
    const searchQuery = searchTerms.join(' ');

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
        extractedEmails: homepageData.extractedEmails,
        extractedPhones: homepageData.extractedPhones,
        pageTitle: homepageData.title,
        metaDescription: homepageData.metaDescription,
        scrapeSuccess: homepageData.scrapeSuccess,
        timestamp: homepageData.timestamp,
      };
    } catch (error) {
      console.error(`[SCRAPE] Business search failed for ${contact.businessName}:`, error);
      throw new Error(`Business search failed: ${error.message}`);
    }
  }

  /**
   * Utility: Sleep function for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Discover and scrape additional pages (services, products, contact)
   */
  private async discoverAndScrapePages(baseUrl: string, homepageData: any): Promise<any> {
    const additionalPages: any = {};
    
    try {
      // Extract internal links from homepage
      const internalLinks = homepageData.links || [];
      
      // Find potential page URLs
      const pageUrls = this.findPageUrls(baseUrl, internalLinks);
      
      // Scrape each discovered page
      for (const [pageType, url] of Object.entries(pageUrls)) {
        if (url && typeof url === 'string' && this.isValidScrapingUrl(url)) {
          try {
            console.log(`[SCRAPE] Scraping ${pageType} page: ${url}`);
            
            // Try Cheerio first, fallback to Playwright
            let pageData;
            try {
              pageData = await this.cheerioScraper.scrapeUrl(url);
            } catch (cheerioError) {
              pageData = await this.playwrightScraper.scrapeUrl(url);
            }
            
            additionalPages[pageType] = {
              content: pageData.content,
              html: pageData.html,
              title: pageData.title,
              url: url
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
   * Find potential page URLs from internal links
   */
  private findPageUrls(baseUrl: string, links: string[]): any {
    const baseDomain = new URL(baseUrl).hostname;
    const pageUrls: any = {};
    
    // Common page patterns to look for
    const pagePatterns = {
      services: [
        '/services', '/service', '/what-we-do', '/our-services',
        '/offerings', '/solutions', '/expertise'
      ],
      products: [
        '/products', '/product', '/catalog', '/portfolio',
        '/gallery', '/work', '/projects'
      ],
      contact: [
        '/contact', '/contact-us', '/get-in-touch', '/reach-us',
        '/about', '/about-us', '/company'
      ]
    };
    
    // Check each link for page patterns
    for (const link of links) {
      try {
        const linkUrl = new URL(link);
        const pathname = linkUrl.pathname.toLowerCase();
        
        // Check if link is from same domain
        if (linkUrl.hostname === baseDomain) {
          // Check for services pages
          if (!pageUrls.services) {
            for (const pattern of pagePatterns.services) {
              if (pathname.includes(pattern)) {
                pageUrls.services = link;
                break;
              }
            }
          }
          
          // Check for products pages
          if (!pageUrls.products) {
            for (const pattern of pagePatterns.products) {
              if (pathname.includes(pattern)) {
                pageUrls.products = link;
                break;
              }
            }
          }
          
          // Check for contact pages
          if (!pageUrls.contact) {
            for (const pattern of pagePatterns.contact) {
              if (pathname.includes(pattern)) {
                pageUrls.contact = link;
                break;
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
    return this.prisma.contact.findMany({
      where: {
        csvUploadId: uploadId,
        status: 'ready_to_scrape',
      },
      orderBy: {
        scrapePriority: 'asc',
      },
      take: limit,
    });
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