/**
 * @doc docs/design/01-illumination.md#classification
 *
 * The illumination invariant is the single most important correctness property
 * in the codebase, so it is checked with an oracle written independently of the
 * implementation: for every live glyph, work out from first principles which
 * keys the character needs, and require all of them to be taught.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Key, KeyboardLayout, Stage } from './types.js';
import { classify, coverage, fingerFor } from './illumination.js';
import { keySetFor, loadStages, stageAt } from './curriculum.js';

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

/** Real sentences, not one contrived string: KJV and WEB, all public domain. */
const SENTENCES: readonly string[] = [
  'In the beginning God created the heavens and the earth.',
  'And God said, Let there be light: and there was light.',
  'The LORD is my shepherd; I shall not want.',
  'He maketh me to lie down in green pastures: he leadeth me beside the still waters.',
  'Jesus wept.',
  'For God so loved the world, that he gave his only begotten Son.',
  'Blessed are the poor in spirit: for theirs is the kingdom of heaven.',
  'Now faith is the substance of things hoped for, the evidence of things not seen.',
  'Whither thou goest, I will go; and where thou lodgest, I will lodge.',
  'Thy word is a lamp unto my feet, and a light unto my path.',
  'In the beginning was the Word, and the Word was with God, and the Word was God.',
  'Rejoice in the Lord alway: and again I say, Rejoice.',
  'Trust in the LORD with all thine heart; and lean not unto thine own understanding.',
  'Behold, I stand at the door, and knock: if any man hear my voice, I will come in to him.',
  'The heavens declare the glory of God; and the firmament sheweth his handywork.',
  'Come unto me, all ye that labour and are heavy laden, and I will give you rest.',
  'What is man, that thou art mindful of him?',
  'Jesus said to him, "I am the way, the truth, and the life."',
  'Zacchaeus, make haste, and come down; for to day I must abide at thy house.',
  "A man's days are as grass; as a flower of the field, so he flourisheth.",
  'Genesis 1:1 - the quick brown fox jumps over the lazy dog.',
];

/**
 * An independent model of what each character costs to type. Written from the
 * physical keyboard rather than from illumination.ts, so agreement between the
 * two is evidence rather than tautology.
 */
const SHIFTED_ON: Readonly<Record<string, string>> = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-',
  '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
  '<': ',', '>': '.', '?': '/',
};

function oracleKeys(ch: string, keySet: ReadonlySet<Key>): readonly Key[] {
  if (ch === ' ') return ['<space>'];
  if (keySet.has(ch)) return [ch];
  const lower = ch.toLowerCase();
  if (lower !== ch) return ['<shift>', lower];
  const base = SHIFTED_ON[ch];
  if (base !== undefined) return ['<shift>', base];
  return [ch];
}

const LAYOUTS: readonly KeyboardLayout[] = ['ansi', 'iso'];

test('THE ILLUMINATION INVARIANT: no live glyph needs an untaught key', () => {
  let checked = 0;
  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    for (const layout of LAYOUTS) {
      for (const sentence of SENTENCES) {
        for (const glyph of classify(sentence, keySet, layout)) {
          if (!glyph.live) continue;
          checked += 1;
          assert.notEqual(glyph.key, null, `live glyph "${glyph.ch}" has no key`);
          for (const key of oracleKeys(glyph.ch, keySet)) {
            assert.ok(
              keySet.has(key),
              `stage ${stage.stage}: live "${glyph.ch}" needs untaught key "${key}"`,
            );
          }
        }
      }
    }
  }
  assert.ok(checked > 0);
});

test('a greyed glyph carries no key and no finger; a live one carries both', () => {
  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    for (const sentence of SENTENCES) {
      for (const glyph of classify(sentence, keySet, 'ansi')) {
        if (glyph.live) {
          assert.notEqual(glyph.key, null);
          assert.notEqual(glyph.finger, null);
        } else {
          assert.equal(glyph.key, null);
          assert.equal(glyph.finger, null);
        }
      }
    }
  }
});

test('classify preserves the text exactly; nothing is filtered or rewritten', () => {
  const keySet = keySetFor(stages, 0);
  for (const sentence of SENTENCES) {
    const glyphs = classify(sentence, keySet, 'ansi');
    assert.equal(glyphs.map((g) => g.ch).join(''), sentence);
  }
});

test('space is live from stage 0', () => {
  const keySet = keySetFor(stages, 0);
  assert.ok(keySet.has('<space>'));
  const glyphs = classify('f j', keySet, 'ansi');
  const space = glyphs[1];
  assert.ok(space !== undefined);
  assert.equal(space.ch, ' ');
  assert.equal(space.live, true);
  assert.equal(space.key, '<space>');
  assert.equal(space.finger, 'rt');

  // Present in every stage's set, and never absent from any real sentence.
  for (const stage of stages) {
    assert.ok(keySetFor(stages, stage.stage).has('<space>'));
  }
});

test('capitals need <shift>, so they stay greyed until stage 8', () => {
  const shiftStage = stages.find((s) => s.keys.includes('<shift>'));
  assert.ok(shiftStage !== undefined);
  assert.equal(shiftStage.stage, 8); // tuning-exempt: pins the curriculum table's own stage number for <shift>, not a tunable

  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    const glyphs = classify('In the beginning', keySet, 'ansi');
    const capital = glyphs[0];
    assert.ok(capital !== undefined);
    assert.equal(capital.ch, 'I');
    assert.equal(
      capital.live,
      stage.stage >= shiftStage.stage,
      `capital I at stage ${stage.stage}`,
    );
  }

  // Its lowercase form is taught long before, which is the point: the capital
  // is withheld for the shift key, not for the letter.
  const beforeShift = keySetFor(stages, shiftStage.stage - 1);
  assert.ok(beforeShift.has('i'));
  assert.ok(!beforeShift.has('<shift>'));
});

test('classification never varies with keyboard layout, only the finger does', () => {
  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    for (const sentence of SENTENCES) {
      const ansi = classify(sentence, keySet, 'ansi');
      const iso = classify(sentence, keySet, 'iso');
      assert.deepEqual(
        ansi.map((g) => [g.ch, g.live, g.key]),
        iso.map((g) => [g.ch, g.live, g.key]),
      );
    }
  }
});

test('coverage rises monotonically through the curriculum', () => {
  for (const sentence of SENTENCES) {
    let previous = 0;
    for (const stage of stages) {
      const now = coverage(classify(sentence, keySetFor(stages, stage.stage), 'ansi'));
      assert.ok(now >= previous, `coverage fell at stage ${stage.stage}: ${sentence}`);
      previous = now;
    }
  }
});

test('coverage is live over total', () => {
  assert.equal(coverage([]), 0);
  const keySet = keySetFor(stages, 0);
  const glyphs = classify('fjz', keySet, 'ansi');
  assert.equal(glyphs.filter((g) => g.live).length, 2);
  assert.equal(coverage(glyphs), 2 / glyphs.length);
});

test('the last stage lights ordinary lowercase prose completely', () => {
  const last = stageAt(stages, stages.length - 1);
  const keySet = keySetFor(stages, last.stage);
  assert.equal(coverage(classify('the quick brown fox jumps over the lazy dog.', keySet, 'ansi')), 1);
  assert.equal(coverage(classify('In the beginning God created the heavens.', keySet, 'ansi')), 1);
});

test('fingerFor names the touch-typing finger', () => {
  assert.equal(fingerFor('f', 'ansi'), 'li');
  assert.equal(fingerFor('j', 'ansi'), 'ri');
  assert.equal(fingerFor('a', 'ansi'), 'lp');
  assert.equal(fingerFor(';', 'ansi'), 'rp');
  assert.equal(fingerFor('<space>', 'ansi'), 'rt');
  assert.equal(fingerFor('<shift>', 'ansi'), 'lp');
  assert.equal(fingerFor(':', 'ansi'), 'rp');
  assert.equal(fingerFor('E', 'ansi'), 'lm');
  assert.throws(() => fingerFor('<meta>', 'ansi'));
});

test('layout changes the finger for the keys that actually move', () => {
  assert.equal(fingerFor('\\', 'ansi'), 'rp');
  assert.equal(fingerFor('\\', 'iso'), 'lp');
  assert.equal(fingerFor('"', 'ansi'), 'rp');
  assert.equal(fingerFor('"', 'iso'), 'lr');
  for (const key of ['f', 'j', 'a', ';', "'", '<space>']) {
    assert.equal(fingerFor(key, 'ansi'), fingerFor(key, 'iso'));
  }
});
