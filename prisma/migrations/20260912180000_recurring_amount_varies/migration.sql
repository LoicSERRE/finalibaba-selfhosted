-- A recurring series whose cadence is regular but whose amount is not: a
-- salary with bonuses, a benefit recalculated each quarter, a dividend.
--
-- Default false, so every existing row keeps exactly today's behaviour: the
-- amount check in isMissed still applies to everything already confirmed.
-- Only newly-detected credit series set it, and only when the amounts really
-- do vary (measured on a real account: 3 such series, all genuine income).
ALTER TABLE "RecurringTransaction" ADD COLUMN "amountVaries" BOOLEAN NOT NULL DEFAULT false;
