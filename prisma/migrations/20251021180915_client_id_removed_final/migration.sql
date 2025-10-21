/*
  Warnings:

  - You are about to drop the column `clientId` on the `Contact` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Contact" DROP CONSTRAINT "Contact_clientId_fkey";

-- AlterTable
ALTER TABLE "Contact" DROP COLUMN "clientId";
