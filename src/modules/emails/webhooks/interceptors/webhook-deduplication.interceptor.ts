import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../../../config/prisma.service';

@Injectable()
export class WebhookDeduplicationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(WebhookDeduplicationInterceptor.name);
  private readonly processedEvents = new Set<string>(); // In-memory cache (use Redis in production)

  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const body = request.body;
    
    // SendGrid sends events as an array
    const events = Array.isArray(body) ? body : [body];
    
    // Filter out duplicate events using sg_event_id
    const uniqueEvents = await this.filterDuplicates(events);
    
    // Replace body with deduplicated events
    request.body = uniqueEvents.length === 1 ? uniqueEvents[0] : uniqueEvents;
    
    if (uniqueEvents.length < events.length) {
      this.logger.debug(`Filtered ${events.length - uniqueEvents.length} duplicate events`);
    }
    
    return next.handle();
  }

  private async filterDuplicates(events: any[]): Promise<any[]> {
    const uniqueEvents: any[] = [];
    
    for (const event of events) {
      if (!event.sg_event_id) {
        // If no event ID, include it (can't deduplicate)
        uniqueEvents.push(event);
        continue;
      }
      
      // Check if we've seen this event before
      const isDuplicate = this.processedEvents.has(event.sg_event_id);
      
      if (!isDuplicate) {
        uniqueEvents.push(event);
        this.processedEvents.add(event.sg_event_id);
        
        // Clean up old events (keep last 10,000 in memory)
        if (this.processedEvents.size > 10000) {
          const first = this.processedEvents.values().next().value;
          this.processedEvents.delete(first);
        }
      } else {
        this.logger.debug(`Skipping duplicate event: ${event.sg_event_id}`);
      }
    }
    
    return uniqueEvents;
  }
}

