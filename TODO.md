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

## Known problems

- **The strike reads as a shuffle, not a leap.** `hopPeakPx` is 12 on a 360px
  frame against a 16px scribe, and `strike_reach` is 36px — he hops less than his
  own height and travels two body widths. Reported: *"you just stand on top of
  them for a bit."* The arc constants are `tuning-exempt` in `core/entities.ts`
  and should be rows in `docs/design/07-tuning.md` so they can be turned without
  a code change.
- **Gilding is undiscoverable.** It works, but it lives under a menu heading
  called "Your stage", and nobody wanting to type the dim letters would look
  there. Reported: *"I can't type the grey'd words."*
- A hop caught mid-air freezes under the report card when a part ends.
- Raw exception text can reach the menu's error line on corrupt data.
- The map says "not on the pilgrimage route" in lower case; the design doc
  capitalises it.

## Not done

- Sound polish. The ten tunes were transcribed against real notation and are
  correct, but they are only lightly heard in play.
- More sprite art. Twelve tiles cover ten themes; monsters are still two kinds.
- Other routes. `Canonical`, `Narrative` and `Wisdom` are specified in
  `docs/design/04-route.md` and only `Pilgrimage` is authored.
- Chronicle levels — the genealogies, skipped by default, available as opt-in
  bonus passages. Specified, not built.

## How this repo works

`AGENTS.md` first. Documentation is canonical and code is a projection of it:
tables in `docs/design/` compile to `data/*.json`, and hand-editing the JSON
fails the build. `./tools/check.sh` runs every invariant including a smoke test
that boots the actual built game.
