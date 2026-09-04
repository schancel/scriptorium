# The display list

`core/draw.ts` does not draw. It returns a flat array of draw commands describing what a
frame should look like; `platform/web/canvas_renderer.ts` executes them against a Canvas
2D context.

This is the single biggest portability lever in the codebase. The same array is executed
unchanged by a Flutter `CustomPainter`, an SDL backend, or a test harness that asserts on
its contents rather than on pixels.

## Commands

```js
{ op: 'sprite', id: 'scribe',  x, y, frame, flip, tint, alpha, theme }
{ op: 'tile',   id: 'stone',   x, y, w, h, alpha, theme }
{ op: 'text',   value: '…',    x, y, style, color, alpha }
{ op: 'rect',   x, y, w, h, color, alpha, theme }
{ op: 'line',   x1, y1, x2, y2, color, width }
```

Rules that keep it portable:

- **Ordered back to front.** There is no z-index and no sorting in the renderer. The core
  emits commands in paint order.
- **Coordinates are virtual**, in a fixed design resolution. The platform scales and
  letterboxes. The core never learns the window size.
- **Colours are palette indices, not CSS strings.** `worlds.js` resolves a theme's palette;
  the platform maps indices to whatever its drawing API wants.
- **No callbacks, no closures, no object references.** Every command is plain serialisable
  data. If a command cannot survive `JSON.stringify` and back, it is wrong. That includes
  `-0`, which is a real and distinct value in JavaScript and does not come back as itself;
  `core/draw.ts` normalises it away at every rounding.

## Which palette a command speaks

There are deliberately **two** palettes and they are different vocabularies:

| | named in | slots | example |
|---|---|---|---|
| interface | `core/draw.ts`, `PALETTE_ORDER` | `hud`, `rule`, `error`, one per finger | the caret, the smudge meter |
| art | `core/sprites.ts`, `PALETTE_ROLES` | `robe`, `flame`, `groundTop` | the scribe, a tile, a heart |

A command says which one it means by carrying a `theme` or not. Without a `theme` it
speaks the interface palette. With one, its colours are resolved through that theme's
sixteen art colours in `core/worlds.ts` — which is what lets the *same sixteen pixels* of
`tile_stone` read as cloister grey in the abbey and ochre in the wilderness, with no second
tileset.

`sprite` and `tile` name pixels that are already role indices, so `theme` only chooses the
colours. On a `rect` it also re-reads `color` as a role index rather than an interface slot,
which is how the sky behind the parallax is themed without the HUD's vocabulary growing an
opinion about the weather.

The alternative — a stateful `set palette` command, or a renderer told the theme out of
band — was rejected because it would make a single command unexecutable on its own, and
"every command is plain data" is the property the whole file exists to protect.

## Testing

Because a frame is data, rendering is assertable without pixels: run the sim to a known
state, generate the display list, and assert that the cursor's `x` is unchanged across a
chapter, or that no `text` command uses the live style for a greyed character.

That is how [the rail invariant](../design/02-rail.md#the-focal-guide) and the
[illumination invariant](../design/01-illumination.md#classification) are actually checked.

`core/scene.test.ts` checks the scenery the same way: that adding a world behind the text
moves the focal x by exactly nothing, that nothing drawn for that world reaches down into
the rail's band, and that an hour of frames with no keystroke leaves every monster on the
pixel it was placed on. All three are properties of the array, and none of them needs a
screenshot to assert.
