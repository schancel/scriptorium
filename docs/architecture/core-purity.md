# Core purity

`core/` is pure logic. It must not reference any platform API.

Forbidden anywhere under `core/`: `document`, `window`, `canvas`, `AudioContext`,
`localStorage`, `sessionStorage`, `fetch`, `XMLHttpRequest`, `Date.now`, `performance.now`,
`Math.random`, `requestAnimationFrame`, `setTimeout`, `console`.

## How it is enforced -- two layers

**1. The compiler.** `tsconfig.core.json` typechecks `core/` with the DOM library and
`@types/node` excluded, so every platform global is simply undefined and any use is a
compile error. The compiler distinguishes a global from a variable that happens to share
its name; a regex cannot.

**2. A narrow grep.** `tools/check_core_purity.py` covers only what layer 1 cannot:
`Date.now`, `new Date` and `Math.random` are genuine ES built-ins and remain in scope.
They must be injected instead -- time as a `dtMs` parameter, randomness as the seeded
PRNG in `core/rng.ts`.

Test files are exempt. Purity is a property of the shipped core, not of the harness that
exercises it.

This was originally one grep over a forbidden-word list, and it did not work. Its comment
regex was `//.*$` under `re.S`, and because `re.S` makes `.` match newlines it deleted
everything from the first line comment to the end of the file -- so the check scanned
almost nothing for most of the project's life. When that was fixed it immediately produced
22 false positives, all of them a local variable named `window` holding a *trailing window*
of keystrokes. A word list cannot tell those apart. The type checker can, which is why the
compiler is now the primary layer and the grep covers only the remainder.

The rule only holds because it is mechanical; every project that has tried to maintain this
boundary by convention has lost it within a few months. It is worth adding that a
mechanical check you have not tried to defeat is a guess -- this one passed for days while
reading roughly the first line of each file.

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
