/**
 * The cloud comes for silence, monsters come for words, and neither comes for
 * slowness.
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
  burstDurationMs,
  burstFraction,
  burstPose,
  cloudPose,
  createCloud,
  createEntity,
  frameAt,
  idleThresholdMs,
  isBursting,
  isTelegraphing,
  monstersAt,
  poseOf,
  stepCloud,
  stepEntities,
  stepEntity,
  stepMonsters,
  strikeDurationMs,
  strikePose,
  strikeWord,
  toCloudState,
  type BlotCloud,
  type CloudInput,
  type Entity,
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

// --- a monster is a word ----------------------------------------------------

/**
 * Three monsters anchored to words 2, 5 and 9 of a passage.
 *
 * The anchors are the fixture's whole content: a monster in this game is a word
 * index and a picture, and everything asserted below is about the first half.
 */
const ANCHORS: readonly number[] = [2, 5, 9]; // tuning-exempt: test fixture, not a game tunable

function level(): Entity[] {
  return [
    createEntity('bat-0', 'bat', 100, 60, 0, -1, ANCHORS[0]),   // tuning-exempt: test fixture placement
    createEntity('skel-0', 'skeleton', 300, 60, 0, -1, ANCHORS[1]), // tuning-exempt: test fixture placement
    createEntity('bat-1', 'bat', 500, 60, 0, -1, ANCHORS[2]),   // tuning-exempt: test fixture placement
  ];
}

/**
 * Everything about a monster except its animation clock.
 *
 * `phaseMs` is a wing beat and is allowed to advance in silence -- a bat that
 * froze mid-flap would look broken. Every other field is combat, and none of it
 * may move without a keystroke. Comparing this projection rather than the whole
 * record is what makes that distinction assertable instead of merely intended.
 */
function combatState(entities: readonly Entity[]): string {
  return JSON.stringify(
    entities.map(({ id, kind, x, y, facing, word, burstMs, drop }) => ({
      id, kind, x, y, facing, word, burstMs, drop,
    })),
  );
}

test('completing the anchored word fells that monster, and nothing else does', () => {
  const struck = strikeWord(level(), ANCHORS[1] ?? 0);
  assert.equal(struck.defeated.length, 1);
  assert.equal(struck.defeated[0]?.id, 'skel-0');
  for (const entity of struck.entities) {
    assert.equal(isBursting(entity), entity.word === ANCHORS[1], `${entity.id} took the wrong blow`);
  }

  // Every other word in the passage, including words off both ends of it,
  // leaves the whole level standing.
  for (let word = -2; word < 14; word += 1) {   // tuning-exempt: test fixture, a span wider than the anchors
    const expected = ANCHORS.includes(word) ? 1 : 0;
    assert.equal(
      strikeWord(level(), word).defeated.length,
      expected,
      `word ${String(word)} felled the wrong number of monsters`,
    );
  }
});

test('a monster cannot be struck twice, and a strike carries the drop it was given', () => {
  const once = strikeWord(level(), ANCHORS[0] ?? 0);
  assert.equal(once.defeated.length, 1);
  assert.equal(once.defeated[0]?.drop, false, 'a strike invented a drop of its own');
  assert.equal(strikeWord(once.entities, ANCHORS[0] ?? 0).defeated.length, 0);

  const looted = strikeWord(level(), ANCHORS[0] ?? 0, new Set(['bat-0']));
  assert.equal(looted.defeated[0]?.drop, true);
  // A set naming something that is not there is not an error and changes nothing.
  const stranger = strikeWord(level(), ANCHORS[0] ?? 0, new Set(['no-such-monster']));
  assert.equal(stranger.defeated[0]?.drop, false);
});

test('monstersAt names the standing monsters and forgets the felled ones', () => {
  const standing = level();
  assert.deepEqual(monstersAt(standing, ANCHORS[2] ?? 0).map((e) => e.id), ['bat-1']);
  assert.deepEqual(monstersAt(standing, 4).map((e) => e.id), []);   // tuning-exempt: test fixture, an unanchored word
  const after = strikeWord(standing, ANCHORS[2] ?? 0).entities;
  assert.deepEqual(monstersAt(after, ANCHORS[2] ?? 0).map((e) => e.id), []);
});

test('no monster state advances without a keystroke', () => {
  // The ADR 0004 property, stated as strictly as it can be: over ten seconds of
  // total silence the combat state of the level is byte-identical. Nothing is
  // struck, nothing bursts, nothing is swept away, nothing moves and nothing
  // acquires a drop. The only field allowed to change is the wing beat.
  let world = level();
  const before = combatState(world);
  const tenSeconds = 10000; // tuning-exempt: the length of the simulated trace
  for (let t = 0; t < tenSeconds; t += FRAME_MS) world = stepMonsters(world, FRAME_MS, TUNING);
  assert.equal(combatState(world), before, 'something in the level advanced on a clock');
  assert.equal(world.length, ANCHORS.length, 'a monster arrived or left during silence');
  assert.ok(world.every((e) => !isBursting(e)));
});

test('a monster never blocks progress, however long the player takes over its word', () => {
  // An hour of deliberation over one word costs nothing and changes nothing:
  // the monster is exactly where it was, still standing, and the word still
  // fells it when it finally arrives. There is no state in which it wins.
  let world = level();
  const hour = 3600000; // tuning-exempt: the length of the simulated trace
  for (let t = 0; t < hour; t += FRAME_MS) world = stepMonsters(world, FRAME_MS, TUNING);
  assert.deepEqual(world.map((e) => e.x), level().map((e) => e.x));
  assert.deepEqual(world.map((e) => e.burstMs), [null, null, null]);

  const late = strikeWord(world, ANCHORS[1] ?? 0);
  assert.equal(late.defeated.length, 1, 'an hour of patience cost the player the fight');
});

test('the burst runs its whole course and then the monster is gone', () => {
  let world = strikeWord(level(), ANCHORS[0] ?? 0).entities;
  assert.equal(world.length, ANCHORS.length, 'the monster vanished on the frame it was struck');

  const span = burstDurationMs(TUNING);
  const art = spriteFor('burst');
  assert.ok(art !== null);
  const framesSeen = new Set<number>();
  for (let t = 0; t < span; t += FRAME_MS) {
    const struck = world.find((e) => e.id === 'bat-0');
    assert.ok(struck !== undefined, `the burst was swept away at ${String(t)}ms of ${String(span)}`);
    const pose = burstPose(struck, TUNING);
    assert.ok(pose !== null);
    assert.equal(pose.spriteId, 'burst');
    assert.ok(pose.frame >= 0 && pose.frame < art.frames.length);
    framesSeen.add(pose.frame);
    world = stepMonsters(world, FRAME_MS, TUNING);
  }
  assert.deepEqual([...framesSeen].sort((a, b) => a - b), [0, 1, 2], 'the burst skipped a frame');
  assert.equal(world.find((e) => e.id === 'bat-0'), undefined, 'the burst never ended');
  assert.equal(world.length, ANCHORS.length - 1);
  // And the monsters it stood beside are untouched.
  assert.deepEqual(world.map((e) => e.id), ['skel-0', 'bat-1']);
});

test('a standing monster has no burst pose, and the fraction is total', () => {
  const standing = level()[0];
  assert.ok(standing !== undefined);
  assert.equal(burstPose(standing, TUNING), null);
  assert.equal(burstFraction(standing, TUNING), 0);

  const struck = strikeWord([standing], standing.word ?? 0).entities[0];
  assert.ok(struck !== undefined);
  assert.equal(burstFraction(struck, TUNING), 0);
  assert.equal(burstFraction(stepEntity(struck, burstDurationMs(TUNING) * 4), TUNING), 1);   // tuning-exempt: test fixture, well past the end
});

test('the scribe holds the strike pose for strike_pose_ms and then puts it down', () => {
  const scribe = createEntity('scribe', 'scribe', 10, 20);   // tuning-exempt: test fixture placement
  const span = strikeDurationMs(TUNING);
  const art = spriteFor('scribe_strike');
  assert.ok(art !== null);

  assert.equal(strikePose(scribe, null, TUNING), null, 'he struck without being asked to');
  assert.equal(strikePose(scribe, 0, TUNING)?.spriteId, 'scribe_strike');
  assert.equal(strikePose(scribe, span - 1, TUNING)?.spriteId, 'scribe_strike');
  assert.equal(strikePose(scribe, span, TUNING), null, 'the pose outstayed its tuning row');

  for (let ms = 0; ms < span; ms += 1) {
    const pose = strikePose(scribe, ms, TUNING);
    assert.ok(pose !== null && pose.frame >= 0 && pose.frame < art.frames.length);
    assert.equal(pose.x, scribe.x);
    assert.equal(pose.y, scribe.y);
  }
});
