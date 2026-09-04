#!/usr/bin/env python3
"""core/ must not reach for the platform.

Two layers, because one was not enough:

1. `tsconfig.core.json` typechecks core/ with the DOM library and @types/node
   EXCLUDED, so `document`, `window`, `fetch`, `localStorage`, `AudioContext`,
   `console`, `setTimeout` and friends are compile errors. The compiler knows
   the difference between a global and a variable that happens to share its
   name; a regex does not. check.sh runs it.

2. This script covers what layer 1 cannot: ambient time and randomness, which
   are genuine ES built-ins and so still in scope. They must be injected --
   see docs/architecture/core-purity.md#the-injected-seams.

Test files are exempt: purity is a property of the shipped core, not of the
harness that exercises it.

This check previously used `//.*$` with re.S, which -- because re.S makes `.`
match newlines -- deleted everything from the first line comment to the end of
the file, so it scanned almost nothing. It also matched bare identifiers, so
`const window = ...` (a trailing window of keystrokes) read as the browser
global. Both are why layer 1 exists.
"""
from __future__ import annotations
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Ambient sources of time and randomness. Everything else is caught by the
# compiler under tsconfig.core.json.
FORBIDDEN = ["Date.now", "new Date", "Math.random"]

COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)


def blank(src: str) -> str:
    """Strip comments, preserving line numbering."""
    return COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), src)


def main() -> int:
    files = [p for p in sorted((ROOT / "core").rglob("*.ts")) if not p.name.endswith(".test.ts")]
    bad = []
    for f in files:
        for lineno, line in enumerate(blank(f.read_text(encoding="utf-8")).splitlines(), 1):
            for tok in FORBIDDEN:
                if tok in line:
                    bad.append((f.relative_to(ROOT), lineno, tok, line.strip()))
    for path, lineno, tok, line in bad:
        print(f"  {path}:{lineno}: ambient '{tok}' -> {line[:70]}", file=sys.stderr)
    if bad:
        print(
            f"\n{len(bad)} ambient time/randomness use(s) in core/. Inject them instead:\n"
            "time as a dtMs parameter, randomness as a seeded PRNG (core/rng.ts).\n"
            "See docs/architecture/core-purity.md",
            file=sys.stderr,
        )
        return 1
    print(f"    core purity: {len(files)} module(s) free of ambient time and randomness")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
