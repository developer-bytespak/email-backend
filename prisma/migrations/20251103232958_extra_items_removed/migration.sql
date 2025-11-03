/*
  Warnings:

  - You are about to drop the column `dkimVerified` on the `ClientEmail` table. All the data in the column will be lost.
  - You are about to drop the column `domainVerified` on the `ClientEmail` table. All the data in the column will be lost.
  - You are about to drop the column `spfVerified` on the `ClientEmail` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ClientEmail" DROP COLUMN "dkimVerified",
DROP COLUMN "domainVerified",
DROP COLUMN "spfVerified";
