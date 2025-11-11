# SendGrid Webhook Implementation Guide

## 📋 Table of Contents
- [Overview](#overview)
- [What's Implemented](#whats-implemented)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Event Handlers](#event-handlers)
- [Database Schema](#database-schema)
- [API Endpoints](#api-endpoints)
- [What's Next](#whats-next)
- [Troubleshooting](#troubleshooting)

---

## Overview

This document describes the SendGrid webhook implementation for tracking email events. The system uses a single webhook URL with middleware to handle signature verification, deduplication, and routing to multiple handlers.

**Webhook URL:** `https://email-backend-izs4.onrender.com/emails/webhooks/sendgrid`

**Status:** ✅ Production Ready

---

## What's Implemented

### ✅ Core Features

1. **Signature Verification**
   - ECDSA signature verification using SendGrid's public key
   - Prevents unauthorized webhook requests
   - Implemented as NestJS Guard

2. **Event Deduplication**
   - Prevents processing the same event twice
   - Uses `sg_event_id` for tracking
   - In-memory cache (upgradeable to Redis)

3. **Multi-Handler Routing**
   - Primary handler: BounceManagementService (synchronous)
   - Secondary handlers: External webhooks (asynchronous)
   - Extensible architecture for future handlers

4. **Event Handlers**
   - ✅ `processed` - SendGrid accepted email
   - ✅ `deferred` - Temporary delivery failure
   - ✅ `delivered` - Email delivered successfully
   - ✅ `bounce` - Permanent delivery failure
   - ✅ `blocked` - Email blocked by SendGrid
   - ✅ `dropped` - Email dropped (invalid, suppressed, etc.)
   - ✅ `open` - Email opened by recipient
   - ✅ `click` - Link clicked by recipient
   - ✅ `spamreport` - Marked as spam
   - ✅ `unsubscribe` - Recipient unsubscribed

5. **Database Tracking**
   - Event timestamps (processedAt, deferredAt, deliveredAt)
   - Retry attempt tracking
   - SMTP transaction IDs
   - Template IDs
   - Custom arguments (JSON)

---

## Architecture

### Middleware Chain

```
SendGrid Webhook Request
    ↓
[Raw Body Parser] - Preserves raw body for signature verification
    ↓
[SendGridSignatureGuard] - Verifies ECDSA signature
    ↓
[WebhookDeduplicationInterceptor] - Filters duplicate events
    ↓
[SendGridWebhookController] - Primary handler
    ↓
    ├─→ [BounceManagementService] - Process events (sync)
    └─→ [WebhookRouterService] - Route to secondary handlers (async)
```

### File Structure

```
email-backend/src/modules/emails/webhooks/
├── guards/
│   └── sendgrid-signature.guard.ts      # Signature verification
├── interceptors/
│   └── webhook-deduplication.interceptor.ts  # Event deduplication
├── services/
│   └── webhook-router.service.ts        # Multi-handler routing
├── bounce-management.service.ts         # Event processing logic
├── sendgrid-webhook.controller.ts      # Webhook endpoint
└── webhooks.module.ts                   # Module configuration
```

---

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Required: SendGrid Webhook Verification Key
# Get from: SendGrid Dashboard → Settings → Mail Settings → Event Webhook → Your webhook → Verification Key
SENDGRID_WEBHOOK_VERIFICATION_KEY=your_base64_public_key_here

# Optional: Secondary webhook URLs (comma-separated)
# These will receive forwarded events asynchronously
SENDGRID_SECONDARY_WEBHOOK_URLS=https://analytics-service.com/webhook,https://monitoring-service.com/webhook
```

### SendGrid Dashboard Configuration

1. **Go to:** SendGrid Dashboard → Settings → Mail Settings → Event Webhook
2. **Configure:**
   - **Post URL:** `https://email-backend-izs4.onrender.com/emails/webhooks/sendgrid`
   - **Enable endpoint:** ✅ ON
   - **Signed event:** ✅ ON (Required for signature verification)
   - **Events to track:**
     - ✅ Processed
     - ✅ Deferred
     - ✅ Delivered
     - ✅ Bounced
     - ✅ Blocked
     - ✅ Dropped
     - ✅ Opened
     - ✅ Clicked
     - ✅ Unsubscribed
     - ✅ Spam Reports

3. **Copy Verification Key:**
   - Click on your webhook
   - Copy the "Verification Key" (base64 format)
   - Add to `.env` as `SENDGRID_WEBHOOK_VERIFICATION_KEY`

---

## Event Handlers

### 1. Processed Event

**When:** SendGrid accepts and queues the email for delivery

**Handler:** `handleProcessed()`

**Updates:**
- `status` → `'processed'`
- `processedAt` → Event timestamp
- `smtpId` → SMTP transaction ID (if provided)
- `templateId` → SendGrid template ID (if used)
- `customArgs` → Custom metadata (if provided)

**Use Cases:**
- Track bulk send acceptance
- Calculate delivery time: `deliveredAt - processedAt`
- Monitor SendGrid processing time

### 2. Deferred Event

**When:** Temporary delivery failure, SendGrid will retry

**Handler:** `handleDeferred()`

**Updates:**
- `status` → `'deferred'`
- `deferredAt` → Event timestamp
- `retryAttempt` → Retry attempt number (1, 2, 3, etc.)

**Use Cases:**
- Monitor temporary delivery issues
- Track retry attempts
- Identify ISP throttling patterns

### 3. Delivered Event

**When:** Recipient's mail server accepted the message

**Handler:** `handleDelivered()`

**Updates:**
- `status` → `'delivered'`
- `deliveredAt` → Event timestamp

**Use Cases:**
- Success metric for delivery rate
- Calculate delivery time from processed to delivered

### 4. Bounce Event

**When:** Permanent delivery failure (hard bounce)

**Handler:** `handleBounce()`

**Updates:**
- `status` → `'bounced'`
- Contact `status` → `'bounced'` (if hard bounce)

**Bounce Classifications:**
- `1` = Invalid address
- `10` = Blocked
- Other = Soft bounce (may retry)

**Use Cases:**
- Calculate bounce rate
- Remove invalid email addresses
- Update contact status

### 5. Blocked Event

**When:** Email blocked by SendGrid (spam, policy violation, etc.)

**Handler:** `handleBlocked()`

**Updates:**
- `status` → `'blocked'`

**Use Cases:**
- Track blocked emails
- Identify content issues

### 6. Dropped Event

**When:** Email dropped before sending (invalid, suppressed, etc.)

**Handler:** `handleDropped()`

**Updates:**
- `status` → `'dropped'`

**Use Cases:**
- Track dropped emails
- Identify suppression list issues

### 7. Open Event

**When:** Email opened by recipient (tracking pixel loaded)

**Handler:** `handleOpen()`

**Creates:**
- `EmailEngagement` record with `engagementType: 'open'`

**Use Cases:**
- Measure engagement
- Subject line performance
- Open rate calculation

### 8. Click Event

**When:** Recipient clicked a tracked link

**Handler:** `handleClick()`

**Creates:**
- `EmailEngagement` record with `engagementType: 'click'` and URL

**Use Cases:**
- Measure content effectiveness
- Click-through rate (CTR)
- Link performance

### 9. Spam Report Event

**When:** Recipient marked email as spam

**Handler:** `handleSpamReport()`

**Updates:**
- `status` → `'spamreport'`

**Use Cases:**
- Track sender reputation
- Suppress future sends to complainers
- Calculate spam rate

### 10. Unsubscribe Event

**When:** Recipient unsubscribed globally

**Handler:** `handleUnsubscribe()`

**Creates:**
- `EmailUnsubscribe` record

**Use Cases:**
- Remove from all future sends
- Compliance with unsubscribe requests
- Track unsubscribe rate

---

## Database Schema

### EmailLog Table

**New Fields Added:**

```prisma
model EmailLog {
  // ... existing fields
  
  // Webhook event tracking fields
  processedAt  DateTime? // When SendGrid processed it
  deferredAt   DateTime? // When email was deferred
  retryAttempt Int?      // Retry attempt number (for deferred events)
  smtpId       String?   // SMTP transaction ID
  templateId   String?   // SendGrid template ID
  customArgs   Json?     // Custom arguments as JSON
}
```

### EmailLogStatus Enum

**New Values Added:**

```prisma
enum EmailLogStatus {
  success
  failed
  bounced
  pending
  processed  // NEW: SendGrid accepted and queued the email
  deferred   // NEW: Temporary failure, retrying
  delivered
  blocked
  dropped
  spamreport
}
```

---

## API Endpoints

### 1. Webhook Endpoint (SendGrid → Your Server)

**POST** `/emails/webhooks/sendgrid`

**Headers:**
- `x-twilio-email-event-webhook-signature` - ECDSA signature
- `x-twilio-email-event-webhook-timestamp` - Timestamp

**Body:** Array of webhook events

**Response:**
```json
{
  "success": true,
  "processed": 5,
  "errors": 0,
  "total": 5,
  "processingTimeMs": 123
}
```

### 2. Bounce Statistics

**GET** `/emails/webhooks/bounces/:clientId`

**Response:**
```json
{
  "success": true,
  "message": "Bounce statistics retrieved",
  "data": {
    "total": 1000,
    "bounced": 20,
    "blocked": 5,
    "dropped": 10,
    "spamreport": 2,
    "bounceRate": 2.0
  }
}
```

### 3. Routing Statistics

**GET** `/emails/webhooks/routing/stats`

**Response:**
```json
{
  "success": true,
  "data": {
    "registeredHandlers": 0,
    "externalWebhooks": 2,
    "handlerNames": []
  }
}
```

---

## What's Next

### 🔄 Immediate Improvements (Recommended)

1. **Redis for Deduplication**
   - **Current:** In-memory Set (lost on restart)
   - **Upgrade:** Use Redis with TTL (24 hours)
   - **Benefit:** Persistent across restarts, shared across instances

2. **Event Logging Table**
   - **Create:** `EmailWebhookEvent` table
   - **Store:** Full event payload, `sg_event_id`, timestamps
   - **Benefit:** Audit trail, debugging, analytics

3. **Analytics Service**
   - **Metrics to Calculate:**
     - Delivery rate: `delivered / processed`
     - Bounce rate: `bounced / processed`
     - Spam rate: `spamreport / delivered`
     - Open rate: `opens / delivered`
     - Click rate: `clicks / delivered`
     - Click-to-open rate: `clicks / opens`
     - Unsubscribe rate: `unsubscribe / delivered`
   - **Per-template performance**
   - **Per-campaign analytics**

4. **Error Handling & Retry Logic**
   - **Queue failed webhook processing**
   - **Retry mechanism for failed events**
   - **Dead letter queue for persistent failures**

### 🚀 Future Enhancements

1. **Rate Limiting**
   - **Protect webhook endpoint from abuse**
   - **Throttle based on IP or signature**

2. **Webhook Event Replay**
   - **API to replay events for testing**
   - **Manual event injection for debugging**

3. **Real-time Notifications**
   - **WebSocket notifications for critical events**
   - **Email alerts for high bounce/spam rates**

4. **Advanced Analytics**
   - **Time-series data for trends**
   - **Geographic analysis (if IP data available)**
   - **Domain-level performance metrics**

5. **Group Unsubscribe Support**
   - **Handle `group_unsubscribe` events**
   - **Handle `group_resubscribe` events**
   - **Category-based subscription management**

6. **Template Performance Dashboard**
   - **Track performance by template ID**
   - **A/B testing results**
   - **Template optimization recommendations**

7. **Automated Actions**
   - **Auto-suppress hard bounces**
   - **Auto-remove spam complainers**
   - **Auto-retry deferred emails (if needed)**

8. **Webhook Testing Tools**
   - **Webhook simulator endpoint**
   - **Test event generator**
   - **Signature verification tester**

---

## Troubleshooting

### Issue: Fields are NULL in database

**Cause:** Events haven't been received yet or webhook not configured

**Solution:**
1. Verify SendGrid webhook is enabled
2. Check webhook URL is correct
3. Send a test email and wait for webhook events
4. Check server logs for webhook requests

### Issue: Signature verification failing

**Cause:** Missing or incorrect verification key

**Solution:**
1. Get verification key from SendGrid dashboard
2. Add to `.env` as `SENDGRID_WEBHOOK_VERIFICATION_KEY`
3. Restart server
4. Check logs for signature errors

### Issue: Duplicate events being processed

**Cause:** Deduplication not working or `sg_event_id` missing

**Solution:**
1. Check if `sg_event_id` is present in events
2. Verify deduplication interceptor is registered
3. Consider upgrading to Redis for persistence

### Issue: Events not reaching secondary webhooks

**Cause:** URLs incorrect or network issues

**Solution:**
1. Verify `SENDGRID_SECONDARY_WEBHOOK_URLS` format (comma-separated)
2. Check secondary webhook endpoints are accessible
3. Review logs for forwarding errors

### Issue: Migration not applied

**Cause:** Migration not deployed to database

**Solution:**
```bash
# Check migration status
npx prisma migrate status

# Apply pending migrations
npx prisma migrate deploy

# Verify in Supabase
# Check EmailLog table structure
```

---

## Testing

### Manual Testing

1. **Send Test Email:**
   ```bash
   # Use your email sending endpoint
   POST /emails/send-draft
   ```

2. **Check Webhook Events:**
   - Monitor server logs for webhook requests
   - Check database for updated EmailLog records
   - Verify timestamps are set correctly

3. **Test Signature Verification:**
   ```bash
   # Send test webhook with invalid signature
   # Should return 401 Unauthorized
   ```

### Webhook Simulator

SendGrid provides a webhook testing tool:
1. Go to SendGrid Dashboard → Settings → Mail Settings → Event Webhook
2. Click "Test Your Integration"
3. Send test events to your webhook

### Analytics Verification

1. Hit the new protected endpoints to ensure aggregation works:
   - `GET /emails/analytics/overview`
   - `GET /emails/analytics/timeline`
   - `GET /emails/analytics/events`
2. Confirm responses contain counts for requests, delivered, opened, clicked, bounced, spam reports, and unsubscribes.
3. Load `/dashboard/analytics` (frontend) to visualize the metrics; compare totals against raw responses.
4. Trigger sample webhook events (processed, delivered, open, click, bounce) and refresh the dashboard to verify charts and tables update.

---

## Performance Considerations

### Current Implementation

- **Deduplication:** In-memory Set (10,000 event limit)
- **Processing:** Synchronous for primary handler
- **Routing:** Asynchronous for secondary handlers
- **Response Time:** < 5 seconds (SendGrid requirement)

### Optimization Opportunities

1. **Batch Processing:** Process multiple events in parallel
2. **Database Indexing:** Add indexes on frequently queried fields
3. **Caching:** Cache EmailLog lookups by messageId
4. **Queue System:** Use message queue for high-volume processing

---

## Security

### Implemented

✅ **Signature Verification** - ECDSA signature validation
✅ **HTTPS Only** - Webhook URL uses HTTPS
✅ **Error Handling** - No sensitive data in error responses

### Recommendations

- **Rate Limiting:** Add rate limiting to webhook endpoint
- **IP Whitelisting:** Whitelist SendGrid IPs (optional)
- **Monitoring:** Alert on signature verification failures
- **Audit Logging:** Log all webhook requests for security audit

---

## Support & Resources

- **SendGrid Webhook Docs:** https://docs.sendgrid.com/for-developers/tracking-events/event
- **SendGrid Event Types:** https://docs.sendgrid.com/for-developers/tracking-events/event#event-types
- **Signature Verification:** https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features

---

## Changelog

### 2025-11-10 - Initial Implementation
- ✅ Signature verification guard
- ✅ Event deduplication interceptor
- ✅ Webhook router service
- ✅ Processed and deferred event handlers
- ✅ Database schema updates
- ✅ Multi-handler routing support

---

**Last Updated:** November 10, 2025
**Status:** Production Ready ✅

