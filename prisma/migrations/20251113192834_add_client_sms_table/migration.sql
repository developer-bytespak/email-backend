-- CreateEnum
CREATE TYPE "ClientSmsStatus" AS ENUM ('active', 'inactive');

-- AlterTable
ALTER TABLE "SmsDraft" ADD COLUMN     "clientSmsId" INTEGER;

-- AlterTable
ALTER TABLE "SmsLog" ADD COLUMN     "clientSmsId" INTEGER;

-- CreateTable
CREATE TABLE "ClientSms" (
    "id" SERIAL NOT NULL,
    "clientId" INTEGER NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "providerSettings" TEXT,
    "status" "ClientSmsStatus" NOT NULL DEFAULT 'active',
    "totalCounter" INTEGER NOT NULL DEFAULT 0,
    "currentCounter" INTEGER NOT NULL DEFAULT 0,
    "timestamp" TIMESTAMP(3),
    "limit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientSms_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ClientSms" ADD CONSTRAINT "ClientSms_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsDraft" ADD CONSTRAINT "SmsDraft_clientSmsId_fkey" FOREIGN KEY ("clientSmsId") REFERENCES "ClientSms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsLog" ADD CONSTRAINT "SmsLog_clientSmsId_fkey" FOREIGN KEY ("clientSmsId") REFERENCES "ClientSms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
