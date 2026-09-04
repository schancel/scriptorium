/**
 * @doc docs/design/06-curriculum.md#the-mastery-gate
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Key, KeyStat, Stage, Tuning } from './types.js';
import { evaluateGate, keySetFor, loadStages, stageAt } from './curriculum.js';
import { loadTuning, tuningValue } from './tuning.js';

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

/** A synthetic keystroke stream, as the gate sees it. */
function stream(hits: number, errors: number, latencyMs: number): KeyStat {
  return {
    hits,
    errors,
    totalMs: latencyMs * hits,
    latencies: new Array<number>(hits).fill(latencyMs),
    confusions: {},
  };
}

function statsFor(stage: Stage, stat: KeyStat): Record<Key, KeyStat> {
  const out: Record<Key, KeyStat> = {};
  for (const key of stage.keys) out[key] = stat;
  return out;
}

test('loadStages parses the real curriculum and derives cumulative key sets', () => {
  const raw = loadDataFile('curriculum.json') as { stages: unknown[] };
  assert.equal(stages.length, raw.stages.length);
  for (const [index, stage] of stages.entries()) {
    const previous = stages[index - 1];
    if (previous === undefined) continue;
    const before = new Set(previous.keySet);
    const now = new Set(stage.keySet);
    for (const key of before) assert.ok(now.has(key), `stage ${stage.stage} dropped "${key}"`);
    for (const key of stage.keys) assert.ok(now.has(key));
  }
});

test('a curriculum whose key sets are not cumulative fails to load', () => {
  assert.throws(() => loadStages(null));
  assert.throws(() => loadStages({}));
  assert.throws(() =>
    loadStages({
      stages: [
        { stage: 0, keys: ['f'], keySet: ['f'], predictedCoverage: 0, description: 'anchor' },
        { stage: 1, keys: ['j'], keySet: ['j'], predictedCoverage: 0, description: 'drops f' },
      ],
    }),
  );
  assert.throws(() =>
    loadStages({
      stages: [
        { stage: 1, keys: ['f'], keySet: ['f'], predictedCoverage: 0, description: 'ok' },
        { stage: 0, keys: ['j'], keySet: ['f', 'j'], predictedCoverage: 0, description: 'goes back' },
      ],
    }),
  );
});

test('stageAt finds a stage by number and clamps outside the range', () => {
  const first = stages[0];
  const last = stages[stages.length - 1];
  assert.ok(first !== undefined && last !== undefined);
  assert.equal(stageAt(stages, first.stage).stage, first.stage);
  assert.equal(stageAt(stages, last.stage).stage, last.stage);
  assert.equal(stageAt(stages, -1).stage, first.stage);
  assert.equal(stageAt(stages, stages.length).stage, last.stage);
});

test('keySetFor is cumulative through the given stage', () => {
  const zero = keySetFor(stages, 0);
  assert.ok(zero.has('f') && zero.has('j') && zero.has('<space>'));
  assert.ok(!zero.has('a'));
  const one = keySetFor(stages, 1);
  for (const key of zero) assert.ok(one.has(key));
  assert.ok(one.has('a') && one.has(';'));
  assert.ok(!one.has('e'));
  // Mutating the returned set must not disturb the loaded stages.
  one.add('zzz');
  assert.ok(!keySetFor(stages, 1).has('zzz'));
});

test('THE MASTERY GATE: slow-but-accurate does not pass', () => {
  const stage = stageAt(stages, 2);
  const enough = tuningValue(tuning, 'gate_window');
  const fastMs = tuningValue(tuning, 'gate_latency_floor_ms');
  const slowMs = tuningValue(tuning, 'gate_latency_base_ms');

  const perfect = evaluateGate(stage, statsFor(stage, stream(enough, 0, fastMs)), tuning);
  assert.equal(perfect.accuracyMet, true);
  assert.equal(perfect.latencyMet, true);
  assert.equal(perfect.passed, true);

  const sloppy = evaluateGate(stage, statsFor(stage, stream(enough, enough, fastMs)), tuning);
  assert.equal(sloppy.accuracyMet, false);
  assert.equal(sloppy.latencyMet, true);
  assert.equal(sloppy.passed, false);

  // The hunt-and-peck signature: every key eventually correct, none of them
  // struck from muscle memory. This is the one the gate exists to catch.
  const huntAndPeck = evaluateGate(stage, statsFor(stage, stream(enough, 0, slowMs)), tuning);
  assert.equal(huntAndPeck.accuracyMet, true);
  assert.equal(huntAndPeck.latencyMet, false);
  assert.equal(huntAndPeck.passed, false);
});

test('the latency allowance tightens stage by stage', () => {
  const base = tuningValue(tuning, 'gate_latency_base_ms');
  const step = tuningValue(tuning, 'gate_latency_step_ms');
  const floor = tuningValue(tuning, 'gate_latency_floor_ms');
  const enough = tuningValue(tuning, 'gate_window');

  // A median exactly at the stage-0 allowance passes there and nowhere later.
  const early = stageAt(stages, 0);
  const later = stageAt(stages, 2);
  const stat = stream(enough, 0, base);
  assert.equal(evaluateGate(early, statsFor(early, stat), tuning).latencyMet, true);
  assert.equal(evaluateGate(later, statsFor(later, stat), tuning).latencyMet, false);

  // The allowance never drops below the floor, even at the last stage.
  const last = stageAt(stages, stages.length - 1);
  const allowance = Math.max(floor, base - last.stage * step);
  assert.ok(allowance >= floor);
  const atFloor = stream(enough, 0, allowance);
  assert.equal(evaluateGate(last, statsFor(last, atFloor), tuning).latencyMet, true);
});

test('the gate stays shut until the window has been filled', () => {
  const stage = stageAt(stages, 2);
  const fastMs = tuningValue(tuning, 'gate_latency_floor_ms');
  const thin = evaluateGate(stage, statsFor(stage, stream(1, 0, fastMs)), tuning);
  assert.equal(thin.accuracyMet, true);
  assert.equal(thin.latencyMet, true);
  assert.equal(thin.passed, false);
  assert.ok(thin.samples < tuningValue(tuning, 'gate_window'));
});

test('the gate ignores keys the stage did not introduce', () => {
  const stage = stageAt(stages, 2);
  const enough = tuningValue(tuning, 'gate_window');
  const fastMs = tuningValue(tuning, 'gate_latency_floor_ms');
  const slowMs = tuningValue(tuning, 'gate_latency_base_ms');
  const stats: Record<Key, KeyStat> = {
    ...statsFor(stage, stream(enough, 0, fastMs)),
    // Old keys, typed badly. They are already mastered; they are not the test.
    f: stream(enough, enough, slowMs),
    j: stream(enough, enough, slowMs),
  };
  const result = evaluateGate(stage, stats, tuning);
  assert.equal(result.passed, true);
  assert.equal(result.samples, enough * stage.keys.length);
});

test('an empty record cannot pass the gate', () => {
  const stage = stageAt(stages, 2);
  const result = evaluateGate(stage, {}, tuning);
  assert.equal(result.samples, 0);
  assert.equal(result.accuracyMet, false);
  assert.equal(result.latencyMet, false);
  assert.equal(result.passed, false);
});
