#!/usr/bin/env python3
"""No magic numbers in core/. Tunables come from data/tuning.json.

Allowed: 0, 1, -1, and any line marked `tuning-exempt`.
See docs/design/07-tuning.md
"""
from __future__ import annotations
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {"0", "1", "-1", "0.0", "1.0", "2"}
STRIP = re.compile(r"/\*.*?\*/|//[^\n]*|'[^'\n]*'|\"[^\"\n]*\"|`[^`]*`", re.S)


def blank(src: str) -> str:
    """Remove comments and string literals, preserving line numbering."""
    return STRIP.sub(lambda m: "\n" * m.group(0).count("\n"), src)
NUM = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])")


def main() -> int:
    bad = []
    files = sorted((ROOT / "core").rglob("*.ts"))
    for f in files:
        raw = f.read_text(encoding="utf-8").splitlines()
        for lineno, line in enumerate(blank(f.read_text(encoding="utf-8")).splitlines(), 1):
            if "tuning-exempt" in raw[lineno - 1]:
                continue
            for n in NUM.findall(line):
                if n not in ALLOWED:
                    bad.append((f.relative_to(ROOT), lineno, n, raw[lineno - 1].strip()))
    for path, lineno, n, line in bad:
        print(f"  {path}:{lineno}: magic number {n} -> {line[:70]}", file=sys.stderr)
    if bad:
        print(
            f"\n{len(bad)} magic number(s) in core/. Add them to docs/design/07-tuning.md\n"
            "and read from data/tuning.json, or mark the line `tuning-exempt`.",
            file=sys.stderr,
        )
        return 1
    print(f"    no magic numbers: {len(files)} module(s) clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
