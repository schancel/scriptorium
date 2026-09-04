/**
 * Every theme the scenery doc names can actually be drawn.
 *
 * @doc docs/design/05-scenery-warps.md#themes
 *
 * `data/themes.json` is compiled from the scenery table, so it is canonical and
 * this test reads it rather than a copy. A theme in the table with no world here
 * would resolve silently to the abbey and be discovered by a player wandering
 * into Jonah's storm and finding a cloister.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { NONE, PALETTE_ROLES, SPRITES, spriteFor } from './sprites.js';
import {
  DEFAULT_THEME,
  WORLDS,
  colourFor,
  loadThemes,
  roleIndex,
  worldFor,
} from './worlds.js';

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

const THEMES = loadThemes(loadDataFile('themes.json'));

test('every theme in data/themes.json has a world', () => {
  assert.ok(THEMES.length > 0);
  for (const theme of THEMES) {
    assert.ok(WORLDS.has(theme.id), `theme "${theme.id}" has no world`);
  }
  // And nothing here is invented: a world with no documented theme would be
  // scenery no scene map can ever reach.
  const documented = new Set(THEMES.map((t) => t.id));
  for (const id of WORLDS.keys()) {
    assert.ok(documented.has(id), `world "${id}" is not in docs/design/05-scenery-warps.md`);
  }
});

test('a theme with no world is a loud failure, not a silent fallback', () => {
  assert.throws(() => loadThemes({ themes: [{ id: 'atlantis', palette: 'a', mood: 'b', tune: 'c' }] }), /no world/);
  assert.throws(() => loadThemes({}), /"themes" array/);
});

test('every palette supplies exactly one colour per art role', () => {
  for (const world of WORLDS.values()) {
    assert.equal(world.palette.length, PALETTE_ROLES.length, `${world.id} has the wrong number of colours`);
    assert.equal(colourFor(world, roleIndex('none')), 0, `${world.id} paints the transparent role`);
    for (const colour of world.palette) {
      assert.ok(Number.isInteger(colour) && colour >= 0 && colour <= 0xffffff, `${world.id} has a non-RGB colour`);
    }
  }
});

test('a theme is legible: no two adjacent roles collapse into one colour', () => {
  // Sprites lean on outline-against-body and light-against-shade to read at
  // 16x16. If a theme gives two of them the same value the art turns to mush,
  // and it turns to mush only in that one theme, which is exactly the bug that
  // survives a review.
  const pairs: readonly (readonly [string, string])[] = [
    ['outline', 'mid'], ['shade', 'light'], ['mid', 'highlight'],
    ['robe', 'robeShade'], ['accent', 'flame'], ['groundTop', 'groundBody'],
  ];
  for (const world of WORLDS.values()) {
    for (const [a, b] of pairs) {
      assert.notEqual(
        colourFor(world, roleIndex(a)),
        colourFor(world, roleIndex(b)),
        `${world.id} draws ${a} and ${b} in the same colour`,
      );
    }
  }
});

test('a heart is the same red everywhere, and a face the same face', () => {
  // Themed hearts would make the HUD unreadable at a glance; themed skin would
  // make the scribe a different character in every chapter.
  const shared = ['blood', 'bloodDark', 'skin', 'skinShade'];
  const abbey = worldFor('abbey');
  for (const world of WORLDS.values()) {
    for (const role of shared) {
      assert.equal(colourFor(world, roleIndex(role)), colourFor(abbey, roleIndex(role)));
    }
  }
});

test('every tile a world names is a sprite that exists', () => {
  for (const world of WORLDS.values()) {
    assert.ok(spriteFor(world.groundTile) !== null, `${world.id} stands on a missing tile`);
    for (const layer of world.parallax) {
      assert.ok(spriteFor(layer.tileId) !== null, `${world.id}/${layer.id} draws a missing tile`);
    }
  }
});

test('the tile a world stands on has no holes in it', () => {
  // The sky is a themed rect drawn behind the parallax, so a transparent pixel
  // in the ground tile is a hole the scribe walks over and the sky shows through
  // his feet. The distance tiles are allowed their sky; the floor is not.
  for (const world of WORLDS.values()) {
    const tile = spriteFor(world.groundTile);
    assert.ok(tile !== null, `${world.id} stands on a missing tile`);
    for (const frame of tile.frames) {
      for (const index of frame) {
        assert.notEqual(index, NONE, `${world.id} stands on ${world.groundTile}, which has a hole in it`);
      }
    }
  }
});

test('NO TWO THEMES STACK THE SAME THREE TILES', () => {
  // The whole reason there is more than one tileset. A theme is a palette *and*
  // a place, and a palette alone cannot tell them apart: the sea drawn on the
  // abbey's arcade is the abbey in blue, and a player who has just been sent
  // through the flood is looking at a cloister.
  //
  // Recolouring still carries everything that is honestly the same place under a
  // different light -- the abbey, the temple and the tomb all stand on the same
  // cut stone. What this asserts is only that no two themes are the same picture
  // all the way down.
  const stacks = new Map<string, string>();
  for (const world of WORLDS.values()) {
    const stack = world.parallax.map((layer) => layer.tileId).join(' / ');
    const first = stacks.get(stack);
    assert.equal(first, undefined, `${world.id} is ${String(first)} recoloured: ${stack}`);
    stacks.set(stack, world.id);
  }
});

test('a theme is never one tile at three depths', () => {
  // Three bands of the same picture at three speeds is not depth, it is one
  // backdrop sliding over itself. Every theme has to differ somewhere between
  // the horizon and the scribe's feet.
  for (const world of WORLDS.values()) {
    const distinct = new Set(world.parallax.map((layer) => layer.tileId));
    assert.ok(distinct.size >= 2, `${world.id} draws one tile at every depth`);
  }
});

test('parallax layers are ordered back to front and never overtake the ground', () => {
  for (const world of WORLDS.values()) {
    assert.ok(world.parallax.length > 0);
    let previous = 0;
    for (const layer of world.parallax) {
      assert.ok(layer.factor > previous, `${world.id}/${layer.id} is not behind the layer before it`);
      assert.ok(layer.factor <= 1, `${world.id}/${layer.id} scrolls faster than the ground`);
      assert.ok(layer.h > 0);
      previous = layer.factor;
    }
    const ground = world.parallax[world.parallax.length - 1];
    assert.ok(ground !== undefined);
    assert.equal(ground.factor, 1, 'the nearest layer is the ground the scribe stands on');
    assert.equal(ground.tileId, world.groundTile);
  }
});

test('an unknown theme resolves to the abbey rather than to nothing', () => {
  // The documented fallback: a user-loaded Gutenberg book gets a neutral library
  // throughout, which is the correct outcome.
  assert.equal(worldFor('no_such_theme').id, DEFAULT_THEME);
  assert.equal(worldFor('').id, DEFAULT_THEME);
  assert.equal(worldFor('storm').id, 'storm');
});

test('a role name that does not exist is -1, and an index off the end is transparent', () => {
  assert.equal(roleIndex('no_such_role'), -1);
  assert.equal(colourFor(worldFor('abbey'), -1), 0);
  assert.equal(colourFor(worldFor('abbey'), PALETTE_ROLES.length), 0);
});

test('every sprite in the sheet resolves against every theme', () => {
  // The point of a role palette: one set of pixels, ten worlds, no per-theme art.
  for (const world of WORLDS.values()) {
    for (const sprite of SPRITES.values()) {
      for (const frame of sprite.frames) {
        for (const index of frame) {
          assert.ok(
            world.palette[index] !== undefined,
            `${sprite.id} uses a role ${world.id} has no colour for`,
          );
        }
      }
    }
  }
});
