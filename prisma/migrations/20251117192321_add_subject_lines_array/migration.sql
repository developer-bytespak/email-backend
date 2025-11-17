/*
  Warnings:

  - You are about to drop the column `subjectLine` on the `EmailDraft` table. All the data in the column will be lost.

*/
-- Step 1: Add new column (nullable initially)
ALTER TABLE "EmailDraft" ADD COLUMN "subjectLines" TEXT[];

-- Step 2: Migrate existing data (convert single subjectLine to array)
UPDATE "EmailDraft" 
SET "subjectLines" = ARRAY["subjectLine"] 
WHERE "subjectLine" IS NOT NULL AND "subjectLine" != '';

-- Step 3: Handle null/empty cases (set to empty array)
UPDATE "EmailDraft" 
SET "subjectLines" = ARRAY[]::TEXT[] 
WHERE "subjectLines" IS NULL;

-- Step 4: Make the new column NOT NULL (after data migration)
ALTER TABLE "EmailDraft" ALTER COLUMN "subjectLines" SET NOT NULL;

-- Step 5: Drop the old column
ALTER TABLE "EmailDraft" DROP COLUMN "subjectLine";
