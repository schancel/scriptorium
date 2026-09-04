# 0003 — Illumination, not corpus filtering

**Status:** accepted, 2026-09-03

## Context

The player must never be asked for a key he has not been taught, or he will look down and
hunt for it. But the game's premise is typing real Scripture. These pull against each
other: at stage 1 the taught keys are the home row, and almost nothing in Genesis is
spelled with only those letters.

## Decision

Show the real verse in full, always. Classify each character as **live** (its key is
taught; the player must type it) or **greyed** (not yet taught; it renders dimmed and
auto-advances). See [illumination](../design/01-illumination.md).

## Consequences

- The player reads actual Scripture from the first minute while pressing only taught keys.
- Difficulty moves from *which words appear* to *which keys are the player's
  responsibility*, which is a far better axis — the text stays constant while the demand
  grows.
- Roughly 40% of keystrokes are live at stage 1, rising to 100% by stage 8. Enough to feel
  like typing rather than watching.
- Requires an exhaustively checked invariant: no live character may fall outside the
  current key set. This is the most important correctness property in the codebase.
- The visual — a manuscript lighting up as it is earned — gave the project its name.

## Alternatives rejected

**Filter the corpus to typable words.** The conventional tutor approach. Rejected because
home row yields `ask`, `fall`, `a lad`, `alas`, `salad` — which is not recognisably
Scripture and discards the entire reason for the text. The player would spend weeks on
word lists before reading anything.

**Show whole verses and require every key immediately.** Rejected because it teaches
nothing: every unlearned letter is an invitation to hunt, and the player already has years
of practice at hunting. It would produce a faster two-finger typist, which is precisely
the failure mode.
