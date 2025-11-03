# Email Automation APIs - Testing Guide

This guide covers testing all the new email automation APIs implemented on 11/4/25.

## Prerequisites

1. **Database Migration**: Run migrations first
   ```bash
   cd email-backend
   npx prisma migrate dev --name add_email_automation_tables
   ```

2. **Environment Variables**: Ensure these are set in `.env`:
   ```
   SENDGRID_API_KEY=SG.xxxxx
   SENDGRID_WEBHOOK_VERIFICATION_KEY=xxxxx
   BASE_URL=http://localhost:3000  # or your Render URL
   SPAM_SCORE_THRESHOLD=50
   EMAIL_SCHEDULER_INTERVAL=300000
   GEMINI_API_KEY=xxxxx
   ```

3. **Test Data**: You need:
   - A Client account
   - A ClientEmail entry
   - A Contact with email
   - An EmailDraft (created via `/emails/generate` endpoint)

---

## 1. Spam Optimization APIs

### 1.1 Check Spam Score
**POST** `/emails/optimization/check`

```bash
curl -X POST http://localhost:3000/emails/optimization/check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "content": "FREE offer! ACT NOW! Limited time!!! Click here to win $1000!!!",
    "subjectLine": "URGENT: Don't Miss This!"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "score": 75,
    "keywords": ["free", "act now", "limited time", "click here", "urgent"],
    "suggestions": [
      "Remove or replace spam trigger words: free, act now, limited time",
      "Reduce excessive capitalization. Use sentence case instead.",
      "Reduce exclamation marks (found 4). Use one per email maximum."
    ],
    "blocked": true
  }
}
```

### 1.2 Get Optimization Suggestions (with Gemini)
**POST** `/emails/optimization/suggest`

```bash
curl -X POST http://localhost:3000/emails/optimization/suggest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "content": "FREE offer! ACT NOW! Limited time!!!",
    "subjectLine": "URGENT: Don't Miss This!"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "suggestions": ["...", "..."],
    "optimizedContent": "We have an exciting opportunity available..."
  }
}
```

### 1.3 Get DKIM/SPF (DomainKeys Identified Mail/Sender Policy Framework) Status
**GET** `/emails/optimization/auth/:clientEmailId`

```bash
curl -X GET http://localhost:3000/emails/optimization/auth/1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 2. Email Tracking APIs

### 2.1 Tracking Pixel (Public - No Auth)
**GET** `/emails/tracking/pixel/:token`

This is automatically called when email is opened. Test by:
1. Send an email
2. Open the email (in email client or forward to yourself)
3. The pixel loads automatically

**Manual Test:**
```bash
curl -X GET http://localhost:3000/emails/tracking/pixel/abc123token \
  -H "Accept: image/png"
```

**Expected**: Returns 1x1 transparent PNG image

### 2.2 Click Tracking (Public - No Auth)
**GET** `/emails/tracking/click/:token?url=https://example.com`

This redirects to the original URL after tracking. Test by clicking links in emails.

**Manual Test:**
```bash
curl -I "http://localhost:3000/emails/tracking/click/abc123token?url=https://google.com"
```

**Expected**: HTTP 302 redirect to `https://google.com`

### 2.3 Get Engagement Statistics
**GET** `/emails/tracking/engagement/:emailLogId`

```bash
curl -X GET http://localhost:3000/emails/tracking/engagement/1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Engagement statistics retrieved",
  "data": {
    "emailLogId": 1,
    "opens": 3,
    "clicks": 1,
    "openRate": 300,
    "clickRate": 33.33,
    "engagements": [...]
  }
}
```

---

## 3. Unsubscribe APIs

### 3.1 Unsubscribe Page (Public - No Auth)
**GET** `/emails/unsubscribe/:token`

```bash
curl -X GET http://localhost:3000/emails/unsubscribe/abc123token
```

**Expected**: Returns HTML unsubscribe page

### 3.2 Process Unsubscribe (Public - No Auth)
**POST** `/emails/unsubscribe/:token`

```bash
curl -X POST http://localhost:3000/emails/unsubscribe/abc123token \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Too many emails"
  }'
```

**Expected**: Returns HTML confirmation page

**Note**: After unsubscribing, the contact will be blocked from receiving future emails automatically.

---

## 4. Email Scheduling APIs

### 4.1 Schedule Email
**POST** `/emails/schedule`

```bash
curl -X POST http://localhost:3000/emails/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "draftId": 1,
    "scheduledAt": "2025-11-04T10:00:00Z"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Email scheduled successfully",
  "data": {
    "id": 1,
    "emailDraftId": 1,
    "scheduledAt": "2025-11-04T10:00:00.000Z",
    "status": "pending",
    "priority": 1728120000000
  }
}
```

### 4.2 Get Queue Status
**GET** `/emails/schedule/queue/status`

```bash
curl -X GET http://localhost:3000/emails/schedule/queue/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Queue status retrieved",
  "data": {
    "pending": 5,
    "sent": 10,
    "failed": 2,
    "nextProcessing": "2025-11-04T10:05:00.000Z"
  }
}
```

### 4.3 Remove from Queue
**DELETE** `/emails/schedule/queue/:draftId`

```bash
curl -X DELETE http://localhost:3000/emails/schedule/queue/1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 5. Enhanced Send Email Draft API

### 5.1 Send Email Draft (Enhanced)
**POST** `/emails/send-draft`

```bash
curl -X POST http://localhost:3000/emails/send-draft \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "draftId": 1
  }'
```

**What happens:**
1. ✅ Checks if contact is unsubscribed
2. ✅ Validates SendGrid configuration
3. ✅ Checks rate limits
4. ✅ **Checks spam score** (if >= 50, auto-optimizes with Gemini)
5. ✅ Injects tracking links
6. ✅ Injects unsubscribe link
7. ✅ Sends via SendGrid with native tracking
8. ✅ Creates EmailLog record

**Expected Response (Success):**
```json
{
  "success": true,
  "emailLogId": 1,
  "messageId": "sg_message_id_here",
  "spamScore": 25,
  "message": "Email sent successfully"
}
```

**Expected Response (Spam Blocked):**
```json
{
  "statusCode": 400,
  "message": {
    "message": "Email blocked: Spam score too high (75). Please optimize content.",
    "spamScore": 75,
    "suggestions": ["...", "..."],
    "optimizedContent": "..." // If auto-optimization was attempted
  }
}
```

**Expected Response (Unsubscribed Contact):**
```json
{
  "statusCode": 400,
  "message": "Contact has unsubscribed from emails"
}
```

---

## 6. SendGrid Webhooks (Bounce Management)

### 6.1 SendGrid Webhook Endpoint
**POST** `/emails/webhooks/sendgrid`

**Note**: This is configured in SendGrid dashboard. SendGrid will POST events here.

**To test manually**, you can simulate webhook events:

```bash
curl -X POST http://localhost:3000/emails/webhooks/sendgrid \
  -H "Content-Type: application/json" \
  -d '[
    {
      "email": "test@example.com",
      "timestamp": 1728120000,
      "event": "open",
      "sg_message_id": "message_id_from_emaillog",
      "sg_event_id": "event_123"
    }
  ]'
```

**Supported Events:**
- `open` - Email opened
- `click` - Link clicked
- `delivered` - Email delivered
- `bounce` - Email bounced
- `blocked` - Email blocked
- `dropped` - Email dropped
- `spamreport` - Marked as spam
- `unsubscribe` - User unsubscribed

### 6.2 Get Bounce Statistics
**GET** `/emails/webhooks/bounces/:clientId`

```bash
curl -X GET http://localhost:3000/emails/webhooks/bounces/1 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Bounce statistics retrieved",
  "data": {
    "total": 100,
    "bounced": 5,
    "blocked": 2,
    "dropped": 1,
    "spamreport": 3,
    "bounceRate": 5.0
  }
}
```

---

## 7. Complete Testing Workflow

### Step 1: Generate Email Draft
```bash
POST /emails/generate
# Creates an EmailDraft with Gemini-generated content
```

### Step 2: Check Spam Score (Optional)
```bash
POST /emails/optimization/check
# Verify spam score is acceptable
```

### Step 3: Send Email
```bash
POST /emails/send-draft
# Sends email with all checks:
# - Unsubscribe check
# - Spam check (auto-optimizes if needed)
# - Tracking injection
# - SendGrid delivery
```

### Step 4: Monitor Engagement
```bash
GET /emails/tracking/engagement/:emailLogId
# Check opens, clicks, etc.
```

### Step 5: Test Unsubscribe
1. Open email in browser
2. Click unsubscribe link
3. Verify contact is blocked from future emails

### Step 6: Test Webhooks
1. Configure webhook URL in SendGrid dashboard
2. SendGrid will POST events automatically
3. Check EmailLog status updates

---

## 8. Testing with Postman/Thunder Client

### Collection Structure:
```
📁 Email Automation APIs
├── 📁 Spam Optimization
│   ├── Check Spam Score
│   ├── Get Suggestions
│   └── Get Auth Status
├── 📁 Tracking
│   ├── Tracking Pixel
│   ├── Click Tracking
│   └── Engagement Stats
├── 📁 Unsubscribe
│   ├── Unsubscribe Page
│   └── Process Unsubscribe
├── 📁 Scheduling
│   ├── Schedule Email
│   ├── Queue Status
│   └── Remove from Queue
├── 📁 Send Email
│   └── Send Draft (Enhanced)
└── 📁 Webhooks
    ├── SendGrid Webhook
    └── Bounce Stats
```

---

## 9. Important Testing Notes

### ⚠️ Spam Score Threshold
- Default threshold: **50**
- If score >= 50, email is **blocked** and auto-optimization is attempted
- If optimization fails, email is rejected

### ⚠️ Unsubscribe Enforcement
- Once a contact unsubscribes, they are **automatically blocked**
- `sendEmailDraft()` will reject with 400 error for unsubscribed contacts

### ⚠️ Rate Limits
- Each `ClientEmail` has a `limit` field (default: 500)
- `currentCounter` resets based on your logic
- Emails are rejected if `currentCounter >= limit`

### ⚠️ Background Scheduler
- Runs every 5 minutes (configurable via `EMAIL_SCHEDULER_INTERVAL`)
- Processes emails in FIFO order
- Retries failed sends (max 3 retries with exponential backoff)
- Adds random delays between sends (5-10 minutes)

### ⚠️ SendGrid Webhook Setup
1. Go to SendGrid Dashboard → Settings → Mail Settings → Event Webhook
2. Add webhook URL: `https://your-domain.com/emails/webhooks/sendgrid`
3. Select events: `open`, `click`, `delivered`, `bounce`, `blocked`, `dropped`, `spamreport`, `unsubscribe`
4. Enable "Signed Event Webhook" and add verification key to `.env`

---

## 10. Database Verification

After testing, verify data in database:

```sql
-- Check EmailLog entries
SELECT id, status, spamScore, messageId, trackingPixelToken 
FROM "EmailLog" 
ORDER BY "sentAt" DESC;

-- Check EmailEngagement (opens/clicks)
SELECT "engagementType", COUNT(*) 
FROM "EmailEngagement" 
GROUP BY "engagementType";

-- Check EmailUnsubscribe
SELECT * FROM "EmailUnsubscribe";

-- Check EmailQueue
SELECT * FROM "EmailQueue" WHERE status = 'pending';
```

---

## 11. Common Issues & Solutions

### Issue: "sgMail.setApiKey is not a function"
**Solution**: Already fixed - using default import instead of namespace import

### Issue: "Email blocked: Spam score too high"
**Solution**: 
- Check spam keywords in your email content
- Use `/emails/optimization/suggest` to get optimized version
- System will auto-optimize if score >= 50

### Issue: "Contact has unsubscribed"
**Solution**: 
- Check `EmailUnsubscribe` table
- Contact must be removed from unsubscribe list manually in DB if needed

### Issue: "Rate limit exceeded"
**Solution**: 
- Reset `currentCounter` in `ClientEmail` table
- Or increase `limit` value

### Issue: Webhooks not working
**Solution**:
- Verify webhook URL is accessible (not localhost)
- Check webhook signature verification key
- Verify SendGrid dashboard webhook configuration

---

## 12. Quick Test Script

Save this as `test-apis.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"
TOKEN="YOUR_JWT_TOKEN"

echo "1. Testing Spam Check..."
curl -X POST "$BASE_URL/emails/optimization/check" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"content": "FREE offer! ACT NOW!", "subjectLine": "URGENT"}'

echo -e "\n\n2. Testing Send Email Draft..."
curl -X POST "$BASE_URL/emails/send-draft" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"draftId": 1}'

echo -e "\n\n3. Testing Queue Status..."
curl -X GET "$BASE_URL/emails/schedule/queue/status" \
  -H "Authorization: Bearer $TOKEN"

echo -e "\n\n4. Testing Engagement Stats..."
curl -X GET "$BASE_URL/emails/tracking/engagement/1" \
  -H "Authorization: Bearer $TOKEN"
```

---

**Happy Testing! 🚀**

