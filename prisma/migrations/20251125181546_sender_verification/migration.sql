-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('email', 'sms');

-- CreateEnum
CREATE TYPE "SenderVerificationStatus" AS ENUM ('pending', 'verified', 'expired', 'rejected');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('otp');

-- AlterTable
ALTER TABLE "ClientEmail" ADD COLUMN     "lastOtpSentAt" TIMESTAMP(3),
ADD COLUMN     "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'otp',
ADD COLUMN     "verificationStatus" "SenderVerificationStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ClientSms" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "lastOtpSentAt" TIMESTAMP(3),
ADD COLUMN     "nationalNumber" TEXT,
ADD COLUMN     "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'otp',
ADD COLUMN     "verificationStatus" "SenderVerificationStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SenderVerification" (
    "id" SERIAL NOT NULL,
    "senderType" "SenderType" NOT NULL,
    "clientEmailId" INTEGER,
    "clientSmsId" INTEGER,
    "otpHash" TEXT NOT NULL,
    "otpExpiresAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SenderVerificationStatus" NOT NULL DEFAULT 'pending',
    "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'otp',
    "verifiedAt" TIMESTAMP(3),
    "lastOtpSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SenderVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "senderVerification_clientEmailId_key" ON "SenderVerification"("clientEmailId");

-- CreateIndex
CREATE UNIQUE INDEX "senderVerification_clientSmsId_key" ON "SenderVerification"("clientSmsId");

-- AddForeignKey
ALTER TABLE "SenderVerification" ADD CONSTRAINT "SenderVerification_clientEmailId_fkey" FOREIGN KEY ("clientEmailId") REFERENCES "ClientEmail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderVerification" ADD CONSTRAINT "SenderVerification_clientSmsId_fkey" FOREIGN KEY ("clientSmsId") REFERENCES "ClientSms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
