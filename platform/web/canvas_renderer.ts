/**
 * Executes a display list on a 2D canvas.
 *
 * The other half of docs/architecture/display-list.md. Everything here is
 * throw-away in a port: it turns palette indices into CSS, style names into
 * fonts, and virtual coordinates into device pixels, and it knows nothing else.
 * There is no game rule in this file and none may be added -- if a decision about
 * *what* to draw appears here, it belongs in core/draw.ts.
 */

import { PALETTE_ORDER, VIRTUAL_H, VIRTUAL_W } from '../../core/draw.js';
import type { DrawCmd } from '../../core/types.js';

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
  hud: { font: `bold 11px ${SANS}`, align: 'left', baseline: 'middle' },
  'hud-center': { font: `bold 11px ${SANS}`, align: 'center', baseline: 'middle' },
  'hud-right': { font: `bold 11px ${SANS}`, align: 'right', baseline: 'middle' },
  key: { font: `9px ${SANS}`, align: 'center', baseline: 'middle' },
  'hint-center': { font: `bold 11px ${MONO}`, align: 'center', baseline: 'middle' },
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

export function createRenderer(surface: HTMLCanvasElement): Renderer {
  const context = surface.getContext('2d');
  if (context === null) throw new Error('renderer: no 2d context');
  const ctx: CanvasRenderingContext2D = context;

  let scale = 1;
  let originX = 0;
  let originY = 0;

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

    for (const cmd of cmds) {
      ctx.globalAlpha = 'alpha' in cmd && cmd.alpha !== undefined ? cmd.alpha : 1;
      switch (cmd.op) {
        case 'rect': {
          ctx.fillStyle = colour(cmd.color);
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
          // No tile atlas yet -- the platformer scenery is a later phase. Drawn
          // as a flat block so a missing asset is visible rather than silent.
          ctx.fillStyle = CSS['band'] ?? '#000000';
          ctx.fillRect(cmd.x, cmd.y, cmd.w, cmd.h);
          break;
        }
        case 'sprite': {
          // Likewise: no sprite sheet in the tutor. Nothing to draw, and a
          // placeholder box over the rail would be worse than nothing.
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
