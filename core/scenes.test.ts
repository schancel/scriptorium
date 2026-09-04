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
  sceneFor,
  setpieceFor,
  setpieceIds,
  themeFor,
  themeIds,
  type SceneMap,
} from './scenes.js';
import { loadRoute, nodeRefs } from './route.js';
import { isSetpieceId } from './setpieces.js';
import { DEFAULT_THEME, WORLDS, loadThemes } from './worlds.js';

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

const ROW_COUNT = 22; // tuning-exempt: rows in docs/design/05-scenery-warps.md#set-pieces

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
      { range: 'Genesis 3-6', book: 'Genesis', first: 3, last: 6, theme: 'storm', setpiece: null }, // tuning-exempt: chapter numbers in a fixture range
    ],
  };
  const clashes = overlappingRanges(clashing).map((pair) => pair.join(' + '));
  assert.ok(clashes.includes('Genesis 2-3 + Genesis 3-6'));
  assert.ok(clashes.includes('Genesis 6-9 + Genesis 3-6'));
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
    () => loadScenes({ text: 'x', scenes: [{ range: 'Genesis 1', setpiece: null }] }),
    /theme is not a string/,
  );
});
