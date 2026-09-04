# 0005 — A smudge meter, not a heart per typo

**Status:** accepted, 2026-09-03

## Context

Mistakes need a cost or accuracy does not matter. The obvious implementation — a heart per
mistyped key — was considered and requested.

## Decision

Errors add to a **smudge meter**. Correct keystrokes wipe it down. Only a *full* meter
costs a heart. Tolerance narrows by stage.

## Consequences

- A beginner errs on roughly one keystroke in ten. At three hearts, per-typo damage would
  empty his hearts four or five times per verse — an unplayable death spiral during exactly the
  period he most needs to keep going.
- The meter recovers, so a bad patch is survivable if he steadies afterwards. That
  recovery arc is a better lesson than a punishment.
- Narrowing tolerance keeps the mechanic meaningful as accuracy improves, without ever
  changing the rule.
- Combined with candle checkpoints, the worst realistic outcome is losing a verse.

## Alternatives rejected

**One heart per typo.** Rejected on the arithmetic above. Kept here because it is the
intuitive design and will be proposed again.

**No damage from typos at all.** Rejected: accuracy is the thing being taught, and it has
to register somewhere. The wrong key already blocks the cursor, but blocking alone
communicates "try again", not "that cost you something".
