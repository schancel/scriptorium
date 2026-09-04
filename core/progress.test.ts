/**
 * @doc docs/architecture/data-schemas.md#progress
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Key, KeyStat, Stage, Tuning } from './types.js';
import { loadStages, stageAt } from './curriculum.js';
import { loadTuning, tuningValue } from './tuning.js';
import {
  DEFAULT_PROGRESS,
  SCHEMA_VERSION,
  type Position,
  type Progress,
  evaluatePromotion,
  gateProgress,
  gateStats,
  migrate,
  promote,
  recordSession,
  withPosition,
} from './progress.js';

function loadDataFile(name: string): unknown {
  for (const rel of ['../../data/', '../data/']) {
    try {
      return JSON.parse(readFileSync(new URL(rel + name, import.meta.url), 'utf8')) as unknown;
    } catch {
      continue;
    }
  }
  throw new Error(`test: cannot locate data/${name}`);
}

const stages: Stage[] = loadStages(loadDataFile('curriculum.json'));
const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));
const stage1: Stage = stageAt(stages, 1);

/**
 * Fixtures, not tunables. The version 1 block is the record exactly as
 * docs/architecture/data-schemas.md published it, so the migration test is
 * checking against the published shape rather than against itself.
 */
const V1_STAGE = 3;            // tuning-exempt: fixture from the published version 1 record
const V1_HITS = 812;           // tuning-exempt: fixture
const V1_ERRORS = 19;          // tuning-exempt: fixture
const V1_LATENCY_MS = 340;     // tuning-exempt: fixture
const V1_WPM = 14.2;           // tuning-exempt: fixture
const V1_ACCURACY = 0.97;      // tuning-exempt: fixture
const RESUME_UNIT = 4;         // tuning-exempt: a verse number, not a knob

const window = tuningValue(tuning, 'gate_window');
const fastMs = tuningValue(tuning, 'gate_latency_floor_ms');
const slowMs = tuningValue(tuning, 'gate_latency_base_ms');

/**
 * Keystrokes per key needed to fill the gate's window across a whole stage.
 * Derived, so a change to `gate_window` moves the test with it.
 */
const perKey = Math.ceil(window / stage1.keys.length);

function stat(hits: number, errors: number, latencyMs: number): KeyStat {
  return {
    hits,
    errors,
    totalMs: latencyMs * hits,
    latencies: new Array<number>(hits).fill(latencyMs),
    confusions: {},
  };
}

function statsFor(keys: readonly Key[], one: KeyStat): Record<Key, KeyStat> {
  const out: Record<Key, KeyStat> = {};
  for (const key of keys) out[key] = one;
  return out;
}

const SOMEWHERE: Position = { book: 'Genesis', chapter: 1, unit: RESUME_UNIT };

function play(progress: Progress, one: KeyStat, date = '2026-09-03'): Progress {
  return recordSession(
    progress,
    {
      date,
      stage: progress.stage,
      ref: 'Genesis 1:1-3',
      wpm: V1_WPM,
      accuracy: V1_ACCURACY,
      keyStats: statsFor(stage1.keys, one),
      position: SOMEWHERE,
      completed: null,
      stageKeys: stageAt(stages, progress.stage).keys,
      promoted: false,
    },
    tuning,
  );
}

// --- the schema -------------------------------------------------------------

test('a version 1 record keeps everything it had and gains a position', () => {
  // Exactly the shape docs/architecture/data-schemas.md published at version 1.
  const v1 = {
    version: 1,
    stage: V1_STAGE,
    translation: 'KJV',
    route: 'pilgrimage',
    layout: 'iso',
    completed: ['Genesis 1'],
    keyStats: { a: stat(V1_HITS, V1_ERRORS, V1_LATENCY_MS) },
    history: [
      { date: '2026-08-01', stage: V1_STAGE, ref: 'Genesis 1', wpm: V1_WPM, accuracy: V1_ACCURACY },
    ],
  };
  const migrated = migrate(v1);

  assert.equal(migrated.version, SCHEMA_VERSION);
  assert.notEqual(SCHEMA_VERSION, 1);
  // Nothing a player earned may be dropped by a format change.
  assert.equal(migrated.stage, V1_STAGE);
  assert.equal(migrated.translation, 'KJV');
  assert.equal(migrated.layout, 'iso');
  assert.deepEqual(migrated.completed, ['Genesis 1']);
  assert.equal(migrated.keyStats['a']?.hits, V1_HITS);
  assert.equal(migrated.history.length, 1);
  assert.equal(migrated.history[0]?.wpm, V1_WPM);
  // And the fields version 1 never had come back defaulted, not undefined.
  assert.deepEqual(migrated.position, DEFAULT_PROGRESS.position);
  assert.deepEqual(migrated.recent, {});
  assert.equal(migrated.history[0]?.promoted, false);
  assert.equal(migrated.spaceThumb, 'rt');
});

test('a record round-trips through JSON unchanged', () => {
  const saved = play(withPosition(DEFAULT_PROGRESS, SOMEWHERE), stat(perKey, 1, fastMs));
  const reloaded = migrate(JSON.parse(JSON.stringify(saved)) as unknown);
  assert.deepEqual(reloaded, saved);
});

test('rubbish in storage falls back rather than throwing mid-boot', () => {
  assert.deepEqual(migrate(null), DEFAULT_PROGRESS);
  assert.deepEqual(migrate('nonsense'), DEFAULT_PROGRESS);
  assert.deepEqual(migrate([]), DEFAULT_PROGRESS);
  const partial = migrate({ stage: 'three', position: { book: [] } });
  assert.equal(partial.stage, DEFAULT_PROGRESS.stage);
  assert.deepEqual(partial.position, DEFAULT_PROGRESS.position);
});

test('the bookmark is what a reload comes back to', () => {
  const moved = withPosition(DEFAULT_PROGRESS, SOMEWHERE);
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(moved)) as unknown).position, SOMEWHERE);
});

// --- recording --------------------------------------------------------------

test('a session merges into the lifetime totals and moves the bookmark', () => {
  const after = play(DEFAULT_PROGRESS, stat(perKey, 2, fastMs));
  assert.deepEqual(after.position, SOMEWHERE);
  assert.equal(after.history.length, 1);
  assert.equal(after.keyStats['a']?.hits, perKey);

  const twice = play(after, stat(perKey, 2, fastMs));
  assert.equal(twice.keyStats['a']?.hits, perKey * 2);
  assert.equal(twice.keyStats['a']?.errors, 2 * 2);
});

test('history is capped, oldest first, so storage cannot grow without bound', () => {
  const max = tuningValue(tuning, 'history_max_sessions');
  const over = 2;
  let progress = DEFAULT_PROGRESS;
  for (let i = 0; i < max + over; i += 1) {
    progress = play(progress, stat(1, 0, fastMs), `d${String(i)}`);
  }
  assert.equal(progress.history.length, max);
  assert.equal(progress.history[0]?.date, `d${String(over)}`);
});

test('retained latency samples are capped, or a year of practice fills storage', () => {
  const sessions = 2;
  let progress = DEFAULT_PROGRESS;
  for (let i = 0; i < sessions; i += 1) progress = play(progress, stat(window, 0, fastMs));
  assert.ok((progress.keyStats['a']?.latencies.length ?? 0) <= window);
  assert.equal(progress.keyStats['a']?.hits, window * sessions);
  for (const attempts of Object.values(progress.recent)) {
    assert.ok(attempts.length <= window);
  }
});

test('the trailing window keeps only the current stage keys', () => {
  const progress = play(DEFAULT_PROGRESS, stat(perKey, 0, fastMs));
  assert.deepEqual(Object.keys(progress.recent).sort(), [...stage1.keys].sort());
});

// --- the gate ---------------------------------------------------------------

test('accurate and quick opens the gate, and the stage actually advances', () => {
  const played = play(DEFAULT_PROGRESS, stat(perKey, 0, fastMs));
  const promotion = evaluatePromotion(played, stages, tuning);
  assert.notEqual(promotion, null);
  if (promotion === null) return;

  assert.equal(promotion.from, 1);
  assert.equal(promotion.to, 2);
  assert.deepEqual(promotion.newKeys, stageAt(stages, 2).keys);
  // Coverage rises, which is precisely why WPM is about to fall.
  assert.ok(promotion.coverageAfter > promotion.coverageBefore);

  const promoted = promote(played, promotion.to);
  assert.equal(promoted.stage, 2);
  assert.deepEqual(promoted.recent, {}, 'the new stage has no history to judge yet');
  assert.equal(promoted.history[promoted.history.length - 1]?.promoted, true);
  assert.equal(promoted.keyStats['a']?.hits, perKey, 'lifetime statistics survive a promotion');
});

test('slow but accurate does not pass: that is the hunt-and-peck signature', () => {
  const step = tuningValue(tuning, 'gate_latency_step_ms');
  const tooSlow = slowMs - step + 1;

  const perfect = play(DEFAULT_PROGRESS, stat(window, 0, tooSlow));
  const { gate } = gateProgress(perfect, stages, tuning);
  assert.equal(gate.accuracyMet, true, 'a hunt-and-peck typist is accurate');
  assert.equal(gate.latencyMet, false);
  assert.equal(evaluatePromotion(perfect, stages, tuning), null);
});

test('quick but inaccurate does not pass either', () => {
  const sloppy = play(DEFAULT_PROGRESS, stat(window, window, fastMs));
  const { gate } = gateProgress(sloppy, stages, tuning);
  assert.equal(gate.latencyMet, true);
  assert.equal(gate.accuracyMet, false);
  assert.equal(evaluatePromotion(sloppy, stages, tuning), null);
});

test('too few keystrokes is not a pass, however good they were', () => {
  const barely = play(DEFAULT_PROGRESS, stat(1, 0, fastMs));
  const { gate } = gateProgress(barely, stages, tuning);
  assert.ok(gate.samples < window);
  assert.equal(evaluatePromotion(barely, stages, tuning), null);
});

test('the gate is a trailing window: a bad first hour stops counting', () => {
  // An honest beginner's opening session, then a window's worth of clean typing.
  const rough = play(DEFAULT_PROGRESS, stat(0, window, slowMs));
  assert.equal(evaluatePromotion(rough, stages, tuning), null);

  const better = play(rough, stat(window, 0, fastMs));
  assert.notEqual(
    evaluatePromotion(better, stages, tuning),
    null,
    'lifetime accuracy would pin a beginner at stage 1 for ever',
  );
  // The lifetime record still remembers the bad hour; only the gate forgets it.
  assert.equal(better.keyStats['a']?.errors, window);
});

test('the gate reads the window, not the lifetime totals', () => {
  const progress = play(DEFAULT_PROGRESS, stat(perKey, 0, fastMs));
  const forGate = gateStats(progress, stage1.keys);
  assert.equal(forGate['a']?.hits, perKey);
  assert.equal(gateStats(progress, ['z'])['z'], undefined);
});

test('a player who finishes the curriculum is not offered an eleventh stage', () => {
  const last = stages[stages.length - 1];
  assert.notEqual(last, undefined);
  if (last === undefined) return;
  const atTheEnd = recordSession(
    { ...DEFAULT_PROGRESS, stage: last.stage },
    {
      date: '2026-09-03',
      stage: last.stage,
      ref: 'Revelation 22:1-3',
      wpm: 1,
      accuracy: 1,
      keyStats: statsFor(last.keys, stat(window, 0, fastMs)),
      position: SOMEWHERE,
      completed: null,
      stageKeys: last.keys,
      promoted: false,
    },
    tuning,
  );
  assert.equal(evaluatePromotion(atTheEnd, stages, tuning), null);
});
