/*
  Warnings:

  - You are about to drop the column `countryCode` on the `ClientSms` table. All the data in the column will be lost.
  - You are about to drop the column `nationalNumber` on the `ClientSms` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ClientSms" DROP COLUMN "countryCode",
DROP COLUMN "nationalNumber";
