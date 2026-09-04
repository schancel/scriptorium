/**
 * A beginner must not be killed by his own error rate.
 *
 * @doc docs/design/03-pacing.md#damage-is-metered
 *
 * docs/decisions/0005-smudge-meter-over-per-typo-damage.md rejects a heart per
 * typo on arithmetic: one keystroke in ten is wrong for the player this game is
 * for, and three hearts against 10% error is four deaths a verse. The pacing doc
 * calls a meter that kills him repeatedly a quit-the-game bug, so the survival
 * of a simulated 90%-accuracy beginner across a whole chapter is asserted here
 * rather than reasoned about.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  addSmudge,
  applyCloudStrike,
  applyCorrect,
  applyError,
  candleUnits,
  createDamage,
  isCandleUnit,
  isDead,
  lightCandle,
  maxHearts,
  respawn,
  restoreHeart,
  smudgeFraction,
  smudgePerError,
} from './damage.js';
import { createCloud, idleThresholdMs, stepCloud } from './entities.js';
import { splitmix32 } from './items.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { DamageState, Tuning } from './types.js';

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
const MAX = tuningValue(TUNING, 'smudge_max');

// --- the rule ---------------------------------------------------------------

test('a full meter costs exactly one heart and empties', () => {
  const start = createDamage(TUNING);
  assert.equal(start.hearts, tuningValue(TUNING, 'hearts_start'));
  assert.equal(start.smudge, 0);

  const justShort = addSmudge(start, MAX - 1, TUNING);
  assert.equal(justShort.heartsLost, 0);
  assert.equal(justShort.damage.hearts, start.hearts);
  assert.equal(justShort.damage.smudge, MAX - 1);

  const filled = addSmudge(justShort.damage, 1, TUNING);
  assert.equal(filled.heartsLost, 1, 'a full meter must cost exactly one heart');
  assert.equal(filled.damage.hearts, start.hearts - 1);
  assert.equal(filled.damage.smudge, 0, 'the meter resets');
});

test('a typo alone never costs a heart, at any stage', () => {
  for (let stage = 0; stage < 10; stage++) {   // tuning-exempt: test fixture, not a game tunable
    const one = applyError(createDamage(TUNING), stage, TUNING);
    assert.equal(one.heartsLost, 0, `stage ${String(stage)} killed on a single typo`);
    assert.ok(smudgePerError(stage, TUNING) < MAX);
  }
});

test('errors cost more by stage, and a quill nib buys one stage back', () => {
  const base = tuningValue(TUNING, 'smudge_per_error_base');
  const step = tuningValue(TUNING, 'smudge_per_error_step');
  assert.equal(smudgePerError(0, TUNING), base);
  assert.equal(smudgePerError(3, TUNING), base + step * 3);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(smudgePerError(3, TUNING, 1), smudgePerError(2, TUNING));   // tuning-exempt: test fixture, not a game tunable
  assert.ok(smudgePerError(0, TUNING, 5) >= 0, 'tolerance cannot go negative');   // tuning-exempt: test fixture, not a game tunable
});

test('clean typing wipes the page, and the combo tracks the streak', () => {
  const decay = tuningValue(TUNING, 'smudge_decay_per_key');
  let damage = applyError(createDamage(TUNING), 0, TUNING).damage;
  const dirtied = damage.smudge;
  assert.equal(damage.combo, 0, 'an error breaks the combo');
  damage = applyCorrect(damage, TUNING);
  assert.equal(damage.smudge, dirtied - decay);
  assert.equal(damage.combo, 1);
  // It never goes below empty.
  for (let i = 0; i < 100; i++) damage = applyCorrect(damage, TUNING);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(damage.smudge, 0);
  assert.equal(smudgeFraction(damage, TUNING), 0);
});

test('at stage 0 a 90%-accurate run drains the meter faster than it fills it', () => {
  // The arithmetic ADR 0005 turns on: one error (+12) against nine clean keys
  // (-18) is a net fall. Stated as a test so a tuning change that inverts it
  // fails here rather than in front of the player.
  let damage = createDamage(TUNING);
  for (let i = 0; i < 10; i++) {   // tuning-exempt: test fixture, not a game tunable
    damage = i === 0 ? applyError(damage, 0, TUNING).damage : applyCorrect(damage, TUNING);
  }
  assert.equal(damage.smudge, 0);
});

// --- the beginner -----------------------------------------------------------

/** Genesis 1, roughly: a chapter is 4400 characters and 20+ minutes for him. */
const CHAPTER_CHARS = 4400; // tuning-exempt: the length of the simulated chapter

/** Predicted live coverage per stage, from the real curriculum. */
const COVERAGE: readonly number[] = (
  loadDataFile('curriculum.json') as { stages: { predictedCoverage: number }[] }
).stages.map((s) => s.predictedCoverage);

/**
 * A beginner typing a chapter at a given accuracy.
 *
 * Three things make this a fair simulation rather than a flattering one.
 *
 * **Only live characters are typed.** A stage-0 player is asked for 21% of a
 * chapter and the rest is greyed and auto-advanced, so his chapter is ~900
 * keystrokes, not 4400. Simulating the full text would invent exposure the
 * illumination rule takes away.
 *
 * **Errors arrive in bursts.** Hunting for a key produces two or three wrong
 * strikes together, not one every tenth keystroke evenly spaced. Bursts are the
 * case that can actually fill the meter, so an even distribution would be
 * simulating the easy version. The run continues with probability 0.3 per wrong
 * key, which is what makes a third of stumbles longer than one.
 *
 * **He stops three times.** Long enough for the cloud to gather and drip, which
 * is the only other thing in the game that can cost him a heart.
 */
function typeAChapter(stage: number, stumbleChance: number, pauses: number, seed: number): {
  heartsLost: number; deaths: number; accuracy: number; strikes: number; keystrokes: number;
} {
  const live = Math.round(CHAPTER_CHARS * (COVERAGE[stage] ?? 1));
  let damage: DamageState = createDamage(TUNING);
  let rng = seed;
  let heartsLost = 0;
  let deaths = 0;
  let errors = 0;
  let correct = 0;
  let strikes = 0;
  const draw = (): number => {
    const next = splitmix32(rng);
    rng = next.state;
    return next.value;
  };
  const hurt = (result: { damage: DamageState; heartsLost: number }): void => {
    damage = result.damage;
    heartsLost += result.heartsLost;
    if (isDead(damage)) {
      deaths += 1;
      damage = createDamage(TUNING);
    }
  };

  const pauseEvery = pauses > 0 ? Math.floor(live / (pauses + 1)) : 0;
  for (let i = 0; i < live; i++) {
    if (draw() < stumbleChance) {
      do {
        errors += 1;
        hurt(applyError(damage, stage, TUNING));
      } while (draw() < 0.3);   // tuning-exempt: how often a stumble runs on, from the error model above
    }
    correct += 1;
    damage = applyCorrect(damage, TUNING);

    if (pauseEvery > 0 && i > 0 && i % pauseEvery === 0) {
      // He stops typing. The cloud gathers, telegraphs, and drips once.
      let cloud = createCloud();
      const frame = 16;        // tuning-exempt: a plausible frame time
      const silence = idleThresholdMs(stage, TUNING) + tuningValue(TUNING, 'cloud_approach_ms');
      for (let t = 0; t <= silence; t += frame) {
        const step = stepCloud(cloud, { stage, correctKey: false, enabled: true }, frame, TUNING);
        cloud = step.cloud;
        if (step.smudge > 0) {
          strikes += 1;
          hurt(applyCloudStrike(damage, step.smudge, TUNING));
        }
      }
    }
  }
  return { heartsLost, deaths, accuracy: correct / (correct + errors), strikes, keystrokes: correct };
}

/** Eight runs, so the claim is about the mechanic and not about one lucky seed. */
const SEEDS: readonly number[] = [1, 7, 42, 1234, 99991, 5, 13, 777];   // tuning-exempt: test fixture, not a game tunable

test('a 90%-accuracy beginner survives a whole chapter', () => {
  // This is the player the game is for, at the stage he spends his first weeks
  // in. docs/design/03-pacing.md calls a meter that kills him repeatedly a
  // quit-the-game bug, so it is a failing test rather than a note.
  for (const seed of SEEDS) {
    const run = typeAChapter(0, 0.077, 3, seed);   // tuning-exempt: test fixture, not a game tunable
    assert.ok(run.accuracy > 0.87 && run.accuracy < 0.93, `the simulated beginner typed at ${String(run.accuracy)}`);   // tuning-exempt: test fixture, not a game tunable
    assert.ok(run.strikes > 0, 'the pauses must actually have brought the cloud');
    assert.ok(
      run.heartsLost <= 2,
      `seed ${String(seed)} cost a 90%-accurate beginner ${String(run.heartsLost)} hearts in one chapter`,
    );
    assert.equal(run.deaths, 0, `seed ${String(seed)} killed a 90%-accurate beginner`);
  }
});

test('the same beginner is killed several times over by a heart per typo', () => {
  // The rejected design, priced. ADR 0005 rests on this arithmetic; if it ever
  // stops holding, the ADR needs revisiting rather than the code.
  const run = typeAChapter(0, 0.077, 0, 1);   // tuning-exempt: test fixture, not a game tunable
  const typos = Math.round(run.keystrokes / run.accuracy) - run.keystrokes;
  assert.ok(
    typos > tuningValue(TUNING, 'hearts_start') * 10,   // tuning-exempt: test fixture, not a game tunable
    `a heart per typo would have to kill him ${String(typos)} times`,
  );
  // The meter turns all of those into at most one heart across the chapter.
  assert.ok(
    run.heartsLost <= 1,
    `the metered version still cost him ${String(run.heartsLost)} hearts for ${String(typos)} typos`,
  );
  assert.ok(typos > run.heartsLost * 20, 'the meter must absorb mistakes by an order of magnitude');   // tuning-exempt: test fixture, not a game tunable
});

test('a player typing at the gate accuracy clears the early stages unharmed', () => {
  // 95% is what docs/design/06-curriculum.md demands before a stage advances, so
  // it is the accuracy a player at stage n actually has. Through the stages he
  // reaches in his first month, it costs him nothing.
  for (let stage = 0; stage <= 2; stage++) {
    for (const seed of SEEDS) {
      const run = typeAChapter(stage, 0.037, 3, seed);   // tuning-exempt: test fixture, not a game tunable
      assert.ok(run.accuracy > 0.93, `the simulated player typed at ${String(run.accuracy)}`);   // tuning-exempt: test fixture, not a game tunable
      assert.ok(
        run.heartsLost <= 2,
        `stage ${String(stage)} seed ${String(seed)} cost a gate-accurate player ${String(run.heartsLost)} hearts`,
      );
      assert.equal(run.deaths, 0);
    }
  }
});

test('tolerance narrows by stage without the rule ever changing', () => {
  for (let stage = 1; stage < 10; stage++) {   // tuning-exempt: test fixture, not a game tunable
    assert.ok(
      smudgePerError(stage, TUNING) > smudgePerError(stage - 1, TUNING),
      'the meter must keep meaning something as accuracy improves',
    );
  }
  // The break-even error rate the meter allows: one error must always be worth
  // more than one clean key, or the meter is decoration.
  const decay = tuningValue(TUNING, 'smudge_decay_per_key');
  for (let stage = 0; stage < 10; stage++) {   // tuning-exempt: test fixture, not a game tunable
    assert.ok(smudgePerError(stage, TUNING) > decay);
  }
});

// --- hearts and candles -----------------------------------------------------

test('an ink pot restores a heart and never overfills', () => {
  const hurt = { hearts: 1, smudge: 0, combo: 0 };
  assert.equal(restoreHeart(hurt, TUNING).hearts, 2);
  const full = createDamage(TUNING);
  assert.equal(restoreHeart(full, TUNING).hearts, full.hearts);
  // A quill nib raises the ceiling, up to the documented cap.
  assert.equal(maxHearts(TUNING, 1), tuningValue(TUNING, 'hearts_start') + 1);
  assert.equal(maxHearts(TUNING, 99), tuningValue(TUNING, 'hearts_max'));   // tuning-exempt: test fixture, not a game tunable
  assert.equal(restoreHeart(full, TUNING, 1).hearts, full.hearts + 1);
});

test('candles stand where core/corpus.ts cuts the chapter, not somewhere else', () => {
  const interval = tuningValue(TUNING, 'candle_interval');
  const units = candleUnits(31, TUNING);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(units[0], 1);
  for (const [i, unit] of units.entries()) assert.equal(unit, 1 + i * interval);
  assert.ok(isCandleUnit(1, 31, TUNING));   // tuning-exempt: test fixture, not a game tunable
  assert.ok(!isCandleUnit(2, 31, TUNING));   // tuning-exempt: test fixture, not a game tunable
  // A chapter shorter than one interval is one candle at the start.
  assert.deepEqual(candleUnits(1, TUNING), [1]);
});

test('a candle lit mid-chunk records the chunk it belongs to', () => {
  const damage = createDamage(TUNING);
  const candle = lightCandle('Genesis 1', 5, 31, damage, TUNING);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(candle.ref, 'Genesis 1');
  assert.equal(candle.chunkIndex, 1);
  assert.equal(candle.unit, 4, 'the checkpoint is the first verse of the chunk, not the verse he died on');   // tuning-exempt: test fixture, not a game tunable
});

test('death costs the verse, not the hearts', () => {
  const candle = lightCandle('Genesis 1', 4, 31, { hearts: 1, smudge: 90, combo: 0 }, TUNING);   // tuning-exempt: test fixture, not a game tunable
  const back = respawn(candle, TUNING);
  assert.equal(back.checkpoint.unit, 4);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(back.damage.hearts, tuningValue(TUNING, 'hearts_start'));
  assert.equal(back.damage.smudge, 0, 'respawning onto a nearly full meter is a wall, not a checkpoint');
  assert.equal(respawn(candle, TUNING, 2).damage.hearts, maxHearts(TUNING, 2));
});
