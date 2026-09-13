#!/usr/bin/env python3
"""Count the files lizard reports ZERO functions for while they plainly have some.

Why this exists
---------------
`quality.yml`'s complexity ratchet gates on how many functions sit over lizard's
CCN threshold. That number is only meaningful for code lizard can actually
parse - and its JavaScript/TypeScript reader loses track of some TSX files
entirely, reporting `function_cnt 0` with no warning and exit code 0. A file in
that state contributes nothing to the count no matter how complex it gets, so
the ratchet reads green precisely where it has stopped looking.

Measured, not assumed: at the v2.10.5 boundary, 2 of 269 source files were in
that state, and a refactor of `app/settings/page.tsx` silently added a third -
its 41-CCN page function disappeared from the report and the warning count went
DOWN, which looks exactly like an improvement.

Two triggers are confirmed by bisection, both in TSX:
  * a top-level `type X = Readonly<{...}>` alias blinds the whole file from that
    point on (a plain object type with per-field `readonly` parses fine);
  * enough `{someBoolean && <Component />}` JSX gates in one function - around a
    dozen - and the enclosing function stops being reported. Writing the
    condition inline as `process.env.X !== "true"` happens to survive, which is
    luck rather than a style worth adopting.

This prints one number so the count can be ratcheted like any other. It is a
detector, not a fixer: a file listed here needs either a formulation lizard can
read or a deliberate, recorded acceptance.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

# Top-level named function declarations. Deliberately only these: an
# anonymous arrow assigned to a const is reported by lizard as "(anonymous)"
# and cannot be matched back by name, so it would produce false alarms. Named
# declarations are what the big page and component functions use here, and
# they are the ones worth never losing sight of.
DECLARED_FUNCTION = re.compile(
    r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)", re.MULTILINE
)

SKIP_DIRS = ("app/generated/", "node_modules/", ".next/")


def tracked_sources() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "*.ts", "*.tsx"], capture_output=True, text=True, check=True
    ).stdout.split()
    return [Path(p) for p in out if not p.startswith(SKIP_DIRS)]


def measured_names(path: Path) -> set[str]:
    """The function names lizard actually reports for this file."""
    # check=False on purpose: lizard exits non-zero for a file it cannot read,
    # and that is exactly the case this script exists to report rather than die on.
    res = subprocess.run(
        ["lizard", "--csv", str(path)], capture_output=True, text=True, check=False
    )
    names = set()
    for line in res.stdout.splitlines():
        # CSV: nloc,ccn,token,param,length,location,file,name,long_name,start,end
        fields = line.split(",")
        if len(fields) > 7:
            names.add(fields[7].strip('"'))
    return names


def main() -> int:
    blind: dict[str, list[str]] = {}
    for path in tracked_sources():
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        declared = set(DECLARED_FUNCTION.findall(source))
        if not declared:
            continue
        missing = sorted(declared - measured_names(path))
        if missing:
            blind[str(path)] = missing

    total = sum(len(v) for v in blind.values())
    for path in sorted(blind):
        print(f"{path}: lizard never reports {', '.join(blind[path])}")
    print(f"\n{total} declared function(s) lizard does not measure, "
          f"across {len(blind)} file(s).")

    Path("lizard-blind-spots.json").write_text(
        json.dumps({"unmeasured_count": total, "files": blind}, indent=2) + "\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
