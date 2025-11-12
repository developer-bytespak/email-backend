import { Module } from '@nestjs/common';
import { ScrapingService } from './scraping.service';
import { ScrapingController } from './scraping.controller';
import { CheerioScraperService } from './scrapers/cheerio.scraper';
import { PlaywrightScraperService } from './scrapers/playwright.scraper';
import { GoogleSearchService } from './scrapers/google-search.service';
import { ProxyManagerService } from './scrapers/proxy-manager.service';
import { ScrapingHistoryModule } from './history/scraping-history.module';

@Module({
  imports: [
    ScrapingHistoryModule, // Import scraping history module
  ],
  controllers: [ScrapingController],
  providers: [
    ProxyManagerService, // Proxy manager must be provided first
    ScrapingService,
    CheerioScraperService,
    PlaywrightScraperService,
    GoogleSearchService,
    // TODO: Add additional services when implemented
    // ContentExtractorService,
    // EntityExtractorService,
  ],
  exports: [ScrapingService], // Export if other modules need it
})
export class ScrapingModule {}