/*
  Warnings:

  - The values [enriched,emailed] on the enum `ContactStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ScrapeMethod" AS ENUM ('direct_url', 'email_domain', 'business_search');

-- AlterEnum
BEGIN;
CREATE TYPE "ContactStatus_new" AS ENUM ('new', 'validated', 'ready_to_scrape', 'scraping', 'scraped', 'scrape_failed', 'summarized', 'drafted', 'sent', 'opened', 'bounced');
ALTER TABLE "public"."Contact" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Contact" ALTER COLUMN "status" TYPE "ContactStatus_new" USING ("status"::text::"ContactStatus_new");
ALTER TYPE "ContactStatus" RENAME TO "ContactStatus_old";
ALTER TYPE "ContactStatus_new" RENAME TO "ContactStatus";
DROP TYPE "public"."ContactStatus_old";
ALTER TABLE "Contact" ALTER COLUMN "status" SET DEFAULT 'new';
COMMIT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "businessNameValid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailValid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scrapeMethod" "ScrapeMethod",
ADD COLUMN     "scrapePriority" INTEGER,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "websiteValid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zipCode" TEXT;
