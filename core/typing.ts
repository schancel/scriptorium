/**
 * Typing state: the cursor, the per-key statistics, and the score.
 *
 * @doc docs/design/08-stats.md#definitions
 *
 * Every function here is pure. `applyKey` and `tick` take a state and return a
 * new one; nothing passed in is ever mutated. Time arrives as `dtMs` rather
 * than being read from a clock, per `docs/architecture/core-purity.md`.
 *
 * A character can cost more than one key. A capital is shift plus a letter, and
 * both keys are credited, or the mastery gate at stage 8 measures everything
 * except the skill stage 8 teaches. Keystrokes, accuracy and latency still
 * count *characters*: one keypress, one sample.
 *
 * ## Two modes through the same passage
 *
 * With **gilding off** -- the default, and the beginner's game -- only live
 * glyphs pass through `applyKey`: greyed runs auto-advance and cannot be typed,
 * so only live characters can reach `correct`, which is what keeps greyed
 * characters out of WPM.
 *
 * With **gilding on**, every producible character is required and nothing
 * auto-advances. A greyed character typed correctly is *gilded*: it counts as
 * typed, because it was, and it is what WPM is measured over. What it never
 * does is enter `keyStats`. That is not squeamishness -- `keyStats` is the
 * table the mastery gate is computed from, and a gilded key is by definition
 * one the curriculum has not taught. Keeping them out here means the gate
 * cannot see them by construction rather than by an argument about pruning
 * further downstream. See
 * docs/design/01-illumination.md#gilding-a-mode-for-people-who-already-type and
 * docs/decisions/0008-gilding-permissive-input.md.
 *
 * A wrong key in gilding mode is charged normally. Nothing auto-advances, so
 * the character under the cursor is a known target and the keystroke's meaning
 * never has to be guessed -- which is the whole reason this is a mode and not
 * permissive input.
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
 * Index of the next glyph the player owes at or after `from`, or `glyphs.length`
 * if there is none.
 *
 * Off, that is the next *live* glyph: greyed runs auto-advance with no
 * animation delay, so the cursor snaps rather than crawling and the player
 * never waits on the game.
 *
 * On, it is the next *producible* glyph -- which is nearly always `from`
 * itself, because gilding requires every character. The one thing still skipped
 * is a character no keyboard makes: a curly quote or an em dash in an imported
 * book, which would otherwise be a wall no player could type past. Skipping it
 * introduces no ambiguity, because it snaps instantly and the cursor never
 * rests on it, so a wrong key is still an error against a known target.
 */
function nextTarget(glyphs: readonly Glyph[], from: number, gilding: boolean): number {
  let i = Math.max(0, from);
  for (;;) {
    const g = glyphs[i];
    if (g === undefined) return glyphs.length;
    if (gilding ? g.producible : g.live) return i;
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
 * Start typing a classified passage. The cursor is placed on the first glyph
 * the player owes, so a passage opening on greyed characters is already snapped
 * past -- or, in gilding mode, opens on the first character of the passage.
 *
 * `gilding` defaults to off, which is exactly the behaviour every caller had
 * before the mode existed.
 */
export function createTypingState(
  glyphs: readonly Glyph[],
  gilding = false,
): TypingState {
  const copy: readonly Glyph[] = [...glyphs];
  return {
    glyphs: copy,
    cursor: nextTarget(copy, 0, gilding),
    keystrokes: 0,
    correct: 0,
    gilding,
    gilded: 0,
    elapsedMs: 0,
    sinceKeyMs: 0,
    keyStats: {},
    blocked: false,
  };
}

/**
 * Apply one keystroke.
 *
 * A correct key records a hit and advances the cursor to the next glyph the
 * player owes. A wrong key records an error and the character that was struck
 * instead -- the confusion matrix behind the report card's worst-five-keys
 * table -- sets `blocked`, and leaves the cursor exactly where it was. The
 * cursor never moves on a wrong key; that is the whole point of the mechanic.
 *
 * The latency of a hit is `sinceKeyMs`, discarded when it exceeds the idle
 * threshold so that thinking time never enters the muscle-memory signal.
 *
 * In gilding mode the target may be a greyed character. It is still a target:
 * getting it right gilds it, getting it wrong is an error and is charged. What
 * a gilded character has no room for is *key* statistics -- it carries no
 * strokes, because the curriculum is not asking for it -- so it adds nothing to
 * `keyStats` either way, and the mastery gate downstream cannot see it.
 */
export function applyKey(state: TypingState, ch: string, tuning: Tuning): TypingState {
  const idleMs = tuningValue(tuning, 'idle_base_ms');
  const cursor = nextTarget(state.glyphs, state.cursor, state.gilding);
  const target = state.glyphs[cursor];
  const strokes = target !== undefined && target.live ? target.strokes : [];
  const primary = strokes[strokes.length - 1];

  if (target === undefined || (primary === undefined && !state.gilding)) {
    // Past the end of the passage, or -- outside gilding mode -- on a glyph
    // with no strokes, which is what greyed means. The keypress still happened,
    // but there is nothing to score it against.
    return { ...state, cursor, keystrokes: state.keystrokes + 1, sinceKeyMs: 0, blocked: false };
  }

  if (ch === target.ch) {
    const latencyMs = state.sinceKeyMs > idleMs ? null : state.sinceKeyMs;
    // Every stroke earns a hit: a capital is two keys, and crediting only the
    // letter is what left `<shift>` with no samples at all for the stage that
    // exists to teach it. The latency belongs to the primary stroke alone,
    // though, or a capital would put its one measurement into the median twice.
    // A gilded character has no strokes at all, so this loop does nothing for
    // it -- deliberately: see the note on the gate at the top of this file.
    let keyStats = state.keyStats;
    for (const stroke of strokes) {
      keyStats = withHit(keyStats, stroke.key, stroke === primary ? latencyMs : null);
    }
    return {
      ...state,
      cursor: nextTarget(state.glyphs, cursor + 1, state.gilding),
      keystrokes: state.keystrokes + 1,
      correct: state.correct + 1,
      gilded: primary === undefined ? state.gilded + 1 : state.gilded,
      sinceKeyMs: 0,
      keyStats,
      blocked: false,
    };
  }

  if (primary === undefined) {
    // A fumbled gild. Charged exactly like any other error -- the cursor holds
    // and `blocked` is set, so the smudge meter and the combo see it -- but
    // recorded against no key, because the curriculum has not taught one here
    // and inventing a key to blame would put an untaught key in the table the
    // mastery gate reads.
    return { ...state, cursor, keystrokes: state.keystrokes + 1, sinceKeyMs: 0, blocked: true };
  }

  // The error goes against the primary stroke: what failed is the production of
  // the character, and the modifier is not a thing the player can get wrong on
  // its own -- the platform delivers a composed character or nothing at all.
  return {
    ...state,
    cursor,
    keystrokes: state.keystrokes + 1,
    sinceKeyMs: 0,
    keyStats: withError(state.keyStats, primary.key, ch),
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
    cursor: nextTarget(state.glyphs, state.cursor, state.gilding),
  };
}

/**
 * WPM, accuracy and median latency, defined exactly as
 * `docs/design/08-stats.md#definitions` requires so the numbers are comparable
 * with any other typing tool.
 *
 * With gilding off, `correct` only ever counts live characters, so greyed
 * characters cannot inflate WPM -- which would make the early stages look
 * flattering and the progress curve a lie. With gilding on there is nothing to
 * inflate: every producible character was asked for and typed, so counting them
 * is what makes the number honest rather than what makes it a lie. See
 * docs/design/08-stats.md#definitions.
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
 * True when nothing the player owes remains. A passage ending in a greyed run --
 * a full stop at stage 1, say -- is finished the moment its last live character
 * is typed, rather than stranding the player on characters they cannot press.
 * In gilding mode the same sentence holds with "producible" for "live": the
 * only thing that can end a passage early is a character no board makes.
 */
export function atEnd(state: TypingState): boolean {
  return nextTarget(state.glyphs, state.cursor, state.gilding) >= state.glyphs.length;
}

/**
 * How many characters this passage asks for.
 *
 * With gilding off that is the live ones; with it on, every producible one.
 * `coverage` in `illumination.ts` answers the first question as a fraction for
 * the curriculum's benefit; this answers it as a count, for the page bonus.
 */
export function askedFor(glyphs: readonly Glyph[], gilding: boolean): number {
  let n = 0;
  for (const g of glyphs) if (gilding ? g.producible : g.live) n += 1;
  return n;
}

/**
 * What gilding this passage has earned.
 *
 * `points` is `gild_score_per_char` per gilded character, plus
 * `gild_page_bonus` when the part was completed with *every* character typed.
 * The bonus is the reason a strong typist has any reason to play an early stage
 * at all: gilding a page completely is a harder target than typing 46% of it.
 *
 * `complete` is measured rather than assumed. It is not enough to have reached
 * the end -- a player who resumed halfway through a part reaches the end having
 * typed half of it -- so it asks whether the number of characters typed equals
 * the number the passage asked for. Off, it is always false: there is nothing
 * to gild when the greyed runs were never offered.
 */
export interface Gilding {
  /** Characters outside the current stage typed correctly. */
  readonly gilded: number;
  /** True when every character of the part was typed, in gilding mode. */
  readonly complete: boolean;
  /** Points earned, before any gold-leaf multiplier the level is carrying. */
  readonly points: number;
}

export function gildScore(state: TypingState, tuning: Tuning): Gilding {
  if (!state.gilding) return { gilded: 0, complete: false, points: 0 };
  const complete =
    atEnd(state) && state.correct === askedFor(state.glyphs, state.gilding);
  const perChar = tuningValue(tuning, 'gild_score_per_char');
  const bonus = complete ? tuningValue(tuning, 'gild_page_bonus') : 0;
  return { gilded: state.gilded, complete, points: state.gilded * perChar + bonus };
}
