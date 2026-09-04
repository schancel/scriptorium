# Data schemas

Everything under `data/` is JSON. Files marked **generated** are compiled from markdown
tables in `docs/design/` by `tools/build_from_docs.py` and must never be hand-edited —
`make check` regenerates them and fails on any difference.

| File | Source | Generated |
|---|---|---|
| `data/curriculum.json` | `docs/design/06-curriculum.md` | yes |
| `data/tuning.json` | `docs/design/07-tuning.md` | yes |
| `data/items.json` | `docs/design/03-pacing.md` | yes |
| `data/themes.json` | `docs/design/05-scenery-warps.md` | yes |
| `data/scenes/bible.json` | `docs/design/05-scenery-warps.md` | yes |
| `data/routes/pilgrimage.json` | `docs/design/04-route.md` | yes |
| `data/texts/**` | `tools/fetch_bible.py` | fetched |
| `data/coverage.json` | `tools/build_wordlists.py` | measured |
| `data/tunes/*.json` | hand-authored, or `tools/midi_to_tune.py` | no |

## Text

The seam that lets any public-domain book work. A "book" is an ordered set of named,
numbered chunks, so Genesis and *Sherlock Holmes* are structurally identical:

```json
{
  "title": "Genesis",
  "edition": "WEB",
  "sections": [
    { "name": "1", "units": ["In the beginning, God created…", "The earth was formless…"] }
  ]
}
```

`sections` are chapters; `units` are verses. For a novel, sections are chapters and units
are paragraphs. Nothing downstream knows the difference.

One file per book, lazily loaded. A full translation is ~4.5 MB of plain text; Genesis
alone is ~200 KB, which is why nothing is bundled up front.

## Route

```json
{ "id": "pilgrimage",
  "edges": [ { "id": "beginning", "kind": "progression",
               "from": "Genesis 1", "to": "John 1",
               "echo": "In the beginning", "note": "…" } ] }
```

`kind` is `progression` (travel and stay) or `flashback` (round trip, returns to origin).
`echo` must occur literally in both passages, in every shipped translation — asserted by
`make check`.

## Scenes

```json
{ "text": "bible",
  "scenes": [ { "range": "Exodus 14", "theme": "sea", "setpiece": "parted_walls" } ] }
```

`range` is `Book C` or `Book C-C`. Ranges must not overlap. Any routed passage without a
row resolves to `abbey`. A text with no scene file at all resolves entirely to `abbey`,
which is the expected outcome for user-imported books.

## Progress

Browser local storage, exportable to a file:

```json
{ "version": 1, "stage": 3, "translation": "WEB", "route": "pilgrimage",
  "completed": ["Genesis 1"], "hearts": 3, "items": ["quill_nib"],
  "keyStats": { "a": { "hits": 812, "errors": 19, "medianMs": 340 } },
  "history": [ { "date": "2026-09-03", "stage": 3, "wpm": 14.2, "accuracy": 0.97 } ] }
```

`version` exists so a schema change can migrate rather than discard. Losing months of
history to a format change would be unrecoverable for the player; migrations are required,
not optional.
