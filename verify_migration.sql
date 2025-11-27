-- ============================================
-- VERIFICATION QUERIES FOR SUPABASE
-- Run these in Supabase SQL Editor
-- ============================================

-- 1. Check if migrations were applied
SELECT 
  migration_name,
  applied_steps_count,
  started_at,
  finished_at
FROM "_prisma_migrations"
WHERE migration_name LIKE '%client_id%' OR migration_name LIKE '%backfill%'
ORDER BY started_at DESC;

-- 2. Check EmailDraft clientId backfill status
SELECT 
  COUNT(*) as total_drafts,
  COUNT("clientId") as drafts_with_client_id,
  COUNT(*) - COUNT("clientId") as drafts_with_null_client_id,
  COUNT("clientEmailId") as drafts_with_client_email_id,
  COUNT(*) - COUNT("clientEmailId") as drafts_with_null_client_email_id
FROM "EmailDraft";

-- 3. Check SmsDraft clientId backfill status
SELECT 
  COUNT(*) as total_drafts,
  COUNT("clientId") as drafts_with_client_id,
  COUNT(*) - COUNT("clientId") as drafts_with_null_client_id
FROM "SmsDraft";

-- 4. Check column constraints (is_nullable status)
SELECT 
  table_name,
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name IN ('EmailDraft', 'SmsDraft')
  AND column_name IN ('clientId', 'clientEmailId', 'clientSmsId')
ORDER BY table_name, column_name;

-- 5. Sample EmailDraft records to verify data
SELECT 
  id,
  "clientId",
  "clientEmailId",
  "contactId",
  status
FROM "EmailDraft"
ORDER BY id DESC
LIMIT 10;

-- 6. Find any orphaned EmailDraft records (no clientId after backfill)
SELECT 
  ed.id,
  ed."clientId",
  ed."clientEmailId",
  ed."contactId",
  CASE 
    WHEN ed."clientEmailId" IS NOT NULL THEN 'Has clientEmailId but no clientId'
    WHEN ed."contactId" IS NOT NULL THEN 'Has contactId but no clientId'
    ELSE 'No relationships'
  END as issue
FROM "EmailDraft" ed
WHERE ed."clientId" IS NULL;

-- 7. Find any orphaned SmsDraft records
SELECT 
  sd.id,
  sd."clientId",
  sd."clientSmsId",
  sd."contactId",
  CASE 
    WHEN sd."contactId" IS NOT NULL THEN 'Has contactId but no clientId'
    ELSE 'No relationships'
  END as issue
FROM "SmsDraft" sd
WHERE sd."clientId" IS NULL;

