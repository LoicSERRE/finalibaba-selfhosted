-- One rate per account meant the year-end interest estimate was wrong on one
-- side of every rate change, by the whole spread over half a year: France's
-- Livret A paid 1.5% until 31 July 2026 and 1.7% from 1 August, and the
-- estimate applied whichever single number was stored to all 24 fortnights.
--
-- Rows record what the rate WAS until a date, so one row expresses one change
-- while Account.interestRatePct keeps holding today's figure - every existing
-- reader of that column is untouched.
CREATE TABLE "AccountInterestRate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ratePct" DOUBLE PRECISION NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountInterestRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountInterestRate_accountId_until_key" ON "AccountInterestRate"("accountId", "until");
CREATE INDEX "AccountInterestRate_accountId_until_idx" ON "AccountInterestRate"("accountId", "until");

ALTER TABLE "AccountInterestRate" ADD CONSTRAINT "AccountInterestRate_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The one change this app can state as fact rather than guess: the French
-- regulated rate moved from 1.5% to 1.7% on 1 August 2026, and any account
-- sitting at exactly 1.7% today was either suggested that figure or corrected
-- to it, so 1.5% is what it paid before. Scoped to French instances, to
-- savings accounts, and to that exact pair of values - an account on any other
-- rate has a history this migration knows nothing about and is left alone.
INSERT INTO "AccountInterestRate" ("id", "accountId", "ratePct", "until")
SELECT
    md5(random()::text || a.id) || 'lvra',
    a.id,
    0.015,
    TIMESTAMP '2026-08-01 00:00:00'
FROM "Account" a
JOIN "UserSettings" us ON us."userId" = a."userId"
WHERE a.type = 'SAVINGS'
  AND us.country = 'FR'
  AND a."interestRatePct" IS NOT NULL
  AND abs(a."interestRatePct" - 0.017) < 0.00001;
