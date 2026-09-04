/**
 * Scene resolution, against the real table and the real route.
 *
 * @doc docs/design/05-scenery-warps.md#set-pieces
 *
 * "`make check` asserts every routed passage resolves to a theme and that no
 * ranges overlap." Both are checked here as well as in
 * `tools/validate_data.py`, because the Python check reads the JSON and this one
 * exercises the resolver the game will actually call -- including the citation
 * aliasing (`Psalm 22` against the range `Psalm 22-23`) that only `core/corpus.ts`
 * knows about.
 *
 * The third claim is the one most likely to be "fixed" into a bug later: a text
 * with **no scene file at all** resolves entirely to the abbey, and that is the
 * correct outcome for an imported Gutenberg book, not a failure to handle.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GENERIC_SCENE,
  loadScenes,
  overlappingRanges,
  rowFor,
  sceneAtVerse,
  sceneFor,
  setpieceFor,
  setpieceIds,
  themeFor,
  themeIds,
  type SceneMap,
} from './scenes.js';
import { loadRoute, nodeRefs } from './route.js';
import { isSetpieceId } from './setpieces.js';
import { loadTuning } from './tuning.js';
import { DEFAULT_THEME, WORLDS, blendThemeId, loadThemes, worldFor } from './worlds.js';
import type { Tuning } from './types.js';

function dataUrl(name: string): URL | null {
  for (const rel of ['../../data/', '../data/']) {
    const url = new URL(rel + name, import.meta.url);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

function loadDataFile(name: string): unknown {
  const url = dataUrl(name);
  if (url === null) throw new Error(`test: cannot locate data/${name}`);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

const scenes: SceneMap = loadScenes(loadDataFile('scenes/bible.json'));
const route = loadRoute(loadDataFile('routes/pilgrimage.json'));
const themes = new Set(loadThemes(loadDataFile('themes.json')).map((t) => t.id));
const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));

const ROW_COUNT = 29; // tuning-exempt: rows in docs/design/05-scenery-warps.md#set-pieces

/** The seven scenes Genesis 1 is authored as, first verse of each. */
const GENESIS_1: readonly (readonly [number, string])[] = [
  [1, 'void'], [3, 'daybreak'], [6, 'sea'], [9, 'garden'], // tuning-exempt: verse numbers from the scene table
  [14, 'firmament'], [20, 'sea'], [26, 'garden'], // tuning-exempt: verse numbers from the scene table
];

test('the real scene file parses', () => {
  assert.equal(scenes.text, 'bible');
  assert.equal(scenes.rows.length, ROW_COUNT);
  assert.equal(rowFor(scenes, 'Exodus 14')?.theme, 'sea');
  assert.equal(rowFor(scenes, 'Exodus 14')?.setpiece, 'parted_walls');
});

test('scene ranges do not overlap', () => {
  assert.deepEqual(overlappingRanges(scenes), []);
});

test('overlap detection has teeth', () => {
  const clashing: SceneMap = {
    text: 'bible',
    rows: [
      ...scenes.rows,
      // tuning-exempt: chapter numbers in a fixture range
      { range: 'Genesis 3-6', book: 'Genesis', first: 3, last: 6, firstVerse: null, lastVerse: null, theme: 'storm', setpiece: null }, // tuning-exempt: chapter numbers in a fixture range
    ],
  };
  const clashes = overlappingRanges(clashing).map((pair) => pair.join(' + '));
  assert.ok(clashes.includes('Genesis 2-3 + Genesis 3-6'));
  assert.ok(clashes.includes('Genesis 6-9 + Genesis 3-6'));
});

test('TWO VERSE ROWS CLAIMING ONE VERSE IS AN OVERLAP, AND A NESTED ONE IS NOT', () => {
  // The whole point of the second precision: `Genesis 1:1-2` sits inside
  // `Genesis 1` on purpose and wins there, so that is not a clash. Two verse
  // rows over the same verse *is* one, because then the theme would fall out of
  // whichever the table happened to list first.
  assert.deepEqual(overlappingRanges(scenes), [], 'the real table nests, it does not clash');
  const clashing: SceneMap = {
    text: 'bible',
    rows: [
      ...scenes.rows,
      // tuning-exempt: verse numbers in a fixture range
      { range: 'Genesis 1:4-7', book: 'Genesis', first: 1, last: 1, firstVerse: 4, lastVerse: 7, theme: 'storm', setpiece: null }, // tuning-exempt: verse numbers in a fixture range
    ],
  };
  const clashes = overlappingRanges(clashing).map((pair) => pair.join(' + '));
  assert.ok(clashes.includes('Genesis 1:3-5 + Genesis 1:4-7'));
  assert.ok(clashes.includes('Genesis 1:6-8 + Genesis 1:4-7'));
  assert.ok(!clashes.some((pair) => pair.startsWith('Genesis 1 +')), 'the chapter row is not a clash');
});

test('A VERSE ROW BEATS THE CHAPTER ROW COVERING THE SAME GROUND', () => {
  // "A verse range wins over a chapter range covering the same ground, so
  // existing chapter rows stay a useful default and nothing already authored
  // has to change." Genesis 1 still resolves as a chapter; its verses do not.
  assert.equal(themeFor(scenes, 'Genesis 1'), 'daybreak', 'the chapter default stands');
  for (const [verse, theme] of GENESIS_1) {
    assert.equal(themeFor(scenes, `Genesis 1:${String(verse)}`), theme, `verse ${String(verse)}`);
  }
  // And every other authored chapter is untouched by the new precision.
  assert.equal(themeFor(scenes, 'Exodus 14:3'), 'sea');
  assert.equal(themeFor(scenes, 'Psalm 23:1'), 'abbey');
});

test('GENESIS 1 IS SEVEN PLACES, NOT ONE', () => {
  // The whole reason verse ranges exist. The owner's complaint was that the
  // chapter reads as "a cavern or something, rather than like moving through
  // space, to earth, to eden" -- so the assertion is that it moves.
  const seen = new Set<string>();
  for (let verse = 1; verse <= 31; verse += 1) { // tuning-exempt: verses in Genesis 1
    seen.add(themeFor(scenes, `Genesis 1:${String(verse)}`));
  }
  assert.ok(seen.size >= 5, `Genesis 1 resolves to ${String(seen.size)} theme(s)`); // tuning-exempt: distinct places
  assert.notEqual(themeFor(scenes, 'Genesis 1:2'), themeFor(scenes, 'Genesis 1:30'));
  // Neighbouring scenes are never the same place, or a boundary is a no-op.
  for (let i = 1; i < GENESIS_1.length; i += 1) {
    assert.notEqual(GENESIS_1[i]?.[1], GENESIS_1[i - 1]?.[1], `stage ${String(i)}`);
  }
});

test('THE PALETTE EASES ACROSS A BOUNDARY WHILE THE TILES CUT AT IT', () => {
  // docs/design/05-scenery-warps.md: colour moves continuously, tiles change at
  // the boundary itself. The boundary between the void and the light is verse 3.
  const at = (position: number) => sceneAtVerse(scenes, 'Genesis 1', position, tuning);
  assert.equal(at(1).theme, 'void');
  assert.equal(at(1).blendTheme, null, 'far from a boundary, nothing is mixed');
  assert.equal(at(1).blendMix, 0);

  const before = at(2.9); // tuning-exempt: a position just short of the boundary
  const after = at(3.05); // tuning-exempt: a position just past it
  assert.equal(before.theme, 'void', 'the tiles have not cut yet');
  assert.equal(after.theme, 'daybreak', 'and now they have');
  assert.equal(before.blendTheme, 'daybreak');
  assert.equal(after.blendTheme, 'void', 'the colour is still arriving from the old scene');
  assert.ok(before.blendMix > 0 && after.blendMix > 0);

  // Continuity: the mix reaches exactly half at the boundary from both sides,
  // and a half mix of A toward B is the same colour as a half mix of B toward A.
  const justBefore = at(2.999);   // tuning-exempt: a position on the boundary
  const justAfter = at(3);        // tuning-exempt: the boundary itself
  assert.ok(Math.abs(justBefore.blendMix - justAfter.blendMix) < 0.01); // tuning-exempt: rounding
  const left = worldFor(blendThemeId('void', 'daybreak', justAfter.blendMix));
  const right = worldFor(blendThemeId('daybreak', 'void', justAfter.blendMix));
  assert.deepEqual([...left.palette], [...right.palette], 'the colour does not jump at the cut');
});

test('THE TRANSITION IS A FUNCTION OF POSITION AND OF NOTHING ELSE', () => {
  // docs/decisions/0004-idle-threat-not-speed-timer.md, applied to the scenery:
  // the world must not change while the player is thinking. There is no clock in
  // this call, and that is the assertion -- the same position always gives the
  // same scene, however long the player has been sitting on it.
  for (const position of [1, 2.5, 3, 5.75, 14, 25.5, 31]) { // tuning-exempt: sample positions
    assert.deepEqual(
      sceneAtVerse(scenes, 'Genesis 1', position, tuning),
      sceneAtVerse(scenes, 'Genesis 1', position, tuning),
    );
  }
  // And the mix only ever climbs toward a boundary and falls away from it.
  const rising = [2, 2.25, 2.5, 2.75].map((v) => sceneAtVerse(scenes, 'Genesis 1', v, tuning).blendMix); // tuning-exempt: samples
  for (let i = 1; i < rising.length; i += 1) {
    assert.ok((rising[i] ?? 0) > (rising[i - 1] ?? 0), 'the colour approaches the boundary');
  }
});

test('a chapter with no verse rows never blends, so nothing already authored moves', () => {
  const at = (position: number) => sceneAtVerse(scenes, 'Exodus 14', position, tuning);
  for (const position of [1, 2, 10.5, 31]) { // tuning-exempt: sample positions
    assert.equal(at(position).theme, 'sea');
    assert.equal(at(position).blendTheme, null);
    assert.equal(at(position).blendMix, 0);
    assert.equal(at(position).sceneProgress, null, 'a chapter row does not know its own length');
  }
});

test('a verse row reports progress through its own verses, not the chapter', () => {
  // Without this, `waters_divided` would run from 0.16 to 0.26 across the whole
  // of the second day and read as not moving at all.
  const at = (position: number) => sceneAtVerse(scenes, 'Genesis 1', position, tuning).sceneProgress;
  assert.equal(at(6), 0, 'the start of Genesis 1:6-8'); // tuning-exempt: a verse number
  assert.ok((at(9) ?? 0) === 0, 'and the start of the next scene'); // tuning-exempt: a verse number
  const middle = at(7) ?? 0; // tuning-exempt: the middle verse of a three-verse scene
  assert.ok(middle > 0.3 && middle < 0.4, `a third of the way through: ${String(middle)}`); // tuning-exempt: a fraction either side of a third
});

test('a text with no scene map has no transitions either', () => {
  const at = sceneAtVerse(null, 'Moby Dick 1', 4.5, tuning); // tuning-exempt: a sample position
  assert.equal(at.theme, DEFAULT_THEME);
  assert.equal(at.blendTheme, null);
  assert.equal(at.sceneProgress, null);
});

test('every routed passage resolves to a theme the game can draw', () => {
  for (const ref of nodeRefs(route)) {
    const theme = themeFor(scenes, ref);
    assert.ok(themes.has(theme), `${ref} -> unknown theme ${theme}`);
    assert.ok(WORLDS.has(theme), `${ref} -> theme ${theme} has no world`);
  }
});

test('a range written as a psalm citation matches a routed psalm', () => {
  assert.equal(rowFor(scenes, 'Psalm 22')?.range, 'Psalm 22-23');
  assert.equal(rowFor(scenes, 'Psalm 23')?.range, 'Psalm 22-23');
  assert.equal(rowFor(scenes, 'Psalms 23')?.range, 'Psalm 22-23', 'the title spelling too');
  assert.equal(themeFor(scenes, 'Psalms 22'), 'abbey');
});

test('every Gospel passage the route names now carries a set piece', () => {
  // "The Gospels have almost none while Exodus has four, so the passages the
  // route is built to reach carry the least visual weight in the game."
  const gospels = nodeRefs(route).filter((ref) => /^(Matthew|Mark|Luke|John) /.test(ref));
  assert.ok(gospels.length > 0);
  for (const ref of gospels) {
    assert.ok(setpieceFor(scenes, ref) !== null, `${ref} has no set piece`);
  }
});

test('a routed passage with no row is an abbey, not an error', () => {
  assert.equal(rowFor(scenes, 'Leviticus 1'), null);
  assert.equal(themeFor(scenes, 'Leviticus 1'), DEFAULT_THEME);
  assert.equal(setpieceFor(scenes, 'Leviticus 1'), null);
  assert.equal(themeFor(scenes, 'Genesis 4'), DEFAULT_THEME, 'between two authored ranges');
});

test('A TEXT WITH NO SCENE MAP IS AN ABBEY THROUGHOUT, AND THAT IS CORRECT', () => {
  const imported = [
    'Moby Dick 1',
    'Moby Dick 42',
    'The Wind in the Willows 3',
    'Pride and Prejudice 61',
    'Genesis 1',
  ];
  for (const ref of imported) {
    assert.deepEqual(sceneFor(null, ref), GENERIC_SCENE);
    assert.equal(themeFor(null, ref), DEFAULT_THEME);
    assert.equal(setpieceFor(null, ref), null);
  }
});

test('every set piece the table names is implemented', () => {
  const named = setpieceIds(scenes);
  assert.ok(named.length > 0);
  for (const id of named) assert.ok(isSetpieceId(id), `${id} is named but not implemented`);
});

test('every theme the table names is a theme the theme table declares', () => {
  for (const id of themeIds(scenes)) assert.ok(themes.has(id));
});

test('a malformed scene file is a load error, not a silent abbey', () => {
  assert.throws(() => loadScenes({ text: 'x' }), /no "scenes" array/);
  assert.throws(
    () => loadScenes({ text: 'x', scenes: [{ range: 'Genesis', theme: 'sea', setpiece: null }] }),
    /unparseable reference/,
  );
  assert.throws(
    () => loadScenes({ text: 'x', scenes: [{ range: 'Genesis 9-6', theme: 'sea', setpiece: null }] }),
    /runs backwards/,
  );
  assert.throws(
    () => loadScenes({ text: 'x', scenes: [{ range: 'Genesis 1:9-6', theme: 'sea', setpiece: null }] }),
    /runs backwards/,
  );
  assert.throws(
    () => loadScenes({ text: 'x', scenes: [{ range: 'Genesis 1', setpiece: null }] }),
    /theme is not a string/,
  );
});
