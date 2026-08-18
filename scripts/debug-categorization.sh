#!/bin/bash
# Read-only diagnostic queries for troubleshooting automatic transaction
# categorization (self-learning / MCC / merchant dictionary). Prints
# reports: investment & crypto account transactions with their assigned
# category, uncategorized dividend/interest-looking labels, a per-
# account-type breakdown of how many transactions ended up in each
# category, sample "virement"-labeled transactions, how many of those
# landed in Revenus, candidate inter-account-transfer pairs (same
# absolute amount, opposite sign, different accounts, close dates), every
# raw Trade Republic cash-account transaction (its labels aren't French, so
# the "virement" query above misses them), and every transaction currently
# in Revenus regardless of label wording.
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

echo ""
echo "=== 4) Sample 'virement'-labeled transactions (full label text, both directions) ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT a.name AS account_name, t.label, t.date, t."amountCents", c.name AS category_name
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
LEFT JOIN "Category" c ON c.id = t."categoryId"
WHERE t.label ILIKE '%virement%'
ORDER BY t.date DESC
LIMIT 100;
SQL

echo ""
echo "=== 5) How many 'virement'-labeled transactions are currently in 'Revenus' ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT count(*) AS n
FROM "Transaction" t
JOIN "Category" c ON c.id = t."categoryId"
WHERE c.name = 'Revenus' AND t.label ILIKE '%virement%';
SQL

echo ""
echo "=== 6) Candidate inter-account transfers (same |amount|, opposite sign, different accounts, within 3 days) ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT
  a1.name AS credit_account, t1.label AS credit_label, t1.date AS credit_date, t1."amountCents" AS credit_amount,
  a2.name AS debit_account,  t2.label AS debit_label,  t2.date AS debit_date,  t2."amountCents" AS debit_amount
FROM "Transaction" t1
JOIN "Account" a1 ON a1.id = t1."accountId"
JOIN "Transaction" t2 ON t2."amountCents" = -t1."amountCents"
  AND t2."accountId" != t1."accountId"
  AND t2.date BETWEEN t1.date - INTERVAL '3 days' AND t1.date + INTERVAL '3 days'
JOIN "Account" a2 ON a2.id = t2."accountId"
WHERE t1."amountCents" > 0
ORDER BY t1.date DESC
LIMIT 100;
SQL

echo ""
echo "=== 7) All Trade Republic cash-account transactions (any label wording - TR's own vocabulary is German/English, not French 'virement') ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT t.label, t.date, t."amountCents", c.name AS category_name
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
JOIN "Institution" i ON i.id = a."institutionId"
WHERE i.name = 'Trade Republic' AND a.type = 'CHECKING'
ORDER BY t.date DESC
LIMIT 100;
SQL

echo ""
echo "=== 8) Every credit transaction currently sitting in 'Revenus' (full picture, any label wording) ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT i.name AS institution_name, a.name AS account_name, t.label, t.date, t."amountCents"
FROM "Transaction" t
JOIN "Account" a ON a.id = t."accountId"
JOIN "Institution" i ON i.id = a."institutionId"
JOIN "Category" c ON c.id = t."categoryId"
WHERE c.name = 'Revenus'
ORDER BY t.date DESC
LIMIT 100;
SQL
