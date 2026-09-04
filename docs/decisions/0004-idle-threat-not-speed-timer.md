# 0004 — An idle threat, not a speed timer

**Status:** accepted, 2026-09-03

## Context

A beginner on home row types 8–15 WPM. Every mainstream typing game assumes 40+ and fails
the player below that. But a game with no pressure at all has no stakes, and nothing on
screen matters.

## Decision

The game is **player-paced**: the world advances only when the player types, and monsters
idle in place rather than approaching on a clock.

Stakes come from an **idle threat**. A cloud of ink drifts in when the player stops typing
entirely and smudges completed work. Any correct keystroke drives it back. Threshold
starts at 8 seconds and tightens by stage.

## Consequences

- Deliberating for five seconds over a single keystroke costs nothing. Stopping to hunt
  the keyboard brings the cloud. The mechanic punishes exactly the target behaviour and
  nothing else.
- The game is playable at 10 WPM and at 80 WPM without a difficulty setting.
- Tension is preserved without a clock, so the arcade framing survives.
- The threat is disableable. That switch is deliberate and must not be removed.

## Alternatives rejected

**A speed timer or advancing enemies.** The Typing of the Dead model. Rejected: it is
inherently calibrated to a WPM the player does not have, and being told he is too slow,
repeatedly, during the fortnight he is most likely to quit, is the single most effective
way to end the project.

**No pressure at all.** Rejected: without any failure state the platformer framing is
decoration, and the items, hearts and combo have nothing to push against.

## Note for future contributors

This looks like a missing feature. It is not. A typing game "should" have a timer, and
that intuition is exactly why this ADR exists. Do not add one.
