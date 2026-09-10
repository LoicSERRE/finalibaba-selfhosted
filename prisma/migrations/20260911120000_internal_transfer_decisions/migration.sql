-- A human decision about an internal transfer now survives the detector.
--
-- Until now the detector's candidate pool was "isInternalTransfer = false",
-- so un-marking a transfer by hand put the row straight back in the pool
-- and the next sync re-flagged it. isInternalTransfer stays the effective
-- answer every read query uses; internalTransferManual records who decided.
ALTER TABLE "Transaction" ADD COLUMN "internalTransferManual" BOOLEAN;

-- The other leg of the detected pair, so a pass can tell a pairing that no
-- longer holds (safe to undo) from one whose counterpart sits on an account
-- it cannot see (must be left alone).
ALTER TABLE "Transaction" ADD COLUMN "internalTransferPairId" TEXT;

-- A securities movement is not half of an inter-account transfer: buying
-- shares moves money out of the cash account into a position, and no second
-- bank account ever records the other side. The two flags on one row are a
-- past amount coincidence - a 10 EUR savings-plan execution sitting the same
-- distance from a 10 EUR credit as the real transfer that caused it - and
-- the label evidence behind isSecuritiesMovement is far stronger than the
-- coincidence behind the other. Cleared before the pairing is backfilled, so
-- these rows cannot be recorded as anybody's counterpart either.
UPDATE "Transaction"
SET "isInternalTransfer" = false
WHERE "isSecuritiesMovement" = true AND "isInternalTransfer" = true;

-- Backfill the pairing for rows flagged before this column existed.
--
-- Without it, every already-flagged row would be permanently unrevisable:
-- a pass can only revoke a flag whose evidence it can see, and a row with
-- no recorded partner has none. That would leave exactly the rows this
-- change is meant to rescue - the ones wrongly paired in the past - stuck
-- for good.
--
-- Deliberately NOT a re-implementation of the matcher: it does not reproduce
-- the global closest-first assignment, it just records the nearest plausible
-- counterpart under the same rule (opposite sign, same absolute amount,
-- different account, within the 3-day tolerance). That is enough, because
-- the value is only ever tested for membership in the pool being re-derived,
-- never trusted as the definitive pairing. A row with no plausible partner
-- keeps a NULL and stays conservatively flagged until a person says
-- otherwise.
UPDATE "Transaction" t
SET "internalTransferPairId" = (
  SELECT o.id
  FROM "Transaction" o
  WHERE o."isInternalTransfer" = true
    AND o.id <> t.id
    AND o."accountId" <> t."accountId"
    AND o."amountCents" = -t."amountCents"
    AND o."date" BETWEEN t."date" - INTERVAL '3 days' AND t."date" + INTERVAL '3 days'
  ORDER BY abs(EXTRACT(EPOCH FROM (o."date" - t."date")))
  LIMIT 1
)
WHERE t."isInternalTransfer" = true;
