# 📊 CSV Processing Guide

## Overview

The ingestion service now automatically parses uploaded CSV files and extracts specific columns.

---

## 🎯 Extracted Columns

The service extracts and maps the following columns:

| CSV Column (Flexible) | Database Field | Required |
|----------------------|----------------|----------|
| `business_name` or `businessName` | businessName | Yes |
| `state` or `stateProvince` | stateProvince | No |
| `zipcode` or `zip` | zip | No |
| `phone_number` or `phone` | phone | No |
| `website` | website | No |
| `email` | email | No |
| `country` | country | No |

**Note:** The parser accepts both snake_case and camelCase column names!

---

## 📝 CSV Format Example

```csv
business_name,state,zipcode,phone_number,website,email,country
Acme Corp,California,94102,+1-555-0100,https://acme.com,contact@acme.com,USA
TechStart Inc,New York,10001,+1-555-0101,https://techstart.io,info@techstart.io,USA
```

**OR** (camelCase headers):

```csv
businessName,stateProvince,zip,phone,website,email,country
Acme Corp,California,94102,+1-555-0100,https://acme.com,contact@acme.com,USA
```

Both formats work! 🎉

---

## 🔄 Processing Flow

```
1. Upload CSV file
   ↓
2. Create CsvUpload record (status: "Processing...")
   ↓
3. Parse CSV buffer → Extract columns
   ↓
4. Save each row as Contact in database
   ↓
5. Update CsvUpload record (status: "success")
   ↓
6. Return response with extracted data
```

---

## 📊 API Response

### Success Response:

```json
{
  "message": "CSV file uploaded and processed successfully",
  "filename": "contacts.csv",
  "size": 1234,
  "uploadId": 1,
  "totalRecords": 5,
  "successfulRecords": 5,
  "data": [
    {
      "businessName": "Acme Corp",
      "state": "California",
      "zipcode": "94102",
      "phone": "+1-555-0100",
      "website": "https://acme.com",
      "email": "contact@acme.com",
      "country": "USA"
    },
    ...
  ],
  "contacts": [
    {
      "id": 1,
      "clientId": 1,
      "csvUploadId": 1,
      "businessName": "Acme Corp",
      "email": "contact@acme.com",
      "phone": "+1-555-0100",
      "website": "https://acme.com",
      "stateProvince": "California",
      "zip": "94102",
      "country": "USA",
      "status": "new",
      "valid": false,
      "createdAt": "2025-01-21T10:30:00.000Z",
      "updatedAt": "2025-01-21T10:30:00.000Z"
    },
    ...
  ]
}
```

---

## 🗄️ Database Schema

### Contact Table:

```prisma
model Contact {
  id               Int           @id @default(autoincrement())
  csvUploadId      Int
  clientId         Int
  businessName     String        ✅ Required
  email            String?       ⭕ Optional
  phone            String?       ⭕ Optional
  website          String?       ⭕ Optional
  stateProvince    String?       ⭕ Optional
  zip              String?       ⭕ Optional
  country          String?       ⭕ Optional
  status           ContactStatus @default(new)
  valid            Boolean       @default(false)
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @default(now()) @updatedAt
}
```

---

## ✨ Features

✅ **Flexible Column Names** - Accepts snake_case or camelCase  
✅ **Auto-mapping** - Maps CSV columns to database fields  
✅ **Error Handling** - Continues processing if individual rows fail  
✅ **Database Tracking** - Stores upload metadata in CsvUpload table  
✅ **Contact Storage** - Saves all contacts to database  
✅ **Status Tracking** - Updates processing status in real-time  

---

## 🧪 Testing

### 1. Using the Frontend (http://localhost:3001)

1. Enter Client ID: `1`
2. Upload CSV file
3. View extracted data in response

### 2. Using cURL

```bash
curl -X POST http://localhost:3000/ingestion/upload \
  -F "file=@contacts.csv" \
  -F "clientId=1"
```

### 3. Sample CSV

See `email-frontend/public/sample.csv` for a test file.

---

## 🔍 Query Uploaded Data

After uploading, you can query the data:

```typescript
// Get all contacts for a CSV upload
const contacts = await prisma.contact.findMany({
  where: { csvUploadId: 1 },
});

// Get all uploads for a client
const uploads = await prisma.csvUpload.findMany({
  where: { clientId: 1 },
  include: { contacts: true },
});
```

---

## ⚠️ Error Handling

### If parsing fails:

```json
{
  "statusCode": 400,
  "message": "CSV processing failed: [error details]",
  "error": "Bad Request"
}
```

The `CsvUpload` record will be updated with `status: "failure"`.

---

## 🚀 Next Steps

After ingestion, you can:

1. ✅ **Validate contacts** - Check email/phone validity
2. ✅ **Enrich data** - Add additional business information
3. ✅ **Scrape websites** - Extract more details
4. ✅ **Generate summaries** - Create AI-powered insights
5. ✅ **Create drafts** - Generate personalized emails

---

## 📚 Code Location

**Service:** `email-backend/src/modules/ingestion/ingestion.service.ts`

**Key Methods:**
- `processCsvUpload()` - Main upload handler
- `parseCsvFile()` - CSV parsing logic
- `saveContacts()` - Database storage

---

**Happy data importing! 🎉**

