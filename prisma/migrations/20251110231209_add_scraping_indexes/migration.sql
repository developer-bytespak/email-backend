-- CreateIndex
CREATE INDEX "Contact_csvUploadId_businessName_idx" ON "Contact"("csvUploadId", "businessName");

-- CreateIndex
CREATE INDEX "ScrapedData_contactId_scrapedAt_idx" ON "ScrapedData"("contactId", "scrapedAt");

-- CreateIndex
CREATE INDEX "ScrapedData_scrapeSuccess_idx" ON "ScrapedData"("scrapeSuccess");

-- CreateIndex
CREATE INDEX "ScrapedData_method_scrapedAt_idx" ON "ScrapedData"("method", "scrapedAt");
