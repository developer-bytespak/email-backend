-- Step 1: Add new columns as nullable first
ALTER TABLE "SenderVerification" 
  ADD COLUMN "clientId" INTEGER,
  ADD COLUMN "emailAddress" TEXT,
  ADD COLUMN "phoneNumber" TEXT;

-- Step 2: Backfill clientId from existing ClientEmail or ClientSms records
UPDATE "SenderVerification" sv
SET "clientId" = COALESCE(
  (SELECT ce."clientId" FROM "ClientEmail" ce WHERE ce."id" = sv."clientEmailId"),
  (SELECT cs."clientId" FROM "ClientSms" cs WHERE cs."id" = sv."clientSmsId")
)
WHERE sv."clientId" IS NULL;

-- Step 3: Backfill emailAddress and phoneNumber from related records
UPDATE "SenderVerification" sv
SET "emailAddress" = ce."emailAddress"
FROM "ClientEmail" ce
WHERE sv."clientEmailId" = ce."id" AND sv."emailAddress" IS NULL;

UPDATE "SenderVerification" sv
SET "phoneNumber" = cs."phoneNumber"
FROM "ClientSms" cs
WHERE sv."clientSmsId" = cs."id" AND sv."phoneNumber" IS NULL;

-- Step 4: Make clientId NOT NULL (orphaned records have been manually removed)
ALTER TABLE "SenderVerification" ALTER COLUMN "clientId" SET NOT NULL;

-- Step 5: Create indexes
CREATE INDEX "SenderVerification_clientId_emailAddress_status_idx" ON "SenderVerification"("clientId", "emailAddress", "status");
CREATE INDEX "SenderVerification_clientId_phoneNumber_status_idx" ON "SenderVerification"("clientId", "phoneNumber", "status");

-- Step 6: Add foreign key constraint
ALTER TABLE "SenderVerification" ADD CONSTRAINT "SenderVerification_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
