/**
 * Every documented item does something.
 *
 * @doc docs/design/03-pacing.md#items
 *
 * The pacing table is compiled into `data/items.json`, so the file is the
 * canonical list and this test reads it rather than a copy. An item that reaches
 * the table without reaching the code is the failure mode docs-as-source-of-truth
 * invites, and it is the first thing asserted here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDamage, maxHearts } from './damage.js';
import {
  ITEM_IDS,
  QUILL_UPGRADES,
  applyItem,
  awardsInkPot,
  awardsWaxSeal,
  createPlayer,
  isItemId,
  loadItems,
  offersBonusWord,
  splitmix32,
  type ItemId,
  type PickupSite,
  type Random,
} from './items.js';
import { idleThresholdMs } from './entities.js';
import { smudgePerError } from './damage.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { Tuning } from './types.js';

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

const TUNING: Tuning = loadTuning(loadDataFile('tuning.json'));
const SITE: PickupSite = { ref: 'Genesis 1', unit: 5, unitCount: 31 };   // tuning-exempt: test fixture, not a game tunable

function player() {
  return createPlayer(createDamage(TUNING));
}

test('every item in data/items.json has an implementation', () => {
  const docs = loadItems(loadDataFile('items.json'));
  assert.ok(docs.length > 0);
  for (const doc of docs) {
    assert.ok(isItemId(doc.id), `"${doc.id}" is documented but not implemented`);
    // And it must actually do something when picked up. The player is a heart
    // down, because an ink pot at full health is correctly a no-op.
    const before = createPlayer({ hearts: 1, smudge: 0, combo: 0 });
    const after = applyItem(before, doc.id as ItemId, SITE, TUNING).player;
    assert.notDeepEqual(after, before, `picking up "${doc.id}" changed nothing`);
  }
  // Nothing implemented is missing from the table either.
  const documented = new Set(docs.map((d) => d.id));
  for (const id of ITEM_IDS) {
    assert.ok(documented.has(id), `"${id}" is implemented but not in docs/design/03-pacing.md`);
  }
});

test('a documented item with no implementation is a loud failure, not a shrug', () => {
  assert.throws(
    () => loadItems({ items: [{ id: 'holy_hand_grenade', name: 'x', effect: 'y', source: 'z' }] }),
    /not implemented/,
  );
  assert.throws(() => loadItems({}), /"items" array/);
  assert.throws(() => loadItems({ items: [{ id: 'candle' }] }), /is not a string/);
});

// --- the effects ------------------------------------------------------------

test('an ink pot restores one heart, and only up to the cap', () => {
  const hurt = createPlayer({ hearts: 1, smudge: 0, combo: 0 });
  assert.equal(applyItem(hurt, 'ink_pot', SITE, TUNING).player.damage.hearts, 2);
  const full = player();
  assert.equal(applyItem(full, 'ink_pot', SITE, TUNING).player.damage.hearts, full.damage.hearts);
});

test('a candle is a checkpoint at the chunk boundary core/corpus.ts already cut', () => {
  const lit = applyItem(player(), 'candle', SITE, TUNING).player;
  assert.ok(lit.checkpoint !== null);
  assert.equal(lit.checkpoint.ref, 'Genesis 1');
  assert.equal(lit.checkpoint.chunkIndex, 1);
  assert.equal(lit.checkpoint.unit, 4, 'a candle must stand where the save point is');   // tuning-exempt: test fixture, not a game tunable
});

test('gold leaf adds a multiple rather than doubling', () => {
  let p = player();
  assert.equal(p.scoreMultiplier, 1);
  p = applyItem(p, 'gold_leaf', SITE, TUNING).player;
  assert.equal(p.scoreMultiplier, 2);
  p = applyItem(p, 'gold_leaf', SITE, TUNING).player;
  assert.equal(p.scoreMultiplier, 3, 'a lucky level must not make every other level meaningless');   // tuning-exempt: test fixture, not a game tunable
});

test('a quill nib rolls one of the three documented upgrades, deterministically', () => {
  // Same seed, same nib: a replay that rolled differently would be no replay.
  const seeded = (state: number) => createPlayer(createDamage(TUNING), state);
  for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {   // tuning-exempt: test fixture, not a game tunable
    const first = applyItem(seeded(seed), 'quill_nib', SITE, TUNING);
    const again = applyItem(seeded(seed), 'quill_nib', SITE, TUNING);
    assert.deepEqual(first, again);
    assert.ok(first.upgrade !== null && QUILL_UPGRADES.includes(first.upgrade));
    assert.notEqual(first.player.rngState, seed, 'the draw must advance the PRNG state');
  }
  // Over many seeds all three appear; none is unreachable.
  const seen = new Set<string>();
  let state = 1;
  for (let i = 0; i < 200; i++) {   // tuning-exempt: test fixture, not a game tunable
    const result = applyItem(seeded(state), 'quill_nib', SITE, TUNING);
    if (result.upgrade !== null) seen.add(result.upgrade);
    state = result.player.rngState;
  }
  assert.deepEqual([...seen].sort(), [...QUILL_UPGRADES].sort());
});

test('each quill nib is worth exactly one stage of the curve it softens', () => {
  const fixed = (value: number): Random => (state: number) => ({ value, state: state + 1 });
  const nib = (which: number) => applyItem(player(), 'quill_nib', SITE, TUNING, fixed(which)).player;

  const heart = nib(0);
  assert.equal(heart.upgrades.heart, 1);
  assert.equal(heart.damage.hearts, maxHearts(TUNING, 1), 'an empty extra heart is not a reward');

  const cloud = nib(0.5);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(cloud.upgrades.cloud, 1);
  assert.equal(idleThresholdMs(3, TUNING, cloud.upgrades.cloud), idleThresholdMs(2, TUNING));   // tuning-exempt: test fixture, not a game tunable

  const smudge = nib(0.9);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(smudge.upgrades.smudge, 1);
  assert.equal(smudgePerError(3, TUNING, smudge.upgrades.smudge), smudgePerError(2, TUNING));   // tuning-exempt: test fixture, not a game tunable
});

test('a wax seal unlocks the chapter once, however many times it is awarded', () => {
  let p = applyItem(player(), 'wax_seal', SITE, TUNING).player;
  assert.deepEqual(p.seals, ['Genesis 1']);
  p = applyItem(p, 'wax_seal', SITE, TUNING).player;
  assert.deepEqual(p.seals, ['Genesis 1']);
  p = applyItem(p, 'wax_seal', { ...SITE, ref: 'John 1' }, TUNING).player;
  assert.deepEqual(p.seals, ['Genesis 1', 'John 1']);
});

test('a pickup never mutates the state it was handed', () => {
  const before = player();
  const snapshot = structuredClone(before);
  for (const id of ITEM_IDS) applyItem(before, id, SITE, TUNING);
  assert.deepEqual(before, snapshot);
});

// --- where items come from --------------------------------------------------

test('an ink pot drops on a clean candle-to-candle run', () => {
  const interval = tuningValue(TUNING, 'candle_interval');
  assert.equal(awardsInkPot(0, TUNING), false);
  assert.equal(awardsInkPot(interval - 1, TUNING), false);
  assert.equal(awardsInkPot(interval, TUNING), true);
  assert.equal(awardsInkPot(interval * 2, TUNING), true);
});

test('a wax seal needs a genuinely perfect chapter', () => {
  assert.equal(awardsWaxSeal(0, 0), true);
  assert.equal(awardsWaxSeal(0, 1), false);
  assert.equal(awardsWaxSeal(1, 0), false);
});

test('bonus words appear at the documented rate, from the injected PRNG', () => {
  const chance = tuningValue(TUNING, 'bonus_word_chance');
  let state = 1;
  let offered = 0;
  const trials = 4000; // tuning-exempt: the size of the simulated sample
  for (let i = 0; i < trials; i++) {
    const roll = offersBonusWord(state, TUNING);
    state = roll.state;
    if (roll.offered) offered += 1;
  }
  const rate = offered / trials;
  assert.ok(Math.abs(rate - chance) < 0.02, `bonus words offered at ${String(rate)}, not ${String(chance)}`);   // tuning-exempt: test fixture, not a game tunable
});

test('the PRNG is uniform, deterministic and never leaves [0, 1)', () => {
  assert.deepEqual(splitmix32(1), splitmix32(1));
  assert.notDeepEqual(splitmix32(1), splitmix32(2));
  let state = 1;
  let sum = 0;
  const draws = 10000; // tuning-exempt: the size of the simulated sample
  const buckets = [0, 0, 0, 0];
  for (let i = 0; i < draws; i++) {
    const next = splitmix32(state);
    assert.ok(next.value >= 0 && next.value < 1);
    sum += next.value;
    const bucket = Math.floor(next.value * buckets.length);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    state = next.state;
  }
  assert.ok(Math.abs(sum / draws - 0.5) < 0.02, 'the PRNG is biased');   // tuning-exempt: test fixture, not a game tunable
  for (const count of buckets) assert.ok(Math.abs(count / draws - 0.25) < 0.02, 'the PRNG is lumpy');   // tuning-exempt: test fixture, not a game tunable
});
