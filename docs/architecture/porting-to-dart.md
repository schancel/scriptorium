# Porting to Dart

Not planned, but designed for. The requirement was a web app now with an architecture
that translates later, and everything in [core purity](core-purity.md) exists to serve it.

## What a port actually involves

**Rewritten by hand — four files.** `platform/web/` is the entire platform surface:

| File | Flutter equivalent |
|---|---|
| `canvas_renderer.js` | a `CustomPainter` executing the same display list |
| `web_audio.js` | `dart:web_audio`, or an oscillator package |
| `keyboard_input.js` | a `Focus`/`RawKeyboardListener` widget |
| `local_storage.js` | `shared_preferences` or a file |
| `main.js` | a `Ticker` driving `sim.step` |

**Mechanically translated — `core/`.** Pure functions over plain data. The JSDoc typedefs
in `core/types.ts` become Dart classes almost line for line, which is the main reason
`checkJs` is on with `strict` in an otherwise dependency-free repository: the types exist
to make this translation obvious rather than to catch bugs.

**Unchanged — `data/` and `docs/`.** All content is JSON and markdown. Verses, routes,
scenes, themes, tunes, curriculum and tuning port verbatim.

## What makes it cheap

- No framework. Nothing to find an equivalent for.
- No ambient time or randomness, so no hidden platform coupling.
- Rendering is data, not API calls — the hardest thing to port in most games is a
  non-issue here.
- Determinism means the port can be validated against the original: run both on the same
  seed and input trace and diff the resulting state.

That last point is the real prize. A port is normally unverifiable — you play it and hope.
Here it is a diff.
