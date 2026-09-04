# The display list

`core/draw.js` does not draw. It returns a flat array of draw commands describing what a
frame should look like; `platform/web/canvas_renderer.js` executes them against a Canvas
2D context.

This is the single biggest portability lever in the codebase. The same array is executed
unchanged by a Flutter `CustomPainter`, an SDL backend, or a test harness that asserts on
its contents rather than on pixels.

## Commands

```js
{ op: 'sprite', id: 'scribe',  x, y, frame, flip, tint }
{ op: 'tile',   id: 'stone',   x, y, w, h }
{ op: 'text',   value: '…',    x, y, style, alpha }
{ op: 'rect',   x, y, w, h, color, alpha }
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
  data. If a command cannot survive `JSON.stringify` and back, it is wrong.

## Testing

Because a frame is data, rendering is assertable without pixels: run the sim to a known
state, generate the display list, and assert that the cursor's `x` is unchanged across a
chapter, or that no `text` command uses the live style for a greyed character.

That is how [the rail invariant](../design/02-rail.md#the-focal-guide) and the
[illumination invariant](../design/01-illumination.md#classification) are actually checked.
