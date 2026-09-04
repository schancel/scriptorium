# 0011 — The game must respect reduced motion

**Status:** accepted, 2026-09-04

## Context

Nothing in the game consulted `prefers-reduced-motion`, and the rail is an unusually
strong motion stimulus: a fixed gaze point, continuous unidirectional scrolling, and
three parallax layers at differing rates, sustained for as long as the player will sit
there. The owner reported a motion aftereffect that followed him out of the game and into
a terminal.

The effect is benign and transient. That it is benign is not the point: the software
gave him no way to avoid it and no indication it might happen.

## Decision

`prefers-reduced-motion` is honoured, and a reduced-motion presentation exists and is
reachable from the menu independently of the OS setting.

In that mode the ribbon advances in discrete steps rather than sliding, parallax is
frozen or near-frozen, and scenery animation is eased down. **The fixed reading position
is unchanged** — it is the point of the rail, it is not the cause, and removing it would
mean losing the thing that works to fix the thing that hurts.

## Consequences

- Two presentations of the rail to keep working, and the smoke test must drive both.
- The reduced mode is not a degraded mode. It must be a good way to play, because for
  some people it is the only way.
- Detection belongs in `platform/web/`; the core receives it as state, so `core/` stays
  pure and a Dart port asks its own platform the same question.

## Alternatives rejected

**Do nothing; it fades.** It does fade. But an OS-level accessibility setting exists
precisely so that people do not have to discover this by experiencing it, and ignoring it
is a defect regardless of severity.

**Reduce the motion for everyone.** Rejected: the smooth ribbon is pleasant and most
players will never be troubled by it. The right answer is a choice that defaults to the
one the operating system was already told.

**Drop the fixed gaze point.** Rejected: it is half the reason the rail exists, it is the
half that helps reading, and a wandering gaze is not what most needs fixing here.
