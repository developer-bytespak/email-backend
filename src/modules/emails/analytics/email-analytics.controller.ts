import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DateRangeQueryDto } from './date-range-query.dto';
import {
  EmailAnalyticsService,
  EmailAnalyticsOverview,
  EmailAnalyticsTimelinePoint,
  EmailAnalyticsEvent,
} from './email-analytics.service';

@UseGuards(JwtAuthGuard)
@Controller('emails/analytics')
export class EmailAnalyticsController {
  constructor(private readonly analyticsService: EmailAnalyticsService) {}

  @Get('overview')
  async getOverview(
    @Request() req: { user: { id: number } },
    @Query() query: DateRangeQueryDto,
  ): Promise<{ success: true; data: EmailAnalyticsOverview }> {
    const range = this.normalizeRange(query);
    const data = await this.analyticsService.getOverview(req.user.id, range);

    return {
      success: true,
      data,
    };
  }

  @Get('timeline')
  async getTimeline(
    @Request() req: { user: { id: number } },
    @Query() query: DateRangeQueryDto,
  ): Promise<{ success: true; data: EmailAnalyticsTimelinePoint[] }> {
    const range = this.normalizeRange(query);
    const data = await this.analyticsService.getTimeline(req.user.id, range);

    return {
      success: true,
      data,
    };
  }

  @Get('events')
  async getEvents(
    @Request() req: { user: { id: number } },
    @Query() query: DateRangeQueryDto,
  ): Promise<{ success: true; data: EmailAnalyticsEvent[] }> {
    const range = this.normalizeRange(query);
    const data = await this.analyticsService.getRecentEvents(req.user.id, range, 50);

    return {
      success: true,
      data,
    };
  }

  private normalizeRange(query: DateRangeQueryDto) {
    const now = new Date();
    const toDate = query.to ? new Date(query.to) : now;
    const fromDate = query.from ? new Date(query.from) : new Date(toDate);

    if (!query.from) {
      fromDate.setDate(toDate.getDate() - 13);
    }

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(23, 59, 59, 999);

    if (fromDate > toDate) {
      return {
        from: toDate,
        to: fromDate,
      };
    }

    return { from: fromDate, to: toDate };
  }
}


