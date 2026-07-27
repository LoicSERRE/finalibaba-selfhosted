#!/bin/bash
# Restore the PostgreSQL database used by docker-compose.yml from a backup
# created by backup.sh. DESTRUCTIVE - replaces all current data.
#
# Usage: ./scripts/restore.sh backups/finalibaba_20260713_120000.sql.gz

set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Usage: ./scripts/restore.sh <path/to/backup.sql.gz>" >&2
  echo "" >&2
  echo "Available backups:" >&2
  ls -1 backups/*.sql.gz 2>/dev/null >&2 || echo "  (none found in backups/)" >&2
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

echo "⚠ This will REPLACE all data in '$POSTGRES_DB' with the contents of $FILE"
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

# Pause the app and sync service (if defined) so nothing writes during the restore.
RUNNING_SERVICES="$(docker compose config --services 2>/dev/null | grep -E '^(app|sync)$' || true)"
if [ -n "$RUNNING_SERVICES" ]; then
  echo "→ Stopping: $RUNNING_SERVICES"
  # shellcheck disable=SC2086
  docker compose stop $RUNNING_SERVICES
fi

echo "→ Restoring $FILE into '$POSTGRES_DB'..."
gunzip -c "$FILE" | docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 --single-transaction

echo "✓ Restore complete."

# The DB restore above already committed - a failure here is a separate Docker
# issue and must not read back as "the restore failed".
if [ -n "$RUNNING_SERVICES" ]; then
  echo "→ Restarting: $RUNNING_SERVICES"
  # shellcheck disable=SC2086
  if ! docker compose start $RUNNING_SERVICES; then
    echo "⚠ Data was restored successfully, but restarting '$RUNNING_SERVICES' failed." >&2
    echo "  Run manually: docker compose up -d" >&2
    exit 1
  fi
fi
