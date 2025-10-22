-- CreateTable
CREATE TABLE "ScrapedData" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "method" "ScrapeMethod" NOT NULL,
    "url" TEXT NOT NULL,
    "searchQuery" TEXT,
    "discoveredUrl" TEXT,
    "homepageText" TEXT,
    "servicesText" TEXT,
    "productsText" TEXT,
    "contactText" TEXT,
    "homepageHtml" TEXT,
    "servicesHtml" TEXT,
    "productsHtml" TEXT,
    "contactHtml" TEXT,
    "extractedEmails" TEXT[],
    "extractedPhones" TEXT[],
    "pageTitle" TEXT,
    "metaDescription" TEXT,
    "keywords" TEXT[],
    "scrapeSuccess" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapedData_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ScrapedData" ADD CONSTRAINT "ScrapedData_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
