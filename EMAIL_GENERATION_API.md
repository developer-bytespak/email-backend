# 📧 Personalized Email Generation System

## Overview

The Personalized Email Generation System uses AI-powered summaries to create customized outreach emails with personalized tone and relevant service pitches for Bytes Platform. The system analyzes business data, identifies pain points, and generates professional yet conversational emails that feel human and authentic.

## 🚀 Features

- **AI-Powered Personalization**: Uses Gemini AI to analyze business summaries and generate tailored content
- **Multiple Tone Options**: Friendly, Professional, or Professional+Friendly tones
- **Bytes Platform Integration**: Automatically incorporates relevant services based on identified pain points
- **Draft Management**: Full CRUD operations for email drafts with editing capabilities
- **Campaign Support**: Bulk generation for multiple contacts
- **Analytics Integration**: Track email performance and engagement

## 📋 API Endpoints

### Email Generation

#### Generate Single Email Draft
```http
POST /emails/generation/generate
Content-Type: application/json

{
  "contactId": 123,
  "summaryId": 456,
  "clientEmailId": 789,
  "tone": "pro_friendly" // optional: "friendly", "professional", "pro_friendly"
}
```

**Response:**
```json
{
  "contactId": 123,
  "summaryId": 456,
  "emailDraftId": 101,
  "success": true
}
```

#### Bulk Generate Email Drafts
```http
POST /emails/generation/bulk-generate
Content-Type: application/json

[
  {
    "contactId": 123,
    "summaryId": 456,
    "clientEmailId": 789,
    "tone": "professional"
  },
  {
    "contactId": 124,
    "summaryId": 457,
    "clientEmailId": 789,
    "tone": "friendly"
  }
]
```

### Email Draft Management

#### Get Email Draft
```http
GET /emails/generation/drafts/{draftId}
```

#### Update Email Draft
```http
PUT /emails/generation/drafts/{draftId}
Content-Type: application/json

{
  "subjectLine": "Updated subject line",
  "bodyText": "Updated email body",
  "icebreaker": "Updated icebreaker",
  "productsRelevant": "Updated rationale"
}
```

#### Get Contact's Email Drafts
```http
GET /emails/generation/contacts/{contactId}/drafts
```

### Tone Options

#### Get Available Tones
```http
GET /emails/generation/tones
```

**Response:**
```json
{
  "tones": [
    {
      "value": "friendly",
      "label": "Friendly",
      "description": "Casual and warm tone with conversational language"
    },
    {
      "value": "professional",
      "label": "Professional", 
      "description": "Formal business tone maintaining credibility and expertise"
    },
    {
      "value": "pro_friendly",
      "label": "Professional + Friendly",
      "description": "Balanced tone that's professional yet warm and approachable"
    }
  ]
}
```

### Campaign Management

#### Create Campaign
```http
POST /emails/campaign
Content-Type: application/json

{
  "name": "Q4 Outreach Campaign",
  "description": "Targeting tech startups for web development services",
  "contactIds": [123, 124, 125],
  "clientEmailId": 789,
  "tone": "pro_friendly"
}
```

#### Send Email Draft
```http
POST /emails/send-draft
Content-Type: application/json

{
  "draftId": 101
}
```

### Analytics

#### Get Email Analytics
```http
GET /emails/analytics?contactId=123
GET /emails/analytics?campaignId=campaign_123
```

## 🎯 Email Generation Process

### 1. Data Flow
```
Contact Data → AI Summary → Pain Points Analysis → Email Generation → Draft Storage
```

### 2. AI Prompt Structure
The system uses a sophisticated prompt that includes:
- **Company Summary**: AI-generated business analysis
- **Pain Points**: Identified challenges and opportunities
- **Bytes Platform Services**: Relevant service offerings
- **Tone Instructions**: Specific guidance for the chosen tone
- **Output Format**: Structured JSON response

### 3. Generated Content Structure
Each generated email includes:
- **Subject Lines**: 2-3 options (≤6 words each)
- **Email Body**: 100-140 words, 2 paragraphs max
- **Icebreaker**: Personalized opening line
- **Rationale**: Explanation of pain point to service mapping

## 📝 Example Generated Email

### Input Data:
- **Business**: Tech startup with outdated website
- **Pain Points**: ["Slow website performance", "Poor mobile experience", "Limited e-commerce functionality"]
- **Tone**: Professional + Friendly

### Generated Output:
```json
{
  "subjectLines": [
    "Quick question about your website",
    "Helping businesses like yours",
    "Let's streamline your growth"
  ],
  "emailBody": "Hi there,\n\nI was checking out your website and noticed some interesting opportunities for growth. It seems like website performance and mobile experience might be holding things back, which I totally get—these are common challenges for growing businesses.\n\nAt Bytes Platform, we specialize in custom web development and e-commerce solutions to tackle exactly this kind of challenge, helping businesses like yours accelerate growth with modern, fast-loading websites.\n\nI'd love to share how we can make this easier for you with our web development and Shopify integration services. Would you be up for a quick chat to explore what's possible? Let me know what works for you!\n\nBest regards,\n[Your Name]",
  "icebreaker": "I was checking out your website and noticed some interesting opportunities for growth.",
  "rationale": "Linked website performance pain points to Bytes Platform's web development and e-commerce services, using pro_friendly tone to balance professionalism with approachability."
}
```

## 🔧 Integration Points

### Database Schema
- **EmailDraft**: Stores generated email content
- **Summary**: Contains AI analysis data
- **Contact**: Business information
- **ClientEmail**: Sender configuration

### Service Dependencies
- **LlmClientService**: Gemini AI integration
- **PrismaService**: Database operations
- **SummarizationService**: Business analysis

## 🎨 Frontend Integration

### Draft Editing Flow
1. Generate email draft via API
2. Display draft in frontend editor
3. Allow user modifications
4. Save updated draft
5. Send when ready

### Tone Selection UI
```typescript
const toneOptions = [
  { value: 'friendly', label: 'Friendly', icon: '😊' },
  { value: 'professional', label: 'Professional', icon: '💼' },
  { value: 'pro_friendly', label: 'Pro + Friendly', icon: '🤝' }
];
```

## 🚨 Error Handling

### Common Error Scenarios
- **Contact not found**: Returns 404 with clear message
- **Summary missing**: Validates summary belongs to contact
- **AI generation failure**: Provides fallback content
- **Invalid tone**: Defaults to 'pro_friendly'

### Error Response Format
```json
{
  "contactId": 123,
  "summaryId": 456,
  "emailDraftId": 0,
  "success": false,
  "error": "Contact with ID 123 not found"
}
```

## 📊 Performance Considerations

- **Rate Limiting**: Built-in delays for Gemini API calls
- **Queue Management**: Sequential processing to avoid conflicts
- **Caching**: Reuse summaries for multiple email generations
- **Batch Processing**: Efficient bulk operations

## 🔐 Security & Compliance

- **Input Validation**: All inputs validated and sanitized
- **Rate Limiting**: Prevents API abuse
- **Data Privacy**: No sensitive data logged
- **Error Handling**: Secure error messages without data leakage

## 🚀 Getting Started

1. **Ensure Prerequisites**: Contact must have AI summary generated
2. **Choose Tone**: Select appropriate tone for your audience
3. **Generate Draft**: Call generation API with contact/summary IDs
4. **Review & Edit**: Use frontend to customize generated content
5. **Send**: Use send-draft API when ready

## 📈 Future Enhancements

- **A/B Testing**: Multiple subject line variations
- **Template Library**: Pre-built email templates
- **Personalization Scoring**: AI confidence metrics
- **Integration Webhooks**: Real-time notifications
- **Advanced Analytics**: Detailed performance tracking
