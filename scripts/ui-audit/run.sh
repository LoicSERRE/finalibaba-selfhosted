#!/usr/bin/env bash
# Starts a throwaway, seeded production instance and runs audit.mjs against it
# in the official Playwright image. Everything runs in Docker and is removed
# afterwards; no project dependency is added.
#
#   ./scripts/ui-audit/run.sh [output-dir]      (default: ./ui-audit-out)
#
# Output: <output-dir>/report.json and <output-dir>/shots/*.png
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$(mkdir -p "${1:-$REPO/ui-audit-out}" && cd "${1:-$REPO/ui-audit-out}" && pwd)"
# Overridable so two audits (e.g. before/after a change) can run side by side.
NAME="${UI_AUDIT_NAME:-ui-audit}"
NET="$NAME-net"
PW_IMAGE=mcr.microsoft.com/playwright:v1.63.0-noble
PASSWORD=ui-audit-password-1

cleanup() { docker rm -f "$NAME-db" "$NAME-app" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null

docker run -d --name "$NAME-db" --network "$NET" \
  -e POSTGRES_USER=u -e POSTGRES_PASSWORD=p -e POSTGRES_DB=f postgres:16-alpine >/dev/null

echo "-> building and seeding the app (a few minutes)"
docker run -d --name "$NAME-app" --network "$NET" -v "$REPO":/src:ro -e AUDIT_PASSWORD="$PASSWORD" -e NAME="$NAME" node:26-alpine sh -c '
  set -e
  # Retried: the Alpine mirror occasionally answers with a transient DNS
  # error, and a one-shot install then fails the whole audit for nothing.
  for i in 1 2 3 4 5; do apk add --no-cache rsync postgresql16-client >/dev/null 2>&1 && break; sleep 5; done
  rsync -a --exclude node_modules --exclude .next --exclude .git --exclude app/generated --exclude ui-audit-out /src/ /work/
  cd /work
  npm install -g corepack@latest >/dev/null 2>&1 && corepack enable
  pnpm install --frozen-lockfile >/dev/null 2>&1
  export DATABASE_URL=postgresql://u:p@"$NAME-db":5432/f NEXTAUTH_SECRET=ui-audit-secret-0123456789 NEXTAUTH_URL=http://"$NAME-app":3000 AUTH_ENABLED=true AUTH_PASSWORD="$AUDIT_PASSWORD"
  until pg_isready -h "$NAME-db" -U u >/dev/null 2>&1; do sleep 1; done
  pnpm exec prisma migrate deploy >/dev/null
  pnpm run db:seed:demo >/dev/null
  SEED_MULTIUSER_PASSWORD="$AUDIT_PASSWORD" pnpm run db:seed:multiuser >/dev/null
  NODE_ENV=production pnpm run build >/dev/null
  NODE_ENV=production exec pnpm start -p 3000
' >/dev/null

until docker run --rm --network "$NET" curlimages/curl -s -o /dev/null -w '%{http_code}' http://"$NAME-app":3000/login 2>/dev/null | grep -q 200; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME-app")" != "true" ]; then
    echo "app container stopped:"; docker logs "$NAME-app" | tail -30; exit 1
  fi
  sleep 5
done

echo "-> auditing"
docker run --rm --network "$NET" -v "$REPO/scripts/ui-audit":/audit:ro -v "$OUT":/out \
  -e BASE_URL=http://"$NAME-app":3000 -e OUT=/out -e AUDIT_PASSWORD="$PASSWORD" "$PW_IMAGE" sh -c '
  set -e
  mkdir -p /tmp/a && cd /tmp/a && cp /audit/audit.mjs .
  npm init -y >/dev/null && npm install --silent playwright@1.63.0 @axe-core/playwright@4 >/dev/null
  node audit.mjs
'
echo "-> report: $OUT/report.json"
