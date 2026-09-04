/**
 * The cloud comes for silence and for nothing else.
 *
 * @doc docs/design/03-pacing.md#the-threat-is-idleness-not-slowness
 *
 * The claims under test are the ones docs/decisions/0004-idle-threat-not-speed-timer.md
 * makes: that a slow player is safe however slow they are, that a *stopped*
 * player is not, that any correct keystroke ends the threat, and that nothing on
 * screen ever advances on a clock. Each of those is one intuitive commit away
 * from being false, which is why they are asserted rather than described.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  bobOffset,
  cloudPose,
  createCloud,
  createEntity,
  frameAt,
  idleThresholdMs,
  isTelegraphing,
  poseOf,
  stepCloud,
  stepEntities,
  stepEntity,
  toCloudState,
  type BlotCloud,
  type CloudInput,
} from './entities.js';
import { spriteFor } from './sprites.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { Tuning } from './types.js';

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

const TUNING: Tuning = loadTuning(loadDataFile('tuning.json'));
const FRAME_MS = 16; // tuning-exempt: a plausible frame time for the simulated trace

const IDLE: CloudInput = { stage: 0, correctKey: false, enabled: true };

/**
 * Run the cloud for `totalMs`, striking a correct key every `keyEveryMs`.
 * `keyEveryMs` of `null` means the player has stopped typing altogether.
 */
function run(
  cloud: BlotCloud,
  totalMs: number,
  keyEveryMs: number | null,
  input: CloudInput = IDLE,
): { cloud: BlotCloud; smudge: number; sawApproach: boolean } {
  let current = cloud;
  let smudge = 0;
  let sawApproach = false;
  let sinceKey = 0;
  for (let t = 0; t < totalMs; t += FRAME_MS) {
    sinceKey += FRAME_MS;
    const typed = keyEveryMs !== null && sinceKey >= keyEveryMs;
    if (typed) sinceKey = 0;
    const step = stepCloud(current, { ...input, correctKey: typed }, FRAME_MS, TUNING);
    current = step.cloud;
    smudge += step.smudge;
    if (current.phase !== 'absent') sawApproach = true;
  }
  return { cloud: current, smudge, sawApproach };
}

// --- the cloud watches silence, not speed -----------------------------------

test('the cloud never approaches while keystrokes keep coming, however slow', () => {
  const minute = 60000; // tuning-exempt: the length of the simulated trace
  // Five seconds of deliberation per keystroke: a beginner hesitating over every
  // single key, for ten minutes. He must be completely safe.
  const slow = run(createCloud(), minute * 10, 5000);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(slow.cloud.phase, 'absent');
  assert.equal(slow.smudge, 0);
  assert.equal(slow.sawApproach, false);

  // And at every cadence below the stage threshold, at every stage.
  for (let stage = 0; stage < 10; stage++) {   // tuning-exempt: test fixture, not a game tunable
    const threshold = idleThresholdMs(stage, TUNING);
    const cadence = threshold - FRAME_MS;
    const result = run(createCloud(), minute * 2, cadence, { ...IDLE, stage });
    assert.equal(result.cloud.phase, 'absent', `stage ${String(stage)} punished a ${String(cadence)}ms cadence`);
    assert.equal(result.smudge, 0);
  }
});

test('the cloud does approach after true silence, and telegraphs before it strikes', () => {
  const threshold = idleThresholdMs(0, TUNING);
  const approach = tuningValue(TUNING, 'cloud_approach_ms');

  const justBefore = run(createCloud(), threshold - FRAME_MS, null);
  assert.equal(justBefore.cloud.phase, 'absent');

  const gathering = run(createCloud(), threshold + FRAME_MS, null);
  assert.equal(gathering.cloud.phase, 'approaching');
  assert.ok(isTelegraphing(gathering.cloud));
  assert.equal(gathering.smudge, 0, 'the telegraph must cost nothing');

  // Nothing is lost until the whole telegraph has run.
  const midTelegraph = run(createCloud(), threshold + approach / 2, null);
  assert.equal(midTelegraph.smudge, 0);
  assert.ok(midTelegraph.cloud.x > 0 && midTelegraph.cloud.x < 1);

  const struck = run(createCloud(), threshold + approach + FRAME_MS, null);
  assert.equal(struck.cloud.phase, 'striking');
  assert.equal(struck.smudge, tuningValue(TUNING, 'cloud_smudge'));
  assert.equal(struck.cloud.strikes, 1);
  assert.equal(struck.cloud.x, 1);
});

test('one correct keystroke drives the cloud all the way back', () => {
  const threshold = idleThresholdMs(0, TUNING);
  const gathering = run(createCloud(), threshold + FRAME_MS, null).cloud;
  assert.equal(gathering.phase, 'approaching');

  const relieved = stepCloud(gathering, { ...IDLE, correctKey: true }, FRAME_MS, TUNING);
  assert.equal(relieved.cloud.phase, 'absent');
  assert.equal(relieved.cloud.idleMs, 0);
  assert.equal(relieved.cloud.x, 0);
  assert.equal(relieved.smudge, 0);

  // Even mid-strike: recovery is always available and always immediate.
  const striking = run(createCloud(), threshold + tuningValue(TUNING, 'cloud_approach_ms') + FRAME_MS, null).cloud;
  const afterStrike = stepCloud(striking, { ...IDLE, correctKey: true }, FRAME_MS, TUNING);
  assert.equal(afterStrike.cloud.phase, 'absent');
  assert.equal(afterStrike.cloud.strikes, striking.strikes, 'the strike count is history, not state to reset');
});

test('a wrong keystroke does not placate the cloud', () => {
  // Hunting the keyboard and mashing is the behaviour the cloud exists to
  // punish; a wrong key that drove it back would reward it.
  const silence = run(createCloud(), idleThresholdMs(0, TUNING) + FRAME_MS, null);
  assert.equal(silence.cloud.phase, 'approaching');
});

test('the threat can be switched off outright', () => {
  const off = run(createCloud(), 600000, null, { ...IDLE, enabled: false });   // tuning-exempt: test fixture, not a game tunable
  assert.equal(off.cloud.phase, 'absent');
  assert.equal(off.smudge, 0);
});

test('the idle threshold tightens by stage but never past its floor', () => {
  const base = tuningValue(TUNING, 'idle_base_ms');
  const step = tuningValue(TUNING, 'idle_step_ms');
  const floor = tuningValue(TUNING, 'idle_floor_ms');
  assert.equal(idleThresholdMs(0, TUNING), base);
  assert.equal(idleThresholdMs(1, TUNING), base - step);
  for (let stage = 0; stage < 100; stage++) {   // tuning-exempt: test fixture, not a game tunable
    assert.ok(idleThresholdMs(stage, TUNING) >= floor);
  }
  // A quill nib buys back exactly one stage of tightening.
  assert.equal(idleThresholdMs(2, TUNING, 1), idleThresholdMs(1, TUNING));
});

test('continued silence drips again rather than emptying the meter at once', () => {
  const approach = tuningValue(TUNING, 'cloud_approach_ms');
  const threshold = idleThresholdMs(0, TUNING);
  const afk = run(createCloud(), threshold + approach * 4 + FRAME_MS, null);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(afk.cloud.strikes, 4);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(afk.smudge, tuningValue(TUNING, 'cloud_smudge') * 4);   // tuning-exempt: test fixture, not a game tunable
});

test('the cloud projects onto the shared CloudState and draws a real sprite', () => {
  assert.equal(cloudPose(createCloud()), null);
  const gathering = run(createCloud(), idleThresholdMs(0, TUNING) + FRAME_MS, null).cloud;
  const pose = cloudPose(gathering);
  assert.ok(pose !== null);
  const sprite = spriteFor(pose.spriteId);
  assert.ok(sprite !== null && pose.frame < sprite.frames.length);
  assert.deepEqual(toCloudState(gathering), {
    phase: gathering.phase, phaseMs: gathering.phaseMs, x: gathering.x,
  });
});

// --- entities idle ----------------------------------------------------------

test('a monster never advances, however long the player takes', () => {
  const bat = createEntity('bat-1', 'bat', 120, 80);   // tuning-exempt: test fixture, not a game tunable
  const skeleton = createEntity('skel-1', 'skeleton', 300, 200);   // tuning-exempt: test fixture, not a game tunable
  let world = [bat, skeleton];
  const hour = 3600000; // tuning-exempt: the length of the simulated trace
  for (let t = 0; t < hour; t += FRAME_MS) world = stepEntities(world, FRAME_MS);
  for (const [i, entity] of world.entries()) {
    const placed = [bat, skeleton][i];
    assert.ok(placed !== undefined);
    assert.equal(entity.x, placed.x, 'an entity moved');
    assert.equal(entity.y, placed.y, 'an entity moved');
  }
  // What it does instead is bob, within a couple of pixels of home, for ever.
  for (const entity of world) {
    const pose = poseOf(entity);
    assert.ok(Math.abs(pose.y - entity.y) <= 2);
    assert.equal(pose.x, entity.x);
  }
});

test('animation is a pure function of the dtMs trace', () => {
  const trace = [16, 16, 33, 8, 16, 100, 16, 4]; // tuning-exempt: an uneven frame trace
  const play = (frames: readonly number[]) => {
    let entity = createEntity('bat-1', 'bat', 40, 40);   // tuning-exempt: test fixture, not a game tunable
    const poses = [];
    for (const dt of frames) {
      entity = stepEntity(entity, dt);
      poses.push(poseOf(entity));
    }
    return poses;
  };
  assert.deepEqual(play(trace), play(trace), 'the same trace produced two different animations');

  // And it depends on elapsed time only, not on how the time was chopped up.
  const coarse = createEntity('a', 'skeleton', 0, 0);
  const fine = createEntity('a', 'skeleton', 0, 0);
  assert.deepEqual(
    poseOf(stepEntity(coarse, 100)),   // tuning-exempt: test fixture, not a game tunable
    poseOf([...Array(10)].reduce<typeof fine>((e) => stepEntity(e, 10), fine)),   // tuning-exempt: test fixture, not a game tunable
  );
});

test('the scribe walks while typing and idles when he is not', () => {
  const scribe = createEntity('scribe', 'scribe', 100, 100);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(poseOf(scribe, true).spriteId, 'scribe_walk');
  assert.equal(poseOf(scribe, false).spriteId, 'scribe_idle');
  for (const moving of [true, false]) {
    const sprite = spriteFor(poseOf(scribe, moving).spriteId);
    assert.ok(sprite !== null);
    let entity = scribe;
    for (let i = 0; i < 200; i++) {   // tuning-exempt: test fixture, not a game tunable
      entity = stepEntity(entity, FRAME_MS);
      const pose = poseOf(entity, moving);
      assert.ok(pose.frame >= 0 && pose.frame < sprite.frames.length);
    }
  }
});

test('facing left flips the sprite rather than needing a second one', () => {
  assert.equal(poseOf(createEntity('a', 'bat', 0, 0, 0, -1)).flip, true);
  assert.equal(poseOf(createEntity('a', 'bat', 0, 0, 0, 1)).flip, false);
});

test('frameAt and bobOffset are total', () => {
  assert.equal(frameAt(0, 100, 4), 0);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(frameAt(350, 100, 4), 3);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(frameAt(450, 100, 4), 0);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(frameAt(100, 0, 4), 0);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(frameAt(100, 100, 0), 0);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(bobOffset(0, 1000, 2), 0);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(bobOffset(250, 1000, 2), 2);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(bobOffset(750, 1000, 2), -2);   // tuning-exempt: test fixture, not a game tunable
  assert.equal(bobOffset(250, 0, 2), 0);   // tuning-exempt: test fixture, not a game tunable
  assert.ok(Number.isInteger(bobOffset(137, 900, 2)), 'a fractional bob shimmers');   // tuning-exempt: test fixture, not a game tunable
});
