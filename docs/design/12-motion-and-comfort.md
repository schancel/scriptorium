# Motion and comfort

**Implemented by:** `core/rail.ts`, `core/draw.ts`, `platform/web/main.ts`

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
