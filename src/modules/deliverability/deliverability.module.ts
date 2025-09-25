import { Module } from '@nestjs/common';
import { DeliverabilityService } from './deliverability.service';

@Module({
  providers: [DeliverabilityService],
  exports: [DeliverabilityService],
})
export class DeliverabilityModule {}
