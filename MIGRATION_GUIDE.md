# 🔄 Migration Guide - Enhanced Validation

## ⚠️ Important: Run Migration First!

Before starting the server, you MUST run the Prisma migration to update the database schema.

---

## 🚀 Migration Steps:

### **1. Generate Migration:**
```bash
cd email-backend
npx prisma migrate dev --name enhanced_validation
```

This will:
- Add new fields to `Contact` table
- Add `ScrapeMethod` enum
- Update `ContactStatus` enum with new statuses

### **2. Generate Prisma Client:**
```bash
npx prisma generate
```

### **3. Restart Server:**
```bash
npm run dev
```

---

## 📊 Schema Changes Applied:

### **Contact Table - New Fields:**
```prisma
state               String?       // State/Province
zipCode             String?       // ZIP/Postal code
businessNameValid   Boolean       // Is business name valid?
emailValid          Boolean       // Is email valid?
websiteValid        Boolean       // Is website valid?
scrapeMethod        ScrapeMethod? // Which scraping method to use
scrapePriority      Int?          // Priority order (1-3)
```

### **New Enums:**

**ScrapeMethod:**
- `direct_url` - Website URL exists and accessible
- `email_domain` - Use email domain to find website
- `business_search` - Use business name + location to search

**ContactStatus (Updated):**
- `new` - Just uploaded
- `validated` - Validation complete
- `ready_to_scrape` - Ready for scraping
- `scraping` - Currently being scraped
- `scraped` - Scraping complete
- `scrape_failed` - Scraping failed
- `summarized` - AI summary generated
- `drafted` - Email/SMS drafted
- `sent` - Communication sent
- `opened` - Email opened
- `bounced` - Email bounced

---

## ✨ New Validation Logic:

### **Free Email Detection:**
Emails from these providers are flagged as "free" and won't be used for domain search:
- gmail.com
- yahoo.com
- hotmail.com
- outlook.com
- live.com
- aol.com
- icloud.com
- mail.com
- protonmail.com
- zoho.com
- yandex.com
- gmx.com

### **Validation Priority:**
1. **Website URL** → If valid, use `direct_url` (Priority 1)
2. **Business Email** → If valid AND not free provider, use `email_domain` (Priority 2)
3. **Business Name** → Always available as fallback, use `business_search` (Priority 3)

### **Contact Validity:**
Contact is VALID if **ANY ONE** of these is true:
- ✅ Website URL is accessible
- ✅ Email is valid (format + MX records)
- ✅ Business Name exists (length > 2)

---

## 📝 Example Validation Results:

### **Scenario 1: Website + Business Email**
```json
{
  "businessName": "Tech Corp",
  "email": "info@techcorp.com",
  "website": "https://techcorp.com",
  
  "websiteValid": true,
  "emailValid": true,
  "businessNameValid": true,
  
  "valid": true,
  "scrapeMethod": "direct_url",
  "scrapePriority": 1,
  "status": "ready_to_scrape",
  "validationReason": "Valid: website (accessible), email (valid domain), business name"
}
```

### **Scenario 2: Gmail Email (Free Provider)**
```json
{
  "businessName": "Local Shop",
  "email": "owner@gmail.com",
  "website": null,
  
  "websiteValid": false,
  "emailValid": true,
  "businessNameValid": true,
  
  "valid": true,
  "scrapeMethod": "business_search",  // Skipped email_domain!
  "scrapePriority": 3,
  "status": "ready_to_scrape",
  "validationReason": "Valid: email (valid but free provider - using business name for search), business name. Invalid: website (404/unreachable)"
}
```

### **Scenario 3: Business Email Only**
```json
{
  "businessName": "Consulting LLC",
  "email": "contact@consultingllc.com",
  "website": null,
  
  "websiteValid": false,
  "emailValid": true,
  "businessNameValid": true,
  
  "valid": true,
  "scrapeMethod": "email_domain",  // Will search consultingllc.com
  "scrapePriority": 2,
  "status": "ready_to_scrape",
  "validationReason": "Valid: email (valid domain), business name"
}
```

---

## 🔍 Query Examples:

### **Get contacts ready for direct scraping:**
```typescript
const directScrape = await prisma.contact.findMany({
  where: {
    valid: true,
    scrapeMethod: 'direct_url',
    status: 'ready_to_scrape',
  }
});
```

### **Get contacts by priority:**
```typescript
const orderedContacts = await prisma.contact.findMany({
  where: {
    valid: true,
    status: 'ready_to_scrape',
  },
  orderBy: {
    scrapePriority: 'asc', // 1, 2, 3
  }
});
```

### **Get statistics:**
```typescript
const stats = await prisma.contact.groupBy({
  by: ['scrapeMethod', 'valid'],
  _count: true,
  where: { csvUploadId: 1 },
});
// Result: How many contacts for each method
```

---

## ⚠️ Breaking Changes:

### **ContactStatus Changes:**
Old statuses removed:
- ~~`enriched`~~ → use `validated`
- ~~`emailed`~~ → use `sent`

New statuses added:
- `validated`, `ready_to_scrape`, `scraping`, `scrape_failed`, `drafted`, `opened`, `bounced`

### **Contact Fields:**
If you had existing code querying contacts, update to handle new fields:
```typescript
// Before
const contact = await prisma.contact.findMany({ where: { valid: true } });

// After (unchanged, but now has more fields)
const contact = await prisma.contact.findMany({
  where: {
    valid: true,
    status: 'ready_to_scrape',  // More specific
  },
  select: {
    scrapeMethod: true,  // New field
    scrapePriority: true,  // New field
  }
});
```

---

## ✅ What To Test:

1. **Upload CSV** with various scenarios:
   - Website + Gmail email
   - Website + Business email
   - No website + Business email
   - No website + Gmail email
   - Only business name

2. **Check validation results:**
   - Query contacts after upload
   - Verify `scrapeMethod` is set correctly
   - Verify Gmail emails use `business_search`

3. **Verify status flow:**
   - `new` → `ready_to_scrape` after validation

---

## 🐛 Troubleshooting:

### **Migration fails?**
```bash
# Reset database (WARNING: Deletes all data!)
npx prisma migrate reset

# Or manually fix conflicts
npx prisma migrate resolve --applied <migration_name>
```

### **Prisma Client errors?**
```bash
# Regenerate client
npx prisma generate

# Clear node_modules
rm -rf node_modules
npm install
```

### **TypeScript errors?**
```bash
# Restart TypeScript server in VS Code
Ctrl+Shift+P → "TypeScript: Restart TS Server"
```

---

**After migration, test with a CSV upload to see the enhanced validation in action!** 🚀

