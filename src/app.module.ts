import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './config/prisma.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { ValidationModule } from './modules/validation/validation.module';
import { AuthModule } from './modules/auth/auth.module';
import { ScrapingModule } from './modules/scraping/scraping.module';
import { SummarizationModule } from './modules/summarization/summarization.module';

@Module({
  imports: [
    PrismaModule,
    IngestionModule,
    ValidationModule,
    AuthModule,
    ScrapingModule,
    SummarizationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
