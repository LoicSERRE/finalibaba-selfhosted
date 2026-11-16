#!/bin/bash
set -e
echo "[entrypoint] Updating woob repositories..."
woob config update || echo "[entrypoint] woob config update failed (non-fatal)"

# Only patches modules already installed; a module installed later on first use
# is patched there (sync_woob.ensure_module_installed).
echo "[entrypoint] Patching installed Woob modules..."
python3 woob_patches.py || echo "[entrypoint] module patching failed (non-fatal)"

echo "[entrypoint] Starting sync service..."
exec python main.py
