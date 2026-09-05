/**
 * Lectio: the reading mode. One word at a time, held still on the focal column.
 *
 * @doc docs/design/02-rail.md#reading-mode
 *
 * "One word at a time, held still. Not a page gliding past."
 *
 * This is rapid serial visual presentation. The first version scrolled the
 * ribbon at a rising pace, which is a teleprompter, and a teleprompter is the
 * thing speed reading exists to get away from: text that moves must be tracked,
 * and tracking is the saccade cost the whole technique removes. The owner
 * caught it -- *"Read without typing should snap words into place rather than
 * moving them"* -- and this file is the rebuild.
 *
 * ## Nothing here moves
 *
 * There is no offset that changes between words of the same word, no easing and
 * no fractional anything. `readingOffset` is a pure function of *which word* is
 * showing, so the picture is byte-for-byte identical on every frame a word is up
 * and changes exactly once per word, in one step. The anchor letter is on the
 * focal column in every one of those pictures.
 *
 * That is also the whole of what reduced motion had to say about this mode. It
 * used to be the strongest motion stimulus in the game and it is now the
 * weakest -- there is nothing to freeze, nothing to step and no stutter to trade
 * against smoothness. See docs/design/12-motion-and-comfort.md.
 *
 * ## The anchor
 *
 * `anchorOffset` is the established RSVP recognition point and not a curve of
 * our own: recognition happens slightly left of centre, so the anchor drifts
 * later as words lengthen and then stops. First letter for a one-letter word,
 * second up to five, third up to nine, fourth beyond that -- a fourteen-letter
 * word anchors on its fourth letter exactly as a ten-letter one does.
 *
 * It is taken over the word's *letters*, so `beginning` and `beginning,`
 * anchor on the same letter. A comma is not part of the word and should not be
 * able to shift where the eye is asked to land.
 *
 * ## The pace is words per minute, literally
 *
 * Everywhere else in this codebase a "word" is `wpm_chars_per_word` characters,
 * which is the right definition for typing and the wrong one here: this mode
 * shows words, so it counts them. `lectio_start_words_per_min` is words on the
 * screen per minute and nothing else.
 *
 * The ramp climbs by `lectio_ramp_words_per_min` per sustained minute and stops
 * at `lectio_max_words_per_min`. The clock it reads is `sustainedMs`, which only
 * advances on frames the player is sustaining, so stopping stops the climb.
 *
 * ## Coming back down
 *
 * `easePace` moves the *ramp clock*, not a correction sitting on top of it. A
 * pace the player has come down to therefore stays come down and then climbs
 * again from there, rather than being quietly overridden a few seconds later by
 * a ramp that never noticed. Leaving the mode is no longer the only way to slow
 * down, which is what docs/design/02-rail.md#coming-back-down asks for.
 *
 * Nothing in any of this may become a failure. There is no way to do badly in
 * this mode and there is no clock running against the player --
 * docs/decisions/0004-idle-threat-not-speed-timer.md. The clock drives the
 * *display* because the player is not typing; it decides nothing about him.
 */

import { CELL_W, focalX } from './rail.js';
import { tuningValue } from './tuning.js';
import type { Glyph, Tuning } from './types.js';

/** Unit conversion, not a tunable: there are this many milliseconds in a minute. */
const MS_PER_MINUTE = 60000; // tuning-exempt: a minute, in milliseconds

/**
 * The recognition point, as tiers of word length: `[longest length in the tier,
 * index of the anchor letter]`, and everything longer takes `ANCHOR_LONG`.
 *
 * These are the RSVP convention rather than a feel knob, which is why they are
 * exempt rather than tunable -- the same grounds as `CELL_W` in `core/rail.ts`.
 * A tuning row would invite someone to turn a number whose value is that every
 * speed reader in the world already uses it.
 */
const ANCHOR_TIERS: readonly (readonly [number, number])[] = [
  [1, 0], // tuning-exempt: RSVP convention -- one letter anchors on itself
  [5, 1], // tuning-exempt: RSVP convention -- short words, the second letter
  [9, 2], // tuning-exempt: RSVP convention -- medium words, the third
];

/** Long words anchor here and go no further. */
const ANCHOR_LONG = 3; // tuning-exempt: RSVP convention -- the fourth letter, and it stops there

/** Characters that end a word without being part of it. */
const PAUSE_MARKS = ',;:—–-';
const STOP_MARKS = '.!?';
/** Quotes and brackets, which wrap a word and carry no beat of their own. */
const WRAPPERS = '"\'`()[]{}‘’“”';

/** True for a character that separates one word from the next. */
function isSeparator(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t';
}

/**
 * Which letter of a word of this many letters sits on the focal column.
 *
 * Pure and total, so the convention can be read off in one place and asserted
 * without building a ribbon.
 */
export function anchorOffset(letters: number): number {
  for (const tier of ANCHOR_TIERS) {
    const upto = tier[0];
    const at = tier[1];
    if (upto !== undefined && at !== undefined && letters <= upto) return at;
  }
  return ANCHOR_LONG;
}

/** One word of the passage, as reading mode shows it. */
export interface ReadingWord {
  /** Index of its first glyph in the ribbon. */
  readonly start: number;
  /** One past its last glyph. */
  readonly end: number;
  /**
   * Offset within the word of the letter that sits on the focal column. The
   * ribbon is laid out around it: `start + anchor` is the anchored glyph.
   */
  readonly anchor: number;
  /**
   * How long the word holds, as a multiple of one word's beat. One for an
   * ordinary word, `lectio_comma_hold` for a word a clause ends on, and
   * `lectio_stop_hold` for one that ends a sentence or a verse.
   */
  readonly hold: number;
}

/**
 * Split a ribbon into the words reading mode shows, in order.
 *
 * A word is a maximal run of non-separator glyphs. Nothing is filtered and
 * nothing is rewritten: every character of the passage is inside exactly one
 * word or is a separator between two, so the mode shows the real text in the
 * real order, per docs/decisions/0003-illumination-over-corpus-filtering.md.
 *
 * `verseAt` is the verse number of each glyph, so that the last word of a verse
 * can take the same beat as the last word of a sentence. It may be empty -- a
 * ribbon with no verse structure simply has no verse boundaries in it.
 */
export function splitReadingWords(
  glyphs: readonly Glyph[],
  verseAt: readonly number[],
  tuning: Tuning,
): readonly ReadingWord[] {
  const comma = tuningValue(tuning, 'lectio_comma_hold');
  const stop = tuningValue(tuning, 'lectio_stop_hold');
  const words: ReadingWord[] = [];
  let start = -1;
  for (let i = 0; i <= glyphs.length; i += 1) {
    const g = glyphs[i];
    const separator = g === undefined || isSeparator(g.ch);
    if (!separator) {
      if (start < 0) start = i;
      continue;
    }
    if (start < 0) continue;
    words.push(measureWord(glyphs, start, i, verseAt, comma, stop));
    start = -1;
  }
  return words;
}

/**
 * One word's anchor and beat.
 *
 * The anchor is taken over the letters, so wrapping quotes and a trailing comma
 * move nothing: the leading wrappers are counted past, the tier is chosen by how
 * many letters are actually there, and the result is clamped inside the word so
 * a word that is nothing but punctuation still anchors on a character it has.
 */
function measureWord(
  glyphs: readonly Glyph[],
  start: number,
  end: number,
  verseAt: readonly number[],
  comma: number,
  stop: number,
): ReadingWord {
  let lead = start;
  while (lead < end && WRAPPERS.includes(glyphs[lead]?.ch ?? '')) lead += 1;
  let tail = end;
  let hold = 1;
  while (tail > lead) {
    const ch = glyphs[tail - 1]?.ch ?? '';
    if (STOP_MARKS.includes(ch)) hold = stop;
    else if (PAUSE_MARKS.includes(ch) && hold === 1) hold = comma;
    else if (!WRAPPERS.includes(ch)) break;
    tail -= 1;
  }
  // The last word of a verse ends something too, and the ribbon joins verses
  // with a space rather than a line break -- so without this the page runs one
  // verse into the next with no beat between them at all.
  const here = verseAt[start];
  const next = verseAt[end];
  if (here !== undefined && (next === undefined || next !== here)) hold = stop;

  const letters = Math.max(0, tail - lead);
  const within = lead - start + anchorOffset(letters);
  const anchor = Math.max(0, Math.min(end - start - 1, within));
  return { start, end, anchor, hold };
}

/** State of one reading sitting. */
export interface LectioState {
  /** Milliseconds the player has sustained the reading. Drives the ramp. */
  readonly sustainedMs: number;
  /** Current pace, in words on the screen per minute. */
  readonly wpm: number;
  /** Which word is showing. */
  readonly index: number;
  /** How long it has been showing. */
  readonly holdMs: number;
  /** Milliseconds of reading elapsed, sustained or not. For the report. */
  readonly elapsedMs: number;
}

/**
 * The pace at a given amount of sustained reading.
 *
 * Pure and total, so the ramp can be drawn as a curve without running the mode,
 * and so the ceiling is one `Math.min` in one place rather than a clamp
 * scattered through the stepper.
 */
export function paceWpm(sustainedMs: number, tuning: Tuning): number {
  const start = tuningValue(tuning, 'lectio_start_words_per_min');
  const ramp = tuningValue(tuning, 'lectio_ramp_words_per_min');
  const max = tuningValue(tuning, 'lectio_max_words_per_min');
  const minutes = Math.max(0, sustainedMs) / MS_PER_MINUTE;
  return Math.min(max, start + ramp * minutes);
}

/**
 * The inverse: how much sustained reading a pace corresponds to.
 *
 * This is what makes the pace control honest. Slowing down rewinds the ramp
 * clock to the point that *produces* the slower pace, so there is exactly one
 * number deciding the pace and no correction term for the ramp to walk over.
 */
export function msForPace(wpm: number, tuning: Tuning): number {
  const start = tuningValue(tuning, 'lectio_start_words_per_min');
  const ramp = tuningValue(tuning, 'lectio_ramp_words_per_min');
  const max = tuningValue(tuning, 'lectio_max_words_per_min');
  if (ramp <= 0) return 0;
  const target = Math.min(max, Math.max(start, wpm));
  return Math.max(0, ((target - start) / ramp) * MS_PER_MINUTE);
}

/** How long a reader must sustain the pace to reach the ceiling. */
export function msToMaxPace(tuning: Tuning): number {
  const start = tuningValue(tuning, 'lectio_start_words_per_min');
  const max = tuningValue(tuning, 'lectio_max_words_per_min');
  if (max <= start) return 0;
  return msForPace(max, tuning);
}

/** A fresh sitting, at the opening pace, on the first word. */
export function createLectio(tuning: Tuning): LectioState {
  return { sustainedMs: 0, wpm: paceWpm(0, tuning), index: 0, holdMs: 0, elapsedMs: 0 };
}

/**
 * How long one word stays up, at a pace.
 *
 * A beat is a word: `MS_PER_MINUTE / wpm` and nothing else, which is what makes
 * the tunable literally what it says. Punctuation multiplies it.
 */
export function wordHoldMs(word: ReadingWord, wpm: number): number {
  if (!(wpm > 0)) return MS_PER_MINUTE;
  return (MS_PER_MINUTE / wpm) * Math.max(0, word.hold);
}

/**
 * Advance the sitting one frame.
 *
 * `sustained` is the player's half of the bargain -- the platform decides what
 * sustaining looks like (an eye still on the guide, simply not having paused)
 * and `core/` is told the answer, per
 * docs/architecture/core-purity.md#the-injected-seams.
 *
 * The words advance every frame; only the *ramp* is gated on `sustained`. A
 * paused reader stops the mode with `pauseLectio`, not by drifting: a page that
 * silently stopped turning would look like the game had frozen.
 *
 * More than one word may fall in a frame, at the ceiling or after a long frame,
 * so this is a loop rather than a step. It cannot spin: a hold is bounded below
 * by a positive number, and the loop stops at the end of the passage.
 */
export function stepLectio(
  state: LectioState,
  dtMs: number,
  words: readonly ReadingWord[],
  sustained: boolean,
  tuning: Tuning,
): LectioState {
  const dt = Math.max(0, dtMs);
  const sustainedMs = sustained ? state.sustainedMs + dt : state.sustainedMs;
  const wpm = paceWpm(sustainedMs, tuning);
  let index = state.index;
  let holdMs = state.holdMs + dt;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined) break;
    const hold = wordHoldMs(word, wpm);
    if (!(hold > 0) || holdMs < hold) break;
    holdMs -= hold;
    index += 1;
  }
  return { sustainedMs, wpm, index, holdMs, elapsedMs: state.elapsedMs + dt };
}

/**
 * Hold the word on the screen for a frame without losing the ramp.
 *
 * The reader is still in the same sitting; nothing about the pace they earned
 * has changed. A reader who looks away for a moment and comes back to 400 words
 * a minute has lost nothing, and one who comes back to 180 has been punished for
 * blinking -- in the one mode in the game that exists for the day he does not
 * want pressure.
 */
export function pauseLectio(state: LectioState, dtMs: number): LectioState {
  return { ...state, elapsedMs: state.elapsedMs + Math.max(0, dtMs) };
}

/**
 * The sitting at a chosen pace, keeping the reader's place in the passage.
 *
 * `holdMs` goes back to zero, so the word on the screen when the pace changed is
 * held for a full beat at the new pace rather than for whatever was left of the
 * old one. A press that made the current word vanish would be the control
 * feeling like a skip.
 */
export function setPace(state: LectioState, wpm: number, tuning: Tuning): LectioState {
  const sustainedMs = msForPace(wpm, tuning);
  return { ...state, sustainedMs, wpm: paceWpm(sustainedMs, tuning), holdMs: 0 };
}

/** One step slower, without leaving the mode. */
export function easePace(state: LectioState, tuning: Tuning): LectioState {
  return setPace(state, state.wpm - tuningValue(tuning, 'lectio_pace_step'), tuning);
}

/** One step quicker, for a reader who knows his pace and would rather not wait. */
export function quickenPace(state: LectioState, tuning: Tuning): LectioState {
  return setPace(state, state.wpm + tuningValue(tuning, 'lectio_pace_step'), tuning);
}

/** Back to the opening pace, keeping the reader's place. */
export function restartLectio(state: LectioState, tuning: Tuning): LectioState {
  return { ...createLectio(tuning), index: state.index, elapsedMs: state.elapsedMs };
}

/** The word showing, or null once the passage has run out. */
export function lectioWord(
  state: LectioState,
  words: readonly ReadingWord[],
): ReadingWord | null {
  return words[state.index] ?? null;
}

/** The glyph sitting on the focal column. */
export function lectioAnchorIndex(word: ReadingWord): number {
  return word.start + word.anchor;
}

/**
 * The ribbon offset that puts a word's anchor letter on the focal column.
 *
 * The same geometry `core/rail.ts` uses for typing, with the anchor standing in
 * for the cursor: every glyph is at `i * CELL_W`, so laying the word out around
 * its anchor is one subtraction and the invariant in
 * docs/design/02-rail.md#the-focal-guide holds by construction rather than by
 * care. `focalX` is untouched, as it is in every mode.
 *
 * It takes a word rather than the state, which is the point: the offset is a
 * function of *which word*, so it cannot vary between two frames showing the
 * same one. Nothing slides because there is nothing for a frame clock to reach.
 */
export function readingOffset(word: ReadingWord, viewportW: number, tuning: Tuning): number {
  return focalX(viewportW, tuning) - lectioAnchorIndex(word) * CELL_W;
}

/** True once the last word of the passage has been shown. */
export function lectioFinished(state: LectioState, words: readonly ReadingWord[]): boolean {
  return state.index >= words.length;
}

/** Fraction of the passage read, 0..1. */
export function lectioProgress(state: LectioState, words: readonly ReadingWord[]): number {
  if (words.length <= 0) return 1;
  return Math.min(1, Math.max(0, state.index / words.length));
}
