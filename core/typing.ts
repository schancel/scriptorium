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
 *
 * ## And two ways of meeting a wrong key
 *
 * The default **blocks**: the cursor holds until the right character is
 * produced. That is standard in typing tutors, it makes an error unmissable,
 * and for a beginner who does not yet know where the keys are it is a real
 * service -- he cannot type a whole wrong word without noticing and lose his
 * place in the text.
 *
 * The **standing** mode, off by default, is the other half of the same
 * argument. Everywhere else a keyboard is used a wrong letter appears and is
 * removed with backspace, and for a fluent typist that repair is a reflex
 * rather than a decision. Blocking gives the reflex nothing to act on, so the
 * game reads his repair attempt as a second mistake. With the mode on the wrong
 * letter *stands* in the expected letter's cell, the cursor advances, and
 * `deleteBack` removes it and steps back.
 *
 * Accuracy is untouched by either: `keystrokes`, `correct` and `keyStats` are
 * cumulative and no backspace unwinds one. What a backspace does move is
 * `deleted`, so WPM stays a count of the page rather than of the attempts made
 * on it. See docs/decisions/0010-mistakes-may-stand-and-be-deleted.md.
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

/**
 * Index of the last glyph the player owed *before* `from`, or -1 if there is
 * none.
 *
 * The mirror of `nextTarget`, and it has to be the mirror or backspace walks a
 * different page from the one typing walked. With illumination on the cursor
 * skips runs of untaught letters going forward; going back it must skip exactly
 * the same runs, or a backspace would land on a character the player was never
 * asked for and could not retype. That symmetry is the whole of why dim letters
 * are not a complication -- see
 * docs/decisions/0010-mistakes-may-stand-and-be-deleted.md.
 */
function previousTarget(glyphs: readonly Glyph[], from: number, gilding: boolean): number {
  let i = Math.min(from, glyphs.length) - 1;
  while (i >= 0) {
    const g = glyphs[i];
    if (g !== undefined && (gilding ? g.producible : g.live)) return i;
    i -= 1;
  }
  return -1;
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
  standing = false,
): TypingState {
  const copy: readonly Glyph[] = [...glyphs];
  return {
    glyphs: copy,
    cursor: nextTarget(copy, 0, gilding),
    keystrokes: 0,
    correct: 0,
    gilding,
    gilded: 0,
    standing,
    faults: {},
    deleted: 0,
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
 *
 * In the standing mode the last paragraph but one is the only thing that
 * changes. The error is charged exactly as it always was; what differs is that
 * the character struck is written into the cell it was struck at, and the
 * cursor moves on to the next thing the player owes. Nothing about the cell
 * count changes -- a wrong character occupies one cell, like the character it
 * replaced -- which is what keeps the reading column where it is.
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

  // The character struck, written into the cell it was struck at. Recorded in
  // *both* modes and for the same reason in each: it is what says this word was
  // not typed clean. The standing mode additionally draws it, which is what
  // gives backspace something to take back.
  const faults = { ...state.faults, [cursor]: ch };
  // Where the cursor goes. Blocking holds it on the cell, which is the whole of
  // the default mechanic; standing advances past it exactly as a correct key
  // would, so the hands keep the pace they set.
  const after = state.standing ? nextTarget(state.glyphs, cursor + 1, state.gilding) : cursor;

  if (primary === undefined) {
    // A fumbled gild. Charged exactly like any other error -- the smudge meter
    // and the combo see it -- but recorded against no key, because the
    // curriculum has not taught one here and inventing a key to blame would put
    // an untaught key in the table the mastery gate reads.
    return {
      ...state,
      cursor: after,
      keystrokes: state.keystrokes + 1,
      faults,
      sinceKeyMs: 0,
      blocked: !state.standing,
    };
  }

  // The error goes against the primary stroke: what failed is the production of
  // the character, and the modifier is not a thing the player can get wrong on
  // its own -- the platform delivers a composed character or nothing at all.
  return {
    ...state,
    cursor: after,
    keystrokes: state.keystrokes + 1,
    faults,
    sinceKeyMs: 0,
    keyStats: withError(state.keyStats, primary.key, ch),
    blocked: !state.standing,
  };
}

/**
 * Backspace: take the last character back and step the cursor onto it.
 *
 * The reflex this exists for is not a decision. A fluent typist's hand fires
 * backspace before the mind has finished noticing the mistake, and a game that
 * blocks gives that reflex nothing to act on -- so it reads his repair as a
 * second mistake. See docs/decisions/0010-mistakes-may-stand-and-be-deleted.md.
 *
 * **It does nothing at all with the mode off.** The default blocks, so there is
 * nothing ahead of the cursor to remove and nothing behind it the player is
 * being invited to revisit; the first run's *"a wrong key doesn't move you
 * along"* stays true word for word, and the beginner's game is byte-for-byte
 * what it was.
 *
 * With the mode on it walks back to the previous cell the player owed --
 * skipping untaught runs exactly as the cursor skipped them going forward -- and
 * empties it. A cell holding a *wrong* character loses it, and the error stays
 * charged: accuracy counts every keypress and a backspace cannot hide one. A
 * cell holding a *correct* character loses it too, because that is what
 * backspace means everywhere else a keyboard is used, and `deleted` rises so
 * that WPM goes on counting the page rather than the attempts made on it.
 *
 * A backspace is not itself an attempt at a character: it adds no keystroke, no
 * hit, no error and no confusion. What it costs is the time it takes, which the
 * owner ruled is penalty enough.
 */
export function deleteBack(state: TypingState): TypingState {
  if (!state.standing) return state;
  const at = previousTarget(state.glyphs, state.cursor, state.gilding);
  if (at < 0) return state;

  if (state.faults[at] !== undefined) {
    // A mistake taken back. The keystroke that made it is still counted and
    // still recorded against its key; what goes is the letter on the page and,
    // with it, the reason this word was not clean.
    const faults: Record<number, string> = { ...state.faults };
    delete faults[at];
    return { ...state, cursor: at, faults, sinceKeyMs: 0, blocked: false };
  }

  // A correct character taken back. It was correct and stays counted as
  // correct; it simply no longer stands on the page. A gilded one stops being
  // gilded for the same reason -- the points are for characters on the page.
  const glyph = state.glyphs[at];
  const gilded = glyph !== undefined && glyph.strokes.length === 0
    ? Math.max(0, state.gilded - 1)
    : state.gilded;
  return {
    ...state,
    cursor: at,
    deleted: state.deleted + 1,
    gilded,
    sinceKeyMs: 0,
    blocked: false,
  };
}

/**
 * True when no mistake stands anywhere in the half-open glyph range.
 *
 * This is what a monster is felled by. "A word typed clean fells the monster. A
 * word with a mistake in it does not" -- and a mistake *taken back* with
 * backspace is not one, because `deleteBack` has already removed it from
 * `faults`. Both halves are the owner's:
 * docs/design/03-pacing.md#a-monster-is-felled-by-a-clean-word-not-by-any-word.
 *
 * It reads `faults` rather than counting errors, so it is a question about the
 * page as it stands and not about the history of the keyboard. Nothing about it
 * can hurt the player: a surviving monster costs him nothing at all.
 */
export function cleanRange(
  faults: Readonly<Record<number, string>>,
  start: number,
  end: number,
): boolean {
  for (const key of Object.keys(faults)) {
    const at = Number(key);
    if (at >= start && at < end) return false;
  }
  return true;
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
 * Correct characters actually standing on the page: what WPM is measured over.
 *
 * `correct` is cumulative and never unwinds, because it is the numerator of
 * accuracy and a backspace must not be able to erase an error. `deleted` is how
 * many correct characters have since been taken back off the page, and the
 * difference is what the player has written. With nothing deleted -- every
 * session in the blocking mode -- the two are the same number.
 */
function standing(state: TypingState): number {
  return Math.max(0, state.correct - state.deleted);
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
 *
 * WPM counts the characters *standing on the page* and accuracy counts every
 * keypress, which is why the two read different numbers off the same state. In
 * the blocking mode they are the same count, because nothing can be taken back.
 */
export function score(state: TypingState, tuning: Tuning): Score {
  const charsPerWord = tuningValue(tuning, 'wpm_chars_per_word');
  const minutes = state.elapsedMs / MS_PER_MINUTE;
  const wpm = minutes > 0 ? standing(state) / charsPerWord / minutes : 0;
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
    atEnd(state) && standing(state) === askedFor(state.glyphs, state.gilding);
  const perChar = tuningValue(tuning, 'gild_score_per_char');
  const bonus = complete ? tuningValue(tuning, 'gild_page_bonus') : 0;
  return { gilded: state.gilded, complete, points: state.gilded * perChar + bonus };
}
