/*
  Warnings:

  - You are about to drop the column `country` on the `Contact` table. All the data in the column will be lost.
  - You are about to drop the column `stateProvince` on the `Contact` table. All the data in the column will be lost.
  - You are about to drop the column `zip` on the `Contact` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Contact" DROP CONSTRAINT "Contact_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."EmailDraft" DROP CONSTRAINT "EmailDraft_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."EmailLog" DROP CONSTRAINT "EmailLog_clientId_fkey";

-- DropForeignKey
ALTER TABLE "public"."SmsLog" DROP CONSTRAINT "SmsLog_clientId_fkey";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "country",
DROP COLUMN "stateProvince",
DROP COLUMN "zip",
ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CsvUpload" ADD COLUMN     "rawData" JSONB;

-- AlterTable
ALTER TABLE "EmailDraft" ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "EmailLog" ALTER COLUMN "clientId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SmsLog" ALTER COLUMN "clientId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDraft" ADD CONSTRAINT "EmailDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsLog" ADD CONSTRAINT "SmsLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
