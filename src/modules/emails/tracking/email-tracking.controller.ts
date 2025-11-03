import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EmailTrackingService } from './email-tracking.service';

@Controller('emails/tracking')
export class EmailTrackingController {
  constructor(private readonly trackingService: EmailTrackingService) {}

  /**
   * Serve 1x1 tracking pixel (public endpoint, no auth)
   * GET /emails/tracking/pixel/:token
   */
  @Get('pixel/:token')
  async serveTrackingPixel(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    // Record the open event (fire and forget)
    this.trackingService.recordOpen(token).catch(err => {
      // Silently fail - don't block pixel serving
      console.error('Failed to record open:', err);
    });

    // Return 1x1 transparent PNG
    const pixel = this.trackingService.generateTrackingPixel();
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    });
    res.send(pixel);
  }

  /**
   * Track click and redirect to original URL (public endpoint, no auth)
   * GET /emails/tracking/click/:token?url=...
   */
  @Get('click/:token')
  async trackClick(
    @Param('token') token: string,
    @Query('url') url: string,
    @Res() res: Response,
  ) {
    if (!url) {
      return res.status(400).send('Missing URL parameter');
    }

    // Record the click and get redirect URL
    const redirectUrl = await this.trackingService.recordClick(token, url);
    
    // Redirect to original URL
    res.redirect(redirectUrl);
  }

  /**
   * Get engagement statistics for an email (protected endpoint)
   * GET /emails/tracking/engagement/:emailLogId
   */
  @Get('engagement/:emailLogId')
  async getEngagementStats(@Param('emailLogId') emailLogId: string) {
    const stats = await this.trackingService.getEngagementStats(parseInt(emailLogId));
    
    return {
      success: true,
      message: 'Engagement statistics retrieved',
      data: stats,
    };
  }
}

