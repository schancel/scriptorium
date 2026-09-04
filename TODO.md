# Outstanding

Decisions waiting on Shammah, and work not yet done. Kept here rather than in a
session, because a backlog that lives in a conversation is a backlog nobody can
find. Design *decisions* live in `docs/decisions/`; this is what is still open.

## Decisions waiting on you

Each is a judgement about the player, not about the code, so none were decided
alone.

1. **"Candle" or "part"?** A candle is now drawn on screen and lights as you pass
   it, which `docs/design/03-pacing.md#say-part-not-candle` set as the condition
   for the word returning to the interface. It still says "part" everywhere. If it
   comes back it comes back everywhere at once — HUD, report card footer, menu —
   and comes off the tone test's jargon list.
2. **Where you take a thread.** Travelling to a connected passage happens on the
   map. It is never offered at the end of a passage, because that would change the
   forward flow. Should finishing Genesis 1 offer John 1?
3. **The doorway key is Tab.** Nothing in the docs named one. Tab was free and is
   not a curriculum key.
4. **Lectio cannot slow down** without leaving and re-entering. Deliberate — coming
   down is a decision you make — but it may just be annoying.
5. **The report card leads with your worst key**, so for a beginner with any key
   above 12% error that dominates for weeks and the deeper "you are reaching for
   that key" finding only ever appears in the note beneath. Swapping the order is
   two lines.
6. **Developer commands in player-facing errors.** The text-load failure and the
   ADR-0009 banner both say `make fetch` / `make serve`, which is useless to
   someone who only has the URL. Right for the banner by ADR; wrong for the player.
7. **The music does not follow the scenery inside a chapter.** Genesis 1 now changes
   world six times as you type it, and the hymn does not change with it: a theme owns
   a tune and a tune restarts when the theme does, so following the picture would cut
   the hymn off mid-phrase six times in one chapter. So the picture resolves per verse
   and the music per chapter. Written down in
   `docs/design/05-scenery-warps.md#verse-ranges`; it is a judgement about what the
   room should sound like while it changes, and worth hearing before it is settled.
8. **How fast the world should turn.** `scene_blend_verses` is 2 — the colour eases
   across a window one verse either side of the boundary. At 0 the world changes
   between one verse and the next; much above 3 and Genesis 1 is one long crossfade
   with no places in it. Two was chosen on the argument, not on the screen.
9. **Who joins after Genesis 1, and after John 8.** The followers table in
   `docs/design/11-followers.md#who-joins-after-what` names one person per passage,
   and two of the nineteen were judgement calls rather than readings. *Genesis 1* has
   no named person in it, so it hands over **Eve** on Genesis 1:27 while Adam comes
   from Genesis 3 as the design doc asks — she therefore joins before he does, which
   is right by the text and slightly odd by the story. *John 8* hands over **the
   woman he did not condemn**, carrying the stone that was put down; it is the
   memorable image of the chapter and it is faithful, but it is also the only figure
   in the line whose passage is about her rather than about what she carried. Both
   are a row in a table and cost a line to change.
10. **Genesis 1 keeps its chapter row.** `Genesis 1 | apocalypse | light_from_dark` still
   sits under the seven verse rows as the default, so a *warp* into Genesis 1 arrives on
   the apocalypse rather than on the void, and only the level itself resolves finely. It
   is the documented behaviour — a chapter citation is a question about the chapter —
   but the first frame of a crossing into verse 1 is arguably the void's.

## Agreed, specified, not yet built

All four came out of the owner playing it. Each has its reasoning written down in the
place named, so none of this depends on remembering a conversation.

1. **Mistakes may stand, and be deleted.** An opt-in mode, off by default, where a wrong
   key leaves its letter in the expected letter's cell, the cursor advances, and
   backspace removes it and steps back. Backspace is currently swallowed as a
   non-curriculum key and must be let through.
   → `docs/decisions/0010-mistakes-may-stand-and-be-deleted.md`
   **Owner's ruling:** a word repaired with backspace *still fells the monster*. The WPM
   lost while repairing is penalty enough; there is no need to invent another.
2. **A monster is felled by a clean word, not by any word.** A word with a mistake in it
   leaves the monster standing and the scribe walks past. Nothing blocks, chases or
   costs — the monster still standing is the whole of the feedback. Every mode.
   → `docs/design/03-pacing.md#a-monster-is-felled-by-a-clean-word-not-by-any-word`
3. **The camera eats the leap at speed.** The world scrolls 24px per completed word while
   a 460ms hop is still playing, so a fast typist sees the scribe travel about 10px of
   his designed 36. This is the real cause of *"you just stand on top of them for a bit"*
   and no value of `strike_hop_px` fixes it. The fix is for the camera to hold still
   while a strike plays, which is a change to load-bearing behaviour — the camera being
   purely word-driven — and so wants deciding rather than slipping in.
   → measured in `docs/design/03-pacing.md`
4. **Mark the mode on the progress curve.** Gilded and non-gilded parts share one history
   line with nothing separating them. The owner went from 22 wpm to 75 by switching modes
   in one sitting; on the curve that draws a cliff which reads as a breakthrough and is
   not one. Needs a flag on the history entry and a note on the chart, like the
   promotion mark that already exists.
   → `docs/design/08-stats.md`

## Built since the last pass

- **Followers.** Finishing a passage the route names puts its figure in a line
  walking behind the scribe, and finding a flashback room puts its figure there too
  — which is the visible trace a secret room never used to leave. They walk when he
  walks, idle when he idles, and do nothing else: no hearts, no smudge, no cloud, no
  drops, no score, no gate. That is arranged rather than observed —
  `core/followers.ts` has no way to name a mechanic, a pose has five fields, and a
  test draws the frame twice and asserts the two display lists differ only by the
  figures. The party is *derived* from `completed` and `discovered`, so there is no
  new field on the progress record and nothing to migrate. The map names everyone.
  → `docs/design/11-followers.md`

## Known problems

- A hop caught mid-air freezes under the report card when a part ends.
- Raw exception text can reach the menu's error line on corrupt data.
- The map says "not on the pilgrimage route" in lower case; the design doc
  capitalises it.

## Waiting to be looked at

- **Is the strike arc big enough?** Unverified, and the report that started it
  cannot settle it: *"you didn't change the kill animation"* came from a browser
  serving a cached page, so the stomp and the ink throw had shipped but had not
  been seen. The five numbers that decide how large the blow draws are rows in
  `docs/design/07-tuning.md` now — `strike_hop_px`, `strike_contact_px`,
  `strike_bounce_ratio`, `strike_nib_arc_px`, `strike_rise_travel` — so the feel
  can be turned without a code change. At the shipped values the scribe rises
  **12 px** above his standing line and crosses the **36 px** of `strike_reach`
  to the skeleton; the thrown nib arcs **14 px** off the line to the bat. He is
  16 px tall and has 58 px of room above him before the HUD, so there is a great
  deal of headroom if it wants to be bigger. Look at it once and say.

## Not done

- Sound polish. The ten tunes were transcribed against real notation and are
  correct, but they are only lightly heard in play. Two of the twelve themes now
  share a tune with another (`void` with the abbey, `firmament` with the mountain);
  neither has one of its own.
- More sprite art. Fifteen tiles cover twelve themes; monsters are still two kinds.
  The nineteen followers are deliberately *not* nineteen sprites — three body
  silhouettes, three cloths and one small mark apiece — and that is the shape any
  further background art should take rather than an omission to fix.
  → `docs/design/11-followers.md#art-without-ten-bespoke-sprites`
- **Jerusalem still has no landmarks.** `docs/design/05-scenery-warps.md#a-chapter-is-not-one-place`
  names three faces of the same problem and two are now fixed: Genesis 1 moves, and every
  Gospel passage the route names has a set piece. The third is the city — "a place you
  arrive at, not a texture that repeats" — and it wants a gate, a wall and a temple
  standing in the band rather than better brick. Nothing about it is built.
- Other routes. `Canonical`, `Narrative` and `Wisdom` are specified in
  `docs/design/04-route.md` and only `Pilgrimage` is authored.
- Chronicle levels — the genealogies, skipped by default, available as opt-in
  bonus passages. Specified, not built.

## How this repo works, and where everything is

Written for whoever picks this up next — a person, a different session, or a different
model. Nothing needed to continue this project lives in a conversation.

| You want | It is in |
|---|---|
| The rules you must follow | `AGENTS.md` — read first, it is short and binding |
| What is outstanding | this file |
| What the game is and why | `docs/design/` — twelve documents, canonical |
| Why a choice was made, and what was rejected | `docs/decisions/` — ten ADRs |
| What the numbers are | `docs/design/07-tuning.md`, compiled to `data/tuning.json` |
| Whether you have broken something | `./tools/check.sh` — every invariant, plus a smoke test that boots the actual built game |
| The reasoning behind a specific change | `git log` — the commit messages carry it |

**Documentation is canonical and code is a projection of it.** Tables in `docs/design/`
compile into `data/*.json`, and hand-editing the generated JSON fails the build. A design
change is a documentation change first, then `make build`, then code.

The ADRs matter more than they look. Several record decisions that are counter-intuitive
and will be "helpfully" reversed by anyone working from the code alone — there is no
speed timer (0004), damage is not per-typo (0005), gilding cannot open the mastery gate
(0008), a fallback must announce itself (0009). Each says what was rejected and why.
