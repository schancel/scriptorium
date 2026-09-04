/**
 * @doc docs/design/06-curriculum.md#keyboard-layout
 *
 * `keyboard.ts` holds the one finger table in the codebase. `illumination.ts`
 * used to hold a second one; they agreed on the day they were written and would
 * have parted on the first edit, and a wrong finger taught for a year is not the
 * kind of bug that announces itself. These tests pin the consolidation: that the
 * table covers every key the curriculum will ever ask for, that the overlay can
 * point at all of them, and that illumination's answer *is* the keyboard's.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { Key, KeyboardLayout, Stage, Thumb } from './types.js';
import {
  DEFAULT_SPACE_THUMB,
  FINGER_LABELS,
  fingerForKey,
  isBoardKey,
  needsShift,
  normaliseKey,
  overlayLayout,
  reportFingers,
} from './keyboard.js';
import { fingerFor } from './illumination.js';
import { loadStages } from './curriculum.js';

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

const stages: Stage[] = loadStages(loadDataFile('curriculum.json'));
const LAYOUTS: readonly KeyboardLayout[] = ['ansi', 'iso'];
const THUMBS: readonly Thumb[] = ['lt', 'rt'];

/** Every key named anywhere in the curriculum, introduced or cumulative. */
const CURRICULUM_KEYS: readonly Key[] = [
  ...new Set(stages.flatMap((s) => [...s.keys, ...s.keySet])),
];

// --- coverage ---------------------------------------------------------------

test('the fixture really is the whole curriculum', () => {
  assert.ok(stages.length > 0);
  assert.ok(CURRICULUM_KEYS.includes('<space>'));
  assert.ok(CURRICULUM_KEYS.includes('<shift>'));
  assert.ok(CURRICULUM_KEYS.includes(':'));
});

test('every key of every stage has a finger, on every layout and either thumb', () => {
  for (const stage of stages) {
    for (const key of stage.keySet) {
      for (const layout of LAYOUTS) {
        for (const thumb of THUMBS) {
          const finger = fingerForKey(key, layout, thumb);
          assert.notEqual(
            finger,
            null,
            `stage ${String(stage.stage)}: no finger for "${key}" on ${layout}`,
          );
          // A finger with no label could not be drawn on the report card.
          assert.ok(finger !== null && FINGER_LABELS[finger] !== undefined);
        }
      }
    }
  }
});

test('every key of every stage is a key the overlay can point at', () => {
  for (const layout of LAYOUTS) {
    const board = new Set(overlayLayout(layout).map((k) => k.key));
    for (const key of CURRICULUM_KEYS) {
      assert.ok(
        board.has(normaliseKey(key)),
        `"${key}" is struck on "${normaliseKey(key)}", which is not on the ${layout} board`,
      );
    }
  }
});

test('every curriculum key is a key the board actually has', () => {
  for (const key of CURRICULUM_KEYS) assert.ok(isBoardKey(normaliseKey(key)), key);
  // Characters with no production stay false, which is what keeps them greyed.
  for (const ch of ['—', '’', 'é', '\n']) assert.equal(isBoardKey(ch), false);
});

// --- one table, not two -----------------------------------------------------

test('illumination.fingerFor is the keyboard table, not a second copy of it', () => {
  const sweep: readonly string[] = [
    ...CURRICULUM_KEYS,
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'0123456789',
    ...'`-=[]\\;\',./',
    ...'~!@#$%^&*()_+{}|:"<>?',
    ' ',
  ];
  for (const key of sweep) {
    for (const layout of LAYOUTS) {
      for (const thumb of THUMBS) {
        assert.equal(
          fingerFor(key, layout, thumb),
          fingerForKey(key, layout, thumb),
          `disagreement on "${key}" (${layout})`,
        );
      }
    }
  }
});

test('a key that is on no board throws rather than guessing', () => {
  assert.equal(fingerForKey('<meta>', 'ansi'), null);
  assert.throws(() => fingerFor('<meta>', 'ansi'));
});

// --- the shifted characters the old table missed -----------------------------

test('a shifted character resolves to the key underneath it', () => {
  assert.equal(normaliseKey(':'), ';');
  assert.equal(normaliseKey('?'), '/');
  assert.equal(normaliseKey('A'), 'a');
  assert.equal(normaliseKey(' '), '<space>');
  assert.equal(normaliseKey('<shift>'), '<shift>');
  assert.equal(fingerForKey(':', 'ansi'), fingerForKey(';', 'ansi'));
  assert.equal(fingerForKey('?', 'ansi'), fingerForKey('/', 'ansi'));
});

test('needsShift knows which characters cost two keys', () => {
  for (const ch of [':', '?', 'A', '"', '!']) assert.equal(needsShift(ch), true, ch);
  for (const ch of [';', '/', 'a', "'", '1', ' ', '<shift>']) {
    assert.equal(needsShift(ch), false, ch);
  }
});

// --- the space thumb --------------------------------------------------------

test('the space thumb is a preference, and it moves nothing but space', () => {
  assert.equal(DEFAULT_SPACE_THUMB, 'rt');
  assert.equal(fingerForKey('<space>', 'ansi'), DEFAULT_SPACE_THUMB);
  for (const thumb of THUMBS) {
    assert.equal(fingerForKey('<space>', 'ansi', thumb), thumb);
    assert.equal(fingerForKey(' ', 'ansi', thumb), thumb);
    for (const key of CURRICULUM_KEYS) {
      if (key === '<space>') continue;
      assert.equal(
        fingerForKey(key, 'ansi', thumb),
        fingerForKey(key, 'ansi', DEFAULT_SPACE_THUMB),
        `"${key}" changed with the thumb preference`,
      );
    }
  }
});

test('the overlay colours the space bar with the thumb in use', () => {
  for (const thumb of THUMBS) {
    const bar = overlayLayout('ansi', thumb).find((k) => k.key === '<space>');
    assert.equal(bar?.finger, thumb);
  }
});

test('the report card columns are the eight fingers plus the thumb in use', () => {
  for (const thumb of THUMBS) {
    const columns = reportFingers(thumb);
    const other: Thumb = thumb === 'lt' ? 'rt' : 'lt';
    assert.ok(columns.includes(thumb));
    assert.ok(!columns.includes(other), 'the unused thumb must not get a column');
    assert.equal(new Set(columns).size, columns.length);
    for (const finger of ['lp', 'lr', 'lm', 'li', 'ri', 'rm', 'rr', 'rp'] as const) {
      assert.ok(columns.includes(finger), finger);
    }
  }
});
