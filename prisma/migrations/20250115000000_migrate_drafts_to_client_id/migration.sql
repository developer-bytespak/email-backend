-- Step 1: Backfill clientId in EmailDraft from clientEmail relation (for drafts with valid clientEmailId)
UPDATE "EmailDraft" ed
SET "clientId" = ce."clientId"
FROM "ClientEmail" ce
WHERE ed."clientEmailId" = ce.id
  AND ed."clientId" IS NULL;

-- Step 2: Backfill clientId in EmailDraft from contact -> csvUpload -> client (fallback for orphaned/missing clientEmailId)
UPDATE "EmailDraft" ed
SET "clientId" = cu."clientId"
FROM "Contact" ct
JOIN "CsvUpload" cu ON ct."csvUploadId" = cu.id
WHERE ed."contactId" = ct.id
  AND ed."clientId" IS NULL;

-- Step 3: Backfill clientId in SmsDraft from contact -> csvUpload -> client
UPDATE "SmsDraft" sd
SET "clientId" = cu."clientId"
FROM "Contact" ct
JOIN "CsvUpload" cu ON ct."csvUploadId" = cu.id
WHERE sd."contactId" = ct.id
  AND sd."clientId" IS NULL;

-- Step 4: Check for remaining NULLs and provide helpful error if any exist
DO $$
DECLARE
  email_null_count INTEGER;
  sms_null_count INTEGER;
  email_orphaned_ids INTEGER[];
  sms_orphaned_ids INTEGER[];
BEGIN
  SELECT COUNT(*) INTO email_null_count FROM "EmailDraft" WHERE "clientId" IS NULL;
  SELECT COUNT(*) INTO sms_null_count FROM "SmsDraft" WHERE "clientId" IS NULL;
  
  IF email_null_count > 0 OR sms_null_count > 0 THEN
    -- Get IDs of orphaned records for debugging
    SELECT ARRAY_AGG(id) INTO email_orphaned_ids FROM "EmailDraft" WHERE "clientId" IS NULL;
    SELECT ARRAY_AGG(id) INTO sms_orphaned_ids FROM "SmsDraft" WHERE "clientId" IS NULL;
    
    RAISE EXCEPTION 
      'Migration cannot proceed: % EmailDraft and % SmsDraft records still have NULL clientId. '
      'EmailDraft IDs: %. SmsDraft IDs: %. '
      'Please run the backfill queries manually first (see fix_backfill.sql), or delete/fix these orphaned records.',
      email_null_count, sms_null_count, email_orphaned_ids, sms_orphaned_ids;
  END IF;
END $$;

-- Step 5: Make clientId NOT NULL in EmailDraft
ALTER TABLE "EmailDraft" ALTER COLUMN "clientId" SET NOT NULL;

-- Step 6: Make clientId NOT NULL in SmsDraft
ALTER TABLE "SmsDraft" ALTER COLUMN "clientId" SET NOT NULL;

-- Step 7: Make clientEmailId nullable in EmailDraft
ALTER TABLE "EmailDraft" ALTER COLUMN "clientEmailId" DROP NOT NULL;

