#!/usr/bin/env python3
"""Content invariants over generated + fetched data.

Route integrity, scene coverage, and warp echo phrases. Text-dependent checks
skip cleanly when data/texts/ has not been fetched yet.

See docs/design/04-route.md and docs/design/05-scenery-warps.md
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"


def load(rel):
    return json.loads((DATA / rel).read_text(encoding="utf-8"))


def parse_ref(ref: str):
    """'Genesis 1', 'Genesis 2-3' or 'Genesis 1:3-5' -> (book, first, last)

    A verse range names one chapter, so the chapter span of 'Genesis 1:3-5' is
    1-1. Use parse_range() when the verses matter.
    """
    book, a, b, _, _ = parse_range(ref)
    return book, a, b


def parse_range(ref: str):
    """-> (book, first_chapter, last_chapter, first_verse, last_verse)

    Verses are None on a chapter range. Mirrors parseReference in
    core/corpus.ts; see docs/architecture/data-schemas.md#scenes.
    """
    m = re.match(r"^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?|-(\d+))?$", ref.strip())
    if not m:
        raise ValueError(f"unparseable passage reference: {ref!r}")
    book = m.group(1)
    a = int(m.group(2))
    if m.group(3) is not None:
        v = int(m.group(3))
        return book, a, a, v, int(m.group(4) or m.group(3))
    return book, a, int(m.group(5) or m.group(2)), None, None


_BOOKS: dict[tuple[str, str], dict | None] = {}


def book_doc(edition: str, book: str) -> dict | None:
    """One book file, read at most once.

    Canonical names 1,189 chapters and every one of them is checked against
    every shipped edition, so re-reading Psalms off disk for each of its 150
    chapters would turn a fast check into a slow one for no gain.
    """
    key = (edition, book)
    if key not in _BOOKS:
        path = DATA / "texts" / edition / f"{book.lower().replace(' ', '')}.json"
        _BOOKS[key] = (
            json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        )
    return _BOOKS[key]


def chapter_units(edition: str, book: str, chapter: int) -> list[str] | None:
    doc = book_doc(edition, book)
    if doc is None:
        return None
    for s in doc["sections"]:
        if s["name"] == str(chapter):
            return list(s["units"])
    return None


def chapters_on_disk(edition: str, book: str) -> list[int] | None:
    doc = book_doc(edition, book)
    if doc is None:
        return None
    return sorted(int(s["name"]) for s in doc["sections"] if s["name"].isdigit())


def chapter_text(edition: str, book: str, chapter: int) -> str | None:
    units = chapter_units(edition, book, chapter)
    return None if units is None else " ".join(units)


def main() -> int:
    errors: list[str] = []
    route = load("routes/pilgrimage.json")
    scenes = load("scenes/bible.json")
    themes = {t["id"] for t in load("themes.json")["themes"]}

    # --- per-text scene defaults
    #
    # A passage with no row wears its text's default, and for the Bible that is
    # 97.5% of the book -- so a default naming a theme nothing can draw would
    # repaint almost the whole game and be caught by nobody, because the tests
    # walk the authored 2.5%. See
    # docs/design/05-scenery-warps.md#the-default-is-a-property-of-the-text-and-the-bibles-is-open-country
    defaults = load("scenes/defaults.json")["defaults"]
    seen_texts: set[str] = set()
    for d in defaults:
        if d["text"] in seen_texts:
            errors.append(f"scenes: two defaults claim text {d['text']!r}")
        seen_texts.add(d["text"])
        if d["theme"] not in themes:
            errors.append(
                f"scenes: default for {d['text']!r} uses unknown theme {d['theme']!r}"
            )
    if scenes["text"] not in seen_texts:
        errors.append(
            f"scenes: {scenes['text']} has an authored scene map and no default theme; "
            "every chapter it does not name would fall back to abbey"
        )

    # --- route shape
    seen = set()
    for e in route["edges"]:
        if e["id"] in seen:
            errors.append(f"route: duplicate edge id {e['id']}")
        seen.add(e["id"])
        if e["kind"] not in ("progression", "flashback"):
            errors.append(f"route: edge {e['id']} has unknown kind {e['kind']!r}")
        for side in ("from", "to"):
            try:
                parse_ref(e[side])
            except ValueError as ex:
                errors.append(f"route: edge {e['id']}: {ex}")

    # --- every route this build ships
    #
    # Pilgrimage is a graph and is checked as one above; the other three are
    # *lists*, so what there is to get wrong about them is different -- a span
    # that runs off the end of a book, two spans claiming one chapter, or a
    # route file whose id disagrees with its own filename, which would make the
    # record store an id nothing can load.
    # See docs/design/04-route.md#three-of-the-four-are-lists-and-that-is-not-an-omission
    editions_present = (
        sorted(p.name for p in (DATA / "texts").glob("*")) if (DATA / "texts").exists() else []
    )
    choices = load("routes/routes.json")["routes"]
    if not choices:
        errors.append("routes: the menu would have nothing to offer")
    named: dict[str, dict] = {}
    seen_ids: set[str] = set()
    for choice in choices:
        rid = choice["id"]
        if rid in seen_ids:
            errors.append(f"routes: duplicate route id {rid!r}")
        seen_ids.add(rid)
        for field in ("name", "what_it_is"):
            if not choice.get(field):
                errors.append(f"routes: {rid} has no {field}")
        path = DATA / "routes" / f"{rid}.json"
        if not path.exists():
            errors.append(f"routes: {rid} is offered and data/routes/{rid}.json is not there")
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        if doc.get("id") != rid:
            errors.append(
                f"routes: data/routes/{rid}.json calls itself {doc.get('id')!r}; "
                "the record stores the id and the loader stores the filename"
            )
        named[rid] = doc

    for rid, doc in sorted(named.items()):
        if not doc.get("stops") and not doc.get("edges"):
            errors.append(f"routes: {rid} has neither stops nor edges")
        claimed: list[tuple[str, int, int, str]] = []
        for stop in doc.get("stops", []):
            ref = stop["passage"]
            try:
                book, a, b = parse_ref(ref)
            except ValueError as ex:
                errors.append(f"routes: {rid}: {ex}")
                continue
            if b < a:
                errors.append(f"routes: {rid}: span {ref} runs backwards")
            for ob, oa, obb, oref in claimed:
                if ob == book and not (b < oa or a > obb):
                    errors.append(f"routes: {rid}: {ref} overlaps {oref}")
            claimed.append((book, a, b, ref))
            # Every chapter of the span, in every text that is on disk. A span
            # resolves perfectly well on its first chapter and warps into
            # nothing on its fifty-first, and only the whole of it is a check.
            for edition in editions_present:
                have = chapters_on_disk(edition, book)
                if have is None:
                    continue
                missing = [n for n in range(a, b + 1) if n not in have]
                if missing:
                    errors.append(
                        f"routes: {rid}: {ref} names {book} "
                        f"{', '.join(str(n) for n in missing[:4])} "
                        f"which {edition} does not have"
                    )

    # Canonical says *nothing is left out*, and that is checkable rather than
    # believable: the chapters it names must be exactly the chapters on disk.
    # Every other route is a selection and has nothing of the sort to prove.
    canonical = named.get("canonical")
    if canonical is not None and editions_present:
        edition = editions_present[0]
        claimed_chapters = set()
        for stop in canonical["stops"]:
            book, a, b = parse_ref(stop["passage"])
            claimed_chapters |= {(book, n) for n in range(a, b + 1)}
        on_disk = set()
        for path in sorted((DATA / "texts" / edition).glob("*.json")):
            doc = json.loads(path.read_text(encoding="utf-8"))
            title = doc["title"]
            for s in doc["sections"]:
                if s["name"].isdigit():
                    on_disk.add((title, int(s["name"])))
        # Psalms ships twice under two filenames so that `Psalm 23` resolves; it
        # is one book and the route names it once.
        missing = sorted(on_disk - claimed_chapters)
        if missing:
            errors.append(
                f"routes: canonical leaves out {len(missing)} chapter(s), "
                f"starting {missing[0][0]} {missing[0][1]}"
            )

    # Wisdom says it is the Psalms and the Proverbs, all of them and nothing
    # else. Same kind of claim, same kind of check.
    wisdom = named.get("wisdom")
    if wisdom is not None and editions_present:
        edition = editions_present[0]
        want = {
            (book, n)
            for book in ("Psalms", "Proverbs")
            for n in (chapters_on_disk(edition, book) or [])
        }
        got = set()
        for stop in wisdom["stops"]:
            book, a, b = parse_ref(stop["passage"])
            got |= {(book, n) for n in range(a, b + 1)}
        if got != want:
            errors.append(
                "routes: wisdom is not exactly the Psalms and the Proverbs "
                f"({len(want - got)} missing, {len(got - want)} extra)"
            )

    # --- scenes
    #
    # Overlap is checked *within* a precision. A verse row sitting inside a
    # chapter row is the mechanism, not a clash: the finer row wins by rule.
    # Two chapter rows claiming one chapter, or two verse rows claiming one
    # verse, would make the theme depend on the order of the table.
    ranges: list[tuple[str, int, int]] = []
    chapter_rows: list[tuple[str, int, int, str]] = []
    verse_rows: list[tuple[str, int, int, int, str]] = []
    for s in scenes["scenes"]:
        if s["theme"] not in themes:
            errors.append(f"scenes: {s['range']} uses unknown theme {s['theme']!r}")
        # A held range is one the camera does not translate across. `yes` or
        # nothing: a flag that failed open would look exactly like a row nobody
        # had marked. See docs/design/05-scenery-warps.md#held-scenes-not-every-passage-is-a-journey
        if s.get("held") not in (None, "yes"):
            errors.append(f"scenes: {s['range']} has an unreadable held flag {s.get('held')!r}")
        try:
            book, a, b, v, vb = parse_range(s["range"])
        except ValueError as ex:
            errors.append(f"scenes: {ex}")
            continue
        if v is not None and vb < v:
            errors.append(f"scenes: range {s['range']} runs backwards")
        if v is None:
            for ob, oa, obb, orange in chapter_rows:
                if ob == book and not (b < oa or a > obb):
                    errors.append(f"scenes: range {s['range']} overlaps {orange}")
            chapter_rows.append((book, a, b, s["range"]))
        else:
            for ob, och, ov, ovb, orange in verse_rows:
                if ob == book and och == a and not (vb < ov or v > ovb):
                    errors.append(f"scenes: range {s['range']} overlaps {orange}")
            verse_rows.append((book, a, v, vb, s["range"]))
        ranges.append((book, a, b))

    # every routed passage resolves to a theme (abbey is the documented fallback)
    routed = {p for e in route["edges"] for p in (e["from"], e["to"])}
    for ref in sorted(routed):
        book, a, _ = parse_ref(ref)
        if not any(ob == book and oa <= a <= obb for ob, oa, obb in ranges):
            errors.append(
                f"scenes: routed passage {ref} has no scene row "
                "(would fall back to the text's default)"
            )

    # --- followers
    #
    # *At most* one figure per passage the route names, drawn from art that
    # exists. It was `exactly` one, and that was right until Genesis 3 stopped
    # having anybody: it is the chapter where everyone is driven out, and there
    # is no one in it who joins you. A rule demanding a row for every node is a
    # rule demanding an invented companion wherever the text supplies no real
    # person, which asserts more than the text supports -- the one thing this
    # project refuses everywhere else. So an empty node is allowed and a row
    # naming a node the route does not have is still an error.
    # See docs/design/11-followers.md#who-joins-after-what
    #
    # `mark` may be null for the same reason, one level down: Mary Magdalene
    # carries nothing in John 20, and the jar tradition hands her is Luke's.
    # See docs/design/11-followers.md#a-figure-may-carry-nothing
    #
    # `verse` is where in the passage the figure arrives, and blank is the end of
    # it. Two rows may share a passage -- Genesis 2 forms two people and names
    # the verse of each -- but never an *arrival*: one strip under the rail, one
    # sentence in it. A blank verse claims the whole passage, so it may not share
    # one with a row that names a verse in it.
    # See docs/design/11-followers.md#they-join-at-a-verse-not-at-the-end-of-a-chapter
    followers = load("followers.json")["followers"]
    art = (ROOT / "core" / "sprites.ts").read_text(encoding="utf-8")

    def art_keys(const: str) -> set[str]:
        block = art.split(f"const {const}", 1)[-1].split("\n]);", 1)[0]
        return set(re.findall(r"\['([A-Za-z_]+)',", block))

    bodies, cloths, marks = art_keys("BODY_FRAMES"), art_keys("CLOTHS"), art_keys("MARK_ROWS")
    seen_refs: set[str] = set()
    whole_passage: set[str] = set()
    at_a_verse: set[str] = set()
    editions_for_verses = (
        [p.name for p in (DATA / "texts").glob("*")] if (DATA / "texts").exists() else []
    )
    for f in followers:
        ref = f["passage"]
        verse = f.get("verse")
        cite = ref if verse is None else f"{ref}:{verse}"
        if cite in seen_refs:
            errors.append(f"followers: two figures claim {cite}")
        seen_refs.add(cite)
        if ref in (at_a_verse if verse is None else whole_passage):
            errors.append(f"followers: two figures claim {ref}, one of them at a verse")
        (whole_passage if verse is None else at_a_verse).add(ref)
        if ref not in routed:
            errors.append(f"followers: {ref} is not a passage the route names")
        if verse is not None:
            if not isinstance(verse, int) or verse < 1:
                errors.append(f"followers: {cite} is not a verse number")
            else:
                # A verse the chapter does not have is a figure who never joins.
                book, first, _ = parse_ref(ref)
                for edition in editions_for_verses:
                    units = chapter_units(edition, book, first)
                    if units is None:
                        continue
                    if verse > len(units):
                        errors.append(
                            f"followers: {cite} is past the end of {ref} "
                            f"in {edition}, which has {len(units)} verses"
                        )
        for field, known in (("body", bodies), ("cloth", cloths), ("mark", marks)):
            value = f[field]
            if value is None and field == "mark":
                continue
            if value not in known:
                errors.append(
                    f"followers: {ref} names {field} {value!r}, "
                    "which is not art in core/sprites.ts"
                )

    # --- echo phrases, only if texts are present
    editions = [p.name for p in (DATA / "texts").glob("*")] if (DATA / "texts").exists() else []
    if not editions:
        print("    data: route/scene shape ok (echo check skipped, run `make fetch`)")
    else:
        checked = 0
        for e in route["edges"]:
            for side in ("from", "to"):
                book, a, b = parse_ref(e[side])
                for edition in editions:
                    body = chapter_text(edition, book, a)
                    if body is None:
                        continue
                    checked += 1
                    phrase = e.get("echo_kjv") or e["echo"] if edition == "kjv" else e["echo"]
                    if phrase.lower() not in body.lower():
                        errors.append(
                            f"route: edge {e['id']}: echo {phrase!r} "
                            f"not found in {edition} {e[side]}"
                        )
        print(f"    data: route/scene shape ok, {checked} echo lookup(s)")

    for err in errors:
        print(f"  {err}", file=sys.stderr)
    if errors:
        print(f"\n{len(errors)} data problem(s).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
