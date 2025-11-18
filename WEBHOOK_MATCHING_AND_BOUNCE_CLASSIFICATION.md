# Webhook Matching and Bounce Classification Implementation

## Table of Contents
1. [Introduction](#introduction)
2. [Webhook Matching Solution](#webhook-matching-solution)
3. [Bounce Classification Solution](#bounce-classification-solution)
4. [Implementation Details](#implementation-details)
5. [Troubleshooting](#troubleshooting)

---

## Introduction

### Problem Overview

This document describes two critical improvements to the email automation system:

1. **Webhook Matching Failure**: SendGrid webhook events were not successfully matching EmailLog records, preventing status updates
2. **Bounce Classification Missing**: All bounces were stored identically without differentiation between hard (permanent) and soft (temporary) failures

### Root Causes

**Issue 1: Message ID Format Mismatch**
- SendGrid API returns `x-message-id` in short format: `"Two5w9mlTWaW-qmilGnxow"`
- SendGrid webhooks send `sg_message_id` in long format with routing metadata: `"_uqFxG90R7q-ua3qIFZN_w.recvd-7748d67658-v57f1-1-691BB5B8-1.0"`
- These formats don't match, causing lookup failures

**Issue 2: Bounce Type Unknown**
- All bounces stored with same status: `'bounced'`
- No way to distinguish permanent failures (remove from list) from temporary failures (may retry)
- Analytics cannot calculate separate hard/soft bounce rates

---

## Webhook Matching Solution

### Theory: Why Custom Arguments Work

SendGrid's custom arguments feature allows you to attach metadata to emails that gets echoed back in all webhook events. This provides a reliable way to match webhook events to database records regardless of messageId format changes.

**Key Principles:**
- Custom arguments are included in the email payload when sending
- SendGrid automatically includes these arguments in ALL webhook events (processed, delivered, bounce, open, click, etc.)
- The arguments are sent as strings, so we use `emailLogId` (database primary key) for direct lookup
- This approach is more reliable than messageId matching because we control the identifier

### Architecture: Multi-Strategy Matching

The system implements a cascading fallback strategy to ensure maximum reliability:

**Strategy 1 (Primary): EmailLog ID from Custom Args**
- Match by `custom_args.emailLogId` → `EmailLog.id`
- Most reliable: Direct primary key lookup
- Works regardless of messageId format changes
- Requires EmailLog to be created before sending email

**Strategy 2 (Fallback): Exact Message ID Match**
- Match by `sg_message_id` → `EmailLog.messageId`
- For backward compatibility with existing records
- Works when custom args are missing

**Strategy 3 (Fallback): Base Message ID**
- Extract part before first dot from `sg_message_id`
- Handles cases where routing info is appended
- Format: `"baseId.recvd-..."` → `"baseId"`

**Strategy 4 (Last Resort): Email + Timestamp Window**
- Match by recipient email address + 24-hour time window
- Only matches pending emails to avoid false positives
- Used when all other strategies fail

### Flow Diagram: Email Send → Webhook → Matching

```
1. Email Sending Flow:
   ┌─────────────────┐
   │ Create EmailLog │  ← Create FIRST with temp messageId
   │ (id: 123)       │
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │ Send to SendGrid│  ← Include customArgs: { emailLogId: "123" }
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │ Update EmailLog │  ← Replace temp messageId with actual x-message-id
   │ (messageId: ...)│
   └─────────────────┘

2. Webhook Event Flow:
   ┌─────────────────┐
   │ SendGrid Event  │  ← Contains: sg_message_id, custom_args: { emailLogId: "123" }
   └────────┬────────┘
            │
            ▼
   ┌─────────────────┐
   │ Strategy 1:     │  ← Match by custom_args.emailLogId → EmailLog.id = 123
   │ emailLogId      │     ✅ SUCCESS
   └─────────────────┘
            │
            ▼
   ┌─────────────────┐
   │ Update Status   │  ← Update EmailLog.status based on event type
   └─────────────────┘
```

### Schema Explanation: EmailLog Fields Used

**Primary Matching Field:**
- `id` (Int, Primary Key): Used for direct lookup via `custom_args.emailLogId`

**Fallback Matching Fields:**
- `messageId` (String, Unique): Stores SendGrid's `x-message-id` from API response
- `contact.email` (String): Used for email + timestamp matching
- `sentAt` (DateTime): Used for timestamp window matching
- `status` (EmailLogStatus): Used to filter pending emails in fallback strategy

**Important Note:**
- `trackingPixelToken` is NOT used for webhook matching
- `trackingPixelToken` is reserved for 1x1 pixel image tracking (email opens)
- Using it for webhook matching would conflict with its primary purpose

### Technical Implementation

**Email Sending Order:**
1. Create EmailLog with temporary messageId: `temp_${Date.now()}`
2. Send email with `customArgs: { emailLogId: emailLog.id.toString() }`
3. Update EmailLog with actual messageId from SendGrid response

**Webhook Processing:**
1. Extract `emailLogId` from `event.custom_args.emailLogId`
2. Parse to integer and lookup `EmailLog.findUnique({ where: { id: emailLogId } })`
3. If not found, try fallback strategies in order
4. Log which strategy successfully matched for debugging

---

## Bounce Classification Solution

### Theory: Hard vs Soft Bounce Concepts

**Hard Bounces (Permanent Failures):**
- Email address doesn't exist or is invalid
- Domain doesn't exist
- Recipient server permanently rejected the email
- **Action**: Remove from mailing list, mark contact as bounced
- **Impact**: High - affects sender reputation if not handled

**Soft Bounces (Temporary Failures):**
- Mailbox full
- Message too large
- Server temporarily unavailable
- Rate limiting or greylisting
- **Action**: Log for monitoring, may retry later
- **Impact**: Medium - usually resolves itself, but monitor patterns

### SendGrid Classification Codes Reference

SendGrid provides a `bounce_classification` field in webhook events:

**Hard Bounce Codes:**
- `"1"`: Invalid email address (doesn't exist)
- `"10"`: Blocked by recipient server
- `"11"`: Bounce due to reputation issues
- `"13"`: Invalid sender domain

**Soft Bounce Codes:**
- `"2"`: Mailbox full
- `"3"`: Message too large
- `"4"`: Content rejected (may be temporary)
- `"5"`: Mail server temporarily unavailable
- `"6"`: Domain not found (may be temporary DNS issue)
- `"7"`: Failed to connect to recipient server
- `"8"`: Greylisted (temporary)
- `"9"`: Rate limiting (temporary)

### Architecture: Status vs ProviderResponse Separation

**Design Decision:**
- Both hard and soft bounces use `status = 'bounced'` (final outcome)
- Classification details stored in `providerResponse` JSON field (metadata)

**Rationale:**
- Status field represents the final outcome (bounced)
- ProviderResponse stores detailed metadata for analytics
- Allows querying all bounces, then filtering by type
- No schema changes needed (uses existing JSON field)

### Schema Explanation: ProviderResponse Structure

**EmailLog Schema:**
```prisma
model EmailLog {
  status           EmailLogStatus  // 'bounced' for both hard and soft
  providerResponse Json?           // Stores bounce classification details
  // ... other fields
}
```

**ProviderResponse Structure for Bounces:**
```json
{
  "bounce": {
    "type": "hard" | "soft",
    "classification": "1" | "2" | "10" | etc.,
    "reason": "550 5.1.1 User unknown",
    "timestamp": "2025-01-18T10:30:00.000Z"
  }
}
```

**Query Patterns:**
- All bounces: `WHERE status = 'bounced'`
- Hard bounces: `WHERE status = 'bounced' AND providerResponse->>'bounce'->>'type' = 'hard'`
- Soft bounces: `WHERE status = 'bounced' AND providerResponse->>'bounce'->>'type' = 'soft'`

### Analytics Query Patterns

**Counting Bounces:**
1. Query EmailLogs with `status = 'bounced'` and include `providerResponse`
2. Filter by `providerResponse.bounce.type`:
   - `'hard'` → Hard bounce count
   - `'soft'` → Soft bounce count
3. Calculate rates:
   - `hardBounceRate = (hardBounces / totalRequests) * 100`
   - `softBounceRate = (softBounces / totalRequests) * 100`

**Performance Considerations:**
- Filter by status first (indexed column)
- Parse JSON only for bounced records (small subset)
- Minimal performance overhead

### Contact Status Update Logic

**Hard Bounces:**
- Update `Contact.status = 'bounced'`
- Remove from future email sends
- Prevents sending to invalid addresses

**Soft Bounces:**
- Do NOT update contact status
- Log for monitoring
- May retry sending later if conditions improve

---

## Implementation Details

### EmailLog Creation Order

**Before (Problematic):**
```
1. Send email → Get messageId
2. Create EmailLog with messageId
3. Webhook arrives → Can't match (messageId format mismatch)
```

**After (Fixed):**
```
1. Create EmailLog FIRST with temp messageId
2. Send email with emailLogId in customArgs
3. Update EmailLog with actual messageId
4. Webhook arrives → Matches by emailLogId ✅
```

### Custom Args Format

**SendGrid Message Payload:**
```typescript
{
  to: "recipient@example.com",
  from: "sender@example.com",
  subject: "Subject",
  html: "...",
  customArgs: {
    emailLogId: "123"  // String representation of EmailLog.id
  }
}
```

**Webhook Event:**
```json
{
  "event": "delivered",
  "sg_message_id": "_uqFxG90R7q-ua3qIFZN_w.recvd-...",
  "custom_args": {
    "emailLogId": "123"  // Echoed back by SendGrid
  },
  "email": "recipient@example.com",
  "timestamp": 1734567890
}
```

### Bounce Classification Logic

**Classification Function:**
```typescript
classifyBounceType(classification: string): 'hard' | 'soft'
  - Hard codes: ['1', '10', '11', '13']
  - Soft codes: ['2', '3', '4', '5', '6', '7', '8', '9']
  - Default: 'hard' (fail-safe)
```

**Storage:**
- Store in `providerResponse.bounce` object
- Preserve existing providerResponse data (merge, don't replace)
- Include classification code, reason, and timestamp

### Technical Decisions and Rationale

**Why emailLogId instead of trackingPixelToken?**
- `trackingPixelToken` is used for 1x1 pixel image tracking (email opens)
- Using it for webhook matching would create confusion and potential conflicts
- `emailLogId` is a direct database primary key, more reliable

**Why create EmailLog before sending?**
- Ensures we have the ID before sending
- Prevents race conditions
- Allows webhook to match immediately upon arrival

**Why store bounce type in providerResponse?**
- No schema migration needed
- Flexible JSON structure allows future enhancements
- Separates outcome (status) from metadata (providerResponse)

**Why multiple matching strategies?**
- Ensures backward compatibility with existing records
- Handles edge cases (missing custom args, format changes)
- Provides fallback options for reliability

---

## Troubleshooting

### Common Issues and Solutions

**Issue: "EmailLog not found" warnings in logs**

**Possible Causes:**
1. Custom args not included in email (check sendEmail call)
2. EmailLog created after sending (wrong order)
3. Webhook event missing custom_args (SendGrid issue)

**Solutions:**
1. Verify `emailLogId` is passed to `sendEmail()` options
2. Ensure EmailLog is created BEFORE sending
3. Check SendGrid webhook configuration
4. Review logs to see which matching strategy was attempted

**Issue: Bounce classification not stored**

**Possible Causes:**
1. `bounce_classification` missing from webhook event
2. `providerResponse` not being merged correctly
3. Classification function not called

**Solutions:**
1. Check webhook event payload in logs
2. Verify `handleBounce()` is storing bounce details
3. Ensure existing providerResponse is preserved (merge, don't replace)

**Issue: Analytics showing 0 hard/soft bounces**

**Possible Causes:**
1. `providerResponse` not included in query
2. Bounce classification not stored correctly
3. Date range doesn't include bounced emails

**Solutions:**
1. Verify `providerResponse` is selected in EmailLog queries
2. Check database: `SELECT providerResponse FROM "EmailLog" WHERE status = 'bounced'`
3. Verify bounce events are being processed correctly

**Issue: Webhook matching still failing**

**Debugging Steps:**
1. Check logs for which matching strategy was attempted
2. Verify custom_args in webhook event: `event.custom_args.emailLogId`
3. Check EmailLog exists: `SELECT id, messageId FROM "EmailLog" WHERE id = ?`
4. Verify messageId format matches expected pattern

**Issue: Hard bounces not updating contact status**

**Possible Causes:**
1. Classification function returning wrong type
2. Contact update query failing
3. Hard bounce codes not matching

**Solutions:**
1. Check `classifyBounceType()` logic
2. Verify bounce_classification value in webhook event
3. Check contact update query in logs

---

## Summary

### Webhook Matching
- **Solution**: Use `emailLogId` in SendGrid custom args
- **Implementation**: Create EmailLog first, include ID in custom args, update messageId after sending
- **Matching**: Multi-strategy approach with emailLogId as primary, messageId and email+timestamp as fallbacks

### Bounce Classification
- **Solution**: Store classification in `providerResponse.bounce` object
- **Implementation**: Classify based on SendGrid `bounce_classification` codes
- **Analytics**: Query by status, filter by bounce type from providerResponse

### Benefits
- ✅ Reliable webhook matching regardless of messageId format
- ✅ Separate hard/soft bounce tracking for analytics
- ✅ Better decision-making (remove hard bounces, retry soft bounces)
- ✅ No schema changes required
- ✅ Backward compatible with existing records

