#!/usr/bin/env python3
"""core/ must not reference any platform API.

See docs/architecture/core-purity.md
"""
from __future__ import annotations
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORBIDDEN = [
    "document", "window", "globalThis", "canvas", "AudioContext",
    "localStorage", "sessionStorage", "indexedDB", "fetch", "XMLHttpRequest",
    "Date.now", "new Date", "performance.now", "Math.random",
    "requestAnimationFrame", "setTimeout", "setInterval", "console",
]
COMMENT = re.compile(r"//.*$|/\*.*?\*/", re.S | re.M)


def main() -> int:
    files = sorted((ROOT / "core").rglob("*.ts"))
    bad = []
    for f in files:
        src = COMMENT.sub("", f.read_text(encoding="utf-8"))
        for lineno, line in enumerate(src.splitlines(), 1):
            for tok in FORBIDDEN:
                if re.search(rf"(?<![\w.]){re.escape(tok)}\b", line):
                    bad.append((f.relative_to(ROOT), lineno, tok, line.strip()))
    for path, lineno, tok, line in bad:
        print(f"  {path}:{lineno}: forbidden '{tok}' -> {line[:70]}", file=sys.stderr)
    if bad:
        print(
            f"\n{len(bad)} platform reference(s) in core/. Move them to platform/web/.\n"
            "See docs/architecture/core-purity.md",
            file=sys.stderr,
        )
        return 1
    print(f"    core purity: {len(files)} module(s) clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
