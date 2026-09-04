# Outstanding

Decisions waiting on Shammah, and work not yet done. Kept here rather than in a
session, because a backlog that lives in a conversation is a backlog nobody can
find. Design *decisions* live in `docs/decisions/`; this is what is still open.

## Decisions waiting on you

Each is a judgement about the player, not about the code, so none were decided
alone.

1. **Where you take a thread.** Travelling to a connected passage happens on the
   map. It is never offered at the end of a passage, because that would change the
   forward flow. Should finishing Genesis 1 offer John 1?
2. **The doorway key is Tab.** Nothing in the docs named one. Tab was free and is
   not a curriculum key.
3. **Reading mode cannot slow down** without leaving and re-entering. Deliberate —
   coming down is a decision you make — but it may just be annoying.
4. **The report card leads with your worst key**, so for a beginner with any key
   above 12% error that dominates for weeks and the deeper "you are reaching for
   that key" finding only ever appears in the note beneath. Swapping the order is
   two lines.
5. **The music does not follow the scenery inside a chapter.** Genesis 1 now changes
   world six times as you type it, and the hymn does not change with it: a theme owns
   a tune and a tune restarts when the theme does, so following the picture would cut
   the hymn off mid-phrase six times in one chapter. So the picture resolves per verse
   and the music per chapter. Written down in
   `docs/design/05-scenery-warps.md#verse-ranges`; it is a judgement about what the
   room should sound like while it changes, and worth hearing before it is settled.
6. **How fast the world should turn.** `scene_blend_verses` is 2 — the colour eases
   across a window one verse either side of the boundary. At 0 the world changes
   between one verse and the next; much above 3 and Genesis 1 is one long crossfade
   with no places in it. Two was chosen on the argument, not on the screen.
7. **Who joins after John 8.** *Genesis 1 and Genesis 3 are settled* — Adam then Eve,
   after the owner's "Adam was created first"; the reasoning is beside the table in
   `docs/design/11-followers.md#who-genesis-hands-over`. Still open: *John 8* hands over
   **the woman he did not condemn**, carrying the stone that was put down. It is the
   memorable image of the chapter and it is faithful, but it is the only figure in the
   line whose passage is about her rather than about what she carried. One row in a
   table.
8. **Genesis 1 keeps its chapter row.** `Genesis 1 | daybreak | light_from_dark` still
   sits under the seven verse rows as the default, so a *warp* into Genesis 1 arrives on
   the daybreak rather than on the void, and only the level itself resolves finely. It
   is the documented behaviour — a chapter citation is a question about the chapter —
   but the first frame of a crossing into verse 1 is arguably the void's.
9. **Eve is not a wife until Genesis 2:24, and not named Eve until 3:20.** The owner's
   own observation, raised beside the art and deliberately not acted on: she joins at
   Genesis 3 and arrives saying *"Wife acquired!"*, which is a joke told slightly out of
   order. Fixing it properly means putting Genesis 2 on the route and making a follower
   join at a *verse* rather than at a passage — the roster is keyed by chapter today.
   That is a pass of its own, not a row edit.


## Agreed, specified, not yet built

All of these came out of the owner playing it. Each has its reasoning written down in the
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
4. **Mark the mode on the progress curve.** Gilded and non-gilded stretches share one history
   line with nothing separating them. The owner went from 22 wpm to 75 by switching modes
   in one sitting; on the curve that draws a cliff which reads as a breakthrough and is
   not one. Needs a flag on the history entry and a note on the chart, like the
   promotion mark that already exists.
   → `docs/design/08-stats.md`

## Built since the last pass

- **The game says verses and chapters, and invents nothing.** `part 4/9` is gone from
  every surface: the HUD, the report card's title, the menu, the history and the map all
  name the stretch by its citation — `Genesis 1:12-14`. The owner: *"Why not verses and
  chapters or something?"* `part` joins `candle` on the jargon list in both the copy test
  and the smoke sweep, so neither can drift back in one surface at a time.
  → `docs/design/03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing`
- **The reading mode is called Reading.** It was *Lectio*, from lectio divina, sitting in
  the menu with nothing to explain it — *"Lectio? Is that the character name?"* Internal
  identifiers keep the old name, as `candle_interval` does.
  → `docs/design/02-rail.md#reading-mode`
- **The `apocalypse` theme is `daybreak`.** It was named after a genre and colloquially
  means the end of the world, which is not what it looks like: white-gold on void black,
  light gathering out of dark. Every other theme id is a place or a picture, and this one
  is now too. → `docs/design/05-scenery-warps.md#daybreak-was-called-apocalypse-and-that-named-the-wrong-thing`
- **No shell commands in anything a player reads.** The fallback banner, the text-load
  failure and the route-missing line no longer say `make build`, `make fetch` or
  `make serve`. The banner is still loud, still names exactly which sources failed, and is
  still the last command in the display list; it just no longer tells someone holding a
  URL to run something he cannot run. ADR 0009 records the change.
  → `docs/decisions/0009-fallbacks-must-announce-themselves.md`
- **Music is on by default, and opens on the first keystroke.** *"Music should be on, I
  haven't yet heard anything."* `audio_default_on` is 1, and the `AudioContext` is
  constructed synchronously inside the input handler — a keystroke is a user gesture, so
  the autoplay block the mute was avoiding never applies. The toggle is now how the sound
  goes *off*. The smoke harness asserts the context started with nobody pressing anything.
  → `docs/design/09-music.md#audio-is-on-and-starts-on-the-first-keystroke`
- **A follower arrives with a line.** One sentence in the strip under the rail, shown once
  when they join, gone as you type on, never repeated. Deadpan and formed from the roster
  — *Moses walks with you.* — except Eve's, which is **Wife acquired!**
  → `docs/design/11-followers.md#arriving-with-a-line`
- **The exclamation ban is about praise, and now only covers copy that judges the
  player.** The report card's note and advice, the coaching notes and the promotion panel
  keep it absolutely; copy about the world may use ordinary punctuation. Both halves keep
  the no-praise and jargon rules, and `core/copy.test.ts` gathers the two corpora
  separately so the evaluative half still fails on a congratulatory line.
  → `docs/design/10-first-run.md#the-exclamation-ban-is-about-praise-and-only-covers-copy-that-judges-him`
- **Eve is not a wizard.** *"Eve isn't very feminine. Looks like a second wizard."* She
  was: `bare` and `hooded` differ by six pixels of ink and *no* silhouette at all, so every
  adult follower was the same robed figure. There is a fourth body now — `gowned`: hair
  past the shoulders breaking the head outline outward, and a gown flaring two to one from
  waist to hem — shared with the woman of John 8, and asserted against the other bodies by
  a counted pixel margin rather than by eye. Her mark is the **fruit** rather than a hoe,
  which was a vertical stick indistinguishable from Moses's staff and was Adam's curse
  besides. → `docs/design/11-followers.md#a-shared-set-is-not-one-body-with-a-switch-on-it`
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

- A hop caught mid-air freezes under the report card at the end of a stretch of verses.
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
  The nineteen followers are deliberately *not* nineteen sprites — four body
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
