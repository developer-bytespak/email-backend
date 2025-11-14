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
   * Uses research-driven, direct-response SMS copywriting approach
   */
  private async generateSmsContent(summary: any, contact: any): Promise<string> {
    // Transform painPoints array into ranked structure for the prompt
    const rankedPainPoints = (summary.painPoints || []).slice(0, 3).map((painPoint: string, index: number) => ({
      rank: index + 1,
      category: this.inferCategory(painPoint),
      painPoint: painPoint,
      evidence: this.extractEvidence(summary.summaryText, painPoint),
    }));

    // Transform keywords array into structured format
    const keywords = {
      industryTerms: summary.keywords || [],
    };

    const smsPrompt = `
You are a direct-response SMS copywriter. Write like a knowledgeable peer who researched their business—not a bot or salesperson.

Core Principle:
Lead with research, not introduction. In 160-200 characters, prove you know their business before they ask who you are.

Required Inputs:
{
  "companyName": "${contact.businessName}",
  "rankedPainPoints": ${JSON.stringify(rankedPainPoints)},
  "strengths": ${JSON.stringify(summary.strengths || [])},
  "keywords": ${JSON.stringify(keywords)},
  "website": "${contact.website || 'N/A'}",
  "businessSummary": "${summary.summaryText}"
}

About Us (Reference Only): Bytes Platform - Software development partner for web/mobile apps, AI integrations, e-commerce, and UI/UX.

SMS Structure (160-200 characters):
- Research Hook (60-100 chars): Specific observation about their site/business
- Diagnostic Question (50-80 chars): Shows expertise, invites reply
- Signature (20-40 chars): Role/credential, not company name

Critical Rules:

Opening Strategy:
RIGHT: "Noticed ${contact.businessName}'s checkout has 6 steps. Tested streamlined flow? -Alex, ecommerce dev"
WRONG: "Hi, I'm Alex from Bytes. I noticed your site..."

Must Include:
- Company name + specific feature in first sentence
- 1 industry term used naturally (from keywords.industryTerms)
- Diagnostic question (not meeting request)
- Signature with role only ("Alex, UX consultant" or "Alex, dev consultant")

Never Include:
- Personal name assumption ("Hi John")
- Company introduction ("I'm from Bytes...")
- Service pitch ("We specialize in...")
- Links, emojis, excessive punctuation
- Meeting requests ("Can we schedule...")

Output Format:
Generate 1 SMS variant (160-200 chars) that follows this structure:

Variant Strategy (choose the best fit):
1. Technical: Specific tech observation + question + signature
2. Industry Pattern: Industry insight + company-specific question + signature
3. Opportunity: Acknowledge strength + transition to gap + signature

The SMS Must Include:
- Character count (must be 160-200)
- Company name reference
- Observable evidence from their business
- Question requiring <5 word answer
- Signature showing relevance without company pitch

Quality Checklist:
- First 10 words prove research (preview text)
- No "Hi [Name]" or personal assumptions
- 160-200 characters (1 SMS unit)
- Question is diagnostic, not sales-y
- Signature shows relevance without company pitch
- Industry term used naturally
- Would pass "how did they know this?" test

Examples:

BAD:
"Hi! I'm Alex from Bytes Platform. We build websites and apps. Would love to discuss helping your company. Free for a call?"
[Template, no research, sales pitch]

GOOD Examples:

Example 1 (Technical):
"Noticed ${contact.businessName}'s product pages load images sequentially on mobile. Tested lazy loading? Curious about bounce rate. -Alex, frontend dev"
[Specific observation, technical term, diagnostic question]

Example 2 (Pattern):
"Most SaaS dashboards struggle with data viz at scale. Does ${contact.businessName}'s charting handle 10k+ data points smoothly? -Alex, worked on similar"
[Industry knowledge, specific question, experience hint]

Example 3 (Opportunity):
"${contact.businessName}'s onboarding UX is clean. Checkout needs 6 steps though—tested streamlined flow? Worth discussing. -Alex, ecommerce consultant"
[Strength + evidence + opportunity + credential]

Signature Options:
- For technical issues: "-Alex, frontend dev" | "-Alex, mobile specialist"
- For UX/conversion: "-Alex, UX consultant" | "-Alex, ecommerce specialist"
- For general: "-Alex, dev consultant" | "-Alex, build these"

Keep it vague enough to create curiosity, specific enough to be credible.

Industry-Specific Hooks:
- E-commerce: "Noticed ${contact.businessName}'s cart abandonment modal fires after 5 seconds..."
- SaaS: "${contact.businessName}'s dashboard makes 12 API calls on load..."
- Service Business: "${contact.businessName}'s contact form has 8 required fields..."
- Content/Media: "${contact.businessName}'s articles have 4.5 second load time on 4G..."

OUTPUT:
Return ONLY the SMS text (160-200 characters). No labels, no explanations, no JSON. Just the SMS message text.
`;

    try {
      // Use the existing Gemini integration
      const response = await this.callGeminiForSms(smsPrompt);

      // Clean the response (remove any extra formatting)
      const smsMessage = response.trim().replace(/^["']|["']$/g, '');

      // Validate character limit (160-200 characters for research-driven SMS)
      if (smsMessage.length < 160) {
        this.logger.warn(`SMS message is too short (${smsMessage.length} chars). Expected 160-200 characters.`);
      }
      if (smsMessage.length > 200) {
        this.logger.warn(`SMS message exceeds 200 characters (${smsMessage.length}), truncating...`);
        return smsMessage.substring(0, 197) + '...';
      }

      return smsMessage;

    } catch (error) {
      this.logger.error('Failed to generate SMS content with Gemini:', error);

      // Fallback SMS if Gemini fails (still follows research-driven format)
      return `Noticed ${contact.businessName}'s site. Quick question about your current setup? -Alex, dev consultant`;
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

