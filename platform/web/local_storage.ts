/**
 * Progress persistence, and export/import to a file.
 *
 * The record shape is docs/architecture/data-schemas.md#progress. `version` is
 * load-bearing: local storage gets cleared by accident far more often than people
 * expect, and losing three months of a beginner's curve to a format change would
 * be unrecoverable, so a shape we no longer understand is *kept* and reported
 * rather than overwritten.
 */

import type { Key, KeyStat, KeyboardLayout } from '../../core/types.js';

const STORE_KEY = 'scriptorium.progress.v1';
const SCHEMA_VERSION = 1;
const DEFAULT_HISTORY_MAX = 500;

export interface HistoryEntry {
  /** ISO date, so the curve can be drawn without parsing a locale. */
  readonly date: string;
  readonly stage: number;
  readonly ref: string;
  readonly wpm: number;
  readonly accuracy: number;
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
  readonly completed: readonly string[];
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  readonly history: readonly HistoryEntry[];
}

/** A beginner starts at stage 1: stage 0 is the anchor drill and has no verses. */
export const DEFAULT_PROGRESS: Progress = {
  version: SCHEMA_VERSION,
  stage: 1,
  translation: 'WEB',
  route: 'pilgrimage',
  layout: 'ansi',
  completed: [],
  keyStats: {},
  history: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read the saved record, falling back to a fresh one on anything unexpected. */
export function loadProgress(): Progress {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE_KEY);
  } catch {
    // Private browsing, or storage disabled. Play anyway; just do not persist.
    return DEFAULT_PROGRESS;
  }
  if (raw === null) return DEFAULT_PROGRESS;
  try {
    return migrate(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_PROGRESS;
  }
}

/**
 * Bring a stored record up to the current shape.
 *
 * Every field is defaulted individually rather than trusting the blob, because
 * the alternative to a partial read is discarding the history entirely.
 */
export function migrate(parsed: unknown): Progress {
  if (!isRecord(parsed)) return DEFAULT_PROGRESS;
  const layout = parsed['layout'];
  const history = parsed['history'];
  return {
    version: SCHEMA_VERSION,
    stage: typeof parsed['stage'] === 'number' ? parsed['stage'] : DEFAULT_PROGRESS.stage,
    translation:
      typeof parsed['translation'] === 'string' ? parsed['translation'] : DEFAULT_PROGRESS.translation,
    route: typeof parsed['route'] === 'string' ? parsed['route'] : DEFAULT_PROGRESS.route,
    layout: layout === 'iso' ? 'iso' : 'ansi',
    completed: Array.isArray(parsed['completed']) ? (parsed['completed'] as string[]) : [],
    keyStats: isRecord(parsed['keyStats'])
      ? (parsed['keyStats'] as Record<Key, KeyStat>)
      : {},
    history: Array.isArray(history) ? (history as HistoryEntry[]) : [],
  };
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch {
    // Quota or private mode. Losing a session is bad; crashing mid-verse is worse.
  }
}

export interface SessionResult {
  readonly stage: number;
  readonly ref: string;
  readonly wpm: number;
  readonly accuracy: number;
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
}

/**
 * Append a finished level to the history and merge its key statistics into the
 * running totals. Capped at `history_max_sessions`, oldest dropped first.
 */
export function recordSession(
  progress: Progress,
  result: SessionResult,
  historyMax: number = DEFAULT_HISTORY_MAX,
): Progress {
  const entry: HistoryEntry = {
    date: new Date().toISOString().slice(0, 'YYYY-MM-DD'.length),
    stage: result.stage,
    ref: result.ref,
    wpm: result.wpm,
    accuracy: result.accuracy,
  };
  const history = [...progress.history, entry].slice(-historyMax);
  const completed = progress.completed.includes(result.ref)
    ? progress.completed
    : [...progress.completed, result.ref];
  return {
    ...progress,
    stage: result.stage,
    completed,
    keyStats: mergeKeyStats(progress.keyStats, result.keyStats),
    history,
  };
}

function mergeKeyStats(
  a: Readonly<Record<Key, KeyStat>>,
  b: Readonly<Record<Key, KeyStat>>,
): Record<Key, KeyStat> {
  const out: Record<Key, KeyStat> = { ...a };
  for (const [key, stat] of Object.entries(b)) {
    const prior = out[key];
    out[key] =
      prior === undefined
        ? stat
        : {
            hits: prior.hits + stat.hits,
            errors: prior.errors + stat.errors,
            totalMs: prior.totalMs + stat.totalMs,
            latencies: [...prior.latencies, ...stat.latencies],
            confusions: mergeCounts(prior.confusions, stat.confusions),
          };
  }
  return out;
}

function mergeCounts(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [ch, n] of Object.entries(b)) out[ch] = (out[ch] ?? 0) + n;
  return out;
}

/** The whole record as a file the player can keep. */
export function exportProgress(progress: Progress): Blob {
  return new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
}

/** Read a previously exported file back, through the same migration path. */
export async function importProgress(file: Blob): Promise<Progress> {
  return migrate(JSON.parse(await file.text()) as unknown);
}
