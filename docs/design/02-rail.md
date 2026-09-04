# The reading rail

**Implemented by:** `core/rail.js`, `core/lectio.js`

## Fixed eyes, moving world

The cursor is nailed to the horizontal centre of the screen. The text ribbon slides
right-to-left *through* it. The scribe and the parallax background scroll to convey
travel.

The player's eyes never move.

This is the same principle as RSVP speed-reading tools: most of the cost of reading is
saccades — the eye jumping between fixation points — and holding the focal point still
removes them. We get it for free because a side-scroller already moves the world past a
fixed character; we simply put the text on the same rail.

```
┌──────────────────────────────────────────────────────────┐
│ ♥♥♥      GENESIS 1 · v1     WPM 14  ACC 97%  ×7  ▓▓░░░░  │
├──────────────────────────────────────────────────────────┤
│      ☁                                                   │
│   ╱╲      ╱╲╲        🧍‍♂️→      🕯       ╱╲      ╱╲╲      │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓       │
├──────────────────────────────────────────────────────────┤
│                    ▁▁▁▁▁                                 │
│        beginning God cre│ted the heavens and             │
│                    ▔▔▔▔▔  ← focal guide, never moves     │
├──────────────────────────────────────────────────────────┤
│  [Q][W][E][R][T][Y][U][I][O][P]                          │
│   [A][S][D][F][G][H][J][K][L][;]     ← next key: a       │
│    ●  ●  ●  ●  ●  ●  ●  ●  ●  ●        left pinky        │
└──────────────────────────────────────────────────────────┘
```

## The focal guide

Short horizontal rules above and below the cursor column mark the fixed point — the same
visual anchor speed-reading applications use. Without it a fixed gaze point reads as an
accident of layout; with it, it reads as a place to look.

**Invariant.** The cursor's screen x-position is constant across an entire chapter,
including through long greyed runs and at every line boundary. Any drift defeats the
whole purpose, and drift is easy to introduce accidentally when handling wrapping, so it
is checked rather than eyeballed.

## Lectio mode

The rail makes a reading mode nearly free: same ribbon, same focal guide, no typing.
Text flows through at a pace that ramps upward the longer the player sustains it.

This is worth shipping rather than treating as a bonus. It is the mode available on a day
he does not want to drill, it exercises the same corpus, and it converts the fixed-gaze
habit from a side effect into something practised deliberately. Pace ramp parameters live
in [tuning](07-tuning.md).
