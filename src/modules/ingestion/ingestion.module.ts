import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { PrismaService } from '../../common/services/prisma.service';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, PrismaService],
  exports: [IngestionService],
})
export class IngestionModule {}
