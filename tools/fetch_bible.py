#!/usr/bin/env python3
"""Download and normalise the World English Bible and the King James Version.

Writes one JSON file per book per edition, in the text schema from
docs/architecture/data-schemas.md:

    data/texts/web/genesis.json
    data/texts/kjv/genesis.json

    { "title": "Genesis", "edition": "WEB",
      "sections": [ { "name": "1", "units": ["In the beginning, ...", ...] } ] }

`sections` are chapters, `units` are verses. Nothing downstream knows that; a
Gutenberg novel imported by tools/import_gutenberg.py has the same shape with
chapters and paragraphs.

Provenance and licensing
------------------------
Both texts are public domain and are fetched from publishers who say so.

* **World English Bible** — a modern-English revision of the American Standard
  Version of 1901, published by eBible.org / Michael Paul Johnson, who has
  placed it in the **public domain** (the preface bundled in every eBible.org
  archive states: "the World English Bible is in the Public Domain (not
  copyrighted)"). Primary download: ``https://ebible.org/Scriptures/eng-web_usfx.zip``.
* **King James Version** (1769 Blayney text) — published 1611/1769, **public
  domain in the United States and in every jurisdiction except the United
  Kingdom**, where it is perpetual Crown copyright administered by letters
  patent. This project is distributed from the US. Primary download:
  ``https://ebible.org/Scriptures/eng-kjv_usfx.zip``.

Neither is the NET Bible or any other restricted text — see
docs/decisions/0002-web-and-kjv-not-net.md.

Sources are tried in order, so a dead host is survivable:

1. **eBible.org USFX** — the canonical publisher for both editions. One zipped
   XML file per edition; footnotes, cross-references, section headings and
   Strong's-number markup are structured, so they can be dropped exactly rather
   than guessed at with a regex.
2. **getbible.net v2** — ``https://api.getbible.net/v2/{web,kjv}/{book}.json``,
   pre-split into chapters and verses. Used only if eBible.org is unreachable.
   Its WEB text carries some leaked USFM footnote runs (``/f + ... /f*``) which
   the normaliser strips.

Everything written is validated before it lands: chapter counts for all 66
books and verse counts for a reference set of chapters, plus a character
whitelist. A mismatch aborts the run rather than writing bad data.

Standard library only. Usage:

    python3 tools/fetch_bible.py                # both editions
    python3 tools/fetch_bible.py --edition web  # one
    python3 tools/fetch_bible.py --no-cache     # ignore the download cache
"""
from __future__ import annotations

import argparse
import io
import json
import re
import ssl
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXTS = ROOT / "data" / "texts"

# api.getbible.net rejects the default Python-urllib agent with a 403.
USER_AGENT = "Mozilla/5.0 (compatible; scriptorium-fetch-bible/1.0)"
TIMEOUT_S = 300

# A python.org build on macOS ships with no CA bundle of its own, so a plain
# urlopen() fails cert verification even though the system trusts the host.
# Fall back to the OS trust store rather than to an unverified context.
CA_BUNDLES = (
    "/etc/ssl/cert.pem",                     # macOS / LibreSSL
    "/etc/ssl/certs/ca-certificates.crt",    # Debian, Ubuntu, Alpine
    "/etc/pki/tls/certs/ca-bundle.crt",      # Fedora, RHEL
    "/usr/local/etc/openssl/cert.pem",       # Homebrew OpenSSL
)


# --- the canon ---------------------------------------------------------------
# (USFX id, getbible book number, title, chapters)
# Chapter counts are the reference table asserted against whatever is fetched.
BOOKS: list[tuple[str, int, str, int]] = [
    ("GEN", 1, "Genesis", 50),
    ("EXO", 2, "Exodus", 40),
    ("LEV", 3, "Leviticus", 27),
    ("NUM", 4, "Numbers", 36),
    ("DEU", 5, "Deuteronomy", 34),
    ("JOS", 6, "Joshua", 24),
    ("JDG", 7, "Judges", 21),
    ("RUT", 8, "Ruth", 4),
    ("1SA", 9, "1 Samuel", 31),
    ("2SA", 10, "2 Samuel", 24),
    ("1KI", 11, "1 Kings", 22),
    ("2KI", 12, "2 Kings", 25),
    ("1CH", 13, "1 Chronicles", 29),
    ("2CH", 14, "2 Chronicles", 36),
    ("EZR", 15, "Ezra", 10),
    ("NEH", 16, "Nehemiah", 13),
    ("EST", 17, "Esther", 10),
    ("JOB", 18, "Job", 42),
    ("PSA", 19, "Psalms", 150),
    ("PRO", 20, "Proverbs", 31),
    ("ECC", 21, "Ecclesiastes", 12),
    ("SNG", 22, "Song of Songs", 8),
    ("ISA", 23, "Isaiah", 66),
    ("JER", 24, "Jeremiah", 52),
    ("LAM", 25, "Lamentations", 5),
    ("EZK", 26, "Ezekiel", 48),
    ("DAN", 27, "Daniel", 12),
    ("HOS", 28, "Hosea", 14),
    ("JOL", 29, "Joel", 3),
    ("AMO", 30, "Amos", 9),
    ("OBA", 31, "Obadiah", 1),
    ("JON", 32, "Jonah", 4),
    ("MIC", 33, "Micah", 7),
    ("NAM", 34, "Nahum", 3),
    ("HAB", 35, "Habakkuk", 3),
    ("ZEP", 36, "Zephaniah", 3),
    ("HAG", 37, "Haggai", 2),
    ("ZEC", 38, "Zechariah", 14),
    ("MAL", 39, "Malachi", 4),
    ("MAT", 40, "Matthew", 28),
    ("MRK", 41, "Mark", 16),
    ("LUK", 42, "Luke", 24),
    ("JHN", 43, "John", 21),
    ("ACT", 44, "Acts", 28),
    ("ROM", 45, "Romans", 16),
    ("1CO", 46, "1 Corinthians", 16),
    ("2CO", 47, "2 Corinthians", 13),
    ("GAL", 48, "Galatians", 6),
    ("EPH", 49, "Ephesians", 6),
    ("PHP", 50, "Philippians", 4),
    ("COL", 51, "Colossians", 4),
    ("1TH", 52, "1 Thessalonians", 5),
    ("2TH", 53, "2 Thessalonians", 3),
    ("1TI", 54, "1 Timothy", 6),
    ("2TI", 55, "2 Timothy", 4),
    ("TIT", 56, "Titus", 3),
    ("PHM", 57, "Philemon", 1),
    ("HEB", 58, "Hebrews", 13),
    ("JAS", 59, "James", 5),
    ("1PE", 60, "1 Peter", 5),
    ("2PE", 61, "2 Peter", 3),
    ("1JN", 62, "1 John", 5),
    ("2JN", 63, "2 John", 1),
    ("3JN", 64, "3 John", 1),
    ("JUD", 65, "Jude", 1),
    ("REV", 66, "Revelation", 22),
]

# Verse counts for a reference set of chapters. Every chapter a route touches,
# plus the classic spot-checks. Both editions must agree with these.
REFERENCE_VERSES: dict[tuple[str, int], int] = {
    ("Genesis", 1): 31,
    ("Genesis", 3): 24,
    ("Genesis", 22): 24,
    ("Genesis", 50): 26,
    ("Exodus", 3): 22,
    ("Exodus", 12): 51,
    ("Exodus", 16): 36,
    ("Exodus", 20): 26,
    ("Numbers", 21): 35,
    ("Psalms", 22): 31,
    ("Psalms", 23): 6,
    ("Psalms", 117): 2,
    ("Psalms", 119): 176,
    ("Psalms", 150): 6,
    ("Isaiah", 53): 12,
    ("Jonah", 1): 17,
    ("Jonah", 2): 10,
    ("Jonah", 4): 11,
    ("Matthew", 12): 50,
    ("Matthew", 27): 66,
    ("John", 1): 51,
    ("John", 3): 36,
    ("John", 6): 71,
    ("John", 8): 59,
    ("John", 10): 42,
    ("John", 19): 42,
    ("John", 21): 25,
    ("Revelation", 22): 21,
}

EDITIONS = {
    "web": {
        "label": "WEB",
        "name": "World English Bible",
        "usfx_url": "https://ebible.org/Scriptures/eng-web_usfx.zip",
        "usfx_alt": "https://ebible.org/Scriptures/engwebp_usfx.zip",
        "getbible": "web",
    },
    "kjv": {
        "label": "KJV",
        "name": "King James Version",
        "usfx_url": "https://ebible.org/Scriptures/eng-kjv_usfx.zip",
        "usfx_alt": "https://ebible.org/Scriptures/eng-kjv2006_usfx.zip",
        "getbible": "kjv",
    },
}

# `Psalm 23` is how a psalm is cited, and how docs/design/04-route.md and
# data/scenes/bible.json spell it; `Psalms` is the book's title. Both must
# resolve, because tools/validate_data.py -- and core/ at runtime -- turn a
# passage reference straight into a filename. So Psalms is written twice.
FILENAME_ALIASES: dict[str, list[str]] = {"Psalms": ["Psalm"]}


def stem(title: str) -> str:
    """Filename convention: lowercased title, spaces removed.

    Matches tools/validate_data.py's chapter_text():
    `book.lower().replace(' ', '')` -- so `1 Corinthians` -> `1corinthians`.
    """
    return title.lower().replace(" ", "")


# --- normalisation -----------------------------------------------------------

# The player has to be able to *type* every live character, and the curriculum
# in docs/design/06-curriculum.md only ever teaches US-ANSI keys. A curly
# apostrophe or an em dash would be permanently untypable, so typographic
# punctuation is folded onto its ASCII equivalent.
_PUNCT = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'",
    # KJV ligatures: "Caesar", "Aenon". The player cannot type an ash.
    "æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe",
    # The KJV's square brackets around 1 John 2:23b are a printer's mark, not
    # prose; keep the words, drop the brackets.
    "[": "", "]": "",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-",
    "―": "-", "−": "-",
    "…": "...",
    " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
    " ": " ", " ": " ",
    # markup that carries no prose
    "¶": "", "­": "", "​": "", "﻿": "",
    "†": "", "‡": "", "§": "", "∗": "",
    "ʼ": "'", "´": "'", "`": "'",
}
_TRANSLATION = {ord(k): v for k, v in _PUNCT.items()}

# Leaked USFM footnote / cross-reference runs, as seen in getbible's WEB text:
#   "cherubim/f + cherubim are powerful angelic creatures ... /f* at the east"
_FOOTNOTE_RUN = re.compile(r"[\\/](f|fe|ef|x|ex)\b.*?[\\/]\1\*", re.S)
# Any surviving USFM control word: a backslash or slash followed by a short tag.
_STRAY_TAG = re.compile(r"[\\/](?:f|fe|ef|x|ex|fr|ft|fq|fqa|fk|fv|fp|xo|xt|xk|wj|nd|add|w)\*?")
# "[1]" / "{2}" style verse-number artefacts some mirrors leave behind.
_VERSE_ARTEFACT = re.compile(r"^\s*[\[{(]\s*\d+\s*[\]})]\s*")

ALLOWED = set(
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    " .,;:!?'\"()-"
)


def normalise(raw: str) -> str:
    """Turn one source verse into clean, typable UTF-8 prose."""
    t = raw.translate(_TRANSLATION)
    t = _FOOTNOTE_RUN.sub("", t)
    t = _STRAY_TAG.sub(" ", t)
    t = _VERSE_ARTEFACT.sub("", t)
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)   # footnote removal can strand punctuation
    t = re.sub(r"\(\s+", "(", t)
    t = re.sub(r"\s+\)", ")", t)
    t = re.sub(r"-{2,}", "-", t)
    return t.strip()


# --- source 1: eBible.org USFX ----------------------------------------------

# USFX elements whose *content* is apparatus, not scripture: footnotes, cross
# references, section headings, psalm superscriptions, running heads, tables of
# contents. Their text is dropped; verse markers found inside them are not
# (see USFX_MARKERS and the flush-on-next-verse rule in _parse_usfx_book).
USFX_DROP = {
    "f", "fe", "ef", "x", "ex", "fig", "rem", "note",
    "fr", "ft", "fq", "fqa", "fk", "fv", "fp", "fl", "fdc", "fm",
    "xo", "xt", "xk", "xq", "xot", "xnt", "xdc", "ref",
    "toc", "h", "id", "ide", "cl", "cp", "ca", "va", "vp",
    "s", "ms", "mr", "sr", "r", "d", "sp", "iex", "ie", "periph",
    "wh", "wg", "wr", "k",
}
USFX_MARKERS = {"c", "v", "ve"}


def _parse_usfx_book(book_el: ET.Element) -> dict[str, list[tuple[str, str]]]:
    """-> {chapter: [(verse_id, text)]} for one <book> element."""
    out: dict[str, list[tuple[str, str]]] = {}
    state = {"chapter": None, "verse": None, "buf": []}

    def flush():
        if state["verse"] is not None and state["chapter"] is not None:
            text = normalise("".join(state["buf"]))
            if text:
                out.setdefault(state["chapter"], []).append((state["verse"], text))
        state["verse"] = None
        state["buf"] = []

    def walk(el: ET.Element, collecting: bool):
        tag = el.tag
        if tag == "c":
            flush()
            state["chapter"] = el.get("id")
        elif tag == "v":
            # A <ve/> can be swallowed by a dropped element -- WEB's Psalm 119
            # closes verse 8 inside the <d>BETH</d> acrostic heading -- so a new
            # verse marker also ends the previous one.
            flush()
            state["verse"] = el.get("id")
            state["buf"] = []
        elif tag == "ve":
            flush()

        collect_here = collecting and tag not in USFX_DROP
        if tag not in USFX_MARKERS and collect_here and el.text and state["verse"]:
            state["buf"].append(el.text)
        for child in el:
            walk(child, collect_here)
        if collecting and el.tail and state["verse"]:
            state["buf"].append(el.tail)

    for child in book_el:
        walk(child, True)
    flush()
    return out


def fetch_usfx(edition: str, cache: Path | None, alt: bool = False) -> dict[str, dict[str, list[str]]]:
    meta = EDITIONS[edition]
    url = meta["usfx_alt"] if alt else meta["usfx_url"]
    blob = _download(url, cache)
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist() if n.endswith("usfx.xml")]
        if not names:
            raise RuntimeError(f"{url}: no usfx.xml inside the archive")
        xml = zf.read(names[0])
    root = ET.fromstring(xml)
    by_id = {b.get("id"): b for b in root.findall("book")}

    books: dict[str, dict[str, list[str]]] = {}
    for usfx_id, _nr, title, _chapters in BOOKS:
        el = by_id.get(usfx_id)
        if el is None:
            raise RuntimeError(f"{url}: book {usfx_id} ({title}) missing")
        parsed = _parse_usfx_book(el)
        books[title] = {
            ch: [text for _vid, text in verses]
            for ch, verses in parsed.items()
        }
        # verse ids are needed for the count check; stash spans separately
        books[title]["_ids"] = [  # type: ignore[assignment]
            f"{ch}:{vid}" for ch, verses in parsed.items() for vid, _t in verses
        ]
    return books


# --- source 2: getbible.net v2 ----------------------------------------------

def fetch_getbible(edition: str, cache: Path | None) -> dict[str, dict[str, list[str]]]:
    slug = EDITIONS[edition]["getbible"]
    books: dict[str, dict[str, list[str]]] = {}
    for _usfx_id, nr, title, _chapters in BOOKS:
        url = f"https://api.getbible.net/v2/{slug}/{nr}.json"
        doc = json.loads(_download(url, cache).decode("utf-8"))
        chapters: dict[str, list[str]] = {}
        ids: list[str] = []
        for ch in doc["chapters"]:
            name = str(ch["chapter"])
            units = []
            for v in ch["verses"]:
                text = normalise(v["text"])
                if text:
                    units.append(text)
                    ids.append(f"{name}:{v['verse']}")
            chapters[name] = units
        chapters["_ids"] = ids  # type: ignore[assignment]
        books[title] = chapters
        print(f"      {title}", end="\r", file=sys.stderr)
    return books


# --- download ----------------------------------------------------------------

def ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    if ctx.cert_store_stats()["x509_ca"]:
        return ctx
    for bundle in CA_BUNDLES:
        if Path(bundle).exists():
            return ssl.create_default_context(cafile=bundle)
    return ctx


def _download(url: str, cache: Path | None) -> bytes:
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)
        key = cache / re.sub(r"[^A-Za-z0-9._-]+", "_", url)
        if key.exists():
            return key.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=ssl_context()) as resp:
        blob = resp.read()
    if cache is not None:
        key.write_bytes(blob)
    return blob


# --- validation --------------------------------------------------------------

def _verse_span(vid: str) -> int:
    """'4' -> 1, '4-5' -> 2. Some editions merge verses under one marker."""
    m = re.match(r"^(\d+)[a-z]?(?:-(\d+)[a-z]?)?$", vid)
    if not m:
        return 1
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    return max(1, b - a + 1)


def validate(edition: str, books: dict[str, dict[str, list[str]]]) -> list[str]:
    errors: list[str] = []
    label = EDITIONS[edition]["label"]

    for _usfx_id, _nr, title, chapters in BOOKS:
        got = books.get(title)
        if not got:
            errors.append(f"{label}: {title} missing entirely")
            continue
        names = [k for k in got if k != "_ids"]
        if len(names) != chapters:
            errors.append(
                f"{label}: {title} has {len(names)} chapters, expected {chapters}"
            )
        for n in range(1, chapters + 1):
            if str(n) not in got:
                errors.append(f"{label}: {title} {n} missing")
            elif not got[str(n)]:
                errors.append(f"{label}: {title} {n} is empty")

    ids_by_book = {t: books.get(t, {}).get("_ids", []) for _i, _n, t, _c in BOOKS}
    for (title, chapter), expected in sorted(REFERENCE_VERSES.items()):
        prefix = f"{chapter}:"
        spans = [
            _verse_span(i.split(":", 1)[1])
            for i in ids_by_book.get(title, [])
            if i.startswith(prefix)
        ]
        got = sum(spans)
        if got != expected:
            errors.append(
                f"{label}: {title} {chapter} has {got} verses, expected {expected}"
            )

    # character whitelist -- anything outside it would be untypable
    bad: dict[str, tuple[str, str]] = {}
    for _i, _n, title, _c in BOOKS:
        for name, units in books.get(title, {}).items():
            if name == "_ids":
                continue
            for unit in units:
                for chunk in unit:
                    if chunk not in ALLOWED and chunk not in bad:
                        bad[chunk] = (f"{title} {name}", unit[:90])
    for chunk, (where, sample) in sorted(bad.items()):
        errors.append(
            f"{label}: untypable character {chunk!r} (U+{ord(chunk):04X}) in {where}: {sample!r}"
        )
    return errors


# --- writing -----------------------------------------------------------------

def write_edition(edition: str, books: dict[str, dict[str, list[str]]]) -> int:
    label = EDITIONS[edition]["label"]
    out_dir = TEXTS / edition
    out_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for _usfx_id, _nr, title, chapters in BOOKS:
        doc = {
            "title": title,
            "edition": label,
            "sections": [
                {"name": str(n), "units": books[title][str(n)]}
                for n in range(1, chapters + 1)
            ],
        }
        blob = json.dumps(doc, ensure_ascii=False, indent=1) + "\n"
        for name in [stem(title)] + [stem(a) for a in FILENAME_ALIASES.get(title, [])]:
            (out_dir / f"{name}.json").write_text(blob, encoding="utf-8")
            written += 1
    return written


# --- driver ------------------------------------------------------------------

def fetch_edition(edition: str, cache: Path | None) -> dict[str, dict[str, list[str]]]:
    attempts = [
        ("eBible.org USFX", lambda: fetch_usfx(edition, cache)),
        ("eBible.org USFX (alternate edition)", lambda: fetch_usfx(edition, cache, alt=True)),
        ("getbible.net v2", lambda: fetch_getbible(edition, cache)),
    ]
    last: Exception | None = None
    for name, call in attempts:
        print(f"    source: {name}", file=sys.stderr)
        try:
            books = call()
        except (urllib.error.URLError, OSError, RuntimeError, ET.ParseError,
                zipfile.BadZipFile, json.JSONDecodeError, KeyError) as exc:
            print(f"      unavailable: {exc}", file=sys.stderr)
            last = exc if isinstance(exc, Exception) else None
            continue
        errors = validate(edition, books)
        if errors:
            print(f"      rejected, {len(errors)} validation problem(s):", file=sys.stderr)
            for e in errors[:12]:
                print(f"        {e}", file=sys.stderr)
            if len(errors) > 12:
                print(f"        ... and {len(errors) - 12} more", file=sys.stderr)
            last = RuntimeError(f"{name}: {errors[0]}")
            continue
        return books
    raise SystemExit(f"fetch_bible: every source failed for {edition}: {last}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--edition", choices=sorted(EDITIONS), action="append",
                    help="fetch only this edition (repeatable). Default: both.")
    ap.add_argument("--cache", type=Path,
                    default=Path(tempfile.gettempdir()) / "scriptorium-bible-cache",
                    help="where raw downloads are kept, so a re-run is offline")
    ap.add_argument("--no-cache", action="store_true",
                    help="always re-download, and keep nothing")
    args = ap.parse_args()

    editions = args.edition or ["web", "kjv"]
    cache = None if args.no_cache else args.cache

    total_files = 0
    for edition in editions:
        meta = EDITIONS[edition]
        print(f"  {meta['label']} -- {meta['name']}", file=sys.stderr)
        books = fetch_edition(edition, cache)
        n = write_edition(edition, books)
        total_files += n
        verses = sum(
            len(u) for t in books.values() for k, u in t.items() if k != "_ids"
        )
        print(f"    ok: {len(BOOKS)} books, {verses} verses, {n} files"
              f" -> data/texts/{edition}/", file=sys.stderr)

    size = sum(p.stat().st_size for p in TEXTS.rglob("*.json"))
    print(f"  data/texts: {total_files} files, {size / 1_048_576:.1f} MiB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
