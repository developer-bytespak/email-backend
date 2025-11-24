import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';

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
  
  // Queue system for rate limiting
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private lastRequestTime = 0;
  private readonly RATE_LIMIT_DELAY = 40000; // 40 seconds delay between requests

  constructor(
    private readonly prisma: PrismaService,
  ) { }

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
          scrapedData: {
            select: {
              id: true,
              url: true,
              pageTitle: true,
              metaDescription: true,
              homepageText: true,
              servicesText: true,
              productsText: true,
              contactText: true,
              extractedEmails: true,
              extractedPhones: true,
              keywords: true,
              scrapeSuccess: true,
            },
          },
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

      // Get client's products/services and businessName from ProductService table
      const clientId = clientEmail.clientId;
      const productServices = await scrapingClient.productService.findMany({
        where: { clientId },
        select: {
          name: true,
          businessName: true,
          description: true,
          type: true,
        },
      });

      // Extract businessName from first ProductService record (all should have same businessName)
      const businessName = productServices.length > 0 ? productServices[0].businessName : contact.csvUpload.client.name;

      // Generate email content using Gemini AI
      const emailContent = await this.generateEmailContent(summary, contact, request.tone || 'pro_friendly', productServices, businessName);

      // Save email draft to database
      const emailDraft = await scrapingClient.emailDraft.create({
        data: {
          clientEmailId: request.clientEmailId,
          contactId: request.contactId,
          summaryId: request.summaryId,
          subjectLines: emailContent.subjectLines, // Save all subject lines
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
   * Generate email content using Gemini AI
   */
  private async generateEmailContent(
    summary: any,
    contact: any,
    tone: EmailTone,
    productServices?: any[],
    businessName?: string
  ): Promise<GeneratedEmailContent> {
    const prompt = this.buildEmailGenerationPrompt(summary, contact, tone, productServices, businessName);

    try {
      // Call Gemini API directly for email generation
      const response = await this.callGeminiAPIForEmail(prompt);
      return this.parseEmailResponse(response.text);
    } catch (error) {
      this.logger.error('Failed to generate email content:', error);
      throw error;
    }
  }

  /**
   * Call Gemini API specifically for email generation with rate limiting queue
   */
  private async callGeminiAPIForEmail(prompt: string): Promise<{ text: string; tokensUsed: number }> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          // Rate limiting - wait 40 seconds since last request
          const timeSinceLastRequest = Date.now() - this.lastRequestTime;
          if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
            const waitTime = this.RATE_LIMIT_DELAY - timeSinceLastRequest;
            this.logger.log(`⏳ Rate limiting: waiting ${Math.round(waitTime / 1000)} seconds before next email generation request`);
            await this.sleep(waitTime);
          }

          const GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite:generateContent';
          const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

          const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': GEMINI_API_KEY,
            },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: prompt
                }]
              }],
              generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024
              },
              safetySettings: [
                {
                  category: "HARM_CATEGORY_HARASSMENT",
                  threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
              ]
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Gemini API error: ${errorData.error?.message || response.statusText}`);
          }

          const data = await response.json();

          if (data.candidates && data.candidates.length > 0) {
            this.lastRequestTime = Date.now();
            resolve({
              text: data.candidates[0].content.parts[0].text,
              tokensUsed: data.usageMetadata?.totalTokenCount || 0
            });
          } else {
            throw new Error('No response generated from Gemini API');
          }

        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  /**
   * Process request queue sequentially
   */
  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) {
        await request();
      }
    }

    this.isProcessing = false;
  }

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Build the prompt for email generation based on Bytes Platform requirements
   */
  private buildEmailGenerationPrompt(summary: any, contact: any, tone: EmailTone, productServices?: any[], businessName?: string): string {
    const toneInstructions = this.getToneInstructions(tone);

    // Extract scraped data details
    const scrapedData = summary.scrapedData;
    const scrapedDetails = this.formatScrapedDataDetails(scrapedData);

    // Format services from ProductService table
    let servicesText = '';
    if (productServices && productServices.length > 0) {
      servicesText = productServices.map(ps => {
        const desc = ps.description ? ` (${ps.description})` : '';
        return `- ${ps.name}${desc}`;
      }).join('\n');
    } else {
      // Fallback to default services if none exist
      servicesText = `- Custom web applications & dashboards
- Mobile apps (iOS/Android)
- AI integrations & SaaS products
- E-commerce solutions (Shopify)
- WordPress development
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

    return `
You are a B2B outreach specialist writing for Bytes Platform. Create a personalized email that directly addresses specific business challenges.

**TARGET BUSINESS:** ${contact.businessName}
**WEBSITE:** ${contact.website || 'Not provided'}
**LOCATION:** ${contact.state || 'Not specified'}

**BUSINESS ANALYSIS:**
${summary.summaryText}

**SPECIFIC PAIN POINTS TO ADDRESS:**
${summary.painPoints?.join(', ') || 'Not specified'}

**BUSINESS STRENGTHS:**
${summary.strengths?.join(', ') || 'Not specified'}

**WEBSITE CONTENT:**
${scrapedDetails}

**CLIENT BUSINESS INFORMATION:**
${clientBusinessInfo}

**BYTES PLATFORM SERVICES:**
${servicesText}

**REQUIREMENTS:**
1. Reference a specific detail from their business analysis or website
2. Address 1-2 specific pain points mentioned above
3. Connect their pain points to specific Bytes Platform services
4. Use ${toneInstructions} tone
5. Keep email 100-180 words, 2-3 paragraphs max
6. Include soft call-to-action

**OUTPUT FORMAT:**
{
  "subjectLines": ["Subject 1", "Subject 2", "Subject 3"],
  "emailBody": "Complete email body text here (100-140 words, 2 paragraphs)",
  "icebreaker": "Single compelling opening sentence that hooks attention (25-35 words max)",
  "rationale": "Which pain point was addressed and which Bytes Platform service was offered as solution"
}

**ICE BREAKER GUIDELINES:**
- Must be EXACTLY ONE sentence (25-35 words maximum)
- Should reference something specific from their business/website
- Should create curiosity or acknowledge their success
- NO periods in the middle, NO line breaks, NO continuation
- Examples: "I noticed your recent expansion into digital services" or "Your custom software solutions caught my attention"
`;
  }

  /**
   * Format scraped data details for the AI prompt
   */
  private formatScrapedDataDetails(scrapedData: any): string {
    if (!scrapedData) {
      return 'No scraped data available';
    }

    const details: string[] = [];

    if (scrapedData.pageTitle) {
      details.push(`Page Title: ${scrapedData.pageTitle}`);
    }

    if (scrapedData.metaDescription) {
      details.push(`Meta Description: ${scrapedData.metaDescription}`);
    }

    if (scrapedData.homepageText) {
      const homepagePreview = scrapedData.homepageText.substring(0, 300);
      details.push(`Homepage Content: ${homepagePreview}${scrapedData.homepageText.length > 300 ? '...' : ''}`);
    }

    if (scrapedData.servicesText) {
      const servicesPreview = scrapedData.servicesText.substring(0, 200);
      details.push(`Services: ${servicesPreview}${scrapedData.servicesText.length > 200 ? '...' : ''}`);
    }

    if (scrapedData.productsText) {
      const productsPreview = scrapedData.productsText.substring(0, 200);
      details.push(`Products: ${productsPreview}${scrapedData.productsText.length > 200 ? '...' : ''}`);
    }

    if (scrapedData.keywords && scrapedData.keywords.length > 0) {
      details.push(`Keywords: ${scrapedData.keywords.join(', ')}`);
    }

    if (scrapedData.extractedEmails && scrapedData.extractedEmails.length > 0) {
      details.push(`Contact Emails: ${scrapedData.extractedEmails.join(', ')}`);
    }

    return details.length > 0 ? details.join('\n') : 'Limited scraped data available';
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
      this.logger.debug('Raw Gemini response:', responseText);

      // Clean the response text (remove markdown formatting if present)
      let cleanText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^```/g, '')
        .replace(/```$/g, '')
        .trim();

      // Try to extract JSON from the response if it's embedded in text
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }

      // Parse JSON response
      const parsed = JSON.parse(cleanText);

      // Validate required fields
      if (!parsed.subjectLines || !Array.isArray(parsed.subjectLines) ||
        !parsed.emailBody || !parsed.icebreaker || !parsed.rationale) {
        this.logger.warn('Invalid response format from Gemini API:', parsed);
        throw new Error('Invalid response format from Gemini API');
      }

      // Clean and validate icebreaker (should be a single sentence)
      let cleanIcebreaker = parsed.icebreaker.trim();
      if (cleanIcebreaker.includes('\n')) {
        cleanIcebreaker = cleanIcebreaker.split('\n')[0].trim();
      }
      // Don't truncate icebreaker - let it be natural length
      // Just ensure it's a single sentence
      if (cleanIcebreaker.includes('.') && cleanIcebreaker.indexOf('.') < cleanIcebreaker.length - 1) {
        cleanIcebreaker = cleanIcebreaker.split('.')[0] + '.';
      }

      this.logger.log('Successfully parsed email content from Gemini');

      return {
        subjectLines: parsed.subjectLines,
        emailBody: parsed.emailBody,
        icebreaker: cleanIcebreaker,
        rationale: parsed.rationale
      };

    } catch (error) {
      this.logger.error('Failed to parse email response:', error);
      this.logger.debug('Raw response that failed to parse:', responseText);

      // Fallback content
      return {
        subjectLines: [
          'Quick question about your business',
          'Helping businesses like yours',
          'Let\'s streamline your growth'
        ],
        emailBody: `Hi there,

I was checking out your business and noticed some interesting opportunities for growth. It seems like there might be some challenges that could be addressed with the right technology solutions.

At Bytes Platform, we specialize in helping businesses like yours streamline operations and accelerate growth through custom software development, AI integrations, and modern web solutions.

Would you be up for a quick chat to explore what's possible? Let me know what works for you!

Best regards,
[Your Name]`,
        icebreaker: 'I noticed your business has some exciting growth potential.',
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
    subjectLines?: string[];
    bodyText?: string;
    icebreaker?: string;
    productsRelevant?: string;
    clientEmailId?: number;
  }): Promise<any> {
    const scrapingClient = await this.prisma.getScrapingClient();

    // If clientEmailId is being updated, verify it exists and belongs to the same client
    if (updates.clientEmailId !== undefined) {
      const draft = await scrapingClient.emailDraft.findUnique({
        where: { id: draftId },
        include: { 
          clientEmail: true, // clientEmailId is required, so this should always exist
        },
      });

      if (!draft) {
        throw new NotFoundException(`Email draft with ID ${draftId} not found`);
      }

      if (!draft.clientEmail) {
        throw new BadRequestException('Email draft is missing client email relation. This should not happen.');
      }

      const newClientEmail = await scrapingClient.clientEmail.findUnique({
        where: { id: updates.clientEmailId },
      });

      if (!newClientEmail) {
        throw new NotFoundException(`Client email with ID ${updates.clientEmailId} not found`);
      }

      // Verify the new client email belongs to the same client as the existing one
      const currentClientId = draft.clientEmail.clientId;
      const newClientId = newClientEmail.clientId;
      
      if (newClientId !== currentClientId) {
        this.logger.warn(
          `Client ID mismatch: Draft ${draftId} has clientEmail ${draft.clientEmail.id} (clientId: ${currentClientId}), ` +
          `but trying to change to clientEmail ${updates.clientEmailId} (clientId: ${newClientId})`
        );
        throw new BadRequestException(
          `Cannot change email to one from a different client. Current email belongs to client ${currentClientId}, ` +
          `new email belongs to client ${newClientId}`
        );
      }
      
      this.logger.log(
        `Updating draft ${draftId} from clientEmail ${draft.clientEmail.id} (${draft.clientEmail.emailAddress}) ` +
        `to clientEmail ${updates.clientEmailId} (${newClientEmail.emailAddress}) - both belong to client ${currentClientId}`
      );
    }

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

  /**
   * Get bulk status for multiple contacts (summary, email draft, SMS draft status)
   * Returns status flags without full data to optimize performance
   */
  async getBulkStatus(
    contactIds: number[],
    options?: { includeSms?: boolean },
  ): Promise<{
    success: boolean;
    data: Array<{
      contactId: number;
      hasSummary: boolean;
      hasEmailDraft: boolean;
      hasSMSDraft?: boolean;
      emailDraftId: number | null;
      smsDraftId?: number | null;
      smsStatus?: string | null;
    }>;
  }> {
    try {
      const scrapingClient = await this.prisma.getScrapingClient();

      const includeSms = options?.includeSms !== undefined ? options.includeSms : false;

      // Fetch summaries for all contacts
      const summaries = await scrapingClient.summary.findMany({
        where: { contactId: { in: contactIds } },
        select: { contactId: true },
        distinct: ['contactId'],
      });

      // Fetch email drafts for all contacts (get most recent one per contact)
      const emailDrafts = await scrapingClient.emailDraft.findMany({
        where: { contactId: { in: contactIds } },
        select: { id: true, contactId: true },
        orderBy: { createdAt: 'desc' },
      });

      // Create maps for quick lookup
      const summaryMap = new Set(summaries.map(s => s.contactId));
      
      // Get most recent email draft per contact
      const emailDraftMap = new Map<number, number>();
      emailDrafts.forEach(draft => {
        if (!emailDraftMap.has(draft.contactId)) {
          emailDraftMap.set(draft.contactId, draft.id);
        }
      });

      const smsDraftMap = new Map<number, number>();
      const smsDraftStatusMap = new Map<number, string>();
      const smsSentMap = new Map<number, boolean>();

      if (includeSms) {
        const smsDrafts = await scrapingClient.smsDraft.findMany({
          where: { contactId: { in: contactIds } },
          select: { id: true, contactId: true, status: true },
          orderBy: { createdAt: 'desc' },
        });

        const smsDraftIds = smsDrafts.map(d => d.id);
        const smsLogs = smsDraftIds.length > 0 ? await scrapingClient.smsLog.findMany({
          where: { smsDraftId: { in: smsDraftIds } },
          select: { smsDraftId: true, status: true },
          orderBy: { sentAt: 'desc' },
        }) : [];

        smsDrafts.forEach(draft => {
          if (!smsDraftMap.has(draft.contactId)) {
            smsDraftMap.set(draft.contactId, draft.id);
            smsDraftStatusMap.set(draft.contactId, draft.status);
          }
        });

        smsLogs.forEach(log => {
          if (!smsSentMap.has(log.smsDraftId)) {
            const isSent = log.status === 'success' || log.status === 'delivered';
            smsSentMap.set(log.smsDraftId, isSent);
          }
        });
      }

      // Build response array
      const statusData = contactIds.map(contactId => {
        const baseResponse: any = {
          contactId,
          hasSummary: summaryMap.has(contactId),
          hasEmailDraft: emailDraftMap.has(contactId),
          emailDraftId: emailDraftMap.get(contactId) || null,
        };

        // Only include SMS fields if requested
        if (includeSms) {
          const smsDraftId = smsDraftMap.get(contactId) || null;
          const smsWasSent = smsDraftId ? smsSentMap.get(smsDraftId) || false : false;
          const smsDraftStatus = smsDraftStatusMap.get(contactId);
          
          // Determine SMS status: 'sent' if log shows success, otherwise use draft status or 'draft'
          let smsStatus: string | null = null;
          if (smsWasSent) {
            smsStatus = 'sent';
          } else if (smsDraftStatus) {
            smsStatus = smsDraftStatus; // 'draft' or 'ready'
          }

          baseResponse.hasSMSDraft = smsDraftMap.has(contactId);
          baseResponse.smsDraftId = smsDraftId;
          baseResponse.smsStatus = smsStatus;
        }

        return baseResponse;
      });

      return {
        success: true,
        data: statusData,
      };
    } catch (error) {
      this.logger.error('Error getting bulk status:', error);
      throw new BadRequestException(`Failed to get bulk status: ${error.message}`);
    }
  }
}
