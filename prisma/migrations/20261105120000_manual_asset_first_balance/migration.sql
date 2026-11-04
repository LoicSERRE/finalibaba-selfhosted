-- A property or a vehicle used to get no balance row at creation, only when
-- its value was next edited - so every net-worth history left it out until
-- then, while its loan (which gets a row at creation) was already
-- subtracted. New ones get one now (createAccount). This gives each existing
-- one a row on the day it was created, unless it already has one by then: at
-- the first value it is known to have had (its earliest row), or its current
-- value when it has none at all.
INSERT INTO "HistoricalBalance" ("id", "accountId", "balanceCents", "recordedAt")
SELECT
    md5(random()::text || a.id) || 'mafb',
    a.id,
    COALESCE(
        (SELECT h."balanceCents" FROM "HistoricalBalance" h WHERE h."accountId" = a.id ORDER BY h."recordedAt" ASC, h.id ASC LIMIT 1),
        a."manualValueCents"
    ),
    date_trunc('day', a."createdAt") + INTERVAL '12 hours'
FROM "Account" a
WHERE a.type IN ('REAL_ESTATE', 'AUTOMOBILE')
  AND (a."manualValueCents" IS NOT NULL
       OR EXISTS (SELECT 1 FROM "HistoricalBalance" h WHERE h."accountId" = a.id))
  AND NOT EXISTS (
      SELECT 1 FROM "HistoricalBalance" h
      WHERE h."accountId" = a.id
        AND h."recordedAt" < date_trunc('day', a."createdAt") + INTERVAL '1 day'
  );
