#!/bin/bash
set -e
echo "[entrypoint] Updating woob repositories..."
woob config update || echo "[entrypoint] woob config update failed (non-fatal)"

echo "[entrypoint] Patching LCL module (go_bourse_website 410 fix)..."
python3 << 'EOF'
import glob, os, re, sys

# LCL retired their bourse redirect in April 2026 → HTTP 410 during iter_accounts.
# Patch go_bourse_website() call to return False on any HTTP error instead of raising,
# so regular bank accounts (checking, savings) are still fetched.
# Version-agnostic glob (woob updates change the version subdirectory)
candidates = [
    p for p in glob.glob(os.path.expanduser("~/.local/share/woob/modules/*/woob_modules/lcl/browser.py"))
    if "__pycache__" not in p
]
path = candidates[0] if candidates else None
if not path:
    print("[patch] lcl/browser.py introuvable — skip")
    sys.exit(0)

content = open(path).read()
if "# PATCH_410" in content:
    print("[patch] Already applied")
    sys.exit(0)

m = re.search(r"( +)(if self\.go_bourse_website\(\) and self\.connexion_bourse\(\):)", content)
if not m:
    print("[patch] Pattern not found — LCL module format may have changed, skip")
    sys.exit(0)

indent = m.group(1)
patched = (
    f"{indent}try:  # PATCH_410\n"
    f"{indent}    _bourse_ok = self.go_bourse_website()\n"
    f"{indent}except Exception:\n"
    f"{indent}    _bourse_ok = False\n"
    f"{indent}if _bourse_ok and self.connexion_bourse():"
)
new_content = content[: m.start()] + patched + content[m.end() :]
open(path, "w").write(new_content)
line_no = content[: m.start()].count("\n") + 1
print(f"[patch] Applied go_bourse_website 410 fix at line {line_no}")
EOF

echo "[entrypoint] Starting sync service..."
exec python main.py
