-- A portfolio movement is not household spending. See the column's own
-- comment in schema.prisma for the measurement that prompted this.
ALTER TABLE "Transaction" ADD COLUMN "isSecuritiesMovement" BOOLEAN NOT NULL DEFAULT false;

-- Backfill for history already stored. Going forward sync_tr.py sets this
-- from Trade Republic's own eventType, but that field was never captured
-- for rows already in the database and a re-sync will not revisit them:
-- upsert_transaction skips a syncId it already knows. So existing rows are
-- classified from the labels Trade Republic itself writes, which is the
-- only signal those rows carry.
--
-- Scoped to accounts synced from Trade Republic (`tr:` / `tr-realtime:`),
-- because these German words are that source's vocabulary and matching
-- them anywhere else would be guessing.
UPDATE "Transaction" t
SET "isSecuritiesMovement" = true
FROM "Account" a
WHERE a.id = t."accountId"
  AND (a."syncId" LIKE 'tr:%' OR a."syncId" LIKE 'tr-realtime:%')
  AND (
    t.label LIKE '%Kauforder%'        -- buy order
    OR t.label LIKE '%Verkaufsorder%' -- sell order
    OR t.label LIKE '%Sparplan%'      -- savings-plan execution
    OR t.label LIKE '%Saveback%'      -- round-up invested automatically
    OR t.label LIKE '%- PEA'          -- cash moved into the PEA envelope
  );
