/**
 * The one generator, and the property that makes it worth having.
 *
 * @doc docs/architecture/core-purity.md#the-injected-seams
 *
 * Determinism is the whole point: same seed, same run. A generator with a hidden
 * cursor would pass a "different values" test just as well and fail the only
 * test that matters, which is that a replayed state produces a replayed value.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { draws, seedFrom, splitmix32 } from './rng.js';
import { splitmix32 as fromItems } from './items.js';

const RUN = 512; // tuning-exempt: test fixture, the length of the sampled stream

test('a draw is a pure function of its state', () => {
  assert.deepEqual(splitmix32(0), splitmix32(0));
  assert.deepEqual(splitmix32(-1), splitmix32(-1));
  assert.notDeepEqual(splitmix32(0), splitmix32(1));
});

test('every value lands in [0, 1) and the stream does not stall', () => {
  const seen = new Set<number>();
  let state = seedFrom('Genesis 1');
  for (let i = 0; i < RUN; i += 1) {
    const draw = splitmix32(state);
    assert.ok(draw.value >= 0 && draw.value < 1, `value ${String(draw.value)} is outside [0, 1)`);
    seen.add(draw.value);
    state = draw.state;
  }
  assert.equal(seen.size, RUN, 'the generator repeated itself inside one short run');
});

test('the same reference always seeds the same level', () => {
  assert.equal(seedFrom('Genesis 1 0'), seedFrom('Genesis 1 0'));
  assert.notEqual(seedFrom('Genesis 1 0'), seedFrom('Genesis 1 1'));
  assert.notEqual(seedFrom('Genesis 1 0'), seedFrom('John 1 0'));
  assert.ok(Number.isInteger(seedFrom('')), 'an empty citation is still a seed');
});

test('draws is exactly the stream a caller would have threaded by hand', () => {
  const seed = seedFrom('Exodus 14');
  const bulk = draws(seed, RUN);
  const byHand: number[] = [];
  let state = seed;
  for (let i = 0; i < RUN; i += 1) {
    const draw = splitmix32(state);
    byHand.push(draw.value);
    state = draw.state;
  }
  assert.deepEqual(bulk, byHand);
  assert.deepEqual(draws(seed, 0), []);
});

test('core/items.ts draws from this generator and not from a copy of it', () => {
  // Two generators seeded alike would look identical in every test and diverge
  // the first time one of them was touched. They must be the same function.
  assert.equal(fromItems, splitmix32);
});
