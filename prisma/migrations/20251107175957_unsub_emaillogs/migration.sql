/*
  Warnings:

  - A unique constraint covering the columns `[unsubscribeToken]` on the table `EmailLog` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "unsubscribeToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_unsubscribeToken_key" ON "EmailLog"("unsubscribeToken");
