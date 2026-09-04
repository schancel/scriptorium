/**
 * The saved record: where the player is, what they have learned, and whether
 * the mastery gate has opened.
 *
 * @doc docs/architecture/data-schemas.md#progress
 *
 * Pure. The platform reads and writes the bytes (`platform/web/local_storage.ts`);
 * everything about the *shape* of the record, and every decision taken from it,
 * lives here -- see docs/architecture/core-purity.md#the-injected-seams. The
 * current date arrives as a string on `SessionResult` for the same reason.
 *
 * ## Why `recent` exists
 *
 * docs/design/06-curriculum.md#the-mastery-gate measures the gate over a
 * *trailing window*, not over a lifetime. A `KeyStat` cannot express that: it is
 * a running total, so a beginner's first bad hour is averaged into their
 * accuracy for ever and the gate they have actually earned never opens.
 *
 * So the record keeps two things. `keyStats` is the lifetime total behind the
 * report card. `recent` is the trailing window the gate reads: the last
 * `gate_window` attempts on each of the current stage's *new* keys, and nothing
 * else. Pruning it to the new keys is what keeps it small -- ten keys rather
 * than forty -- and resetting it on promotion is correct rather than merely
 * convenient, because a new stage's keys have no history to judge yet.
 */

import type { Key, KeyStat, KeyboardLayout, Stage, Thumb, Tuning } from './types.js';
import { evaluateGate, stageAt } from './curriculum.js';
import { tuningValue } from './tuning.js';

/**
 * Bumped from 1 when `position` and `recent` were added. A record at any older
 * version is *migrated*, never discarded: months of a beginner's curve is the
 * one thing in this program that cannot be regenerated.
 */
export const SCHEMA_VERSION = 2;

// --- the record -------------------------------------------------------------

/** Where the player stopped: the verse they resume on, not the one they finished. */
export interface Position {
  readonly book: string;
  readonly chapter: number;
  /** 1-based unit (verse) within the chapter. */
  readonly unit: number;
}

/** One keystroke, as the trailing window remembers it. `ms` is null when the
 *  latency was discarded for following a pause. */
export interface Attempt {
  readonly ok: boolean;
  readonly ms: number | null;
}

export interface HistoryEntry {
  /** ISO date, so the curve can be drawn without parsing a locale. */
  readonly date: string;
  readonly stage: number;
  readonly ref: string;
  readonly wpm: number;
  readonly accuracy: number;
  /**
   * True when this session opened the gate. The history view marks these, and
   * the dip that follows one is the new stage rather than a regression --
   * docs/design/08-stats.md#history requires that be said, not inferred.
   */
  readonly promoted: boolean;
}

export interface Progress {
  readonly version: number;
  readonly stage: number;
  readonly translation: string;
  readonly route: string;
  /**
   * The physical keyboard. Not in the published schema yet; the overlay is
   * useless if it forgets which board is under the player's hands between
   * sessions, so it is written here and read back defensively.
   */
  readonly layout: KeyboardLayout;
  /**
   * Which thumb strikes the space bar. A fact about the player, not about the
   * keyboard -- see docs/design/08-stats.md#nine-rows-not-ten -- so it is stored
   * next to `layout` for the same reason: a preference the report card depends
   * on that resets every session is a preference the player cannot use.
   */
  readonly spaceThumb: Thumb;
  readonly position: Position;
  readonly completed: readonly string[];
  /** Lifetime totals, behind the report card. */
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  /** The trailing window the mastery gate is measured over. */
  readonly recent: Readonly<Record<Key, readonly Attempt[]>>;
  readonly history: readonly HistoryEntry[];
}

/** Genesis 1:1. The first verse of the first chapter of the first book. */
export const DEFAULT_POSITION: Position = { book: 'Genesis', chapter: 1, unit: 1 };

/** A beginner starts at stage 1: stage 0 is the anchor drill and has no verses. */
export const DEFAULT_PROGRESS: Progress = {
  version: SCHEMA_VERSION,
  stage: 1,
  translation: 'WEB',
  route: 'pilgrimage',
  layout: 'ansi',
  spaceThumb: 'rt',
  position: DEFAULT_POSITION,
  completed: [],
  keyStats: {},
  recent: {},
  history: [],
};

// --- migration --------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function migratePosition(value: unknown): Position {
  if (!isRecord(value)) return DEFAULT_POSITION;
  return {
    book: stringOr(value['book'], DEFAULT_POSITION.book),
    chapter: Math.max(1, Math.trunc(numberOr(value['chapter'], DEFAULT_POSITION.chapter))),
    unit: Math.max(1, Math.trunc(numberOr(value['unit'], DEFAULT_POSITION.unit))),
  };
}

function migrateAttempts(value: unknown): Readonly<Record<Key, readonly Attempt[]>> {
  if (!isRecord(value)) return {};
  const out: Record<Key, readonly Attempt[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!Array.isArray(raw)) continue;
    const attempts: Attempt[] = [];
    for (const entry of raw) {
      if (!isRecord(entry)) continue;
      const ms = entry['ms'];
      attempts.push({
        ok: entry['ok'] === true,
        ms: typeof ms === 'number' && Number.isFinite(ms) ? ms : null,
      });
    }
    out[key] = attempts;
  }
  return out;
}

function migrateHistory(value: unknown): readonly HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: HistoryEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    out.push({
      date: stringOr(raw['date'], ''),
      stage: numberOr(raw['stage'], DEFAULT_PROGRESS.stage),
      ref: stringOr(raw['ref'], ''),
      wpm: numberOr(raw['wpm'], 0),
      accuracy: numberOr(raw['accuracy'], 0),
      promoted: raw['promoted'] === true,
    });
  }
  return out;
}

/**
 * Bring a stored record up to the current shape.
 *
 * Every field is defaulted individually rather than trusting the blob, because
 * the alternative to a partial read is discarding the history entirely. A
 * version 1 record -- one written before the player's position was saved --
 * keeps its stage, its statistics and its whole history, and simply resumes at
 * the beginning of the book. That is the migration the version field exists for.
 */
export function migrate(parsed: unknown): Progress {
  if (!isRecord(parsed)) return DEFAULT_PROGRESS;
  return {
    version: SCHEMA_VERSION,
    stage: Math.max(0, Math.trunc(numberOr(parsed['stage'], DEFAULT_PROGRESS.stage))),
    translation: stringOr(parsed['translation'], DEFAULT_PROGRESS.translation),
    route: stringOr(parsed['route'], DEFAULT_PROGRESS.route),
    layout: parsed['layout'] === 'iso' ? 'iso' : 'ansi',
    spaceThumb: parsed['spaceThumb'] === 'lt' ? 'lt' : 'rt',
    position: migratePosition(parsed['position']),
    completed: Array.isArray(parsed['completed'])
      ? parsed['completed'].filter((r): r is string => typeof r === 'string')
      : [],
    keyStats: isRecord(parsed['keyStats'])
      ? (parsed['keyStats'] as Record<Key, KeyStat>)
      : {},
    recent: migrateAttempts(parsed['recent']),
    history: migrateHistory(parsed['history']),
  };
}

// --- key statistics ---------------------------------------------------------

const EMPTY_STAT: KeyStat = {
  hits: 0,
  errors: 0,
  totalMs: 0,
  latencies: [],
  confusions: {},
};

function mergeCounts(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [ch, n] of Object.entries(b)) out[ch] = (out[ch] ?? 0) + n;
  return out;
}

/**
 * Lifetime totals plus one session's, with retained latency samples capped.
 *
 * The cap is what stops the record growing without bound: a `KeyStat` keeps
 * every latency it is given, and a year of daily practice would put hundreds of
 * thousands of numbers in browser storage for no gain -- the mean is carried by
 * `totalMs`, and the gate reads `recent`, not this.
 */
export function mergeKeyStats(
  a: Readonly<Record<Key, KeyStat>>,
  b: Readonly<Record<Key, KeyStat>>,
  retain: number,
): Record<Key, KeyStat> {
  const out: Record<Key, KeyStat> = { ...a };
  for (const [key, stat] of Object.entries(b)) {
    const prior = out[key] ?? EMPTY_STAT;
    out[key] = {
      hits: prior.hits + stat.hits,
      errors: prior.errors + stat.errors,
      totalMs: prior.totalMs + stat.totalMs,
      latencies: [...prior.latencies, ...stat.latencies].slice(-retain),
      confusions: mergeCounts(prior.confusions, stat.confusions),
    };
  }
  return out;
}

/**
 * One session's `KeyStat` expanded back into individual attempts.
 *
 * A `KeyStat` does not record the order its hits and errors arrived in, so the
 * session's errors are spread evenly through its hits rather than appended
 * after them. That is not cosmetic: the window keeps only its last `n`
 * attempts, and a session laid out as "every hit, then every error" would have
 * its hits truncated away first and report an accuracy of zero for a session
 * that was mostly correct.
 */
function attemptsFrom(stat: KeyStat): Attempt[] {
  const hits: Attempt[] = [];
  for (const ms of stat.latencies) hits.push({ ok: true, ms });
  for (let i = stat.latencies.length; i < stat.hits; i += 1) hits.push({ ok: true, ms: null });

  const total = hits.length + stat.errors;
  const out: Attempt[] = [];
  let taken = 0;
  for (let i = 0; i < total; i += 1) {
    const wanted = Math.round(((i + 1) * hits.length) / total);
    const hit = taken < wanted ? hits[taken] : undefined;
    if (hit === undefined) {
      out.push({ ok: false, ms: null });
    } else {
      out.push(hit);
      taken += 1;
    }
  }
  return out;
}

function statFrom(attempts: readonly Attempt[]): KeyStat {
  let hits = 0;
  let errors = 0;
  let totalMs = 0;
  const latencies: number[] = [];
  for (const attempt of attempts) {
    if (!attempt.ok) {
      errors += 1;
      continue;
    }
    hits += 1;
    if (attempt.ms !== null) {
      totalMs += attempt.ms;
      latencies.push(attempt.ms);
    }
  }
  return { hits, errors, totalMs, latencies, confusions: {} };
}

/**
 * Extend the trailing window with a session, keeping only `keys` and only the
 * last `window` attempts on each of them.
 */
export function extendRecent(
  recent: Readonly<Record<Key, readonly Attempt[]>>,
  session: Readonly<Record<Key, KeyStat>>,
  keys: readonly Key[],
  window: number,
): Record<Key, readonly Attempt[]> {
  const wanted = new Set(keys);
  const out: Record<Key, readonly Attempt[]> = {};
  for (const key of wanted) {
    const prior = recent[key] ?? [];
    const stat = session[key];
    const added = stat === undefined ? [] : attemptsFrom(stat);
    const merged = [...prior, ...added].slice(-window);
    if (merged.length > 0) out[key] = merged;
  }
  return out;
}

/**
 * The trailing window as the gate wants to read it: a `KeyStat` per key, built
 * from attempts rather than from lifetime totals.
 */
export function gateStats(
  progress: Progress,
  keys: readonly Key[],
): Record<Key, KeyStat> {
  const out: Record<Key, KeyStat> = {};
  for (const key of keys) {
    const attempts = progress.recent[key];
    if (attempts !== undefined) out[key] = statFrom(attempts);
  }
  return out;
}

// --- recording --------------------------------------------------------------

export interface SessionResult {
  /** ISO date. Supplied by the platform; `core/` has no clock. */
  readonly date: string;
  readonly stage: number;
  /** What was typed, e.g. `Genesis 1:1-3`. */
  readonly ref: string;
  readonly wpm: number;
  readonly accuracy: number;
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  /** Where to resume next time. */
  readonly position: Position;
  /** A passage finished outright, for `completed`, or null. */
  readonly completed: string | null;
  /** The stage's new keys: the only ones the trailing window retains. */
  readonly stageKeys: readonly Key[];
  readonly promoted: boolean;
}

/**
 * Fold a finished chunk into the record.
 *
 * Called at every candle, not once a chapter, so a closed tab costs a few
 * verses at worst -- docs/design/03-pacing.md.
 */
export function recordSession(
  progress: Progress,
  result: SessionResult,
  tuning: Tuning,
): Progress {
  const historyMax = Math.max(1, Math.trunc(tuningValue(tuning, 'history_max_sessions')));
  const window = Math.max(1, Math.trunc(tuningValue(tuning, 'gate_window')));
  const entry: HistoryEntry = {
    date: result.date,
    stage: result.stage,
    ref: result.ref,
    wpm: result.wpm,
    accuracy: result.accuracy,
    promoted: result.promoted,
  };
  const completed =
    result.completed === null || progress.completed.includes(result.completed)
      ? progress.completed
      : [...progress.completed, result.completed];
  return {
    ...progress,
    stage: result.stage,
    position: result.position,
    completed,
    keyStats: mergeKeyStats(progress.keyStats, result.keyStats, window),
    recent: extendRecent(progress.recent, result.keyStats, result.stageKeys, window),
    history: [...progress.history, entry].slice(-historyMax),
  };
}

/** Move the bookmark without recording a session. */
export function withPosition(progress: Progress, position: Position): Progress {
  return { ...progress, position };
}

/**
 * Promote to `stage`, clearing the trailing window and marking the session that
 * earned it.
 *
 * The window is emptied because it holds the *old* stage's new keys, which are
 * no longer what the gate asks about. Lifetime `keyStats` are untouched.
 *
 * The mark on the history entry is not decoration. The next few sessions will
 * be *slower* -- more live characters means lower WPM -- and an unexplained dip
 * in the curve is the single most likely reason a beginner concludes the game
 * is broken, so the curve has to be able to say which dips were promotions.
 * See docs/design/08-stats.md#history.
 */
export function promote(progress: Progress, stage: number): Progress {
  const history = [...progress.history];
  const last = history[history.length - 1];
  if (last !== undefined) history[history.length - 1] = { ...last, promoted: true };
  return { ...progress, stage, recent: {}, history };
}

// --- the gate ---------------------------------------------------------------

/**
 * What a promotion is, as data. The wording belongs to the view; the numbers
 * that make the wording honest belong here.
 */
export interface Promotion {
  readonly from: number;
  readonly to: number;
  /** The keys the new stage introduces. */
  readonly newKeys: readonly Key[];
  readonly description: string;
  /** Measured live-keystroke fraction before and after. It goes *up*. */
  readonly coverageBefore: number;
  readonly coverageAfter: number;
}

/**
 * Has the player earned the next stage?
 *
 * Delegates the judgement itself to `evaluateGate`, unchanged and unweakened:
 * accuracy *and* median latency on the current stage's new keys, measured over
 * the trailing window in `recent`. Slow-but-accurate is the hunt-and-peck
 * signature and does not pass -- docs/design/06-curriculum.md#the-mastery-gate.
 *
 * Returns null when the gate is shut, and also when there is no next stage: a
 * player who has finished the curriculum keeps playing rather than looping on a
 * promotion that cannot happen.
 */
export function evaluatePromotion(
  progress: Progress,
  stages: readonly Stage[],
  tuning: Tuning,
): Promotion | null {
  const current = stageAt(stages, progress.stage);
  const next = stages.find((s) => s.stage > current.stage);
  if (next === undefined) return null;
  if (!evaluateGate(current, gateStats(progress, current.keys), tuning).passed) return null;
  return {
    from: current.stage,
    to: next.stage,
    newKeys: next.keys,
    description: next.description,
    coverageBefore: current.predictedCoverage,
    coverageAfter: next.predictedCoverage,
  };
}

/**
 * How far the current stage is from opening the gate, for the report card's
 * "what is still missing" line -- docs/design/08-stats.md#the-report-card.
 */
export function gateProgress(
  progress: Progress,
  stages: readonly Stage[],
  tuning: Tuning,
): { readonly stage: Stage; readonly gate: ReturnType<typeof evaluateGate> } {
  const stage = stageAt(stages, progress.stage);
  return { stage, gate: evaluateGate(stage, gateStats(progress, stage.keys), tuning) };
}
