import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { LlmClientService } from '../../summarization/llm-client/llm-client.service';

export interface SmsGenerationRequest {
  contactId: number;
  summaryId: number;
  clientSmsId: number;
}

export interface SmsGenerationResult {
  contactId: number;
  summaryId: number;
  smsDraftId: number;
  success: boolean;
  error?: string;
}

@Injectable()
export class SmsGenerationService {
  private readonly logger = new Logger(SmsGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmClient: LlmClientService,
  ) {}

  /**
   * Generate personalized SMS draft using AI summary
   */
  async generateSmsDraft(request: SmsGenerationRequest): Promise<SmsGenerationResult> {
    try {
      // Get scraping client to avoid prepared statement conflicts
      const scrapingClient = await this.prisma.getScrapingClient();

      // Get contact, summary, and client SMS data
      const contact = await scrapingClient.contact.findUnique({
        where: { id: request.contactId },
        select: {
          id: true,
          businessName: true,
          email: true,
          phone: true,
          website: true,
          status: true,
          csvUpload: {
            select: {
              client: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!contact) {
        throw new NotFoundException(`Contact with ID ${request.contactId} not found`);
      }

      if (!contact.csvUpload || !contact.csvUpload.client) {
        throw new BadRequestException('Contact does not have an associated client');
      }

      const summary = await scrapingClient.summary.findUnique({
        where: { id: request.summaryId },
        select: {
          id: true,
          contactId: true,
          summaryText: true,
          painPoints: true,
          strengths: true,
          opportunities: true,
          keywords: true,
          aiModel: true,
        },
      });

      if (!summary) {
        throw new NotFoundException(`Summary with ID ${request.summaryId} not found`);
      }

      if (summary.contactId !== request.contactId) {
        throw new BadRequestException('Summary does not belong to the specified contact');
      }

      const clientSms = await scrapingClient.clientSms.findUnique({
        where: { id: request.clientSmsId },
        select: {
          id: true,
          phoneNumber: true,
          clientId: true,
          status: true,
        },
      });

      if (!clientSms) {
        throw new NotFoundException(`Client SMS with ID ${request.clientSmsId} not found`);
      }

      // Validate clientSms belongs to the same client as contact
      if (clientSms.clientId !== contact.csvUpload.client.id) {
        throw new BadRequestException('ClientSms does not belong to the same client as contact');
      }

      // Validate clientSms is active
      if (clientSms.status !== 'active') {
        throw new BadRequestException(`ClientSms with ID ${request.clientSmsId} is not active`);
      }

      // Generate SMS content using Gemini AI
      const smsContent = await this.generateSmsContent(summary, contact);

      // Save SMS draft to database
      const smsDraft = await scrapingClient.smsDraft.create({
        data: {
          clientSmsId: request.clientSmsId,
          contactId: request.contactId,
          summaryId: request.summaryId,
          messageText: smsContent,
          status: 'draft',
        },
      });

      this.logger.log(`✅ SMS draft generated for contact ${request.contactId} (Draft ID: ${smsDraft.id})`);

      return {
        contactId: request.contactId,
        summaryId: request.summaryId,
        smsDraftId: smsDraft.id,
        success: true,
      };

    } catch (error) {
      this.logger.error(`❌ SMS generation failed for contact ${request.contactId}:`, error);

      return {
        contactId: request.contactId,
        summaryId: request.summaryId,
        smsDraftId: 0,
        success: false,
        error: error.message || 'Unknown SMS generation error',
      };
    }
  }

  /**
   * Generate SMS content using Gemini AI with the provided prompt
   */
  private async generateSmsContent(summary: any, contact: any): Promise<string> {
    const smsPrompt = `
You are an expert SMS copywriter who creates concise, high-converting business outreach texts that always sound fresh and human.

🎯 Task:
Convert the provided business summary into a short, compelling SMS outreach message.

💡 Requirements:
- Strictly under 160 characters.
- Professional yet conversational — sound like a real person, not an ad.
- Include a clear, soft call-to-action (e.g., "Worth a quick look?", "Want details?", "Open to a chat?").
- Highlight a specific value or pain point that would matter to the business.
- Avoid generic phrases ("Let's connect", "Hope you're well") and spammy terms ("free", "discount", "limited").
- Use natural phrasing, contractions, and variety in sentence rhythm.
- Randomize tone slightly each time (rotate between Friendly, Confident, Curious, Value-Focused, or Direct).
- Vary structure — do NOT always follow the same formula.

🧩 Structure Options (choose randomly each time):
1. [Hook + Value + CTA]
2. [Pain point + Solution + CTA]
3. [Question + Benefit + CTA]
4. [Observation + Insight + CTA]
5. [Compliment + Offer + CTA]

📘 Input Data:
- Company: ${contact.businessName}
- Website: ${contact.website || 'N/A'}
- Business Summary: ${summary.summaryText}
- Pain Points: ${summary.painPoints.join(', ')}
- Opportunities: ${summary.opportunities.join(', ')}
- Keywords: ${summary.keywords.join(', ')}

🎁 Output:
Only return the final SMS text (no labels, no explanations).

🧠 Example Outputs (should vary each time):
"Valor helps homeowners avoid HVAC downtime with proactive installs. Seamless + fast. Worth chatting?"
"Keeping HVAC jobs steady is tough—Valor's system automates it. Want a quick demo?"
"Love Valor's focus on service-first installs. We've got a way to boost lead flow—curious?"
`;

    try {
      // Use the existing Gemini integration
      const response = await this.callGeminiForSms(smsPrompt);

      // Clean the response (remove any extra formatting)
      const smsMessage = response.trim().replace(/^["']|["']$/g, '');

      // Validate character limit
      if (smsMessage.length > 160) {
        this.logger.warn(`SMS message exceeds 160 characters (${smsMessage.length}), truncating...`);
        return smsMessage.substring(0, 157) + '...';
      }

      return smsMessage;

    } catch (error) {
      this.logger.error('Failed to generate SMS content with Gemini:', error);

      // Fallback SMS if Gemini fails
      return `Hi ${contact.businessName}! We help businesses like yours grow. Interested in learning more? Reply YES.`;
    }
  }

  /**
   * Call Gemini API for SMS generation (wrapper around LlmClientService)
   */
  private async callGeminiForSms(prompt: string): Promise<string> {
    // Use the proper LlmClientService method for SMS generation
    return await this.llmClient.generateSmsContent(prompt);
  }

  /**
   * Get SMS draft by ID
   */
  async getSmsDraft(draftId: number): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();

    const draft = await scrapingClient.smsDraft.findUnique({
      where: { id: draftId },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            phone: true,
            email: true,
          },
        },
        summary: {
          select: {
            id: true,
            summaryText: true,
            painPoints: true,
            strengths: true,
            opportunities: true,
            keywords: true,
          },
        },
        clientSms: {
          select: {
            id: true,
            phoneNumber: true,
            status: true,
            currentCounter: true,
            totalCounter: true,
            limit: true,
          },
        },
      },
    });

    if (!draft) {
      throw new NotFoundException(`SMS draft with ID ${draftId} not found`);
    }

    return draft;
  }

  /**
   * Update SMS draft
   */
  async updateSmsDraft(draftId: number, updates: { messageText?: string }): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();

    const draft = await scrapingClient.smsDraft.findUnique({ where: { id: draftId } });
    if (!draft) {
      throw new NotFoundException(`SMS draft with ID ${draftId} not found`);
    }

    if (draft.status !== 'draft') {
      throw new BadRequestException('Only drafts with status "draft" can be edited');
    }

    const data: any = {};
    if (typeof updates.messageText === 'string') {
      const trimmed = updates.messageText.trim().replace(/^\s+|\s+$/g, '');
      if (trimmed.length === 0) {
        throw new BadRequestException('messageText cannot be empty');
      }
      if (trimmed.length > 160) {
        throw new BadRequestException('messageText must be 160 characters or less');
      }
      data.messageText = trimmed;
    }

    if (Object.keys(data).length === 0) {
      return draft; // nothing to update
    }

    const updatedDraft = await scrapingClient.smsDraft.update({
      where: { id: draftId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`✅ SMS draft ${draftId} updated`);
    return updatedDraft;
  }

  /**
   * Get all SMS drafts for a contact
   */
  async getContactSmsDrafts(contactId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    return await scrapingClient.smsDraft.findMany({
      where: { contactId },
      include: {
        summary: {
          select: {
            id: true,
            summaryText: true,
            painPoints: true,
            opportunities: true,
          },
        },
        clientSms: {
          select: {
            id: true,
            phoneNumber: true,
            status: true,
            currentCounter: true,
            totalCounter: true,
            limit: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all SMS drafts for a specific clientSmsId
   */
  async getClientSmsDrafts(clientSmsId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    return await scrapingClient.smsDraft.findMany({
      where: { clientSmsId },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            phone: true,
            email: true,
          },
        },
        summary: {
          select: {
            id: true,
            summaryText: true,
            painPoints: true,
            opportunities: true,
          },
        },
        clientSms: {
          select: {
            id: true,
            phoneNumber: true,
            status: true,
            currentCounter: true,
            totalCounter: true,
            limit: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Bulk generate SMS drafts for multiple contacts
   */
  async bulkGenerateSmsDrafts(requests: SmsGenerationRequest[]): Promise<any> {
    const results: SmsGenerationResult[] = [];

    for (const request of requests) {
      const result = await this.generateSmsDraft(request);
      results.push(result);
    }

    return {
      totalProcessed: requests.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }
}

