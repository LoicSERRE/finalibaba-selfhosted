-- v2.14: a note and tags on a transaction.
--
-- Both belong to the user, never to the bank: the sync service inserts named
-- columns only and its single UPDATE rewrites the label, so neither column is
-- ever touched by a sync. Additive and nullable/defaulted, so every existing
-- row is valid as it stands and nothing needs backfilling.
ALTER TABLE "Transaction" ADD COLUMN "note" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The ledger filters by tag (`tags @> ARRAY[...]`, Prisma's `has`), which a
-- GIN index serves; a btree cannot.
CREATE INDEX "Transaction_tags_idx" ON "Transaction" USING GIN ("tags");
