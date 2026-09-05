/**
 * Lectio: the reading mode. Same rail, same focal guide, no typing.
 *
 * @doc docs/design/02-rail.md#reading-mode
 *
 * "The rail makes a reading mode nearly free: same ribbon, same focal guide, no
 * typing. Text flows through at a pace that ramps upward the longer the player
 * sustains it."
 *
 * This is a real feature, not a bonus. It is the mode available on a day he does
 * not want to drill, it exercises the same corpus, and it converts the
 * fixed-gaze habit from a side effect of the typing rail into something
 * practised deliberately -- which is the point of the rail in the first place,
 * per docs/design/02-rail.md#fixed-eyes-moving-world.
 *
 * ## The ramp
 *
 * Pace opens at `lectio_start_wpm`, climbs by `lectio_ramp_wpm` per minute, and
 * stops at `lectio_max_wpm`. The clock the ramp reads is not wall time: it is
 * `sustainedMs`, which only advances on frames the player is sustaining. Stop
 * following and the ramp stops climbing.
 *
 * It **holds** rather than falls back. A reader who looks away for a moment and
 * returns to 400 wpm has lost nothing; a reader who returns to 180 has been
 * punished for blinking, in the one mode in the game that exists for the day he
 * does not want pressure. Coming down is a decision the player makes with
 * `restartLectio`, not one the mode makes for him. That is the same reasoning as
 * docs/decisions/0004-idle-threat-not-speed-timer.md: nothing here may turn into
 * a time-based failure.
 *
 * ## Why the offset is fractional
 *
 * The ribbon glides rather than stepping. `charOffset` is a fractional character
 * count, so the rail offset it produces moves smoothly through the focal guide
 * at any pace; rounding it to whole cells would make 180 wpm a stutter of three
 * cells a second, and the fixed gaze point exists precisely so the eye can rest
 * on continuous motion. `lectioCursor` rounds only for callers that need to name
 * a character.
 */

import { CELL_W, focalX } from './rail.js';
import { tuningValue } from './tuning.js';
import type { Tuning } from './types.js';

/** Unit conversion, not a tunable: there are this many milliseconds in a minute. */
const MS_PER_MINUTE = 60000; // tuning-exempt: a minute, in milliseconds

export interface LectioState {
  /** Milliseconds the player has sustained the reading. Drives the ramp. */
  readonly sustainedMs: number;
  /** Current pace, words per minute. Bounded by `lectio_max_wpm`. */
  readonly wpm: number;
  /** Fractional characters advanced since the start of the sitting. */
  readonly charOffset: number;
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
  const start = tuningValue(tuning, 'lectio_start_wpm');
  const ramp = tuningValue(tuning, 'lectio_ramp_wpm');
  const max = tuningValue(tuning, 'lectio_max_wpm');
  const minutes = Math.max(0, sustainedMs) / MS_PER_MINUTE;
  return Math.min(max, start + ramp * minutes);
}

/** How long a reader must sustain the pace to reach the ceiling. */
export function msToMaxPace(tuning: Tuning): number {
  const start = tuningValue(tuning, 'lectio_start_wpm');
  const ramp = tuningValue(tuning, 'lectio_ramp_wpm');
  const max = tuningValue(tuning, 'lectio_max_wpm');
  if (ramp <= 0 || max <= start) return 0;
  return ((max - start) / ramp) * MS_PER_MINUTE;
}

/** Characters per millisecond at a pace, in the game's one definition of a word. */
function charsPerMs(wpm: number, tuning: Tuning): number {
  return (wpm * tuningValue(tuning, 'wpm_chars_per_word')) / MS_PER_MINUTE;
}

/** A fresh sitting, at the opening pace. */
export function createLectio(tuning: Tuning): LectioState {
  return { sustainedMs: 0, wpm: paceWpm(0, tuning), charOffset: 0, elapsedMs: 0 };
}

/**
 * Advance the ribbon one frame.
 *
 * `sustained` is the player's half of the bargain -- the platform decides what
 * sustaining looks like (a held key, an eye still on the guide, simply not
 * having paused) and `core/` is told the answer, per
 * docs/architecture/core-purity.md#the-injected-seams.
 *
 * The text advances every frame; only the *ramp* is gated on `sustained`. A
 * paused reader stops the mode with `pauseLectio`, not by drifting: reading that
 * silently stopped scrolling would look like the game had frozen.
 */
export function stepLectio(
  state: LectioState,
  dtMs: number,
  sustained: boolean,
  tuning: Tuning,
): LectioState {
  const dt = Math.max(0, dtMs);
  const sustainedMs = sustained ? state.sustainedMs + dt : state.sustainedMs;
  const wpm = paceWpm(sustainedMs, tuning);
  return {
    sustainedMs,
    wpm,
    charOffset: state.charOffset + charsPerMs(state.wpm, tuning) * dt,
    elapsedMs: state.elapsedMs + dt,
  };
}

/**
 * Hold the ribbon still for a frame without losing the ramp.
 *
 * The reader is still in the same sitting; nothing about the pace they earned
 * has changed. Only `restartLectio` gives the ramp back.
 */
export function pauseLectio(state: LectioState, dtMs: number): LectioState {
  return { ...state, elapsedMs: state.elapsedMs + Math.max(0, dtMs) };
}

/** Back to the opening pace, keeping the reader's place in the text. */
export function restartLectio(state: LectioState, tuning: Tuning): LectioState {
  return { ...createLectio(tuning), charOffset: state.charOffset, elapsedMs: state.elapsedMs };
}

/** The character under the focal guide. */
export function lectioCursor(state: LectioState): number {
  return Math.floor(state.charOffset);
}

/**
 * The ribbon offset for this frame: the same geometry `core/rail.ts` uses for
 * typing, with a fractional cursor. The focal x is untouched, which is the
 * invariant docs/design/02-rail.md#the-focal-guide requires of every mode.
 *
 * `reduced` floors the offset to a whole character, so the page advances a
 * character at a time instead of gliding. This is the one mode in the game whose
 * entire content is a continuously sliding page, which makes it the strongest
 * stimulus in it -- so the fractional offset the section above defends is exactly
 * what has to go when the player has asked for reduced motion. It becomes a
 * stutter, and that is the honest translation: the mode still runs, still ramps,
 * still asks nothing, and no longer slides.
 * See docs/design/12-motion-and-comfort.md#reading-mode-steps-as-well.
 */
export function lectioOffset(
  state: LectioState,
  viewportW: number,
  tuning: Tuning,
  reduced = false,
): number {
  const at = reduced ? Math.floor(state.charOffset) : state.charOffset;
  return focalX(viewportW, tuning) - at * CELL_W;
}

/** True once the ribbon has run off the end of the passage. */
export function lectioFinished(state: LectioState, charCount: number): boolean {
  return state.charOffset >= charCount;
}

/** Fraction of the passage read, 0..1. */
export function lectioProgress(state: LectioState, charCount: number): number {
  if (charCount <= 0) return 1;
  return Math.min(1, Math.max(0, state.charOffset / charCount));
}
