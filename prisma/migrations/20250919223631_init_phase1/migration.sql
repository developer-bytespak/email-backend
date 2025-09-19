-- CreateEnum
CREATE TYPE "public"."CsvUploadStatus" AS ENUM ('success', 'failure');

-- CreateEnum
CREATE TYPE "public"."ContactStatus" AS ENUM ('new', 'enriched', 'scraped', 'summarized', 'emailed');

-- CreateEnum
CREATE TYPE "public"."EmailDraftStatus" AS ENUM ('draft', 'ready', 'sent');

-- CreateEnum
CREATE TYPE "public"."EmailLogStatus" AS ENUM ('success', 'failed', 'bounced');

-- CreateEnum
CREATE TYPE "public"."ProductServiceType" AS ENUM ('product', 'service');

-- CreateEnum
CREATE TYPE "public"."ClientEmailStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "public"."SmsDraftStatus" AS ENUM ('draft', 'ready', 'sent');

-- CreateEnum
CREATE TYPE "public"."SmsLogStatus" AS ENUM ('success', 'failed', 'delivered', 'undelivered');

-- CreateTable
CREATE TABLE "public"."Client" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "hashPassword" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CsvUpload" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" "public"."CsvUploadStatus" NOT NULL,
    "totalRecords" INTEGER NOT NULL,
    "successfulRecords" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Contact" (
    "id" SERIAL NOT NULL,
    "csvUploadId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "businessName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "stateProvince" TEXT,
    "zip" TEXT,
    "country" TEXT,
    "status" "public"."ContactStatus" NOT NULL DEFAULT 'new',
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "validationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Summary" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "summaryText" TEXT NOT NULL,
    "painPoints" TEXT,
    "toneSuggestions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailDraft" (
    "id" SERIAL NOT NULL,
    "clientEmailId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "summaryId" INTEGER NOT NULL,
    "subjectLine" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "icebreaker" TEXT,
    "productsRelevant" TEXT,
    "status" "public"."EmailDraftStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmailLog" (
    "id" SERIAL NOT NULL,
    "emailDraftId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "status" "public"."EmailLogStatus" NOT NULL,
    "providerResponse" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductService" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "type" "public"."ProductServiceType",
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientEmail" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "providerSettings" TEXT,
    "status" "public"."ClientEmailStatus" NOT NULL DEFAULT 'active',
    "mailerTestScore" DECIMAL(5,2),
    "totalCounter" INTEGER NOT NULL DEFAULT 0,
    "currentCounter" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3),
    "limit" INTEGER NOT NULL DEFAULT 500,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SmsDraft" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "summaryId" INTEGER,
    "messageText" TEXT NOT NULL,
    "productsRelevant" TEXT,
    "status" "public"."SmsDraftStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" INTEGER,

    CONSTRAINT "SmsDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SmsLog" (
    "id" SERIAL NOT NULL,
    "smsDraftId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "status" "public"."SmsLogStatus" NOT NULL,
    "providerResponse" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_email_key" ON "public"."Client"("email");

-- AddForeignKey
ALTER TABLE "public"."CsvUpload" ADD CONSTRAINT "CsvUpload_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_csvUploadId_fkey" FOREIGN KEY ("csvUploadId") REFERENCES "public"."CsvUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Contact" ADD CONSTRAINT "Contact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Summary" ADD CONSTRAINT "Summary_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailDraft" ADD CONSTRAINT "EmailDraft_clientEmailId_fkey" FOREIGN KEY ("clientEmailId") REFERENCES "public"."ClientEmail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailDraft" ADD CONSTRAINT "EmailDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailDraft" ADD CONSTRAINT "EmailDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailDraft" ADD CONSTRAINT "EmailDraft_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "public"."Summary"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailLog" ADD CONSTRAINT "EmailLog_emailDraftId_fkey" FOREIGN KEY ("emailDraftId") REFERENCES "public"."EmailDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailLog" ADD CONSTRAINT "EmailLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmailLog" ADD CONSTRAINT "EmailLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductService" ADD CONSTRAINT "ProductService_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientEmail" ADD CONSTRAINT "ClientEmail_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SmsDraft" ADD CONSTRAINT "SmsDraft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SmsDraft" ADD CONSTRAINT "SmsDraft_summaryId_fkey" FOREIGN KEY ("summaryId") REFERENCES "public"."Summary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SmsDraft" ADD CONSTRAINT "SmsDraft_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SmsLog" ADD CONSTRAINT "SmsLog_smsDraftId_fkey" FOREIGN KEY ("smsDraftId") REFERENCES "public"."SmsDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SmsLog" ADD CONSTRAINT "SmsLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SmsLog" ADD CONSTRAINT "SmsLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
