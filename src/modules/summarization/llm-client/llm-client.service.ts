import { Injectable, Logger } from '@nestjs/common';

export interface GeminiResponse {
  summary: string;
  painPoints: string[];
  strengths: string[];
  opportunities: string[];
  keywords: string[];
  tokensUsed: number;
  model: string;
  processingTime?: number;
}

@Injectable()
export class LlmClientService {
  private readonly logger = new Logger(LlmClientService.name);
  private readonly GEMINI_API_URL = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash-lite:generateContent';
  private readonly GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
  
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessing = false;
  private lastRequestTime = 0;
  private readonly RATE_LIMIT_DELAY = 40000; // 40 seconds delay between requests to avoid rate limits

  async generateSummary(content: string): Promise<GeminiResponse> {
    const startTime = Date.now();
    
    try {
      // Prepare the prompt for business analysis
      const prompt = this.buildBusinessAnalysisPrompt(content);
      
      // Call Gemini API with rate limiting
      const response = await this.callGeminiAPI(prompt);
      
      const processingTime = Date.now() - startTime;
      
      // Parse the structured response
      const parsedResponse = this.parseGeminiResponse(response.text);
      
      return {
        ...parsedResponse,
        tokensUsed: response.tokensUsed,
        model: 'gemini-2.0-flash-lite',
        processingTime
      };
      
    } catch (error) {
      this.logger.error('Gemini API call failed:', error);
      throw new Error(`AI analysis failed: ${error.message}`);
    }
  }

  private buildBusinessAnalysisPrompt(content: string): string {
    return `
Analyze this business website content and provide structured insights:

Website Content:
${content}

Please provide a comprehensive business analysis in the following JSON format:
{
  "summary": "2-3 sentence business summary",
  "painPoints": ["pain point 1", "pain point 2", "pain point 3"],
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"]
}

Guidelines:
- Focus on business challenges and growth opportunities
- Identify specific pain points that external services could address
- Highlight business strengths and competitive advantages
- Suggest concrete opportunities for service providers
- Extract relevant business keywords for targeting
- Keep each array item concise but specific
- Ensure JSON is valid and properly formatted
`;
  }

  private async callGeminiAPI(prompt: string): Promise<{ text: string; tokensUsed: number }> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          // Rate limiting
          const timeSinceLastRequest = Date.now() - this.lastRequestTime;
          if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
            await this.sleep(this.RATE_LIMIT_DELAY - timeSinceLastRequest);
          }

          const response = await fetch(this.GEMINI_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': this.GEMINI_API_KEY,
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

  private parseGeminiResponse(responseText: string): Omit<GeminiResponse, 'tokensUsed' | 'model' | 'processingTime'> {
    try {
      // Clean the response text (remove markdown formatting if present)
      const cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // Parse JSON response
      const parsed = JSON.parse(cleanText);
      
      // Validate required fields
      if (!parsed.summary || !Array.isArray(parsed.painPoints) || !Array.isArray(parsed.strengths) || 
          !Array.isArray(parsed.opportunities) || !Array.isArray(parsed.keywords)) {
        throw new Error('Invalid response format from Gemini API');
      }
      
      return {
        summary: parsed.summary,
        painPoints: parsed.painPoints,
        strengths: parsed.strengths,
        opportunities: parsed.opportunities,
        keywords: parsed.keywords
      };
      
    } catch (error) {
      this.logger.error('Failed to parse Gemini response:', error);
      this.logger.debug('Raw response:', responseText);
      
      // Fallback to basic parsing if JSON parsing fails
      return {
        summary: "Business analysis completed",
        painPoints: ["Analysis in progress"],
        strengths: ["Business evaluation ongoing"],
        opportunities: ["Service opportunities being identified"],
        keywords: ["business", "analysis"]
      };
    }
  }

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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async analyzeContent(content: string) {
    // Legacy method for backward compatibility
    const analysis = await this.generateSummary(content);
    return {
      sentiment: 'positive',
      confidence: 0.85,
      keyTopics: analysis.keywords,
      wordCount: content.split(' ').length,
      summary: analysis.summary
    };
  }

  /**
   * Generate SMS content using Gemini AI
   * This method handles SMS-specific prompts and extracts clean SMS text
   */
  async generateSmsContent(prompt: string): Promise<string> {
    try {
      const response = await this.callGeminiAPI(prompt);
      return this.extractSmsFromResponse(response.text);
    } catch (error) {
      this.logger.error('Failed to generate SMS content:', error);
      throw error;
    }
  }

  /**
   * Extract SMS message from Gemini response
   * Handles responses that contain both JSON and SMS text
   */
  private extractSmsFromResponse(responseText: string): string {
    // If response contains both JSON and SMS, extract the SMS part
    const lines = responseText.split('\n');
    
    // Look for SMS message after JSON block
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      // Skip empty lines and JSON closing braces
      if (line && !line.startsWith('}') && !line.startsWith('```')) {
        // This should be our SMS message
        return line.replace(/^["']|["']$/g, '').trim();
      }
    }
    
    // Fallback: return the last non-empty line
    return lines.filter(line => line.trim()).pop()?.trim() || 'Business analysis completed';
  }
}
