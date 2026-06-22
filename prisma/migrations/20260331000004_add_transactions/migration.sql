CREATE TABLE IF NOT EXISTS "Transaction" (
  id          TEXT        PRIMARY KEY,
  "accountId" TEXT        NOT NULL,
  "syncId"    TEXT        NOT NULL,
  date        TIMESTAMPTZ NOT NULL,
  label       TEXT        NOT NULL,
  "amountCents" BIGINT    NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_syncId_key" ON "Transaction"("syncId");
CREATE INDEX IF NOT EXISTS "Transaction_accountId_date_idx" ON "Transaction"("accountId", date);
