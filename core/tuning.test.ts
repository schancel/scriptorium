/**
 * @doc docs/design/07-tuning.md#tuning
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadTuning, tuningValue } from './tuning.js';

/** Read a real data file, whether the tests run from build/ or from source. */
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

test('loadTuning flattens every value in the real tuning file', () => {
  const raw = loadDataFile('tuning.json') as { values: Record<string, number> };
  const tuning = loadTuning(raw);
  const names = Object.keys(raw.values);
  assert.ok(names.length > 0);
  for (const name of names) {
    assert.equal(tuningValue(tuning, name), raw.values[name]);
  }
});

test('a missing key throws rather than yielding undefined', () => {
  const tuning = loadTuning(loadDataFile('tuning.json'));
  assert.throws(() => tuningValue(tuning, 'no_such_tunable'));
  assert.throws(() => tuning['no_such_tunable']);
  assert.throws(() => tuningValue({}, 'gate_accuracy'));
});

test('host machinery is not mistaken for a tunable', () => {
  const tuning = loadTuning(loadDataFile('tuning.json'));
  assert.doesNotThrow(() => JSON.stringify(tuning));
  assert.doesNotThrow(() => Object.keys(tuning));
  assert.doesNotThrow(() => String(tuning));
});

test('a malformed tuning file is a load error, not a NaN downstream', () => {
  assert.throws(() => loadTuning(null));
  assert.throws(() => loadTuning('nope'));
  assert.throws(() => loadTuning({}));
  assert.throws(() => loadTuning({ values: { gate_accuracy: 'fast' } }));
  assert.throws(() => loadTuning({ values: { gate_accuracy: Number.NaN } }));
});
