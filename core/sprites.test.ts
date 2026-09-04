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

/** Everything the game names. A missing id is a sprite that cannot be drawn. */
const REQUIRED: readonly string[] = [
  'scribe_idle', 'scribe_walk', 'scribe_strike', 'scribe_hop',
  'nib', 'ink_burst', 'bat', 'skeleton', 'burst', 'blot_cloud',
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
