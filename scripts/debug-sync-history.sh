#!/bin/bash
# Read-only diagnostic: prints the recent SyncLog history per source (most
# recent 30 rows each) and the current SyncFailureState rows, to see
# whether a sync-failure alert was a real, since-resolved transient issue
# or something still stuck.
#
# Usage: ./scripts/debug-sync-history.sh

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

echo "=== 1) Last 30 SyncLog rows per source ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT source, status, message, "createdAt"
FROM (
  SELECT source, status, message, "createdAt",
         row_number() OVER (PARTITION BY source ORDER BY "createdAt" DESC) AS rn
  FROM "SyncLog"
) ranked
WHERE rn <= 30
ORDER BY source, "createdAt" DESC;
SQL

echo ""
echo "=== 2) Sources currently marked as in a broken streak (SyncFailureState) ==="
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT * FROM "SyncFailureState";
SQL
