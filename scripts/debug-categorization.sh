#!/bin/bash
# Read-only diagnostic queries for troubleshooting automatic transaction
# categorization (self-learning / MCC / merchant dictionary). Prints three
# reports: investment & crypto account transactions with their assigned
# category, uncategorized dividend/interest-looking labels, and a per-
# account-type breakdown of how many transactions ended up in each category.
#
# Usage: ./scripts/debug-categorization.sh

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

echo "=== 1) Investment/crypto account transactions and their category ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT a.name AS account_name, a.type AS account_type, t.label, t.date,
       c.name AS category_name, t."merchantCategoryCode"
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
LEFT JOIN "Category" c ON c.id = t."categoryId"
WHERE a.type IN ('CRYPTO', 'INVESTMENT')
ORDER BY t.date DESC
LIMIT 100;
SQL

echo ""
echo "=== 2) Uncategorized dividend/interest-looking labels ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT a.name AS account_name, t.label, t.date, t."amountCents"
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
WHERE t."categoryId" IS NULL
  AND (t.label ILIKE '%zins%' OR t.label ILIKE '%dividend%' OR t.label ILIKE '%interest%' OR t.label ILIKE '%coupon%')
ORDER BY t.date DESC
LIMIT 50;
SQL

echo ""
echo "=== 3) Transaction count in 'Alimentation' by account type ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT a.type AS account_type, count(*) AS n
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
JOIN "Category" c ON c.id = t."categoryId"
WHERE c.name = 'Alimentation'
GROUP BY a.type
ORDER BY n DESC;
SQL
