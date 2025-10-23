/*
  Warnings:

  - You are about to drop the column `toneSuggestions` on the `Summary` table. All the data in the column will be lost.
  - The `painPoints` column on the `Summary` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Summary" DROP COLUMN "toneSuggestions",
ADD COLUMN     "aiModel" TEXT NOT NULL DEFAULT 'gemini-pro',
ADD COLUMN     "keywords" TEXT[],
ADD COLUMN     "opportunities" TEXT[],
ADD COLUMN     "scrapedDataId" INTEGER,
ADD COLUMN     "strengths" TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "painPoints",
ADD COLUMN     "painPoints" TEXT[];

-- AddForeignKey
ALTER TABLE "Summary" ADD CONSTRAINT "Summary_scrapedDataId_fkey" FOREIGN KEY ("scrapedDataId") REFERENCES "ScrapedData"("id") ON DELETE SET NULL ON UPDATE CASCADE;
