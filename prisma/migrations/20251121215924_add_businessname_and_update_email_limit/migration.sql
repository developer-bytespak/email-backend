/*
  Warnings:

  - Added the required column `businessName` to the `ProductService` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ClientEmail" ALTER COLUMN "limit" SET DEFAULT 100;

-- AlterTable
ALTER TABLE "ProductService" ADD COLUMN     "businessName" TEXT NOT NULL;
