# 📊 Schema Changes Summary

## ✅ Changes Made

### 1. **CsvUpload Table**
**Added:**
- `rawData` (Json?) - Stores complete CSV data in JSON format

**Benefit:** Full CSV information preserved for reference/re-processing

---

### 2. **Contact Table**
**Removed:**
- `clientId` - No longer needed (access via `csvUpload.clientId`)
- `stateProvince` - Not essential, available in rawData
- `zip` - Not essential, available in rawData
- `country` - Not essential, available in rawData

**Kept (Essential Fields Only):**
- ✅ `businessName` - Primary identifier
- ✅ `email` - Contact method
- ✅ `phone` - Contact method
- ✅ `website` - For scraping
- ✅ `status` - Workflow tracking
- ✅ `valid` - Validation flag

**Benefit:** Cleaner, focused table with only actionable fields

---

### 3. **Removed clientId from Related Tables**
- ❌ `EmailDraft.clientId` - Access via `contact.csvUpload.clientId`
- ❌ `EmailLog.clientId` - Access via `contact.csvUpload.clientId`
- ❌ `SmsDraft.clientId` - Access via `contact.csvUpload.clientId`
- ❌ `SmsLog.clientId` - Access via `contact.csvUpload.clientId`

**Benefit:** Better normalization, single source of truth

---

## 🔄 Data Flow

### Upload Process:
```
CSV File
  ↓
Parse all columns → Store in CsvUpload.rawData (JSON)
  ↓
Extract only: businessName, email, phone, website → Contact table
  ↓
Other fields available via: contact.csvUpload.rawData
```

### Example Query:
```typescript
// Get contact with full CSV data
const contact = await prisma.contact.findUnique({
  where: { id: 1 },
  include: {
    csvUpload: {
      select: {
        rawData: true,  // Full CSV info here
        client: true,    // Get client through upload
      },
    },
  },
});

// Access full data
console.log(contact.businessName);  // From Contact table
console.log(contact.csvUpload.rawData);  // All CSV columns
console.log(contact.csvUpload.client);   // Client info
```

---

## 📋 Migration Steps

### 1. Generate Migration:
```bash
cd email-backend
npx prisma migrate dev --name optimize_schema
```

### 2. What the Migration Does:
- Adds `rawData` JSON column to `CsvUpload`
- Removes `clientId` from `Contact`, `EmailDraft`, `EmailLog`, `SmsDraft`, `SmsLog`
- Removes `stateProvince`, `zip`, `country` from `Contact`
- Drops foreign key constraints for removed `clientId` fields

### 3. Data Migration (if you have existing data):
```sql
-- Existing contacts will lose state/zip/country data
-- Consider backing up first!

-- To preserve data, you could:
-- 1. Export existing contacts with full data
-- 2. Run migration
-- 3. Re-import and populate rawData field
```

---

## ⚠️ Breaking Changes

### API Responses:
**Before:**
```json
{
  "id": 1,
  "businessName": "Acme Corp",
  "email": "contact@acme.com",
  "phone": "+1-555-0100",
  "website": "https://acme.com",
  "stateProvince": "California",
  "zip": "94102",
  "country": "USA",
  "clientId": 1
}
```

**After:**
```json
{
  "id": 1,
  "businessName": "Acme Corp",
  "email": "contact@acme.com",
  "phone": "+1-555-0100",
  "website": "https://acme.com"
}
```

**To get full data:**
```json
{
  "id": 1,
  "businessName": "Acme Corp",
  "email": "contact@acme.com",
  "csvUpload": {
    "rawData": [
      {
        "business_name": "Acme Corp",
        "state": "California",
        "zipcode": "94102",
        "country": "USA",
        // ... all other CSV columns
      }
    ]
  }
}
```

---

## ✨ Benefits

### 1. **Better Organization**
- Contact table: Only essential, actionable fields
- CsvUpload: Complete historical data preserved

### 2. **Flexibility**
- CSV can have ANY columns
- They're all saved in rawData
- Extract what you need later

### 3. **Data Integrity**
- Single source of truth for clientId
- No redundant data
- Easier to maintain

### 4. **Performance**
- Smaller Contact table
- Faster queries on essential fields
- JSON field indexed separately if needed

---

## 🎯 Use Cases

### For Scraping:
```typescript
// Only need website from Contact
const contacts = await prisma.contact.findMany({
  where: { status: 'new' },
  select: { id: true, website: true },
});
```

### For Email Generation:
```typescript
// Get contact + full CSV context
const contact = await prisma.contact.findUnique({
  where: { id: 1 },
  include: {
    csvUpload: { select: { rawData: true } },
  },
});

// Use full context for AI
const fullData = contact.csvUpload.rawData;
// Has state, industry, company size, etc.
```

### For Analytics:
```typescript
// Query rawData JSON field
const uploads = await prisma.csvUpload.findMany({
  where: {
    rawData: {
      path: ['$[*].state'],
      equals: 'California',
    },
  },
});
```

---

**Ready to migrate!** 🚀

