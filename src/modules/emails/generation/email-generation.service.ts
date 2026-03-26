import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { getNextOpenAiApiKey } from '../../../common/utils/gemini-key-rotator';
import { jsonrepair } from 'jsonrepair';

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

      // Get client name for email sign-off
      const clientName = contact.csvUpload.client.name;

      if (existingSummary) {
        // Summary exists — generate email only (1 API call)
        emailContent = await this.generateEmailContent(scrapedData, contact, request.tone || 'pro_friendly', productServices, businessName, clientName);
      } else {
        // No summary — combined summary + email in 1 API call
        this.logger.log(`Combined summary + email generation for contact ${request.contactId}...`);
        const combined = await this.generateCombinedContent(scrapedData, contact, request.tone || 'pro_friendly', productServices, businessName, clientName);

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
            aiModel: process.env.OPENAI_MODEL || 'gpt-5',
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

      // Post-process: replace any remaining placeholders with actual names and booking link
      emailContent.emailBody = emailContent.emailBody
        .replace(/\[Your Name\]/g, clientName)
        .replace(/\[your name\]/gi, clientName)
        .replace(/^Hi there,/m, `Hi ${contact.businessName || 'there'},`)
        .replace(/\{\{BOOKING_LINK\}\}/g, 'Book a Meeting (https://calendly.com/bytesplatform/new-meeting-1)');

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
          productsRelevant: typeof emailContent.rationale === 'string' ? emailContent.rationale : JSON.stringify(emailContent.rationale),
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
    businessName?: string,
    clientName?: string
  ): Promise<CombinedAIResponse> {
    const prompt = this.buildCombinedPrompt(scrapedData, contact, tone, productServices, businessName, clientName);

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
    businessName?: string,
    clientName?: string
  ): Promise<GeneratedEmailContent> {
    const prompt = this.buildEmailGenerationPrompt(scrapedData, contact, tone, productServices, businessName, clientName);

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
   * Call OpenAI API for email generation
   */
  private async callGeminiAPIForEmail(prompt: string): Promise<{ text: string; tokensUsed: number }> {
    const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';
    const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
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
        max_tokens: 6024
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    if (data.choices && data.choices.length > 0) {
      return {
        text: data.choices[0].message.content,
        tokensUsed: data.usage?.total_tokens || 0
      };
    } else {
      throw new Error('No response generated from OpenAI API');
    }
  }

  /**
   * Safely parse JSON with fallback repair using jsonrepair.
   * Handles unescaped newlines, broken quotes, and other common AI output issues.
   */
  private safeJsonParse(text: string): any {
    try {
      return JSON.parse(text);
    } catch (firstError) {
      this.logger.warn('JSON.parse failed, attempting repair with jsonrepair...');
      try {
        const repaired = jsonrepair(text);
        const parsed = JSON.parse(repaired);
        this.logger.log('Successfully repaired and parsed JSON');
        return parsed;
      } catch (repairError) {
        this.logger.error('jsonrepair also failed:', repairError);
        throw firstError;
      }
    }
  }

  /**
   * Build the prompt for email generation based on client business requirements
   */
  /**
   * Build combined prompt for summary + email in one call
   */
  private buildCombinedPrompt(scrapedData: any, contact: any, tone: EmailTone, productServices?: any[], businessName?: string, clientName?: string): string {
    const contactBizName = contact.businessName || 'there';
    const scrapedDetails = this.formatScrapedDataDetails(scrapedData);

    let servicesText = '';
    if (productServices && productServices.length > 0) {
      servicesText = productServices.map(ps => {
        const desc = ps.description ? ` (${ps.description})` : '';
        return `- ${ps.name}${desc}`;
      }).join('\n');
    } else {
      servicesText = `- Web Development
- WordPress Development
- Shopify Development
- MERN Stack Development
- UI/UX Design
- Mobile App Development (iOS & Android)
- Custom Software Development
- AI Applications
- AI Integrations
- Artificial Intelligence & Machine Learning
- Personalized AI Chatbots
- Business Process Automation
- Search Engine Optimization (SEO)
- Social Media Marketing
- Social Media Management
- Data Analytics & Business Intelligence
- Cloud Computing Services
- Cloud Integration
- CRM Development & Integration
- ERP Solutions
- Cybersecurity Solutions
- Blockchain Development`;
    }

    return `
You are a B2B outreach specialist writing cold emails for Bytes Platform.
Your only job is to write emails that sound EXACTLY like the gold standard below. Read it three times before writing anything.

════════════════════════════════════════════════
GOLD STANDARD EMAIL — THIS IS YOUR ONLY TEMPLATE
════════════════════════════════════════════════

Subject: A thought on growing Mackie Mobile

Hi [Name],

I'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation. I came across Mackie Mobile today and I have to say, being the first privacy-first wireless carrier is a genuinely bold move, and the market clearly needs it.

The thing that stood out to me is that people who are actively looking for a private, secure wireless alternative are out there searching right now. SIM swap fraud and phishing attacks are in the news constantly, and privacy-conscious consumers are becoming more common every day. The question is whether they're finding Mackie Mobile when they search.

An SEO strategy built around the exact terms your ideal customers are searching, combined with some process automation to make onboarding and support smoother as you grow, could really accelerate things for you.

I'd love to share a couple of ideas I had specifically for Mackie. Would a 15-minute call this week work for you? You can {{BOOKING_LINK}} here.

Best regards,

════════════════════════════════════════════════
PARAGRAPH STRUCTURE — STUDY THIS CAREFULLY
════════════════════════════════════════════════

PARAGRAPH 1 = Introduction + Compliment BLENDED TOGETHER
——————————————————————————————————————————————————————
This is ONE paragraph. It has two parts that flow into each other:

PART A — Who we are (always the same, word for word):
"I'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation."

PART B — Immediately continues in the SAME paragraph with a genuine compliment about the target business:
"I came across [Business] today and I have to say, [ONE specific real thing about their business that is genuinely interesting]."

These two parts are ONE paragraph. No line break between them.
The intro and the compliment are never separated.

PARAGRAPH 2 = Real World Market Tension
——————————————————————————————————————————————————————
This stands alone as its own paragraph.
It describes what is happening RIGHT NOW in the world that makes their situation urgent — a real trend, a real problem their customers face, news happening today.
It is NOT "many companies struggle with X."
It ends with a soft tension line that makes them think "yes, that is exactly our reality."
2-3 sentences.

PARAGRAPH 3 = Solution — One Flowing Sentence
——————————————————————————————————————————————————————
ONE paragraph. No bullets. No sub-headers.
Covers GROWTH first (SEO, digital marketing, visibility) then EFFICIENCY second (automation, CRM, workflows).
Specific to their industry.
Ends naturally — no tagline.

PARAGRAPH 4 = Soft Close
——————————————————————————————————————————————————————
Three sentences.
Sentence 1: you have specific ideas for their business.
Sentence 2: ask for a 15-minute call this week, ending with a question mark.
Sentence 3: include the booking link placeholder — always use this exact text: "You can {{BOOKING_LINK}} here."

════════════════════════════════════════════════
TARGET BUSINESS INFORMATION
════════════════════════════════════════════════

TARGET BUSINESS: ${contact.businessName}
WEBSITE: ${contact.website || 'Not provided'}
LOCATION: ${contact.state || 'Not specified'}

WEBSITE CONTENT:
${scrapedDetails}

BYTES PLATFORM SERVICES:
${servicesText}

════════════════════════════════════════════════
STEP 0 — COMPETITOR DETECTION (do this first)
════════════════════════════════════════════════

Does this business offer ANY of these as their OWN services?
- Software / app / web / mobile development
- UI/UX or product design
- AI, ML, chatbot development
- Business process or workflow automation
- SEO, social media, or digital marketing
- Data analytics or business intelligence
- Cloud computing or infrastructure
- CRM, ERP, or enterprise software
- Cybersecurity or IT security
- Blockchain or Web3

YES to any → isCompetitor = true
NO to all → isCompetitor = false

════════════════════════════════════════════════
STEP 1 — ANSWER THESE BEFORE WRITING ANYTHING
════════════════════════════════════════════════

Q1. What does this business actually do in plain English?
    One sentence. Not their tagline.
    WRONG: "They provide innovative security solutions"
    RIGHT: "They install video surveillance and access control systems for commercial buildings"

Q2. What is ONE specific real thing on their website that is genuinely interesting — not generic, not their tagline?
    Something a real person would notice while browsing.
    WRONG: "impressive lineup of services"
    WRONG: "cutting-edge technology"
    RIGHT: "They offer 24/7 remote monitoring for multi-site commercial properties with zero-lag cameras"

Q3. What is happening RIGHT NOW in the real world that makes their customers' situation urgent?
    A real trend. A real news item. A real market shift.
    WRONG: "Many companies struggle to integrate systems"
    WRONG: "In a competitive landscape businesses face challenges"
    RIGHT: "Commercial break-ins are rising and business owners are moving from traditional alarms to AI-monitored video — the demand is shifting fast"

Q4. What is the most specific growth thing AND the most specific efficiency thing Bytes Platform can do for THIS business?
    Be specific to their industry, not generic.

Use Q1-Q4 answers to write the email.
If Q2 has no real answer from the website → put "INSUFFICIENT_DATA" in the summary field and stop.

════════════════════════════════════════════════
STEP 2 — BUSINESS ANALYSIS
════════════════════════════════════════════════

Produce:
- 2-3 sentence business summary
- 3 specific pain points external services could address
- 3 business strengths and competitive advantages
- 3 concrete opportunities for service providers
- 5 relevant business keywords
- Every item must be unique — no repeating ideas

════════════════════════════════════════════════
STEP 3 — WRITE THE EMAIL
════════════════════════════════════════════════

PARAGRAPH 1 RULES — CRITICAL:
Write PART A + PART B as ONE single paragraph, no line break.

PART A (exact, word for word, every time, no changes):
"I'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation."

PART B (immediately continues in same paragraph):
Use one of these openers, rotate each time never repeat:
- "I came across [Business] today and I have to say, [compliment]."
- "I was looking at [Business] recently and I have to say, [compliment]."
- "Honestly, [Business] caught my attention because [compliment]."
- "[Business] stood out to me — [compliment]."

The compliment must:
- Come from your Q2 answer — specific and real
- Be genuinely interesting, not generic praise
- End the paragraph naturally

BANNED in Paragraph 1 compliment:
"impressive"
"cutting-edge"
"robust"
"innovative"
"seamlessly"
Any version of their own tagline or mission statement

——————————————————————————————————————————————
PARAGRAPH 2 RULES:
——————————————————————————————————————————————
Standalone paragraph. 3-4 sentences.
Use your Q3 answer — what is happening in the world RIGHT NOW.
Start with "The thing that stood out to me is..." or a natural variation.
End with a soft tension question like:
"The question is whether [their customers] are finding [Business Name] when they search."
or a natural variation that creates the same tension.

BANNED in Paragraph 2:
"currently many companies face"
"in a competitive landscape"
"many businesses struggle"
"it's clear that your focus"
"actionable insights"
"strategic initiatives"
"robust"
"seamlessly"
"cutting-edge"

——————————————————————————————————————————————
PARAGRAPH 3 RULES:
——————————————————————————————————————————————
One flowing paragraph. No bullets. No line breaks inside.
Growth mechanism + outcome → then → Efficiency mechanism + outcome.
Specific to their industry from Q4.
End naturally. No tagline. No "helping you grow faster while..."
Think of Paragraph 3 like this — say it in as few words as possible
while still covering both growth and efficiency. 
Less is more here.

——————————————————————————————————————————————
PARAGRAPH 4 RULES:
——————————————————————————————————————————————
Exactly 3 sentences.
"I'd love to share a couple of ideas I had specifically for [Business short name]."
Then ask for a 15-minute call this week (end with question mark).
Then add: "You can {{BOOKING_LINK}} here."

════════════════════════════════════════════════
IF isCompetitor = true
════════════════════════════════════════════════

Same 4-paragraph structure. Same tone. Same banned words.
Paragraph 3 only: do NOT pitch dev, AI, automation, or cybersecurity as if they lack it.
Only pitch: SEO, social media, marketing automation, CRM pipeline, or business intelligence.
Language: "work alongside", "expand reach", "grow together"
Never imply missing capability.

════════════════════════════════════════════════
SUBJECT LINE RULES
════════════════════════════════════════════════

3 subject lines, each a completely different angle:
Subject 1 — their specific industry challenge
Subject 2 — a genuine real observation
Subject 3 — a curiosity question

Rules:
- No emojis. No exclamation marks.
- Under 9 words each.
- No word or phrase repeated from the email body.
- Each one must make someone want to open.

════════════════════════════════════════════════
ICEBREAKER
════════════════════════════════════════════════

One sentence. 25-35 words.
Sounds like something said on a real sales call.
Specific real insight from their website.
Sharp enough to stop someone mid-scroll.

════════════════════════════════════════════════
OUTPUT — valid JSON only, no markdown, nothing else
════════════════════════════════════════════════

{
  "summary": "2-3 sentence business summary",
  "painPoints": ["pain point 1", "pain point 2", "pain point 3"],
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "isCompetitor": false,
  "pitchAngle": "standard",
  "subjectLines": ["Subject 1", "Subject 2", "Subject 3"],
  "emailBody": "Hi ${contactBizName},\\n\\nI'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation. [PART B compliment here].\\n\\n[Paragraph 2]\\n\\n[Paragraph 3]\\n\\n[Paragraph 4]\\n\\nBest regards,",
  "icebreaker": "One sentence 25-35 words",
  "rationale": "Brief mapping of pain points to growth and efficiency"
}

CRITICAL JSON RULES:
- Use \\n for line breaks inside emailBody
- Escape all quotes with \\"
- Must be 100% JSON.parse() valid
- Output ONLY the JSON — nothing before or after
`;
  }

  /**
   * Build email-only prompt (when summary already exists)
   */
  private buildEmailGenerationPrompt(scrapedData: any, contact: any, tone: EmailTone, productServices?: any[], businessName?: string, clientName?: string): string {
    const contactBizName = contact.businessName || 'there';
    const scrapedDetails = this.formatScrapedDataDetails(scrapedData);

    let servicesText = '';
    if (productServices && productServices.length > 0) {
      servicesText = productServices.map(ps => {
        const desc = ps.description ? ` (${ps.description})` : '';
        return `- ${ps.name}${desc}`;
      }).join('\n');
    } else {
      servicesText = `- Web Development
- WordPress Development
- Shopify Development
- MERN Stack Development
- UI/UX Design
- Mobile App Development (iOS & Android)
- Custom Software Development
- AI Applications
- AI Integrations
- Artificial Intelligence & Machine Learning
- Personalized AI Chatbots
- Business Process Automation
- Search Engine Optimization (SEO)
- Social Media Marketing
- Social Media Management
- Data Analytics & Business Intelligence
- Cloud Computing Services
- Cloud Integration
- CRM Development & Integration
- ERP Solutions
- Cybersecurity Solutions
- Blockchain Development`;
    }

    return `
You are a B2B outreach specialist writing cold emails for Bytes Platform.
Your only job is to write emails that sound EXACTLY like the gold standard below. Read it three times before writing anything.

════════════════════════════════════════════════
GOLD STANDARD EMAIL — THIS IS YOUR ONLY TEMPLATE
════════════════════════════════════════════════

Subject: A thought on growing Mackie Mobile

Hi [Name],

I'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation. I came across Mackie Mobile today and I have to say, being the first privacy-first wireless carrier is a genuinely bold move, and the market clearly needs it.

The thing that stood out to me is that people who are actively looking for a private, secure wireless alternative are out there searching right now. SIM swap fraud and phishing attacks are in the news constantly, and privacy-conscious consumers are becoming more common every day. The question is whether they're finding Mackie Mobile when they search.

An SEO strategy built around the exact terms your ideal customers are searching, combined with some process automation to make onboarding and support smoother as you grow, could really accelerate things for you.

I'd love to share a couple of ideas I had specifically for Mackie. Would a 15-minute call this week work for you? You can {{BOOKING_LINK}} here.

Best regards,

════════════════════════════════════════════════
PARAGRAPH STRUCTURE — STUDY THIS CAREFULLY
════════════════════════════════════════════════

PARAGRAPH 1 = Introduction + Compliment BLENDED TOGETHER
——————————————————————————————————————————————————————
This is ONE paragraph. It has two parts that flow into each other:

PART A — Who we are (always the same, word for word):
"I'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation."

PART B — Immediately continues in the SAME paragraph with a genuine compliment about the target business:
"I came across [Business] today and I have to say, [ONE specific real thing about their business that is genuinely interesting]."

These two parts are ONE paragraph. No line break between them.
The intro and the compliment are never separated.

PARAGRAPH 2 = Real World Market Tension
——————————————————————————————————————————————————————
This stands alone as its own paragraph.
It describes what is happening RIGHT NOW in the world that makes their situation urgent — a real trend, a real problem their customers face, news happening today.
It is NOT "many companies struggle with X."
It ends with a soft tension line that makes them think "yes, that is exactly our reality."
3-4 sentences.

PARAGRAPH 3 = Solution — One Flowing Sentence
——————————————————————————————————————————————————————
ONE paragraph. No bullets. No sub-headers.
Covers GROWTH first (SEO, digital marketing, visibility) then EFFICIENCY second (automation, CRM, workflows).
Specific to their industry.
Ends naturally — no tagline.

PARAGRAPH 4 = Soft Close
——————————————————————————————————————————————————————
Three sentences.
Sentence 1: you have specific ideas for their business.
Sentence 2: ask for a 15-minute call this week, ending with a question mark.
Sentence 3: include the booking link placeholder — always use this exact text: "You can {{BOOKING_LINK}} here."

════════════════════════════════════════════════
TARGET BUSINESS INFORMATION
════════════════════════════════════════════════

TARGET BUSINESS: ${contact.businessName}
WEBSITE: ${contact.website || 'Not provided'}
LOCATION: ${contact.state || 'Not specified'}

WEBSITE CONTENT:
${scrapedDetails}

BYTES PLATFORM SERVICES:
${servicesText}

════════════════════════════════════════════════
STEP 0 — COMPETITOR DETECTION (do this first)
════════════════════════════════════════════════

Does this business offer ANY of these as their OWN services?
- Software / app / web / mobile development
- UI/UX or product design
- AI, ML, chatbot development
- Business process or workflow automation
- SEO, social media, or digital marketing
- Data analytics or business intelligence
- Cloud computing or infrastructure
- CRM, ERP, or enterprise software
- Cybersecurity or IT security
- Blockchain or Web3

YES to any → isCompetitor = true
NO to all → isCompetitor = false

════════════════════════════════════════════════
STEP 1 — ANSWER THESE BEFORE WRITING ANYTHING
════════════════════════════════════════════════

Q1. What does this business actually do in plain English?
    One sentence. Not their tagline.
    WRONG: "They provide innovative security solutions"
    RIGHT: "They install video surveillance and access control systems for commercial buildings"

Q2. What is ONE specific real thing on their website that is genuinely interesting — not generic, not their tagline?
    Something a real person would notice while browsing.
    WRONG: "impressive lineup of services"
    WRONG: "cutting-edge technology"
    RIGHT: "They offer 24/7 remote monitoring for multi-site commercial properties with zero-lag cameras"

Q3. What is happening RIGHT NOW in the real world that makes their customers' situation urgent?
    A real trend. A real news item. A real market shift.
    WRONG: "Many companies struggle to integrate systems"
    WRONG: "In a competitive landscape businesses face challenges"
    RIGHT: "Commercial break-ins are rising and business owners are moving from traditional alarms to AI-monitored video — the demand is shifting fast"

Q4. What is the most specific growth thing AND the most specific efficiency thing Bytes Platform can do for THIS business?
    Be specific to their industry, not generic.

Use Q1-Q4 answers to write the email.
If Q2 has no real answer from the website → put "INSUFFICIENT_DATA" in the icebreaker field and stop.

════════════════════════════════════════════════
WRITE THE EMAIL
════════════════════════════════════════════════

PARAGRAPH 1 RULES — CRITICAL:
Write PART A + PART B as ONE single paragraph, no line break.

PART A (exact, word for word, every time, no changes):
"I'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation."

PART B (immediately continues in same paragraph):
Use one of these openers, rotate each time never repeat:
- "I came across [Business] today and I have to say, [compliment]."
- "I was looking at [Business] recently and I have to say, [compliment]."
- "Honestly, [Business] caught my attention because [compliment]."
- "[Business] stood out to me — [compliment]."

The compliment must:
- Come from your Q2 answer — specific and real
- Be genuinely interesting, not generic praise
- End the paragraph naturally

BANNED in Paragraph 1 compliment:
"impressive"
"cutting-edge"
"robust"
"innovative"
"seamlessly"
Any version of their own tagline or mission statement

——————————————————————————————————————————————
PARAGRAPH 2 RULES:
——————————————————————————————————————————————
Standalone paragraph. 3-4 sentences.
Use your Q3 answer — what is happening in the world RIGHT NOW.
Start with "The thing that stood out to me is..." or a natural variation.
End with a soft tension question like:
"The question is whether [their customers] are finding [Business Name] when they search."
or a natural variation that creates the same tension.

BANNED in Paragraph 2:
"currently many companies face"
"in a competitive landscape"
"many businesses struggle"
"it's clear that your focus"
"actionable insights"
"strategic initiatives"
"robust"
"seamlessly"
"cutting-edge"

——————————————————————————————————————————————
PARAGRAPH 3 RULES:
——————————————————————————————————————————————
One flowing paragraph. No bullets. No line breaks inside.
Growth mechanism + outcome → then → Efficiency mechanism + outcome.
Specific to their industry from Q4.
End naturally. No tagline. No "helping you grow faster while..."

——————————————————————————————————————————————
PARAGRAPH 4 RULES:
——————————————————————————————————————————————
Exactly 3 sentences.
"I'd love to share a couple of ideas I had specifically for [Business short name]."
Then ask for a 15-minute call this week (end with question mark).
Then add: "You can {{BOOKING_LINK}} here."

════════════════════════════════════════════════
IF isCompetitor = true
════════════════════════════════════════════════

Same 4-paragraph structure. Same tone. Same banned words.
Paragraph 3 only: do NOT pitch dev, AI, automation, or cybersecurity as if they lack it.
Only pitch: SEO, social media, marketing automation, CRM pipeline, or business intelligence.
Language: "work alongside", "expand reach", "grow together"
Never imply missing capability.

════════════════════════════════════════════════
SUBJECT LINE RULES
════════════════════════════════════════════════

3 subject lines, each a completely different angle:
Subject 1 — their specific industry challenge
Subject 2 — a genuine real observation
Subject 3 — a curiosity question

Rules:
- No emojis. No exclamation marks.
- Under 9 words each.
- No word or phrase repeated from the email body.
- Each one must make someone want to open.

════════════════════════════════════════════════
ICEBREAKER
════════════════════════════════════════════════

One sentence. 25-35 words.
Sounds like something said on a real sales call.
Specific real insight from their website.
Sharp enough to stop someone mid-scroll.

════════════════════════════════════════════════
OUTPUT — valid JSON only, no markdown, nothing else
════════════════════════════════════════════════

{
  "subjectLines": ["Subject 1", "Subject 2", "Subject 3"],
  "emailBody": "Hi ${contactBizName},\\n\\nI'm [Your Name] from Bytes Platform. We're a technology company specializing in custom software, digital marketing, and business automation. [PART B compliment here].\\n\\n[Paragraph 2]\\n\\n[Paragraph 3]\\n\\n[Paragraph 4]\\n\\nBest regards,",
  "icebreaker": "One sentence 25-35 words",
  "rationale": "Brief mapping of pain points to growth and efficiency"
}

CRITICAL JSON RULES:
- Use \\n for line breaks inside emailBody
- Escape all quotes with \\"
- Must be 100% JSON.parse() valid
- Output ONLY the JSON — nothing before or after
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

      const parsed = this.safeJsonParse(cleanText);

      // Validate core required fields (icebreaker and rationale are optional — AI sometimes omits them)
      if (!parsed.summary || !Array.isArray(parsed.painPoints) || !Array.isArray(parsed.strengths) ||
        !Array.isArray(parsed.opportunities) || !Array.isArray(parsed.keywords) ||
        !parsed.subjectLines || !Array.isArray(parsed.subjectLines) ||
        !parsed.emailBody) {
        this.logger.warn('Invalid combined response format:', parsed);
        throw new Error('Invalid combined response format from OpenAI API');
      }

      // Clean icebreaker (use default if AI omitted it)
      let cleanIcebreaker = (parsed.icebreaker || 'I noticed your business has some exciting growth potential.').trim();
      if (cleanIcebreaker.includes('\n')) {
        cleanIcebreaker = cleanIcebreaker.split('\n')[0].trim();
      }
      if (cleanIcebreaker.includes('.') && cleanIcebreaker.indexOf('.') < cleanIcebreaker.length - 1) {
        cleanIcebreaker = cleanIcebreaker.split('.')[0] + '.';
      }

      this.logger.log('Successfully parsed combined AI response');

      // Stringify rationale if AI returned it as an object/array, or provide default
      const rationale = !parsed.rationale ? 'AI-generated outreach' : (typeof parsed.rationale === 'string' ? parsed.rationale : JSON.stringify(parsed.rationale));

      return {
        summary: parsed.summary,
        painPoints: parsed.painPoints,
        strengths: parsed.strengths,
        opportunities: parsed.opportunities,
        keywords: parsed.keywords,
        subjectLines: parsed.subjectLines,
        emailBody: parsed.emailBody,
        icebreaker: cleanIcebreaker,
        rationale,
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

      // Parse JSON response with fallback repair
      const parsed = this.safeJsonParse(cleanText);

      // Validate required fields (rationale is optional — AI sometimes omits it)
      if (!parsed.subjectLines || !Array.isArray(parsed.subjectLines) ||
        !parsed.emailBody || !parsed.icebreaker) {
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

      // Stringify rationale if AI returned it as an object/array, or provide default
      const rationale = !parsed.rationale ? 'AI-generated outreach' : (typeof parsed.rationale === 'string' ? parsed.rationale : JSON.stringify(parsed.rationale));

      return {
        subjectLines: parsed.subjectLines,
        emailBody: parsed.emailBody,
        icebreaker: cleanIcebreaker,
        rationale,
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
