-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "HistoricalBalance" ADD COLUMN     "fxRate" DOUBLE PRECISION,
ADD COLUMN     "nativeBalanceCents" BIGINT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "fxRate" DOUBLE PRECISION,
ADD COLUMN     "nativeAmountCents" BIGINT;

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "base" TEXT NOT NULL DEFAULT 'EUR',
    "currency" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("base","currency","day")
);
