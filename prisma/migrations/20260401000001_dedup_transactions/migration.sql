-- Remove duplicate transactions: keep the oldest entry when two rows share the
-- same accountId, amountCents, and a date within ±3 days of each other.
DELETE FROM "Transaction" t1
WHERE EXISTS (
  SELECT 1 FROM "Transaction" t2
  WHERE t2."accountId" = t1."accountId"
    AND t2."amountCents" = t1."amountCents"
    AND t2.date BETWEEN (t1.date - INTERVAL '3 days') AND (t1.date + INTERVAL '3 days')
    AND t2."createdAt" < t1."createdAt"
);
