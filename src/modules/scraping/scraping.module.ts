import { Module } from '@nestjs/common';
import { ScrapingService } from './scraping.service';
import { ScrapingController } from './scraping.controller';
import { PrismaModule } from '../../config/prisma.module';
import { CheerioScraperService } from './scrapers/cheerio.scraper';
import { PlaywrightScraperService } from './scrapers/playwright.scraper';
import { GoogleSearchService } from './scrapers/google-search.service';
import { ScrapingHistoryModule } from './history/scraping-history.module';

@Module({
  imports: [
    PrismaModule, // Import global Prisma module
    ScrapingHistoryModule, // Import scraping history module
  ],
  controllers: [ScrapingController],
  providers: [
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