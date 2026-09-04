# 0007 — TypeScript, accepting a single compile step

**Status:** accepted, 2026-09-03. Amends [ADR 0001](0001-web-app-not-game-engine.md).

## Context

ADR 0001 chose a zero-build-step web app, and the codebase initially used plain
JavaScript with types expressed as JSDoc annotations, checked by `tsc --noEmit`. That
gave real type checking without a compile step.

The owner prefers TypeScript, having spent years dealing with type problems in
JavaScript. Browsers cannot execute `.ts`, so honouring that preference necessarily
introduces a compile step.

## Decision

Write real TypeScript. Accept exactly one build step: `tsc`, emitting ES modules to
`build/`. No bundler, no framework, no transform pipeline, no runtime dependencies. The
sole devDependency is `typescript`.

CI compiles and deploys to GitHub Pages, so no generated JavaScript is committed.

## Consequences

- `index.html` loads `build/platform/web/main.js`. Running locally requires `make build`
  first — a real regression in immediacy, and the price of the decision.
- `build/` is gitignored. `make check` fails if it is ever committed.
- The type system is materially stronger than the JSDoc arrangement it replaces:
  discriminated unions (`DrawCmd` switches exhaustively in the renderer),
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `readonly` fields enforcing
  the core's no-mutation rule at compile time rather than by convention.
- The Dart port gets easier, not harder. TS interfaces map to Dart classes more directly
  than JSDoc typedefs did, and `readonly` maps to `final`.
- Deployment now depends on CI succeeding. Previously a push was the deploy.

## What is preserved

The property ADR 0001 actually cared about was never "no build step" for its own sake —
it was *you send him a link and he plays*, with no toolchain rot and nothing to install.
That survives intact: one pinned compiler, no dependency tree, no bundler config, and a
repository that is still entirely readable text.

The renamed invariant is **one build step, no runtime dependencies**. `check_zero_install.sh`
enforces the new form: runtime dependencies, bundler configs, committed `node_modules/`
and committed `build/` all fail.

## Alternatives rejected

**Stay on JSDoc-annotated JavaScript.** Genuinely zero-build and already working.
Rejected because the owner stated a clear preference, the annotations are verbose, and
several useful constructs (discriminated unions, `readonly`, generics) are painful or
impossible to express well in JSDoc.

**Ship TypeScript and compile in the browser.** Rejected outright: a megabyte of compiler
on every page load to avoid a five-second build.

**A bundler with TS support (Vite, esbuild).** Rejected: strictly more machinery than
`tsc` alone, and the project has no need for bundling, tree-shaking or HMR.
