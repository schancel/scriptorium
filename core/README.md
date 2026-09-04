# core/

Pure game logic. **No platform APIs, ever** — no `document`, `window`, `canvas`,
`AudioContext`, `localStorage`, `fetch`, `Date.now`, `Math.random`, `console`.
`make check` greps for all of them and fails on a hit.

Everything ambient arrives as an argument: elapsed time as `dtMs`, randomness as a
seeded PRNG, text already parsed, input already normalised. Rendering and audio are
*returned as data* — `draw.js` emits a display list, `sound.js` emits sound events — and
the platform executes them.

Why: it makes the core testable without a browser, deterministic (same seed and input
trace always yields the same state), and cheap to port. See
[core purity](../docs/architecture/core-purity.md).

Every module opens with a `@doc path.md#anchor` header naming the design document it
implements. That link is checked in both directions.

No magic numbers. Tunables come from `data/tuning.json`, which is compiled from
[the tuning doc](../docs/design/07-tuning.md).
