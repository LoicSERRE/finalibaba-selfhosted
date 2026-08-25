#!/bin/bash
# One-off correction for accounts synced before the LEP/LDDS/PEL/CEL/Livret
# Jeune detection fix (v1.15.1): sync/db.py's infer_account_type() only
# assigns a type at account *creation* time, so an already-synced account
# stuck on CHECKING (the fallback) is never retroactively reclassified just
# because the keyword list improved. This applies the exact same keyword
# match sync/db.py's ACCOUNT_TYPE_KEYWORDS now uses, but only ever
# CHECKING -> SAVINGS: both types share the same HistoricalBalance-based
# data model (see CLAUDE.md's "Data model" section), so this is a pure
# metadata correction with no data migration involved. Never touches
# INVESTMENT/CRYPTO/LOAN/REAL_ESTATE/AUTOMOBILE/MEAL_VOUCHER accounts - those
# have a different data model and reclassifying one blindly could silently
# break how its value is computed.
#
# Dry-run by default (SELECT only, no changes). Pass --apply to actually
# update, after typed confirmation.
#
# Usage:
#   ./scripts/fix-account-types.sh          # preview what would change
#   ./scripts/fix-account-types.sh --apply  # apply after confirmation

set -euo pipefail

cd "$(dirname "$0")/.."

APPLY=false
if [ "${1:-}" = "--apply" ]; then
  APPLY=true
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

# Keep this predicate in sync with the SAVINGS-mapped keys of
# ACCOUNT_TYPE_KEYWORDS in sync/db.py.
WHERE_CLAUSE="a.type = 'CHECKING' AND (
    a.name ILIKE '%livret%' OR
    a.name ILIKE '%épargne%' OR
    a.name ILIKE '%ldd%' OR
    a.name ILIKE '%pel%' OR
    a.name ILIKE '%cel%' OR
    a.name ILIKE '%lep%' OR
    a.name ILIKE '%savings%'
  )"

echo "=== Accounts that would be reclassified CHECKING -> SAVINGS ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
SELECT i.name AS institution, a.name AS account_name, a.type AS current_type
FROM "Account" a
JOIN "Institution" i ON i.id = a."institutionId"
WHERE $WHERE_CLAUSE
ORDER BY i.name, a.name;
SQL

if [ "$APPLY" != true ]; then
  echo ""
  echo "Dry run only - no changes made. Re-run with --apply to update the accounts listed above."
  exit 0
fi

echo ""
read -r -p "Type 'yes' to reclassify the account(s) listed above as SAVINGS: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
UPDATE "Account" a
SET type = 'SAVINGS', "updatedAt" = NOW()
FROM "Institution" i
WHERE i.id = a."institutionId" AND $WHERE_CLAUSE;
SQL

echo "✓ Done."
