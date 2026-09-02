-- v2.4: country presets, and a real savings-interest field.
--
-- Until now lib/domain/analytics.ts guessed a savings account's interest rate
-- by matching French product names against the account NAME ("livret a",
-- "ldds", "lep", "livret jeune") on every render. Two consequences, both bad:
-- every savings account outside France produced zero passive income silently,
-- and a rate change meant editing TypeScript.
--
-- The rate is a real column now. This migration runs that same name matching
-- exactly ONCE, so an existing French instance sees identical figures after
-- upgrading - and from here on the value is visible and editable per account.

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "interestRatePct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "country" TEXT;

-- Existing instances WERE French by construction: the app offered no other
-- option before this migration. Saying so explicitly keeps their presets and
-- their suggestions exactly as they were. New installs get NULL and are asked.
UPDATE "UserSettings" SET "country" = 'FR' WHERE "country" IS NULL;

-- Backfill the savings rates, longest/most specific product name first so
-- "Livret Jeune" is not swallowed by the generic "livret" rule below it.
-- Mirrors suggestedSavingsRate() in lib/domain/tax-locale.ts.
UPDATE "Account" SET "interestRatePct" = 0.025
  WHERE "type" = 'SAVINGS' AND "interestRatePct" IS NULL
    AND (LOWER("name") LIKE '%livret jeune%' OR LOWER("name") LIKE '%lep%');

UPDATE "Account" SET "interestRatePct" = 0.015
  WHERE "type" = 'SAVINGS' AND "interestRatePct" IS NULL
    AND (LOWER("name") LIKE '%livret a%' OR LOWER("name") LIKE '%ldds%');

-- Any other "livret ..." was treated as a regulated product at the Livret A
-- rate by the old code; preserved so no figure moves on upgrade.
UPDATE "Account" SET "interestRatePct" = 0.015
  WHERE "type" = 'SAVINGS' AND "interestRatePct" IS NULL
    AND LOWER("name") LIKE '%livret%';
