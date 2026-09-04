/**
 * The report card: the table, the curve, and the one sentence.
 *
 * @doc docs/design/08-stats.md#the-report-card
 *
 * "The per-finger table is the point." Everything asserted here is about the
 * card being *readable as a diagnosis* rather than about it being drawn: that an
 * empty row says which kind of empty it is, that a finger being reached for is
 * detected from the one signal the game can honestly observe, that the curve
 * explains its own dips, and that the card asks for exactly one thing at a time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  nameKeys,
  reportAdvice,
  reportCard,
  reportNote,
  reportTrend,
  type GateView,
  type TrendPoint,
} from './draw.js';
import { DEFAULT_SPACE_THUMB, reportFingers } from './keyboard.js';
import { loadStages } from './curriculum.js';
import { DEFAULT_PROGRESS, gateProgress, type Progress } from './progress.js';
import { loadTuning } from './tuning.js';
import type { Key, KeyStat, Tuning } from './types.js';

function loadDataFile(name: string): unknown {
  const url = new URL(`../../data/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));
const stages = loadStages(loadDataFile('curriculum.json'));

/** Stage 1's key set, as the game would hand it to the card. */
const STAGE_1 = stages[1]?.keySet ?? [];

function stat(over: Partial<KeyStat>): KeyStat {
  return { hits: 0, errors: 0, totalMs: 0, latencies: [], confusions: {}, ...over };
}

const TWO_FINGER_STATS: Readonly<Record<Key, KeyStat>> = {
  f: stat({ hits: 9, errors: 1, totalMs: 900, confusions: { d: 1 } }), // tuning-exempt: test fixture
  j: stat({ hits: 4, errors: 4, totalMs: 800, confusions: { k: 3, h: 1 } }), // tuning-exempt: test fixture
};

// --- the table --------------------------------------------------------------

test('the report card shows every finger the game asks for, empty ones included', () => {
  const card = reportCard({ keyStats: TWO_FINGER_STATS, layout: 'ansi' }, tuning);
  assert.deepEqual(card.fingers.map((r) => r.finger), reportFingers(DEFAULT_SPACE_THUMB));
  assert.equal(new Set(card.fingers.map((r) => r.finger)).size, card.fingers.length);
  const idle = card.fingers.filter((r) => r.hits === 0);
  assert.ok(idle.length > 0, 'an unused finger must still get a row');
  assert.equal(card.worst[0]?.key, 'j');
  assert.equal(card.worst[0]?.confusedWith, 'k');
});

test('the card never prints a column for the thumb the player does not use', () => {
  // A permanently empty column is an artefact of the model, not a diagnosis of
  // the player -- and this table exists to diagnose the player.
  for (const thumb of ['lt', 'rt'] as const) {
    const card = reportCard(
      { keyStats: TWO_FINGER_STATS, layout: 'ansi', spaceThumb: thumb },
      tuning,
    );
    const shown = card.fingers.map((r) => r.finger);
    assert.ok(shown.includes(thumb));
    assert.ok(!shown.includes(thumb === 'lt' ? 'rt' : 'lt'), 'both thumbs on the card');
  }
});

test('space is credited to the thumb the player actually uses', () => {
  const stats: Readonly<Record<Key, KeyStat>> = {
    '<space>': stat({ hits: 8, totalMs: 800 }), // tuning-exempt: test fixture
  };
  for (const thumb of ['lt', 'rt'] as const) {
    const row = reportCard({ keyStats: stats, layout: 'ansi', spaceThumb: thumb }, tuning)
      .fingers.find((r) => r.finger === thumb);
    assert.equal(row?.hits, 8); // tuning-exempt: matches the fixture above
  }
});

test('AN EMPTY ROW SAYS WHICH KIND OF EMPTY IT IS', () => {
  // The whole reason the blank rows are legible rather than merely blank. At
  // stage 0 the curriculum has asked six fingers for nothing at all, and that
  // is a fact about the curriculum; a finger that has keys and has struck none
  // of them is a fact about the player, and the card must not print the two the
  // same way.
  const stage0 = stages[0]?.keySet ?? [];
  const early = reportCard(
    { keyStats: TWO_FINGER_STATS, layout: 'ansi', keySet: stage0 },
    tuning,
  );
  assert.ok(early.fingers.some((r) => r.untaught), 'stage 0 teaches only three fingers');
  assert.ok(early.fingers.every((r) => !(r.untaught && r.idle)), 'a row is one kind of empty');
  assert.equal(early.taught, early.fingers.filter((r) => !r.untaught).length);

  const later = reportCard(
    { keyStats: TWO_FINGER_STATS, layout: 'ansi', keySet: STAGE_1 },
    tuning,
  );
  assert.ok(later.taught > early.taught, 'a stage teaching more keys fills more rows in');
  const neglected = later.fingers.filter((r) => r.idle);
  assert.ok(neglected.length > 0, 'stage 1 gives every finger keys, and this fixture uses two');
  for (const row of neglected) {
    assert.ok(row.keys.length > 0, 'an idle row must be able to name the keys it owes');
  }
});

test('with no key set the card claims neither kind of empty', () => {
  // It declines to guess rather than printing "no keys at this stage" about a
  // finger it has not been told the keys of.
  const card = reportCard({ keyStats: TWO_FINGER_STATS, layout: 'ansi' }, tuning);
  assert.ok(card.fingers.every((r) => !r.untaught));
});

test('A FINGER BEING REACHED FOR IS FOUND FROM ITS LATENCY, NOT INVENTED', () => {
  // The one thing about technique this data can honestly show. The game never
  // learns which finger struck a key -- credit goes to the finger that *should*
  // have -- so the spread in mean latency is the signal, and a finger resting on
  // its home key cannot produce the spread a finger travelled to does.
  const even: Record<Key, KeyStat> = {};
  for (const key of ['a', 's', 'd', 'f', 'j', 'k', 'l', ';']) {
    even[key] = stat({ hits: 40, totalMs: 40 * 200 }); // tuning-exempt: test fixture
  }
  const level = reportCard({ keyStats: even, layout: 'ansi', keySet: STAGE_1 }, tuning);
  assert.equal(level.slowest, null, 'even hands are not a finding');
  assert.notEqual(level.quickest, null);

  // The same hands, except the pinkies are being reached for.
  const reaching: Record<Key, KeyStat> = { ...even };
  reaching['a'] = stat({ hits: 40, totalMs: 40 * 700 }); // tuning-exempt: test fixture
  const found = reportCard({ keyStats: reaching, layout: 'ansi', keySet: STAGE_1 }, tuning);
  assert.equal(found.slowest?.finger, 'lp');
  assert.ok(found.fingers.find((r) => r.finger === 'lp')?.reaching);
  assert.ok(!found.fingers.find((r) => r.finger === 'li')?.reaching);
});

test('one slow reach for a rare key cannot libel a finger', () => {
  const thin: Record<Key, KeyStat> = {};
  for (const key of ['f', 'j']) thin[key] = stat({ hits: 40, totalMs: 40 * 200 }); // tuning-exempt: test fixture
  thin['a'] = stat({ hits: 1, totalMs: 3000 }); // tuning-exempt: test fixture
  const card = reportCard({ keyStats: thin, layout: 'ansi', keySet: STAGE_1 }, tuning);
  assert.ok(!card.fingers.find((r) => r.finger === 'lp')?.reaching);
});

test('the quickest row handed back is the identical object the table draws', () => {
  // It was once found over the pre-flag rows, so the renderer's identity check
  // against it was false on every row of every card ever drawn -- and the only
  // symptom was a highlight that never appeared.
  const even: Record<Key, KeyStat> = {};
  for (const key of STAGE_1) even[key] = stat({ hits: 40, totalMs: 40 * 200 }); // tuning-exempt: test fixture
  const card = reportCard({ keyStats: even, layout: 'ansi', keySet: STAGE_1 }, tuning);
  assert.notEqual(card.quickest, null);
  assert.ok(card.fingers.includes(card.quickest as (typeof card.fingers)[number]));
});

test('the share column adds up to the whole hand', () => {
  const card = reportCard({ keyStats: TWO_FINGER_STATS, layout: 'ansi' }, tuning);
  const total = card.fingers.reduce((sum, row) => sum + row.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `shares summed to ${String(total)}`);  // tuning-exempt: test fixture
});

// --- the curve --------------------------------------------------------------

function part(wpm: number, promoted = false): TrendPoint {
  return { wpm, accuracy: 0.9, promoted }; // tuning-exempt: test fixture
}

test('the curve averages over everything and draws over a window', () => {
  const history = Array.from({ length: 60 }, (_, i) => part(i)); // tuning-exempt: test fixture
  const trend = reportTrend(history, tuning);
  assert.equal(trend.parts, history.length);
  assert.ok(trend.points.length < history.length, 'the chart is a window, not the record');
  assert.equal(trend.points[trend.points.length - 1]?.wpm, 59); // tuning-exempt: matches the fixture
  const mean = history.reduce((s, p) => s + p.wpm, 0) / history.length;
  assert.ok(Math.abs(trend.avgWpm - mean) < 1e-9, 'the running average is over the record');  // tuning-exempt: test fixture
  assert.equal(trend.bestWpm, 59); // tuning-exempt: matches the fixture
});

test('THE DIP AFTER A PROMOTION IS EXPLAINED, NOT LEFT TO LOOK LIKE REGRESSION', () => {
  // docs/design/08-stats.md#history: an unexplained drop is the single most
  // likely reason a beginner concludes the game is not working, so it is said
  // twice -- at the promotion, and here beside the marked session.
  const card = reportCard({ keyStats: TWO_FINGER_STATS, layout: 'ansi' }, tuning);
  const promoted = reportTrend([part(20), part(24), part(26, true)], tuning);  // tuning-exempt: test fixture
  assert.ok(promoted.justPromoted);
  const note = reportNote(card, promoted);
  assert.match(note, /stage opening/);
  assert.match(note, /curriculum, not you/);
  assert.ok(!note.includes('!'), 'no exclamation marks anywhere on this card');

  const quiet = reportTrend([part(20), part(24)], tuning);  // tuning-exempt: test fixture
  assert.ok(!quiet.justPromoted);
  assert.notEqual(reportNote(card, quiet), note);
});

test('the note leads with the spread when there is one, and never lists', () => {
  const reaching: Record<Key, KeyStat> = {};
  for (const key of ['a', 's', 'd', 'f', 'j', 'k', 'l', ';']) {
    reaching[key] = stat({ hits: 40, totalMs: 40 * 200 }); // tuning-exempt: test fixture
  }
  reaching['a'] = stat({ hits: 40, totalMs: 40 * 700 }); // tuning-exempt: test fixture
  const card = reportCard({ keyStats: reaching, layout: 'ansi', keySet: STAGE_1 }, tuning);
  const note = reportNote(card, reportTrend([part(20)], tuning));  // tuning-exempt: test fixture
  assert.match(note, /L pinky/);
  assert.match(note, /reaching for a key/);
});

// --- the one thing to do next -----------------------------------------------

const NO_GATE: GateView | undefined = undefined;

function gateFor(progress: Progress): GateView {
  const standing = gateProgress(progress, stages, tuning);
  return {
    stage: standing.stage.stage,
    newKeys: standing.stage.keys,
    passed: standing.gate.passed,
    accuracyMet: standing.gate.accuracyMet,
    latencyMet: standing.gate.latencyMet,
    samples: standing.gate.samples,
    accuracy: standing.accuracy,
    medianMs: standing.medianMs,
    requiredAccuracy: standing.requiredAccuracy,
    allowedLatencyMs: standing.allowedLatencyMs,
    requiredSamples: standing.requiredSamples,
  };
}

test('THE ADVICE IS ONE THING, DERIVED FROM THE DATA, IN THE GAME’S OWN VOICE', () => {
  const card = reportCard({ keyStats: TWO_FINGER_STATS, layout: 'ansi' }, tuning);
  const line = reportAdvice(card, NO_GATE, tuning);
  assert.ok(!line.includes('!'), 'no exclamation marks');
  assert.ok(!/\bgreat\b|\bwell done\b|\bnice\b/i.test(line), 'no praise for trivia');
  assert.equal(line.split('Next:').length - 1, 1, 'one instruction, not a list');
});

test('a key missed often enough is named, with what was struck instead', () => {
  const stats: Readonly<Record<Key, KeyStat>> = {
    ';': stat({ hits: 20, errors: 10, totalMs: 4000, confusions: { l: 8 } }), // tuning-exempt: test fixture
    f: stat({ hits: 200, errors: 1, totalMs: 40000 }), // tuning-exempt: test fixture
  };
  const card = reportCard({ keyStats: stats, layout: 'ansi', keySet: STAGE_1 }, tuning);
  const line = reportAdvice(card, NO_GATE, tuning);
  assert.match(line, /the ; key/);
  assert.match(line, /33% of the time/);  // tuning-exempt: test fixture
  assert.match(line, /striking l instead/);
});

test('a key with too few attempts behind it is not named', () => {
  const stats: Readonly<Record<Key, KeyStat>> = {
    ';': stat({ hits: 1, errors: 1, totalMs: 200, confusions: { l: 1 } }), // tuning-exempt: test fixture
  };
  const card = reportCard({ keyStats: stats, layout: 'ansi', keySet: STAGE_1 }, tuning);
  assert.ok(!reportAdvice(card, NO_GATE, tuning).includes('the ; key'));
});

test('with clean keys the advice falls through to the gate, and says the number', () => {
  const clean: Record<Key, KeyStat> = {};
  for (const key of STAGE_1) {
    clean[key] = stat({ hits: 40, totalMs: 40 * 200 }); // tuning-exempt: test fixture
  }
  const card = reportCard({ keyStats: clean, layout: 'ansi', keySet: STAGE_1 }, tuning);
  const line = reportAdvice(card, gateFor(DEFAULT_PROGRESS), tuning);
  assert.match(line, /^Next: more of /, line);
  assert.match(line, /more keystrokes on them before the stage can open/);
});

test('the gate line quotes the standard it is measured against', () => {
  // "91% and the stage opens at 95%" is a thing a player can act on. "Not yet"
  // is not, and the card must never be reduced to it.
  const standing = gateProgress(DEFAULT_PROGRESS, stages, tuning);
  assert.equal(standing.requiredAccuracy, tuning['gate_accuracy']);
  assert.equal(standing.requiredSamples, tuning['gate_window']);
  assert.ok(standing.allowedLatencyMs > 0);
});

test('THE QUOTED LATENCY ALLOWANCE IS THE ONE THE GATE ACTUALLY USES', () => {
  // `gateProgress` restates the allowance so the card can print it. This pins
  // the restatement to `evaluateGate`: a median exactly at the quoted number
  // passes, and one a millisecond above it does not.
  const stage = stages[1];
  assert.ok(stage !== undefined);
  const allowed = gateProgress({ ...DEFAULT_PROGRESS, stage: stage.stage }, stages, tuning)
    .allowedLatencyMs;
  const window = Math.trunc(tuning['gate_window'] ?? 0);
  const attempts = (ms: number) =>
    Array.from({ length: window }, () => ({ ok: true, ms }));
  const at: Progress = {
    ...DEFAULT_PROGRESS,
    stage: stage.stage,
    recent: Object.fromEntries(stage.keys.map((k) => [k, attempts(allowed)])),
  };
  const over: Progress = {
    ...DEFAULT_PROGRESS,
    stage: stage.stage,
    recent: Object.fromEntries(stage.keys.map((k) => [k, attempts(allowed + 1)])),
  };
  assert.ok(gateProgress(at, stages, tuning).gate.latencyMet, 'exactly at the quoted number');
  assert.ok(!gateProgress(over, stages, tuning).gate.latencyMet, 'one millisecond over');
});

test('keys are named the way a player reads them aloud', () => {
  assert.equal(nameKeys(['e']), 'e');
  assert.equal(nameKeys(['e', 'i']), 'e and i');
  assert.equal(nameKeys(['c', 'm', 'w']), 'c, m and w');
  assert.equal(nameKeys(['<space>']), 'space');
  assert.equal(nameKeys([]), '');
});
