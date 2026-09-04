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
  replayFirstRun,
  setGilding,
  setStage,
  shouldOfferGilding,
  withGildOffered,
  withDiscovered,
  withNotesSeen,
  withOpeningSeen,
  withPosition,
} from './progress.js';
import { NOTE_ORDER } from './onboarding.js';

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
const V3_VERSION = 3;          // tuning-exempt: fixture from the published version 3 record

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

  // And this record's owner has been playing since before there *was* a first
  // run. Starting to explain the game to him now would be worse than never
  // having explained it, so a stored record defaults to "already done".
  assert.equal(migrated.firstRun, false, 'a returning player was shown the opening screen');
  assert.deepEqual([...migrated.notesSeen], [...NOTE_ORDER]);
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


// --- gilding: the mode, the offer, and the stage control --------------------
//
// docs/decisions/0008-gilding-permissive-input.md.

/** The version 2 record exactly as docs/architecture/data-schemas.md published it. */
const V2_RECORD = {
  version: 2,
  stage: V1_STAGE,
  translation: 'KJV',
  route: 'pilgrimage',
  layout: 'iso',
  spaceThumb: 'lt',
  position: { book: 'Psalms', chapter: 23, unit: 4 },   // tuning-exempt: fixture
  completed: ['Genesis 1'],
  keyStats: { a: stat(V1_HITS, V1_ERRORS, V1_LATENCY_MS) },
  recent: { a: [{ ok: true, ms: V1_LATENCY_MS }, { ok: false, ms: null }] },
  history: [
    {
      date: '2026-08-01', stage: V1_STAGE, ref: 'Genesis 1',
      wpm: V1_WPM, accuracy: V1_ACCURACY, promoted: true,
    },
  ],
};

test('a version 2 record migrates with its history and statistics intact', () => {
  const migrated = migrate(V2_RECORD);

  assert.equal(migrated.version, SCHEMA_VERSION);
  assert.notEqual(SCHEMA_VERSION, 2);
  // Nothing a player earned may be dropped by a format change.
  assert.equal(migrated.stage, V1_STAGE);
  assert.equal(migrated.translation, 'KJV');
  assert.equal(migrated.layout, 'iso');
  assert.equal(migrated.spaceThumb, 'lt');
  assert.deepEqual(migrated.position, { book: 'Psalms', chapter: 23, unit: 4 }); // tuning-exempt: fixture
  assert.deepEqual(migrated.completed, ['Genesis 1']);
  assert.equal(migrated.keyStats['a']?.hits, V1_HITS);
  assert.equal(migrated.keyStats['a']?.errors, V1_ERRORS);
  assert.equal(migrated.recent['a']?.length, 2);   // tuning-exempt: two attempts in the fixture
  assert.equal(migrated.history.length, 1);
  assert.equal(migrated.history[0]?.wpm, V1_WPM);
  assert.equal(migrated.history[0]?.promoted, true);

  // And the fields version 2 never had come back as what version 2 meant: the
  // mode did not exist, so it was off and had never been offered.
  assert.equal(migrated.gilding, false);
  assert.equal(migrated.gildOffered, false);
  assert.equal(migrated.firstRun, false);
  assert.deepEqual([...migrated.notesSeen], [...NOTE_ORDER]);
});

test('the gilding mode survives a reload', () => {
  const on = setGilding(migrate(V2_RECORD), true);
  const reloaded = migrate(JSON.parse(JSON.stringify(on)) as unknown);
  assert.equal(reloaded.gilding, true);
  assert.deepEqual(reloaded, on, 'the record did not round-trip');

  const off = migrate(JSON.parse(JSON.stringify(setGilding(on, false))) as unknown);
  assert.equal(off.gilding, false);
});

test('turning gilding on changes nothing else -- not the stage, not the window', () => {
  const before = play(withPosition(DEFAULT_PROGRESS, SOMEWHERE), stat(perKey, 1, fastMs));
  const after = setGilding(before, true);
  assert.deepEqual({ ...after, gilding: before.gilding }, before);
});

test('the menu can set the stage directly, and that is the only thing it moves', () => {
  const before = play(withPosition(DEFAULT_PROGRESS, SOMEWHERE), stat(perKey, 1, fastMs));
  const last = stages[stages.length - 1];
  assert.ok(last !== undefined);

  const jumped = setStage(before, last.stage, stages);
  assert.equal(jumped.stage, last.stage);
  // The history and the lifetime totals are what the player did; a stage change
  // is a statement about what they are being taught next.
  assert.deepEqual(jumped.history, before.history);
  assert.deepEqual(jumped.keyStats, before.keyStats);
  assert.deepEqual(jumped.position, before.position);
  // The window held the *old* stage's new keys, which the gate no longer asks
  // about -- the same reason `promote` empties it.
  assert.deepEqual(jumped.recent, {});
});

test('a stage the curriculum does not have is clamped, not accepted', () => {
  const last = stages[stages.length - 1];
  const first = stages[0];
  assert.ok(last !== undefined && first !== undefined);
  const beyond = last.stage + stages.length;
  assert.equal(setStage(DEFAULT_PROGRESS, beyond, stages).stage, last.stage);
  assert.equal(setStage(DEFAULT_PROGRESS, -1, stages).stage, first.stage);
});

test('the offer is made only after sustained pace, and only ever offered', () => {
  const need = Math.trunc(tuningValue(tuning, 'gild_offer_sessions'));
  const fast = tuningValue(tuning, 'gild_offer_wpm');
  const entry = (wpm: number) => ({
    date: '2026-09-03', stage: 1, ref: 'Genesis 1:1-3', wpm, accuracy: 1, promoted: false,
  });

  // Not enough evidence yet: one fast part is a short verse.
  const few = { ...DEFAULT_PROGRESS, history: Array.from({ length: need - 1 }, () => entry(fast)) };
  assert.equal(shouldOfferGilding(few, tuning), false);

  // A slow session inside the window is a player who still needs the scaffold.
  const mixed = {
    ...DEFAULT_PROGRESS,
    history: [...Array.from({ length: need - 1 }, () => entry(fast)), entry(fast - 1)],
  };
  assert.equal(shouldOfferGilding(mixed, tuning), false);

  const earned = { ...DEFAULT_PROGRESS, history: Array.from({ length: need }, () => entry(fast)) };
  assert.equal(shouldOfferGilding(earned, tuning), true);

  // OFFER, NEVER IMPOSE. Asking does not turn it on: the mode is still off, and
  // only `setGilding` -- which nothing but the player's answer calls -- moves it.
  assert.equal(earned.gilding, false);
  assert.equal(withGildOffered(earned).gilding, false);
});

test('the offer is made once, whichever way it is answered', () => {
  const need = Math.trunc(tuningValue(tuning, 'gild_offer_sessions'));
  const fast = tuningValue(tuning, 'gild_offer_wpm');
  const earned = {
    ...DEFAULT_PROGRESS,
    history: Array.from({ length: need }, () => ({
      date: '2026-09-03', stage: 1, ref: 'Genesis 1:1-3', wpm: fast, accuracy: 1, promoted: false,
    })),
  };

  // "Not now" is a real answer and is remembered; asking again after every good
  // session is imposition in a politer voice.
  assert.equal(shouldOfferGilding(withGildOffered(earned), tuning), false);
  // And a player already gilding is never asked.
  assert.equal(shouldOfferGilding(setGilding(earned, true), tuning), false);
});

// --- the first run ----------------------------------------------------------

test('a brand new record owes the opening screen; every stored one does not', () => {
  assert.equal(DEFAULT_PROGRESS.firstRun, true);
  assert.deepEqual([...DEFAULT_PROGRESS.notesSeen], []);

  // The version does not matter: a record that exists is a record somebody has
  // been playing, whatever schema it was written under.
  for (const stored of [V2_RECORD, { ...V2_RECORD, version: V3_VERSION, gilding: true }]) {
    const migrated = migrate(stored);
    assert.equal(migrated.firstRun, false);
    assert.deepEqual([...migrated.notesSeen], [...NOTE_ORDER]);
  }
});

test('A VERSION 3 RECORD MIGRATES WITH EVERYTHING IT EARNED, AND SEES NO FIRST RUN', () => {
  // A whole player, one schema behind: history, lifetime statistics, the
  // trailing window, the bookmark, both settings.
  const v3 = { ...V2_RECORD, version: V3_VERSION, gilding: true, gildOffered: true };
  const migrated = migrate(v3);

  assert.equal(migrated.version, SCHEMA_VERSION);
  assert.notEqual(SCHEMA_VERSION, V3_VERSION);
  assert.equal(migrated.stage, V1_STAGE);
  assert.equal(migrated.translation, 'KJV');
  assert.equal(migrated.route, 'pilgrimage');
  assert.equal(migrated.layout, 'iso');
  assert.equal(migrated.spaceThumb, 'lt');
  assert.deepEqual(migrated.position, { book: 'Psalms', chapter: 23, unit: 4 }); // tuning-exempt: fixture
  assert.deepEqual(migrated.completed, ['Genesis 1']);
  assert.equal(migrated.keyStats['a']?.hits, V1_HITS);
  assert.equal(migrated.keyStats['a']?.errors, V1_ERRORS);
  assert.equal(migrated.recent['a']?.length, 2);   // tuning-exempt: two attempts in the fixture
  assert.equal(migrated.history.length, 1);
  assert.equal(migrated.history[0]?.wpm, V1_WPM);
  assert.equal(migrated.history[0]?.promoted, true);
  assert.equal(migrated.gilding, true);
  assert.equal(migrated.gildOffered, true);

  // And the game says nothing to him it has not said before.
  assert.equal(migrated.firstRun, false);
  assert.deepEqual([...migrated.notesSeen], [...NOTE_ORDER]);
});

test('the opening screen does not come back once it has been dismissed', () => {
  const done = withOpeningSeen(DEFAULT_PROGRESS);
  assert.equal(done.firstRun, false);
  assert.equal(withOpeningSeen(done), done, 'dismissing twice made a new record');

  const reloaded = migrate(JSON.parse(JSON.stringify(done)) as unknown);
  assert.equal(reloaded.firstRun, false, 'a reload put the opening screen back');
  assert.deepEqual(reloaded, done, 'the record did not round-trip');
});

test('the notes survive a reload, and nothing else moves when one is spent', () => {
  const played = play(withPosition(DEFAULT_PROGRESS, SOMEWHERE), stat(perKey, 1, fastMs));
  const spent = withNotesSeen(played, ['space', 'greyed']);

  assert.deepEqual([...spent.notesSeen], ['greyed', 'space'], 'the order is canonical');
  assert.deepEqual({ ...spent, notesSeen: played.notesSeen }, played, 'a note moved something else');

  const reloaded = migrate(JSON.parse(JSON.stringify(spent)) as unknown);
  assert.deepEqual(reloaded, spent, 'the record did not round-trip');
});

test('replaying from the menu re-arms it, and then it stays dismissed again', () => {
  const played = withNotesSeen(withOpeningSeen(DEFAULT_PROGRESS), NOTE_ORDER);
  const again = replayFirstRun(played);
  assert.equal(again.firstRun, true);
  assert.deepEqual([...again.notesSeen], [], 'the friend has not met a dim letter either');

  // It is a replay, not a reset: nothing the player earned moves.
  const earned = replayFirstRun(play(DEFAULT_PROGRESS, stat(perKey, 1, fastMs)));
  const before = play(DEFAULT_PROGRESS, stat(perKey, 1, fastMs));
  assert.equal(earned.stage, before.stage);
  assert.deepEqual(earned.keyStats, before.keyStats);
  assert.deepEqual(earned.recent, before.recent);
  assert.deepEqual(earned.history, before.history);
  assert.deepEqual(earned.position, before.position);

  // And once it has been read again it goes away again, permanently.
  const done = withNotesSeen(withOpeningSeen(again), NOTE_ORDER);
  assert.equal(migrate(JSON.parse(JSON.stringify(done)) as unknown).firstRun, false);
  assert.deepEqual([...migrate(JSON.parse(JSON.stringify(done)) as unknown).notesSeen], [...NOTE_ORDER]);
});

// --- the secret rooms -------------------------------------------------------

test('A VERSION 4 RECORD MIGRATES WITH EVERYTHING IT EARNED, AND HAS FOUND NO ROOMS', () => {
  // A whole player one schema behind, now including the first run they have
  // already seen. Nothing they earned may move, and the one new field is empty
  // rather than guessed: nothing recorded a found room before it existed.
  const v4 = {
    ...V2_RECORD,
    version: SCHEMA_VERSION - 1,
    gilding: true,
    gildOffered: true,
    firstRun: false,
    notesSeen: [...NOTE_ORDER],
  };
  const migrated = migrate(v4);

  assert.equal(migrated.version, SCHEMA_VERSION);
  assert.equal(migrated.stage, V1_STAGE);
  assert.deepEqual(migrated.completed, ['Genesis 1']);
  assert.equal(migrated.keyStats['a']?.hits, V1_HITS);
  assert.equal(migrated.history.length, 1);
  assert.equal(migrated.gilding, true);
  assert.equal(migrated.firstRun, false);
  assert.deepEqual([...migrated.notesSeen], [...NOTE_ORDER]);
  assert.deepEqual([...migrated.discovered], [], 'a room was invented from nothing');
});

test('a found room stays found, across a reload and across walking back out of it', () => {
  assert.deepEqual([...DEFAULT_PROGRESS.discovered], []);
  const found = withDiscovered(DEFAULT_PROGRESS, 'Genesis 22');
  assert.deepEqual([...found.discovered], ['Genesis 22']);

  // Idempotent: finding it twice is finding it once.
  assert.equal(withDiscovered(found, 'Genesis 22'), found, 'a second visit made a new record');

  // And it survives the cheapest way there is to lose a room.
  const reloaded = migrate(JSON.parse(JSON.stringify(found)) as unknown);
  assert.deepEqual(reloaded, found, 'the record did not round-trip');

  // It moves nothing else at all.
  assert.deepEqual({ ...found, discovered: DEFAULT_PROGRESS.discovered }, DEFAULT_PROGRESS);
});
