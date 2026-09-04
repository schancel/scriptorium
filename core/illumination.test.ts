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
import type { Finger, Key, KeyboardLayout, Stage } from './types.js';
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
  const lower = ch.toLowerCase();
  // A character the curriculum names outright is its own key -- `:` at stage 8
  // -- but it still costs the shift the hands actually have to hold.
  if (lower !== ch) return ['<shift>', keySet.has(ch) ? ch : lower];
  const base = SHIFTED_ON[ch];
  if (base !== undefined) return ['<shift>', keySet.has(ch) ? ch : base];
  return [ch];
}

/** The hand a finger belongs to, for the opposite-hand shift rule. */
function hand(finger: Finger): string {
  return finger.startsWith('l') ? 'left' : 'right';
}

const LAYOUTS: readonly KeyboardLayout[] = ['ansi', 'iso'];

/** The stage that teaches `<shift>`, read off the curriculum rather than typed. */
const SHIFT_STAGE: Stage | undefined = stages.find((s) => s.keys.includes('<shift>'));

test('THE ILLUMINATION INVARIANT: no live glyph needs an untaught key', () => {
  let checked = 0;
  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    for (const layout of LAYOUTS) {
      for (const sentence of SENTENCES) {
        for (const glyph of classify(sentence, keySet, layout)) {
          if (!glyph.live) continue;
          checked += 1;
          assert.ok(glyph.strokes.length > 0, `live glyph "${glyph.ch}" has no strokes`);
          const oracle = oracleKeys(glyph.ch, keySet);
          for (const key of oracle) {
            assert.ok(
              keySet.has(key),
              `stage ${stage.stage}: live "${glyph.ch}" needs untaught key "${key}"`,
            );
          }
          // Every key the glyph *claims* to cost is taught, too -- the claim and
          // the oracle have to be the same list, or the invariant above is
          // checking a model the game does not use. This is the half that the
          // one-key-per-glyph model could not state: the shift of a capital was
          // simply not in the list.
          assert.deepEqual(
            glyph.strokes.map((s) => s.key),
            oracle,
            `stage ${stage.stage}: strokes for "${glyph.ch}" disagree with the oracle`,
          );
          for (const stroke of glyph.strokes) {
            assert.ok(
              keySet.has(stroke.key),
              `stage ${stage.stage}: live "${glyph.ch}" strikes untaught key "${stroke.key}"`,
            );
          }
        }
      }
    }
  }
  assert.ok(checked > 0);
});

test('a greyed glyph carries no strokes; a live one carries a key and a finger for each', () => {
  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    for (const sentence of SENTENCES) {
      for (const glyph of classify(sentence, keySet, 'ansi')) {
        if (glyph.live) {
          assert.ok(glyph.strokes.length > 0);
          const primary = glyph.strokes[glyph.strokes.length - 1];
          assert.ok(primary !== undefined);
          assert.equal(primary.finger, fingerFor(primary.key, 'ansi'), primary.key);
          // Only shift is ever a modifier, and its finger is the letter's
          // business rather than the table's -- see the opposite-hand test.
          for (const stroke of glyph.strokes.slice(0, -1)) {
            assert.equal(stroke.key, '<shift>');
          }
        } else {
          // Nothing is being asked for, so there is nothing to strike. `typing.ts`
          // reads an empty stroke list as "greyed" and snaps the cursor past it.
          assert.deepEqual(glyph.strokes, []);
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
  assert.deepEqual(space.strokes, [{ key: '<space>', finger: 'rt' }]);

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

test('a capital is two strokes: shift first, struck by the opposite hand', () => {
  assert.ok(SHIFT_STAGE !== undefined);
  const keySet = keySetFor(stages, SHIFT_STAGE.stage);

  // A left-hand letter takes the RIGHT shift, and a right-hand letter the LEFT.
  // This is the habit stage 8 exists to build and the one a two-finger typist
  // has never formed: shifting with the hand that is about to strike the letter
  // rolls it off home row for every capital in the corpus.
  const cases: readonly (readonly [string, string, string])[] = [
    ['A', 'a', 'left'],   // left pinky letter -> right shift
    ['S', 's', 'left'],
    ['G', 'g', 'left'],
    ['J', 'j', 'right'],  // right index letter -> left shift
    ['P', 'p', 'right'],
    ['O', 'o', 'right'],
  ];

  for (const layout of LAYOUTS) {
    for (const [capital, letter, letterHand] of cases) {
      const glyph = classify(capital, keySet, layout)[0];
      assert.ok(glyph !== undefined);
      assert.equal(glyph.live, true, capital);
      assert.equal(glyph.strokes.length, 2, `"${capital}" is two keys, not one`);

      const [shift, primary] = glyph.strokes;
      assert.ok(shift !== undefined && primary !== undefined);
      assert.equal(shift.key, '<shift>', 'the modifier comes first');
      assert.equal(primary.key, letter, 'the printing key comes last');
      assert.equal(primary.finger, fingerFor(letter, layout));
      assert.equal(hand(primary.finger), letterHand, `${capital} fixture`);
      assert.notEqual(
        hand(shift.finger),
        hand(primary.finger),
        `"${capital}": shift must be held by the other hand`,
      );
      assert.ok(shift.finger === 'lp' || shift.finger === 'rp', 'shift is a pinky');
    }
  }

  // Both hands really are exercised by the fixture above, so a rule that always
  // answered "left shift" could not pass it.
  const shiftFingers = new Set(
    cases.map(([capital]) => classify(capital, keySet, 'ansi')[0]?.strokes[0]?.finger),
  );
  assert.deepEqual([...shiftFingers].sort(), ['lp', 'rp']);
});

test('a shifted punctuation mark costs its shift too, and names its own key', () => {
  assert.ok(SHIFT_STAGE !== undefined);
  const keySet = keySetFor(stages, SHIFT_STAGE.stage);
  const colon = classify(':', keySet, 'ansi')[0];
  assert.ok(colon !== undefined);
  assert.equal(colon.live, true);
  // `:` is a stage-8 key in its own right, so it stays the key the report card
  // and the gate name -- but it is struck with shift held, and the overlay has
  // to be able to say so.
  assert.deepEqual(
    colon.strokes.map((s) => s.key),
    ['<shift>', ':'],
  );
  assert.equal(colon.strokes[1]?.finger, 'rp');
  assert.equal(colon.strokes[0]?.finger, 'lp', 'a right-hand key takes the left shift');

  // The unshifted key beneath it is one stroke and no shift.
  assert.deepEqual(classify(';', keySet, 'ansi')[0]?.strokes, [{ key: ';', finger: 'rp' }]);
});

test('classification never varies with keyboard layout, only the finger does', () => {
  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    for (const sentence of SENTENCES) {
      const ansi = classify(sentence, keySet, 'ansi');
      const iso = classify(sentence, keySet, 'iso');
      assert.deepEqual(
        ansi.map((g) => [g.ch, g.live, g.strokes.map((s) => s.key)]),
        iso.map((g) => [g.ch, g.live, g.strokes.map((s) => s.key)]),
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


// --- producible, which is not the same as live ------------------------------
//
// Gilding requires every character the player *could* type, so classification
// has to separate the letter that is untaught from the one no board makes.
// docs/design/01-illumination.md#gilding-a-mode-for-people-who-already-type

test('a live glyph is always producible, at every stage, over the real sentences', () => {
  for (const stage of stages) {
    const keySet = keySetFor(stages, stage.stage);
    for (const sentence of SENTENCES) {
      for (const glyph of classify(sentence, keySet, 'ansi')) {
        if (glyph.live) assert.equal(glyph.producible, true, glyph.ch);
      }
    }
  }
});

test('an untaught character is producible; one no keyboard makes is not', () => {
  const stage1 = keySetFor(stages, 1);
  // `I` needs <shift>, taught at stage 8: greyed here, and gilding must ask for
  // it. The em dash and the curly quote are on nobody's board at any stage.
  const glyphs = classify('I—s’', stage1, 'ansi');
  assert.deepEqual(
    glyphs.map((g) => [g.ch, g.live, g.producible]),
    [['I', false, true], ['—', false, false], ['s', true, true], ['’', false, false]],
  );
});

test('producibility is a fact about the board, so it never varies by stage', () => {
  for (const ch of ['—', '’', '…']) {
    for (const stage of stages) {
      const glyph = classify(ch, keySetFor(stages, stage.stage), 'ansi')[0];
      assert.equal(glyph?.producible, false, `${ch} at stage ${String(stage.stage)}`);
    }
  }
  // And a character the board makes stays producible at stage 0, where almost
  // nothing is taught.
  for (const ch of ['z', 'Q', '?', '!', '(']) {
    const glyph = classify(ch, keySetFor(stages, 0), 'ansi')[0];
    assert.equal(glyph?.producible, true, ch);
    assert.equal(glyph?.live, false, `${ch} must not be live at stage 0`);
  }
});

test('producibility never changes what is live -- the illumination invariant is untouched', () => {
  for (const stage of stages) {
    for (const layout of ['ansi', 'iso'] as const) {
      for (const sentence of SENTENCES) {
        const glyphs = classify(sentence, keySetFor(stages, stage.stage), layout);
        for (const glyph of glyphs) {
          // Every producible-but-greyed glyph still carries no strokes: nothing
          // is being *asked for*, which is what greyed means.
          if (!glyph.live) assert.equal(glyph.strokes.length, 0, glyph.ch);
        }
      }
    }
  }
});
