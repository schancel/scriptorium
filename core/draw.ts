/**
 * The frame, as data.
 *
 * @doc docs/architecture/display-list.md#commands
 *
 * Nothing here draws. `drawFrame` returns a flat, JSON-serialisable array of
 * commands in paint order and `platform/web/canvas_renderer.ts` executes them.
 * Colours are palette indices; the index -> CSS mapping is the renderer's
 * business, and fonts are named by `style` for the same reason -- a core module
 * that knew a pixel size in a real font would have to be rewritten for every port.
 *
 * The frame has three bands, top to bottom: the HUD, the reading rail, and the
 * keyboard overlay. The rail is the one that matters; the other two are placed
 * away from it on purpose, because a WPM counter beside the text pulls the eye off
 * the focal point, which is the one thing the rail exists to hold still.
 */

import { CELL_W, focalX, visibleRange } from './rail.js';
import {
  FINGERS,
  FINGER_LABELS,
  fingerForKey,
  keyLabel,
  overlayExtent,
  overlayLayout,
} from './keyboard.js';
import type {
  DrawCmd,
  Finger,
  Glyph,
  Key,
  KeyStat,
  KeyboardLayout,
  Mode,
  RailState,
  Score,
  Tuning,
} from './types.js';

// --- palette ----------------------------------------------------------------

/**
 * Palette slots in index order. A command carries the *index*; the renderer holds
 * the CSS. Naming the slots and deriving the indices from this array means core
 * never spells a colour number, and the renderer's colour list is checked against
 * this one at startup rather than drifting silently out of alignment.
 *
 * The ten finger slots share the array so `pal(finger)` is a lookup, not a table.
 */
export const PALETTE_ORDER: readonly string[] = [
  'bg', 'band', 'dim', 'live', 'done', 'gold', 'hud', 'rule', 'panel',
  'keyFace', 'keyLabel', 'error',
  'lp', 'lr', 'lm', 'li', 'lt', 'rt', 'ri', 'rm', 'rr', 'rp',
];

const PAL_INDEX: ReadonlyMap<string, number> = new Map(PALETTE_ORDER.map((n, i) => [n, i]));

function pal(name: string): number {
  return PAL_INDEX.get(name) ?? 0;
}

// --- geometry ---------------------------------------------------------------

/**
 * The virtual design resolution and the band geometry inside it.
 *
 * Every number below is `tuning-exempt` and none of them is a feel knob. Display
 * list coordinates are virtual by contract (docs/architecture/display-list.md):
 * the platform scales and letterboxes, so these choose the *composition* of the
 * picture -- which band sits where -- and not how the game plays. Putting them in
 * the tuning table would invite someone to turn them expecting an effect on
 * difficulty, and would put twenty rows of pixel arithmetic in a document that is
 * otherwise entirely about the player's experience.
 *
 * The genuine tunables the rail uses -- `rail_cursor_x`, `rail_scroll_lerp`,
 * `focal_guide_width` -- come from `tuning`, as they should.
 */
const M = {
  vw: 640,           // tuning-exempt: virtual design resolution
  vh: 360,           // tuning-exempt: virtual design resolution
  hudH: 22,          // tuning-exempt: band composition
  hudPad: 10,        // tuning-exempt: band composition
  hudTextY: 11,      // tuning-exempt: band composition
  bandTop: 114,      // tuning-exempt: band composition
  bandH: 62,         // tuning-exempt: band composition
  railBaseY: 154,    // tuning-exempt: band composition
  guideTopY: 126,    // tuning-exempt: band composition
  guideBotY: 170,    // tuning-exempt: band composition
  caretTop: 132,     // tuning-exempt: band composition
  caretBot: 166,     // tuning-exempt: band composition
  hintY: 192,        // tuning-exempt: band composition
  kbUnit: 26,        // tuning-exempt: band composition
  kbTop: 202,        // tuning-exempt: band composition
  keyPad: 2,
  reportX: 44,       // tuning-exempt: report card composition
  reportRightX: 372, // tuning-exempt: report card composition
  reportTitleY: 46,  // tuning-exempt: report card composition
  reportBodyY: 74,   // tuning-exempt: report card composition
  reportLineH: 14,   // tuning-exempt: report card composition
  reportColW: 74,    // tuning-exempt: report card composition
  reportFootY: 328,  // tuning-exempt: report card composition
} as const;

/** The design resolution, for the platform's scale-and-letterbox transform. */
export const VIRTUAL_W = M.vw;
export const VIRTUAL_H = M.vh;

const PERCENT = 100;         // tuning-exempt: fraction -> percent, a unit, not a knob
const CARET_W = 2;
const DIM_ALPHA = 0.35;      // tuning-exempt: how far an untaught key recedes
const PANEL_ALPHA = 0.94;    // tuning-exempt: report card veils the level behind it

/**
 * Rows on the "worst keys" table. Five, because docs/design/08-stats.md says five.
 */
const WORST_KEYS = 5;        // tuning-exempt: fixed by docs/design/08-stats.md

/**
 * Strikes on a key before its overlay highlight is allowed to fade out.
 *
 * The accuracy threshold itself is `gate_accuracy`, correctly. This is only the
 * sample floor that stops one lucky keystroke retiring the crutch. It arguably
 * belongs in the tuning table and cannot go there without editing a doc this
 * change is not allowed to touch -- see the handover note.
 */
const MIN_MASTERY_HITS = 20; // tuning-exempt: sample floor, should become a tuning row

// --- the frame's input ------------------------------------------------------

/**
 * Everything a frame needs. A projection of `GameState` rather than the thing
 * itself: the tutor draws before the platformer sim exists, and the display list
 * should not have to wait on hearts and blot-clouds to be able to draw a verse.
 */
export interface FrameState {
  readonly mode: Mode;
  /** Canonical reference including the verse, e.g. "Genesis 1 - v3". */
  readonly ref: string;
  readonly stage: number;
  readonly glyphs: readonly Glyph[];
  readonly cursor: number;
  /** True when the last keystroke was wrong and the cursor is held. */
  readonly blocked: boolean;
  readonly score: Score;
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  readonly layout: KeyboardLayout;
  /** Everything typable at the current stage; the rest of the board is dimmed. */
  readonly keySet: readonly Key[];
}

// --- the report card --------------------------------------------------------

export interface FingerRow {
  readonly finger: Finger;
  readonly label: string;
  readonly hits: number;
  readonly errors: number;
  /** 0..1; zero when the finger was never used. */
  readonly accuracy: number;
  readonly meanMs: number;
}

export interface WorstKey {
  readonly key: Key;
  readonly hits: number;
  readonly errors: number;
  readonly errorRate: number;
  /** The character most often struck instead, or '' if there is no pattern. */
  readonly confusedWith: string;
}

export interface ReportCard {
  readonly fingers: readonly FingerRow[];
  readonly worst: readonly WorstKey[];
}

/**
 * Aggregate per-key statistics into the card.
 *
 * All ten fingers are always present, including the ones with no data. That is
 * the entire point of the table: a two-finger typist's card is two columns of
 * numbers and eight rows of zeroes, and omitting the empty rows would hide
 * exactly the thing it exists to show.
 */
export function reportCard(
  keyStats: Readonly<Record<Key, KeyStat>>,
  layout: KeyboardLayout,
): ReportCard {
  const hits = new Map<Finger, number>();
  const errors = new Map<Finger, number>();
  const totalMs = new Map<Finger, number>();
  for (const f of FINGERS) {
    hits.set(f, 0);
    errors.set(f, 0);
    totalMs.set(f, 0);
  }

  const worst: WorstKey[] = [];
  for (const [key, stat] of Object.entries(keyStats)) {
    const finger = fingerForKey(key, layout);
    if (finger !== null) {
      hits.set(finger, (hits.get(finger) ?? 0) + stat.hits);
      errors.set(finger, (errors.get(finger) ?? 0) + stat.errors);
      totalMs.set(finger, (totalMs.get(finger) ?? 0) + stat.totalMs);
    }
    const attempts = stat.hits + stat.errors;
    if (stat.errors > 0 && attempts > 0) {
      worst.push({
        key,
        hits: stat.hits,
        errors: stat.errors,
        errorRate: stat.errors / attempts,
        confusedWith: topConfusion(stat),
      });
    }
  }

  const fingers: FingerRow[] = FINGERS.map((finger) => {
    const h = hits.get(finger) ?? 0;
    const e = errors.get(finger) ?? 0;
    const attempts = h + e;
    return {
      finger,
      label: FINGER_LABELS[finger],
      hits: h,
      errors: e,
      accuracy: attempts === 0 ? 0 : h / attempts,
      meanMs: h === 0 ? 0 : (totalMs.get(finger) ?? 0) / h,
    };
  });

  // Rate first, then volume, so a key missed twice out of three does not outrank
  // one missed forty times out of a hundred purely by arithmetic.
  worst.sort((a, b) => b.errorRate - a.errorRate || b.errors - a.errors);
  return { fingers, worst: worst.slice(0, WORST_KEYS) };
}

function topConfusion(stat: KeyStat): string {
  let best = '';
  let bestN = 0;
  for (const [ch, n] of Object.entries(stat.confusions)) {
    if (n > bestN) {
      best = ch;
      bestN = n;
    }
  }
  return best;
}

// --- the frame --------------------------------------------------------------

/** The whole frame, back to front. */
export function drawFrame(state: FrameState, rail: RailState, tuning: Tuning): DrawCmd[] {
  const cmds: DrawCmd[] = [];
  cmds.push({ op: 'rect', x: 0, y: 0, w: M.vw, h: M.vh, color: pal('bg') });
  pushHud(cmds, state);
  pushRail(cmds, state, rail, tuning);
  pushKeyboard(cmds, state, tuning);
  if (state.mode === 'report') pushReport(cmds, state);
  return cmds;
}

function pct(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

function pushHud(cmds: DrawCmd[], state: FrameState): void {
  cmds.push({ op: 'rect', x: 0, y: 0, w: M.vw, h: M.hudH, color: pal('band') });
  cmds.push({
    op: 'text', value: state.ref, x: M.hudPad, y: M.hudTextY,
    style: 'hud', color: pal('hud'),
  });
  cmds.push({
    op: 'text',
    value: `WPM ${Math.round(state.score.wpm)}    ACC ${pct(state.score.accuracy)}%`,
    x: M.vw / 2, y: M.hudTextY, style: 'hud-center', color: pal('gold'),
  });
  cmds.push({
    op: 'text', value: `STAGE ${state.stage}`, x: M.vw - M.hudPad, y: M.hudTextY,
    style: 'hud-right', color: pal('hud'),
  });
}

/** The first live glyph at or after the cursor: the key the player owes us. */
function nextLiveGlyph(state: FrameState): Glyph | null {
  for (let i = state.cursor; i < state.glyphs.length; i++) {
    const g = state.glyphs[i];
    if (g !== undefined && g.live) return g;
  }
  return null;
}

function pushRail(cmds: DrawCmd[], state: FrameState, rail: RailState, tuning: Tuning): void {
  cmds.push({ op: 'rect', x: 0, y: M.bandTop, w: M.vw, h: M.bandH, color: pal('band') });

  const x0 = focalX(M.vw, tuning);
  const { first, last } = visibleRange(state.glyphs.length, rail.offset, M.vw);
  for (let i = first; i < last; i++) {
    const g = state.glyphs[i];
    if (g === undefined || g.ch === ' ' || g.ch === '\n') continue;
    const style = glyphStyle(i, state);
    cmds.push({
      op: 'text', value: g.ch, x: i * CELL_W + rail.offset, y: M.railBaseY,
      style, color: pal(styleColour(style)),
    });
  }

  // The focal guide, painted after the text so a glyph never sits on top of the
  // one thing on screen that is guaranteed not to move.
  const centre = x0 + CELL_W / 2;
  const half = (tuning['focal_guide_width'] ?? 0) / 2;
  cmds.push({
    op: 'line', x1: centre - half, y1: M.guideTopY, x2: centre + half, y2: M.guideTopY,
    color: pal('rule'), width: 1,
  });
  cmds.push({
    op: 'line', x1: centre - half, y1: M.guideBotY, x2: centre + half, y2: M.guideBotY,
    color: pal('rule'), width: 1,
  });
  cmds.push({
    op: 'line', x1: x0, y1: M.caretTop, x2: x0, y2: M.caretBot,
    color: pal(state.blocked ? 'error' : 'gold'), width: CARET_W,
  });
}

/**
 * A greyed glyph is dim wherever it sits, including behind the cursor: it was
 * never typed, so showing it as done would credit the player with a keystroke
 * they did not make.
 */
function glyphStyle(i: number, state: FrameState): string {
  const g = state.glyphs[i];
  if (g === undefined || !g.live) return 'rail-dim';
  if (i < state.cursor) return 'rail-done';
  if (i === state.cursor) return state.blocked ? 'rail-error' : 'rail-cursor';
  return 'rail-live';
}

function styleColour(style: string): string {
  if (style === 'rail-dim') return 'dim';
  if (style === 'rail-done') return 'done';
  if (style === 'rail-cursor') return 'gold';
  if (style === 'rail-error') return 'error';
  return 'live';
}

/**
 * Earned fade-out: a key stops being highlighted once its accuracy clears the
 * mastery threshold. The crutch withdraws itself key by key, without the player
 * ever having to decide to give it up.
 */
function isMastered(key: Key, state: FrameState, tuning: Tuning): boolean {
  const stat = state.keyStats[key];
  if (stat === undefined) return false;
  const attempts = stat.hits + stat.errors;
  if (stat.hits < MIN_MASTERY_HITS) return false;
  return attempts > 0 && stat.hits / attempts >= (tuning['gate_accuracy'] ?? 1);
}

function pushKeyboard(cmds: DrawCmd[], state: FrameState, tuning: Tuning): void {
  const keys = overlayLayout(state.layout);
  const extent = overlayExtent(state.layout);
  const originX = (M.vw - extent.w * M.kbUnit) / 2;
  const taught = new Set(state.keySet);
  const next = nextLiveGlyph(state);
  const nextKey = next === null ? null : next.key;

  for (const k of keys) {
    const x = originX + k.x * M.kbUnit + M.keyPad;
    const y = M.kbTop + k.y * M.kbUnit + M.keyPad;
    const w = k.w * M.kbUnit - M.keyPad * 2;
    const h = k.h * M.kbUnit - M.keyPad * 2;
    const isNext = nextKey !== null && k.key === nextKey && !isMastered(k.key, state, tuning);
    const known = taught.has(k.key);
    cmds.push({
      op: 'rect', x, y, w, h,
      color: pal(isNext ? 'gold' : k.finger),
      alpha: known ? 1 : DIM_ALPHA,
    });
    cmds.push({
      op: 'text', value: keyLabel(k.key), x: x + w / 2, y: y + h / 2,
      style: 'key', color: pal(isNext ? 'bg' : 'keyLabel'),
      alpha: known ? 1 : DIM_ALPHA,
    });
  }

  if (next !== null && next.key !== null) {
    const finger = fingerForKey(next.key, state.layout);
    const named = finger === null ? '' : FINGER_LABELS[finger];
    cmds.push({
      op: 'text', value: `next: ${keyLabel(next.key)}    ${named}`,
      x: M.vw / 2, y: M.hintY, style: 'hint-center', color: pal('gold'),
    });
  }
}

function pushReport(cmds: DrawCmd[], state: FrameState): void {
  const card = reportCard(state.keyStats, state.layout);
  cmds.push({
    op: 'rect', x: 0, y: 0, w: M.vw, h: M.vh, color: pal('panel'), alpha: PANEL_ALPHA,
  });
  cmds.push({
    op: 'text', value: `${state.ref} - report`, x: M.reportX, y: M.reportTitleY,
    style: 'title', color: pal('gold'),
  });
  cmds.push({
    op: 'text',
    value: `WPM ${Math.round(state.score.wpm)}   ACCURACY ${pct(state.score.accuracy)}%   MEDIAN ${Math.round(state.score.medianLatencyMs)}ms`,
    x: M.reportX, y: M.reportTitleY + M.reportLineH, style: 'report', color: pal('hud'),
  });

  const head = ['finger', 'keys', 'acc', 'mean'];
  for (let c = 0; c < head.length; c++) {
    cmds.push({
      op: 'text', value: head[c] ?? '', x: M.reportX + c * M.reportColW, y: M.reportBodyY,
      style: 'report', color: pal('dim'),
    });
  }
  for (let r = 0; r < card.fingers.length; r++) {
    const row = card.fingers[r];
    if (row === undefined) continue;
    const y = M.reportBodyY + (r + 1) * M.reportLineH;
    // An unused finger is drawn dim rather than omitted: eight dim rows is the
    // diagnosis the card exists to deliver.
    const colour = pal(row.hits === 0 ? 'dim' : 'hud');
    const cells = [
      row.label,
      String(row.hits),
      row.hits === 0 ? '-' : `${pct(row.accuracy)}%`,
      row.hits === 0 ? '-' : `${Math.round(row.meanMs)}ms`,
    ];
    for (let c = 0; c < cells.length; c++) {
      cmds.push({
        op: 'text', value: cells[c] ?? '', x: M.reportX + c * M.reportColW, y,
        style: 'report', color: colour,
      });
    }
  }

  cmds.push({
    op: 'text', value: 'worst keys', x: M.reportRightX, y: M.reportBodyY,
    style: 'report', color: pal('dim'),
  });
  if (card.worst.length === 0) {
    cmds.push({
      op: 'text', value: 'none - clean sheet', x: M.reportRightX,
      y: M.reportBodyY + M.reportLineH, style: 'report', color: pal('live'),
    });
  }
  for (let r = 0; r < card.worst.length; r++) {
    const row = card.worst[r];
    if (row === undefined) continue;
    const struck = row.confusedWith === '' ? '' : ` struck ${keyLabel(row.confusedWith)}`;
    cmds.push({
      op: 'text',
      value: `${keyLabel(row.key)}   ${pct(row.errorRate)}% wrong${struck}`,
      x: M.reportRightX, y: M.reportBodyY + (r + 1) * M.reportLineH,
      style: 'report', color: pal('error'),
    });
  }

  cmds.push({
    op: 'text', value: 'enter: type it again      esc: back to the passage',
    x: M.reportX, y: M.reportFootY, style: 'report', color: pal('dim'),
  });
}
