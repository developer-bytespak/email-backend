import { Controller, Get, Query, Param, UseGuards, Request } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('dashboard/stats')
  async getDashboardStats(@Request() req) {
    const clientId = req.user.id;
    const stats = await this.analyticsService.getDashboardStats(clientId);
    
    return {
      message: 'Dashboard statistics retrieved successfully',
      stats,
    };
  }

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
