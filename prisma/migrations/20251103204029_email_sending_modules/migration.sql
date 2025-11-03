/*
  Warnings:

  - A unique constraint covering the columns `[messageId]` on the table `EmailLog` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[trackingPixelToken]` on the table `EmailLog` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "EngagementType" AS ENUM ('open', 'click');

-- CreateEnum
CREATE TYPE "EmailQueueStatus" AS ENUM ('pending', 'sent', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailLogStatus" ADD VALUE 'pending';
ALTER TYPE "EmailLogStatus" ADD VALUE 'delivered';
ALTER TYPE "EmailLogStatus" ADD VALUE 'blocked';
ALTER TYPE "EmailLogStatus" ADD VALUE 'dropped';
ALTER TYPE "EmailLogStatus" ADD VALUE 'spamreport';

-- AlterTable
ALTER TABLE "ClientEmail" ADD COLUMN     "dkimVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "domainVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sendgridApiKey" TEXT,
ADD COLUMN     "spfVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "messageId" TEXT,
ADD COLUMN     "sentVia" TEXT NOT NULL DEFAULT 'sendgrid',
ADD COLUMN     "spamScore" INTEGER,
ADD COLUMN     "trackingPixelToken" TEXT;

-- CreateTable
CREATE TABLE "EmailEngagement" (
    "id" SERIAL NOT NULL,
    "emailLogId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "engagementType" "EngagementType" NOT NULL,
    "engagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "url" TEXT,

    CONSTRAINT "EmailEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailUnsubscribe" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "unsubscribeEmailLogId" INTEGER,
    "unsubscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "EmailUnsubscribe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailQueue" (
    "id" SERIAL NOT NULL,
    "emailDraftId" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "EmailQueueStatus" NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailEngagement_emailLogId_idx" ON "EmailEngagement"("emailLogId");

-- CreateIndex
CREATE INDEX "EmailEngagement_contactId_idx" ON "EmailEngagement"("contactId");

-- CreateIndex
CREATE INDEX "EmailEngagement_engagementType_engagedAt_idx" ON "EmailEngagement"("engagementType", "engagedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailUnsubscribe_contactId_key" ON "EmailUnsubscribe"("contactId");

-- CreateIndex
CREATE INDEX "EmailUnsubscribe_contactId_idx" ON "EmailUnsubscribe"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailQueue_emailDraftId_key" ON "EmailQueue"("emailDraftId");

-- CreateIndex
CREATE INDEX "EmailQueue_status_scheduledAt_priority_idx" ON "EmailQueue"("status", "scheduledAt", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_messageId_key" ON "EmailLog"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_trackingPixelToken_key" ON "EmailLog"("trackingPixelToken");

-- AddForeignKey
ALTER TABLE "EmailEngagement" ADD CONSTRAINT "EmailEngagement_emailLogId_fkey" FOREIGN KEY ("emailLogId") REFERENCES "EmailLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEngagement" ADD CONSTRAINT "EmailEngagement_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailUnsubscribe" ADD CONSTRAINT "EmailUnsubscribe_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailUnsubscribe" ADD CONSTRAINT "EmailUnsubscribe_unsubscribeEmailLogId_fkey" FOREIGN KEY ("unsubscribeEmailLogId") REFERENCES "EmailLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailQueue" ADD CONSTRAINT "EmailQueue_emailDraftId_fkey" FOREIGN KEY ("emailDraftId") REFERENCES "EmailDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
