-- Backfill clientId in EmailDraft from clientEmail relation (for drafts with valid clientEmailId)
UPDATE "EmailDraft" ed
SET "clientId" = ce."clientId"
FROM "ClientEmail" ce
WHERE ed."clientEmailId" = ce.id
  AND ed."clientId" IS NULL;

-- Backfill clientId in EmailDraft from contact -> csvUpload -> client (fallback for orphaned/missing clientEmailId)
UPDATE "EmailDraft" ed
SET "clientId" = cu."clientId"
FROM "Contact" ct
JOIN "CsvUpload" cu ON ct."csvUploadId" = cu.id
WHERE ed."contactId" = ct.id
  AND ed."clientId" IS NULL;

-- Backfill clientId in SmsDraft from contact -> csvUpload -> client
UPDATE "SmsDraft" sd
SET "clientId" = cu."clientId"
FROM "Contact" ct
JOIN "CsvUpload" cu ON ct."csvUploadId" = cu.id
WHERE sd."contactId" = ct.id
  AND sd."clientId" IS NULL;

