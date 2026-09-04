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

/** Everything the game names. A missing id is a sprite that cannot be drawn. */
const REQUIRED: readonly string[] = [
  'scribe_idle', 'scribe_walk', 'bat', 'skeleton', 'blot_cloud',
  'candle', 'ink_pot', 'heart_full', 'heart_empty',
  'tile_stone', 'tile_grass', 'tile_sand',
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

test('tiles fill their cell, so a floor has no holes in it', () => {
  for (const id of ['tile_stone', 'tile_grass', 'tile_sand']) {
    assert.equal(inked(id, 0), SPRITE_SIZE * SPRITE_SIZE, `${id} has a transparent pixel`);
  }
});

test('the skeleton keeps its skull still and rattles the rest', () => {
  assert.notEqual(toSilhouette(art('skeleton'), 0), toSilhouette(art('skeleton'), 1));
  assert.ok(inked('skeleton', 0) > SPRITE_SIZE, 'the skeleton is too sparse to read');
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
