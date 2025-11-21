import { Module } from '@nestjs/common';
import { QueueRealtimeController } from './queue-realtime.controller';
import { QueueRealtimeService } from './queue-realtime.service';

@Module({
  controllers: [QueueRealtimeController],
  providers: [QueueRealtimeService],
  exports: [QueueRealtimeService],
})
export class QueueRealtimeModule {}

