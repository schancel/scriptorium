# The reading rail

**Implemented by:** `core/rail.ts`, `core/lectio.ts`, `core/draw.ts`

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

## The space affordance

Space is live from stage 0, both thumbs rest on it, and it is the most-pressed key in
the game by a wide margin. It also prints nothing. The first report from the player was
that it is *"difficult to tell the user is supposed to press space"* — which is the
illumination mechanic failing at its own premise: the rail is supposed to show, at every
moment, exactly what is being asked for, and on a fifth of all keystrokes it was showing
a blank.

So a space that is still owed carries a mark, and a space already typed does not:

```
   b e g i n n i n g ▁ G o d ▁ c r e a t e d
   ─────typed──────  │        ▁
                     └ cursor  └ still owed
```

- **Pending** — a low bar inset in the cell, in the focal guide's muted colour. Quieter
  than a letter, so the eye still reads words rather than a picket fence, but plainly a
  thing rather than a gap.
- **Current** — the same bar at full cell width, in the caret's colour. The vertical
  caret and the bar beneath it agree and read as one mark: *this cell, this keystroke*.
  This is what makes the caret unambiguous when it lands on a space, which it does more
  often than on any letter.
- **Typed** — nothing. There is nothing left to ask for, and a trail of bars behind the
  cursor is noise.

**It is drawn as geometry, not as a character.** An interpunct or an underscore glyph is
one or two pixels of ink inside a 12px cell at the virtual design resolution, and *how
many* depends on whichever monospace font the platform happened to resolve. An
affordance that is legible in one font and invisible in the next is not an affordance.
A rect is exactly the size core asks for, on every platform and in every port.

The keyboard overlay does the other half: the space bar is the widest key on the board
and lights like any other next key, and the hint line names it in words — `next: space`.

## The ribbon does not settle at speed, and that appears to be fine

Measured, not assumed. `rail_scroll_lerp` closes a quarter of the remaining distance each
frame, so the ribbon takes about **267 ms** to come to rest. A keystroke arrives every:

| | rate | interval | |
|---|---|---|---|
| a beginner | 22 wpm | 545 ms | the ribbon settles between every keystroke |
| a fluent typist, gilding on | 75 wpm | 160 ms | **it never settles** |
| the same typist copying normally | 120 wpm | 100 ms | **it never settles** |

So the rail is calm for the player it was built for and permanently sliding for anyone
quick. That is backwards for copy typing specifically: reading ahead is how a fast typist
buffers words for his hands, and a buffer cannot form on a target that is still moving.

I inferred from this that a permanently sliding ribbon must be costing a fast typist
speed — reading ahead is how he feeds his hands, and a buffer cannot form on a moving
target — and specified adaptive easing to fix it.

**Then I asked the owner, who types at that speed, and he said he had not noticed any
problem there.**

So the numbers above stay, because they are true and worth knowing, and the fix does not:
the timings are fact, the harm was inference, and the only person who can see the screen
says there is none. **Do not implement adaptive easing on the strength of this section.**
If someone one day reports that the page is hard to read ahead on while typing fast, this
is where to start; until then there is nothing here to repair.

Recorded because a measurement that looks alarming and turns out not to matter is worth
keeping — otherwise it gets rediscovered and "fixed" by the next person to notice it.

## Reading mode

The rail makes a reading mode nearly free: same ribbon, same focal guide, no typing.
Text flows through at a pace that ramps upward the longer the player sustains it.

This is worth shipping rather than treating as a bonus. It is the mode available on a day
he does not want to drill, it exercises the same corpus, and it converts the fixed-gaze
habit from a side effect into something practised deliberately. Pace ramp parameters live
in [tuning](07-tuning.md).

**It is called Reading, and it was called Lectio.** The name came from *lectio divina*, the
slow devotional reading the mode is shaped after, and it sat in the interface with nothing
whatever to explain it. The owner, on meeting it: *"Lectio? Is that the character name?"* —
which is exactly what an unglossed Latin word does in a menu. Everything a player sees now
says **Reading**: the menu, the HUD while it is running, and the way out under the rail.
The internal identifiers keep the old name — `core/lectio.ts`, `LectioState`,
`lectio_start_wpm` — for the same reason `candle_interval` does: it is a good name for the
thing, and it is ours rather than his. Same rule as
[verses and chapters](03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing).

It is entered from the menu — *Read without typing* — and left with **Escape**, which is
named on screen where the next-key hint would otherwise be. Both halves matter: a mode for
the day he does not want to drill has to be easy to find and easier to leave. The board is
not drawn while it is up, because reading asks for no keys and an overlay lit for a key
nobody is being asked for is the overlay lying; the HUD reports the pace rather than a WPM
and an accuracy, which would be scores for something he is not doing. The ribbon is
classified against the whole keyboard rather than the current stage, so he is reading the
page rather than the curriculum's view of it. Nothing in the mode can be failed.
