#!/usr/bin/env python3
"""Measure real per-stage live coverage against the fetched corpus.

docs/design/06-curriculum.md ships a *predicted* coverage column derived from
English letter frequency, and docs/design/01-illumination.md#density says in as
many words that the estimate "must not be trusted". This is the measurement
that replaces it. It reads every book of both editions under data/texts/,
classifies every character exactly the way the game will, and writes
data/coverage.json.

Classification -- docs/design/01-illumination.md#classification
---------------------------------------------------------------
A character is **live** when every key it requires is in the current stage's
cumulative `keySet` from data/curriculum.json; otherwise it is **greyed**.

* space requires `<space>`, which stage 0 already has, so space is live
  throughout -- it is a thumb key and about 17% of all keystrokes;
* a capital requires its lowercase key *and* `<shift>`, so capitals stay greyed
  until stage 8, which is where `<shift>` is taught;
* shifted punctuation requires its unshifted key *and* `<shift>` on US ANSI --
  `"` needs `'`, `:` needs `;`, `?` needs `/`;
* a character the curriculum names as a key in its own right (stage 8 lists
  `:`) is live on that ground alone, so the doc's spelling always wins.

Coverage is the fraction of characters that are live -- one character, one
keystroke, capitals included, because that is what the player experiences on
the rail.

Drill vocabulary -- docs/design/01-illumination.md#density
----------------------------------------------------------
Words *fully* typable at a stage, frequency-ranked, for the drill interludes
between passages. A word is emitted as it appears in the text, so before stage
8 every drill word is lowercase; that is correct, not a bug.

Standard library only. Usage:

    python3 tools/build_wordlists.py
    python3 tools/build_wordlists.py --quiet
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_bible import BOOKS, FILENAME_ALIASES, stem  # noqa: E402  (same dir, no package)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TEXTS = DATA / "texts"
OUT = DATA / "coverage.json"

EDITIONS = ("web", "kjv")
GLOBAL_DRILL_WORDS = 200
PASSAGE_DRILL_WORDS = 20

# US ANSI shifted characters -> the unshifted key they sit on.
# docs/design/06-curriculum.md's "Keyboard layout" section makes US ANSI the
# default; layout affects the overlay only, never the key sets, so this map is
# the one the illumination invariant is measured against.
SHIFTED_TO_BASE = {
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6",
    "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=",
    "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "<": ",",
    ">": ".", "?": "/", "~": "`",
}

WORD = re.compile(r"[A-Za-z][A-Za-z']*")


def required_keys(ch: str) -> tuple[str, ...]:
    """Every key that must be taught before `ch` can be typed."""
    if ch.isspace():
        return ("<space>",)
    if ch.isupper() and ch.lower() != ch:
        return (ch.lower(), "<shift>")
    if ch in SHIFTED_TO_BASE:
        return (SHIFTED_TO_BASE[ch], "<shift>")
    return (ch,)


def live_chars(key_set: set[str]) -> set[str]:
    """The characters a player at this stage is asked to type."""
    universe = set(
        "abcdefghijklmnopqrstuvwxyz"
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        "0123456789"
        " .,;:!?'\"()-[]{}<>/\\|@#$%^&*_+=~`"
    )
    live = set()
    for ch in universe:
        if ch in key_set or all(k in key_set for k in required_keys(ch)):
            live.add(ch)
    return live


# --- corpus ------------------------------------------------------------------

def load_edition(edition: str) -> dict[str, dict[str, str]]:
    """-> {book title: {chapter: joined chapter text}}, canonical books only.

    Iterates the canon rather than globbing, so the `psalm.json` filename alias
    fetch_bible.py writes for `Psalm 23`-style citations is not counted twice.
    """
    books: dict[str, dict[str, str]] = {}
    for _usfx, _nr, title, _chapters in BOOKS:
        path = TEXTS / edition / f"{stem(title)}.json"
        if not path.exists():
            raise SystemExit(
                f"build_wordlists: {path} is missing. Run `make fetch` first."
            )
        doc = json.loads(path.read_text(encoding="utf-8"))
        books[title] = {s["name"]: " ".join(s["units"]) for s in doc["sections"]}
    return books


def parse_ref(ref: str) -> tuple[str, int, int]:
    """'Genesis 1' or 'Genesis 2-3' -> (book, first, last). Same rule as
    tools/validate_data.py, including its `Psalm` spelling."""
    m = re.match(r"^(.+?)\s+(\d+)(?:-(\d+))?$", ref.strip())
    if not m:
        raise SystemExit(f"build_wordlists: unparseable passage reference {ref!r}")
    return m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))


def passage_text(books: dict[str, dict[str, str]], ref: str) -> str:
    book, first, last = parse_ref(ref)
    # `Psalm 23` cites the book titled `Psalms`; resolve through the same
    # filename stems (and citation aliases) that fetch_bible.py writes and that
    # validate_data.py and core/ look a passage up by.
    if book not in books:
        by_stem = {stem(t): t for t in books}
        for title, aliases in FILENAME_ALIASES.items():
            for alias in aliases:
                by_stem.setdefault(stem(alias), title)
        book = by_stem.get(stem(book), book)
    if book not in books:
        raise SystemExit(f"build_wordlists: no text for {ref!r}")
    return " ".join(
        books[book][str(n)] for n in range(first, last + 1) if str(n) in books[book]
    )


# --- measurement -------------------------------------------------------------

def coverage(text: str, live: set[str]) -> tuple[int, int]:
    """-> (live characters, total characters)."""
    counts = Counter(text)
    total = sum(counts.values())
    lit = sum(n for ch, n in counts.items() if ch in live)
    return lit, total


def typable_words(freq: Counter, live: set[str], limit: int) -> list[str]:
    """Frequency-ranked words in which every character is live."""
    words = [w for w, _n in freq.most_common() if all(c in live for c in w)]
    return words[:limit]


def word_freq(text: str) -> Counter:
    return Counter(WORD.findall(text))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--quiet", action="store_true", help="write the file, print nothing")
    args = ap.parse_args()

    curriculum = json.loads((DATA / "curriculum.json").read_text(encoding="utf-8"))
    tuning = json.loads((DATA / "tuning.json").read_text(encoding="utf-8"))
    route = json.loads((DATA / "routes" / "pilgrimage.json").read_text(encoding="utf-8"))
    floor = float(tuning["values"]["min_stage1_coverage"])

    corpus = {ed: load_edition(ed) for ed in EDITIONS}
    whole = {ed: " ".join(ch for bk in corpus[ed].values() for ch in bk.values())
             for ed in EDITIONS}
    corpus_freq = {ed: word_freq(whole[ed]) for ed in EDITIONS}
    merged_freq = Counter()
    for ed in EDITIONS:
        merged_freq.update(corpus_freq[ed])

    passages = sorted({p for e in route["edges"] for p in (e["from"], e["to"])})
    passage_text_by_ed = {
        ref: {ed: passage_text(corpus[ed], ref) for ed in EDITIONS} for ref in passages
    }

    stages_out = []
    passages_out: dict[str, dict] = {
        ref: {"characters": {}, "coverage": {}, "drillWords": {}} for ref in passages
    }
    report_rows = []

    for stage in curriculum["stages"]:
        n = stage["stage"]
        key_set = set(stage["keySet"])
        live = live_chars(key_set)

        by_edition = {}
        for ed in EDITIONS:
            lit, total = coverage(whole[ed], live)
            by_edition[ed] = round(lit / total, 4) if total else 0.0
        mean = round(sum(by_edition.values()) / len(by_edition), 4)

        genesis = {}
        for ed in EDITIONS:
            lit, total = coverage(" ".join(corpus[ed]["Genesis"].values()), live)
            genesis[ed] = round(lit / total, 4) if total else 0.0

        drill = typable_words(merged_freq, live, GLOBAL_DRILL_WORDS)
        drill_total = sum(
            1 for w in merged_freq if all(c in live for c in w)
        )

        for ref in passages:
            per_ed = {}
            for ed in EDITIONS:
                text = passage_text_by_ed[ref][ed]
                lit, total = coverage(text, live)
                per_ed[ed] = round(lit / total, 4) if total else 0.0
                passages_out[ref]["characters"][ed] = total
            passages_out[ref]["coverage"].setdefault("web", []).append(per_ed["web"])
            passages_out[ref]["coverage"].setdefault("kjv", []).append(per_ed["kjv"])
            passages_out[ref]["coverage"].setdefault("mean", []).append(
                round(sum(per_ed.values()) / len(per_ed), 4)
            )
            local = Counter()
            for ed in EDITIONS:
                local.update(word_freq(passage_text_by_ed[ref][ed]))
            passages_out[ref]["drillWords"][str(n)] = typable_words(
                local, live, PASSAGE_DRILL_WORDS
            )

        stages_out.append({
            "stage": n,
            "keys": stage["keys"],
            "keySet": stage["keySet"],
            "predictedCoverage": stage["predictedCoverage"],
            "measuredCoverage": mean,
            "byEdition": by_edition,
            "genesisCoverage": genesis,
            "drillWordCount": drill_total,
            "drillWords": drill,
        })
        report_rows.append((n, stage["predictedCoverage"], mean, by_edition,
                            genesis, drill_total, drill[:8]))

    doc = {
        "editions": list(EDITIONS),
        "corpus": {
            ed: {
                "books": len(corpus[ed]),
                "chapters": sum(len(b) for b in corpus[ed].values()),
                "characters": len(whole[ed]),
                "words": sum(corpus_freq[ed].values()),
                "distinctWords": len(corpus_freq[ed]),
            }
            for ed in EDITIONS
        },
        "minStage1Coverage": floor,
        "stages": stages_out,
        "passages": passages_out,
        "_measured_by": "tools/build_wordlists.py",
        "_measured_from": "data/texts/**, data/curriculum.json",
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    stage1 = next(s for s in stages_out if s["stage"] == 1)["measuredCoverage"]

    if not args.quiet:
        print(f"  measured over {doc['corpus']['web']['characters']:,} chars (WEB) "
              f"+ {doc['corpus']['kjv']['characters']:,} chars (KJV)")
        print()
        print("  stage  predicted  measured   WEB     KJV    Genesis  drill words")
        for n, pred, mean, by_ed, gen, dcount, sample in report_rows:
            print(f"  {n:>5}  {pred:>9.2f}  {mean:>8.4f}  "
                  f"{by_ed['web']:.4f}  {by_ed['kjv']:.4f}  "
                  f"{(gen['web'] + gen['kjv']) / 2:.4f}   {dcount:>6,}"
                  f"  {' '.join(sample[:6])}")
        print()
        print(f"  wrote {OUT.relative_to(ROOT)}")
        print()

    if stage1 < floor:
        print(f"  STAGE 1 COVERAGE {stage1:.4f} IS BELOW THE FLOOR {floor:.2f}.",
              file=sys.stderr)
        print("  docs/design/01-illumination.md#density: the stage boundaries in",
              file=sys.stderr)
        print("  docs/design/06-curriculum.md move before anything else is built.",
              file=sys.stderr)
        return 1

    if not args.quiet:
        print(f"  stage 1 measured {stage1:.4f}, floor {floor:.2f} -- ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
