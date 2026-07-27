-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('DIVIDEND', 'INTEREST');

-- CreateTable
CREATE TABLE "IncomeEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "IncomeType" NOT NULL,
    "ticker" TEXT,
    "amountCents" BIGINT NOT NULL,
    "taxWithheldCents" BIGINT,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IncomeEvent_accountId_date_idx" ON "IncomeEvent"("accountId", "date");

-- AddForeignKey
ALTER TABLE "IncomeEvent" ADD CONSTRAINT "IncomeEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
