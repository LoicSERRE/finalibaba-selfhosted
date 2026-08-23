-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetCents" BIGINT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: carry the existing single global goal forward as the first
-- Goal row (v1.14 roadmap item - "nothing already in use is lost").
-- COALESCE's fallback matches UserSettings.savingsGoalCents' own schema
-- default, for a fresh install where the singleton row doesn't exist yet
-- (prisma migrate deploy runs against every install, brand new or not) -
-- same fallback pattern as 20260727141819_add_account_tax_treatment.
INSERT INTO "Goal" ("id", "name", "targetCents", "accountId", "createdAt")
VALUES (
  'goal-legacy-networth',
  'Patrimoine',
  COALESCE((SELECT "savingsGoalCents" FROM "UserSettings" WHERE id = 'singleton'), 5000000),
  NULL,
  CURRENT_TIMESTAMP
);
