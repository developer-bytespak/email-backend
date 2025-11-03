import { Module } from '@nestjs/common';
import { EmailTrackingService } from './email-tracking.service';
import { EmailTrackingController } from './email-tracking.controller';
import { PrismaModule } from '../../../config/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EmailTrackingController],
  providers: [EmailTrackingService],
  exports: [EmailTrackingService],
})
export class EmailTrackingModule {}

