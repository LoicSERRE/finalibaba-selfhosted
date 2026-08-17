-- CreateEnum
CREATE TYPE "GainUnit" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertRuleKind" ADD VALUE 'ACCOUNT_OVERDRAFT';
ALTER TYPE "AlertRuleKind" ADD VALUE 'INVESTMENT_VALUE';
ALTER TYPE "AlertRuleKind" ADD VALUE 'HOLDING_PRICE';
ALTER TYPE "AlertRuleKind" ADD VALUE 'UNREALIZED_GAIN';

-- AlterTable
ALTER TABLE "AlertRule" ADD COLUMN     "gainThresholdPct" DOUBLE PRECISION,
ADD COLUMN     "gainUnit" "GainUnit",
ADD COLUMN     "holdingId" TEXT;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "Holding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
