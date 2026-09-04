#!/usr/bin/env python3
"""Which authentication mechanism does each supported bank actually need?

Woob modules DECLARE how they authenticate - the exceptions they raise and the
transient config fields they expose - so this can be answered by reading the
catalogue, with no bank account and no network beyond fetching the modules.

**Why this exists.** Every authentication gap in this project was discovered the
same expensive way: a user opened an issue, and it turned out a whole family of
banks had never worked. Issue #51 (Amundi) alone uncovered three, and the audit
that followed found 24 of 95 banks were structurally unable to connect - the
captcha ones, the ones needing a phone approval, and every TwoFactorBrowser bank
whose state was never persisted. None of that needed a bank account to find.

Run it at every Woob upgrade. `--check` compares against the committed baseline
and fails on any drift, so a new mechanism arriving in a new Woob release shows
up as a CI failure rather than as somebody's broken bank three months later.

Usage:
    python3 scripts/audit-bank-modules.py            # human report
    python3 scripts/audit-bank-modules.py --check    # fail on drift vs baseline
    python3 scripts/audit-bank-modules.py --update   # rewrite the baseline
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

BASELINE = Path(__file__).resolve().parent.parent / "sync" / "bank-capabilities.json"

# mechanism -> (regex matched against the module source, do we drive it?)
#
# "handled" means this project has a real path for it, not merely that it does
# not crash. `browser_redirect` and `action_needed` are deliberately reported as
# unsupported: see sync_woob.py's own branches for why neither can be driven.
SIGNALS: dict[str, tuple[str, bool]] = {
    "captcha": (
        r"\b(CaptchaQuestion|RecaptchaV2Question|RecaptchaV3Question|RecaptchaQuestion"
        r"|ImageCaptchaQuestion|GeetestQuestion|FuncaptchaQuestion|HcaptchaQuestion"
        r"|TurnstileQuestion)\b",
        True,
    ),
    "app_validation": (r"\b(AppValidation|DecoupledValidation)\b", True),
    "otp": (r"\b(BrowserQuestion|SentOTPQuestion|OfflineOTPQuestion|OTPQuestion)\b", True),
    "two_factor": (r"\bTwoFactorBrowser\b", True),
    "browser_redirect": (r"\bBrowserRedirect\b", False),
    "action_needed": (r"\bActionNeeded\b", False),
}

# Transient config fields a module declares. Each one is something the caller
# must SET for that bank to get past its login - missing any of them is a silent
# dead end rather than an error, which is exactly how they went unnoticed.
FIELDS = ("captcha_response", "request_information", "resume")


def collect() -> dict[str, dict[str, bool]]:
    from woob.core import Woob
    from woob.core.repositories import IProgress

    class Quiet(IProgress):
        def progress(self, percent, message): pass
        def error(self, message): pass
        def prompt(self, message): return True

    woob = Woob()
    infos = woob.repositories.get_all_modules_info()
    banks = sorted(n for n, i in infos.items() if "CapBank" in i.capabilities)
    print(f"{len(banks)} CapBank modules in the catalogue", file=sys.stderr)

    for name in banks:
        try:
            woob.repositories.install(name, progress=Quiet())
        except Exception as e:  # a module can be withdrawn or renamed upstream
            print(f"  skipped {name}: {type(e).__name__}", file=sys.stderr)

    modules_dir = Path(woob.repositories.modules_dir)
    rows: dict[str, dict[str, bool]] = {}
    for name in banks:
        directory = modules_dir / name
        if not directory.is_dir():
            continue
        source = ""
        for path in directory.rglob("*.py"):
            try:
                source += path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass
        row = {key: bool(re.search(rx, source)) for key, (rx, _) in SIGNALS.items()}
        for field in FIELDS:
            row[f"needs_{field}"] = bool(re.search(rf'ValueTransient\(\s*["\']{field}["\']', source))
        rows[name] = row
    return rows


def report(rows: dict[str, dict[str, bool]]) -> None:
    total = len(rows)
    def count(key): return sum(1 for v in rows.values() if v.get(key))

    print(f"\n=== {total} CapBank modules analysed ===\n")
    print(f"{'MECHANISM':<22}{'BANKS':>8}   DRIVEN BY THIS PROJECT?")
    for key, (_, handled) in SIGNALS.items():
        print(f"  {key:<20}{count(key):>6}/{total}   {'yes' if handled else 'no - reported as unsupported'}")
    print(f"\n{'CONFIG FIELD REQUIRED':<22}{'BANKS':>8}")
    for field in FIELDS:
        print(f"  {'needs_' + field:<20}{count('needs_' + field):>6}/{total}")

    needing_state = sorted(k for k, v in rows.items() if v.get("needs_resume") or v.get("two_factor"))
    print(f"\nBanks that cannot work without persisted state and a resume key: {len(needing_state)}")
    print("  " + ", ".join(needing_state))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the catalogue drifted from the baseline")
    parser.add_argument("--update", action="store_true", help="rewrite the baseline")
    args = parser.parse_args()

    rows = collect()
    report(rows)

    if args.update:
        BASELINE.write_text(json.dumps(rows, indent=1, sort_keys=True) + "\n")
        print(f"\nbaseline written to {BASELINE}")
        return 0

    if args.check:
        if not BASELINE.exists():
            print(f"\nNo baseline at {BASELINE} - run with --update first.", file=sys.stderr)
            return 1
        old = json.loads(BASELINE.read_text())
        added = sorted(set(rows) - set(old))
        removed = sorted(set(old) - set(rows))
        changed = sorted(k for k in set(rows) & set(old) if rows[k] != old[k])
        if not (added or removed or changed):
            print("\nNo drift: every bank still authenticates the way the baseline recorded.")
            return 0
        print("\nDRIFT DETECTED - a bank's authentication requirements changed.", file=sys.stderr)
        for name in added:
            print(f"  new bank      {name}: {rows[name]}", file=sys.stderr)
        for name in removed:
            print(f"  bank gone     {name}", file=sys.stderr)
        for name in changed:
            diff = {k: (old[name].get(k), rows[name].get(k)) for k in rows[name] if old[name].get(k) != rows[name].get(k)}
            print(f"  changed       {name}: {diff}", file=sys.stderr)
        print("\nReview whether sync_woob.py still drives these, then re-run with --update.", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
