-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('EXEMPT', 'DEFERRED', 'TAXABLE');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "taxRatePct" DOUBLE PRECISION,
ADD COLUMN     "taxTreatment" "TaxTreatment" NOT NULL DEFAULT 'TAXABLE';

-- Backfill: preserve today's exact effective tax rate per account as an
-- explicit per-account TAXABLE rate, so existing users see no change in
-- computed latent tax / net worth after this migration. Fallback literals
-- match UserSettings' own column defaults, in case the singleton row
-- doesn't exist yet (fresh install).
UPDATE "Account" SET "taxTreatment" = 'TAXABLE',
  "taxRatePct" = COALESCE((SELECT "taxRateCrypto" FROM "UserSettings" WHERE id = 'singleton'), 0.314)
WHERE type = 'CRYPTO';

UPDATE "Account" SET "taxTreatment" = 'TAXABLE',
  "taxRatePct" = COALESCE((SELECT "taxRatePea" FROM "UserSettings" WHERE id = 'singleton'), 0.172)
WHERE type = 'INVESTMENT' AND "investmentSubtype" = 'PEA';

UPDATE "Account" SET "taxTreatment" = 'TAXABLE',
  "taxRatePct" = COALESCE((SELECT "taxRateCto" FROM "UserSettings" WHERE id = 'singleton'), 0.314)
WHERE type = 'INVESTMENT' AND "investmentSubtype" = 'CTO';

-- INVESTMENT accounts with no subtype set today compute taxRate = null in
-- the old crypto->PEA->CTO->null chain, i.e. no tax at all - EXEMPT
-- reproduces that exact outcome (not a claim the account is a real
-- tax-exempt wrapper; the user can change it explicitly afterward).
UPDATE "Account" SET "taxTreatment" = 'EXEMPT', "taxRatePct" = NULL
WHERE type = 'INVESTMENT' AND "investmentSubtype" IS NULL;
