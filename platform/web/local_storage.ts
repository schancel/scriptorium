/**
 * Progress persistence: bytes in and out of browser storage, and export/import
 * to a file.
 *
 * The shape of the record, and every decision taken from it, live in
 * `core/progress.ts`. This file is the seam -- it knows `localStorage`, `Blob`
 * and the calendar, and nothing else. See
 * docs/architecture/core-purity.md#the-injected-seams.
 *
 * `version` is load-bearing. Local storage gets cleared by accident far more
 * often than people expect, and losing three months of a beginner's curve to a
 * format change would be unrecoverable, so an older record is migrated and a
 * shape we cannot read at all falls back rather than overwriting blindly.
 */

import { DEFAULT_PROGRESS, migrate, type Progress } from '../../core/progress.js';

/**
 * The current slot. It carries no version in its name on purpose: the version
 * lives *inside* the record, which is what lets one slot be migrated forward
 * instead of accumulating one orphaned key per schema change.
 */
const STORE_KEY = 'scriptorium.progress';

/**
 * Slots written by earlier builds, newest first. Read when the current slot is
 * empty and then left alone -- an untouched copy of the last known-good record
 * costs a few kilobytes and is the only backup a browser gives us.
 */
const LEGACY_KEYS: readonly string[] = ['scriptorium.progress.v1'];

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing, or storage disabled. Play anyway; just do not persist.
    return null;
  }
}

/** Read the saved record, falling back to a fresh one on anything unexpected. */
export function loadProgress(): Progress {
  for (const key of [STORE_KEY, ...LEGACY_KEYS]) {
    const raw = readRaw(key);
    if (raw === null) continue;
    try {
      return migrate(JSON.parse(raw) as unknown);
    } catch {
      continue;
    }
  }
  return DEFAULT_PROGRESS;
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(progress));
  } catch {
    // Quota or private mode. Losing a session is bad; crashing mid-verse is worse.
  }
}

/**
 * Forget everything and start over.
 *
 * Deliberately destructive and deliberately available: a player who has wandered
 * into a passage they cannot face must have a way out that is not "clear your
 * browser data". The caller confirms first.
 */
export function clearProgress(): void {
  try {
    localStorage.removeItem(STORE_KEY);
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // Nothing to do; the record was not readable either.
  }
}

/** Today, as the ISO date the history curve is drawn against. */
export function today(): string {
  return new Date().toISOString().slice(0, 'YYYY-MM-DD'.length);
}

/** The whole record as a file the player can keep. */
export function exportProgress(progress: Progress): Blob {
  return new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
}

/** Read a previously exported file back, through the same migration path. */
export async function importProgress(file: Blob): Promise<Progress> {
  return migrate(JSON.parse(await file.text()) as unknown);
}
