/**
 * The squint test.
 *
 * @doc docs/architecture/display-list.md#testing
 *
 * At 16x16 the only thing a player resolves is the silhouette, and the only way
 * to know a silhouette is right is to look at it. So the art is rendered back to
 * the characters it was written in and compared against a picture committed
 * here: any change to a sprite shows up in a diff as a change to *the picture*,
 * which is reviewable by eye in a way that a byte count never is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BURST_FRAMES,
  CANDLE_UNLIT_FRAME,
  HOP_BOUNCE,
  HOP_CONTACT,
  HOP_FRAMES,
  HOP_RISE,
  INK_BURST_FRAMES,
  NIB_FRAMES,
  INK_CHARS,
  NONE,
  PALETTE_ROLES,
  SPRITES,
  SPRITE_SIZE,
  decodeFrame,
  frameIndex,
  pixelAt,
  spriteFor,
  toAscii,
  toSilhouette,
} from './sprites.js';

/**
 * The tiles a level's floor can be built from. Every pixel of one is painted,
 * because the sky is drawn behind the scenery and a transparent pixel here is a
 * hole the scribe walks over.
 */
const SOLID_TILES: readonly string[] = [
  'tile_stone', 'tile_grass', 'tile_sand',
  'tile_water', 'tile_brick', 'tile_bone', 'tile_rubble', 'tile_deep',
];

/**
 * The tiles that stand in the middle and far distance, where the sky showing
 * through is the whole point: a ridge line is the shape of what it leaves out.
 */
const DISTANCE_TILES: readonly string[] = [
  'tile_dune', 'tile_wave', 'tile_peak', 'tile_roofs',
  'tile_pillars', 'tile_arch', 'tile_foliage', 'tile_cloud',
  'tile_swell', 'tile_stars',
];

/** Everything the game names. A missing id is a sprite that cannot be drawn. */
const REQUIRED: readonly string[] = [
  'scribe_idle', 'scribe_walk', 'scribe_strike', 'scribe_hop',
  'nib', 'ink_burst', 'bat', 'skeleton', 'burst', 'blot_cloud',
  'candle', 'ink_pot', 'heart_full', 'heart_empty',
  ...SOLID_TILES, ...DISTANCE_TILES,
];

function art(id: string) {
  const sprite = spriteFor(id);
  assert.ok(sprite !== null, `no sprite "${id}"`);
  return sprite;
}

function inked(id: string, frame: number): number {
  const sprite = art(id);
  let count = 0;
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) if (pixelAt(sprite, frame, x, y) !== NONE) count += 1;
  }
  return count;
}

/** The row a column's ink starts on, or `SPRITE_SIZE` if nothing is painted in it. */
function topOf(id: string, x: number): number {
  const sprite = art(id);
  for (let y = 0; y < sprite.h; y++) if (pixelAt(sprite, 0, x, y) !== NONE) return y;
  return sprite.h;
}

/** How many painted pixels a row has. */
function widthAt(id: string, y: number): number {
  const sprite = art(id);
  let count = 0;
  for (let x = 0; x < sprite.w; x++) if (pixelAt(sprite, 0, x, y) !== NONE) count += 1;
  return count;
}

/**
 * How many separate crests a distance tile has: runs of columns whose ink starts
 * on the highest row in the tile.
 *
 * The one measurable difference between sand and water. A dune is a single slow
 * swell and a wave is a fast repeating one, and at 16 pixels that frequency is
 * the whole of what tells them apart -- paint a dune blue and it is still a hill.
 */
function crests(id: string): number {
  const tops = Array.from({ length: SPRITE_SIZE }, (_, x) => topOf(id, x));
  const highest = Math.min(...tops);
  let runs = 0;
  let inRun = false;
  for (const top of tops) {
    if (top === highest && !inRun) runs += 1;
    inRun = top === highest;
  }
  return runs;
}

/** The ink character a named art role is written with. */
function ink(role: string): string {
  return INK_CHARS.charAt(PALETTE_ROLES.indexOf(role));
}

test('every sprite the game names exists and decodes to a full 16x16 grid', () => {
  for (const id of REQUIRED) {
    const sprite = art(id);
    assert.equal(sprite.w, SPRITE_SIZE);
    assert.equal(sprite.h, SPRITE_SIZE);
    assert.ok(sprite.frames.length > 0, `${id} has no frames`);
    for (const frame of sprite.frames) {
      assert.equal(frame.length, SPRITE_SIZE * SPRITE_SIZE, `${id} frame is not 16x16`);
      for (const index of frame) {
        assert.ok(index >= 0 && index < PALETTE_ROLES.length, `${id} uses palette index ${String(index)}`);
      }
    }
  }
});

test('the ink alphabet lines up with the palette roles, one character each', () => {
  assert.equal(INK_CHARS.length, PALETTE_ROLES.length);
  assert.equal(new Set(INK_CHARS).size, INK_CHARS.length);
  assert.equal(INK_CHARS.indexOf('.'), NONE);
});

test('a mis-sized or mis-spelled frame throws rather than shearing the picture', () => {
  const rows = Array.from({ length: SPRITE_SIZE }, () => '.'.repeat(SPRITE_SIZE));
  assert.doesNotThrow(() => decodeFrame('ok', rows));
  assert.throws(() => decodeFrame('short', rows.slice(1)), /rows/);
  assert.throws(() => decodeFrame('narrow', [rows[0]?.slice(1) ?? '', ...rows.slice(1)]), /wide/);
  assert.throws(() => decodeFrame('typo', ['?'.repeat(SPRITE_SIZE), ...rows.slice(1)]), /unknown ink/);
});

// --- the pictures -----------------------------------------------------------

test('the scribe reads as a hooded figure holding a quill', () => {
  assert.equal(toAscii(art('scribe_idle'), 0), [
    '................',
    '.....KKKKK......',
    '....KrrrrrKK.WW.',
    '....KrrrrrrK.LW.',
    '....KrSSSSrK.L..',
    '....KrSKSKrK.L..',
    '....KrSSSSrK.L..',
    '.....KSSSSK..L..',
    '....KKRRRRKK.L..',
    '...KRRRRRRRRKA..',
    '..KRRRRRRRRRRK..',
    '..KRRRRRRRRRRK..',
    '..KRRRRRRRRRRK..',
    '...KRRRRRRRRK...',
    '...KKKK..KKKK...',
    '................',
  ].join('\n'));

  // The shape, without the shading: a head, a body wider than the head, two
  // feet, and a quill standing clear of the figure on the right.
  assert.equal(toSilhouette(art('scribe_idle'), 0), [
    '................',
    '.....KKKKK......',
    '....KKKKKKKK.KK.',
    '....KKKKKKKK.KK.',
    '....KKKKKKKK.K..',
    '....KKKKKKKK.K..',
    '....KKKKKKKK.K..',
    '.....KKKKKK..K..',
    '....KKKKKKKK.K..',
    '...KKKKKKKKKKK..',
    '..KKKKKKKKKKKK..',
    '..KKKKKKKKKKKK..',
    '..KKKKKKKKKKKK..',
    '...KKKKKKKKKK...',
    '...KKKK..KKKK...',
    '................',
  ].join('\n'));
});

test('the bat reads as a winged silhouette, wings up and wings down', () => {
  assert.equal(toSilhouette(art('bat'), 0), [
    '................',
    'KK............KK',
    'KKK..........KKK',
    'KKKK........KKKK',
    'KKKKK..KK..KKKKK',
    '.KKKKKKKKKKKKKK.',
    '..KKKKKKKKKKKK..',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '....KKKKKKKK....',
    '.....KKKKKK.....',
    '......KKKK......',
    '.......KK.......',
    '................',
    '................',
    '................',
  ].join('\n'));
  // The flap has to move the wings, not merely redraw them.
  assert.notEqual(toSilhouette(art('bat'), 0), toSilhouette(art('bat'), 1));
});

test('a heart reads as a heart, full or empty, and they share a silhouette', () => {
  assert.equal(toAscii(art('heart_full'), 0), [
    '................',
    '....KKK..KKK....',
    '...KBBBKKBBBK...',
    '..KBWBBBBBBBBK..',
    '..KBWBBBBBBBBK..',
    '..KBBBBBBBBBBK..',
    '..KBBBBBBBBBBK..',
    '..KbBBBBBBBBbK..',
    '...KbBBBBBBbK...',
    '....KbBBBBbK....',
    '.....KbBBbK.....',
    '......KbbK......',
    '.......KK.......',
    '................',
    '................',
    '................',
  ].join('\n'));
  // A lost heart is the same outline with nothing in it: the HUD must read as
  // "three hearts, one gone", never as "two hearts".
  assert.ok(inked('heart_empty', 0) < inked('heart_full', 0));
  const outline = toSilhouette(art('heart_empty'), 0).split('\n');
  const full = toSilhouette(art('heart_full'), 0).split('\n');
  for (const [y, row] of outline.entries()) {
    const solid = full[y] ?? '';
    for (const [x, ch] of [...row].entries()) {
      if (ch !== '.') assert.equal(solid[x], ch, `empty heart leaks outside the full one at ${String(x)},${String(y)}`);
    }
  }
});

test('the candle has a flame with a bright core, and it flickers', () => {
  const flame = INK_CHARS.indexOf('F');
  assert.ok(toAscii(art('candle'), 0).includes(INK_CHARS.charAt(flame)));
  assert.notEqual(toAscii(art('candle'), 0), toAscii(art('candle'), 1));
  // Only the flame moves: the stick and the holder are identical between frames.
  const held = (frame: number): string => toAscii(art('candle'), frame).split('\n').slice(6).join('\n');   // tuning-exempt: test fixture, not a game tunable
  assert.equal(held(0), held(1));
});

test('the blot-cloud grows from far, to overhead, to dripping', () => {
  const far = inked('blot_cloud', 0);
  const near = inked('blot_cloud', 1);
  const strike = inked('blot_cloud', 2);
  assert.ok(far < near, 'the far cloud must be smaller than the near one');
  assert.ok(near < strike, 'the striking cloud must add the drip');
  // The drip has to reach the bottom of the cell, or it reads as a smaller cloud
  // rather than as ink falling on the page.
  const bottom = toSilhouette(art('blot_cloud'), 2).split('\n')[SPRITE_SIZE - 1] ?? '';
  assert.ok(bottom.includes('K'));
});

test('ground tiles fill their cell, and distance tiles deliberately do not', () => {
  for (const id of SOLID_TILES) {
    assert.equal(inked(id, 0), SPRITE_SIZE * SPRITE_SIZE, `${id} has a transparent pixel`);
  }
  for (const id of DISTANCE_TILES) {
    assert.ok(inked(id, 0) < SPRITE_SIZE * SPRITE_SIZE, `${id} lets no sky through, so it is a floor`);
    assert.ok(inked(id, 0) > 0, `${id} is nothing but sky`);
  }
});

test('a dark in the distance is drawn in outline, because shade is the sky', () => {
  // `core/draw.ts` lays a themed rect in the `shade` role behind the parallax,
  // so a dark drawn in `shade` is invisible against the sky it stands in front
  // of -- a shadowed mountain face painted that way is a mountain cut in half.
  // The one exception is deliberate and is the same fact used forwards: the dabs
  // in the canopy are the sky, seen through the leaves.
  const sky = ink('shade');
  for (const id of DISTANCE_TILES) {
    if (id === 'tile_foliage') continue;
    assert.ok(!toAscii(art(id), 0).includes(sky), `${id} draws in the sky's own colour`);
  }
  assert.ok(toAscii(art('tile_foliage'), 0).includes(sky));
});

test('no two tiles are the same picture', () => {
  // The reason the art below exists. Ten themes over one silhouette is ten
  // lightings of the same room, and a tile that duplicates another is a theme
  // that has not actually been given anywhere to be.
  const seen = new Map<string, string>();
  for (const id of [...SOLID_TILES, ...DISTANCE_TILES]) {
    const drawn = toAscii(art(id), 0);
    const first = seen.get(drawn);
    assert.equal(first, undefined, `${id} is ${String(first)} redrawn`);
    seen.set(drawn, id);
  }
});

test('the skeleton keeps its skull still and rattles the rest', () => {
  assert.notEqual(toSilhouette(art('skeleton'), 0), toSilhouette(art('skeleton'), 1));
  assert.ok(inked('skeleton', 0) > SPRITE_SIZE, 'the skeleton is too sparse to read');
});

// --- the tiles --------------------------------------------------------------

test('water is a lit surface, and every mark in it runs across', () => {
  // Horizontal by construction. A surface is the one thing water has that stone
  // has not, and a dash running any other way reads as a crack.
  assert.equal(toAscii(art('tile_water'), 0), [
    'GGGGGGGGGGGGGGGG',
    'GGGWWGGGGGWWGGGG',
    'gggggggggggggggg',
    'ggGGGGGgggGGGGGg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'GGGGgggGGGGGgggG',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'ggGGGGGGgggGGGgg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'GGgggGGGGGgggGGG',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'ggGGGGgggGGGGGgg',
  ].join('\n'));
});

test('brick repeats on a bond, and rubble deliberately does not', () => {
  assert.equal(toAscii(art('tile_brick'), 0), [
    'KKKKKKKKKKKKKKKK',
    'LLLLLLLKLLLLLLLL',
    'MMMMMMMKMMMMMMMM',
    'DDDDDDDKDDDDDDDD',
    'KKKKKKKKKKKKKKKK',
    'LLLKLLLLLLLKLLLL',
    'MMMKMMMMMMMKMMMM',
    'DDDKDDDDDDDKDDDD',
    'KKKKKKKKKKKKKKKK',
    'LLLLLLLKLLLLLLLL',
    'MMMMMMMKMMMMMMMM',
    'DDDDDDDKDDDDDDDD',
    'KKKKKKKKKKKKKKKK',
    'LLLKLLLLLLLKLLLL',
    'MMMKMMMMMMMKMMMM',
    'DDDKDDDDDDDKDDDD',
  ].join('\n'));

  // Brick is a bond: the courses agree, so the second half of the cell is the
  // first half again. That regularity is the whole difference from the stone
  // tile, which is three tall courses jointed wherever the mason found one.
  const half = SPRITE_SIZE / 2;
  const brick = toAscii(art('tile_brick'), 0).split('\n');
  for (const [y, row] of brick.entries()) {
    if (y + half < brick.length) assert.equal(row, brick[y + half], 'the bond does not repeat');
  }
  assert.notEqual(toAscii(art('tile_brick'), 0), toAscii(art('tile_stone'), 0));
});

test('rubble is broken, which is to say its courses do not line up', () => {
  assert.equal(toAscii(art('tile_rubble'), 0), [
    'KGGGKKKKGGGGKKKK',
    'KgggKGGGggggKKGG',
    'KgggKgggggggKKgg',
    'KKKKKgggKKKKKKgg',
    'KKGGGGKKKKKGGGKK',
    'KKggggKGGGKgggKK',
    'KKggggKgggKgggKK',
    'KKKKKKKgggKKKKKK',
    'GGGKKKKKKGGGKKKK',
    'gggKGGGGKgggKGGG',
    'gggKggggKgggKggg',
    'KKKKggggKKKKKggg',
    'KGGGGKKKKKGGGKKK',
    'KggggKGGGKgggKGG',
    'KggggKgggKgggKgg',
    'KKKKKKgggKKKKKgg',
  ].join('\n'));

  // If the courses ever agreed this would be a second brick wall in a different
  // palette. Chips that begin and end on different rows are the only thing
  // keeping it broken.
  const half = SPRITE_SIZE / 2;
  const rubble = toAscii(art('tile_rubble'), 0).split('\n');
  assert.notEqual(rubble[0], rubble[half]);
});

test('bone is stacked bone: bright at the joint, dull along the shaft', () => {
  // Deliberately not skulls. A face at this size pulls the eye straight off the
  // rail, and the scenery's whole job is to say where the scribe is and then
  // stay behind him.
  assert.equal(toAscii(art('tile_bone'), 0), [
    'DDDDDDDDDDDDDDDD',
    'WWDDDDDDWWDDDDDD',
    'WWLLLLLLWWLLLLLL',
    'WWDDDDDDWWDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDWWDDDDDDWWDD',
    'LLLLWWLLLLLLWWLL',
    'DDDDWWDDDDDDWWDD',
    'DDDDDDDDDDDDDDDD',
    'WWDDDDDDWWDDDDDD',
    'WWLLLLLLWWLLLLLL',
    'WWDDDDDDWWDDDDDD',
    'DDDDDDDDDDDDDDDD',
    'DDDDWWDDDDDDWWDD',
    'LLLLWWLLLLLLWWLL',
    'DDDDWWDDDDDDWWDD',
  ].join('\n'));
  const drawn = toAscii(art('tile_bone'), 0);
  assert.ok(drawn.includes(ink('highlight')), 'the joints have to catch the light');
  assert.ok(drawn.includes(ink('light')), 'the shaft has to be duller than the joints');
});

test('the dune crests once in the cell and troughs at the seam', () => {
  assert.equal(toAscii(art('tile_dune'), 0), [
    '................',
    '................',
    '................',
    '......GGG.......',
    '....GGGGGG......',
    '...GGGGGGGGG....',
    '.GGGGGGGGGGGGGG.',
    'GGGGGGGGGGGGGGGG',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggggggGGGGGgggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
  ].join('\n'));

  // Tiles repeat, so the shape has to meet its own left and right edge. A crest
  // that stopped short at the seam would run as a row of steps.
  assert.equal(topOf('tile_dune', 0), topOf('tile_dune', SPRITE_SIZE - 1));
  assert.equal(crests('tile_dune'), 1);
});

test('waves crest more often than dunes, and carry foam where they break', () => {
  assert.equal(toAscii(art('tile_wave'), 0), [
    '................',
    '................',
    '................',
    '................',
    '...WW......WW...',
    '..WGGW....WGGW..',
    '.WGGGGW..WGGGGW.',
    'WGGGGGGWWGGGGGGW',
    'GGGGGGGGGGGGGGGG',
    'gggggggggggggggg',
    'gggggggggggggggg',
    'ggGGGGggggGGGGgg',
    'gggggggggggggggg',
    'gggggGGGGGGggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
  ].join('\n'));

  assert.equal(topOf('tile_wave', 0), topOf('tile_wave', SPRITE_SIZE - 1));
  assert.ok(crests('tile_wave') > crests('tile_dune'), 'water at the frequency of sand is a hill');
  assert.ok(toAscii(art('tile_wave'), 0).includes(ink('highlight')), 'no foam on the crest');
});

test('the peak is capped, shadowed down one side, and never overhangs', () => {
  assert.equal(toAscii(art('tile_peak'), 0), [
    '................',
    '................',
    '.......WW.......',
    '.......WW.......',
    '......WWWW......',
    '.....WWWWWW.....',
    '.....LWWWWM.....',
    '....LLWWWWMM....',
    '...LLLLLLMMMM...',
    '...LLLLLLMMMM...',
    '..LLLLLLLMMMMM..',
    '.LLLLLLLLMMMMMM.',
    '.LLLLLLLLMMMMMM.',
    'LLLLLLLLLMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
  ].join('\n'));

  // A mountain that got narrower on the way down would be a spike balanced on
  // its point, so the painted width may never shrink as the cell descends.
  let previous = 0;
  for (let y = 0; y < SPRITE_SIZE; y++) {
    const width = widthAt('tile_peak', y);
    assert.ok(width >= previous, 'the peak overhangs itself');
    previous = width;
  }
  const drawn = toAscii(art('tile_peak'), 0);
  assert.ok(drawn.includes(ink('highlight')), 'the cap is what makes it a mountain');
  assert.ok(drawn.includes(ink('light')) && drawn.includes(ink('mid')), 'a lit face and a shadowed one');
});

test('the skyline has something taller than the roofs standing in it', () => {
  assert.equal(toAscii(art('tile_roofs'), 0), [
    '................',
    '................',
    '....L.L.........',
    '....LLL.........',
    '....MMM.........',
    '....MMM...LLLL..',
    'LLLLMMM...MMMM..',
    'MMMMMMM...MMMMLL',
    'MMMMMMMLLLMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMKMMMMKMMMMKMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
  ].join('\n'));

  // Roofs at one height read as a wall. The tower is what says a city was built
  // here rather than fortified, so something has to stand clear of the rest.
  const tops = Array.from({ length: SPRITE_SIZE }, (_, x) => topOf('tile_roofs', x));
  assert.ok(Math.min(...tops) < topOf('tile_roofs', 0), 'nothing rises above the near roof');
});

test('the colonnade stands its columns clear of the sky', () => {
  assert.equal(toAscii(art('tile_pillars'), 0), [
    'LLLLLLLLLLLLLLLL',
    'MMMMMMMMMMMMMMMM',
    'KKKKKKKKKKKKKKKK',
    '.LLLLLL..LLLLLL.',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '..LMMK....LMMK..',
    '.LMMMMK..LMMMMK.',
    '.MMMMMM..MMMMMM.',
    'MMMMMMMMMMMMMMMM',
  ].join('\n'));

  // The sky between them is what makes them columns instead of stripes, and the
  // shafts run the full height so a band deeper than one tile stacks into a
  // storey rather than into a fence.
  const shaft = toSilhouette(art('tile_pillars'), 0).split('\n')[SPRITE_SIZE / 2] ?? '';
  assert.ok(shaft.includes('.'), 'no daylight between the columns');
  assert.ok(shaft.includes(INK_CHARS.charAt(1)), 'no columns');
  assert.equal(widthAt('tile_pillars', 0), SPRITE_SIZE, 'the architrave has to run right across');
});

test('the arcade is an opening cut out of a wall, not a wall drawn around one', () => {
  assert.equal(toAscii(art('tile_arch'), 0), [
    'LLLLLLLLLLLLLLLL',
    'MMMMMMMMMMMMMMMM',
    'MMM..MMMMMM..MMM',
    'MM....MMMM....MM',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'M......MM......M',
    'MMMMMMMMMMMMMMMM',
  ].join('\n'));

  // What reads at this size is the daylight, not the moulding: the arch is the
  // shape of what is missing. So the wall is solid top and bottom and the middle
  // of the cell is mostly sky.
  assert.equal(widthAt('tile_arch', 0), SPRITE_SIZE);
  assert.equal(widthAt('tile_arch', SPRITE_SIZE - 1), SPRITE_SIZE);
  assert.ok(widthAt('tile_arch', SPRITE_SIZE / 2) < SPRITE_SIZE / 2, 'the arches are too narrow to read');
});

test('the canopy is scalloped along the top and dense underneath', () => {
  assert.equal(toAscii(art('tile_foliage'), 0), [
    '....GG......GG..',
    '...GGGG....GGGG.',
    '..GGGGGG..GGGGGG',
    '.GGGGGGGGGGGGGG.',
    'gggggggggggggggg',
    'gggDggggggggDggg',
    'gggggggggggggggg',
    'gDgggggggDgggggg',
    'gggggggggggggggg',
    'ggggggDgggggggDg',
    'gggggggggggggggg',
    'gggDgggggggggDgg',
    'gggggggggggggggg',
    'gDggggggggDggggg',
    'gggggggggggggggg',
    'ggggggggDgggggDg',
  ].join('\n'));

  // Leaf mass, seen from below and far off: broken at the crowns, solid beneath.
  assert.ok(widthAt('tile_foliage', 0) < SPRITE_SIZE, 'the crowns have no sky between them');
  assert.equal(widthAt('tile_foliage', SPRITE_SIZE - 1), SPRITE_SIZE, 'the canopy is see-through');
});

test('the deep has no surface, no course and no crest', () => {
  // The void's floor. It has to read as *moving darkness* rather than as a
  // floor: a repeating course would be masonry, a crest would be a wave, and
  // this is water before there is any light to see its surface by.
  assert.equal(toAscii(art('tile_deep'), 0), [
    'gggggggggggggggg',
    'ggggggKKKggggggg',
    'gggggggggggggggg',
    'ggKKKKgggggggggg',
    'gggggggggggggggg',
    'gggggggggGGGGggg',
    'gggggggggggggggg',
    'gGGGggggggggggGG',
    'gggggggggggggggg',
    'ggggggggKKKKgggg',
    'gggggggggggggggg',
    'gggKKgggggggggKK',
    'gggggggggggggggg',
    'gggggGGGGggggggg',
    'gggggggggggggggg',
    'gggggggggggggggg',
  ].join('\n'));
  // No two marks start in the same column, which is what "no course" means.
  const rows = toAscii(art('tile_deep'), 0).split('\n');
  const starts = rows
    .map((row) => row.search(/[KG]/))
    .filter((at) => at >= 0);
  assert.equal(new Set(starts).size, starts.length, 'the deep has a repeating course in it');
});

test('the swell is one slow rise, and it is darker than the sky rather than lighter', () => {
  // The one shape in the game drawn entirely in `outline`. Everything else in
  // the distance stands *against* the sky; a mass of water in the dark stands
  // in front of it, so it has to be the one ink darker than the air.
  assert.equal(toAscii(art('tile_swell'), 0), [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......KK.......',
    '.....KKKKKK.....',
    '...KKKKKKKKKK...',
    '.KKKKKKKKKKKKKK.',
    'KKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKK',
    'KKKKKKKKKKKKKKKK',
  ].join('\n'));
  assert.equal(crests('tile_swell'), 1, 'a second crest would make it a wave');
  const drawn = new Set(toAscii(art('tile_swell'), 0).replace(/[\n.]/g, ''));
  assert.deepEqual([...drawn], [ink('outline')], 'the swell is drawn in one ink and it is outline');
});

test('stars are points of light, with one of them bright enough to have arms', () => {
  // A field of even dots reads as noise or as dust on the screen. One brighter
  // star with arms is what says *star* at 16x16, and it is the whole design.
  assert.equal(toAscii(art('tile_stars'), 0), [
    '..W........L....',
    '............W...',
    '....L...........',
    '.W..............',
    '................',
    '........L.......',
    '.......LWL......',
    '........L.......',
    '..W.............',
    '.............W..',
    '.....L..........',
    '..........W.....',
    '...W............',
    '................',
    '.L...........W..',
    '......W.........',
  ].join('\n'));
  // Sparse: the expanse is mostly expanse.
  assert.ok(inked('tile_stars', 0) < SPRITE_SIZE * SPRITE_SIZE / 8, // tuning-exempt: an eighth of the cell
    `${String(inked('tile_stars', 0))} lit pixels is a wall, not a sky`);
  // The bright star has four arms around it, and no other lit pixel does.
  const sprite = art('tile_stars');
  const bright = ink('highlight');
  const rows = toAscii(sprite, 0).split('\n');
  let armed = 0;
  for (let y = 1; y < SPRITE_SIZE - 1; y++) {
    for (let x = 1; x < SPRITE_SIZE - 1; x++) {
      if (rows[y]?.charAt(x) !== bright) continue;
      const arms = [[0, -1], [0, 1], [-1, 0], [1, 0]]
        .filter(([dx, dy]) => rows[y + (dy ?? 0)]?.charAt(x + (dx ?? 0)) === ink('light'));
      if (arms.length === 4) armed += 1; // tuning-exempt: the four sides of a pixel
    }
  }
  assert.equal(armed, 1, 'exactly one star is drawn with arms');
});

test('the cloud is lit along the top and tapers away underneath', () => {
  assert.equal(toAscii(art('tile_cloud'), 0), [
    '................',
    '...LLLL.........',
    '..LLLLLLL...LLL.',
    '.LLLLLLLLL.LLLLL',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMMMMMM',
    'MMMMMMMMMMMM....',
    '.MMMMMMMM.......',
    '..MMMM..........',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ].join('\n'));

  // The taper is the whole trick. A cloud with a flat bottom is a shelf, and a
  // band of shelves is a ceiling -- exactly wrong for the two themes that want
  // it, one of which is the sky opening and the other the sky closing.
  assert.equal(widthAt('tile_cloud', SPRITE_SIZE - 1), 0, 'the cloud reaches the floor of its band');
  let widest = 0;
  let lowest = 0;
  for (let y = 0; y < SPRITE_SIZE; y++) {
    const width = widthAt('tile_cloud', y);
    widest = Math.max(widest, width);
    if (width > 0) lowest = width;
  }
  assert.ok(lowest < widest, 'the underside is as wide as the cloud, so it is a slab');
});

// --- accessors --------------------------------------------------------------

test('frame indices wrap rather than running off the end of the sheet', () => {
  const walk = art('scribe_walk');
  assert.equal(frameIndex(walk, walk.frames.length), 0);
  assert.equal(frameIndex(walk, -1), walk.frames.length - 1);
  assert.equal(pixelAt(walk, 0, -1, 0), NONE);
  assert.equal(pixelAt(walk, 0, SPRITE_SIZE, 0), NONE);
});

test('an unknown sprite id is null, not a throw', () => {
  assert.equal(spriteFor('no_such_sprite'), null);
  assert.ok(SPRITES.size >= REQUIRED.length);
});

// --- the pictures the combat loop is made of --------------------------------

test('the burst goes flash, expand, scatter -- and never plays backwards', () => {
  assert.equal(art('burst').frames.length, BURST_FRAMES);

  // The whole design of the animation is its silhouette over time. A tight
  // flash, a wide star, then nothing but flecks: if the middle frame is not the
  // biggest, the explosion implodes.
  const flash = inked('burst', 0);
  const wide = inked('burst', 1);
  const flecks = inked('burst', 2);
  assert.ok(flash < wide, 'the flash must be tighter than the star it opens into');
  assert.ok(flecks < flash, 'the last frame must be sparser than the first, or it does not disperse');

  // And the star has to reach the edges, or it reads as a small bright thing
  // rather than as a monster coming apart.
  const star = toSilhouette(art('burst'), 1).split('\n');
  assert.ok((star[0] ?? '').includes('K'), 'the star never reaches the top of the cell');
  assert.ok((star[SPRITE_SIZE - 1] ?? '').includes('K'), 'the star never reaches the bottom');

  assert.equal(toAscii(art('burst'), 0), [
    '................',
    '................',
    '................',
    '.......KK.......',
    '.......WW.......',
    '....K..WW..K....',
    '.....KKWWKK.....',
    '...KWWWWWWWWK...',
    '...KWWWWWWWWK...',
    '.....KKWWKK.....',
    '....K..WW..K....',
    '.......WW.......',
    '.......KK.......',
    '................',
    '................',
    '................',
  ].join('\n'));

  assert.equal(toAscii(art('burst'), 1), [
    '.......KK.......',
    '......K..K......',
    '...K..LLLL..K...',
    '....K.LWWL.K....',
    '.....LLWWLL.....',
    '..K..LWAAWL..K..',
    '...LLWAAAAWLL...',
    '.KLWWAAAAAAWWLK.',
    '.KLWWAAAAAAWWLK.',
    '...LLWAAAAWLL...',
    '..K..LWAAWL..K..',
    '.....LLWWLL.....',
    '....K.LWWL.K....',
    '...K..LLLL..K...',
    '......K..K......',
    '.......KK.......',
  ].join('\n'));

  assert.equal(toAscii(art('burst'), 2), [
    '.K............K.',
    '................',
    '...L........L...',
    '................',
    '.K...A....A...K.',
    '................',
    '....L......L....',
    '................',
    '................',
    '....L......L....',
    '................',
    '.K...A....A...K.',
    '................',
    '...L........L...',
    '................',
    '.K............K.',
  ].join('\n'));
});

test('the strike is the idle scribe with the quill thrown forward', () => {
  // Only the arm may move. At this size a figure that redraws itself between
  // frames reads as two figures rather than as one doing something, so the
  // body below the waist is pixel-identical to the idle pose.
  const waistDown = (id: string, frame: number): string =>
    toAscii(art(id), frame).split('\n').slice(10).join('\n');   // tuning-exempt: below the hand, where only the robe is
  assert.equal(waistDown('scribe_strike', 0), waistDown('scribe_idle', 0));
  assert.equal(waistDown('scribe_strike', 1), waistDown('scribe_idle', 0));

  // The wind-up puts the quill behind him and the follow-through puts it in
  // front, so the two frames read as one motion rather than as a twitch.
  const back = toSilhouette(art('scribe_strike'), 0).split('\n');
  const forward = toSilhouette(art('scribe_strike'), 1).split('\n');
  assert.notEqual(back.join('\n'), forward.join('\n'));

  // The nib has to leave the silhouette on the follow-through, or the pose
  // reads as a shrug. Nothing of the idle figure reaches the last column.
  const reachesEdge = (rows: readonly string[]): boolean =>
    rows.some((row) => row.charAt(SPRITE_SIZE - 1) !== '.');
  assert.ok(reachesEdge(forward), 'the strike does not reach past the scribe');
  assert.ok(!reachesEdge(toSilhouette(art('scribe_idle'), 0).split('\n')));

  assert.equal(toAscii(art('scribe_strike'), 1), [
    '................',
    '.....KKKKK......',
    '....KrrrrrKK....',
    '....KrrrrrrK....',
    '....KrSSSSrK....',
    '....KrSKSKrK....',
    '....KrSSSSrKW...',
    '.....KSSSSKLWA..',
    '....KKRRRRKKLLWA',
    '...KRRRRRRRRK.A.',
    '..KRRRRRRRRRRK..',
    '..KRRRRRRRRRRK..',
    '..KRRRRRRRRRRK..',
    '...KRRRRRRRRK...',
    '...KKKK..KKKK...',
    '................',
  ].join('\n'));
});

test('an unlit candle is a candle that is out, not a dimmed flame', () => {
  const flame = INK_CHARS.charAt(INK_CHARS.indexOf('F'));
  const unlit = toAscii(art('candle'), CANDLE_UNLIT_FRAME);
  assert.ok(!unlit.includes(flame), 'the unlit candle still has a flame in it');

  // Nothing at all above the wick: a checkpoint the player has not reached is
  // dark, so lighting it has something to be a change from.
  for (const row of unlit.split('\n').slice(0, 5)) {   // tuning-exempt: the rows the flame occupies
    assert.equal(row, '.'.repeat(SPRITE_SIZE), 'something is still burning on the unlit candle');
  }

  // And it is the same object: stick, holder and wick are pixel-identical to
  // both lit frames, so lighting it changes exactly the flame.
  const held = (frame: number): string => toAscii(art('candle'), frame).split('\n').slice(5).join('\n');   // tuning-exempt: the wick row down
  assert.equal(held(CANDLE_UNLIT_FRAME), held(0));
  assert.equal(held(CANDLE_UNLIT_FRAME), held(1));
  assert.ok(inked('candle', CANDLE_UNLIT_FRAME) < inked('candle', 0));
});

// --- the two verbs -----------------------------------------------------------

test('the stomp is the same scribe with his legs doing three different things', () => {
  assert.equal(art('scribe_hop').frames.length, HOP_FRAMES);

  // Only the legs may move. The head, the shoulders and the quill are the idle
  // figure pixel for pixel in all three frames, because at 16x16 a figure that
  // redraws itself between frames reads as three figures rather than as one
  // doing something -- the same rule the strike frames are held to.
  const aboveTheWaist = (id: string, frame: number): string =>
    toAscii(art(id), frame).split('\n').slice(0, 11).join('\n');   // tuning-exempt: down to the hem, where only the legs are left
  for (const frame of [HOP_RISE, HOP_CONTACT, HOP_BOUNCE]) {
    assert.equal(
      aboveTheWaist('scribe_hop', frame),
      aboveTheWaist('scribe_idle', 0),
      `hop frame ${String(frame)} redrew the figure above the waist`,
    );
  }

  // And the legs really do differ, or it is one pose held for three frames --
  // which is the thing this whole verb exists to stop being.
  const legs = (frame: number): string =>
    toAscii(art('scribe_hop'), frame).split('\n').slice(11).join('\n');   // tuning-exempt: the hem down
  const poses = new Set([legs(HOP_RISE), legs(HOP_CONTACT), legs(HOP_BOUNCE)]);
  assert.equal(poses.size, HOP_FRAMES, 'the hop holds one pose for three frames');

  // Rise: knees drawn up, feet tucked under the robe.
  assert.equal(toAscii(art('scribe_hop'), HOP_RISE), [
    '................',
    '.....KKKKK......',
    '....KrrrrrKK.WW.',
    '....KrrrrrrK.LW.',
    '....KrSSSSrK.L..',
    '....KrSKSKrK.L..',
    '....KrSSSSrK.L..',
    '.....KSSSSK..L..',
    '....KKRRRRKK.L..',
    '...KRRRRRRRRKA..',
    '..KRRRRRRRRRRK..',
    '..KRRRRRRRRRRK..',
    '...KRRRRRRRRK...',
    '...KKRRRRRRKK...',
    '.....KK..KK.....',
    '................',
  ].join('\n'));

  // Contact: the figure narrows to a wedge driven straight down, with the
  // impact thrown out sideways under it. This is the frame that has to read as
  // landing *on* something.
  assert.equal(toAscii(art('scribe_hop'), HOP_CONTACT), [
    '................',
    '.....KKKKK......',
    '....KrrrrrKK.WW.',
    '....KrrrrrrK.LW.',
    '....KrSSSSrK.L..',
    '....KrSKSKrK.L..',
    '....KrSSSSrK.L..',
    '.....KSSSSK..L..',
    '....KKRRRRKK.L..',
    '...KRRRRRRRRKA..',
    '..KRRRRRRRRRRK..',
    '...KRRRRRRRRK...',
    '....KRRRRRRK....',
    '.....KRRRRK.....',
    '.....KKKKKK.....',
    '...KK......KK...',
  ].join('\n'));

  // Bounce: legs flung wide as he comes off it.
  assert.equal(toAscii(art('scribe_hop'), HOP_BOUNCE), [
    '................',
    '.....KKKKK......',
    '....KrrrrrKK.WW.',
    '....KrrrrrrK.LW.',
    '....KrSSSSrK.L..',
    '....KrSKSKrK.L..',
    '....KrSSSSrK.L..',
    '.....KSSSSK..L..',
    '....KKRRRRKK.L..',
    '...KRRRRRRRRKA..',
    '..KRRRRRRRRRRK..',
    '..KRRRRRRRRRRK..',
    '...KRRRRRRRRK...',
    '..KRK......KRK..',
    '..KK........KK..',
    '................',
  ].join('\n'));

  // The contact frame is the narrowest of the three at the feet and the only one
  // that puts ink on the bottom row: that is what "he landed on it" looks like.
  const bottomRow = (frame: number): string =>
    toSilhouette(art('scribe_hop'), frame).split('\n')[SPRITE_SIZE - 1] ?? '';
  assert.notEqual(bottomRow(HOP_CONTACT), '.'.repeat(SPRITE_SIZE));
  assert.equal(bottomRow(HOP_RISE), '.'.repeat(SPRITE_SIZE));
  assert.equal(bottomRow(HOP_BOUNCE), '.'.repeat(SPRITE_SIZE));
});

test('the thrown nib is small, pointed, and tumbles', () => {
  assert.equal(art('nib').frames.length, NIB_FRAMES);

  // Small: a thrown object that fills the cell reads as a second monster rather
  // than as a trajectory. A quarter of the sprite, at most.
  for (let frame = 0; frame < NIB_FRAMES; frame += 1) {
    assert.ok(
      inked('nib', frame) < (SPRITE_SIZE * SPRITE_SIZE) / 4,   // tuning-exempt: a quarter of the cell
      'the nib is too big to read as a thrown thing',
    );
  }

  // Pointed, and leaning the other way on the second frame: that is the tumble,
  // and it is all the animation two hundred milliseconds of flight can hold.
  assert.equal(toAscii(art('nib'), 0), [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..........KK....',
    '.........KAAK...',
    '........KAAWK...',
    '.......KAAWK....',
    '......KAAWK.....',
    '.....KKAWK......',
    '......KKK.......',
    '................',
    '................',
    '................',
    '................',
  ].join('\n'));

  assert.equal(toAscii(art('nib'), 1), [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....KK..........',
    '...KAAK.........',
    '...KWAAK........',
    '....KWAAK.......',
    '.....KWAAK......',
    '......KWAKK.....',
    '.......KKK......',
    '................',
    '................',
    '................',
    '................',
  ].join('\n'));
});

test('the ink lands as a blot and then spreads, and it is ink rather than fire', () => {
  assert.equal(art('ink_burst').frames.length, INK_BURST_FRAMES);

  // It spreads. A splash that shrank would play the impact backwards, exactly as
  // the monster burst would.
  assert.ok(
    inked('ink_burst', 0) < inked('ink_burst', 1),
    'the ink splash gets smaller instead of spreading',
  );

  // And it is drawn in the shade the blot-cloud is drawn in, not in the burst's
  // highlights: the scribe and the thing that threatens his page throw the same
  // substance, which is the whole joke of the verb.
  const ink = INK_CHARS.charAt(2);   // tuning-exempt: 'shade', the ink role
  for (let frame = 0; frame < INK_BURST_FRAMES; frame += 1) {
    assert.ok(toAscii(art('ink_burst'), frame).includes(ink), 'the ink burst has no ink in it');
  }
  assert.ok(!toAscii(art('ink_burst'), 0).includes(INK_CHARS.charAt(11)), 'the ink is on fire');   // tuning-exempt: 'flame'

  assert.equal(toAscii(art('ink_burst'), 0), [
    '................',
    '................',
    '................',
    '.......KK.......',
    '......KDDK......',
    '.....KDDDDK.....',
    '....KDDDDDDK....',
    '....KDDDDDDK....',
    '....KDDDDDDK....',
    '.....KDDDDK.....',
    '......KDDK......',
    '.......KK.......',
    '................',
    '................',
    '................',
    '................',
  ].join('\n'));

  assert.equal(toAscii(art('ink_burst'), 1), [
    '..K..........K..',
    '....K......K....',
    '.......KK.......',
    '.....KKDDKK.....',
    '...KKDDDDDDKK...',
    '..KDDDDDDDDDDK..',
    '.KDDDDDDDDDDDDK.',
    '.KDDDDDDDDDDDDK.',
    '.KDDDDDDDDDDDDK.',
    '..KDDDDDDDDDDK..',
    '...KKDDDDDDKK...',
    '.....KKDDKK.....',
    '.......KK.......',
    '....K......K....',
    '..K..........K..',
    '................',
  ].join('\n'));
});
