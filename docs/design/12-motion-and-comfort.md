# Motion and comfort

**Implemented by:** `core/motion.ts`, `core/rail.ts`, `core/lectio.ts`, `core/draw.ts`, `platform/web/main.ts`

## What happened

The owner, after a long session:

> "I'm getting some visual distortion after playing for awhile even in this terminal
> with text kinda waving back and forth."

That is a **motion aftereffect** — the waterfall illusion. Sustained motion in one
direction adapts the neurons that detect it, and stationary things afterwards appear to
drift the other way. It is a well-understood perceptual effect and it is transient,
usually fading within minutes. It is also not confined to the game: it followed him into
a terminal, which is the point.

## Why this game causes it more than most

Not by accident. The rail is close to a laboratory stimulus for motion adaptation, and
every property that makes it good at its job also makes it good at this:

- **A fixed gaze point.** [The rail](02-rail.md) pins the cursor to the centre of the
  screen so the eyes never travel. Holding fixation is precisely the condition under
  which motion adaptation is strongest — a wandering eye adapts far less.
- **Continuous unidirectional motion.** The ribbon slides right-to-left and never
  reverses.
- **Three parallax layers at different rates**, which is a stronger stimulus than one
  moving field, and is probably the larger contributor of the two.
- **Long sessions, by design.** The game exists to be practised at for weeks.

It was engineered to hold someone's gaze still while things move past it, for as long as
possible. Nobody asked what that does after forty minutes.

## What must change

**1. Respect `prefers-reduced-motion`.** It is an operating-system setting that people
with vestibular disorders and migraine turn on so that software will stop doing this to
them. Honouring it is not a feature, it is the baseline, and its absence here is a defect.
Detected in the platform, passed into the core as state — the core stays pure.

**2. A reduced-motion presentation** that keeps the game and removes the stimulus:

- The ribbon advances in **discrete steps** — a word at a time — rather than sliding
  continuously. The reading position is unchanged, which is what the rail is actually
  for; only the smoothness goes.
- **Parallax is frozen or near-frozen.** Layers at differing rates are the strongest part
  of the stimulus and the least load-bearing part of the design.
- Set-piece and warp animation eased down rather than removed, since both are brief.

**3. Reachable without the OS setting**, in the menu, because someone may want it on one
machine and not another, and because the effect can appear to someone who has never had
reason to turn the system setting on. The owner had not.

## What must not change

The **fixed reading position stays**. It is the point of the rail and it is not what
causes this — a stationary gaze point is only half the recipe, and the half that helps
reading. What goes is continuous motion, not the anchor.

## An honest note on scope

This is a comfort and accessibility matter and it outranks features. A game that is
uncomfortable to practise at for an hour has failed at the thing it is for, and the
player it is built for is meant to be here for weeks.

The effect described above is benign and passes. But it is a reason to stop for a while
when it appears, and the software should never make someone choose between practising and
being comfortable.

## How it is reached

Three states, and the default is the one the operating system was already told.

| setting | what it does |
|---|---|
| **Follow the system** | On when the browser reports `prefers-reduced-motion: reduce`, off when it does not, and it changes the moment the system setting does. This is the default. |
| **Full** | The smooth presentation, whatever the system says. |
| **Reduced** | The stepped presentation, whatever the system says. |

The last two are not a redundancy. Someone may want it on one machine and not on
another, and -- the case that produced this document -- the effect can reach a player who
has never had any reason to turn the system setting on. The owner had not.

**The choice is remembered**, on the [progress record](../architecture/data-schemas.md#progress)
beside `cloudEnabled` and for exactly the same reason: a switch that comes back at every
reload is one he has to find again every evening, which is the same as not having it.

Detection lives in `platform/web/`, which asks `matchMedia` and listens for the answer
changing. `core/` is handed the result as state and never asks anything, so a Dart port
asks its own platform the same question and every rule below stays where it is.

## What reduced motion changes

| | full | reduced |
|---|---|---|
| the ribbon | eases toward the cursor's column over about 267 ms | steps to it, in one frame, with no positions in between |
| the world | eases one stride per completed word | steps a stride per word, and settles in about four frames |
| the parallax layers | scroll at their own authored depths | frozen: `reduced_parallax` multiplies every depth, and it is 0 |
| flame, smoke, swell, drift | run at their authored periods | slowed by `reduced_anim_scale`, because a set piece is brief and worth keeping |
| a crossing | 1.4 seconds of two worlds dissolving, both sliding | the same 1.4 seconds, with neither side sliding |
| reading mode | one word at a time, held still | **identical** -- there was never anything here to reduce |
| the fixed reading column | unchanged | unchanged |

Nothing is removed. Every set piece still runs, every crossing still crosses, the scribe
still walks when the world moves and every verse still looks like the place it is set in.
What goes is *continuous* motion, which is the only part of it the eye adapts to.

### A word at a time, and what the fixed column does to that

The instruction above is "a word at a time", and the ribbon steps a *cell* at a time.
That is not a softening of it; it is what the fixed reading position costs, and it is
worth stating plainly because the next person to read this will otherwise try to fix it.

The cursor is pinned to the focal column, so the ribbon's offset is
`focalX - cursor * CELL_W` and there is exactly one offset per cursor index. A ribbon that
moved only once per word would leave the caret standing over the wrong character for the
five keystrokes in between -- which is not a reduced presentation of the rail, it is a
different rail, and it gives away the one thing
[the rail](02-rail.md#the-focal-guide) exists for.

So the unit a *word* is the unit of is the **world**, which is where it always was: the
camera advances one stride per completed word and in reduced motion it steps rather than
glides. The ribbon takes the smallest step that keeps the caret honest. Both are discrete,
which is the property that matters -- an image that changes position instantly, on a
keystroke the player made, presents nothing for the motion detectors to adapt to. A slide
does.

### Reading mode has nothing left to reduce

This section used to say that [reading](02-rail.md#reading-mode) was the one mode whose
whole content is a continuously sliding page, and that reduced motion floored its offset so
the page stuttered a character at a time instead of gliding. That was an honest translation
of a mode that no longer exists.

Reading is **RSVP** now: one word at a time, replacing each other in place, with an anchor
letter nailed to the focal column. There is no scroll, so there is nothing to freeze;
nothing eases, so there is nothing to step; and the objection this document raised against
the reduced presentation of it -- that it traded a slide for roughly fifteen jumps a second
-- disappeared along with the slide it was jumping.

**So there is no reduced-motion branch in reading mode, and there must not be one.** A
special case that does nothing is worse than no special case: it reads as a decision
somebody made, and the next person to touch the file has to work out what it was for. The
mode is drawn identically whatever this setting says, and the setting still reaches the
frame -- the scenery band behind the word is themed and drawn like any other, and its
parallax obeys `reduced_parallax` like any other. Nothing in it is moving either: a sitting
does not travel the camera and does not run the set pieces' clock, so the whole picture is
still.

Which flips this mode's standing entirely. It was the strongest motion stimulus in the
game; it is now the weakest thing in it, and it is the mode to reach for when the eyes have
had enough rather than the one to avoid.

### Held scenes are the same mechanism seen twice

A [held scene](05-scenery-warps.md#held-scenes-not-every-passage-is-a-journey) does not
translate the camera at all, because nothing in the passage travels. That is an authoring
decision about the text and not an accessibility feature, and it lands in the same place:
a stretch of the session with no lateral scroll in it. A long sitting acquires a rhythm of
travelling and standing still, and the standing-still parts are rest whether or not the
player has ever opened this menu.
