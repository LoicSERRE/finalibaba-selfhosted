#!/bin/bash
# Recovery for a Trade Republic institution left holding TWO sets of accounts:
# the .env sync's original ones (tr:cash, tr:cto, tr:pea, tr:crypto) and a
# per-user copy of each (tr:<institutionId>:<suffix>).
#
# How anyone ends up here: configuring Trade Republic in Settings and syncing
# BEFORE removing TR_PHONE/TR_PIN creates a second, empty set. "Reprendre les
# comptes existants" then finds every target id already taken and skips them
# all, so the two sets just sit there side by side - 8 accounts where there
# should be 4. That ordering is now enforced in the app, but an instance that
# already did it needs cleaning up, which is this.
#
# What it does, per account kind:
#   - compares the two copies on real history (oldest transaction, oldest
#     balance, and the row counts of each)
#   - deletes the copy with LESS history
#   - renames the survivor to the per-user id, so the per-user sync adopts it
#
# Deleting an Account cascades to its Transaction/HistoricalBalance/Holding
# rows, which is exactly why the choice is made on measured history and shown
# to you in full before anything happens. A kind where both copies hold the
# same depth is left alone and reported, rather than picked by coin flip.
#
# Dry-run by default (SELECT only). --apply acts, after typed confirmation.
#
# Usage:
#   ./scripts/fix-duplicate-tr-accounts.sh          # show the comparison
#   ./scripts/fix-duplicate-tr-accounts.sh --apply  # act, after confirming
#
# Take a backup first - ./scripts/backup.sh - as with anything that deletes.

set -euo pipefail

cd "$(dirname "$0")/.."

APPLY=false
if [ "${1:-}" = "--apply" ]; then
  APPLY=true
fi

if [ ! -f .env ]; then
  echo "Error: .env not found." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source <(sed 's/\r$//' .env)
set +a

POSTGRES_USER="${POSTGRES_USER:-appuser}"
POSTGRES_DB="${POSTGRES_DB:-finalibaba}"

if [ -n "${TR_PHONE:-}" ]; then
  echo "TR_PHONE is still set in .env." >&2
  echo "Remove TR_PHONE and TR_PIN, run 'docker compose up -d', then try again -" >&2
  echo "otherwise the .env sync recreates the accounts this just cleaned up." >&2
  exit 1
fi

psql_run() {
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"
}

# One row per (institution, account kind) that has BOTH copies, with the
# measured history on each side. `depth` is the oldest dated row of either
# kind, which is what "how far back does this account go" actually means.
read -r -d '' PAIRS_SQL <<'SQL' || true
WITH tr AS (
  SELECT a.id, a."institutionId", a."syncId", a.name,
         split_part(a."syncId", ':', array_length(string_to_array(a."syncId", ':'), 1)) AS kind,
         array_length(string_to_array(a."syncId", ':'), 1) = 2 AS is_legacy
  FROM "Account" a
  WHERE a."syncId" LIKE 'tr:%'
),
measured AS (
  SELECT tr.*,
         (SELECT count(*) FROM "Transaction" t WHERE t."accountId" = tr.id) AS txs,
         (SELECT count(*) FROM "HistoricalBalance" h WHERE h."accountId" = tr.id) AS balances,
         LEAST(
           COALESCE((SELECT min(t.date) FROM "Transaction" t WHERE t."accountId" = tr.id), 'infinity'),
           COALESCE((SELECT min(h."recordedAt") FROM "HistoricalBalance" h WHERE h."accountId" = tr.id), 'infinity')
         ) AS oldest
  FROM tr
)
SELECT i.name AS institution, m.kind,
       l.id AS legacy_id, l.txs AS legacy_txs, l.balances AS legacy_balances,
       CASE WHEN l.oldest = 'infinity' THEN NULL ELSE l.oldest::date::text END AS legacy_since,
       p.id AS peruser_id, p.txs AS peruser_txs, p.balances AS peruser_balances,
       CASE WHEN p.oldest = 'infinity' THEN NULL ELSE p.oldest::date::text END AS peruser_since,
       CASE
         WHEN l.oldest < p.oldest THEN 'delete per-user copy, keep + rename legacy'
         WHEN p.oldest < l.oldest THEN 'delete legacy copy, keep per-user'
         -- Both empty: nothing can be lost either way, so keep the copy the
         -- per-user sync already addresses and drop the other.
         WHEN l.oldest = 'infinity' THEN 'both empty - delete legacy copy, keep per-user'
         ELSE 'SAME DEPTH - left alone, decide by hand'
       END AS action
FROM measured m
JOIN measured l ON l."institutionId" = m."institutionId" AND l.kind = m.kind AND l.is_legacy
JOIN measured p ON p."institutionId" = m."institutionId" AND p.kind = m.kind AND NOT p.is_legacy
JOIN "Institution" i ON i.id = m."institutionId"
WHERE m.is_legacy
ORDER BY i.name, m.kind;
SQL

echo "=== Trade Republic accounts, both copies side by side ==="
echo "(a kind listed here exists twice; 'since' is its oldest dated row)"
echo ""
psql_run <<SQL
$PAIRS_SQL
SQL

echo ""
echo "=== Every Trade Republic account currently in the database ==="
psql_run <<'SQL'
SELECT a."syncId", a.name, a.type,
       (SELECT count(*) FROM "Transaction" t WHERE t."accountId" = a.id) AS txs,
       (SELECT count(*) FROM "HistoricalBalance" h WHERE h."accountId" = a.id) AS balances
FROM "Account" a
WHERE a."syncId" LIKE 'tr:%'
ORDER BY a."syncId";
SQL

if [ "$APPLY" != true ]; then
  echo ""
  echo "Dry run - nothing changed. Re-run with --apply to act on the plan above."
  exit 0
fi

echo ""
echo "This DELETES the shallower copy of each kind above, and every"
echo "transaction, balance and holding attached to it. Take a backup first"
echo "(./scripts/backup.sh) if you have not."
read -r -p "Type 'oui' to continue: " CONFIRM
if [ "$CONFIRM" != "oui" ]; then
  echo "Aborted - nothing changed."
  exit 1
fi

# One transaction: either both the delete and the rename land, or neither
# does. A half-applied state here is a second set of duplicates.
psql_run -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;

CREATE TEMP TABLE tr_pairs AS
WITH tr AS (
  SELECT a.id, a."institutionId", a."syncId",
         split_part(a."syncId", ':', array_length(string_to_array(a."syncId", ':'), 1)) AS kind,
         array_length(string_to_array(a."syncId", ':'), 1) = 2 AS is_legacy
  FROM "Account" a
  WHERE a."syncId" LIKE 'tr:%'
),
measured AS (
  SELECT tr.*,
         LEAST(
           COALESCE((SELECT min(t.date) FROM "Transaction" t WHERE t."accountId" = tr.id), 'infinity'),
           COALESCE((SELECT min(h."recordedAt") FROM "HistoricalBalance" h WHERE h."accountId" = tr.id), 'infinity')
         ) AS oldest
  FROM tr
)
SELECT l.id AS legacy_id, l."institutionId", l.kind, l.oldest AS legacy_oldest,
       p.id AS peruser_id, p.oldest AS peruser_oldest
FROM measured l
JOIN measured p ON p."institutionId" = l."institutionId" AND p.kind = l.kind AND NOT p.is_legacy
WHERE l.is_legacy;

-- The legacy copy goes deeper: drop the per-user copy, then rename the legacy
-- one into the id it just freed. Order matters, syncId is globally unique.
DELETE FROM "Account" WHERE id IN (
  SELECT peruser_id FROM tr_pairs WHERE legacy_oldest < peruser_oldest
);

UPDATE "Account" a
SET "syncId" = 'tr:' || p."institutionId" || ':' || p.kind
FROM tr_pairs p
WHERE a.id = p.legacy_id AND p.legacy_oldest < p.peruser_oldest;

-- The per-user copy goes deeper: it already carries the right id, so the
-- legacy one is simply redundant. Same when BOTH are empty - there is no
-- history to weigh, and the per-user id is the one the sync will use.
DELETE FROM "Account" WHERE id IN (
  SELECT legacy_id FROM tr_pairs
  WHERE peruser_oldest < legacy_oldest
     OR (legacy_oldest = 'infinity' AND peruser_oldest = 'infinity')
);

COMMIT;
SQL

echo ""
echo "=== Result ==="
psql_run <<'SQL'
SELECT a."syncId", a.name,
       (SELECT count(*) FROM "Transaction" t WHERE t."accountId" = a.id) AS txs,
       (SELECT count(*) FROM "HistoricalBalance" h WHERE h."accountId" = a.id) AS balances
FROM "Account" a
WHERE a."syncId" LIKE 'tr:%'
ORDER BY a."syncId";
SQL

echo ""
echo "Done. Any kind reported as SAME DEPTH above was left untouched -"
echo "both copies hold history reaching equally far back, so which one to"
echo "keep is a judgement call, not something to guess at."
echo "Now run a sync from Settings - it will continue on these accounts."
