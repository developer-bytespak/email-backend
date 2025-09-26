/*
  Warnings:

  - Added the required column `pricePlanId` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `duplicateRecords` to the `CsvUpload` table without a default value. This is not possible if the table is not empty.
  - Added the required column `invalidRecords` to the `CsvUpload` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."DuplicateStatus" AS ENUM ('unique', 'potential_duplicate', 'confirmed_duplicate');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."CsvUploadStatus" ADD VALUE 'pending';
ALTER TYPE "public"."CsvUploadStatus" ADD VALUE 'processing';

-- AlterTable
ALTER TABLE "public"."Client" ADD COLUMN     "pricePlanId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "public"."Contact" ADD COLUMN     "duplicateStatus" "public"."DuplicateStatus" NOT NULL DEFAULT 'unique';

-- AlterTable
ALTER TABLE "public"."CsvUpload" ADD COLUMN     "columnMapping" JSONB,
ADD COLUMN     "duplicateRecords" INTEGER NOT NULL,
ADD COLUMN     "invalidRecords" INTEGER NOT NULL,
ADD COLUMN     "processedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."PricePlan" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "features" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricePlan_name_key" ON "public"."PricePlan"("name");

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_pricePlanId_fkey" FOREIGN KEY ("pricePlanId") REFERENCES "public"."PricePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
