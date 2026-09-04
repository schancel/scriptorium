/**
 * Shared type definitions for the pure core.
 *
 * @doc docs/architecture/core-purity.md#the-injected-seams
 *
 * These types are the contract between every core module and, later, the spec a
 * Dart port is translated from -- each interface becomes a Dart class almost
 * line for line. See docs/architecture/porting-to-dart.md.
 *
 * Types only; no runtime code.
 */

// --- keys and fingers -------------------------------------------------------

/**
 * A key as the curriculum names it: a literal character, or an angle-bracketed
 * token for keys with no printable form (`<space>`, `<shift>`).
 */
export type Key = string;

/** Left/right + pinky/ring/middle/index/thumb. The report card groups by this. */
export type Finger =
  | 'lp' | 'lr' | 'lm' | 'li' | 'lt'
  | 'rt' | 'ri' | 'rm' | 'rr' | 'rp';

/**
 * Which thumb strikes the space bar.
 *
 * Both thumbs rest on it and either will do, so no table keyed on `(key,
 * layout)` can answer the question -- it is a fact about the player, not about
 * the keyboard. Attributing space to one thumb regardless left the other's
 * report-card column permanently empty, and an always-empty column is exactly
 * the misreading the card exists to prevent: it says "you never use this
 * finger" about a finger the player uses on 18% of keystrokes.
 *
 * So it is a preference, defaulting to the right, and the card renders the
 * eight fingers plus the thumb actually in use. See
 * docs/design/08-stats.md#the-report-card.
 */
export type Thumb = Extract<Finger, 'lt' | 'rt'>;

export type KeyboardLayout = 'ansi' | 'iso';

// --- text and illumination --------------------------------------------------

/** One chunk of source text: a verse, or a paragraph in an imported book. */
export interface Unit {
  readonly text: string;
  /** 1-based position within its section. */
  readonly number: number;
}

export interface Passage {
  /** Canonical reference, e.g. "Genesis 1". */
  readonly ref: string;
  readonly book: string;
  readonly chapter: number;
  readonly units: readonly Unit[];
}

/**
 * One key struck, with the finger that should strike it.
 *
 * The finger is carried rather than looked up because it is not always a
 * function of the key: `<shift>` is struck by whichever pinky is *not* busy
 * with the letter, so the same key is a left-pinky stroke for one capital and a
 * right-pinky stroke for the next. See docs/design/01-illumination.md#strokes.
 */
export interface Stroke {
  readonly key: Key;
  readonly finger: Finger;
}

/**
 * A single character of displayed text, classified against the current stage.
 * See docs/design/01-illumination.md#classification.
 */
export interface Glyph {
  /** The character as printed. */
  readonly ch: string;
  /** True when the player must type it; false when greyed and auto-advanced. */
  readonly live: boolean;
  /**
   * Every key the character costs, modifiers first and the primary key last;
   * empty when greyed.
   *
   * A capital is two keys struck by two hands, and one key could never name
   * them: with a single `key` field the shift half of every capital was
   * invisible to the statistics, to the gate that is supposed to measure it,
   * and to the overlay that is supposed to point at it.
   */
  readonly strokes: readonly Stroke[];
}

// --- typing -----------------------------------------------------------------

export interface KeyStat {
  readonly hits: number;
  readonly errors: number;
  /** Summed latency of hits, for the mean. */
  readonly totalMs: number;
  /** Retained samples, for the median. */
  readonly latencies: readonly number[];
  /** What was struck instead, keyed by the wrong character. */
  readonly confusions: Readonly<Record<string, number>>;
}

export interface TypingState {
  readonly glyphs: readonly Glyph[];
  /** Index into glyphs. */
  readonly cursor: number;
  /** Every keypress, corrections included. */
  readonly keystrokes: number;
  readonly correct: number;
  /** Time spent typing this passage. */
  readonly elapsedMs: number;
  /** Time since the last keystroke; drives the blot-cloud. */
  readonly sinceKeyMs: number;
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  /** True when the last keystroke was wrong; the cursor is held. */
  readonly blocked: boolean;
}

export interface Score {
  readonly wpm: number;
  /** 0..1 */
  readonly accuracy: number;
  readonly medianLatencyMs: number;
}

// --- curriculum -------------------------------------------------------------

export interface Stage {
  readonly stage: number;
  /** Introduced at this stage. */
  readonly keys: readonly Key[];
  /** Cumulative: everything typable now. */
  readonly keySet: readonly Key[];
  readonly predictedCoverage: number;
  readonly description: string;
}

export interface GateResult {
  readonly passed: boolean;
  readonly accuracyMet: boolean;
  readonly latencyMet: boolean;
  /** Keystrokes on the new keys so far. */
  readonly samples: number;
}

// --- world ------------------------------------------------------------------

export type Mode = 'title' | 'level' | 'flashback' | 'report' | 'map' | 'lectio';

export interface CloudState {
  readonly phase: 'absent' | 'approaching' | 'striking';
  readonly phaseMs: number;
  readonly x: number;
}

export interface DamageState {
  readonly hearts: number;
  /** 0..tuning.smudge_max */
  readonly smudge: number;
  readonly combo: number;
}

export interface RailState {
  /** Current ribbon scroll, in virtual px. */
  readonly offset: number;
  /** Where it is easing toward. */
  readonly targetOffset: number;
}

/** A saved position to return to when a flashback ends. */
export interface ReturnFrame {
  readonly ref: string;
  readonly cursor: number;
  readonly damage: DamageState;
}

/** The whole simulation. `sim.step` is a pure function of this plus inputs. */
export interface GameState {
  readonly mode: Mode;
  readonly stage: number;
  readonly passage: Passage;
  readonly typing: TypingState;
  readonly damage: DamageState;
  readonly cloud: CloudState;
  readonly rail: RailState;
  readonly returnStack: readonly ReturnFrame[];
  readonly inventory: readonly string[];
  readonly theme: string;
  /** The seeded PRNG's state; never ambient. */
  readonly rngState: number;
  readonly elapsedMs: number;
}

// --- injected seams ---------------------------------------------------------

export interface InputEvent {
  readonly type: 'key' | 'command';
  /** The character typed, or a command name. */
  readonly value: string;
}

/** Tuning values, compiled from docs/design/07-tuning.md. */
export type Tuning = Readonly<Record<string, number>>;

// --- output: display list ---------------------------------------------------

/**
 * A frame, as data. The core never draws; the platform executes these in order.
 * Every command must survive JSON round-tripping -- no closures, no references.
 * See docs/architecture/display-list.md.
 */
export type DrawCmd =
  | { op: 'sprite'; id: string; x: number; y: number; frame?: number; flip?: boolean; tint?: number; alpha?: number }
  | { op: 'tile'; id: string; x: number; y: number; w: number; h: number; alpha?: number }
  | { op: 'text'; value: string; x: number; y: number; style: string; color: number; alpha?: number }
  | { op: 'rect'; x: number; y: number; w: number; h: number; color: number; alpha?: number }
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number; color: number; width?: number };

export type SoundEvent =
  | { type: 'note'; ch: 'pulse1' | 'pulse2' | 'triangle' | 'noise'; midi: number; vel: number; ms: number; duty?: number; arp?: readonly number[]; arpHz?: number }
  | { type: 'sfx'; id: string; vel?: number }
  | { type: 'tempo'; ratio: number };
