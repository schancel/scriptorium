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
  "scenes": [ { "range": "Exodus 14", "theme": "sea", "setpiece": "parted_walls",
                "held": null },
              { "range": "Genesis 3:1-5", "theme": "garden",
                "setpiece": "serpent_in_the_branches", "held": "yes" } ] }
```

`range` is `Book C`, `Book C-C`, or `Book C:V-V` for a chapter that moves faster than one
scene can hold. A verse range wins over a chapter range covering the same ground, so
chapter rows stay a useful default. Ranges of the same precision must not overlap. Any routed passage without a
row resolves to `abbey`. A text with no scene file at all resolves entirely to `abbey`,
which is the expected outcome for user-imported books.

`held` is `"yes"` on a range where the camera does not translate and word progress moves
the set piece instead, and `null` everywhere else — see
[held scenes](../design/05-scenery-warps.md#held-scenes-not-every-passage-is-a-journey).
`"yes"` is the only truthy value the loader accepts; anything else is a load error rather
than a quietly unheld scene, because a flag that failed open would look exactly like a
scene nobody had marked.

## Progress

Browser local storage, exportable to a file. Written by
`platform/web/local_storage.ts`; its shape and every decision taken from it live in
`core/progress.ts`.

```json
{ "version": 7, "stage": 3, "translation": "WEB", "route": "pilgrimage",
  "layout": "ansi", "spaceThumb": "rt",
  "position": { "book": "Genesis", "chapter": 1, "unit": 7 },
  "completed": ["Genesis 1"],
  "discovered": ["Genesis 22"],
  "keyStats": { "a": { "hits": 812, "errors": 19, "totalMs": 276080,
                       "latencies": [340], "confusions": { "s": 4 } } },
  "recent": { "a": [ { "ok": true, "ms": 312 }, { "ok": false, "ms": null } ] },
  "history": [ { "date": "2026-09-03", "stage": 3, "ref": "Genesis 1:1-3",
                 "wpm": 14.2, "accuracy": 0.97, "promoted": false } ],
  "gilding": false, "gildOffered": false,
  "firstRun": false, "notesSeen": ["greyed", "wrong", "space"],
  "cloudEnabled": true, "motion": "auto" }
```

`position` is the bookmark: the translation is `translation`, and `unit` is the
1-based verse the player resumes *on*, not the last one they finished. Without it the
game reopens at Genesis 1:1 every time, which is what a reload used to do.

`keyStats` are lifetime totals, behind the report card. `recent` is the trailing window
the mastery gate is measured over — the last `gate_window` attempts on each of the
current stage's **new** keys, and nothing else. The two are separate because a
`KeyStat` is a running total, and a gate read from running totals averages a beginner's
first bad hour into their accuracy for ever, so the gate they have actually earned never
opens. `recent` is pruned to the new keys on every save and emptied on promotion, which
is also what keeps it a few kilobytes rather than a few hundred.

`gilding` is the [gilding mode](../design/01-illumination.md#gilding-a-mode-for-people-who-already-type):
every producible character required, nothing auto-advanced. Off by default. It is a fact
about the person at the keyboard rather than about the passage, which is why it is stored
rather than asked once a session. `gildOffered` records that the game has *offered* it, so
the question is asked once however it was answered — the game never turns the mode on
itself, and an offer that returns after every good session has stopped being an offer.
Neither field touches the gate: see
[ADR 0008](../decisions/0008-gilding-permissive-input.md#why-gilding-must-not-open-the-gate).

`firstRun` and `notesSeen` are [the first run](../design/10-first-run.md): the opening
screen about the bumps on `F` and `J`, and the three one-sentence notes that fire the
first time a dim letter is skipped, a wrong key is pressed and a space is reached.
`firstRun` is true only in a brand new record and false the moment the screen is
dismissed; `notesSeen` names the notes already spent, and a note is added to it when it
is *shown* rather than when it is dismissed, so a closed tab cannot cost the player the
same sentence twice. Both are stored rather than held for the session because a tip that
returns after you have understood it is an insult. The menu can set them back, and it is
the only thing that ever does.

`discovered` names the flashback rooms the player has stepped into. It is separate from
`completed` because a secret is revealed by being *found*, and a player who steps through
the doorway, turns round and walks straight back out has still found it — see
[the route](../design/04-route.md#two-kinds-of-edge). It is stored rather than held for
the session because a reload would otherwise be a cheaper way to lose a room than walking
out of one. It gates nothing: `requiredRefs` excludes every flashback destination by
construction, so this list can only add to what the map shows.

`cloudEnabled` is whether the blot-cloud is armed —
[ADR 0004](../decisions/0004-idle-threat-not-speed-timer.md) requires the one pressure in
the game to be switchable off, since it exists to motivate and may stress this particular
player instead. It is stored rather than held for the session for the same reason
`gilding` is: it is a fact about the person at the keyboard, and a switch that comes back
on at every reload is one the player has to find again every evening. Like `gilding` it
touches nothing else — not the stage, not the window, not the gate.

`motion` is which of the two presentations of the rail the player has asked for:
`"auto"` follows the operating system's `prefers-reduced-motion`, `"full"` and `"reduced"`
override it in either direction. Stored for the same reason `cloudEnabled` is — it is a
fact about the person at the keyboard, and about his eyes rather than his typing — and it
decides nothing else in the game. See
[motion and comfort](../design/12-motion-and-comfort.md#how-it-is-reached) and
[ADR 0011](../decisions/0011-respect-reduced-motion.md).

`promoted` marks the session that opened the gate. The history view needs it: the
sessions *after* a promotion are slower, because a new stage lights up more of the page,
and an unexplained dip in the curve is the single most likely reason a beginner concludes
the game is broken. See [stats](../design/08-stats.md#history).

`version` exists so a schema change can migrate rather than discard. Losing months of
history to a format change would be unrecoverable for the player; migrations are required,
not optional.

| version | change | migration |
|---|---|---|
| 1 | initial: stage, translation, route, completed, keyStats, history | — |
| 2 | added `position`, `recent`, `spaceThumb`, and `promoted` on a history entry | every version 1 field is carried across unchanged; the new ones default (position to Genesis 1:1, `recent` to empty, `spaceThumb` to `rt`, `promoted` to false). Nothing is dropped. |
| 3 | added `gilding` and `gildOffered` | every version 2 field is carried across unchanged — stage, position, `completed`, `keyStats`, `recent` and the whole history. Both new fields default to `false`, which is exactly what a version 2 record meant: the mode did not exist, so it was off and had never been offered. Nothing is dropped. |
| 4 | added `firstRun` and `notesSeen` | every version 3 field is carried across unchanged — stage, translation, route, layout, `spaceThumb`, position, `completed`, `keyStats`, `recent`, the whole history, `gilding` and `gildOffered`. The two new fields default to *already done*: `firstRun` to false and `notesSeen` to every note. That is the only correct default, because a stored record is by definition one somebody has already been playing, and starting to explain the game to a player three weeks in would be worse than never having explained it at all. Nothing is dropped. |
| 5 | added `discovered` | every version 4 field is carried across unchanged. `discovered` defaults to empty, which is the only honest default: nothing recorded a found room before the field existed, so the game does not know of any. It costs the player nothing — a flashback is optional by construction, and re-finding one is the same walk it was the first time. Nothing is dropped. |
| 6 | added `cloudEnabled` | every version 5 field is carried across unchanged — stage, translation, route, layout, `spaceThumb`, position, `completed`, `discovered`, `keyStats`, `recent`, the whole history, `gilding`, `gildOffered`, `firstRun` and `notesSeen`. `cloudEnabled` defaults to `true`, and it is read as true unless the stored value is explicitly `false`. That is exactly what a version 5 record meant: the switch was held for the session only, so every session that record ever had began with the cloud armed. Defaulting it off would silently remove the game's only pressure from every player who has ever played it. Nothing is dropped. |

| 7 | added `motion` | every version 6 field is carried across unchanged. `motion` defaults to `"auto"`, which is the setting a version 6 record was already getting in effect: nothing consulted `prefers-reduced-motion` at all, so the player had never been asked and had never chosen. Defaulting to `"auto"` is the only value that can start honouring the operating system for the people who had already told it, without overriding a choice anybody made. An unrecognised stored value reads as `"auto"` for the same reason. Nothing is dropped. |

`core/progress.ts` defaults every field individually rather than trusting the stored
blob, so a partially corrupt record loses the corrupt field and keeps the history.
