import { Module } from '@nestjs/common';
import { ScrapingHistoryController } from './scraping-history.controller';
import { ScrapingHistoryService } from './scraping-history.service';

@Module({
  controllers: [ScrapingHistoryController],
  providers: [ScrapingHistoryService],
  exports: [ScrapingHistoryService],
})
export class ScrapingHistoryModule {}
