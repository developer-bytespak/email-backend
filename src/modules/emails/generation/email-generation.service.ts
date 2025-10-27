import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { LlmClientService } from '../../summarization/llm-client/llm-client.service';

export interface EmailGenerationRequest {
  contactId: number;
  summaryId: number;
  clientEmailId: number;
  tone?: EmailTone;
}

export interface EmailGenerationResult {
  contactId: number;
  summaryId: number;
  emailDraftId: number;
  success: boolean;
  error?: string;
}

export interface GeneratedEmailContent {
  subjectLines: string[];
  emailBody: string;
  icebreaker: string;
  rationale: string;
}

export type EmailTone = 'friendly' | 'professional' | 'pro_friendly';

@Injectable()
export class EmailGenerationService {
  private readonly logger = new Logger(EmailGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmClient: LlmClientService,
  ) {}

  /**
   * Generate personalized outreach email using AI summary
   */
  async generateEmailDraft(request: EmailGenerationRequest): Promise<EmailGenerationResult> {
    try {
      // Get scraping client to avoid prepared statement conflicts
      const scrapingClient = await this.prisma.getScrapingClient();
      
      // Get contact, summary, and client email data
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

      const clientEmail = await scrapingClient.clientEmail.findUnique({
        where: { id: request.clientEmailId },
        select: {
          id: true,
          emailAddress: true,
          clientId: true,
        },
      });

      if (!clientEmail) {
        throw new NotFoundException(`Client email with ID ${request.clientEmailId} not found`);
      }

      // Generate email content using Gemini AI
      const emailContent = await this.generateEmailContent(summary, contact, request.tone || 'pro_friendly');

      // Save email draft to database
      const emailDraft = await scrapingClient.emailDraft.create({
        data: {
          clientEmailId: request.clientEmailId,
          contactId: request.contactId,
          summaryId: request.summaryId,
          subjectLine: emailContent.subjectLines[0], // Use first subject line as primary
          bodyText: emailContent.emailBody,
          icebreaker: emailContent.icebreaker,
          productsRelevant: emailContent.rationale,
          status: 'draft',
        },
      });

      this.logger.log(`✅ Email draft generated for contact ${request.contactId} (Draft ID: ${emailDraft.id})`);

      return {
        contactId: request.contactId,
        summaryId: request.summaryId,
        emailDraftId: emailDraft.id,
        success: true,
      };

    } catch (error) {
      this.logger.error(`❌ Email generation failed for contact ${request.contactId}:`, error);
      
      return {
        contactId: request.contactId,
        summaryId: request.summaryId,
        emailDraftId: 0,
        success: false,
        error: error.message || 'Unknown email generation error',
      };
    }
  }

  /**
   * Generate email content using Gemini AI with Bytes Platform context
   */
  private async generateEmailContent(
    summary: any,
    contact: any,
    tone: EmailTone
  ): Promise<GeneratedEmailContent> {
    const prompt = this.buildEmailGenerationPrompt(summary, contact, tone);
    
    try {
      const response = await this.llmClient.generateSmsContent(prompt);
      return this.parseEmailResponse(response);
    } catch (error) {
      this.logger.error('Failed to generate email content:', error);
      throw error;
    }
  }

  /**
   * Build the prompt for email generation based on Bytes Platform requirements
   */
  private buildEmailGenerationPrompt(summary: any, contact: any, tone: EmailTone): string {
    const toneInstructions = this.getToneInstructions(tone);
    
    return `
You are an expert B2B copywriter and outreach strategist with a knack for blending professionalism with a friendly, authentic tone. Your task is to craft a single, concise outreach email for a potential client that feels polished yet human, striking a balance between a knowledgeable business consultant and a relatable peer. The email should represent Bytes Platform, a US-based LLC, and feel personalized, confident, and value-focused without being overly formal or salesy.

**Company Summary:**
${summary.summaryText}

**Pain Points Identified:**
${summary.painPoints?.join(', ') || 'Not specified'}

**Our Services (Bytes Platform):**
Bytes Platform delivers end-to-end software solutions for modern businesses. We specialize in:
- Web development (custom applications, portals, dashboards)
- Mobile app creation (Android and iOS)
- AI SaaS products and integrations
- Shopify and e-commerce store development
- WordPress sites and plugins
- Brand and UI/UX design
Our mission is to transform business ideas into working products quickly and efficiently using modern technologies.

**Target Business:** ${contact.businessName}
**Website:** ${contact.website || 'Not provided'}

**Instructions:**
1. **Analyze Inputs:** Review the company summary and pain points. Identify how Bytes Platform's services can directly address the client's challenges.
2. **Write One Outreach Email (100–140 words):** Use a first-person voice for a human touch ("I noticed…", "I'd love to help…"). Start with a personalized opening referencing a specific detail from the company summary. Acknowledge one or two pain points briefly and connect them to Bytes Platform's services as a solution. Maintain a tone that's ${toneInstructions}. Include a soft call-to-action (e.g., "Would you be up for a quick chat?").
3. **Tone & Style Guidelines:** Blend professionalism with conversational warmth. Use short, clear sentences; light humor or colloquial phrases are okay if subtle and appropriate. Avoid spam triggers ("free," "guaranteed," etc.), marketing formatting, or over-promises. Keep the email plain text, no bullet lists or links unless specified.

**Output Format (Mandatory):**
Provide your response in the following JSON format:
{
  "subjectLines": ["Subject 1", "Subject 2", "Subject 3"],
  "emailBody": "Complete email body text here",
  "icebreaker": "Opening line or hook",
  "rationale": "Brief explanation of which pain point was linked to which Bytes Platform service and why the tone was chosen"
}

Guidelines for subject lines: Each ≤ 6 words, specific, natural, and engaging.
Guidelines for email body: One email in a professional yet conversational tone (100–140 words, 2 short paragraphs max).
`;
  }

  /**
   * Get tone-specific instructions
   */
  private getToneInstructions(tone: EmailTone): string {
    switch (tone) {
      case 'friendly':
        return 'friendly and conversational, using casual language and warm expressions';
      case 'professional':
        return 'professional and formal, maintaining business credibility and expertise';
      case 'pro_friendly':
        return 'professional yet warm, confident but not pushy, with natural phrasing';
      default:
        return 'professional yet warm, confident but not pushy, with natural phrasing';
    }
  }

  /**
   * Parse Gemini response for email content
   */
  private parseEmailResponse(responseText: string): GeneratedEmailContent {
    try {
      // Clean the response text (remove markdown formatting if present)
      const cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Parse JSON response
      const parsed = JSON.parse(cleanText);
      
      // Validate required fields
      if (!parsed.subjectLines || !Array.isArray(parsed.subjectLines) || 
          !parsed.emailBody || !parsed.icebreaker || !parsed.rationale) {
        throw new Error('Invalid response format from Gemini API');
      }
      
      return {
        subjectLines: parsed.subjectLines,
        emailBody: parsed.emailBody,
        icebreaker: parsed.icebreaker,
        rationale: parsed.rationale
      };
      
    } catch (error) {
      this.logger.error('Failed to parse email response:', error);
      this.logger.debug('Raw response:', responseText);
      
      // Fallback content
      return {
        subjectLines: [
          'Quick question about your business',
          'Helping businesses like yours',
          'Let\'s streamline your growth'
        ],
        emailBody: `Hi there,

I was checking out ${responseText.includes('business') ? 'your business' : 'your website'} and noticed some interesting opportunities for growth. It seems like there might be some challenges that could be addressed with the right technology solutions.

At Bytes Platform, we specialize in helping businesses like yours streamline operations and accelerate growth through custom software development, AI integrations, and modern web solutions.

Would you be up for a quick chat to explore what's possible? Let me know what works for you!

Best regards,
[Your Name]`,
        icebreaker: 'I was checking out your business and noticed some interesting opportunities for growth.',
        rationale: 'Generated fallback content due to parsing error'
      };
    }
  }

  /**
   * Get email draft by ID
   */
  async getEmailDraft(draftId: number): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const draft = await scrapingClient.emailDraft.findUnique({
      where: { id: draftId },
      include: {
        contact: {
          select: {
            id: true,
            businessName: true,
            email: true,
            website: true,
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
        clientEmail: {
          select: {
            id: true,
            emailAddress: true,
          },
        },
      },
    });

    if (!draft) {
      throw new NotFoundException(`Email draft with ID ${draftId} not found`);
    }

    return draft;
  }

  /**
   * Update email draft
   */
  async updateEmailDraft(draftId: number, updates: {
    subjectLine?: string;
    bodyText?: string;
    icebreaker?: string;
    productsRelevant?: string;
  }): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    const updatedDraft = await scrapingClient.emailDraft.update({
      where: { id: draftId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`✅ Email draft ${draftId} updated`);
    return updatedDraft;
  }

  /**
   * Get all email drafts for a contact
   */
  async getContactEmailDrafts(contactId: number): Promise<any[]> {
    const scrapingClient = await this.prisma.getScrapingClient();
    
    return await scrapingClient.emailDraft.findMany({
      where: { contactId },
      include: {
        summary: {
          select: {
            id: true,
            summaryText: true,
            painPoints: true,
          },
        },
        clientEmail: {
          select: {
            id: true,
            emailAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
