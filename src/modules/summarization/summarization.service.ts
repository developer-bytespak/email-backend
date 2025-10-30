import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { LlmClientService, GeminiResponse } from './llm-client/llm-client.service';

export interface SummarizationResult {
  contactId: number;
  success: boolean;
  summaryData?: any;
  error?: string;
}

@Injectable()
export class SummarizationService {
  private readonly logger = new Logger(SummarizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmClient: LlmClientService,
  ) {}

  /**
   * Summarize a contact's scraped data using Gemini AI
   */
  async summarizeContact(contactId: number): Promise<SummarizationResult> {
    try {
      // Get scraping client that uses session pool (port 5432) to avoid prepared statement conflicts
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Get contact and latest scraped data using session pool
      const contact = await scrapingClient.contact.findUnique({
        where: { id: contactId },
        include: {
          scrapedData: {
            orderBy: { scrapedAt: 'desc' },
            take: 1
          }
        }
      });

      if (!contact) {
        throw new NotFoundException(`Contact with ID ${contactId} not found`);
      }

      if (!contact.scrapedData || contact.scrapedData.length === 0) {
        throw new BadRequestException(`No scraped data found for contact ${contactId}. Please scrape the contact first.`);
      }

      const scrapedData = contact.scrapedData[0];

      // Check if contact is ready for summarization
      if (contact.status !== 'scraped') {
        throw new BadRequestException(
          `Contact status is '${contact.status}'. Expected 'scraped'. Please scrape the contact first.`
        );
      }

      // Keep contact status as 'scraped' during summarization

      // Combine all scraped content
      const combinedContent = this.combineScrapedContent(scrapedData);
      
      if (!combinedContent || combinedContent.trim().length < 40) {
        throw new BadRequestException('Insufficient scraped content for AI analysis');
      }

      // Generate AI summary using Gemini
      const aiAnalysis = await this.llmClient.generateSummary(combinedContent);

      // Save summary to database using session pool
      const savedSummary = await scrapingClient.summary.create({
        data: {
          contactId: contactId,
          scrapedDataId: scrapedData.id,
          summaryText: aiAnalysis.summary,
          painPoints: aiAnalysis.painPoints,
          strengths: aiAnalysis.strengths,
          opportunities: aiAnalysis.opportunities,
          keywords: aiAnalysis.keywords,
          aiModel: aiAnalysis.model,
        },
      });

      // Update contact status to summarized using session pool
      await scrapingClient.contact.update({
        where: { id: contactId },
        data: { status: 'summarized' },
      });

      this.logger.log(`✅ Successfully summarized contact ${contactId} using ${aiAnalysis.model} (${aiAnalysis.tokensUsed} tokens, ${aiAnalysis.processingTime}ms)`);

      return {
        contactId: contact.id,
        success: true,
        summaryData: savedSummary,
      };

    } catch (error) {
      this.logger.error(`❌ Summarization failed for contact ${contactId}:`, error);
      
      // Keep contact status as 'scraped' on summarization failure
      // (No status update needed - contact remains in 'scraped' status)

      return {
        contactId,
        success: false,
        error: error.message || 'Unknown summarization error',
      };
    }
  }

  /**
   * Combine all scraped content into a single text for AI analysis
   */
  private combineScrapedContent(scrapedData: any): string {
    const contentParts: string[] = [];

    // Add homepage content
    if (scrapedData.homepageText && scrapedData.homepageText.trim()) {
      contentParts.push(`Homepage: ${scrapedData.homepageText.trim()}`);
    }

    // Add services content
    if (scrapedData.servicesText && scrapedData.servicesText.trim()) {
      contentParts.push(`Services: ${scrapedData.servicesText.trim()}`);
    }

    // Add products content
    if (scrapedData.productsText && scrapedData.productsText.trim()) {
      contentParts.push(`Products: ${scrapedData.productsText.trim()}`);
    }

    // Add contact content
    if (scrapedData.contactText && scrapedData.contactText.trim()) {
      contentParts.push(`Contact: ${scrapedData.contactText.trim()}`);
    }

    // Add extracted contact information
    const contactInfo: string[] = [];
    if (scrapedData.extractedEmails && scrapedData.extractedEmails.length > 0) {
      contactInfo.push(`Emails: ${scrapedData.extractedEmails.join(', ')}`);
    }
    if (scrapedData.extractedPhones && scrapedData.extractedPhones.length > 0) {
      contactInfo.push(`Phones: ${scrapedData.extractedPhones.join(', ')}`);
    }
    if (contactInfo.length > 0) {
      contentParts.push(`Contact Information: ${contactInfo.join(', ')}`);
    }

    // Add metadata
    if (scrapedData.pageTitle) {
      contentParts.push(`Page Title: ${scrapedData.pageTitle}`);
    }
    if (scrapedData.metaDescription) {
      contentParts.push(`Description: ${scrapedData.metaDescription}`);
    }

    return contentParts.join('\n\n');
  }

  /**
   * Get summary for a contact
   */
  async getContactSummary(contactId: number): Promise<any> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();
      return await scrapingClient.summary.findFirst({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        include: {
          scrapedData: {
            select: {
              url: true,
              scrapedAt: true,
              scrapeSuccess: true
            }
          }
        }
      });
    } catch (e) {
      return await this.prisma.summary.findFirst({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        include: {
          scrapedData: {
            select: {
              url: true,
              scrapedAt: true,
              scrapeSuccess: true
            }
          }
        }
      });
    }
  }

  /**
   * Get all summaries for a client
   */
  async getClientSummaries(clientId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    return await scrapingClient.summary.findMany({
      where: {
        contact: {
          csvUpload: {
            clientId: clientId
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      include: {
        contact: {
          select: {
            businessName: true,
            email: true,
            website: true
          }
        },
        scrapedData: {
          select: {
            url: true,
            scrapedAt: true
          }
        }
      }
    });
  }

  /**
   * Legacy method for backward compatibility
   */
  async generateSummary(content: string) {
    const analysis = await this.llmClient.generateSummary(content);
    return {
      originalContent: content,
      summary: analysis.summary,
      painPoints: analysis.painPoints,
      strengths: analysis.strengths,
      opportunities: analysis.opportunities,
      keywords: analysis.keywords,
      tokensUsed: analysis.tokensUsed,
      model: analysis.model,
      generatedAt: new Date(),
    };
  }

  /**
   * Legacy method for backward compatibility
   */
  async analyzeSentiment(text: string) {
    const analysis = await this.llmClient.analyzeContent(text);
    return {
      text,
      sentiment: analysis.sentiment,
      confidence: analysis.confidence,
      keyTopics: analysis.keyTopics,
      summary: analysis.summary
    };
  }
}
