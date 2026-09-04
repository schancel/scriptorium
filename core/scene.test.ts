/**
 * The scenery band: it must fill the picture without touching the rail, and it
 * must not move unless the player typed.
 *
 * @doc docs/architecture/display-list.md#commands
 *
 * Three claims are asserted here rather than eyeballed, because all three are
 * easy to break by accident and none of them shows up as an error:
 *
 *  - **The rail is untouched.** Adding a world behind the text must not move the
 *    focal x by a pixel, and nothing drawn for the world may reach down into the
 *    rail's band. The scenery serves the rail; it never competes with it.
 *  - **Nothing advances on a clock.** Run an hour of frames with no keystroke
 *    and every monster is where it was placed. The one thing that *may* move on
 *    silence is the blot-cloud, which is the whole of
 *    docs/decisions/0004-idle-threat-not-speed-timer.md.
 *  - **The two palettes stay apart.** A command carrying a `theme` indexes the
 *    art roles in `core/sprites.ts`; one without indexes the interface slots in
 *    `core/draw.ts`. Mixing them silently recolours the game.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PALETTE_ORDER,
  VIRTUAL_W,
  drawFrame,
  sceneLayout,
  type FrameState,
  type SceneState,
} from './draw.js';
import { createRail, focalX } from './rail.js';
import { createCloud, createEntity, stepCloud, stepEntities, idleThresholdMs } from './entities.js';
import { createDamage } from './damage.js';
import { PALETTE_ROLES, SPRITE_SIZE, spriteFor } from './sprites.js';
import { DEFAULT_THEME, WORLDS } from './worlds.js';
import { classify } from './illumination.js';
import type { BlotCloud, DamageState, DrawCmd, Glyph, Key, Score, Tuning } from './types.js';

/** The rows data/tuning.json carries that any of this path reads. */
const TUNING: Tuning = { rail_cursor_x: 0.5, rail_scroll_lerp: 0.25, focal_guide_width: 40, gate_accuracy: 0.95, mastery_min_samples: 20, smudge_max: 100, smudge_per_error_base: 12, smudge_per_error_step: 1, smudge_decay_per_key: 3, hearts_start: 3, hearts_max: 5, idle_base_ms: 8000, idle_step_ms: 400, idle_floor_ms: 3000, cloud_approach_ms: 2500, cloud_smudge: 25 }; // tuning-exempt: test fixture mirroring data/tuning.json

const FRAME_MS = 16; // tuning-exempt: test fixture, a frame at 60Hz
const HOUR_MS = 3600000; // tuning-exempt: the length of the simulated trace

const KEYS: readonly Key[] = ['f', 'j', '<space>', 'a', 's', 'd', 'g', 'h', 'k', 'l', ';'];
const KEY_SET: ReadonlySet<Key> = new Set(KEYS);

const SCORE: Score = { wpm: 0, accuracy: 1, medianLatencyMs: 0 };

const TEXT = 'a lad shall fall and a flask, all half full;';

function glyphsOf(text: string): Glyph[] {
  return [...classify(text, KEY_SET, 'ansi', 'rt')];
}

const GLYPHS = glyphsOf(TEXT);

/** The band the scenery owns, and the first row of the rail beneath it. */
const LAYOUT = sceneLayout(DEFAULT_THEME, TUNING);
const RAIL_TOP = LAYOUT.top + LAYOUT.height;

function scene(over: Partial<SceneState> = {}): SceneState {
  const damage: DamageState = createDamage(TUNING);
  return {
    theme: DEFAULT_THEME,
    cameraX: 0,
    walking: false,
    animMs: 0,
    scribe: createEntity('scribe', 'scribe', LAYOUT.scribeX, LAYOUT.groundY - SPRITE_SIZE),
    entities: [
      createEntity('bat-0', 'bat', 200, LAYOUT.groundY - SPRITE_SIZE * 2, 0, -1), // tuning-exempt: test fixture placement
      createEntity('skel-0', 'skeleton', 420, LAYOUT.groundY - SPRITE_SIZE, 0, -1), // tuning-exempt: test fixture placement
    ],
    cloud: createCloud(),
    damage,
    heartsMax: TUNING['hearts_max'] ?? 0,
    candles: [{ x: 0, lit: true }, { x: 900, lit: false }], // tuning-exempt: test fixture placement
    ...over,
  };
}

function frame(cursor: number, over: Partial<FrameState> = {}): FrameState {
  return {
    mode: 'level',
    ref: 'Genesis 1:1  part 1/2',
    stage: 1,
    glyphs: GLYPHS,
    cursor,
    blocked: false,
    score: SCORE,
    keyStats: {},
    layout: 'ansi',
    keySet: KEYS,
    scene: scene(),
    ...over,
  };
}

/** The caret: the one vertical line in the frame, on the focal x. */
function caretX(cmds: readonly DrawCmd[]): number {
  for (const cmd of cmds) {
    if (cmd.op === 'line' && cmd.x1 === cmd.x2) return cmd.x1;
  }
  throw new Error('no caret in the frame');
}

type SpriteCmd = Extract<DrawCmd, { op: 'sprite' }>;

/** Every sprite in a frame, already narrowed. */
function sprites(cmds: readonly DrawCmd[]): SpriteCmd[] {
  return cmds.filter((cmd): cmd is SpriteCmd => cmd.op === 'sprite');
}

/** The frame with no world behind it, for the before-and-after comparisons. */
function bare(cursor: number): FrameState {
  const { scene: _scene, ...rest } = frame(cursor);
  return rest;
}

/** The bottom edge of anything the scenery draws. */
function bottomOf(cmd: DrawCmd): number {
  if (cmd.op === 'rect' || cmd.op === 'tile') return cmd.y + cmd.h;
  if (cmd.op === 'sprite') return cmd.y + SPRITE_SIZE;
  return Number.NEGATIVE_INFINITY;
}

// --- the rail is untouched ---------------------------------------------------

test('the scenery does not move the focal x by a pixel', () => {
  const target = focalX(VIRTUAL_W, TUNING);
  for (let cursor = 0; cursor <= GLYPHS.length; cursor += 1) {
    const withScene = drawFrame(frame(cursor), createRail(0), TUNING);
    const without = drawFrame(bare(cursor), createRail(0), TUNING);
    assert.equal(caretX(withScene), target, `caret drifted at ${String(cursor)}`);
    assert.equal(caretX(withScene), caretX(without), 'the scenery moved the caret');
  }
});

test('nothing drawn for the world reaches into the rail band', () => {
  for (const theme of WORLDS.keys()) {
    const cmds = drawFrame(
      frame(0, { scene: scene({ theme, cameraX: 750 }) }), // tuning-exempt: test fixture, a scrolled camera
      createRail(0),
      TUNING,
    );
    for (const cmd of cmds) {
      if (!('theme' in cmd) || cmd.theme === undefined) continue;
      assert.ok(
        bottomOf(cmd) <= RAIL_TOP,
        `${theme}: a ${cmd.op} reaches ${String(bottomOf(cmd))}, past the rail at ${String(RAIL_TOP)}`,
      );
    }
  }
});

test('the rail, the guide and the keyboard are drawn after the world', () => {
  // Paint order is the only z-index there is, so the scenery must be behind.
  const cmds = drawFrame(frame(0), createRail(0), TUNING);
  const lastThemed = cmds.map((c) => ('theme' in c && c.theme !== undefined)).lastIndexOf(true);
  const firstRail = cmds.findIndex((c) => c.op === 'text' && c.style.startsWith('rail-'));
  assert.ok(lastThemed >= 0 && firstRail >= 0);
  assert.ok(lastThemed < firstRail, 'a themed command is painted over the ribbon');
});

// --- nothing advances on a clock --------------------------------------------

test('an hour of silence moves no monster one pixel', () => {
  let entities = scene().entities;
  const placed = entities.map((e) => e.x);
  for (let t = 0; t < HOUR_MS; t += FRAME_MS) entities = stepEntities(entities, FRAME_MS);

  const still = drawFrame(
    frame(0, { scene: scene({ entities }) }),
    createRail(0),
    TUNING,
  );
  const xs = sprites(still).filter((c) => c.id !== 'blot_cloud').map((c) => c.x);
  const first = sprites(drawFrame(frame(0), createRail(0), TUNING))
    .filter((c) => c.id !== 'blot_cloud')
    .map((c) => c.x);
  assert.deepEqual(xs, first, 'something in the world advanced on a clock');
  assert.deepEqual(entities.map((e) => e.x), placed);
});

test('the world moves with the camera, and the camera alone', () => {
  const still = drawFrame(frame(0), createRail(0), TUNING);
  const moved = drawFrame(
    frame(0, { scene: scene({ cameraX: SPRITE_SIZE }) }),
    createRail(0),
    TUNING,
  );
  const monsterX = (cmds: readonly DrawCmd[]): number | undefined =>
    sprites(cmds).find((c) => c.id === 'skeleton')?.x;
  const before = monsterX(still);
  const after = monsterX(moved);
  assert.ok(before !== undefined && after !== undefined);
  assert.equal(before - after, SPRITE_SIZE, 'the world did not scroll with the camera');
});

test('the blot-cloud is the one thing silence may bring, and only after the telegraph', () => {
  // Not a speed timer: this is the documented idle threat, and it is the only
  // thing in the frame that appears without the player having done anything.
  const absent = drawFrame(frame(0), createRail(0), TUNING);
  assert.equal(sprites(absent).filter((c) => c.id === 'blot_cloud').length, 0);

  let cloud: BlotCloud = createCloud();
  const wait = idleThresholdMs(1, TUNING) + FRAME_MS;
  for (let t = 0; t < wait; t += FRAME_MS) {
    cloud = stepCloud(cloud, { stage: 1, correctKey: false, enabled: true }, FRAME_MS, TUNING).cloud;
  }
  const gathering = drawFrame(frame(0, { scene: scene({ cloud }) }), createRail(0), TUNING);
  const drawn = sprites(gathering).filter((c) => c.id === 'blot_cloud');
  assert.equal(drawn.length, 1, 'the cloud did not arrive on silence');
  const only = drawn[0];
  assert.ok(only !== undefined && bottomOf(only) <= RAIL_TOP, 'the cloud hangs over the rail');
});

test('one correct keystroke sends it back, whatever it was doing', () => {
  let cloud: BlotCloud = createCloud();
  for (let t = 0; t < idleThresholdMs(1, TUNING) * 2; t += FRAME_MS) {
    cloud = stepCloud(cloud, { stage: 1, correctKey: false, enabled: true }, FRAME_MS, TUNING).cloud;
  }
  cloud = stepCloud(cloud, { stage: 1, correctKey: true, enabled: true }, FRAME_MS, TUNING).cloud;
  const cmds = drawFrame(frame(0, { scene: scene({ cloud }) }), createRail(0), TUNING);
  assert.equal(sprites(cmds).filter((c) => c.id === 'blot_cloud').length, 0);
});

// --- the scribe --------------------------------------------------------------

test('the scribe walks while the world moves and idles when it stops', () => {
  const walking = drawFrame(frame(0, { scene: scene({ walking: true }) }), createRail(0), TUNING);
  const idling = drawFrame(frame(0, { scene: scene({ walking: false }) }), createRail(0), TUNING);
  assert.ok(sprites(walking).some((c) => c.id === 'scribe_walk'));
  assert.ok(sprites(idling).some((c) => c.id === 'scribe_idle'));
  assert.ok(!sprites(idling).some((c) => c.id === 'scribe_walk'));
});

test('the scribe stands over the focal point and stays there as the world scrolls', () => {
  const focal = focalX(VIRTUAL_W, TUNING);
  for (const cameraX of [0, 240, 5000]) { // tuning-exempt: test fixture, three camera positions
    const cmds = drawFrame(frame(0, { scene: scene({ cameraX }) }), createRail(0), TUNING);
    const scribe = sprites(cmds).find((c) => c.id.startsWith('scribe_'));
    assert.ok(scribe !== undefined);
    assert.equal(scribe.x + SPRITE_SIZE / 2, focal);
  }
});

// --- the HUD -----------------------------------------------------------------

test('a lost heart is drawn hollow rather than removed', () => {
  const full = TUNING['hearts_max'] ?? 0;
  for (let hearts = 0; hearts <= full; hearts += 1) {
    const damage: DamageState = { hearts, smudge: 0, combo: 0 };
    const cmds = drawFrame(frame(0, { scene: scene({ damage }) }), createRail(0), TUNING);
    const solid = sprites(cmds).filter((c) => c.id === 'heart_full').length;
    const hollow = sprites(cmds).filter((c) => c.id === 'heart_empty').length;
    assert.equal(solid, hearts);
    assert.equal(solid + hollow, full, 'the row of hearts changed length');
  }
});

test('the smudge meter fills with the meter and empties with it', () => {
  const max = TUNING['smudge_max'] ?? 0;
  const widthAt = (smudge: number): number => {
    const damage: DamageState = { hearts: 3, smudge, combo: 0 }; // tuning-exempt: test fixture
    const cmds = drawFrame(frame(0, { scene: scene({ damage }) }), createRail(0), TUNING);
    // The filled bar is the last rect in the HUD row; the track is behind it.
    const bars = cmds.filter((c) => c.op === 'rect' && c.theme === undefined && c.h === 6); // tuning-exempt: the meter's own height
    const filled = bars[bars.length - 1];
    return bars.length < 2 || filled === undefined || filled.op !== 'rect' ? 0 : filled.w;
  };
  assert.equal(widthAt(0), 0, 'a clean page drew a bar');
  assert.ok(widthAt(max / 2) > 0);
  assert.ok(widthAt(max) > widthAt(max / 2), 'the meter did not grow');
});

// --- the two palettes --------------------------------------------------------

test('a themed command indexes art roles; a plain one indexes interface slots', () => {
  for (const theme of WORLDS.keys()) {
    const cmds = drawFrame(frame(0, { scene: scene({ theme }) }), createRail(0), TUNING);
    for (const cmd of cmds) {
      const themed = 'theme' in cmd && cmd.theme !== undefined;
      if (cmd.op === 'sprite' || cmd.op === 'tile') {
        assert.ok(themed, `a ${cmd.op} named no theme, so it has no colours`);
        assert.ok(spriteFor(cmd.id) !== null, `no art for "${cmd.id}"`);
        continue;
      }
      if (cmd.op === 'line') continue;
      const limit = themed ? PALETTE_ROLES.length : PALETTE_ORDER.length;
      assert.ok(cmd.color >= 0 && cmd.color < limit, `${cmd.op} colour ${String(cmd.color)} is out of its palette`);
    }
  }
});

test('an unknown theme draws the abbey rather than nothing', () => {
  const cmds = drawFrame(frame(0, { scene: scene({ theme: 'no-such-place' }) }), createRail(0), TUNING);
  const themed = cmds.filter((c) => 'theme' in c && c.theme !== undefined);
  assert.ok(themed.length > 0);
  for (const cmd of themed) {
    assert.equal('theme' in cmd ? cmd.theme : null, DEFAULT_THEME);
  }
});

// --- still just data ---------------------------------------------------------

test('every command in a scened frame survives JSON and back', () => {
  const cmds = drawFrame(frame(0), createRail(0), TUNING);
  assert.deepEqual(JSON.parse(JSON.stringify(cmds)) as unknown, cmds);
});

test('a candle the scribe has not reached is drawn dimmer than one he has', () => {
  const cmds = drawFrame(
    frame(0, { scene: scene({ candles: [{ x: 0, lit: true }, { x: 200, lit: false }] }) }), // tuning-exempt: test fixture placement
    createRail(0),
    TUNING,
  );
  const candles = sprites(cmds).filter((c) => c.id === 'candle');
  assert.equal(candles.length, 2);
  const [lit, unlit] = candles;
  assert.ok(lit !== undefined && unlit !== undefined);
  assert.ok((lit.alpha ?? 1) > (unlit.alpha ?? 1), 'an unreached candle is as bright as a lit one');
});
