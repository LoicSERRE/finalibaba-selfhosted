"""Local patches to downloaded Woob bank modules, applied right after install.

Woob installs modules under ~/.local/share/woob (not a volume), so a recreated
container starts with none and installs them on first use - see
sync_woob.ensure_module_installed. A patch therefore has to run after that
install and before the module is imported, not only at container start.
"""

from __future__ import annotations

import glob
import os
import re
import sys

_LCL_BROWSER_GLOB = "~/.local/share/woob/modules/*/woob_modules/lcl/browser.py"
_LCL_MARKER = "# PATCH_410"
_LCL_CALL = re.compile(r"( +)(if self\.go_bourse_website\(\) and self\.connexion_bourse\(\):)")


def patch_lcl_bourse_410(pattern: str = _LCL_BROWSER_GLOB) -> str:
    """LCL retired its bourse redirect in April 2026 (HTTP 410 during
    iter_accounts): treat any error there as "no bourse" so the checking and
    savings accounts are still fetched. Returns what it did, for the log."""
    candidates = [p for p in glob.glob(os.path.expanduser(pattern)) if "__pycache__" not in p]
    if not candidates:
        return "lcl/browser.py not found - skip"
    path = candidates[0]
    with open(path, encoding="utf-8") as f:
        content = f.read()
    if _LCL_MARKER in content:
        return "already applied"
    m = _LCL_CALL.search(content)
    if not m:
        return "pattern not found - LCL module format may have changed, skip"
    indent = m.group(1)
    patched = (
        f"{indent}try:  {_LCL_MARKER}\n"
        f"{indent}    _bourse_ok = self.go_bourse_website()\n"
        f"{indent}except Exception:\n"
        f"{indent}    _bourse_ok = False\n"
        f"{indent}if _bourse_ok and self.connexion_bourse():"
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(content[: m.start()] + patched + content[m.end() :])
    return f"go_bourse_website 410 fix applied at line {content[: m.start()].count(chr(10)) + 1}"


_PATCHES = {"lcl": patch_lcl_bourse_410}


def apply(module: str) -> str | None:
    """Patch one freshly installed module, if it has a patch."""
    patch = _PATCHES.get(module)
    return patch() if patch else None


if __name__ == "__main__":
    # entrypoint.sh: patch whatever `woob config update` left installed.
    for name in _PATCHES:
        print(f"[patch] {name}: {apply(name)}", file=sys.stdout)
