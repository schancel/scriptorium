/**
 * Executes a display list on a 2D canvas.
 *
 * The other half of docs/architecture/display-list.md. Everything here is
 * throw-away in a port: it turns palette indices into CSS, style names into
 * fonts, and virtual coordinates into device pixels, and it knows nothing else.
 * There is no game rule in this file and none may be added -- if a decision about
 * *what* to draw appears here, it belongs in core/draw.ts.
 *
 * ## The two palettes
 *
 * A command carrying a `theme` speaks the *art* palette: the roles in
 * `core/sprites.ts`, resolved to sixteen 24-bit colours by that theme in
 * `core/worlds.ts`. A command without one speaks the *interface* palette,
 * `PALETTE_ORDER` in `core/draw.ts`, whose CSS lives in this file. They are
 * deliberately separate vocabularies and this is the only place both are known.
 *
 * ## Why sprites are baked into little canvases
 *
 * A sprite is a flat array of palette indices, and the obvious way to draw one
 * is 256 one-pixel fills. At three parallax layers of tiles that is sixty
 * thousand fills a frame, which is not a frame. So each (sprite, frame, theme)
 * is painted once into a 16x16 canvas through `putImageData` and thereafter
 * blitted. The cache is bounded by the art itself -- a dozen sprites, a handful
 * of frames, ten themes -- so it needs no eviction.
 */

import { PALETTE_ORDER, VIRTUAL_H, VIRTUAL_W } from '../../core/draw.js';
import { NONE, SPRITE_SIZE, frameIndex, spriteFor } from '../../core/sprites.js';
import { colourFor, worldFor } from '../../core/worlds.js';
import type { DrawCmd } from '../../core/types.js';

/** Bits per channel, for turning a 24-bit theme colour into CSS. */
const HEX_DIGITS = 6;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const SANS = 'ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif';

/**
 * The abbey palette: stone greys and candle amber, per data/themes.json.
 *
 * Keyed by slot name and projected through PALETTE_ORDER, so adding a slot in
 * core cannot silently shift every colour in the game by one.
 *
 * The ten finger colours are the load-bearing ones: left hand warm, right hand
 * cool, so a glance at the overlay says which hand before it says which finger.
 */
const CSS: Readonly<Record<string, string>> = {
  bg: '#14120f',
  band: '#1e1a15',
  dim: '#4a4238',
  live: '#ece0c4',
  done: '#8a7f6b',
  gold: '#f0b429',
  hud: '#c8bda6',
  rule: '#7a6b50',
  panel: '#0d0b09',
  keyFace: '#2a251e',
  keyLabel: '#15120e',
  error: '#d6524a',
  lp: '#e0675f',
  lr: '#e09a4d',
  lm: '#d8cc5e',
  li: '#84c46a',
  lt: '#9aa0a8',
  rt: '#63b5c6',
  ri: '#5fb99a',
  rm: '#7fa8e0',
  rr: '#a98ae0',
  rp: '#dd85bd',
};

const COLORS: readonly string[] = PALETTE_ORDER.map((slot) => {
  const css = CSS[slot];
  if (css === undefined) throw new Error(`renderer: no colour for palette slot "${slot}"`);
  return css;
});

interface TextStyle {
  readonly font: string;
  readonly align: CanvasTextAlign;
  readonly baseline: CanvasTextBaseline;
}

/**
 * Fonts live here rather than in core because a pixel size is meaningless
 * without a font, and a font is a platform fact. The rail sizes must keep every
 * glyph inside one 12px cell or the ribbon would print wider than it advances.
 */
const STYLES: Readonly<Record<string, TextStyle>> = {
  'rail-live': { font: `17px ${MONO}`, align: 'left', baseline: 'alphabetic' },
  'rail-dim': { font: `17px ${MONO}`, align: 'left', baseline: 'alphabetic' },
  'rail-done': { font: `17px ${MONO}`, align: 'left', baseline: 'alphabetic' },
  'rail-cursor': { font: `bold 17px ${MONO}`, align: 'left', baseline: 'alphabetic' },
  'rail-error': { font: `bold 17px ${MONO}`, align: 'left', baseline: 'alphabetic' },
  // A gilded character: greyed by the curriculum, typed anyway. Same metrics as
  // every other rail glyph -- one 12px cell -- and gold by its palette slot.
  'rail-gild': { font: `17px ${MONO}`, align: 'left', baseline: 'alphabetic' },
  hud: { font: `bold 11px ${SANS}`, align: 'left', baseline: 'middle' },
  'hud-center': { font: `bold 11px ${SANS}`, align: 'center', baseline: 'middle' },
  'hud-right': { font: `bold 11px ${SANS}`, align: 'right', baseline: 'middle' },
  key: { font: `9px ${SANS}`, align: 'center', baseline: 'middle' },
  'hint-center': { font: `bold 11px ${MONO}`, align: 'center', baseline: 'middle' },
  // A first-run note is prose, so it is set in the interface face rather than
  // the mono the key hint uses: the hint names keys and wants to look like
  // keys, and a sentence set in the same face reads as more machinery.
  'note-center': { font: `11px ${SANS}`, align: 'center', baseline: 'middle' },
  title: { font: `bold 17px ${SANS}`, align: 'left', baseline: 'middle' },
  report: { font: `11px ${MONO}`, align: 'left', baseline: 'middle' },
};

const FALLBACK_STYLE: TextStyle = { font: `11px ${SANS}`, align: 'left', baseline: 'middle' };

export interface Renderer {
  /** Re-read the element's size. Call on resize before the next frame. */
  resize(): void;
  render(cmds: readonly DrawCmd[]): void;
}

function colour(index: number): string {
  return COLORS[index] ?? COLORS[0] ?? '#000000';
}

/** A theme's colour for an art role, as CSS. */
function artColour(theme: string, role: number): string {
  const value = colourFor(worldFor(theme), role);
  return `#${value.toString(16).padStart(HEX_DIGITS, '0')}`;
}

/**
 * One sprite frame, baked in one theme's colours.
 *
 * Index 0 is `NONE` and becomes a transparent pixel rather than the palette's
 * black: an unpainted pixel in the art must stay unpainted, or every sprite
 * arrives in a 16x16 box.
 */
function bakeSprite(id: string, frame: number, theme: string): HTMLCanvasElement | null {
  const art = spriteFor(id);
  if (art === null) return null;
  const pixels = art.frames[frameIndex(art, frame)];
  if (pixels === undefined) return null;

  const tile = document.createElement('canvas');
  tile.width = art.w;
  tile.height = art.h;
  const tileCtx = tile.getContext('2d');
  if (tileCtx === null) return null;

  const world = worldFor(theme);
  const image = tileCtx.createImageData(art.w, art.h);
  for (let i = 0; i < pixels.length; i += 1) {
    const role = pixels[i] ?? NONE;
    const at = i * 4;
    if (role === NONE) continue;
    const rgb = colourFor(world, role);
    image.data[at] = (rgb >> 16) & 0xff;
    image.data[at + 1] = (rgb >> 8) & 0xff;
    image.data[at + 2] = rgb & 0xff;
    image.data[at + 3] = 0xff;
  }
  tileCtx.putImageData(image, 0, 0);
  return tile;
}

export function createRenderer(surface: HTMLCanvasElement): Renderer {
  const context = surface.getContext('2d');
  if (context === null) throw new Error('renderer: no 2d context');
  const ctx: CanvasRenderingContext2D = context;

  let scale = 1;
  let originX = 0;
  let originY = 0;

  /** Baked sprite frames, keyed by theme, sprite and frame. */
  const baked = new Map<string, HTMLCanvasElement | null>();

  function spriteCanvas(id: string, frame: number, theme: string): HTMLCanvasElement | null {
    const key = `${theme}|${id}|${String(frame)}`;
    const cached = baked.get(key);
    if (cached !== undefined) return cached;
    const made = bakeSprite(id, frame, theme);
    baked.set(key, made);
    return made;
  }

  /**
   * Fill a rect with a tile, the grid anchored at the rect's own corner.
   *
   * Clipped to the rect, which is what lets the core scroll a band by emitting
   * it a fraction of a tile to the left and a tile wider: the overhang at both
   * ends is the scroll, and nothing of it may land in the rail band below.
   */
  function fillWithTile(art: HTMLCanvasElement, x: number, y: number, w: number, h: number): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let ty = y; ty < y + h; ty += SPRITE_SIZE) {
      for (let tx = x; tx < x + w; tx += SPRITE_SIZE) {
        ctx.drawImage(art, tx, ty);
      }
    }
    ctx.restore();
  }

  function resize(): void {
    const dpr = self.devicePixelRatio || 1;
    const cssW = surface.clientWidth;
    const cssH = surface.clientHeight;
    surface.width = Math.max(1, Math.round(cssW * dpr));
    surface.height = Math.max(1, Math.round(cssH * dpr));
    // Letterbox: the design resolution keeps its aspect, so nothing the core
    // positioned relative to the focal x can be stretched off it.
    scale = Math.min(cssW / VIRTUAL_W, cssH / VIRTUAL_H) * dpr;
    originX = (surface.width - VIRTUAL_W * scale) / 2;
    originY = (surface.height - VIRTUAL_H * scale) / 2;
  }

  function render(cmds: readonly DrawCmd[]): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, surface.width, surface.height);
    ctx.fillStyle = CSS['bg'] ?? '#000000';
    ctx.fillRect(0, 0, surface.width, surface.height);
    ctx.setTransform(scale, 0, 0, scale, originX, originY);
    // Chunky by design: a 16x16 sprite scaled up must stay 16x16, not blur.
    ctx.imageSmoothingEnabled = false;

    for (const cmd of cmds) {
      ctx.globalAlpha = 'alpha' in cmd && cmd.alpha !== undefined ? cmd.alpha : 1;
      switch (cmd.op) {
        case 'rect': {
          ctx.fillStyle = cmd.theme === undefined
            ? colour(cmd.color)
            : artColour(cmd.theme, cmd.color);
          ctx.fillRect(cmd.x, cmd.y, cmd.w, cmd.h);
          break;
        }
        case 'line': {
          ctx.strokeStyle = colour(cmd.color);
          ctx.lineWidth = cmd.width ?? 1;
          ctx.beginPath();
          ctx.moveTo(cmd.x1, cmd.y1);
          ctx.lineTo(cmd.x2, cmd.y2);
          ctx.stroke();
          break;
        }
        case 'text': {
          const style = STYLES[cmd.style] ?? FALLBACK_STYLE;
          ctx.font = style.font;
          ctx.textAlign = style.align;
          ctx.textBaseline = style.baseline;
          ctx.fillStyle = colour(cmd.color);
          ctx.fillText(cmd.value, cmd.x, cmd.y);
          break;
        }
        case 'tile': {
          const art = cmd.theme === undefined ? null : spriteCanvas(cmd.id, 0, cmd.theme);
          if (art === null) {
            // A tile with no theme, or naming art that does not exist. Drawn as
            // a flat block so a missing asset is visible rather than silent.
            ctx.fillStyle = CSS['band'] ?? '#000000';
            ctx.fillRect(cmd.x, cmd.y, cmd.w, cmd.h);
            break;
          }
          fillWithTile(art, cmd.x, cmd.y, cmd.w, cmd.h);
          break;
        }
        case 'sprite': {
          const art = cmd.theme === undefined
            ? null
            : spriteCanvas(cmd.id, cmd.frame ?? 0, cmd.theme);
          // Nothing to draw for art that does not exist: a placeholder box in
          // the scenery band would be worse than a gap.
          if (art === null) break;
          if (cmd.flip === true) {
            ctx.save();
            ctx.translate(cmd.x + art.width, cmd.y);
            ctx.scale(-1, 1);
            ctx.drawImage(art, 0, 0);
            ctx.restore();
          } else {
            ctx.drawImage(art, cmd.x, cmd.y);
          }
          break;
        }
        default: {
          const unhandled: never = cmd;
          return unhandled;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  resize();
  return { resize, render };
}
