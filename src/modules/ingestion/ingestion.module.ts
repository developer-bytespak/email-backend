import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { PrismaService } from '../../common/services/prisma.service';
import { StrategyFactory } from './strategies/strategy-factory';
import { PromotionalStrategy } from './strategies/promotional.strategy';
import { PersonalStrategy } from './strategies/personal.strategy';
import { CsvParserService } from './services/csv-parser.service';
import { DuplicateDetectorService } from './services/duplicate-detector.service';
import { GoogleSearchService } from './services/google-search.service';
import { ColumnMapperService } from './services/column-mapper.service';
import { WebsiteResolverService } from './services/website-resolver.service';
import { EmailValidatorService } from './services/email-validator.service';
import { BusinessNameResolverService } from './services/business-name-resolver.service';
import { QueueService } from './services/queue.service';
import { DnsValidationService } from './services/dns-validation.service';
import { RetryService } from './services/retry.service';
import { CacheService } from './services/cache.service';
import { ProcessingConfigService } from './config/processing-config.service';
import { FeatureFlagsService } from './config/feature-flags.service';
import { ErrorHandlingService } from './services/error-handling.service';
import { UserFeedbackService } from './services/user-feedback.service';
import { ProgressTrackingService } from './services/progress-tracking.service';
import { NotificationService } from './services/notification.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'csv-processing' },
      { name: 'email-validation' },
      { name: 'website-resolution' },
    ),
    EventEmitterModule.forRoot(),
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    PrismaService,
    StrategyFactory,
    PromotionalStrategy,
    PersonalStrategy,
    CsvParserService,
    DuplicateDetectorService,
    GoogleSearchService,
    ColumnMapperService,
    WebsiteResolverService,
    EmailValidatorService,
    BusinessNameResolverService,
    QueueService,
    DnsValidationService,
    RetryService,
    CacheService,
    ProcessingConfigService,
    FeatureFlagsService,
    ErrorHandlingService,
    UserFeedbackService,
    ProgressTrackingService,
    NotificationService,
  ],
  exports: [
    IngestionService,
    QueueService,
    CacheService,
    ProcessingConfigService,
    FeatureFlagsService,
    ErrorHandlingService,
    UserFeedbackService,
    ProgressTrackingService,
    NotificationService,
  ],
})
export class IngestionModule {}
