/**
 * The reading rail: where every glyph of the ribbon sits, horizontally.
 *
 * @doc docs/design/02-rail.md#the-focal-guide
 *
 * The cursor is nailed to a fixed screen x and the ribbon slides through it, so
 * the geometry runs backwards from the usual: place the glyphs in a ribbon-local
 * space that never moves, then pick the *offset* that lands the cursor's glyph on
 * that fixed x.
 *
 * Two properties then hold structurally rather than by care:
 *
 *  - Every advance is the same width, so `positions[i] === i * CELL_W`. With a
 *    proportional font the offset would be a running sum of measured widths, and
 *    every rounding error along that sum would surface as focal drift.
 *  - The ribbon never wraps. There are no lines, so there is no line-break
 *    calculation for the offset to disagree with. A newline in the source is an
 *    advance like any other and the platform draws nothing for it.
 *
 * Together those make `layoutRail(...).offset + positions[cursor]` exactly the
 * focal x for every cursor index in a chapter, including through the long greyed
 * runs of an early stage. That is the invariant, and `rail.test.ts` asserts it
 * over a full chapter rather than trusting this comment.
 */

import type { Glyph, RailState, Tuning } from './types.js';

/**
 * Advance width of one glyph cell, in virtual px.
 *
 * The only exemption in this file. This is the ribbon's design resolution, not a
 * feel knob: display-list coordinates are virtual by contract
 * (docs/architecture/display-list.md) and the platform scales them, so changing
 * this number changes nothing a player could perceive -- it only re-denominates
 * every x in the file. A tuning row would imply it was worth turning.
 */
export const CELL_W = 12; // tuning-exempt: virtual design resolution, see above

/**
 * The focal x: the screen column the cursor is pinned to. It depends on the
 * viewport and one tuning fraction, and on nothing about the text or how far into
 * it the player has got -- which is the whole invariant, stated as a function.
 */
export function focalX(viewportW: number, tuning: Tuning): number {
  return viewportW * (tuning['rail_cursor_x'] ?? 0);
}

/** Ribbon geometry for one frame. */
export function layoutRail(
  glyphs: readonly Glyph[],
  cursor: number,
  viewportW: number,
  tuning: Tuning,
): { offset: number; positions: number[] } {
  const positions: number[] = new Array<number>(glyphs.length);
  for (let i = 0; i < glyphs.length; i++) positions[i] = i * CELL_W;

  // Past the last glyph the ribbon keeps advancing as though the text continued,
  // so finishing a passage does not jerk the focal point sideways.
  return { offset: focalX(viewportW, tuning) - cursor * CELL_W, positions };
}

/**
 * Ease the ribbon one frame toward its target.
 *
 * The cursor never moves; this is the ribbon catching up to it. Snapping once
 * within a single virtual pixel stops the offset asymptoting forever, which would
 * otherwise leave sub-pixel jitter under a still cursor for the rest of the
 * passage.
 */
export function stepRail(rail: RailState, targetOffset: number, tuning: Tuning): RailState {
  const delta = targetOffset - rail.offset;
  if (Math.abs(delta) < 1) return { offset: targetOffset, targetOffset };
  return { offset: rail.offset + delta * (tuning['rail_scroll_lerp'] ?? 1), targetOffset };
}

/**
 * A rail already settled on `targetOffset`, for the start of a passage. Starting
 * at zero would scroll the whole opening verse past the player before it settled.
 */
export function createRail(targetOffset: number): RailState {
  return { offset: targetOffset, targetOffset };
}

/**
 * Half-open range of glyph indices with any part on screen, so the platform is
 * handed ~60 glyphs a frame rather than a chapter's worth.
 */
export function visibleRange(
  count: number,
  offset: number,
  viewportW: number,
): { first: number; last: number } {
  const first = Math.max(0, Math.floor(-offset / CELL_W));
  const last = Math.min(count, Math.ceil((viewportW - offset) / CELL_W) + 1);
  return { first, last: Math.max(first, last) };
}
