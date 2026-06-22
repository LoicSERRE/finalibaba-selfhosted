#!/bin/bash
# Sync application files from the private Finalibaba repo to this selfhosted repo.
# Excludes personal infra files (CI/CD pipeline, VPS config, personal credentials).
# Always review `git diff` after running — never commit blindly.
#
# Usage: ./scripts/sync-from-upstream.sh [path/to/upstream]
# Default upstream path: /mnt/c/Projets/Finalibaba

set -e

UPSTREAM="${1:-/mnt/c/Projets/Finalibaba}"
SELFHOSTED="$(dirname "$(dirname "$(realpath "$0")")")"

if [ ! -d "$UPSTREAM" ]; then
  echo "Error: upstream directory not found at $UPSTREAM"
  echo "Usage: ./scripts/sync-from-upstream.sh [path/to/upstream]"
  exit 1
fi

echo "→ Syncing from $UPSTREAM"
echo "→ Into       $SELFHOSTED"
echo ""

rsync -av --delete \
  --exclude='.git/' \
  --exclude='.github/' \
  --exclude='docker-compose.server.yml' \
  --exclude='docker-compose.yml' \
  --exclude='docker-compose.dev.yml' \
  --exclude='env.server.example' \
  --exclude='.env' \
  --exclude='.env.example' \
  --exclude='CLAUDE.md' \
  --exclude='README.md' \
  --exclude='AGENTS.md' \
  --exclude='ROADMAP.md' \
  --exclude='LICENSE' \
  --exclude='CONTRIBUTING.md' \
  --exclude='scripts/' \
  --exclude='components/sidebar-wrapper.tsx' \
  --exclude='components/sidebar-dynamic.tsx' \
  --exclude='messages/' \
  --exclude='node_modules/' \
  --exclude='.next/' \
  --exclude='*.log' \
  "$UPSTREAM/" "$SELFHOSTED/"

echo ""
echo "✓ Sync complete."
echo ""
echo "Next steps:"
echo "  1. git diff — verify no personal files were copied"
echo "  2. Translate any new French code comments to English"
echo "  3. If a new sync module was added, add a credential guard in sync/main.py"
echo "  4. git add -p && git commit (message in English)"
