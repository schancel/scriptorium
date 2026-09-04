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

import type { GateResult, Key, KeyStat, KeyboardLayout, Stage, Thumb, Tuning } from './types.js';
import { evaluateGate, stageAt } from './curriculum.js';
import { median } from './typing.js';
import { NOTE_ORDER, type NoteId } from './onboarding.js';
import { tuningValue } from './tuning.js';

/**
 * Bumped to 2 when `position` and `recent` were added, to 3 for the gilding
 * mode and whether its offer has been made, to 4 for the first run, and to 5
 * for the secret rooms the player has found. A record at any older version is
 * *migrated*, never discarded: months of a beginner's curve is the one thing in
 * this program that cannot be regenerated.
 *
 * See the version table in docs/architecture/data-schemas.md#progress.
 */
export const SCHEMA_VERSION = 5;   // tuning-exempt: a schema version, not a tunable

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
  /**
   * Flashback rooms the player has stepped into, by citation.
   *
   * Separate from `completed`, and `core/route.ts` says why: "a secret is
   * revealed by being *found* -- stepping through the doorway -- and a player
   * who steps in, turns round and walks out has still found it. Losing the room
   * off the map again would be the same as never having found it." Held in the
   * record rather than for the session for exactly that reason: a reload is a
   * cheaper way to lose a room than walking out of one.
   *
   * It gates nothing. `requiredRefs` excludes every flashback destination by
   * construction, so this list can only ever *add* to what the map shows.
   */
  readonly discovered: readonly string[];
  /** Lifetime totals, behind the report card. */
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  /** The trailing window the mastery gate is measured over. */
  readonly recent: Readonly<Record<Key, readonly Attempt[]>>;
  readonly history: readonly HistoryEntry[];
  /**
   * Gilding: every character required, nothing auto-advanced.
   *
   * Off by default and remembered per player, because it is a statement about
   * the person at the keyboard rather than about the passage in front of them.
   * A fluent typist should turn it on once, not once a session. See
   * docs/decisions/0008-gilding-permissive-input.md.
   */
  readonly gilding: boolean;
  /**
   * Whether the game has already offered gilding.
   *
   * Stored so the offer is made once. Offer, never impose -- and an offer that
   * reappears every time the player has a good session has stopped being an
   * offer and become nagging, which is the same failure in a politer voice.
   */
  readonly gildOffered: boolean;
  /**
   * Whether the opening screen is still owed.
   *
   * True in a brand new record and false the moment the screen is dismissed.
   * It is stored rather than held for the session because the screen exists for
   * someone who has never typed properly before, and showing it again on the
   * second evening would say the game had not noticed the first one.
   * See docs/design/10-first-run.md#once-only-and-gone.
   */
  readonly firstRun: boolean;
  /**
   * The just-in-time notes already spent, one flag per note.
   *
   * A list rather than three booleans so that adding or retiring a note is a
   * change to `core/onboarding.ts` and not to the record's shape. Written the
   * moment a note is *shown*: a tip that returns after you have understood it
   * is an insult, and a closed tab is not a reason to be told twice.
   */
  readonly notesSeen: readonly NoteId[];
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
  discovered: [],
  keyStats: {},
  recent: {},
  history: [],
  gilding: false,
  gildOffered: false,
  firstRun: true,
  notesSeen: [],
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

/**
 * Which first-run notes a stored record has already spent.
 *
 * The absent case is the whole point. A record written before version 4 has no
 * such field, and the player who wrote it has been playing for weeks -- the
 * notes were never shown to him and must never start being shown to him now, so
 * an absent list reads as *all of them spent*, not as none. `firstRun` is
 * defaulted the same way, by requiring an explicit `true`.
 *
 * Anything that is not a note id is dropped and the order is canonical, so a
 * hand-edited record cannot invent a note or resurrect one.
 */
function migrateNotes(value: unknown): readonly NoteId[] {
  if (!Array.isArray(value)) return NOTE_ORDER;
  const stored: readonly unknown[] = value;
  return NOTE_ORDER.filter((id) => stored.includes(id));
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
 * the beginning of the book. A version 2 record keeps all of that and comes
 * back with gilding off, which is what it was doing anyway. That is the
 * migration the version field exists for; nothing is ever dropped.
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
    // Empty for a version 4 record, which is the only honest default: nothing
    // recorded a found room before this version existed, so the game does not
    // know of any. It costs the player nothing -- a secret is optional by
    // construction and re-finding one is the same walk it was the first time.
    discovered: Array.isArray(parsed['discovered'])
      ? parsed['discovered'].filter((r): r is string => typeof r === 'string')
      : [],
    keyStats: isRecord(parsed['keyStats'])
      ? (parsed['keyStats'] as Record<Key, KeyStat>)
      : {},
    recent: migrateAttempts(parsed['recent']),
    history: migrateHistory(parsed['history']),
    // Both default to false, which is exactly what a version 2 record meant:
    // the mode did not exist, so it was off and had never been offered.
    gilding: parsed['gilding'] === true,
    gildOffered: parsed['gildOffered'] === true,
    // A stored record is by definition a record someone has already played, so
    // the opening screen is behind them whether or not it existed when they
    // played it. Both fields therefore default to "already done".
    firstRun: parsed['firstRun'] === true,
    notesSeen: migrateNotes(parsed['notesSeen']),
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
 * Remember a flashback room the player stepped into.
 *
 * Idempotent, and it only ever grows: a room found is found. Nothing here can
 * remove one, because the only thing that could -- walking back out of it --
 * is exactly the case `core/route.ts` says must still count as having found it.
 */
export function withDiscovered(progress: Progress, ref: string): Progress {
  if (progress.discovered.includes(ref)) return progress;
  return { ...progress, discovered: [...progress.discovered, ref] };
}

// --- the two switches the player owns ---------------------------------------

/**
 * Turn gilding on or off.
 *
 * Nothing else changes -- not the stage, not the window, not the history. The
 * mode decides what the passage asks for, and asking for more of a passage is
 * not a statement about what the player has learned.
 *
 * There is deliberately no path by which the *game* calls this: it is reached
 * from the menu and from answering the offer, both of which are the player
 * saying so. See docs/decisions/0008-gilding-permissive-input.md.
 */
export function setGilding(progress: Progress, gilding: boolean): Progress {
  return { ...progress, gilding };
}

/**
 * Set the stage directly, as the menu does.
 *
 * This is the honest route for someone who already types -- one control, said
 * out loud -- and it is the reason gilding is allowed to leave the gate alone.
 * ADR 0008 names it explicitly as the alternative to gilding opening gates: a
 * player who wants to skip ahead should say so, rather than have a side effect
 * of a difficulty mode do it quietly on their behalf.
 *
 * The trailing window is emptied, for exactly the reason `promote` empties it:
 * it holds the *old* stage's new keys, which are no longer the keys the gate is
 * asking about. Lifetime `keyStats` and the whole history are untouched -- this
 * changes what the player is being taught next, not what they have done.
 *
 * The stage is clamped into the curriculum's own range rather than trusted, so
 * a hand-edited record or a stale menu cannot ask for a stage that does not
 * exist.
 */
export function setStage(progress: Progress, stage: number, stages: readonly Stage[]): Progress {
  const wanted = stageAt(stages, Math.trunc(stage)).stage;
  if (wanted === progress.stage) return progress;
  return { ...progress, stage: wanted, recent: {} };
}

/**
 * Should the game offer gilding?
 *
 * Offer, never impose. This returns whether to *ask*; turning the mode on is
 * `setGilding`, and only the player's answer calls it. Silently removing a
 * scaffold from someone having a good day is the failure this shape exists to
 * make impossible -- there is no code path from this function to the mode.
 *
 * The evidence required is `gild_offer_sessions` consecutive finished sessions
 * at or above `gild_offer_wpm`. One fast part is a short verse; a run of them
 * is a typist. Once asked, never asked again: `gildOffered` is set whichever
 * way the player answers.
 */
export function shouldOfferGilding(progress: Progress, tuning: Tuning): boolean {
  if (progress.gilding || progress.gildOffered) return false;
  const need = Math.max(1, Math.trunc(tuningValue(tuning, 'gild_offer_sessions')));
  const wpm = tuningValue(tuning, 'gild_offer_wpm');
  const recent = progress.history.slice(-need);
  if (recent.length < need) return false;
  return recent.every((entry) => entry.wpm >= wpm);
}

// --- the first run ----------------------------------------------------------

/**
 * The opening screen has been read. It does not come back.
 *
 * Nothing else moves: the first run is a thing the game has said, not a thing
 * the player has done, so it touches no statistic and no stage.
 */
export function withOpeningSeen(progress: Progress): Progress {
  return progress.firstRun ? { ...progress, firstRun: false } : progress;
}

/**
 * Remember which notes have been shown.
 *
 * Takes the coach's whole set rather than one id, because the coach is the one
 * thing that knows what has been said and a record that could disagree with it
 * would be a second copy of the same fact.
 */
export function withNotesSeen(progress: Progress, seen: readonly NoteId[]): Progress {
  return { ...progress, notesSeen: NOTE_ORDER.filter((id) => seen.includes(id)) };
}

/**
 * Arm the first run again, from the menu.
 *
 * For someone who clicked past the opening screen without reading it, and for
 * someone handing the game to a friend for an evening. It re-arms the notes
 * too: the friend has not met a dim letter either.
 *
 * It is the only way back in. Nothing in the game re-arms this by itself, for
 * the same reason nothing turns gilding on by itself -- an explanation the
 * player did not ask for twice is nagging, whatever it says.
 */
export function replayFirstRun(progress: Progress): Progress {
  return { ...progress, firstRun: true, notesSeen: [] };
}

/** Remember that the offer has been made, whichever way it was answered. */
export function withGildOffered(progress: Progress): Progress {
  return { ...progress, gildOffered: true };
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
 * How far the current stage is from opening the gate.
 *
 * `evaluateGate` answers *whether* the gate is shut, which is all the promotion
 * needs. The report card has to say *by how much* -- "91% and the stage opens at
 * 95%" is a thing a player can act on, and "not yet" is not -- so this carries
 * the measured pair and the pair they are measured against.
 *
 * The judgement itself is still `evaluateGate`'s and is not restated here: this
 * reports the numbers, and `gate.passed` is the only thing anything acts on. The
 * latency allowance is the one line of arithmetic shared with
 * `core/curriculum.ts`, and `core/report.test.ts` pins the two together by
 * asserting that a median exactly at `allowedLatencyMs` passes and one a
 * millisecond above it does not.
 */
export interface GateStanding {
  readonly stage: Stage;
  readonly gate: GateResult;
  /** Accuracy over the trailing window, on this stage's new keys. 0 with no samples. */
  readonly accuracy: number;
  /** Median latency over the same window. 0 with no samples. */
  readonly medianMs: number;
  readonly requiredAccuracy: number;
  readonly allowedLatencyMs: number;
  readonly requiredSamples: number;
}

export function gateProgress(
  progress: Progress,
  stages: readonly Stage[],
  tuning: Tuning,
): GateStanding {
  const stage = stageAt(stages, progress.stage);
  const stats = gateStats(progress, stage.keys);
  const gate = evaluateGate(stage, stats, tuning);

  let hits = 0;
  let errors = 0;
  const latencies: number[] = [];
  for (const key of stage.keys) {
    const stat = stats[key];
    if (stat === undefined) continue;
    hits += stat.hits;
    errors += stat.errors;
    for (const ms of stat.latencies) latencies.push(ms);
  }
  const samples = hits + errors;

  const base = tuningValue(tuning, 'gate_latency_base_ms');
  const step = tuningValue(tuning, 'gate_latency_step_ms');
  const floor = tuningValue(tuning, 'gate_latency_floor_ms');

  return {
    stage,
    gate,
    accuracy: samples === 0 ? 0 : hits / samples,
    medianMs: median(latencies),
    requiredAccuracy: tuningValue(tuning, 'gate_accuracy'),
    allowedLatencyMs: Math.max(floor, base - stage.stage * step),
    requiredSamples: tuningValue(tuning, 'gate_window'),
  };
}
