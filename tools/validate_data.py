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
    """'Genesis 1' or 'Genesis 2-3' -> (book, first, last)"""
    m = re.match(r"^(.+?)\s+(\d+)(?:-(\d+))?$", ref.strip())
    if not m:
        raise ValueError(f"unparseable passage reference: {ref!r}")
    book, a, b = m.group(1), int(m.group(2)), int(m.group(3) or m.group(2))
    return book, a, b


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
    ranges: list[tuple[str, int, int]] = []
    for s in scenes["scenes"]:
        if s["theme"] not in themes:
            errors.append(f"scenes: {s['range']} uses unknown theme {s['theme']!r}")
        try:
            book, a, b = parse_ref(s["range"])
        except ValueError as ex:
            errors.append(f"scenes: {ex}")
            continue
        for ob, oa, obb in ranges:
            if ob == book and not (b < oa or a > obb):
                errors.append(f"scenes: range {s['range']} overlaps {ob} {oa}-{obb}")
        ranges.append((book, a, b))

    # every routed passage resolves to a theme (abbey is the documented fallback)
    routed = {p for e in route["edges"] for p in (e["from"], e["to"])}
    for ref in sorted(routed):
        book, a, _ = parse_ref(ref)
        if not any(ob == book and oa <= a <= obb for ob, oa, obb in ranges):
            errors.append(f"scenes: routed passage {ref} has no scene row (would fall back to abbey)")

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
                    if e["echo"].lower() not in body.lower():
                        errors.append(
                            f"route: edge {e['id']}: echo {e['echo']!r} "
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
