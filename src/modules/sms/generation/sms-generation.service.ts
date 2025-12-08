import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { LlmClientService } from '../../summarization/llm-client/llm-client.service';

export interface SmsGenerationRequest {
  contactId: number;
  summaryId: number;
  clientId: number;
  clientSmsId?: number;
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

      // Validate contact belongs to the specified client
      if (contact.csvUpload.client.id !== request.clientId) {
        throw new BadRequestException('Contact does not belong to the specified client');
      }

      // Get client's products/services and businessName from ProductService table
      const productServices = await scrapingClient.productService.findMany({
        where: { clientId: request.clientId },
        select: {
          name: true,
          businessName: true,
          description: true,
          type: true,
        },
      });

      // Extract businessName from first ProductService record (all should have same businessName)
      const businessName = productServices.length > 0 ? productServices[0].businessName : contact.csvUpload.client.name;

      // Generate SMS content using Gemini AI
      const smsContent = await this.generateSmsContent(summary, contact, productServices, businessName);

      // Save SMS draft to database
      const smsDraft = await scrapingClient.smsDraft.create({
        data: {
          clientId: request.clientId,
          ...(request.clientSmsId !== undefined && { clientSmsId: request.clientSmsId }),
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
   * Uses research-driven, direct-response SMS copywriting approach
   */
  private async generateSmsContent(summary: any, contact: any, productServices?: any[], businessName?: string): Promise<string> {
    // Format pain points for the prompt
    const painPointsFormatted = (summary.painPoints || []).map((painPoint: string) => {
      return `- ${painPoint}`;
    }).join('\n');

    // Format company services dynamically
    let servicesText = '';
    if (productServices && productServices.length > 0) {
      // Format each service: "- Name (Description if available)"
      servicesText = productServices.map(ps => {
        return `- ${ps.name}`;
      }).join('\n');
    } else {
      // Fallback to default if no ProductService exists
      servicesText = `- Web & mobile app development
- AI SaaS products
- Shopify & e-commerce solutions
- WordPress & plugin development
- UI/UX design`;
    }

    // Use businessName from ProductService or fallback to contact's businessName
    const clientBusinessName = businessName || contact.businessName;

    // Format services array for JSON
    const servicesArray = productServices && productServices.length > 0 
      ? productServices.map(ps => `"${ps.name}"`).join(', ')
      : '';
    const clientBusinessInfo = `{
  "businessName": "${clientBusinessName}",
  "services": [${servicesArray}]
}`;

    const smsPrompt = `
You are a skilled SMS copywriter specializing in short, clear, personalized business outreach.

Your task is to write ONE concise SMS (not multiple), max 320 characters, in the same style as these examples:

Finding SDDOT contractors can be a hassle, right? We simplify the bidding process. Open to a quick chat?

Struggling with data silos? FlexDataAI can help integrate your systems & boost insights. Open to a quick chat?

Need help streamlining bookings for your moving service? Speedy Moving could benefit from automated scheduling. Open to a quick chat?

The SMS should feel friendly, confident, and conversational — like a founder texting another professional. No salesy language.

Inputs (User Will Provide):

Company Summary:
${summary.summaryText}

Pain Points:
${painPointsFormatted || 'No specific pain points identified'}

**CLIENT BUSINESS INFORMATION:**
${clientBusinessInfo}

Our Services (${clientBusinessName}):
${servicesText}

We help companies turn ideas into working digital products using modern technologies.

Instructions for the Model:

Analyze the company summary + pain points.

Select the ONE ${clientBusinessName} service that best fits.

Write ONE personalized SMS, max 320 characters.

Structure the SMS like this:

Natural opener referencing their company or a clear pain point.

Brief acknowledgment of the challenge or opportunity.

One simple way ${clientBusinessName} can help (one benefit only).

End with a light CTA like: Open to a quick chat?

Tone Guidelines:

Professional but relaxed

No hype, no emojis

Not promotional or spammy

Light punctuation (commas and periods only)

Clear, human, and respectful of their time

Output Format (Required):

SMS:
[Write ONE short personalized SMS only — no variant]
`;

    try {
      // Use the existing Gemini integration
      const response = await this.callGeminiForSms(smsPrompt);

      // Parse the response to extract SMS
      // Expected format:
      // SMS: [text]
      
      let smsMessage = '';
      const smsMatch = response.match(/SMS:\s*(.+?)(?:\n|$)/is);

      // Extract the SMS text
      if (smsMatch && smsMatch[1]) {
        smsMessage = smsMatch[1].trim();
      } else {
        // Fallback: try to extract any text that looks like an SMS
        // Remove "SMS:" label if present
        let cleanResponse = response.replace(/SMS:\s*/i, '').trim();
        const lines = cleanResponse.split('\n').filter(line => line.trim().length > 0);
        
        // Find the first line that looks like an SMS (20-320 characters)
        smsMessage = lines.find(line => line.length <= 320 && line.length > 20) || cleanResponse.trim();
        
        // If still no good match, take first non-empty line
        if (!smsMessage || smsMessage.length < 20) {
          smsMessage = lines[0]?.trim() || response.trim();
        }
      }

      // Clean the response (remove any extra formatting, quotes, etc.)
      smsMessage = smsMessage.replace(/^["']|["']$/g, '').trim();
      
      // Remove any remaining label prefixes
      smsMessage = smsMessage.replace(/^(SMS|Variant|Rationale):\s*/i, '').trim();

      // Validate character limit (≤ 320 characters)
      if (smsMessage.length > 320) {
        this.logger.warn(`SMS message exceeds 320 characters (${smsMessage.length}), truncating...`);
        return smsMessage.substring(0, 317) + '...';
      }

      if (smsMessage.length < 20) {
        this.logger.warn(`SMS message is too short (${smsMessage.length} chars).`);
        throw new Error('Generated SMS too short');
      }

      return smsMessage;

    } catch (error) {
      this.logger.error('Failed to generate SMS content with Gemini:', error);
      throw error; // Re-throw the error instead of returning fallback
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
   * Infer category from pain point text
   */
  private inferCategory(painPoint: string): string {
    const lower = painPoint.toLowerCase();
    if (lower.includes('ui') || lower.includes('ux') || lower.includes('design') || lower.includes('interface')) {
      return 'UI/UX';
    }
    if (lower.includes('performance') || lower.includes('speed') || lower.includes('load') || lower.includes('slow')) {
      return 'Performance';
    }
    if (lower.includes('mobile') || lower.includes('responsive') || lower.includes('device')) {
      return 'Mobile';
    }
    if (lower.includes('checkout') || lower.includes('cart') || lower.includes('payment') || lower.includes('conversion')) {
      return 'E-commerce';
    }
    if (lower.includes('seo') || lower.includes('search') || lower.includes('ranking')) {
      return 'SEO';
    }
    if (lower.includes('security') || lower.includes('ssl') || lower.includes('https')) {
      return 'Security';
    }
    return 'General';
  }

  /**
   * Extract evidence from summary text related to pain point
   */
  private extractEvidence(summaryText: string, painPoint: string): string {
    // Try to find a sentence in the summary that relates to the pain point
    const sentences = summaryText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const lowerPainPoint = painPoint.toLowerCase();
    
    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      // Check if sentence contains keywords from pain point
      const painPointWords = lowerPainPoint.split(/\s+/).filter(w => w.length > 3);
      const matches = painPointWords.filter(word => lowerSentence.includes(word));
      
      if (matches.length > 0) {
        return sentence.trim();
      }
    }
    
    // Fallback: return first sentence or a generic observation
    return sentences[0]?.trim() || 'Observable from website analysis';
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
  async updateSmsDraft(draftId: number, updates: { messageText?: string; clientSmsId?: number }): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // If clientSmsId is being updated, verify it exists and belongs to the same client
    if (updates.clientSmsId !== undefined) {
      const draft = await scrapingClient.smsDraft.findUnique({
        where: { id: draftId },
        include: { 
          clientSms: true,
          contact: {
            include: {
              csvUpload: {
                select: {
                  clientId: true,
                },
              },
            },
          },
        },
      });

      if (!draft) {
        throw new NotFoundException(`SMS draft with ID ${draftId} not found`);
      }

      const newClientSms = await scrapingClient.clientSms.findUnique({
        where: { id: updates.clientSmsId },
      });

      if (!newClientSms) {
        throw new NotFoundException(`Client SMS with ID ${updates.clientSmsId} not found`);
      }

      // Get the client ID from the draft's contact (via csvUpload) or from existing clientSms
      let draftClientId: number | null = null;
      if (draft.contact?.csvUpload?.clientId) {
        draftClientId = draft.contact.csvUpload.clientId;
      } else if (draft.clientSms?.clientId) {
        draftClientId = draft.clientSms.clientId;
      }

      // If we can't determine the client ID, we need to reject
      if (!draftClientId) {
        throw new BadRequestException('Cannot determine client for this draft');
      }

      // Verify the new client SMS belongs to the same client
      if (newClientSms.clientId !== draftClientId) {
        throw new BadRequestException('Cannot change phone number to one from a different client');
      }
    } else {
      // Only check draft status if not updating clientSmsId (to allow updating clientSmsId for sent drafts in some cases)
      const draft = await scrapingClient.smsDraft.findUnique({ where: { id: draftId } });
      if (!draft) {
        throw new NotFoundException(`SMS draft with ID ${draftId} not found`);
      }

      if (draft.status !== 'draft' && updates.messageText !== undefined) {
        throw new BadRequestException('Only drafts with status "draft" can be edited');
      }
    }

    const data: any = {};
    if (typeof updates.messageText === 'string') {
      const trimmed = updates.messageText.trim().replace(/^\s+|\s+$/g, '');
      if (trimmed.length === 0) {
        throw new BadRequestException('messageText cannot be empty');
      }
      // No character limit - user can set any length they want
      data.messageText = trimmed;
    }

    if (updates.clientSmsId !== undefined) {
      data.clientSmsId = updates.clientSmsId;
    }

    if (Object.keys(data).length === 0) {
      const draft = await scrapingClient.smsDraft.findUnique({ where: { id: draftId } });
      if (!draft) {
        throw new NotFoundException(`SMS draft with ID ${draftId} not found`);
      }
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
   * Get all SMS drafts for a specific clientId
   */
  async getClientSmsDrafts(clientId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();

    return await scrapingClient.smsDraft.findMany({
      where: { clientId },
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

