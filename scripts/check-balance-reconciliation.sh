#!/bin/bash
# Does the stored transaction history add up to the balance the bank itself
# reports? Read-only.
#
# This exists because two dedup regressions shipped in a row without being
# caught, and both were only ever settled by this comparison. A duplicated
# transaction and a discarded one are both invisible in the ledger - the row
# looks perfectly normal either way - but neither survives being checked
# against the balance, which is the one figure the sync does not compute.
#
# Method: for each pair of consecutive balance snapshots on an account, the
# balance moved by some amount, and the transactions dated in between should
# sum to the same thing. A persistent gap in one direction means rows are
# being dropped; in the other, duplicated.
#
# Only fiat accounts (CHECKING / SAVINGS / MEAL_VOUCHER) are checked. An
# investment account's balance is derived from its holdings and their prices,
# not from its transactions, so the two are not supposed to agree there.
#
# Usage:
#   ./scripts/check-balance-reconciliation.sh          # last 30 days
#   ./scripts/check-balance-reconciliation.sh 90       # last 90 days

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
DAYS="${1:-30}"

echo "→ Balance vs transactions, last $DAYS days (fiat accounts only)"
echo ""

docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
WITH snaps AS (
  -- One balance per account per day: several syncs a day write several
  -- rows, and only the last one describes the day as it ended.
  SELECT DISTINCT ON (h.\"accountId\", h.\"recordedAt\"::date)
         h.\"accountId\", h.\"recordedAt\"::date AS day, h.\"balanceCents\"
  FROM \"HistoricalBalance\" h
  JOIN \"Account\" a ON a.id = h.\"accountId\"
  WHERE a.type IN ('CHECKING', 'SAVINGS', 'MEAL_VOUCHER')
    AND h.\"recordedAt\" >= now() - (INTERVAL '1 day' * $DAYS)
  ORDER BY h.\"accountId\", h.\"recordedAt\"::date, h.\"recordedAt\" DESC
), windows AS (
  SELECT \"accountId\", day,
         lag(day) OVER (PARTITION BY \"accountId\" ORDER BY day) AS prev_day,
         \"balanceCents\" - lag(\"balanceCents\") OVER (PARTITION BY \"accountId\" ORDER BY day) AS moved
  FROM snaps
), checked AS (
  SELECT w.\"accountId\", w.prev_day, w.day, w.moved,
         COALESCE((
           SELECT sum(t.\"amountCents\") FROM \"Transaction\" t
           WHERE t.\"accountId\" = w.\"accountId\"
             AND t.date::date > w.prev_day AND t.date::date <= w.day
         ), 0) AS explained
  FROM windows w WHERE w.prev_day IS NOT NULL
)
SELECT a.name AS account,
       count(*) AS windows,
       sum(CASE WHEN moved <> explained THEN 1 ELSE 0 END) AS mismatched,
       sum(moved - explained)/100.0 AS net_gap_eur,
       sum(abs(moved - explained))/100.0 AS total_gap_eur
FROM checked c JOIN \"Account\" a ON a.id = c.\"accountId\"
GROUP BY a.name
ORDER BY sum(abs(moved - explained)) DESC;"

echo ""
echo "→ The ten largest single gaps"
echo ""

docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
WITH snaps AS (
  SELECT DISTINCT ON (h.\"accountId\", h.\"recordedAt\"::date)
         h.\"accountId\", h.\"recordedAt\"::date AS day, h.\"balanceCents\"
  FROM \"HistoricalBalance\" h
  JOIN \"Account\" a ON a.id = h.\"accountId\"
  WHERE a.type IN ('CHECKING', 'SAVINGS', 'MEAL_VOUCHER')
    AND h.\"recordedAt\" >= now() - (INTERVAL '1 day' * $DAYS)
  ORDER BY h.\"accountId\", h.\"recordedAt\"::date, h.\"recordedAt\" DESC
), windows AS (
  SELECT \"accountId\", day,
         lag(day) OVER (PARTITION BY \"accountId\" ORDER BY day) AS prev_day,
         \"balanceCents\" - lag(\"balanceCents\") OVER (PARTITION BY \"accountId\" ORDER BY day) AS moved
  FROM snaps
), checked AS (
  SELECT w.\"accountId\", w.prev_day, w.day, w.moved,
         COALESCE((
           SELECT sum(t.\"amountCents\") FROM \"Transaction\" t
           WHERE t.\"accountId\" = w.\"accountId\"
             AND t.date::date > w.prev_day AND t.date::date <= w.day
         ), 0) AS explained
  FROM windows w WHERE w.prev_day IS NOT NULL
)
SELECT a.name AS account, prev_day, day,
       moved/100.0 AS balance_moved_eur,
       explained/100.0 AS transactions_eur,
       (moved - explained)/100.0 AS gap_eur,
       CASE WHEN moved - explained > 0 THEN 'missing transactions'
            WHEN moved - explained < 0 THEN 'duplicated / extra'
       END AS reads_as
FROM checked c JOIN \"Account\" a ON a.id = c.\"accountId\"
WHERE moved <> explained
ORDER BY abs(moved - explained) DESC LIMIT 10;"

echo ""
echo "A gap is not automatically a bug: a bank can date an operation on one"
echo "side of a snapshot and settle it on the other, and a sync that runs"
echo "mid-day sees part of a day. What matters is a gap that PERSISTS in one"
echo "direction, or one large enough to be a real movement."
echo ""
echo "Blind spot, stated rather than discovered later: this only sees what"
echo "falls strictly BETWEEN two balance snapshots, so an account the sync"
echo "rarely records a balance for is barely checked at all. Replayed against"
echo "the two dumps that bracket the v2.9.3 duplication bug, it moved the"
echo "brokerage account from a 36 EUR gap to 3 183 EUR - and reported a clean"
echo "0 for the bank account, whose duplicates happened to land on a snapshot"
echo "day. Treat a clean result on a sparsely-sampled account as 'not"
echo "checked', not as 'correct'."
