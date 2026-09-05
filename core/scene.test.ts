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
import { CELL_W, createRail, focalX } from './rail.js';
import {
  beginStrike, burstDurationMs, createCloud, createEntity, idleThresholdMs, stepCloud,
  stepEntities, stepMonsters, stepStrikes, strikeReachPx, strikeSpanMs, strikeWord, type Strike,
} from './entities.js';
import { createDamage } from './damage.js';
import { CANDLE_UNLIT_FRAME, PALETTE_ROLES, SPRITE_SIZE, spriteFor } from './sprites.js';
import { DEFAULT_THEME, WORLDS, blendThemeId, roleIndex, worldFor } from './worlds.js';
import { SETPIECE_IDS, setpieceState } from './setpieces.js';
import { classify } from './illumination.js';
import { overlayLayout } from './keyboard.js';
import type {
  BlotCloud, DamageState, DrawCmd, Glyph, Key, KeyStat, Score, Tuning,
} from './types.js';

/** The rows data/tuning.json carries that any of this path reads. */
const TUNING: Tuning = { rail_cursor_x: 0.5, rail_scroll_lerp: 0.25, focal_guide_width: 40, gate_accuracy: 0.95, mastery_min_samples: 20, overlay_retired_alpha: 0.15, report_trend_parts: 20, report_finger_min_hits: 12, report_reach_ratio: 2.0, report_key_min_attempts: 12, report_worst_key_rate: 0.12, smudge_max: 100, smudge_per_error_base: 12, smudge_per_error_step: 1, smudge_decay_per_key: 3, hearts_start: 3, hearts_max: 5, idle_base_ms: 8000, idle_step_ms: 400, idle_floor_ms: 3000, cloud_approach_ms: 2500, cloud_smudge: 25, monster_burst_ms: 320, strike_reach: 36, stomp_ms: 460, ink_ms: 420, strike_hop_px: 12, strike_contact_px: 7, strike_bounce_ratio: 0.6, strike_nib_arc_px: 14, strike_rise_travel: 0.7, reduced_parallax: 0, reduced_anim_scale: 0.35, reduced_camera_lerp: 0.5 }; // tuning-exempt: test fixture mirroring data/tuning.json

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
    strikes: [],
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

// --- felling a monster -------------------------------------------------------

/** The monster the fixture anchors to word 4, felled and mid-burst. */
const ANCHOR_WORD = 4; // tuning-exempt: test fixture, not a game tunable

function anchored(drop = false): DrawCmd[] {
  const monster = createEntity('skel-0', 'skeleton', 200, LAYOUT.groundY - SPRITE_SIZE, 0, -1, ANCHOR_WORD); // tuning-exempt: test fixture placement
  const struck = strikeWord([monster], ANCHOR_WORD, drop ? new Set(['skel-0']) : new Set<string>());
  return drawFrame(
    frame(0, { scene: scene({ entities: struck.entities, cameraX: 0 }) }),
    createRail(0),
    TUNING,
  );
}

test('a felled monster is drawn as its burst rather than as itself', () => {
  const standing = drawFrame(frame(0), createRail(0), TUNING);
  assert.ok(sprites(standing).some((c) => c.id === 'skeleton'));
  assert.equal(sprites(standing).filter((c) => c.id === 'burst').length, 0);

  const felled = anchored();
  assert.equal(sprites(felled).filter((c) => c.id === 'skeleton').length, 0, 'the monster survived its own burst');
  const burst = sprites(felled).filter((c) => c.id === 'burst');
  assert.equal(burst.length, 1);
  const only = burst[0];
  assert.ok(only !== undefined && bottomOf(only) <= RAIL_TOP, 'the burst reaches into the rail');
});

test('the burst walks its frames and then leaves the level, on its tuning row', () => {
  const monster = createEntity('skel-0', 'skeleton', 200, LAYOUT.groundY - SPRITE_SIZE, 0, -1, ANCHOR_WORD); // tuning-exempt: test fixture placement
  let world = strikeWord([monster], ANCHOR_WORD).entities;
  const span = burstDurationMs(TUNING);
  const seen = new Set<number>();
  for (let t = 0; t < span; t += FRAME_MS) {
    const cmds = drawFrame(frame(0, { scene: scene({ entities: world }) }), createRail(0), TUNING);
    const burst = sprites(cmds).find((c) => c.id === 'burst');
    assert.ok(burst !== undefined, `nothing drawn at ${String(t)}ms of the burst`);
    seen.add(burst.frame ?? 0);
    world = stepMonsters(world, FRAME_MS, TUNING);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2]);
  assert.equal(world.length, 0, 'the burst never ended');
  const after = drawFrame(frame(0, { scene: scene({ entities: world }) }), createRail(0), TUNING);
  assert.equal(sprites(after).filter((c) => c.id === 'burst').length, 0);
  assert.equal(sprites(after).filter((c) => c.id === 'skeleton').length, 0);
});

test('a drop puts an ink pot in the burst, and no drop puts nothing there', () => {
  assert.equal(sprites(anchored(false)).filter((c) => c.id === 'ink_pot').length, 0);
  const pots = sprites(anchored(true)).filter((c) => c.id === 'ink_pot');
  assert.equal(pots.length, 1);
  const pot = pots[0];
  assert.ok(pot !== undefined && bottomOf(pot) <= RAIL_TOP);
});

/**
 * The two monsters a blow is aimed at, standing where `strike_reach` puts them:
 * a gap ahead of the scribe rather than on the pixel he arrives at. That gap is
 * the thing the verbs cross, so a fixture without it would test nothing.
 */
const REACH = strikeReachPx(TUNING);
const SKELETON = createEntity('skel-t', 'skeleton', LAYOUT.scribeX + REACH, LAYOUT.groundY - SPRITE_SIZE, 0, -1, 4); // tuning-exempt: test fixture placement
const BAT = createEntity('bat-t', 'bat', LAYOUT.scribeX + REACH, LAYOUT.groundY - SPRITE_SIZE * 2, 0, -1, 2); // tuning-exempt: test fixture placement

function withStrikes(strikes: readonly Strike[], over: Partial<SceneState> = {}): DrawCmd[] {
  return drawFrame(
    frame(0, { scene: scene({ walking: true, strikes, ...over }) }),
    createRail(0),
    TUNING,
  );
}

test('the scribe strikes when he strikes, and goes back to walking after', () => {
  const striking = withStrikes([beginStrike(BAT)]);
  assert.ok(sprites(striking).some((c) => c.id === 'scribe_strike'));
  assert.ok(!sprites(striking).some((c) => c.id.startsWith('scribe_walk')));

  // The blow outranks walking for exactly its tuning row, and not a millisecond
  // more: it is feedback on a keystroke, not a state to get stuck in. An expired
  // strike is dropped from the list, and then he is simply walking again.
  let strikes: Strike[] = [beginStrike(BAT)];
  const span = strikeSpanMs('ink', TUNING);
  for (let t = 0; t < span; t += FRAME_MS) strikes = stepStrikes(strikes, FRAME_MS, TUNING);
  assert.deepEqual(strikes, [], 'the blow outstayed its tuning row');
  const done = withStrikes(strikes);
  assert.ok(sprites(done).some((c) => c.id === 'scribe_walk'));
  assert.ok(!sprites(done).some((c) => c.id === 'scribe_strike'));
});

test('a stomp travels to the skull and an ink throw sends the nib instead', () => {
  // The stomp: the scribe himself crosses the gap, so the sprite that moves is
  // him, and nothing is thrown.
  let hop: Strike[] = [beginStrike(SKELETON)];
  const xs: number[] = [];
  const ids = new Set<string>();
  for (let t = 0; t < strikeSpanMs('stomp', TUNING); t += FRAME_MS) {
    const drawn = sprites(withStrikes(hop)).find((c) => c.id === 'scribe_hop');
    assert.ok(drawn !== undefined, `nothing hopping at ${String(t)}ms`);
    xs.push(drawn.x);
    ids.add(drawn.id);
    assert.equal(sprites(withStrikes(hop)).filter((c) => c.id === 'nib').length, 0);
    hop = stepStrikes(hop, FRAME_MS, TUNING);
  }
  const start = xs[0];
  assert.ok(start !== undefined);
  assert.equal(start, LAYOUT.scribeX, 'the hop began somewhere other than under him');
  // Within a pixel of the skull: the frames land where a 60Hz trace puts them,
  // and contact is a moment in the animation rather than a frame boundary.
  assert.ok(Math.max(...xs) >= SKELETON.x - 1, 'the hop never reached the skeleton');
  assert.ok(Math.max(...xs) > start, 'the hop went nowhere -- the gap is not being crossed');
  // And he comes home: the last frame of the hop is back beside where he began,
  // not parked on the skull. The remaining pixels are the sliver of the bounce
  // left over when a 460ms verb is sampled at 60Hz.
  const home = xs[xs.length - 1] ?? 0;
  assert.ok(home - start < SPRITE_SIZE / 2, 'he stayed on the skull instead of bouncing home');
  assert.ok(Math.max(...xs) - home > SPRITE_SIZE, 'he never came back off it');

  // The ink: he stands where he is and the nib crosses the gap for him, landing
  // on the bat and bursting there.
  let throwing: Strike[] = [beginStrike(BAT)];
  const nibXs: number[] = [];
  let burst = 0;
  for (let t = 0; t < strikeSpanMs('ink', TUNING); t += FRAME_MS) {
    const drawn = sprites(withStrikes(throwing));
    const scribe = drawn.find((c) => c.id === 'scribe_strike');
    assert.ok(scribe !== undefined && scribe.x === LAYOUT.scribeX, 'the scribe went with his nib');
    const nib = drawn.find((c) => c.id === 'nib');
    const splash = drawn.find((c) => c.id === 'ink_burst');
    assert.ok(nib !== undefined || splash !== undefined, `nothing in the air at ${String(t)}ms`);
    if (nib !== undefined) nibXs.push(nib.x);
    if (splash !== undefined) {
      burst += 1;
      assert.equal(splash.x, BAT.x, 'the ink burst somewhere other than on the bat');
      assert.equal(splash.y, BAT.y);
    }
    throwing = stepStrikes(throwing, FRAME_MS, TUNING);
  }
  assert.ok(nibXs.length > 1 && burst > 0, 'the nib never flew or never landed');
  assert.equal(nibXs[0], LAYOUT.scribeX, 'the nib left from somewhere other than his hand');
  // It closes on the bat the whole way, without doubling back.
  const away = nibXs.map((x) => Math.abs(x - BAT.x));
  for (let i = 1; i < away.length; i += 1) {
    assert.ok((away[i] ?? 0) <= (away[i - 1] ?? 0), 'the nib flew away from the bat');
  }
  assert.ok((away[0] ?? 0) >= REACH - 1, 'the nib had no gap to cross');
});

test('the nib follows the bat as the camera moves, rather than the pixel it was thrown at', () => {
  // The strike carries a *world* position, so a camera that scrolls between the
  // keystroke and the landing takes the target and the missile with it together.
  let flying: Strike[] = [beginStrike(BAT)];
  const partway = 96; // tuning-exempt: test fixture, six frames into the flight
  for (let t = 0; t < partway; t += FRAME_MS) flying = stepStrikes(flying, FRAME_MS, TUNING);
  const still = sprites(withStrikes(flying)).find((c) => c.id === 'nib');
  const scrolled = sprites(withStrikes(flying, { cameraX: SPRITE_SIZE }))
    .find((c) => c.id === 'nib');
  assert.ok(still !== undefined && scrolled !== undefined);
  // The scribe's end of the path has not moved, so the nib shifts by the camera
  // scaled by how far along it is -- which is exactly what keeps it on the bat.
  assert.ok(scrolled.x < still.x, 'the nib ignored the camera');
});

test('overlapping blows both draw, and the scribe takes the most recent', () => {
  // The list, on the screen. An ink thrown a few frames ago is still crossing
  // the gap while a stomp begins over it; the older nib keeps its place.
  let strikes: Strike[] = [beginStrike(BAT)];
  const partway = 80; // tuning-exempt: test fixture, five frames into the flight
  for (let t = 0; t < partway; t += FRAME_MS) strikes = stepStrikes(strikes, FRAME_MS, TUNING);
  const flyingX = sprites(withStrikes(strikes)).find((c) => c.id === 'nib')?.x;
  assert.ok(flyingX !== undefined);

  const both = sprites(withStrikes([...strikes, beginStrike(SKELETON)]));
  assert.equal(both.filter((c) => c.id === 'nib').length, 1, 'the older nib was dropped');
  assert.equal(both.find((c) => c.id === 'nib')?.x, flyingX, 'the older nib was restarted');
  assert.ok(both.some((c) => c.id === 'scribe_hop'), 'the scribe replayed the older blow');
  assert.ok(!both.some((c) => c.id === 'scribe_strike'));
  assert.equal(both.filter((c) => c.id.startsWith('scribe_')).length, 1, 'there are two scribes');

  // Three at once: two nibs in the air and one scribe over the top of them.
  const three = sprites(withStrikes([beginStrike(BAT), beginStrike(SKELETON), beginStrike(BAT)]));
  assert.equal(three.filter((c) => c.id === 'nib').length, 2);
  assert.equal(three.filter((c) => c.id.startsWith('scribe_')).length, 1);
});

test('nothing a strike draws reaches into the rail band', () => {
  // The verbs travel, which is new, so the band invariant has to hold for every
  // millisecond of both of them rather than only for a standing scribe.
  for (const target of [SKELETON, BAT]) {
    let strikes: Strike[] = [beginStrike(target)];
    const span = strikeSpanMs(strikes[0]?.verb ?? 'ink', TUNING);
    for (let t = 0; t < span; t += FRAME_MS) {
      for (const cmd of withStrikes(strikes, { cameraX: 120 })) { // tuning-exempt: test fixture, a scrolled camera
        if (!('theme' in cmd) || cmd.theme === undefined) continue;
        assert.ok(bottomOf(cmd) <= RAIL_TOP, `a ${cmd.op} at ${String(t)}ms reaches past the rail`);
      }
      strikes = stepStrikes(strikes, FRAME_MS, TUNING);
    }
  }
});

// --- saying so when the data did not load ------------------------------------

test('A FRAME RUNNING ON FALLBACK DATA SAYS SO, AND SAYS IT OVER EVERYTHING', () => {
  // The bug this exists for: every loader in the platform falls back silently,
  // so a 404 on the corpus produces five hardcoded verses that read exactly like
  // working software. Quiet is the failure; the banner is the fix.
  const quiet = drawFrame(frame(0), createRail(0), TUNING);
  const texts = (cmds: readonly DrawCmd[]): string[] =>
    cmds.filter((c) => c.op === 'text').map((c) => c.value);
  assert.ok(!texts(quiet).some((v) => v.includes('FALLBACK')), 'a healthy frame cries wolf');

  const lines = ['NOT THE REAL DATA - using built-in fallbacks for: the text',
    'these are built-in substitutes'];
  const warned = drawFrame(frame(0, { notice: lines }), createRail(0), TUNING);
  for (const line of lines) assert.ok(texts(warned).includes(line), `the banner dropped "${line}"`);

  // Over everything, and last: a warning the report card could bury is a
  // warning that disappears at exactly the moment the player stops to read.
  const reported = drawFrame(
    frame(0, { mode: 'report', notice: lines }),
    createRail(0),
    TUNING,
  );
  const lastNotice = reported.map((c) => c.op === 'text' && lines.includes(c.value)).lastIndexOf(true);
  assert.ok(lastNotice >= 0, 'the report card buried the warning');
  assert.equal(lastNotice, reported.length - 1, 'something is painted over the warning');

  // An empty list is not a banner: absent and "nothing failed" must look alike.
  assert.deepEqual(
    drawFrame(frame(0, { notice: [] }), createRail(0), TUNING),
    quiet,
  );
});

// --- the first-run note ------------------------------------------------------

test('A FIRST-RUN NOTE IS DRAWN UNDER THE RAIL AND MOVES NOTHING ON IT', () => {
  // docs/design/10-first-run.md: the note sits under the rail, it never
  // competes with the next-key hint for the eye, and above all it does not
  // shift the picture -- a layout that jumped when the game spoke would pull
  // the eye off the focal point, which is the one thing the rail exists to
  // hold still.
  const quiet = drawFrame(frame(0), createRail(0), TUNING);
  const sentence = 'The bar means a space. Either thumb.';
  const spoken = drawFrame(frame(0, { note: sentence }), createRail(0), TUNING);

  const note = spoken.find(
    (c): c is Extract<DrawCmd, { op: 'text' }> => c.op === 'text' && c.value === sentence,
  );
  assert.ok(note !== undefined, 'the note was not drawn');
  assert.equal(quiet.some((c) => c.op === 'text' && c.value === sentence), false);

  // Under the rail, and not in it: below the ribbon and below the lower focal
  // rule, which is the bottom edge of the thing the player is reading.
  const guideY = Math.max(
    ...spoken
      .filter((c): c is Extract<DrawCmd, { op: 'line' }> => c.op === 'line' && c.y1 === c.y2)
      .map((c) => c.y1),
  );
  const glyphY = Math.max(
    ...spoken
      .filter((c): c is Extract<DrawCmd, { op: 'text' }> =>
        c.op === 'text' && c.style.startsWith('rail-'))
      .map((c) => c.y),
  );
  assert.ok(note.y > guideY, 'the note is drawn inside the focal guide');
  assert.ok(note.y > glyphY, 'the note is drawn over the ribbon');

  // Not gold: gold is how this game says *press this key next*, and a remark
  // that borrowed it would compete with the one thing he has to act on.
  const hint = spoken.find(
    (c): c is Extract<DrawCmd, { op: 'text' }> => c.op === 'text' && c.style === 'hint-center',
  );
  assert.ok(hint !== undefined, 'the next-key hint went missing');
  assert.notEqual(note.color, hint.color, 'the note is drawn in the hint\'s colour');
  assert.notEqual(note.style, hint.style);
  // And below the note rather than on top of it.
  assert.ok(hint.y > note.y, 'the hint and the note are stacked the wrong way round');

  // The rail itself is untouched: same caret, same focal guide, same glyphs.
  assert.equal(caretX(spoken), caretX(quiet), 'the note moved the focal point');
  const rail = (cmds: readonly DrawCmd[]): string =>
    JSON.stringify(cmds.filter((c) => c.op === 'text' && c.style.startsWith('rail-')));
  assert.equal(rail(spoken), rail(quiet), 'the note moved the ribbon');

  // Absent and empty are the same frame; a note is not something a healthy
  // frame carries an empty slot for.
  assert.deepEqual(drawFrame(frame(0, { note: '' }), createRail(0), TUNING), quiet);
});

test('the fallback banner still paints over a first-run note', () => {
  // The banner is last in the list, whatever else the frame is carrying.
  const lines = ['NOT THE REAL DATA - using built-in fallbacks for: the text'];
  const cmds = drawFrame(
    frame(0, { note: 'The bar means a space. Either thumb.', notice: lines }),
    createRail(0),
    TUNING,
  );
  const last = cmds[cmds.length - 1];
  assert.ok(last !== undefined && last.op === 'text' && lines.includes(last.value));
});

test('nothing about the combat loop moves without a keystroke', () => {
  // The property ADR 0004 exists to protect, asserted on the picture rather than
  // on the state: ten seconds of silence over a level with a standing monster
  // leaves every sprite in the band on the pixel it was on, none of them a
  // burst, and the scribe not striking at anything.
  let world = scene().entities;
  const drawn = (entities: readonly ReturnType<typeof createEntity>[]): string =>
    JSON.stringify(
      sprites(drawFrame(frame(0, { scene: scene({ entities }) }), createRail(0), TUNING))
        .filter((c) => c.id !== 'blot_cloud' && !c.id.startsWith('scribe_'))
        .map((c) => ({ id: c.id, x: c.x })),
    );
  const before = drawn(world);
  const tenSeconds = 10000; // tuning-exempt: the length of the simulated trace
  for (let t = 0; t < tenSeconds; t += FRAME_MS) world = stepMonsters(world, FRAME_MS, TUNING);
  assert.equal(drawn(world), before, 'the level changed while the player sat still');
  assert.equal(world.length, scene().entities.length, 'a monster left during silence');
});

test('an unreached candle is drawn out, not drawn burning and faint', () => {
  const cmds = drawFrame(
    frame(0, { scene: scene({ candles: [{ x: 0, lit: true }, { x: 200, lit: false }] }) }), // tuning-exempt: test fixture placement
    createRail(0),
    TUNING,
  );
  const candles = sprites(cmds).filter((c) => c.id === 'candle');
  assert.equal(candles.length, 2);
  const [lit, unlit] = candles;
  assert.ok(lit !== undefined && unlit !== undefined);
  assert.equal(unlit.frame, CANDLE_UNLIT_FRAME, 'the unlit candle is still drawing a flame');
  assert.notEqual(lit.frame, CANDLE_UNLIT_FRAME);
});

// --- set pieces stay inside the band ----------------------------------------
//
// A flourish is the one thing in the scenery drawn from parameters rather than
// from a tile grid, so it is the one thing that can be given an arithmetic error
// and reach somewhere it must not. Below the band is the rail; below the rail is
// the strip reserved for a first-run note. Neither may be touched, and the way
// to know is to run every flourish at every progress and look at where it lands.

const PROGRESS_STEPS = 6;   // tuning-exempt: samples across a passage
const PIECE_CLOCKS: readonly number[] = [0, 1400]; // tuning-exempt: two art phases

/**
 * A different world per set piece, cycling through all of them.
 *
 * Where a flourish lands is a matter of geometry and not of colour -- every rect
 * it draws is clamped into the same band whatever the palette is -- so drawing
 * every flourish in every world is a hundred and fifty thousand frames to assert
 * one number a dozen identical times. Cycling covers every world across the test
 * without multiplying it out.
 */
const THEME_ROTA: readonly string[] = [...WORLDS.keys()];

test('NO SET PIECE EVER REACHES THE RAIL, AT ANY PROGRESS OR PHASE', () => {
  SETPIECE_IDS.forEach((id, index) => {
    const theme = THEME_ROTA[index % THEME_ROTA.length] ?? DEFAULT_THEME;
    for (let i = 0; i <= PROGRESS_STEPS; i += 1) {
      for (const elapsedMs of PIECE_CLOCKS) {
        const piece = setpieceState(id, { elapsedMs, progress: i / PROGRESS_STEPS });
        const cmds = drawFrame(
          frame(0, { scene: scene({ theme, setpiece: piece }) }),
          createRail(0),
          TUNING,
        );
        for (const cmd of cmds) {
          if (!('theme' in cmd) || cmd.theme === undefined) continue;
          assert.ok(bottomOf(cmd) <= RAIL_TOP,
            `${id} in ${theme} reaches ${String(bottomOf(cmd))}, past ${String(RAIL_TOP)}`);
          assert.ok(!('h' in cmd) || cmd.h >= 0, `${id} drew a negative height`);
        }
      }
    }
  });
});

test('A CITY LANDMARK ARRIVES, IS PASSED, AND IS GONE', () => {
  // "A city is a place you arrive at, not a texture that repeats." The gateway
  // -- the way *through* the gate, and the only themed `outline` rect a city
  // frame draws -- is therefore the one thing in the band whose x is a function
  // of how far through the passage the player has typed.
  // docs/design/05-scenery-warps.md#a-landmark-is-a-pass-fraction
  const gatewayX = (id: 'out_of_the_gate' | 'up_to_the_temple', progress: number): number | null => {
    const piece = setpieceState(id, { elapsedMs: 0, progress });
    const cmds = drawFrame(
      frame(0, { scene: scene({ theme: 'city', setpiece: piece }) }),
      createRail(0),
      TUNING,
    );
    const ways = cmds.filter(
      (cmd) => cmd.op === 'rect' && cmd.theme !== undefined && cmd.color === roleIndex('outline'),
    );
    assert.ok(ways.length <= 1, `${id} drew ${String(ways.length)} gateways`);
    const way = ways[0];
    return way === undefined || way.op !== 'rect' ? null : way.x;
  };

  for (const id of ['out_of_the_gate', 'up_to_the_temple'] as const) {
    // Not in sight at the start of the passage, and gone by the end of it: a
    // landmark that were merely a level rising would still be standing there.
    assert.equal(gatewayX(id, 0), null, `${id} had its gate up before it was in sight`);
    assert.equal(gatewayX(id, 1), null, `${id} never left its gate behind`);

    // And in between it crosses the band, right to left, as the words are typed.
    const STEPS = 12; // tuning-exempt: test fixture -- samples across the pass
    let seen = 0;
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 1; i < STEPS; i += 1) {
      const x = gatewayX(id, i / STEPS);
      if (x === null) continue;
      seen += 1;
      assert.ok(x < previous, `${id} moved its gate forward at ${String(i / STEPS)}`);
      previous = x;
    }
    assert.ok(seen > 2, `${id} never had its gate on the screen`);
  }
});

test('the temple arrives and stays, which is what a landmark you are going to does', () => {
  const rectsAt = (progress: number): number => {
    const piece = setpieceState('up_to_the_temple', { elapsedMs: 0, progress });
    const cmds = drawFrame(
      frame(0, { scene: scene({ theme: 'city', setpiece: piece }) }),
      createRail(0),
      TUNING,
    );
    return cmds.filter((cmd) => cmd.op === 'rect' && cmd.theme !== undefined).length;
  };
  // Nothing of it at the start, the whole front of it at the end -- and it is
  // still there on the last verse, unlike the gate, because the rest of the
  // chapter happens inside it.
  assert.ok(rectsAt(1) > rectsAt(0), 'the temple never arrived');
  // And it does not go past: the last verse of the stretch draws exactly what
  // the one before it did, which is the difference between arriving somewhere
  // and being carried past it.
  assert.equal(rectsAt(1), rectsAt(0.9)); // tuning-exempt: test fixture -- the end of the stretch
});

test('a set piece never moves the reading column', () => {
  const target = focalX(VIRTUAL_W, TUNING);
  for (const id of SETPIECE_IDS) {
    const piece = setpieceState(id, { elapsedMs: 1400, progress: 0.5 }); // tuning-exempt: mid-passage
    const cmds = drawFrame(frame(3, { scene: scene({ setpiece: piece }) }), createRail(0), TUNING); // tuning-exempt: a cursor
    assert.equal(caretX(cmds), target, `${id} moved the caret`);
  }
});

// --- the two presentations of the world --------------------------------------
//
// docs/design/12-motion-and-comfort.md#what-reduced-motion-changes. The parallax
// is the strongest half of the stimulus -- several fields at differing rates --
// and the least load-bearing part of the picture, so it is what freezes.

/** Where every parallax band was drawn this frame, in paint order. */
function tileXs(cmds: readonly DrawCmd[]): number[] {
  return cmds.filter((c) => c.op === 'tile').map((c) => (c.op === 'tile' ? c.x : 0));
}

/** A camera that has travelled, in strides a player could actually have typed. */
const TRAVELLED: readonly number[] = [0, 24, 96, 240, 601]; // tuning-exempt: test fixture, strides of world

test('REDUCED MOTION FREEZES THE PARALLAX: THE LAYERS DO NOT SHIFT AT ALL', () => {
  for (const theme of WORLDS.keys()) {
    let first: string | null = null;
    for (const cameraX of TRAVELLED) {
      const cmds = drawFrame(
        frame(0, { scene: scene({ theme, cameraX }), reduced: true }),
        createRail(0),
        TUNING,
      );
      const xs = JSON.stringify(tileXs(cmds));
      assert.notEqual(xs, '[]', `${theme} drew no parallax at all`);
      if (first === null) first = xs;
      assert.equal(xs, first, `${theme} slid its layers at cameraX ${String(cameraX)}`);
    }
  }
});

test('and the full presentation still scrolls them, at their own depths', () => {
  // Or the test above would be asserting nothing: a world whose layers never
  // moved in either presentation would pass it and be broken.
  const at = (cameraX: number): string => JSON.stringify(tileXs(drawFrame(
    frame(0, { scene: scene({ cameraX }) }), createRail(0), TUNING,
  )));
  const moved = TRAVELLED.filter((cameraX) => at(cameraX) !== at(0));
  assert.ok(moved.length >= TRAVELLED.length - 1, 'the smooth world stopped scrolling');
});

test('a reduced frame changes nothing else about the picture', () => {
  // Not a degraded mode: same bands, same ground line, same set pieces, same
  // sprites, same colours. The only difference in the whole display list is
  // where the parallax bands sit, and at a camera of zero there is not even that.
  for (const theme of WORLDS.keys()) {
    const still = scene({ theme, cameraX: 0 });
    assert.deepEqual(
      drawFrame(frame(3, { scene: still, reduced: true }), createRail(0), TUNING), // tuning-exempt: a cursor
      drawFrame(frame(3, { scene: still }), createRail(0), TUNING), // tuning-exempt: a cursor
      `${theme} drew a different world for a reduced frame`,
    );
  }
});

test('the reading column is the same column in a reduced frame', () => {
  const target = focalX(VIRTUAL_W, TUNING);
  for (const cameraX of TRAVELLED) {
    for (const reduced of [false, true]) {
      const cmds = drawFrame(
        frame(3, { scene: scene({ cameraX }), reduced }), // tuning-exempt: a cursor
        createRail(0),
        TUNING,
      );
      assert.equal(caretX(cmds), target, `the caret moved with reduced=${String(reduced)}`);
    }
  }
});

// --- the palette moves and the tiles cut ------------------------------------

/** The sky: the first themed rect the band draws, full width. */
function skyTheme(cmds: readonly DrawCmd[]): string {
  for (const cmd of cmds) {
    if (cmd.op === 'rect' && cmd.theme !== undefined && cmd.w === VIRTUAL_W) return cmd.theme;
  }
  throw new Error('no sky in the frame');
}

test('EVERY WORLD STANDS ON THE SAME GROUND LINE, SO A SCENE CHANGE CANNOT FLOAT ANYTHING', () => {
  // The platform places monsters once, at level open, off `sceneLayout` for the
  // chapter's theme -- and Genesis 1 then changes theme six times underneath
  // them. That is only safe because every world composes its bands from the same
  // geometry, so the ground the scribe stands on is the same row in all of them.
  // If it ever stops being true, monsters placed in the void hang in the air over
  // the garden, and nothing else in the repository would say so.
  const ground = sceneLayout(DEFAULT_THEME, TUNING).groundY;
  for (const theme of WORLDS.keys()) {
    assert.equal(sceneLayout(theme, TUNING).groundY, ground, `${theme} stands somewhere else`);
    assert.equal(sceneLayout(theme, TUNING).scribeX, sceneLayout(DEFAULT_THEME, TUNING).scribeX);
  }
});

test('A SETTLED SCENE DRAWS EXACTLY THE FRAME IT ALWAYS DID', () => {
  // The transition has to be impossible to leave switched on. A scene with no
  // blend, and a scene blended zero of the way, must both produce the display
  // list the game produced before any of this existed.
  const settled = drawFrame(frame(0), createRail(0), TUNING);
  const zeroed = drawFrame(
    frame(0, { scene: scene({ blend: { theme: 'garden', mix: 0 } }) }),
    createRail(0),
    TUNING,
  );
  assert.deepEqual(zeroed, settled);
});

test('a blend recolours the band and changes not one tile in it', () => {
  // docs/design/05-scenery-warps.md: "colour eases from one scene's palette to
  // the next across the boundary, and tiles change at the boundary itself."
  const plain = drawFrame(frame(0, { scene: scene({ theme: 'void' }) }), createRail(0), TUNING);
  const mixed = drawFrame(
    frame(0, { scene: scene({ theme: 'void', blend: { theme: 'garden', mix: 0.5 } }) }), // tuning-exempt: the midpoint of a mix
    createRail(0),
    TUNING,
  );
  const tiles = (cmds: readonly DrawCmd[]): string =>
    JSON.stringify(cmds.filter((c) => c.op === 'tile').map((c) => ({ id: c.id, x: c.x, y: c.y })));
  assert.equal(tiles(mixed), tiles(plain), 'the tiles moved or changed picture mid-transition');
  assert.notEqual(skyTheme(mixed), skyTheme(plain), 'the palette did not move at all');
  // And the palette it resolves to really is between the two.
  const between = worldFor(skyTheme(mixed));
  assert.notDeepEqual([...between.palette], [...worldFor('void').palette]);
  assert.notDeepEqual([...between.palette], [...worldFor('garden').palette]);
  assert.deepEqual([...between.palette], [...worldFor(blendThemeId('void', 'garden', 0.5)).palette]); // tuning-exempt: the midpoint of a mix
});

test('a blended frame is still plain data, and still leaves the rail alone', () => {
  const cmds = drawFrame(
    frame(4, { scene: scene({ theme: 'sea', blend: { theme: 'firmament', mix: 0.4 } }) }), // tuning-exempt: a cursor and a mix
    createRail(0),
    TUNING,
  );
  // Every command survives a round trip through JSON, which is the display
  // list's whole contract -- a blended theme is a string like any other id.
  assert.deepEqual(JSON.parse(JSON.stringify(cmds)) as DrawCmd[], cmds);
  assert.equal(caretX(cmds), focalX(VIRTUAL_W, TUNING), 'the transition moved the caret');
  for (const cmd of cmds) {
    if (!('theme' in cmd) || cmd.theme === undefined) continue;
    assert.ok(bottomOf(cmd) <= RAIL_TOP, 'a blended command reached the rail');
  }
});

test('the fallback banner is still the last command with a world mid-transition', () => {
  // ADR 0009. Nothing may cover it -- including a scenery band that has just
  // grown a second palette and a set piece.
  const lines = ['NOT THE REAL DATA - using built-in fallbacks for: the scenery'];
  const cmds = drawFrame(
    frame(0, {
      notice: lines,
      scene: scene({
        theme: 'void',
        blend: { theme: 'daybreak', mix: 0.5 }, // tuning-exempt: the midpoint of a mix
        setpiece: setpieceState('light_from_dark', { elapsedMs: 0, progress: 0.5 }), // tuning-exempt: mid-passage
      }),
    }),
    createRail(0),
    TUNING,
  );
  const last = cmds[cmds.length - 1];
  assert.ok(last !== undefined && last.op === 'text' && lines.includes(last.value));
});


// --- the scribe at his lectern -----------------------------------------------
//
// docs/design/02-rail.md#the-scribe-at-his-lectern. The keyboard band is a
// scaffold that retires a key at a time, and what is behind it is the scribe
// writing. Three rules, and all three are properties of the display list.

/** The top of the keyboard's band; mirrors `M.kbTop` in core/draw.ts. */
const KB_TOP = 210;     // tuning-exempt: band composition, mirrored from core/draw.ts
/** One key unit less its padding, which is how a key face is told from the rest. */
const KEY_FACE_H = 22;  // tuning-exempt: band composition, mirrored from core/draw.ts

/** A lifetime table in which every key of the stage has earned its fade-out. */
function earned(keys: readonly Key[]): Record<Key, KeyStat> {
  const out: Record<Key, KeyStat> = {};
  const samples = Math.trunc(TUNING['mastery_min_samples'] ?? 0);
  for (const key of keys) {
    out[key] = { hits: samples, errors: 0, totalMs: 0, latencies: [], confusions: {} };
  }
  return out;
}

type RectCmd = Extract<DrawCmd, { op: 'rect' }>;

function inBand(cmds: readonly DrawCmd[]): RectCmd[] {
  return cmds.filter((c): c is RectCmd => c.op === 'rect' && c.y >= KB_TOP);
}

const lecternIn = (cmds: readonly DrawCmd[]): RectCmd[] =>
  inBand(cmds).filter((c) => c.h !== KEY_FACE_H);
const facesIn = (cmds: readonly DrawCmd[]): RectCmd[] =>
  inBand(cmds).filter((c) => c.h === KEY_FACE_H);

const shapeOf = (cmds: readonly DrawCmd[]): string =>
  lecternIn(cmds).map((c) => `${String(c.x)},${String(c.y)},${String(c.w)},${String(c.h)}`).join(' ');

const withEarned = (over: Partial<FrameState> = {}): FrameState => frame(0, {
  report: { keyStats: earned(KEYS), history: [] },
  ...over,
});

test('NOTHING IS EARNED, SO THE BOARD IS WHOLE AND THERE IS NOTHING BEHIND IT', () => {
  // The reward *is* the crutch leaving. It cannot arrive before the crutch has
  // been earned away, and a beginner's frame is what it always was.
  const cmds = drawFrame(frame(0), createRail(0), TUNING);
  assert.equal(lecternIn(cmds).length, 0, 'nothing but key faces below the rail');
  assert.equal(facesIn(cmds).length, overlayLayout('ansi').length,
    'and every key is drawn');
});

/** A frame in which the first `n` of the stage's keys have earned their fade-out. */
const withEarnedCount = (n: number): FrameState => frame(0, {
  report: { keyStats: earned(KEYS.slice(0, n)), history: [] },
});

test('EVERY KEY OF THE LAYOUT IS DRAWN AT EVERY LEVEL OF MASTERY', () => {
  // The regression this exists to stop. Earned fade-out used to drop a mastered
  // key out of the display list, so the board grew holes as the player improved
  // and the owner reported it as a bug: "why are some keys missing from the
  // keyboard?". docs/design/06-curriculum.md#keyboard-layout is why it is one --
  // the overlay must match the physical board exactly or it teaches the wrong
  // finger -- and a reward that reads as damage is not a reward.
  //
  // Walked one key at a time from nothing earned to everything earned, because a
  // hole appears at *some* level of mastery and asserting only the two ends
  // would miss it.
  const board = overlayLayout('ansi');
  for (let n = 0; n <= KEYS.length; n++) {
    const faces = facesIn(drawFrame(withEarnedCount(n), createRail(0), TUNING));
    assert.equal(faces.length, board.length,
      `${String(n)} of ${String(KEYS.length)} keys retired and the board lost some`);
  }
  // And the labels too: a key face with no legend on it is the same hole.
  const labels = drawFrame(withEarned(), createRail(0), TUNING)
    .filter((c) => c.op === 'text' && c.style === 'key');
  assert.equal(labels.length, board.length, 'a key face lost its label');
});

test('WHAT MASTERY TAKES AWAY IS THE BOARD S PRESENCE, NOT ITS KEYS', () => {
  // The band is given back by receding the whole overlay together -- the picture
  // stays a picture of his keyboard while it thins, and the lectern comes up
  // through it. docs/design/02-rail.md#how-it-arrives-and-how-it-is-drawn
  // The brightest face on the board is a taught, un-dimmed key, so its alpha
  // *is* the board's presence -- an untaught key carries the dimming as well.
  const alphaOf = (n: number): number => {
    const faces = facesIn(drawFrame(withEarnedCount(n), createRail(0), TUNING));
    assert.ok(faces.length > 0);
    return Math.max(...faces.map((c) => c.alpha ?? 1));
  };
  assert.equal(alphaOf(0), 1, 'nothing earned, and the board is already faint');
  const floor = TUNING['overlay_retired_alpha'] ?? 0;
  assert.ok(floor > 0, 'the floor must be above zero or the board can still vanish');
  assert.ok(Math.abs(alphaOf(KEYS.length) - floor) < 1e-9, // tuning-exempt: float slack
    'everything earned, and the board did not recede to its floor');
  // Monotone: it thins as he earns, and never comes back brighter.
  for (let n = 1; n <= KEYS.length; n++) {
    assert.ok(alphaOf(n) < alphaOf(n - 1), `the board did not recede at ${String(n)}`);
  }

  // And the lectern comes up through it at the same rate, which is the half of
  // this the receding board exists to serve: the band is *given back*, not
  // merely dimmed. Nothing behind at nothing earned, and brighter every step.
  const lecternAlphaAt = (n: number): number => {
    const shapes = lecternIn(drawFrame(withEarnedCount(n), createRail(0), TUNING));
    return shapes.length === 0 ? 0 : Math.max(...shapes.map((c) => c.alpha ?? 1));
  };
  assert.equal(lecternAlphaAt(0), 0, 'the reward arrived before the crutch was given up');
  for (let n = 1; n <= KEYS.length; n++) {
    assert.ok(lecternAlphaAt(n) > lecternAlphaAt(n - 1),
      `the lectern did not come up at ${String(n)}`);
  }
});

test('a key that has earned its fade-out stops being coloured for its finger', () => {
  // The crutch is the colour: the board is painted by finger so it can say which
  // one to strike with, and a key he has earned is not being told that any more.
  // It keeps its face and its label; it loses the pointing.
  const fingers = new Set(overlayLayout('ansi').map((k) => PALETTE_ORDER.indexOf(k.finger)));
  const before = facesIn(drawFrame(frame(0), createRail(0), TUNING));
  const after = facesIn(drawFrame(withEarned(), createRail(0), TUNING));
  assert.ok(before.some((c) => fingers.has(c.color)), 'nothing was finger-coloured to begin with');
  const keyFace = PALETTE_ORDER.indexOf('keyFace');
  const taught = KEYS.length;
  assert.ok(after.filter((c) => c.color === keyFace).length >= taught,
    'every taught key should have dropped to the plain key face');
});

test('AND THE SCRIBE AT HIS LECTERN IS BEHIND IT, BELOW THE RAIL AND INSIDE THE BAND', () => {
  const cmds = drawFrame(withEarned(), createRail(0), TUNING);
  const shapes = lecternIn(cmds);
  assert.ok(shapes.length > 0, 'nothing was drawn in the band the board vacated');
  for (const c of shapes) {
    assert.ok(c.y >= KB_TOP, `a shape at y ${String(c.y)} is above the keyboard band`);
    assert.ok(c.y + c.h <= 360, // tuning-exempt: the virtual design resolution
      `a shape at y ${String(c.y + c.h)} runs off the bottom of the frame`);
    assert.ok(c.theme !== undefined, 'he is painted in the world he is walking in');
  }
  // Never gold. Gold is how the game says *press this key next*, and a picture
  // that borrowed it would compete with the one thing the player has to act on.
  const gold = PALETTE_ORDER.indexOf('gold');
  assert.ok(!shapes.some((c) => c.theme === undefined && c.color === gold));
});

test('THE QUILL MOVES ONLY WHEN THE PLAYER TYPES', () => {
  // An hour of frames with nobody typing, and every line of the page and every
  // dab of the quill is on the pixel it was drawn on. Same rule as the rest of
  // the world -- docs/decisions/0004-idle-threat-not-speed-timer.md -- and it
  // holds here by construction, because nothing this draws reads a clock.
  const still = shapeOf(drawFrame(withEarned(), createRail(0), TUNING));
  const later = shapeOf(drawFrame(
    withEarned({ scene: scene({ animMs: HOUR_MS, walking: true, cameraX: 500 }) }), // tuning-exempt: a fixture
    createRail(0),
    TUNING,
  ));
  assert.equal(later, still, 'the quill moved with nobody typing');
});

test('and it moves the moment he does, filling the page as he copies', () => {
  const start = shapeOf(drawFrame(withEarned(), createRail(0), TUNING));
  const on = shapeOf(drawFrame(
    withEarned({ cursor: Math.floor(GLYPHS.length / 2) }),
    createRail(0),
    TUNING,
  ));
  const end = shapeOf(drawFrame(
    withEarned({ cursor: GLYPHS.length }), createRail(0), TUNING,
  ));
  assert.notEqual(on, start, 'the cursor moved and the page did not');
  assert.notEqual(end, on);
  // The written lines only ever accumulate: a page that emptied as he typed on
  // would be the one picture in the game that takes work back.
  const inked = (cursor: number): number => lecternIn(
    drawFrame(withEarned({ cursor }), createRail(0), TUNING),
  ).filter((c) => c.h === 2 && c.w > CELL_W).length; // tuning-exempt: the ink line's own height
  assert.ok(inked(GLYPHS.length) >= inked(0));
  assert.ok(inked(GLYPHS.length) > 0, 'a finished stretch leaves a written page');
});

test('reading mode gets neither the board nor the quill', () => {
  // The mode asks for no keys, so no board is drawn -- and a quill moving for
  // somebody who is deliberately not typing would be exactly the lie the rule
  // above exists to prevent.
  const cmds = drawFrame(withEarned({ mode: 'lectio' }), createRail(0), TUNING);
  assert.equal(lecternIn(cmds).length, 0);
  assert.equal(facesIn(cmds).length, 0);
});
