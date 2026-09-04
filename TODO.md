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
