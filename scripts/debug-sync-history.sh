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
# userId matters as much as status: Settings reads sync status scoped to the
# logged-in user, so a row written under the wrong owner is invisible there and
# the institution reads "jamais synchronisé" however many times it has run.
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT source, status, "userId", message, "createdAt"
FROM (
  SELECT source, status, "userId", message, "createdAt",
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

echo ""
echo "=== 3) Per-institution: who owns it, its accounts, and its latest sync ==="
# The one view that explains "Settings shows accounts but says never synced",
# and its mirror "Settings shows a count but the dashboard is empty". Both come
# from the same place: an Account or SyncLog row whose userId does not match
# the institution's owner. Since v2.1.2 the sync writes these correctly and
# repairs old rows on its next run, so a mismatch here means that sync has not
# run yet.
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
SELECT
  i.name                                            AS institution,
  COALESCE(u.username, i."userId")                  AS owner,
  CASE WHEN i."trPhone" IS NOT NULL THEN 'trade republic'
       WHEN i."woobModule" IS NOT NULL THEN 'woob'
       ELSE '-' END                                 AS provider,
  count(a.id)                                       AS accounts,
  count(a.id) FILTER (WHERE a."userId" <> i."userId") AS accounts_wrong_owner,
  (SELECT s.status FROM "SyncLog" s
    WHERE s.source IN ('tr:' || i.id, 'woob:' || i.id)
    ORDER BY s."createdAt" DESC LIMIT 1)            AS last_status,
  (SELECT s."userId" <> i."userId" FROM "SyncLog" s
    WHERE s.source IN ('tr:' || i.id, 'woob:' || i.id)
    ORDER BY s."createdAt" DESC LIMIT 1)            AS log_wrong_owner
FROM "Institution" i
LEFT JOIN "User" u ON u.id = i."userId"
LEFT JOIN "Account" a ON a."institutionId" = i.id
GROUP BY i.id, i.name, i."userId", u.username, i."trPhone", i."woobModule"
ORDER BY owner, institution;
SQL
