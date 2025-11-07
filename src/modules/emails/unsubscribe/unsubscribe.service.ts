import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class UnsubscribeService {
  private readonly logger = new Logger(UnsubscribeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate unique unsubscribe token
   */
  generateUnsubscribeToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Process unsubscribe request
   */
  async processUnsubscribe(token: string, reason?: string): Promise<{
    success: boolean;
    contactId: number;
    message: string;
  }> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Find EmailLog by unsubscribe token
      const emailLog = await scrapingClient.emailLog.findFirst({
        where: {
          OR: [
            { unsubscribeToken: token },
            { trackingPixelToken: token }, // Fallback for backward compatibility
          ],
        },
        include: {
          contact: true,
        },
      });

      if (!emailLog) {
        throw new NotFoundException('Invalid unsubscribe token');
      }

      const contactId = emailLog.contactId;

      // Check if already unsubscribed
      const existing = await scrapingClient.emailUnsubscribe.findUnique({
        where: { contactId },
      });

      if (existing) {
        return {
          success: true,
          contactId,
          message: 'You are already unsubscribed from our emails.',
        };
      }

      // Create unsubscribe record
      await scrapingClient.emailUnsubscribe.create({
        data: {
          contactId,
          unsubscribeEmailLogId: emailLog.id,
          unsubscribedAt: new Date(),
          reason: reason || null,
        },
      });

      this.logger.log(`✅ Contact ${contactId} unsubscribed (EmailLog ID: ${emailLog.id})`);

      return {
        success: true,
        contactId,
        message: 'You have been successfully unsubscribed from our emails.',
      };
    } catch (error) {
      this.logger.error(`Failed to process unsubscribe for token ${token}:`, error);
      throw error;
    }
  }

  /**
   * Check if contact is unsubscribed
   */
  async isUnsubscribed(contactId: number): Promise<boolean> {
    const scrapingClient = await this.prisma.getScrapingClient();
    const unsubscribe = await scrapingClient.emailUnsubscribe.findUnique({
      where: { contactId },
    });

    return !!unsubscribe;
  }

  /**
   * Get unsubscribe history for a contact by token
   */
  async getUnsubscribeHistory(token: string): Promise<{
    contactId: number;
    contactEmail: string;
    isUnsubscribed: boolean;
    unsubscribeRecord?: {
      id: number;
      unsubscribedAt: Date;
      reason: string | null;
    };
  }> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    // Find EmailLog by token to get contactId
    const emailLog = await scrapingClient.emailLog.findFirst({
      where: {
        OR: [
          { unsubscribeToken: token },
          { trackingPixelToken: token }, // Fallback for backward compatibility
        ],
      },
      include: {
        contact: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!emailLog) {
      throw new NotFoundException('Invalid token');
    }

    const contactId = emailLog.contactId;
    const contactEmail = emailLog.contact.email || 'Unknown';

    // Check if unsubscribed
    const unsubscribeRecord = await scrapingClient.emailUnsubscribe.findUnique({
      where: { contactId },
      select: {
        id: true,
        unsubscribedAt: true,
        reason: true,
      },
    });

    return {
      contactId,
      contactEmail,
      isUnsubscribed: !!unsubscribeRecord,
      unsubscribeRecord: unsubscribeRecord || undefined,
    };
  }

  /**
   * Resubscribe contact (remove from unsubscribe list)
   */
  async resubscribe(token: string): Promise<{
    success: boolean;
    contactId: number;
    message: string;
  }> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Find EmailLog by token to get contactId
      const emailLog = await scrapingClient.emailLog.findFirst({
        where: {
          OR: [
            { unsubscribeToken: token },
            { trackingPixelToken: token }, // Fallback for backward compatibility
          ],
        },
        include: {
          contact: true,
        },
      });

      if (!emailLog) {
        throw new NotFoundException('Invalid token');
      }

      const contactId = emailLog.contactId;

      // Check if unsubscribed
      const unsubscribeRecord = await scrapingClient.emailUnsubscribe.findUnique({
        where: { contactId },
      });

      if (!unsubscribeRecord) {
        return {
          success: true,
          contactId,
          message: 'You are already subscribed to our emails.',
        };
      }

      // Delete unsubscribe record
      await scrapingClient.emailUnsubscribe.delete({
        where: { contactId },
      });

      this.logger.log(`✅ Contact ${contactId} resubscribed`);

      return {
        success: true,
        contactId,
        message: 'You have been successfully resubscribed. You will receive emails again.',
      };
    } catch (error) {
      this.logger.error(`Failed to resubscribe for token ${token}:`, error);
      throw error;
    }
  }

  /**
   * Inject unsubscribe link into email body
   */
  injectUnsubscribeLink(html: string, token: string, baseUrl: string): string {
    const unsubscribeUrl = `${baseUrl}/emails/unsubscribe/${token}`;
    const unsubscribeHtml = `
<div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; font-size: 10px; color: #999; text-align: center;">
  <p>You're receiving this email because you're on our outreach list.</p>
  <p><a href="${unsubscribeUrl}" style="color: #999; text-decoration: underline;">Unsubscribe</a></p>
</div>`;

    // Append unsubscribe link before closing body tag, or at end if no body tag
    if (html.includes('</body>')) {
      return html.replace('</body>', `${unsubscribeHtml}</body>`);
    }
    return `${html}${unsubscribeHtml}`;
  }

  /**
   * Get all unsubscribe records
   */
  async getAllUnsubscribes(): Promise<
    Array<{
      id: number;
      contactId: number;
      email: string | null;
      businessName: string;
      phone: string | null;
      unsubscribedAt: Date;
      reason: string | null;
    }>
  > {
    const scrapingClient = await this.prisma.getScrapingClient();

    const records = await scrapingClient.emailUnsubscribe.findMany({
      orderBy: {
        unsubscribedAt: 'desc',
      },
      include: {
        contact: {
          select: {
            id: true,
            email: true,
            businessName: true,
            phone: true,
          },
        },
      },
    });

    return records.map(record => ({
      id: record.id,
      contactId: record.contactId,
      email: record.contact?.email ?? null,
      businessName: record.contact?.businessName ?? 'Unknown',
      phone: record.contact?.phone ?? null,
      unsubscribedAt: record.unsubscribedAt,
      reason: record.reason,
    }));
  }

  /**
   * Resubscribe a contact by ID (dashboard API)
   */
  async resubscribeByContactId(clientId: number, contactId: number): Promise<{
    success: boolean;
    contactId: number;
    message: string;
  }> {
    const scrapingClient = await this.prisma.getScrapingClient();

    const unsubscribeRecord = await scrapingClient.emailUnsubscribe.findUnique({
      where: { contactId },
      include: {
        contact: {
          select: {
            id: true,
            csvUpload: {
              select: {
                clientId: true,
              },
            },
          },
        },
      },
    });

    if (!unsubscribeRecord) {
      throw new NotFoundException('Unsubscribe record not found');
    }

    if (unsubscribeRecord.contact.csvUpload.clientId !== clientId) {
      throw new ForbiddenException('You do not have access to this contact');
    }

    await scrapingClient.emailUnsubscribe.delete({
      where: { contactId },
    });

    this.logger.log(`✅ Contact ${contactId} resubscribed via dashboard`);

    return {
      success: true,
      contactId,
      message: 'Contact resubscribed successfully.',
    };
  }
}

