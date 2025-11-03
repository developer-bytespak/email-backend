import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class EmailTrackingService {
  private readonly logger = new Logger(EmailTrackingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate unique tracking token
   */
  generateTrackingToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Record email open event
   */
  async recordOpen(token: string): Promise<void> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Find EmailLog by tracking pixel token
      const emailLog = await scrapingClient.emailLog.findUnique({
        where: { trackingPixelToken: token },
        include: {
          contact: true,
        },
      });

      if (!emailLog) {
        this.logger.warn(`EmailLog not found for token: ${token}`);
        return;
      }

      // Check if already recorded (avoid duplicates)
      const existingOpen = await scrapingClient.emailEngagement.findFirst({
        where: {
          emailLogId: emailLog.id,
          engagementType: 'open',
        },
      });

      if (existingOpen) {
        // Already recorded, skip
        return;
      }

      // Create engagement record
      await scrapingClient.emailEngagement.create({
        data: {
          emailLogId: emailLog.id,
          contactId: emailLog.contactId,
          engagementType: 'open',
          engagedAt: new Date(),
        },
      });

      this.logger.log(`✅ Email open recorded (EmailLog ID: ${emailLog.id})`);
    } catch (error) {
      this.logger.error(`Failed to record email open for token ${token}:`, error);
    }
  }

  /**
   * Record email click event and return redirect URL
   */
  async recordClick(token: string, originalUrl: string): Promise<string> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Find EmailLog by tracking pixel token (same token used for clicks)
      const emailLog = await scrapingClient.emailLog.findUnique({
        where: { trackingPixelToken: token },
        include: {
          contact: true,
        },
      });

      if (!emailLog) {
        this.logger.warn(`EmailLog not found for token: ${token}`);
        return originalUrl; // Return original URL if token not found
      }

      // Create engagement record for click
      await scrapingClient.emailEngagement.create({
        data: {
          emailLogId: emailLog.id,
          contactId: emailLog.contactId,
          engagementType: 'click',
          url: originalUrl,
          engagedAt: new Date(),
        },
      });

      this.logger.log(`✅ Email click recorded (EmailLog ID: ${emailLog.id}, URL: ${originalUrl})`);

      // Return original URL for redirect
      return originalUrl;
    } catch (error) {
      this.logger.error(`Failed to record email click for token ${token}:`, error);
      return originalUrl; // Return original URL on error
    }
  }

  /**
   * Generate 1x1 transparent PNG pixel
   */
  generateTrackingPixel(): Buffer {
    // 1x1 transparent PNG in base64
    const pixelBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    return Buffer.from(pixelBase64, 'base64');
  }

  /**
   * Get engagement statistics for an email
   */
  async getEngagementStats(emailLogId: number): Promise<{
    emailLogId: number;
    opens: number;
    clicks: number;
    openRate?: number;
    clickRate?: number;
    engagements: any[];
  }> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const emailLog = await scrapingClient.emailLog.findUnique({
      where: { id: emailLogId },
    });

    if (!emailLog) {
      throw new NotFoundException(`EmailLog with ID ${emailLogId} not found`);
    }

    const engagements = await scrapingClient.emailEngagement.findMany({
      where: { emailLogId },
      orderBy: { engagedAt: 'desc' },
    });

    const opens = engagements.filter(e => e.engagementType === 'open').length;
    const clicks = engagements.filter(e => e.engagementType === 'click').length;

    return {
      emailLogId,
      opens,
      clicks,
      openRate: opens > 0 ? (opens / 1) * 100 : 0, // Simplified calculation
      clickRate: opens > 0 ? (clicks / opens) * 100 : 0,
      engagements,
    };
  }
}

