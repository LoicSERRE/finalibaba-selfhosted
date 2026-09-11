#!/bin/bash
# Marks transfers between your own accounts that the detector structurally
# cannot find, because one half of the pair is not in the database at all.
#
# lib/domain/internal-transfers.ts pairs a debit with a credit of the same
# amount on another account within a few days. That needs BOTH legs stored.
# When an account's history in this app starts later than the transfers do -
# the usual case, since a bank only serves so much history to scrape - every
# transfer before that date has one leg and can never be matched. Measured on
# a real instance: the current account everything passes through had history
# from 1 January onward, while the savings and broker accounts went back two
# years, leaving 53 credits totalling ~24 000 EUR looking like income forever.
#
# No amount of matching fixes that. A person has to say so, and this is the
# bulk version of the toggle on each transaction row.
#
# It writes internalTransferManual = true, not just the flag: that is the
# whole point of the three-state model (see CLAUDE.md's "Internal transfer
# detection"). A decision recorded as a person's is never revisited by the
# detector, so these rows cannot drift back.
#
# DELIBERATELY NOT AUTOMATIC, and not a label rule inside the app. Matching
# "VIREMENT M <your name>" is exactly the text matching the detector exists to
# avoid - a bank reuses that wording for real incoming payments too. It is
# only safe here because you read the list first and confirm it.
#
# Dry-run by default (SELECT only). Pass --apply to write, after typed
# confirmation.
#
# Usage:
#   ./scripts/flag-internal-transfers.sh 'VIREMENT M LOIC SERRE'
#   ./scripts/flag-internal-transfers.sh 'LOIC SERRE|VIR INST Compte Trade'
#   ./scripts/flag-internal-transfers.sh 'LOIC SERRE' --apply
#
# The pattern is a POSIX regex, matched case-insensitively against the label.

set -euo pipefail

cd "$(dirname "$0")/.."

PATTERN="${1:-}"
APPLY=false
if [ "${2:-}" = "--apply" ]; then
  APPLY=true
fi

if [ -z "$PATTERN" ]; then
  echo "Usage: $0 '<label regex>' [--apply]" >&2
  echo "" >&2
  echo "Example: $0 'VIREMENT M LOIC SERRE'" >&2
  exit 1
fi

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

# Already-decided rows are excluded in both directions: a person who un-marked
# one is not asking for it back. Already-flagged rows are excluded too - the
# detector found those itself, and re-stating them as manual decisions would
# take them out of its reach for no reason.
WHERE_CLAUSE="t.\"isInternalTransfer\" = false
  AND t.\"internalTransferManual\" IS NULL
  AND t.label ~* '$PATTERN'"

echo "=== Transactions that would be marked as internal transfers ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL < /dev/null
SELECT a.name AS account, t.date::date AS date, t."amountCents" / 100.0 AS eur,
       left(t.label, 48) AS label
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
WHERE $WHERE_CLAUSE
ORDER BY t.date DESC
LIMIT 60;
SQL

echo ""
echo "=== Totals ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL < /dev/null
SELECT a.name AS account, count(*) AS rows,
       sum(t."amountCents") / 100.0 AS total_eur,
       min(t.date)::date AS oldest, max(t.date)::date AS newest
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
WHERE $WHERE_CLAUSE
GROUP BY a.name
ORDER BY count(*) DESC;
SQL

# A row already recorded as a dividend or interest payment is a fiscal record,
# and reclassifying one as a transfer behind the user's back is not a script's
# call - /tax-report reads those. Reported, never touched, same convention as
# scripts/fix-restated-label-duplicates.sh's own refusal to merge a row
# somebody has categorised.
echo ""
echo "=== Skipped: already recorded as income (delete the income event first if wrong) ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL < /dev/null
SELECT a.name AS account, t.date::date AS date, t."amountCents" / 100.0 AS eur,
       left(t.label, 40) AS label, ie.type AS recorded_as
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
JOIN "IncomeEvent" ie ON ie."transactionId" = t.id
WHERE $WHERE_CLAUSE
ORDER BY t.date DESC;
SQL

if [ "$APPLY" != true ]; then
  echo ""
  echo "Dry run only - nothing written. Re-run with --apply to mark the rows listed above."
  echo "Read the list first: this matches on label text, which a bank also reuses"
  echo "for real incoming payments."
  exit 0
fi

echo ""
read -r -p "Type 'yes' to mark the transaction(s) listed above as internal transfers: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL < /dev/null
UPDATE "Transaction" t
SET "isInternalTransfer" = true, "internalTransferManual" = true
WHERE $WHERE_CLAUSE
  AND NOT EXISTS (SELECT 1 FROM "IncomeEvent" ie WHERE ie."transactionId" = t.id);
SQL

echo "✓ Done. These rows now carry a human decision, so the detector will not revisit them."
