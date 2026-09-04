# Working in this repository

Read this before touching anything. It is short on purpose — an agent that reads only
this file should still do the right thing.

## The one rule

**The documentation is the source of truth. The code is a projection of it.**

Do not infer the design from the code. The reasoning behind every mechanic lives in
`docs/design/`, and the reasoning behind every *rejected alternative* lives in
`docs/decisions/`. None of it is recoverable by reading `core/`. If you change behaviour
without changing the doc that specifies it, `make check` fails — by design.

```sh
make build     # compile docs tables into data/, and TypeScript into build/
make check     # run before every commit. all invariants, no exceptions.
```

## Where the source of truth lives

| To change… | Edit this | Then |
|---|---|---|
| Which keys a stage teaches | `docs/design/06-curriculum.md` | `make build` |
| Any number in the game | `docs/design/07-tuning.md` | `make build` |
| Route passages / warp echoes | `docs/design/04-route.md` | `make build` |
| Scene themes and set pieces | `docs/design/05-scenery-warps.md` | `make build` |
| Item effects | `docs/design/03-pacing.md` | `make build` |
| Anything algorithmic | the doc named in the module's `@doc` header, *then* the code | — |

Files under `data/` marked generated are **compiled from those markdown tables**.
`make check` regenerates them and fails on any diff, so hand-editing them cannot work.
This is the mechanism that keeps docs honest; do not route around it.

## Invariants

`make check` enforces all of these. They are not style preferences.

1. **Core purity.** `core/` contains no `document`, `window`, `canvas`, `AudioContext`,
   `localStorage`, `fetch`, `Date.now` or `Math.random`. Platform access happens only in
   `platform/web/`. This is what keeps a Dart/Flutter port cheap.
   → `docs/architecture/core-purity.md`
2. **Illumination.** No character presented as *live* may fall outside the current
   stage's key set. A single leaked key sends a beginner back to hunting for it.
   → `docs/design/01-illumination.md`
3. **Docs projection.** Generated `data/` files match what the docs compile to.
4. **Doc links.** Every `core/` module has a `@doc` header resolving to a real file and
   anchor; every design doc names at least one implementing module.
5. **No magic numbers.** Numeric literals in `core/` outside a tiny allowlist are a
   failure. Tunables come from `data/tuning.json`, generated from the tuning doc.
6. **Determinism.** `sim.js` is a pure function of `(state, inputs, dtMs, rng)`. Same
   seed and input trace must produce identical state.
7. **One build step, no runtime dependencies.** `tsc` only -- no bundler, no framework,
   no runtime deps, and neither `build/` nor `node_modules/` committed.
   -> `docs/decisions/0007-typescript-with-one-build-step.md`

## Standing prohibitions

These have been decided. Each has an ADR explaining what was rejected and why. If you
believe one is wrong, change the ADR in the same commit — do not silently reverse it.

- **Do not add a speed timer or any time-based failure.** The game is player-paced. The
  only pressure is *idleness*, via the blot-cloud. This looks like an omission and is
  not. → `docs/decisions/0004-idle-threat-not-speed-timer.md`
- **Do not cost a heart per typo.** Errors fill a smudge meter; only a full meter costs
  a heart. A beginner errs on ~1 keystroke in 10 and per-typo damage kills them four
  times a verse. → `docs/decisions/0005-smudge-meter-over-per-typo-damage.md`
- **Do not filter the corpus down to typable words.** Show the real text and grey the
  unlearned letters. Filtering yields `ask`, `fall`, `a lad` — not Scripture.
  → `docs/decisions/0003-illumination-over-corpus-filtering.md`
- **Do not add the NET Bible or any non-public-domain text.**
  → `docs/decisions/0002-web-and-kjv-not-net.md`
- **Do not add a framework, bundler or npm dependency.**
  → `docs/decisions/0001-web-app-not-game-engine.md`

## Who this is for

One specific beginner who types with two fingers today. When a trade-off is unclear, ask
which choice serves *him* — not which is more elegant, and not which is more like other
typing games. A change that makes the game better for fluent typists and worse for him
is a regression.
