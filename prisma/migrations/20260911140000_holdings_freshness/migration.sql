-- An empty statement from a securities account is ambiguous - a silent read
-- failure, or an account genuinely emptied - and the sync resolved it by
-- keeping the old lines and saying nothing, so no later sync could ever
-- remove a position that was sold. Keeping them stays the right call; these
-- two columns are what makes it honest on screen.
--
-- holdingsReportedAt: the last statement that actually carried lines.
-- holdingsStaleSince: the first empty one since, set once and left there.
ALTER TABLE "Account" ADD COLUMN "holdingsReportedAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "holdingsStaleSince" TIMESTAMP(3);

-- Existing synced accounts that already hold lines are treated as reported
-- now rather than as never reported: they were confirmed by whatever sync
-- last wrote them, and starting them at NULL would show every one of them as
-- unconfirmed on the first render after deploying.
UPDATE "Account" a
SET "holdingsReportedAt" = NOW()
WHERE a."syncId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Holding" h WHERE h."accountId" = a.id);
