import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { getNextOpenAiApiKey } from '../../../common/utils/gemini-key-rotator';

export interface EmailGenerationRequest {
  contactId: number;
  summaryId?: number;
  clientId: number;
  clientEmailId?: number;
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

export interface CombinedAIResponse {
  summary: string;
  painPoints: string[];
  strengths: string[];
  opportunities: string[];
  keywords: string[];
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
      const scrapingClient = await this.prisma.getScrapingClient();

      // Get contact data
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

      // Validate contact belongs to the specified client
      if (!contact.csvUpload) {
        throw new BadRequestException(`Contact ${request.contactId} has no associated CsvUpload`);
      }
      if (!contact.csvUpload.client) {
        throw new BadRequestException(`Contact ${request.contactId}'s CsvUpload has no associated Client`);
      }
      const contactClientId = contact.csvUpload.client.id;
      if (contactClientId !== request.clientId) {
        this.logger.warn(
          `Contact ${request.contactId} belongs to client ${contactClientId}, but request specified client ${request.clientId}`
        );
        throw new BadRequestException(
          `Contact does not belong to the specified client. Contact belongs to client ${contactClientId}, but request specified client ${request.clientId}`
        );
      }

      // Get client's products/services and businessName
      const productServices = await scrapingClient.productService.findMany({
        where: { clientId: request.clientId },
        select: {
          name: true,
          businessName: true,
          description: true,
          type: true,
        },
      });
      const businessName = productServices.length > 0 ? productServices[0].businessName : contact.csvUpload.client.name;

      // Determine if summary already exists
      let summaryId: number = 0;
      let existingSummary = false;

      if (request.summaryId) {
        const summary = await scrapingClient.summary.findUnique({
          where: { id: request.summaryId },
          select: { id: true, contactId: true },
        });
        if (!summary) {
          throw new NotFoundException(`Summary with ID ${request.summaryId} not found`);
        }
        if (summary.contactId !== request.contactId) {
          throw new BadRequestException('Summary does not belong to the specified contact');
        }
        summaryId = request.summaryId;
        existingSummary = true;
      } else {
        const found = await scrapingClient.summary.findFirst({
          where: { contactId: request.contactId },
          orderBy: { createdAt: 'desc' as const },
          select: { id: true },
        });
        if (found) {
          summaryId = found.id;
          existingSummary = true;
          this.logger.log(`Using existing summary ${summaryId} for contact ${request.contactId}`);
        }
      }

      // Fetch scraped data directly
      const scrapedData = await scrapingClient.scrapedData.findFirst({
        where: { contactId: request.contactId },
        orderBy: { scrapedAt: 'desc' as const },
        select: {
          id: true,
          url: true,
          pageTitle: true,
          metaDescription: true,
          homepageText: true,
          servicesText: true,
          productsText: true,
          solutionsText: true,
          featuresText: true,
          blogText: true,
          contactText: true,
          extractedEmails: true,
          extractedPhones: true,
          keywords: true,
          scrapeSuccess: true,
        },
      });

      if (!scrapedData) {
        throw new BadRequestException(`No scraped data found for contact ${request.contactId}. Please scrape the contact first.`);
      }

      let emailContent: GeneratedEmailContent;

      if (existingSummary) {
        // Summary exists — generate email only (1 API call)
        emailContent = await this.generateEmailContent(scrapedData, contact, request.tone || 'pro_friendly', productServices, businessName);
      } else {
        // No summary — combined summary + email in 1 API call
        this.logger.log(`Combined summary + email generation for contact ${request.contactId}...`);
        const combined = await this.generateCombinedContent(scrapedData, contact, request.tone || 'pro_friendly', productServices, businessName);

        // Save summary to DB
        const savedSummary = await scrapingClient.summary.create({
          data: {
            contactId: request.contactId,
            scrapedDataId: scrapedData.id,
            summaryText: combined.summary,
            painPoints: combined.painPoints,
            strengths: combined.strengths,
            opportunities: combined.opportunities,
            keywords: combined.keywords,
            aiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          },
        });

        // Update contact status to summarized
        await scrapingClient.contact.update({
          where: { id: request.contactId },
          data: { status: 'summarized' },
        });

        summaryId = savedSummary.id;
        this.logger.log(`✅ Combined generation: summary ${summaryId} + email for contact ${request.contactId}`);

        emailContent = {
          subjectLines: combined.subjectLines,
          emailBody: combined.emailBody,
          icebreaker: combined.icebreaker,
          rationale: combined.rationale,
        };
      }

      // Save email draft to database
      const emailDraft = await scrapingClient.emailDraft.create({
        data: {
          clientId: request.clientId,
          ...(request.clientEmailId !== undefined && { clientEmailId: request.clientEmailId }),
          contactId: request.contactId,
          summaryId: summaryId,
          subjectLines: emailContent.subjectLines,
          bodyText: emailContent.emailBody,
          icebreaker: emailContent.icebreaker,
          productsRelevant: emailContent.rationale,
          status: 'draft',
        },
      });

      this.logger.log(`✅ Email draft generated for contact ${request.contactId} (Draft ID: ${emailDraft.id})`);

      return {
        contactId: request.contactId,
        summaryId: summaryId,
        emailDraftId: emailDraft.id,
        success: true,
      };

    } catch (error) {
      this.logger.error(`❌ Email generation failed for contact ${request.contactId}:`, error);

      return {
        contactId: request.contactId,
        summaryId: request.summaryId || 0,
        emailDraftId: 0,
        success: false,
        error: error.message || 'Unknown email generation error',
      };
    }
  }

  /**
   * Generate email content using Gemini AI
   */
  /**
   * Combined summary + email generation in a single API call
   */
  private async generateCombinedContent(
    scrapedData: any,
    contact: any,
    tone: EmailTone,
    productServices?: any[],
    businessName?: string
  ): Promise<CombinedAIResponse> {
    const prompt = this.buildCombinedPrompt(scrapedData, contact, tone, productServices, businessName);

    try {
      const response = await this.callGeminiAPIForEmail(prompt);
      return this.parseCombinedResponse(response.text);
    } catch (error) {
      this.logger.error('Failed to generate combined content:', error);
      throw error;
    }
  }

  /**
   * Generate email content only (when summary already exists)
   */
  private async generateEmailContent(
    scrapedData: any,
    contact: any,
    tone: EmailTone,
    productServices?: any[],
    businessName?: string
  ): Promise<GeneratedEmailContent> {
    const prompt = this.buildEmailGenerationPrompt(scrapedData, contact, tone, productServices, businessName);

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

          const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
          const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
          const apiKey = getNextOpenAiApiKey();

          const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              messages: [
                {
                  role: 'user',
                  content: prompt
                }
              ],
              temperature: 0.7,
              max_tokens: 4028
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
          }

          const data = await response.json();

          if (data.choices && data.choices.length > 0) {
            this.lastRequestTime = Date.now();
            resolve({
              text: data.choices[0].message.content,
              tokensUsed: data.usage?.total_tokens || 0
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
   * Build the prompt for email generation based on client business requirements
   */
  /**
   * Build combined prompt for summary + email in one call
   */
  private buildCombinedPrompt(scrapedData: any, contact: any, tone: EmailTone, productServices?: any[], businessName?: string): string {
    const toneInstructions = this.getToneInstructions(tone);
    const scrapedDetails = this.formatScrapedDataDetails(scrapedData);

    let servicesText = '';
    if (productServices && productServices.length > 0) {
      servicesText = productServices.map(ps => {
        const desc = ps.description ? ` (${ps.description})` : '';
        return `- ${ps.name}${desc}`;
      }).join('\n');
    } else {
      servicesText = `- Custom web applications & dashboards
- Mobile apps (iOS/Android)
- AI integrations & SaaS products
- E-commerce solutions (Shopify)
- WordPress development
- UI/UX design`;
    }

    const clientBusinessName = businessName || contact.businessName;
    const servicesArray = productServices && productServices.length > 0 
      ? productServices.map(ps => `"${ps.name}"`).join(', ')
      : '';
    const clientBusinessInfo = `{
  "businessName": "${clientBusinessName}",
  "services": [${servicesArray}]
}`;

    return `
You are a B2B outreach specialist. Analyze the target business website content below, provide a structured business analysis, and write a personalized outreach email.

**TARGET BUSINESS:** ${contact.businessName}
**WEBSITE:** ${contact.website || 'Not provided'}
**LOCATION:** ${contact.state || 'Not specified'}

**WEBSITE CONTENT TO ANALYZE:**
${scrapedDetails}

**YOUR CLIENT'S BUSINESS INFORMATION:**
${clientBusinessInfo}

**${clientBusinessName.toUpperCase()} SERVICES:**
${servicesText}

**TASK 1 - BUSINESS ANALYSIS:**
Analyze the website content to produce:
- A 2-3 sentence business summary
- 3 specific pain points that external services could address
- 3 business strengths and competitive advantages
- 3 concrete opportunities for service providers
- 5 relevant business keywords for targeting
- Each pain point, strength, and opportunity must be unique — do NOT repeat the same idea in different words

**TASK 2 - OUTREACH EMAIL:**
Using the pain points and strengths you identified above, write a personalized outreach email:
1. Reference a specific detail from their website (a product name, a phrase, a service they mention)
2. Pick the most relevant pain point that connects to a specific ${clientBusinessName} service
3. Use ${toneInstructions} tone
4. Keep email body 120-180 words total (excluding greeting and closing)
5. Include soft call-to-action
6. Each subject line MUST take a different angle (e.g. pain point, compliment, question) — NO repetition of the same idea
7. Do NOT repeat phrases from the icebreaker in the email body or subject lines
8. Do NOT restate the same benefit or pain point twice anywhere in the email

**EMAIL STRUCTURE (emailBody must follow this exact format):**
Hi [First Name or there],\n\n[Paragraph 1: 2-3 sentences connecting their specific pain point to your service. Reference something from their website.]\n\n[Paragraph 2: 2-3 sentences about how you can help with a soft call-to-action. End with a question like "Would you be open to a quick chat?" or "Want me to share some ideas?"]\n\nBest regards,\n[Your Name]

**OUTPUT FORMAT (single JSON object):**
{
  "summary": "2-3 sentence business summary",
  "painPoints": ["pain point 1", "pain point 2", "pain point 3"],
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "subjectLines": ["Subject 1", "Subject 2", "Subject 3"],
  "emailBody": "Hi [Name],\n\n[Paragraph 1 text here]\n\n[Paragraph 2 text here]\n\nBest regards,\n[Your Name]",
  "icebreaker": "Single compelling opening sentence that hooks attention (25-35 words max)",
  "rationale": "Which pain point you identified from the website and which ${clientBusinessName} service you matched it to"
}

**ICE BREAKER GUIDELINES:**
- Must be EXACTLY ONE sentence (25-35 words maximum)
- Should reference something specific from their website content
- Should create curiosity or acknowledge their success
- NO periods in the middle, NO line breaks, NO continuation
`;
  }

  /**
   * Build email-only prompt (when summary already exists)
   */
  private buildEmailGenerationPrompt(scrapedData: any, contact: any, tone: EmailTone, productServices?: any[], businessName?: string): string {
    const toneInstructions = this.getToneInstructions(tone);
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
You are a B2B outreach specialist. Analyze the target business website content below, identify their challenges and strengths, and write a personalized outreach email.

**TARGET BUSINESS:** ${contact.businessName}
**WEBSITE:** ${contact.website || 'Not provided'}
**LOCATION:** ${contact.state || 'Not specified'}

**WEBSITE CONTENT TO ANALYZE:**
${scrapedDetails}

**YOUR CLIENT'S BUSINESS INFORMATION:**
${clientBusinessInfo}

**${clientBusinessName.toUpperCase()} SERVICES:**
${servicesText}

**REQUIREMENTS:**
1. First analyze the website content above to identify 2-3 specific pain points and business strengths
2. Reference a specific detail from their website (a product name, a phrase, a service they mention)
3. Pick the most relevant pain point that connects to a specific ${clientBusinessName} service
4. Use ${toneInstructions} tone
5. Keep email body 120-180 words total (excluding greeting and closing)
6. Include soft call-to-action
7. Each subject line MUST take a different angle (e.g. pain point, compliment, question) — NO repetition of the same idea
8. Do NOT repeat phrases from the icebreaker in the email body or subject lines
9. Do NOT restate the same benefit or pain point twice anywhere in the email

**EMAIL STRUCTURE (emailBody must follow this exact format):**
Hi [First Name or there],\n\n[Paragraph 1: 2-3 sentences connecting their specific pain point to your service. Reference something from their website.]\n\n[Paragraph 2: 2-3 sentences about how you can help with a soft call-to-action. End with a question like "Would you be open to a quick chat?" or "Want me to share some ideas?"]\n\nBest regards,\n[Your Name]

**OUTPUT FORMAT:**
{
  "subjectLines": ["Subject 1", "Subject 2", "Subject 3"],
  "emailBody": "Hi [Name],\n\n[Paragraph 1 text here]\n\n[Paragraph 2 text here]\n\nBest regards,\n[Your Name]",
  "icebreaker": "Single compelling opening sentence that hooks attention (25-35 words max)",
  "rationale": "Which pain point you identified from the website and which ${clientBusinessName} service you matched it to"
}

**ICE BREAKER GUIDELINES:**
- Must be EXACTLY ONE sentence (25-35 words maximum)
- Should reference something specific from their website content
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
      const homepagePreview = scrapedData.homepageText.substring(0, 1500);
      details.push(`Homepage Content: ${homepagePreview}${scrapedData.homepageText.length > 1500 ? '...' : ''}`);
    }

    if (scrapedData.servicesText) {
      const servicesPreview = scrapedData.servicesText.substring(0, 800);
      details.push(`Services: ${servicesPreview}${scrapedData.servicesText.length > 800 ? '...' : ''}`);
    }

    if (scrapedData.productsText) {
      const productsPreview = scrapedData.productsText.substring(0, 800);
      details.push(`Products: ${productsPreview}${scrapedData.productsText.length > 800 ? '...' : ''}`);
    }

    if (scrapedData.solutionsText) {
      const solutionsPreview = scrapedData.solutionsText.substring(0, 500);
      details.push(`Solutions: ${solutionsPreview}${scrapedData.solutionsText.length > 500 ? '...' : ''}`);
    }

    if (scrapedData.featuresText) {
      const featuresPreview = scrapedData.featuresText.substring(0, 500);
      details.push(`Features: ${featuresPreview}${scrapedData.featuresText.length > 500 ? '...' : ''}`);
    }

    if (scrapedData.blogText) {
      const blogPreview = scrapedData.blogText.substring(0, 300);
      details.push(`Blog: ${blogPreview}${scrapedData.blogText.length > 300 ? '...' : ''}`);
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
  /**
   * Parse combined AI response (summary + email fields)
   */
  private parseCombinedResponse(responseText: string): CombinedAIResponse {
    try {
      this.logger.debug('Raw combined AI response:', responseText);

      let cleanText = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .replace(/^```/g, '')
        .replace(/```$/g, '')
        .trim();

      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanText = jsonMatch[0];
      }

      const parsed = JSON.parse(cleanText);

      // Validate all required fields
      if (!parsed.summary || !Array.isArray(parsed.painPoints) || !Array.isArray(parsed.strengths) ||
        !Array.isArray(parsed.opportunities) || !Array.isArray(parsed.keywords) ||
        !parsed.subjectLines || !Array.isArray(parsed.subjectLines) ||
        !parsed.emailBody || !parsed.icebreaker || !parsed.rationale) {
        this.logger.warn('Invalid combined response format:', parsed);
        throw new Error('Invalid combined response format from OpenAI API');
      }

      // Clean icebreaker
      let cleanIcebreaker = parsed.icebreaker.trim();
      if (cleanIcebreaker.includes('\n')) {
        cleanIcebreaker = cleanIcebreaker.split('\n')[0].trim();
      }
      if (cleanIcebreaker.includes('.') && cleanIcebreaker.indexOf('.') < cleanIcebreaker.length - 1) {
        cleanIcebreaker = cleanIcebreaker.split('.')[0] + '.';
      }

      this.logger.log('Successfully parsed combined AI response');

      return {
        summary: parsed.summary,
        painPoints: parsed.painPoints,
        strengths: parsed.strengths,
        opportunities: parsed.opportunities,
        keywords: parsed.keywords,
        subjectLines: parsed.subjectLines,
        emailBody: parsed.emailBody,
        icebreaker: cleanIcebreaker,
        rationale: parsed.rationale,
      };

    } catch (error) {
      this.logger.error('Failed to parse combined response:', error);
      this.logger.debug('Raw response that failed to parse:', responseText);

      return {
        summary: 'Business analysis completed',
        painPoints: ['Analysis in progress'],
        strengths: ['Business evaluation ongoing'],
        opportunities: ['Service opportunities being identified'],
        keywords: ['business', 'analysis'],
        subjectLines: [
          'Quick question about your business',
          'Helping businesses like yours',
          'Let\'s streamline your growth'
        ],
        emailBody: `Hi there,\n\nI was checking out your business and noticed some interesting opportunities for growth. It seems like there might be some challenges that could be addressed with the right technology solutions.\n\nWe specialize in helping businesses like yours streamline operations and accelerate growth through custom software development, AI integrations, and modern web solutions.\n\nWould you be up for a quick chat to explore what's possible? Let me know what works for you!\n\nBest regards,\n[Your Name]`,
        icebreaker: 'I noticed your business has some exciting growth potential.',
        rationale: 'Generated fallback content due to parsing error',
      };
    }
  }

  /**
   * Parse email-only response
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
        this.logger.warn('Invalid response format from Openai API:', parsed);
        throw new Error('Invalid response format from Openai API');
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

      this.logger.log('Successfully parsed email content from Openai API');

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

We specialize in helping businesses like yours streamline operations and accelerate growth through custom software development, AI integrations, and modern web solutions.

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

    // If clientEmailId is being updated, verify it exists and belongs to the draft's client
    if (updates.clientEmailId !== undefined) {
      const draft = await scrapingClient.emailDraft.findUnique({
        where: { id: draftId },
        select: {
          clientId: true,
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

      const newClientEmail = await scrapingClient.clientEmail.findUnique({
        where: { id: updates.clientEmailId },
        select: {
          id: true,
          emailAddress: true,
          clientId: true,
        },
      });

      if (!newClientEmail) {
        throw new NotFoundException(`Client email with ID ${updates.clientEmailId} not found`);
      }

      // Verify the new client email belongs to the same client as the draft
      if (newClientEmail.clientId !== draft.clientId) {
        this.logger.warn(
          `Client ID mismatch: Draft ${draftId} belongs to client ${draft.clientId}, ` +
          `but trying to set clientEmail ${updates.clientEmailId} which belongs to client ${newClientEmail.clientId}`
        );
        throw new BadRequestException(
          `Cannot set email to one from a different client. Draft belongs to client ${draft.clientId}, ` +
          `new email belongs to client ${newClientEmail.clientId}`
        );
      }
      
      const currentEmailInfo = draft.clientEmail 
        ? `${draft.clientEmail.id} (${draft.clientEmail.emailAddress})`
        : 'none';
      
      this.logger.log(
        `Updating draft ${draftId} from clientEmail ${currentEmailInfo} ` +
        `to clientEmail ${updates.clientEmailId} (${newClientEmail.emailAddress}) - both belong to client ${draft.clientId}`
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
