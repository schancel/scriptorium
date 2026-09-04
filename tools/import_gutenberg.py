#!/usr/bin/env python3
"""Turn a Project Gutenberg plain-text book into the Scriptorium text schema.

This is the seam that makes the corpus replaceable. docs/architecture/data-schemas.md
defines a book as an ordered set of named, numbered chunks, so *Sherlock Holmes*
and Genesis are structurally identical -- sections are chapters, units are
paragraphs instead of verses, and nothing downstream knows the difference:

    { "title": "Pride and Prejudice", "edition": "Project Gutenberg",
      "sections": [ { "name": "1", "units": ["It is a truth universally ..."] } ] }

An imported book has no scene file, so it renders entirely in the `abbey` theme
-- the documented and correct outcome, per docs/design/05-scenery-warps.md.

Public domain only. Project Gutenberg texts in the US are public domain, but the
PG *header and footer* carry a trademark licence, so both are stripped and
nothing of the PG boilerplate is kept.

Text is normalised through the same pass fetch_bible.py uses: typographic
punctuation folded onto the US-ANSI keys the curriculum actually teaches, so
every live character is one the player can be asked to type.

Standard library only. Usage:

    python3 tools/import_gutenberg.py 1342                 # by ebook number
    python3 tools/import_gutenberg.py pride.txt            # from a local file
    python3 tools/import_gutenberg.py https://.../1342.txt
    python3 tools/import_gutenberg.py 1342 --title "Pride and Prejudice"
    python3 tools/import_gutenberg.py 1342 --out data/texts/pg/pride.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_bible import (  # noqa: E402  (same directory, no package)
    ALLOWED,
    TIMEOUT_S,
    USER_AGENT,
    ssl_context,
    normalise,
    stem,
)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DIR = ROOT / "data" / "texts" / "gutenberg"
EDITION = "Project Gutenberg"

MIRROR = "https://www.gutenberg.org/ebooks/{n}.txt.utf-8"

START = re.compile(
    r"^\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*\s*$",
    re.I | re.M,
)
END = re.compile(
    r"^\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*\s*$",
    re.I | re.M,
)
# Pre-2007 texts used a different pair of banners.
OLD_START = re.compile(r"^\*END\*THE SMALL PRINT.*$", re.I | re.M)
OLD_END = re.compile(r"^End of (?:the )?Project Gutenberg.*$", re.I | re.M)

TITLE_LINE = re.compile(r"^Title:\s*(.+?)\s*$", re.M)
AUTHOR_LINE = re.compile(r"^Author:\s*(.+?)\s*$", re.M)

# Chapter headings. Every pattern is tried over the whole book and the one that
# yields the longest run numbered 1, 2, 3, ... wins, because no single shape
# fits Project Gutenberg -- "CHAPTER IV.", "IX. THE ADVENTURE OF ...", a bare
# "12." -- and guessing wrong silently mangles the book.
HEADINGS = [
    re.compile(r"^\s*(?:CHAPTER|LETTER|BOOK|PART|ACT|SCENE|STAVE|CANTO)\s+"
               r"([0-9]{1,3}|[IVXLCDM]{1,7})\b.*$", re.I),
    re.compile(r"^\s*([IVXLCDM]{1,7})\s*[.:]\s+\S.*$"),
    re.compile(r"^\s*([0-9]{1,3})\s*[.:]\s+\S.*$"),
    re.compile(r"^\s*([IVXLCDM]{1,7})\s*\.?\s*$"),
    re.compile(r"^\s*([0-9]{1,3})\s*\.?\s*$"),
]

# A table of contents lists every chapter one line apart. Real chapters are not
# that close together, so a heading with no room after it is a contents entry.
MIN_CHAPTER_LINES = 15

ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def roman_to_int(s: str) -> int | None:
    total, prev = 0, 0
    for ch in reversed(s.upper()):
        if ch not in ROMAN:
            return None
        v = ROMAN[ch]
        total += -v if v < prev else v
        prev = max(prev, v)
    return total or None


def read_source(target: str) -> str:
    if target.isdigit():
        target = MIRROR.format(n=target)
    if target.startswith(("http://", "https://")):
        req = urllib.request.Request(target, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=ssl_context()) as r:
            return r.read().decode("utf-8", errors="replace")
    path = Path(target)
    if not path.exists():
        raise SystemExit(f"import_gutenberg: no such file {target}")
    return path.read_text(encoding="utf-8", errors="replace")


def strip_boilerplate(raw: str) -> str:
    """Remove the Project Gutenberg header and footer, which are licensed."""
    body = raw
    m = START.search(body) or OLD_START.search(body)
    if m:
        body = body[m.end():]
    m = END.search(body) or OLD_END.search(body)
    if m:
        body = body[:m.start()]
    return body.strip("\n")


# Project Gutenberg's plain-text conventions: _underscores_ mark italics and a
# line of asterisks marks a scene break. Neither is prose, and neither is
# typable, so both go before normalisation.
PG_MARKUP = re.compile(r"_|^\s*[*\s]+$", re.M)


def split_paragraphs(block: str) -> list[str]:
    out = []
    for chunk in re.split(r"\n\s*\n", block):
        text = normalise(PG_MARKUP.sub("", chunk))
        if text:
            out.append(text)
    return out


def _headings(lines: list[str], pattern: re.Pattern) -> list[tuple[int, int]]:
    marks = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or len(stripped) > 75:
            continue
        m = pattern.match(line)
        if not m:
            continue
        token = m.group(1)
        n = int(token) if token.isdigit() else roman_to_int(token)
        if n is not None:
            marks.append((i, n))
    return marks


def _drop_contents(marks: list[tuple[int, int]], total: int) -> list[tuple[int, int]]:
    return [
        (i, n)
        for k, (i, n) in enumerate(marks)
        if (marks[k + 1][0] if k + 1 < len(marks) else total) - i >= MIN_CHAPTER_LINES
    ]


def _sequence(marks: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """The longest run reading 1, 2, 3, ... in order. Anything else is noise."""
    run, expect = [], 1
    for i, n in marks:
        if n == expect:
            run.append((i, n))
            expect += 1
    return run


def split_chapters(body: str) -> list[tuple[str, str]]:
    """-> [(section name, raw block)], front matter first and named 'front'."""
    lines = body.splitlines()
    best: list[tuple[int, int]] = []
    for pattern in HEADINGS:
        run = _sequence(_drop_contents(_headings(lines, pattern), len(lines)))
        if len(run) > len(best):
            best = run

    if len(best) < 3:
        # A short story, a poem, or a book whose headings we cannot read: one
        # section is honest, and the schema does not care.
        return [("front", ""), ("1", body)]

    out: list[tuple[str, str]] = [("front", "\n".join(lines[: best[0][0]]))]
    bounds = [i for i, _n in best] + [len(lines)]
    for (start, n), end in zip(best, bounds[1:]):
        out.append((str(n), "\n".join(lines[start + 1: end])))
    return out


def build(raw: str, title: str | None) -> dict:
    header = raw[: raw.find("***") if "***" in raw else 4000]
    body = strip_boilerplate(raw)

    if title is None:
        m = TITLE_LINE.search(header)
        title = m.group(1) if m else "Untitled"
    author = AUTHOR_LINE.search(header)

    sections = []
    for name, block in split_chapters(body):
        if name == "front":
            continue
        units = split_paragraphs(block)
        if units:
            sections.append({"name": name, "units": units})

    if not sections:
        raise SystemExit("import_gutenberg: no text found after stripping boilerplate")

    doc = {"title": title, "edition": EDITION, "sections": sections}
    if author:
        doc["author"] = author.group(1)
    return doc


def report_untypable(doc: dict) -> None:
    bad = Counter()
    for s in doc["sections"]:
        for u in s["units"]:
            bad.update(c for c in u if c not in ALLOWED)
    if bad:
        listing = ", ".join(
            f"{c!r} (U+{ord(c):04X}) x{n}" for c, n in bad.most_common(10)
        )
        print(f"  warning: {sum(bad.values())} character(s) outside the typable set: "
              f"{listing}", file=sys.stderr)
        print("  they will always render greyed. Extend the normaliser in "
              "tools/fetch_bible.py if any of them matter.", file=sys.stderr)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("source", help="ebook number, URL, or path to a .txt file")
    ap.add_argument("--title", help="override the title from the PG header")
    ap.add_argument("--out", type=Path, help="output path (default data/texts/gutenberg/)")
    args = ap.parse_args()

    doc = build(read_source(args.source), args.title)
    out = args.out or DEFAULT_DIR / f"{stem(doc['title'])}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    units = sum(len(s["units"]) for s in doc["sections"])
    print(f"  {doc['title']}: {len(doc['sections'])} section(s), {units} paragraph(s)"
          f" -> {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
    report_untypable(doc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
