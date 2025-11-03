import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import sgMail, { MailDataRequired } from '@sendgrid/mail';
import { PrismaService } from '../../../../config/prisma.service';

@Injectable()
export class SendGridService {
  private readonly logger = new Logger(SendGridService.name);

  constructor(private readonly prisma: PrismaService) {
    // Initialize SendGrid with API key from environment
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      this.logger.warn('SENDGRID_API_KEY not found in environment variables');
    } else {
      sgMail.setApiKey(apiKey);
      this.logger.log('✅ SendGrid initialized');
    }
  }

  /**
   * Send email via SendGrid with native tracking enabled
   */
  async sendEmail(
    to: string,
    from: string,
    subject: string,
    html: string,
    options?: {
      messageId?: string;
      unsubscribeToken?: string;
      trackingPixelToken?: string;
    }
  ): Promise<{ messageId: string; response: any }> {
    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

      // Prepare email content with unsubscribe link
      let processedHtml = html;
      if (options?.unsubscribeToken) {
        processedHtml = this.injectUnsubscribeLink(processedHtml, options.unsubscribeToken, baseUrl);
      }

      // Optional: Inject custom tracking pixel (backup method)
      if (options?.trackingPixelToken) {
        processedHtml = this.injectTrackingPixel(processedHtml, options.trackingPixelToken, baseUrl);
      }

      // Prepare SendGrid message
      const msg: MailDataRequired = {
        to,
        from,
        subject,
        html: processedHtml,
        
        // PRIMARY TRACKING METHOD (80-90% accuracy)
        trackingSettings: {
          openTracking: {
            enable: true,
          },
          clickTracking: {
            enable: true,
            enableText: true,
          },
        },
      };

      // Send email via SendGrid
      const [response] = await sgMail.send(msg);

      // Extract message ID from response headers
      const messageId = response.headers['x-message-id'] as string;

      this.logger.log(`✅ Email sent via SendGrid (Message ID: ${messageId})`);

      return {
        messageId: messageId || `sg_${Date.now()}`,
        response: response,
      };
    } catch (error: any) {
      this.logger.error(`❌ SendGrid send failed:`, error);
      
      if (error.response?.body) {
        throw new BadRequestException(`SendGrid error: ${JSON.stringify(error.response.body)}`);
      }
      
      throw new BadRequestException(`Failed to send email: ${error.message}`);
    }
  }

  /**
   * Inject unsubscribe link at bottom of email
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
   * Inject tracking pixel (backup method - optional)
   */
  private injectTrackingPixel(html: string, token: string, baseUrl: string): string {
    const pixelUrl = `${baseUrl}/emails/tracking/pixel/${token}`;
    const pixelHtml = `<img src="${pixelUrl}" width="1" height="1" style="display:none;" alt="" />`;

    // Append pixel before closing body tag, or at end if no body tag
    if (html.includes('</body>')) {
      return html.replace('</body>', `${pixelHtml}</body>`);
    }
    return `${html}${pixelHtml}`;
  }

  /**
   * Replace links in email body with click-tracking URLs
   */
  replaceLinksWithTracking(html: string, token: string, baseUrl: string): string {
    const clickTrackingBase = `${baseUrl}/emails/tracking/click/${token}`;
    
    // Match all <a href="..."> tags
    const linkRegex = /<a\s+([^>]*\s+)?href=["']([^"']+)["']([^>]*)>/gi;
    
    return html.replace(linkRegex, (match, before, url, after) => {
      // Skip if already a tracking URL or unsubscribe link
      if (url.includes('/emails/tracking/') || url.includes('/emails/unsubscribe/')) {
        return match;
      }

      // Skip mailto: and tel: links
      if (url.startsWith('mailto:') || url.startsWith('tel:')) {
        return match;
      }

      // Create tracked URL
      const trackedUrl = `${clickTrackingBase}?url=${encodeURIComponent(url)}`;
      return `<a ${before || ''}href="${trackedUrl}"${after}>`;
    });
  }

  /**
   * Validate SendGrid configuration
   */
  validateEmailConfig(clientEmail: any): boolean {
    // Check if clientEmail has SendGrid API key or use global one
    const apiKey = clientEmail.sendgridApiKey || process.env.SENDGRID_API_KEY;
    
    if (!apiKey) {
      throw new BadRequestException('SendGrid API key not configured for this email account');
    }

    return true;
  }

  /**
   * Set API key for this instance (for per-email-account keys)
   */
  setApiKey(apiKey: string): void {
    sgMail.setApiKey(apiKey);
    this.logger.log('✅ SendGrid API key updated');
  }
}

