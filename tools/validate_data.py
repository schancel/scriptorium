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


def chapter_text(edition: str, book: str, chapter: int) -> str | None:
    path = DATA / "texts" / edition / f"{book.lower().replace(' ', '')}.json"
    if not path.exists():
        return None
    doc = json.loads(path.read_text(encoding="utf-8"))
    for s in doc["sections"]:
        if s["name"] == str(chapter):
            return " ".join(s["units"])
    return None


def main() -> int:
    errors: list[str] = []
    route = load("routes/pilgrimage.json")
    scenes = load("scenes/bible.json")
    themes = {t["id"] for t in load("themes.json")["themes"]}

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
            errors.append(f"scenes: routed passage {ref} has no scene row (would fall back to abbey)")

    # --- followers
    #
    # One figure per passage the route names, drawn from art that exists. A
    # route edge added without a figure is a passage that finishes and leaves
    # nothing behind, which is the hole docs/design/11-followers.md is about.
    followers = load("followers.json")["followers"]
    art = (ROOT / "core" / "sprites.ts").read_text(encoding="utf-8")

    def art_keys(const: str) -> set[str]:
        block = art.split(f"const {const}", 1)[-1].split("\n]);", 1)[0]
        return set(re.findall(r"\['([A-Za-z_]+)',", block))

    bodies, cloths, marks = art_keys("BODY_FRAMES"), art_keys("CLOTHS"), art_keys("MARK_ROWS")
    seen_refs: set[str] = set()
    for f in followers:
        ref = f["passage"]
        if ref in seen_refs:
            errors.append(f"followers: two figures claim {ref}")
        seen_refs.add(ref)
        if ref not in routed:
            errors.append(f"followers: {ref} is not a passage the route names")
        for field, known in (("body", bodies), ("cloth", cloths), ("mark", marks)):
            if f[field] not in known:
                errors.append(
                    f"followers: {ref} names {field} {f[field]!r}, "
                    "which is not art in core/sprites.ts"
                )
    for ref in sorted(routed - seen_refs):
        errors.append(f"followers: no figure joins after {ref}")

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
