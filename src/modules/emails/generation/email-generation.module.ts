import { Module } from '@nestjs/common';
import { EmailGenerationController } from './email-generation.controller';
import { EmailGenerationService } from './email-generation.service';
import { PrismaModule } from '../../../config/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmailGenerationController],
  providers: [EmailGenerationService],
  exports: [EmailGenerationService],
})
export class EmailGenerationModule {}
