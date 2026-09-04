/**
 * The company: who joins, where they walk, and — mostly — what they cannot do.
 *
 * @doc docs/design/11-followers.md#no-abilities-made-structural
 *
 * Most of this file is about the *absence* of a feature, which is unusual and is
 * the point. docs/design/11-followers.md#they-have-no-abilities-deliberately
 * rules out a follower touching hearts, smudge, the cloud, drops, the score or
 * the gate, and the reason is not taste: the smudge ramp was measured against a
 * beginner's error rate and re-opening it took an argument and a test once
 * already (ADR 0005, and the ramp invariant in
 * docs/design/03-pacing.md#the-ramp-must-not-outrun-the-gate). A rule that is
 * only observed is a rule that lasts until the next person has a good idea, so
 * three of the tests below are arrangements rather than observations:
 *
 *  - the module's own import list, read back from the file;
 *  - the shape of a pose, which has nowhere to write a bonus;
 *  - and the display list itself, drawn twice, with a full party and with none,
 *    and asserted to differ only by the figures.
 *
 * The rest is geometry: behind the scribe, on the ground line, out of the rail's
 * way, and capped — docs/design/11-followers.md#they-must-not-compete-with-the-rail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EMPTY_LINE,
  followerCountX,
  followerLine,
  followerPoses,
  loadFollowers,
  party,
  type Follower,
  type FollowerGeometry,
} from './followers.js';
import { VIRTUAL_W, drawFrame, sceneLayout, type FrameState, type SceneState } from './draw.js';
import { createRail, layoutRail } from './rail.js';
import { createCloud, createEntity } from './entities.js';
import { createDamage } from './damage.js';
import { SPRITE_SIZE, spriteFor } from './sprites.js';
import { DEFAULT_THEME } from './worlds.js';
import { classify } from './illumination.js';
import { arriveAt, completePassage, createMap, discoverSecret, loadRoute, nodeRefs } from './route.js';
import { loadTuning } from './tuning.js';
import type { DrawCmd, Glyph, Key, Score, Tuning } from './types.js';

function readRepoFile(rel: string): string {
  for (const base of ['../../', '../']) {
    try {
      return readFileSync(new URL(base + rel, import.meta.url), 'utf8');
    } catch {
      continue;
    }
  }
  throw new Error(`test: cannot locate ${rel}`);
}

const TUNING: Tuning = loadTuning(JSON.parse(readRepoFile('data/tuning.json')) as unknown);
const ROUTE = loadRoute(JSON.parse(readRepoFile('data/routes/pilgrimage.json')) as unknown);
const ROSTER = loadFollowers(JSON.parse(readRepoFile('data/followers.json')) as unknown);

const LAYOUT = sceneLayout(DEFAULT_THEME, TUNING);
const RAIL_TOP = LAYOUT.top + LAYOUT.height;

const KEYS: readonly Key[] = ['f', 'j', '<space>', 'a', 's', 'd', 'g', 'h', 'k', 'l', ';'];
const GLYPHS: Glyph[] = [...classify('a lad shall fall;', new Set(KEYS), 'ansi', 'rt')];
const SCORE: Score = { wpm: 0, accuracy: 1, medianLatencyMs: 0 };

/** Every passage the route names, in the order the map lays them out. */
const NODES = nodeRefs(ROUTE);

/** A map state standing nowhere, with these passages behind the player. */
function stateWith(done: readonly string[], found: readonly string[] = []) {
  let state = arriveAt(createMap(ROUTE), '');
  for (const ref of done) state = completePassage(state, ref);
  for (const ref of found) state = discoverSecret(state, ref);
  return state;
}

function fullParty(): readonly Follower[] {
  return party(ROSTER, ROUTE, stateWith(NODES));
}

function geometry(over: Partial<FollowerGeometry> = {}): FollowerGeometry {
  return {
    scribeX: LAYOUT.scribeX,
    groundY: LAYOUT.groundY,
    walking: true,
    animMs: 0,
    ...over,
  };
}

function scene(over: Partial<SceneState> = {}): SceneState {
  return {
    theme: DEFAULT_THEME,
    cameraX: 0,
    walking: true,
    animMs: 0,
    scribe: createEntity('scribe', 'scribe', LAYOUT.scribeX, LAYOUT.groundY - SPRITE_SIZE),
    entities: [
      createEntity('bat-0', 'bat', 200, LAYOUT.groundY - SPRITE_SIZE * 2, 0, -1), // tuning-exempt: test fixture placement
      createEntity('skel-0', 'skeleton', 420, LAYOUT.groundY - SPRITE_SIZE, 0, -1), // tuning-exempt: test fixture placement
    ],
    cloud: createCloud(),
    damage: createDamage(TUNING),
    heartsMax: TUNING['hearts_max'] ?? 0,
    candles: [{ x: 0, lit: true }, { x: 900, lit: false }], // tuning-exempt: test fixture placement
    strikes: [],
    ...over,
  };
}

function frame(over: Partial<FrameState> = {}): FrameState {
  return {
    mode: 'level',
    ref: 'Genesis 1:1  part 1/2',
    stage: 1,
    glyphs: GLYPHS,
    cursor: 4, // tuning-exempt: test fixture, a cursor part-way along the line
    blocked: false,
    score: SCORE,
    keyStats: {},
    layout: 'ansi',
    keySet: KEYS,
    scene: scene(),
    ...over,
  };
}

function draw(state: FrameState): DrawCmd[] {
  const target = layoutRail(state.glyphs, state.cursor, VIRTUAL_W, TUNING).offset;
  return drawFrame(state, createRail(target), TUNING);
}

/** Every sprite id a follower body or mark can be drawn as. */
const FIGURE_IDS: ReadonlySet<string> = new Set(
  fullParty().flatMap((f) => [f.bodyId, f.markId]),
);

function isFigure(cmd: DrawCmd): boolean {
  return cmd.op === 'sprite' && FIGURE_IDS.has(cmd.id);
}

// --- the roster --------------------------------------------------------------

test('EVERY PASSAGE ON THE ROUTE HAS A FIGURE, AND NO TWO SHARE ONE', () => {
  // A route edge added without a figure is a passage that finishes and leaves
  // nothing behind, which is the whole hole this feature fills.
  const rows = new Map(ROSTER.rows.map((row) => [row.ref, row]));
  for (const ref of NODES) {
    assert.ok(rows.has(ref), `no figure joins after ${ref}`);
  }
  for (const row of ROSTER.rows) {
    assert.ok(NODES.includes(row.ref), `${row.who} joins after ${row.ref}, which is not on the route`);
  }
  assert.equal(rows.size, ROSTER.rows.length, 'two figures claim one passage');
});

test('every figure names art the game actually holds', () => {
  for (const follower of fullParty()) {
    assert.ok(spriteFor(follower.bodyId) !== null, `no body "${follower.bodyId}"`);
    assert.ok(spriteFor(follower.markId) !== null, `no mark "${follower.markId}"`);
  }
});

test('a roster naming art that does not exist throws rather than walking empty-handed', () => {
  const bad = { followers: [{ passage: 'Genesis 1', who: 'Eve', body: 'bare', cloth: 'light', mark: 'anchor' }] };
  assert.throws(() => loadFollowers(bad), /anchor/);
  assert.throws(() => loadFollowers({ followers: 'no' }), /followers/);
  assert.throws(
    () => loadFollowers({
      followers: [
        { passage: 'Genesis 1', who: 'Eve', body: 'bare', cloth: 'light', mark: 'shoot' },
        { passage: 'Genesis 1', who: 'Adam', body: 'bare', cloth: 'robe', mark: 'hoe' },
      ],
    }),
    /two figures/,
  );
});

// --- who joins ---------------------------------------------------------------

test('a passage finished adds exactly one figure, and finishing it twice adds none', () => {
  assert.equal(party(ROSTER, ROUTE, stateWith([])).length, 0);
  const one = party(ROSTER, ROUTE, stateWith(['Genesis 1']));
  assert.equal(one.length, 1);
  assert.equal(one[0]?.ref, 'Genesis 1');
  assert.equal(party(ROSTER, ROUTE, stateWith(['Genesis 1', 'Genesis 1'])).length, 1);
});

test('A ROOM FOUND ADDS ITS FIGURE TOO: a secret leaves a visible trace', () => {
  // "Currently a secret room leaves no visible trace once you have left it, and
  // this is the natural one." Finding it is the achievement; walking back out is
  // not a way to lose it, which is why `discovered` exists at all.
  const found = party(ROSTER, ROUTE, stateWith([], ['Genesis 22']));
  assert.deepEqual(found.map((f) => f.ref), ['Genesis 22']);
  assert.equal(found[0]?.who, 'Abraham');
});

test('the party is derived from the record and nothing else is stored', () => {
  // Two states built from the same finished passages must produce the same
  // party, whatever order they were written in -- that is what "derived" buys,
  // and it is why there is no schema bump and nothing that can drift.
  const forwards = party(ROSTER, ROUTE, stateWith(['Genesis 1', 'Exodus 3'], ['Jonah 1']));
  const backwards = party(ROSTER, ROUTE, stateWith(['Exodus 3', 'Genesis 1'], ['Jonah 1']));
  assert.deepEqual(forwards, backwards);
  // And it is the route's order, which is the map's order: see
  // docs/design/11-followers.md#derived-never-stored.
  assert.deepEqual(forwards.map((f) => f.ref), ['Genesis 1', 'Exodus 3', 'Jonah 1']);
});

test('the whole route gathers the whole company', () => {
  assert.equal(fullParty().length, NODES.length);
});

// --- the cap -----------------------------------------------------------------

test('THE LINE IS CAPPED, AND WHAT IS OVER THE CAP IS COUNTED RATHER THAN LOST', () => {
  const cap = TUNING['follower_line_max'] ?? 0;
  const all = fullParty();
  assert.ok(all.length > cap, 'the route is too short to test the cap');
  const line = followerLine(all, TUNING);
  assert.equal(line.walking.length, cap);
  assert.equal(line.unseen, all.length - cap);
  // The earliest on the route walk on ahead; the latest walk nearest to him.
  assert.deepEqual(
    [...line.walking].reverse().map((f) => f.ref),
    all.slice(all.length - cap).map((f) => f.ref),
  );
  // Under the cap nothing is hidden and nothing is counted.
  const few = followerLine(all.slice(0, 2), TUNING);
  assert.equal(few.unseen, 0);
  assert.equal(few.walking.length, 2);
});

// --- where they walk ---------------------------------------------------------

test('THEY WALK BEHIND THE SCRIBE, NEVER AHEAD AND NEVER OVER HIM', () => {
  const line = followerLine(fullParty(), TUNING);
  const poses = followerPoses(line, geometry(), TUNING);
  let previous = LAYOUT.scribeX;
  for (const pose of poses) {
    assert.ok(pose.x < LAYOUT.scribeX, `a follower at ${String(pose.x)} is not behind the scribe`);
    assert.ok(pose.x < previous, 'two followers are out of order');
    // Wider than a sprite, so no figure is drawn on top of another.
    assert.ok(previous - pose.x >= SPRITE_SIZE, 'the line overlaps itself');
    previous = pose.x;
  }
  assert.ok(followerCountX(line, geometry(), TUNING) < previous, 'the count is not at the tail');
});

test('their feet are on the ground line at every animation time, walking or idle', () => {
  const line = followerLine(fullParty(), TUNING);
  const floor = LAYOUT.groundY - SPRITE_SIZE;
  for (const walking of [true, false]) {
    for (let ms = 0; ms < 4000; ms += 37) { // tuning-exempt: a sweep of the animation clock
      for (const pose of followerPoses(line, geometry({ walking, animMs: ms }), TUNING)) {
        assert.equal(pose.y, floor, `a follower left the ground line at ${String(ms)} ms`);
      }
    }
  }
});

test('walking cycles the walk frames and idling cycles the idle frames, and never the other way', () => {
  const line = followerLine(fullParty(), TUNING);
  const framesOf = (walking: boolean): Set<number> => {
    const seen = new Set<number>();
    for (let ms = 0; ms < 4000; ms += 17) { // tuning-exempt: a sweep of the animation clock
      for (const pose of followerPoses(line, geometry({ walking, animMs: ms }), TUNING)) {
        seen.add(pose.frame);
      }
    }
    return seen;
  };
  assert.deepEqual([...framesOf(true)].sort(), [0, 1]);
  assert.deepEqual([...framesOf(false)].sort(), [2, 3]); // tuning-exempt: frame indices of the art
});

test('a pose has five fields, and there is nowhere to write an ability', () => {
  // The same argument `Strike` makes in core/entities.ts: a record with no field
  // for a bonus cannot carry one, whatever anybody later decides they want.
  const pose = followerPoses(followerLine(fullParty(), TUNING), geometry(), TUNING)[0];
  assert.ok(pose !== undefined);
  assert.deepEqual(Object.keys(pose).sort(), ['bodyId', 'frame', 'markId', 'x', 'y']);
});

// --- the frame ---------------------------------------------------------------

test('THE COMPANY CHANGES NOTHING ELSE IN THE FRAME, COMMAND FOR COMMAND', () => {
  // The load-bearing test in this file. Draw the identical state twice, once
  // with everybody and once with nobody, and take the figures out of the first:
  // what is left has to be the second, exactly. Hearts, the smudge meter, the
  // rail, the caret, the monsters, the candles, the cloud and the keyboard all
  // come out unchanged, because nothing about a follower reaches any of them.
  const without = draw(frame());
  const with_ = draw(frame({ followers: followerLine(fullParty(), TUNING) }));
  const stripped = with_.filter(
    (cmd) => !isFigure(cmd) && !(cmd.op === 'text' && /^\+\d+$/.test(cmd.value)),
  );
  assert.deepEqual(stripped, without);
});

test('an absent party draws byte-for-byte the frame the game always drew', () => {
  assert.deepEqual(draw(frame({ followers: EMPTY_LINE })), draw(frame()));
});

test('THE CURSOR DOES NOT MOVE WHEN THE COMPANY ARRIVES', () => {
  // docs/design/02-rail.md#the-focal-guide. The one invariant everything else in
  // the game is placed around.
  const caret = (cmds: readonly DrawCmd[]): number => {
    for (const cmd of cmds) if (cmd.op === 'line' && cmd.x1 === cmd.x2) return cmd.x1;
    throw new Error('no caret in the frame');
  };
  const alone = caret(draw(frame()));
  for (let n = 1; n <= NODES.length; n++) {
    const company = party(ROSTER, ROUTE, stateWith(NODES.slice(0, n)));
    assert.equal(caret(draw(frame({ followers: followerLine(company, TUNING) }))), alone);
  }
});

test('nothing a follower draws reaches the reading band, the strip under it, or the HUD', () => {
  const cmds = draw(frame({ followers: followerLine(fullParty(), TUNING) }));
  const drawn = cmds.filter(
    (cmd): cmd is Extract<DrawCmd, { op: 'sprite' } | { op: 'text' }> =>
      isFigure(cmd) || (cmd.op === 'text' && /^\+\d+$/.test(cmd.value)),
  );
  assert.ok(drawn.length > 0, 'nobody was drawn at all');
  for (const cmd of drawn) {
    const bottom = cmd.op === 'sprite' ? cmd.y + SPRITE_SIZE : cmd.y;
    assert.ok(cmd.y >= LAYOUT.top, 'a follower reached up into the HUD');
    assert.ok(bottom <= RAIL_TOP, 'a follower reached down into the reading band');
    assert.ok(cmd.x >= -SPRITE_SIZE && cmd.x < VIRTUAL_W, 'a follower was drawn off the screen');
  }
});

test('a follower is two sprite commands and nothing else: a body, and the thing it carries', () => {
  const cmds = draw(frame({ followers: followerLine(fullParty(), TUNING) }));
  const figures = cmds.filter(isFigure);
  const cap = TUNING['follower_line_max'] ?? 0;
  assert.equal(figures.length, cap * 2);
  // Both halves of a figure are drawn at the same place, so the mark is carried
  // rather than floating beside somebody it does not belong to.
  for (let i = 0; i < figures.length; i += 2) {
    const body = figures[i];
    const mark = figures[i + 1];
    assert.ok(body?.op === 'sprite' && mark?.op === 'sprite');
    assert.equal(body.x, mark.x);
    assert.equal(body.y, mark.y);
  }
  // No text over anybody: the only string is the count of who is not here.
  const said = cmds.filter((cmd) => cmd.op === 'text' && cmd.y < RAIL_TOP && cmd.y > LAYOUT.top);
  for (const cmd of said) {
    assert.ok(cmd.op === 'text' && /^\+\d+$/.test(cmd.value), `a follower is speaking: "${cmd.op === 'text' ? cmd.value : ''}"`);
  }
});

test('the count says how many walked on ahead, and is absent when nobody has', () => {
  const counted = (n: number): string | null => {
    const company = party(ROSTER, ROUTE, stateWith(NODES.slice(0, n)));
    const cmds = draw(frame({ followers: followerLine(company, TUNING) }));
    for (const cmd of cmds) if (cmd.op === 'text' && /^\+\d+$/.test(cmd.value)) return cmd.value;
    return null;
  };
  const cap = TUNING['follower_line_max'] ?? 0;
  assert.equal(counted(cap), null);
  assert.equal(counted(cap + 3), '+3'); // tuning-exempt: test fixture -- three over the cap
});

// --- the arrangement ---------------------------------------------------------

test('CORE/FOLLOWERS.TS CANNOT REACH A MECHANIC, BY ITS IMPORT LIST', () => {
  /*
   * The structural half of "they have no abilities". A follower cannot touch
   * hearts, smudge, the cloud, drops, the score or the gate because this module
   * has no way to name any of them -- and that is checked here rather than
   * remembered, because the next person to have the idea will be reading the
   * design doc, not this comment.
   */
  const source = readRepoFile('core/followers.ts');
  const imports = [...source.matchAll(/from '\.\/([\w.]+)\.js'/g)].map((m) => m[1]);
  const allowed = new Set(['route', 'sprites', 'tuning', 'types', 'entities']);
  for (const name of imports) {
    assert.ok(name !== undefined && allowed.has(name), `core/followers.ts imports ${String(name)}`);
  }
  for (const forbidden of ['damage', 'items', 'progress', 'typing', 'curriculum', 'sim']) {
    assert.ok(!imports.includes(forbidden), `core/followers.ts imports ${forbidden}`);
  }
  // `entities` is on the list for one animation helper and must stay that way:
  // it also holds the blot-cloud, and a follower has no business near it.
  const fromEntities = /import \{([^}]*)\} from '\.\/entities\.js'/.exec(source)?.[1] ?? '';
  assert.deepEqual(fromEntities.split(',').map((s) => s.trim()).filter(Boolean), ['frameAt']);
});
