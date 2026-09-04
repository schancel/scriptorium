/**
 * Typing state: the cursor, the per-key statistics, and the score.
 *
 * @doc docs/design/08-stats.md#definitions
 *
 * Every function here is pure. `applyKey` and `tick` take a state and return a
 * new one; nothing passed in is ever mutated. Time arrives as `dtMs` rather
 * than being read from a clock, per `docs/architecture/core-purity.md`.
 *
 * Only live glyphs pass through `applyKey`, so only live characters can reach
 * `correct` -- which is what keeps greyed characters out of WPM.
 */

import type { Glyph, Key, KeyStat, Score, Tuning, TypingState } from './types.js';
import { tuningValue } from './tuning.js';

/** Milliseconds in a minute. A unit conversion, not a tunable. */
const MS_PER_MINUTE = 60000; // tuning-exempt: SI unit conversion; changing it would not tune anything, it would make WPM wrong

const EMPTY_STAT: KeyStat = Object.freeze({
  hits: 0,
  errors: 0,
  totalMs: 0,
  latencies: Object.freeze([]) as readonly number[],
  confusions: Object.freeze({}) as Readonly<Record<string, number>>,
});

/**
 * Index of the first live glyph at or after `from`, or `glyphs.length` if there
 * is none. Greyed runs auto-advance with no animation delay -- the cursor snaps
 * rather than crawling, so the player never waits on the game.
 */
function skipGreyed(glyphs: readonly Glyph[], from: number): number {
  let i = Math.max(0, from);
  for (;;) {
    const g = glyphs[i];
    if (g === undefined) return glyphs.length;
    if (g.live) return i;
    i += 1;
  }
}

/** Median of a sample set; 0 when there are no samples. */
export function median(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const high = sorted[mid];
  if (high === undefined) return 0;
  if (sorted.length % 2 === 1) return high;
  const low = sorted[mid - 1];
  return low === undefined ? high : (low + high) / 2;
}

function withHit(
  keyStats: Readonly<Record<Key, KeyStat>>,
  key: Key,
  latencyMs: number | null,
): Readonly<Record<Key, KeyStat>> {
  const prev = keyStats[key] ?? EMPTY_STAT;
  const next: KeyStat = {
    hits: prev.hits + 1,
    errors: prev.errors,
    totalMs: latencyMs === null ? prev.totalMs : prev.totalMs + latencyMs,
    latencies: latencyMs === null ? prev.latencies : [...prev.latencies, latencyMs],
    confusions: prev.confusions,
  };
  return { ...keyStats, [key]: next };
}

function withError(
  keyStats: Readonly<Record<Key, KeyStat>>,
  key: Key,
  struck: string,
): Readonly<Record<Key, KeyStat>> {
  const prev = keyStats[key] ?? EMPTY_STAT;
  const next: KeyStat = {
    hits: prev.hits,
    errors: prev.errors + 1,
    totalMs: prev.totalMs,
    latencies: prev.latencies,
    confusions: { ...prev.confusions, [struck]: (prev.confusions[struck] ?? 0) + 1 },
  };
  return { ...keyStats, [key]: next };
}

/**
 * Start typing a classified passage. The cursor is placed on the first live
 * glyph, so a passage opening on greyed characters is already snapped past.
 */
export function createTypingState(glyphs: readonly Glyph[]): TypingState {
  const copy: readonly Glyph[] = [...glyphs];
  return {
    glyphs: copy,
    cursor: skipGreyed(copy, 0),
    keystrokes: 0,
    correct: 0,
    elapsedMs: 0,
    sinceKeyMs: 0,
    keyStats: {},
    blocked: false,
  };
}

/**
 * Apply one keystroke.
 *
 * A correct key records a hit and advances the cursor to the next live glyph.
 * A wrong key records an error and the character that was struck instead -- the
 * confusion matrix behind the report card's worst-five-keys table -- sets
 * `blocked`, and leaves the cursor exactly where it was. The cursor never moves
 * on a wrong key; that is the whole point of the mechanic.
 *
 * The latency of a hit is `sinceKeyMs`, discarded when it exceeds the idle
 * threshold so that thinking time never enters the muscle-memory signal.
 */
export function applyKey(state: TypingState, ch: string, tuning: Tuning): TypingState {
  const idleMs = tuningValue(tuning, 'idle_base_ms');
  const cursor = skipGreyed(state.glyphs, state.cursor);
  const target = state.glyphs[cursor];

  if (target === undefined || !target.live || target.key === null) {
    // Past the end of the passage: the keypress still happened, but there is
    // nothing to score it against.
    return { ...state, cursor, keystrokes: state.keystrokes + 1, sinceKeyMs: 0, blocked: false };
  }

  if (ch === target.ch) {
    const latencyMs = state.sinceKeyMs > idleMs ? null : state.sinceKeyMs;
    return {
      ...state,
      cursor: skipGreyed(state.glyphs, cursor + 1),
      keystrokes: state.keystrokes + 1,
      correct: state.correct + 1,
      sinceKeyMs: 0,
      keyStats: withHit(state.keyStats, target.key, latencyMs),
      blocked: false,
    };
  }

  return {
    ...state,
    cursor,
    keystrokes: state.keystrokes + 1,
    sinceKeyMs: 0,
    keyStats: withError(state.keyStats, target.key, ch),
    blocked: true,
  };
}

/**
 * Advance the clock by `dtMs`.
 *
 * `sinceKeyMs` is what the blot-cloud watches, and it is also the latency clock
 * for the next hit. Greyed runs snap past here as well as in `applyKey`, so a
 * greyed character is never left sitting under the cursor.
 */
export function tick(state: TypingState, dtMs: number): TypingState {
  return {
    ...state,
    elapsedMs: state.elapsedMs + dtMs,
    sinceKeyMs: state.sinceKeyMs + dtMs,
    cursor: skipGreyed(state.glyphs, state.cursor),
  };
}

/**
 * WPM, accuracy and median latency, defined exactly as
 * `docs/design/08-stats.md#definitions` requires so the numbers are comparable
 * with any other typing tool.
 *
 * `correct` only ever counts live characters, so greyed characters cannot
 * inflate WPM -- which would make the early stages look flattering and the
 * progress curve a lie.
 */
export function score(state: TypingState, tuning: Tuning): Score {
  const charsPerWord = tuningValue(tuning, 'wpm_chars_per_word');
  const minutes = state.elapsedMs / MS_PER_MINUTE;
  const wpm = minutes > 0 ? state.correct / charsPerWord / minutes : 0;
  const accuracy = state.keystrokes === 0 ? 1 : state.correct / state.keystrokes;
  const samples: number[] = [];
  for (const stat of Object.values(state.keyStats)) {
    for (const ms of stat.latencies) samples.push(ms);
  }
  return { wpm, accuracy, medianLatencyMs: median(samples) };
}

/**
 * True when no live glyph remains. A passage ending in a greyed run -- a full
 * stop at stage 1, say -- is finished the moment its last live character is
 * typed, rather than stranding the player on characters they cannot press.
 */
export function atEnd(state: TypingState): boolean {
  return skipGreyed(state.glyphs, state.cursor) >= state.glyphs.length;
}
