/**
 * Set pieces: bounded, deterministic, and parameters rather than pictures.
 *
 * @doc docs/design/05-scenery-warps.md#set-pieces
 *
 * The three things that would go wrong quietly. A parameter escaping 0..1 is a
 * flood drawn off the top of the screen with no error anywhere. A set piece that
 * moved on a clock rather than on progress would be a time-based pressure the
 * game has decided against -- docs/decisions/0004-idle-threat-not-speed-timer.md
 * -- so the progress-driven parameters are checked to be exactly that. And a set
 * piece returning anything other than plain numbers would be a second renderer,
 * which is the boundary `core/draw.ts` owns.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SETPIECE_IDS,
  isSetpieceId,
  setpieceParam,
  setpieceState,
  type SetpieceId,
} from './setpieces.js';

const STEPS = 20;          // tuning-exempt: samples across the progress range
const FRAME_MS = 16;       // tuning-exempt: test fixture, a frame at 60Hz
const LONG_MS = 3600000;   // tuning-exempt: an hour of standing still

/** Progress from 0 to 1 inclusive, plus values outside the range. */
const PROGRESSES: readonly number[] = [
  ...Array.from({ length: STEPS + 1 }, (_, i) => i / STEPS),
  -1,
  2,
];

const CLOCKS: readonly number[] = [0, FRAME_MS, LONG_MS];
const HALF_WAY = 0.5;      // tuning-exempt: the middle of the progress range

test('every set piece produces only fractions, for any input at all', () => {
  for (const id of SETPIECE_IDS) {
    for (const progress of PROGRESSES) {
      for (const elapsedMs of CLOCKS) {
        const state = setpieceState(id, { elapsedMs, progress });
        assert.ok(state.progress >= 0 && state.progress <= 1, `${id} progress`);
        for (const [name, value] of Object.entries(state.params)) {
          assert.equal(typeof value, 'number', `${id}.${name} is not a number`);
          assert.ok(Number.isFinite(value), `${id}.${name} is not finite`);
          assert.ok(value >= 0 && value <= 1, `${id}.${name} = ${String(value)} escaped 0..1`);
        }
      }
    }
  }
});

test('the same input always gives the same parameters', () => {
  for (const id of SETPIECE_IDS) {
    const input = { elapsedMs: FRAME_MS * STEPS, progress: 1 / STEPS };
    assert.deepEqual(setpieceState(id, input), setpieceState(id, input));
  }
});

test('the flood rises with the verses, not with the clock', () => {
  const still = setpieceState('rising_water', { elapsedMs: 0, progress: 1 / STEPS });
  const later = setpieceState('rising_water', { elapsedMs: LONG_MS, progress: 1 / STEPS });
  assert.equal(setpieceParam(still, 'water'), setpieceParam(later, 'water'));
  assert.ok(
    setpieceParam(setpieceState('rising_water', { elapsedMs: 0, progress: 1 }), 'water') >
      setpieceParam(still, 'water'),
  );
});

test('the progress-driven flourishes only ever climb', () => {
  const climbing: readonly (readonly [SetpieceId, string])[] = [
    ['rising_water', 'water'],
    ['parted_walls', 'wall'],
    ['manna', 'fall'],
    ['smoke_and_fire', 'smoke'],
    ['swallowed', 'closure'],
    ['blood_on_doorposts', 'marked'],
    ['darkness_at_noon', 'grey'],
    ['light_from_dark', 'light'],
    ['tree_of_life', 'bloom'],
    ['waters_divided', 'gap'],
    ['land_from_water', 'land'],
    ['swarming', 'teeming'],
    ['bruised_reed', 'lift'],
    ['lifted_up', 'raised'],
    ['loaves_multiplied', 'baskets'],
    ['lamps_kindled', 'lamps'],
    ['gate_of_the_fold', 'open'],
  ];
  for (const [id, name] of climbing) {
    let last = -1;
    for (let i = 0; i <= STEPS; i += 1) {
      const value = setpieceParam(setpieceState(id, { elapsedMs: 0, progress: i / STEPS }), name);
      assert.ok(value >= last, `${id}.${name} went backwards`);
      last = value;
    }
    assert.equal(last, 1, `${id}.${name} does not finish`);
  }
});

test('darkness at noon drains the palette, and light from dark fills it', () => {
  const noon = setpieceState('darkness_at_noon', { elapsedMs: 0, progress: 1 });
  assert.equal(setpieceParam(noon, 'grey'), 1);
  assert.equal(setpieceParam(noon, 'light'), 0);
  const dawn = setpieceState('light_from_dark', { elapsedMs: 0, progress: 0 });
  assert.equal(setpieceParam(dawn, 'light'), 0);
  assert.equal(setpieceParam(dawn, 'dark'), 1);
});

test('the bush burns and is not consumed, at any point in the passage', () => {
  for (const progress of PROGRESSES) {
    for (const elapsedMs of CLOCKS) {
      const state = setpieceState('burning_bush', { elapsedMs, progress });
      assert.equal(setpieceParam(state, 'consumed'), 0);
    }
  }
  const a = setpieceState('burning_bush', { elapsedMs: 0, progress: 0 });
  const b = setpieceState('burning_bush', { elapsedMs: FRAME_MS * STEPS, progress: 0 });
  assert.notEqual(setpieceParam(a, 'flame'), setpieceParam(b, 'flame'), 'but it does flicker');
});

test('the wick is not quenched, at any point in the passage', () => {
  // The same shape as the bush that is not consumed, and for the same reason:
  // "a smoking flax he will not quench" is the whole of what the passage says
  // about it, so a flourish that guttered it dark at the end would contradict
  // the text it decorates.
  for (const progress of PROGRESSES) {
    for (const elapsedMs of CLOCKS) {
      assert.equal(setpieceParam(setpieceState('bruised_reed', { elapsedMs, progress }), 'quenched'), 0);
    }
  }
  const a = setpieceState('bruised_reed', { elapsedMs: 0, progress: 0 });
  const b = setpieceState('bruised_reed', { elapsedMs: FRAME_MS * STEPS, progress: 0 });
  assert.notEqual(setpieceParam(a, 'ember'), setpieceParam(b, 'ember'), 'but the ember moves');
});

test('THE GOSPEL FLOURISHES ARE THE WORLD RESPONDING, NEVER THE PLAYER GAINING', () => {
  // The register the design doc sets: "a storm going flat on the water, light,
  // the stone moved -- rather than anything the player gains." A set piece is a
  // pure function of progress to fractions, so it cannot reach a heart, a combo
  // or the mastery gate; this asserts the property that guarantees it, which is
  // that the *only* things a set piece produces are named numbers in 0..1.
  const gospel: readonly SetpieceId[] = [
    'bruised_reed', 'lifted_up', 'loaves_multiplied', 'lamps_kindled', 'gate_of_the_fold',
  ];
  for (const id of gospel) {
    const at = (progress: number) => setpieceState(id, { elapsedMs: 0, progress });
    assert.notDeepEqual(at(0).params, at(1).params, `${id} does not respond to the passage at all`);
    for (const value of Object.values(at(1).params)) {
      assert.ok(value >= 0 && value <= 1, `${id} produced something that is not a fraction`);
    }
  }
});

test('every Gospel passage the route names has a flourish, and no two are the same', () => {
  // "The Gospels have almost none while Exodus has four." Five were added; each
  // has to be its own picture, or the New Testament is one effect five times.
  const gospel: readonly SetpieceId[] = [
    'light_from_dark', 'bruised_reed', 'darkness_at_noon',
    'lifted_up', 'loaves_multiplied', 'lamps_kindled', 'gate_of_the_fold',
  ];
  const shapes = new Set<string>();
  for (const id of gospel) {
    const state = setpieceState(id, { elapsedMs: FRAME_MS, progress: HALF_WAY });
    shapes.add(Object.keys(state.params).sort().join(','));
  }
  assert.equal(shapes.size, gospel.length, 'two Gospel flourishes produce the same parameters');
});

test('a set piece emits parameters, never draw commands', () => {
  for (const id of SETPIECE_IDS) {
    const state = setpieceState(id, { elapsedMs: FRAME_MS, progress: 1 / STEPS });
    assert.equal(JSON.parse(JSON.stringify(state.params)) instanceof Array, false);
    for (const value of Object.values(state.params)) assert.equal(typeof value, 'number');
    assert.throws(() => {
      (state.params as Record<string, number>)['smuggled'] = 1;
    });
  }
});

test('an unimplemented set piece is a loud failure', () => {
  assert.equal(isSetpieceId('rising_water'), true);
  assert.equal(isSetpieceId('plague_of_frogs'), false);
  assert.throws(() => setpieceState('plague_of_frogs', { elapsedMs: 0, progress: 0 }), /no such set piece/);
});
