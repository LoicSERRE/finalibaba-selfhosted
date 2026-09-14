#!/bin/bash
# Back up the PostgreSQL database used by docker-compose.yml.
# Produces a gzip-compressed pg_dump under backups/, restorable with restore.sh.
#
# Usage: ./scripts/backup.sh [--keep N] [--quiet]
#
#   --keep N   Delete backups beyond the N most recent (default 14, 0 = keep all).
#   --quiet    Print nothing on success. For cron, which mails every line of
#              output - a nightly job that always speaks trains you to ignore
#              it, and then the one that failed goes unread too.
#
# Automating this is the point of both flags. Retention is not a nicety: an
# unattended nightly dump with nothing deleting the old ones fills the disk,
# and a full disk on the database host is the very thing a backup exists to
# survive. A crontab line that runs at 03:30 and keeps a fortnight:
#
#   30 3 * * * /opt/finalibaba/scripts/backup.sh --quiet --keep 14
#
# The file it writes is NOT encrypted - it is a local dump on the machine that
# already holds the database, so encrypting it there protects nothing the
# filesystem does not. Copying it OFF the host is what changes the threat
# model, and that copy is the one to encrypt; Settings -> Backup does that, and
# requires a passphrase precisely because that file travels.

set -euo pipefail

KEEP=14
QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP="${2:?--keep needs a number}"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$KEEP" in
  ''|*[!0-9]*) echo "Error: --keep expects a whole number, got '$KEEP'." >&2; exit 2 ;;
esac

say() { [ "$QUIET" = "1" ] || echo "$@"; }

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

mkdir -p backups
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups/finalibaba_${TIMESTAMP}.sql.gz"

say "→ Backing up '$POSTGRES_DB' to $OUT"

# pipefail is set, so a pg_dump that dies mid-dump fails the script instead of
# leaving a truncated file that gzip happily closed. A backup that looks fine
# and restores to nothing is the worst outcome available here.
docker compose exec -T db pg_dump -U "$POSTGRES_USER" --clean --if-exists --no-owner "$POSTGRES_DB" | gzip > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "Error: $OUT is empty - the dump produced nothing. Keeping it for inspection." >&2
  exit 1
fi

say "✓ Backup complete: $OUT ($(du -h "$OUT" | cut -f1))"

if [ "$KEEP" -gt 0 ]; then
  # Newest first, drop the ones past the cut. Deliberately only ever removes
  # files this script itself writes, matched by its own naming pattern.
  mapfile -t OLD < <(ls -1t backups/finalibaba_*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))")
  if [ "${#OLD[@]}" -gt 0 ]; then
    rm -f -- "${OLD[@]}"
    say "✓ Removed ${#OLD[@]} backup(s) beyond the most recent $KEEP"
  fi
fi
