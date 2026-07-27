-- CreateEnum
CREATE TYPE "HoldingCurrency" AS ENUM ('EUR', 'USD', 'GBP', 'CHF');

-- AlterTable
ALTER TABLE "Holding" ADD COLUMN     "currency" "HoldingCurrency" NOT NULL DEFAULT 'EUR',
ADD COLUMN     "fxRateToEur" DOUBLE PRECISION,
ADD COLUMN     "nativeCostBasisCents" BIGINT,
ADD COLUMN     "nativePriceCents" BIGINT;
