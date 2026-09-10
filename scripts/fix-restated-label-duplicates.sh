#!/bin/bash
# One-off cleanup for duplicates created by v2.9.3 on LCL-synced accounts.
#
# v2.9.3 made the sync's near-duplicate window require the label to match, so
# that two genuinely different transfers of the same amount stopped being
# merged. What it did not account for is that LCL shows a movement under a
# placeholder label first ("VIREMENT SEPA", "VIREMENT INSTANTANE") and
# restates it with the real counterparty on a later sync - so the same
# movement started being stored twice, roughly one to three times a day.
#
# v2.9.4 fixes the sync: a restatement now updates the stored row's label
# instead of inserting. It cannot undo what already landed, which is what
# this script is for.
#
# It removes the PLACEHOLDER-labelled row of each pair, keeping the one that
# names the counterparty. Deliberately conservative:
#   - only accounts synced through Woob/LCL (`woob:`/`lcl:` syncId)
#   - only a row whose label is exactly one of the known placeholders
#   - only when a same-account, same-amount, non-placeholder row exists
#     within three days
#   - never a row carrying a category, a split or a linked income event -
#     that is a row you have touched, and merging your work into another row
#     is not this script's call. Those are reported instead.
#
# Usage:
#   ./scripts/fix-restated-label-duplicates.sh          # dry run (default)
#   ./scripts/fix-restated-label-duplicates.sh --apply

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Error: .env not found. Copy .env.example to .env first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source <(sed 's/\r$//' .env)
set +a

POSTGRES_USER="${POSTGRES_USER:-appuser}"
POSTGRES_DB="${POSTGRES_DB:-finalibaba}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

# One definition of "a duplicate created by the restatement bug", reused by
# both the report and the delete, so they can never disagree.
read -r -d '' CANDIDATES <<'SQL' || true
  SELECT g.id
  FROM "Transaction" g
  JOIN "Account" a ON a.id = g."accountId"
  JOIN "Transaction" d
    ON d."accountId" = g."accountId"
   AND d."amountCents" = g."amountCents"
   AND d.id <> g.id
   AND d.date BETWEEN g.date - INTERVAL '3 days' AND g.date + INTERVAL '3 days'
   AND lower(btrim(d.label)) NOT IN ('virement sepa', 'virement instantane')
  WHERE lower(btrim(g.label)) IN ('virement sepa', 'virement instantane')
    AND (a."syncId" LIKE 'woob:%' OR a."syncId" LIKE 'lcl:%')
    AND g."categoryId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "TransactionSplit" s WHERE s."transactionId" = g.id)
    AND NOT EXISTS (SELECT 1 FROM "IncomeEvent" i WHERE i."transactionId" = g.id)
SQL

echo "→ Duplicates that would be removed (placeholder row of each pair):"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  SELECT a.name AS account, g.date::date AS date, g.\"amountCents\"/100.0 AS amount,
         g.label AS removing, d.label AS keeping
  FROM \"Transaction\" g
  JOIN \"Account\" a ON a.id = g.\"accountId\"
  JOIN \"Transaction\" d
    ON d.\"accountId\" = g.\"accountId\" AND d.\"amountCents\" = g.\"amountCents\"
   AND d.id <> g.id
   AND d.date BETWEEN g.date - INTERVAL '3 days' AND g.date + INTERVAL '3 days'
   AND lower(btrim(d.label)) NOT IN ('virement sepa', 'virement instantane')
  WHERE g.id IN ($CANDIDATES)
  ORDER BY g.date;"

echo ""
echo "→ Trade Republic rows describing a purchase already stored:"
# The other half of the same release's damage. Switching the near-duplicate
# window off for sources with real transaction ids assumed one id per cash
# movement; a purchase inside a PEA emits both a "Kauforder" and a "PEA"
# event with the same amount on the same day. Scoped to exactly that shape
# rather than to same-amount pairs in general, because this account
# legitimately holds many of those.
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  SELECT a.name AS account, k.date::date AS date, k.\"amountCents\"/100.0 AS amount,
         k.label AS removing, p.label AS keeping
  FROM \"Transaction\" k
  JOIN \"Account\" a ON a.id = k.\"accountId\"
  JOIN \"Transaction\" p
    ON p.\"accountId\" = k.\"accountId\" AND p.\"amountCents\" = k.\"amountCents\"
   AND p.date::date = k.date::date AND p.id <> k.id AND p.label LIKE '%- PEA'
  WHERE k.label LIKE '%- Kauforder'
    AND k.\"categoryId\" IS NULL
    AND NOT EXISTS (SELECT 1 FROM \"TransactionSplit\" s WHERE s.\"transactionId\" = k.id)
    AND NOT EXISTS (SELECT 1 FROM \"IncomeEvent\" i WHERE i.\"transactionId\" = k.id)
  ORDER BY k.date;"

echo ""
echo "→ Skipped because you have categorised, split or marked them as income:"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
  SELECT a.name AS account, g.date::date AS date, g.\"amountCents\"/100.0 AS amount, g.label
  FROM \"Transaction\" g
  JOIN \"Account\" a ON a.id = g.\"accountId\"
  JOIN \"Transaction\" d
    ON d.\"accountId\" = g.\"accountId\" AND d.\"amountCents\" = g.\"amountCents\"
   AND d.id <> g.id
   AND d.date BETWEEN g.date - INTERVAL '3 days' AND g.date + INTERVAL '3 days'
   AND lower(btrim(d.label)) NOT IN ('virement sepa', 'virement instantane')
  WHERE lower(btrim(g.label)) IN ('virement sepa', 'virement instantane')
    AND (a.\"syncId\" LIKE 'woob:%' OR a.\"syncId\" LIKE 'lcl:%')
    AND (g.\"categoryId\" IS NOT NULL
         OR EXISTS (SELECT 1 FROM \"TransactionSplit\" s WHERE s.\"transactionId\" = g.id)
         OR EXISTS (SELECT 1 FROM \"IncomeEvent\" i WHERE i.\"transactionId\" = g.id))
  ORDER BY g.date;"

if [ "$APPLY" -ne 1 ]; then
  echo ""
  echo "Dry run. Re-run with --apply to delete the rows listed first."
  exit 0
fi

echo ""
echo "⚠ This permanently deletes those rows."
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction -c "
  DELETE FROM \"Transaction\" WHERE id IN ($CANDIDATES);
  DELETE FROM \"Transaction\" WHERE id IN (
    SELECT k.id FROM \"Transaction\" k
    JOIN \"Transaction\" p
      ON p.\"accountId\" = k.\"accountId\" AND p.\"amountCents\" = k.\"amountCents\"
     AND p.date::date = k.date::date AND p.id <> k.id AND p.label LIKE '%- PEA'
    WHERE k.label LIKE '%- Kauforder'
      AND k.\"categoryId\" IS NULL
      AND NOT EXISTS (SELECT 1 FROM \"TransactionSplit\" s WHERE s.\"transactionId\" = k.id)
      AND NOT EXISTS (SELECT 1 FROM \"IncomeEvent\" i WHERE i.\"transactionId\" = k.id));"

echo "✓ Done. The next sync will keep restatements in place rather than duplicating them."
