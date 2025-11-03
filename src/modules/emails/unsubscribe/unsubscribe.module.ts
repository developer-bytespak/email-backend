import { Module } from '@nestjs/common';
import { UnsubscribeService } from './unsubscribe.service';
import { UnsubscribeController } from './unsubscribe.controller';
import { PrismaModule } from '../../../config/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UnsubscribeController],
  providers: [UnsubscribeService],
  exports: [UnsubscribeService],
})
export class UnsubscribeModule {}

