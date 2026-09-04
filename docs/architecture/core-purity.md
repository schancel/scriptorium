# Core purity

`core/` is pure logic. It must not reference any platform API.

Forbidden anywhere under `core/`: `document`, `window`, `canvas`, `AudioContext`,
`localStorage`, `sessionStorage`, `fetch`, `XMLHttpRequest`, `Date.now`, `performance.now`,
`Math.random`, `requestAnimationFrame`, `console`.

`tools/check.sh` greps for all of them and fails on a hit. The rule only holds because it
is mechanical; every project that has tried to maintain this boundary by convention has
lost it within a few months.

## Why

Three payoffs, in order of how soon they arrive:

**Testability, immediately.** A pure `step(state, inputs, dtMs, rng)` is testable without
a browser, a canvas or a clock. The mastery gate, the smudge tuning and the illumination
invariant are all verified by feeding synthetic input traces through the core.

**Determinism, immediately.** With time and randomness injected rather than ambient, the
same seed and input trace always produce the same state. That makes bugs replayable
instead of anecdotal.

**Portability, later.** A Dart/Flutter port rewrites the four files under `platform/web/`
and mechanically translates `core/`. See [porting to Dart](porting-to-dart.md).

## The injected seams

| Ambient thing | Injected as |
|---|---|
| Elapsed time | `dtMs` parameter to `sim.step` |
| Randomness | a seeded PRNG passed into `sim.step` |
| Rendering | `draw.js` returns a display list; the platform executes it |
| Audio | `sound.js` returns sound events; the platform executes them |
| Input | keystrokes arrive as core input events, already normalised |
| Persistence | the platform loads and saves the progress record |
| Text loading | the platform fetches; `corpus.js` receives parsed data |

`core/` never reaches out. Everything it needs arrives as an argument.

## Consequences you will feel

Logging is awkward, because `console` is banned. Return diagnostic data in the state and
let the platform print it.

Timing anything requires threading `dtMs` through, which is tedious the first time and
then stops being a problem.

Neither is an accident. Both are the cost of the three payoffs above, and both were
priced in.
