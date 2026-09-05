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

### Two presentations, one column

The rail has two presentations and the invariant above holds in both. In the reduced one
the ribbon **steps** to the cursor's column instead of easing toward it, so it is on that
column on every frame rather than a quarter of a second after each keystroke -- which
makes the invariant stronger there, not weaker.

That is the *only* thing that changes about the rail. The cursor stays nailed to the focal
x, the focal guide stays where it is, and the space affordance below is drawn identically.
Reduced motion removes the approach to the target and never the target.
See [motion and comfort](12-motion-and-comfort.md), which is also where the reasoning for
`rail_scroll_lerp` having a second value lives.

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

## The scribe at his lectern

The keyboard overlay is a scaffold, and
[the curriculum](06-curriculum.md#breaking-the-looking-down-habit) retires it a key at a
time: once a key's accuracy passes threshold it stops being pointed at. For a player who
has arrived, the whole band goes quiet -- it recedes to
`overlay_retired_alpha` and stops asking to be looked at, though every key of it is still
there for the glance that needs one.

**What fills it is the scribe at his lectern**, hunched over the page, quill moving as
the player types and the page filling as verses complete. Not an ornament in a corner --
the band the keyboard occupied, given back.

This is the best reward the game has to give, because it is the thing the game is
actually about. He stops needing the keys drawn for him and gets to watch himself write
instead. Nothing is announced, no panel congratulates him; the crutch simply becomes the
work.

Rules it inherits: it is below the rail and never enters it, it never competes for
attention with the text, and it moves only when the player types -- a quill scratching on
its own while someone thinks is the same lie as a world that scrolls without them.

The figure is the same scribe who walks the scenery band above. He is a novice copying a
manuscript, never anyone from the text -- see
[scenery](05-scenery-warps.md#held-scenes-not-every-passage-is-a-journey).

### How it arrives, and how it is drawn

**It is uncovered, not introduced.** The lectern is drawn *behind* the board on every
frame, at the alpha of the share of the stage's keys that have retired. At nothing earned
it is not drawn at all; at one key in eleven it is a suggestion; at the last one it is the
band. There is no threshold, no moment of appearance and nothing to announce, which is the
whole of what makes it a reward rather than an award.

**The board recedes; it never loses a key.** The same share that raises the lectern lowers
the opacity of the *whole* overlay, evenly across every key, from solid down to
`overlay_retired_alpha` -- so the picture behind comes up through a board that is thinning
rather than through gaps in one that is disappearing. This was once done the other way, by
dropping each retired key out of the display list, and the owner reported it within the
evening: *"why are some keys missing from the keyboard?"* A board with holes is not the
board under his hands, which
[the layout rule](06-curriculum.md#keyboard-layout) forbids, and a reward that reads as
damage is not a reward. Receding the board gives the band back just as well and keeps the
overlay honest while it happens.

**A retired key stops being pointed at** -- no gold when it is owed, and no finger colour
-- and it is judged over the lifetime table;
[the curriculum](06-curriculum.md#breaking-the-looking-down-habit) has the reasoning for
both halves. Without the first the crutch is never actually given up; without the second
every key comes back at the top of every stretch.

**He is drawn from rects, not from the 16px sprite**, and the reason is scale rather than
taste. The band is 130 virtual pixels tall and a sprite is sixteen by contract, so the
sprite would be an ornament in the middle of an empty strip -- the one thing this section
rules out. The set pieces already draw a serpent, a bough and a turning sword out of rects
for the same reason. He is the same scribe because he is the same *roles*: `robe` over
`robeShade` with `skin` inside the hood, resolved through the world he is walking in, so
his habit is the colour it is in the band above.

**The page holds the stretch.** It has nine lines and they are sized to the part, so the
last character of the part is the last character of the page: a finished page means a
finished stretch of verses rather than an arbitrary loop. A line already copied carries
its ink across; the line under the quill is filled as far as he has got along it, and the
nib sits at the end of that ink with the quill's shaft running back to his hand -- so the
quill pivots as he writes across the line.

**Nothing here reads a clock.** The written lines, the fill of the current one and the
nib's position are all functions of the cursor and of nothing else; no elapsed time
reaches the drawing at all. That is what makes "it moves only when the player types" a
property of the code rather than a promise, and it is the same rule as
[ADR 0004](../decisions/0004-idle-threat-not-speed-timer.md) applied to the one picture in
the game that is *about* typing.

Reading mode gets none of it. The mode asks for no keys, so the board is not drawn there
either -- and a quill moving for somebody who is deliberately not typing would be exactly
the lie above.

## Reading mode

**One word at a time, held still.** Not a page gliding past.

The first version scrolled the ribbon at a rising pace, which is a teleprompter, and a
teleprompter is the thing speed reading exists to get away from: text that moves must be
tracked, and tracking is the saccade cost the whole technique is trying to remove. The
owner caught it:

> "Read without typing should snap words into place rather than moving them. Speed reading
> software only displays one word at a time as I recall. With the second letter of each
> word anchored to the same place or something like that."

That is RSVP -- rapid serial visual presentation -- and it is what Spritz and the rest do.

```
             ▁▁▁▁▁                        ▁▁▁▁▁
      In the beginning God                     a
             ▔▔▔▔▔                        ▔▔▔▔▔
             ^ every frame of "beginning"      ^ and of "a", two words later
```

One word stands between the focal guide's two rules; the letter under them is the same
column in every frame of the sitting. Nothing is drawn to the left or right of the word,
and the next word appears where this one was.

### How it works

- **One word is shown at a time.** Words replace each other in place. Nothing slides, ever.
- **An anchor letter sits on the focal column** and never moves, so the eye has no reason
  to. The rail already draws a focal guide at that column; in reading mode it marks the
  anchor, which is the same job it always had.
- **The anchor is not the middle.** Recognition happens slightly left of centre, so the
  anchor drifts later as words lengthen -- first letter for a one-letter word, second for
  short words, third for medium, fourth for long. The word is laid out around it.
- **Pace is words per minute, literally.** Elsewhere WPM is characters over five, which is
  the right definition for typing and the wrong one here: this mode shows words, so it
  should count them.
- **Punctuation earns a beat.** A comma, a full stop or a verse boundary holds fractionally
  longer, because a sentence that ends should feel like it ended.

### The anchor, exactly

The tiers are the established RSVP convention and not a curve of ours. They are in
`core/lectio.ts` as `ANCHOR_TIERS`, and they are not tunable for the same reason `CELL_W`
is not: their value is that every speed reader in the world already uses them.

| letters in the word | anchor | example |
|---|---|---|
| 1 | 1st letter | **a** |
| 2-5 | 2nd | t**h**e, w**a**ters |
| 6-9 | 3rd | be**g**inning |
| 10 and over | 4th | fir**m**ament, lov**i**ngkindnesses |

It is measured over the word's **letters**, so wrapping quotes and a trailing comma move
nothing: `beginning` and `beginning,` anchor on the same `g`. A comma is not part of the
word and must not be able to shift where the eye is asked to land.

Everything else about the word is laid out around that letter -- which costs one
subtraction, because the ribbon's glyphs are already at `i * CELL_W` and the offset that
puts glyph *n* on the focal column is the same arithmetic the typing rail does with the
cursor. The invariant is the rail's own, unchanged, and it holds by construction.

### Why this also settles the comfort question

RSVP has **no motion at all**. There is nothing to freeze under
[reduced motion](12-motion-and-comfort.md), nothing to step, and no stutter to trade
against smoothness -- the objection that reduced-motion reading was fifteen jumps a second
disappears with the scroll it was jumping.

So reading mode goes from the strongest motion stimulus in the game to the weakest, and
becomes the mode to reach for when the eyes have had enough rather than the one to avoid.

### Coming back down

The pace ramps up while it is sustained. It must also be possible to ease off without
leaving the mode: the first version required quitting and re-entering, which restarts the
ramp, on the theory that slowing down should be a decision. In practice that is a decision
the player cannot express, which is not the same thing.

**Down and up, named under the rail** beside the way out, in the line that otherwise names
the next key -- because a control nobody is told about is the same as not having one.

They move the **ramp clock** rather than sitting on top of it. A correction term would be
walked over by the ramp a few seconds later, so the pace the player asked for would quietly
stop being the pace; moving the clock means the pace he came down to is where the ramp now
is, and it climbs again from there. `lectio_pace_step` is what one press is worth.

Up is there as well as down, and it is not a way to win anything: there is nothing to win
here. It is for a reader who already knows he reads at 400 and would otherwise spend ten
minutes waiting for the ramp to agree with him. It is bounded by the same ceiling the ramp
is.

### Why the mode is worth shipping

It is the mode available on a day he does not want to drill, it exercises the same corpus,
and it converts the fixed-gaze habit from a side effect of the typing rail into something
practised deliberately. Pace parameters live in [tuning](07-tuning.md).

**This is the one place a clock legitimately drives the display**, and the distinction is
worth keeping clean. The player is not typing, so something has to decide when the next
word appears, and that something is elapsed time. Nothing follows from it: no verdict, no
score, no failure, and nothing on the typing side reads a clock for any of those --
[ADR 0004](../decisions/0004-idle-threat-not-speed-timer.md) is untouched, and so is the
rule that [the scribe's page](#the-scribe-at-his-lectern) moves only when the player types.
A clock that decides what is *drawn* is not a clock the player is racing.

**It is called Reading, and it was called Lectio.** The name came from *lectio divina*, the
slow devotional reading the mode is shaped after, and it sat in the interface with nothing
whatever to explain it. The owner, on meeting it: *"Lectio? Is that the character name?"* —
which is exactly what an unglossed Latin word does in a menu. Everything a player sees now
says **Reading**: the menu, the HUD while it is running, and the way out under the rail.
The internal identifiers keep the old name — `core/lectio.ts`, `LectioState`,
`lectio_start_words_per_min` — for the same reason `candle_interval` does: it is a good name for the
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
