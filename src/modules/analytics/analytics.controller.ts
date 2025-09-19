import { Controller, Get, Query, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('campaigns/:id/metrics')
  async getCampaignMetrics(@Param('id') id: string) {
    return this.analyticsService.getCampaignMetrics(id);
  }

  @Get('reports')
  async generateReport(@Query() query: any) {
    return this.analyticsService.generateReport(query);
  }

  @Get('exports/:id')
  async exportData(@Param('id') id: string) {
    return this.analyticsService.exportData(id);
  }
}
