# 📧 Email Tracking & Unsubscribe Flow

## Overview

The system uses **dual tracking methods** for maximum reliability and **dedicated unsubscribe tokens** for proper token management.

---

## 🔄 Complete Email Sending Flow

### Step 1: Token Generation
```typescript
// In emails.service.ts (line 126-127)
const trackingToken = this.trackingService.generateTrackingToken();      // For pixel tracking
const unsubscribeToken = this.unsubscribeService.generateUnsubscribeToken(); // For unsubscribe
```

**Two separate tokens are generated:**
- `trackingToken` → Used for tracking pixel (1x1 image)
- `unsubscribeToken` → Used for unsubscribe link

### Step 2: HTML Content Preparation
```typescript
// Convert plain text to HTML
let processedBody = this.sendGridService.convertTextToHtml(draft.bodyText);

// Replace links with click tracking URLs
processedBody = this.sendGridService.replaceLinksWithTracking(
  processedBody,
  trackingToken,  // Uses trackingToken for click tracking
  baseUrl
);
```

### Step 3: Send via SendGrid
```typescript
await this.sendGridService.sendEmail(
  to,
  from,
  subject,
  processedBody,
  {
    unsubscribeToken,           // Separate token for unsubscribe
    trackingPixelToken: trackingToken,  // Token for pixel tracking
  }
);
```

### Step 4: Content Injection (in sendEmail method)
```typescript
// 1. Inject unsubscribe link (if token provided)
if (options?.unsubscribeToken) {
  processedHtml = this.injectUnsubscribeLink(processedHtml, options.unsubscribeToken, baseUrl);
}

// 2. Inject tracking pixel (if token provided)
if (options?.trackingPixelToken) {
  processedHtml = this.injectTrackingPixel(processedHtml, options.trackingPixelToken, baseUrl);
}
```

### Step 5: SendGrid Native Tracking
```typescript
trackingSettings: {
  openTracking: { enable: true },   // SendGrid's native open tracking
  clickTracking: { enable: true },   // SendGrid's native click tracking
}
```

### Step 6: Store Tokens in Database
```typescript
await emailLog.create({
  data: {
    trackingPixelToken: trackingToken,    // Stored for pixel tracking
    unsubscribeToken: unsubscribeToken,   // Stored for unsubscribe lookup
    messageId: sendResult.messageId,
    // ...
  }
});
```

---

## 📊 Dual Tracking System

### Method 1: SendGrid Native Tracking (PRIMARY - 80-90% accuracy)
- **How it works:**
  - SendGrid automatically injects tracking pixels and wraps links
  - SendGrid sends webhook events to your server when emails are opened/clicked
  - Webhook endpoint: `POST /emails/webhooks/sendgrid`

- **Events tracked:**
  - Email opens
  - Link clicks
  - Bounces, blocks, spam reports
  - Deliveries

- **Pros:**
  - High accuracy (80-90%)
  - Automatic link wrapping
  - Comprehensive event tracking
  - No code changes needed

- **Cons:**
  - Can be blocked by email clients
  - Requires webhook configuration
  - Dependent on SendGrid infrastructure

### Method 2: Custom Tracking Pixel (BACKUP - 60-70% accuracy)
- **How it works:**
  - Custom 1x1 transparent PNG injected into email HTML
  - Pixel URL: `${BASE_URL}/emails/tracking/pixel/${trackingToken}`
  - When email is opened, pixel loads → triggers `recordOpen()` in database

- **Endpoint:**
  ```
  GET /emails/tracking/pixel/:token
  ```
  - Public endpoint (no auth required)
  - Returns 1x1 transparent PNG
  - Records open event in `EmailEngagement` table

- **Pros:**
  - Works even if SendGrid tracking is blocked
  - Full control over tracking logic
  - Backup method for reliability

- **Cons:**
  - Lower accuracy (60-70%)
  - Can be blocked by image loading disabled
  - Requires your server to be accessible

---

## 🔗 Click Tracking Flow

### SendGrid Native Click Tracking
1. SendGrid automatically wraps all links in email
2. User clicks link → Goes through SendGrid's tracking URL
3. SendGrid records click → Sends webhook to your server
4. Webhook handler creates `EmailEngagement` record with `engagementType: 'click'`

### Custom Click Tracking (via replaceLinksWithTracking)
1. Before sending, all links are replaced with: `${BASE_URL}/emails/tracking/click/${trackingToken}?url=${originalUrl}`
2. User clicks link → Goes to your tracking endpoint
3. Endpoint: `GET /emails/tracking/click/:token?url=...`
4. Records click in database → Redirects to original URL

---

## 🚫 Unsubscribe Flow

### Token System
- **Separate token:** `unsubscribeToken` (different from `trackingPixelToken`)
- **Stored in:** `EmailLog.unsubscribeToken`
- **Lookup:** Unsubscribe service looks up by `unsubscribeToken` (with `trackingPixelToken` as fallback)

### Unsubscribe Process
1. **Email sent** with unsubscribe link: `${BASE_URL}/emails/unsubscribe/${unsubscribeToken}`
2. **User clicks unsubscribe** → Redirected to unsubscribe page
3. **Backend looks up EmailLog** by `unsubscribeToken`
4. **Creates EmailUnsubscribe record** for the contact
5. **Future emails blocked** - `isUnsubscribed()` check prevents sending

### Unsubscribe Endpoints
```
GET  /emails/unsubscribe/:token           # Unsubscribe page/form
POST /emails/unsubscribe/:token           # Process unsubscribe
GET  /emails/unsubscribe/history/:token   # View subscription history
POST /emails/unsubscribe/resubscribe/:token # Resubscribe
```

---

## 🎯 Why Two Tracking Methods?

### Reliability
- If SendGrid tracking fails/is blocked → Custom pixel still works
- If custom pixel is blocked → SendGrid tracking still works
- **Deduplication:** Both methods can record the same event, but database prevents duplicates

### Accuracy
- **SendGrid:** 80-90% accuracy (industry standard)
- **Custom Pixel:** 60-70% accuracy (backup)
- **Combined:** Higher overall reliability

### Data Collection
- SendGrid provides comprehensive event data (bounces, blocks, etc.)
- Custom tracking provides direct database records
- Both feed into `EmailEngagement` table for unified analytics

---

## 🔍 Database Schema

### EmailLog
```prisma
model EmailLog {
  trackingPixelToken String? @unique  // For pixel tracking
  unsubscribeToken   String? @unique  // For unsubscribe lookup
  messageId          String? @unique  // SendGrid message ID
  // ...
}
```

### EmailEngagement
```prisma
model EmailEngagement {
  emailLogId     Int
  engagementType EngagementType  // 'open' or 'click'
  engagedAt      DateTime
  url            String?        // For clicks only
  // ...
}
```

---

## 🐛 Troubleshooting

### Issue: Two Unsubscribe Links
**Fixed:** Added duplicate detection in `injectUnsubscribeLink()` method
- Checks if `/emails/unsubscribe/` already exists in HTML
- Skips injection if duplicate found

### Issue: Tracking Pixel Not Working
**Check:**
1. Is `BASE_URL` environment variable set correctly?
2. Is tracking pixel endpoint accessible from email clients?
3. Check server logs for pixel requests
4. Verify token is stored in `EmailLog.trackingPixelToken`

### Issue: Unsubscribe Token Mismatch
**Fixed:** 
- `unsubscribeToken` now stored in `EmailLog.unsubscribeToken`
- Unsubscribe service looks up by `unsubscribeToken` first
- Fallback to `trackingPixelToken` for backward compatibility

---

## 📝 Summary

**Tracking:**
- ✅ SendGrid native tracking (primary)
- ✅ Custom tracking pixel (backup)
- ✅ Both methods record to `EmailEngagement` table

**Unsubscribe:**
- ✅ Separate `unsubscribeToken` for security
- ✅ Stored in `EmailLog.unsubscribeToken`
- ✅ Duplicate prevention in injection method

**Flow:**
1. Generate 2 tokens (tracking + unsubscribe)
2. Inject unsubscribe link + tracking pixel
3. Enable SendGrid native tracking
4. Send email
5. Store both tokens in database
6. Track events via webhooks + pixel loads

