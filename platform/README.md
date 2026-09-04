# platform/

The only code permitted to touch a real platform API. Everything here is thrown away and
rewritten by a port; nothing here contains game logic.

`platform/web/` is the browser implementation:

| File | Responsibility |
|---|---|
| `main.js` | the rAF loop, wiring, scene switching |
| `canvas_renderer.js` | executes the display list from `core/draw.ts` on Canvas 2D |
| `web_audio.js` | executes sound events from `core/sound.ts` on WebAudio |
| `keyboard_input.js` | `keydown` → normalised core input events |
| `local_storage.js` | progress persistence, file export/import |

If you find yourself wanting a game rule here, it belongs in `core/`. If you find
yourself wanting `document` in `core/`, it belongs here.

See [porting to Dart](../docs/architecture/porting-to-dart.md) for what a second
implementation involves.
