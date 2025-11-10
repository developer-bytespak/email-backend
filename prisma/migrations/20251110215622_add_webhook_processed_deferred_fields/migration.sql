-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailLogStatus" ADD VALUE 'processed';
ALTER TYPE "EmailLogStatus" ADD VALUE 'deferred';

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "customArgs" JSONB,
ADD COLUMN     "deferredAt" TIMESTAMP(3),
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "retryAttempt" INTEGER,
ADD COLUMN     "smtpId" TEXT,
ADD COLUMN     "templateId" TEXT;
