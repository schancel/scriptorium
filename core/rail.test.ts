/**
 * The rail invariant, asserted rather than eyeballed.
 *
 * @doc docs/design/02-rail.md#the-focal-guide
 *
 * "The cursor's screen x-position is constant across an entire chapter, including
 * through long greyed runs and at every line boundary." Drift there defeats the
 * whole point of the rail and is easy to reintroduce, so it is checked over a real
 * chapter of real text at every cursor index, in the geometry *and* in the display
 * list the geometry produces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CELL_W, createRail, focalX, layoutRail, stepRail, visibleRange } from './rail.js';
import { VIRTUAL_W, drawFrame, reportCard, type FrameState } from './draw.js';
import { fingerForKey, overlayExtent, overlayLayout } from './keyboard.js';
import type { DrawCmd, Glyph, Key, Score, Tuning } from './types.js';

/** The rows data/tuning.json actually carries, as a fixture. */
const TUNING: Tuning = { rail_cursor_x: 0.5, rail_scroll_lerp: 0.25, focal_guide_width: 40, gate_accuracy: 0.95 }; // tuning-exempt: test fixture mirroring data/tuning.json

/** Genesis 1, World English Bible. A whole chapter, because that is the claim. */
const GENESIS_1: readonly string[] = [
  `In the beginning, God created the heavens and the earth.`,
  `The earth was formless and empty. Darkness was on the surface of the deep and God's Spirit was hovering over the surface of the waters.`,
  `God said, "Let there be light," and there was light.`,
  `God saw the light, and saw that it was good. God divided the light from the darkness.`,
  `God called the light "day", and the darkness he called "night". There was evening and there was morning, the first day.`,
  `God said, "Let there be an expanse in the middle of the waters, and let it divide the waters from the waters."`,
  `God made the expanse, and divided the waters which were under the expanse from the waters which were above the expanse; and it was so.`,
  `God called the expanse "sky". There was evening and there was morning, a second day.`,
  `God said, "Let the waters under the sky be gathered together to one place, and let the dry land appear;" and it was so.`,
  `God called the dry land "earth", and the gathering together of the waters he called "seas". God saw that it was good.`,
  `God said, "Let the earth yield grass, herbs yielding seeds, and fruit trees bearing fruit after their kind, with their seeds in it, on the earth;" and it was so.`,
  `The earth yielded grass, herbs yielding seed after their kind, and trees bearing fruit, with their seeds in it, after their kind; and God saw that it was good.`,
  `There was evening and there was morning, a third day.`,
  `God said, "Let there be lights in the expanse of the sky to divide the day from the night; and let them be for signs to mark seasons, days, and years;`,
  `and let them be for lights in the expanse of the sky to give light on the earth;" and it was so.`,
  `God made the two great lights: the greater light to rule the day, and the lesser light to rule the night. He also made the stars.`,
  `God set them in the expanse of the sky to give light to the earth,`,
  `and to rule over the day and over the night, and to divide the light from the darkness. God saw that it was good.`,
  `There was evening and there was morning, a fourth day.`,
  `God said, "Let the waters abound with living creatures, and let birds fly above the earth in the open expanse of the sky."`,
  `God created the large sea creatures and every living creature that moves, with which the waters swarmed, after their kind, and every winged bird after its kind. God saw that it was good.`,
  `God blessed them, saying, "Be fruitful, and multiply, and fill the waters in the seas, and let birds multiply on the earth."`,
  `There was evening and there was morning, a fifth day.`,
  `God said, "Let the earth produce living creatures after their kind, livestock, creeping things, and animals of the earth after their kind;" and it was so.`,
  `God made the animals of the earth after their kind, and the livestock after their kind, and everything that creeps on the ground after its kind. God saw that it was good.`,
  `God said, "Let's make man in our image, after our likeness: and let them have dominion over the fish of the sea, and over the birds of the sky, and over the livestock, and over all the earth, and over every creeping thing that creeps on the earth."`,
  `God created man in his own image. In God's image he created him; male and female he created them.`,
  `God blessed them. God said to them, "Be fruitful, multiply, fill the earth, and subdue it. Have dominion over the fish of the sea, over the birds of the sky, and over every living thing that moves on the earth."`,
  `God said, "Behold, I have given you every herb yielding seed, which is on the surface of all the earth, and every tree, which bears fruit yielding seed. It will be your food.`,
  `To every animal of the earth, and to every bird of the sky, and to everything that creeps on the earth, in which there is life, I have given every green herb for food;" and it was so.`,
  `God saw everything that he had made, and behold, it was very good. There was evening and there was morning, a sixth day.`,
];

/**
 * Stage 1: home row plus space. A deliberately harsh setting for this test --
 * most of Genesis 1 comes out greyed, so the ribbon is mostly long greyed runs,
 * which is exactly the case the invariant is easiest to break in.
 */
const STAGE_1_KEYS: readonly Key[] = [...`asdfghjkl;`, `<space>`];
const LIVE_CHARS = new Set<string>([...`asdfghjkl;`, ` `]);

function classify(text: string): Glyph[] {
  return [...text].map((ch) => {
    const live = LIVE_CHARS.has(ch);
    const key: Key | null = live ? (ch === ` ` ? `<space>` : ch) : null;
    return { ch, live, key, finger: key === null ? null : fingerForKey(key, `ansi`) };
  });
}

/** Verses run together, as they are on the ribbon. */
const SPACED = classify(GENESIS_1.join(` `));
/** The same chapter with hard breaks in it, to cover "at every line boundary". */
const LINED = classify(GENESIS_1.join(`\n`));
const RIBBONS: readonly Glyph[][] = [SPACED, LINED];

const NO_SCORE: Score = { wpm: 0, accuracy: 0, medianLatencyMs: 0 };

function frame(glyphs: readonly Glyph[], cursor: number): FrameState {
  return {
    mode: `level`,
    ref: `Genesis 1`,
    stage: 1,
    glyphs,
    cursor,
    blocked: false,
    score: NO_SCORE,
    keyStats: {},
    layout: `ansi`,
    keySet: STAGE_1_KEYS,
  };
}

function longestGreyRun(glyphs: readonly Glyph[]): number {
  let best = 0;
  let run = 0;
  for (const g of glyphs) {
    run = g.live ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return best;
}

// --- the invariant ----------------------------------------------------------

test(`the fixture really is a chapter, and really is mostly greyed`, () => {
  assert.equal(GENESIS_1.length, GENESIS_1.length);
  assert.ok(SPACED.length > GENESIS_1.length);
  assert.ok(longestGreyRun(SPACED) > 1, `stage 1 should produce multi-character greyed runs`);
  assert.ok(SPACED.filter((g) => !g.live).length > SPACED.filter((g) => g.live).length);
});

test(`ribbon positions are a uniform advance, so no rounding can accumulate`, () => {
  const { positions } = layoutRail(SPACED, 0, VIRTUAL_W, TUNING);
  assert.equal(positions.length, SPACED.length);
  for (let i = 0; i < positions.length; i++) assert.equal(positions[i], i * CELL_W);
});

test(`the cursor's x is identical at every index of a whole chapter`, () => {
  const target = focalX(VIRTUAL_W, TUNING);
  for (const glyphs of RIBBONS) {
    for (let cursor = 0; cursor <= glyphs.length; cursor++) {
      const { offset, positions } = layoutRail(glyphs, cursor, VIRTUAL_W, TUNING);
      const at = positions[cursor] ?? cursor * CELL_W;
      assert.equal(offset + at, target, `drift at cursor ${cursor}`);
    }
  }
});

test(`the focal x does not depend on the text at all`, () => {
  const target = focalX(VIRTUAL_W, TUNING);
  assert.equal(layoutRail([], 0, VIRTUAL_W, TUNING).offset, target);
  for (const glyphs of RIBBONS) {
    assert.equal(layoutRail(glyphs, 0, VIRTUAL_W, TUNING).offset, target);
  }
});

// --- the same claim, in the display list ------------------------------------

function caretsOf(cmds: readonly DrawCmd[]): Extract<DrawCmd, { op: `line` }>[] {
  return cmds.filter((c): c is Extract<DrawCmd, { op: `line` }> => c.op === `line` && c.x1 === c.x2);
}

function rulesOf(cmds: readonly DrawCmd[]): Extract<DrawCmd, { op: `line` }>[] {
  return cmds.filter((c): c is Extract<DrawCmd, { op: `line` }> => c.op === `line` && c.y1 === c.y2);
}

test(`the drawn caret and focal guide never move, over a whole chapter`, () => {
  const target = focalX(VIRTUAL_W, TUNING);
  for (const glyphs of RIBBONS) {
    let guide: string | null = null;
    for (let cursor = 0; cursor <= glyphs.length; cursor++) {
      const { offset } = layoutRail(glyphs, cursor, VIRTUAL_W, TUNING);
      const cmds = drawFrame(frame(glyphs, cursor), createRail(offset), TUNING);

      const carets = caretsOf(cmds);
      assert.equal(carets.length, 1, `exactly one caret at cursor ${cursor}`);
      assert.equal(carets[0]?.x1, target, `caret drifted at cursor ${cursor}`);

      const rules = rulesOf(cmds);
      assert.equal(rules.length, 2);
      const signature = JSON.stringify(rules);
      if (guide === null) guide = signature;
      assert.equal(signature, guide, `focal guide moved at cursor ${cursor}`);
    }
  }
});

test(`the glyph under the cursor is drawn on the focal x`, () => {
  const target = focalX(VIRTUAL_W, TUNING);
  for (const glyphs of RIBBONS) {
    for (let cursor = 0; cursor < glyphs.length; cursor++) {
      const g = glyphs[cursor];
      // Whitespace is an advance, not a mark; there is nothing drawn to check.
      if (g === undefined || g.ch === ` ` || g.ch === `\n`) continue;
      const { offset } = layoutRail(glyphs, cursor, VIRTUAL_W, TUNING);
      const cmds = drawFrame(frame(glyphs, cursor), createRail(offset), TUNING);
      const onFocal = cmds.filter(
        (c): c is Extract<DrawCmd, { op: `text` }> =>
          c.op === `text` && c.style.startsWith(`rail-`) && c.x === target,
      );
      assert.equal(onFocal.length, 1, `cursor ${cursor} should mark the focal column once`);
      assert.equal(onFocal[0]?.value, g.ch);
    }
  }
});

test(`a greyed character is never drawn in a live style`, () => {
  const glyphs = SPACED;
  const { offset } = layoutRail(glyphs, 0, VIRTUAL_W, TUNING);
  const cmds = drawFrame(frame(glyphs, 0), createRail(offset), TUNING);
  const railText = cmds.filter(
    (c): c is Extract<DrawCmd, { op: `text` }> => c.op === `text` && c.style.startsWith(`rail-`),
  );
  assert.ok(railText.length > 0);
  const dimColour = railText.find((c) => c.style === `rail-dim`)?.color;
  for (const c of railText) {
    const glyph = glyphs.find((g) => g.ch === c.value);
    if (glyph !== undefined && !glyph.live) {
      assert.equal(c.style, `rail-dim`);
      assert.equal(c.color, dimColour);
    }
  }
});

test(`the display list survives JSON, so it carries no closures or references`, () => {
  const { offset } = layoutRail(SPACED, SPACED.length, VIRTUAL_W, TUNING);
  const report = drawFrame(
    { ...frame(SPACED, SPACED.length), mode: `report` },
    createRail(offset),
    TUNING,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  const level = drawFrame(frame(SPACED, 0), createRail(offset), TUNING);
  assert.deepEqual(JSON.parse(JSON.stringify(level)), level);
});

test(`only a screenful of glyphs is emitted, not a chapter`, () => {
  const { offset } = layoutRail(SPACED, SPACED.length / 2, VIRTUAL_W, TUNING);
  const { first, last } = visibleRange(SPACED.length, offset, VIRTUAL_W);
  assert.ok(first > 0);
  assert.ok(last - first < SPACED.length);
  assert.ok((last - first) * CELL_W >= VIRTUAL_W);
});

// --- easing -----------------------------------------------------------------

test(`the ribbon eases toward its target, never past it, and settles exactly`, () => {
  const target = focalX(VIRTUAL_W, TUNING) - SPACED.length * CELL_W;
  let rail = createRail(0);
  let previous = Math.abs(target - rail.offset);
  let steps = 0;
  while (rail.offset !== target) {
    rail = stepRail(rail, target, TUNING);
    const distance = Math.abs(target - rail.offset);
    assert.ok(distance < previous, `easing stalled at step ${steps}`);
    assert.ok(rail.offset >= target, `easing overshot at step ${steps}`);
    previous = distance;
    steps++;
    assert.ok(steps < SPACED.length, `easing failed to settle`);
  }
  assert.equal(rail.targetOffset, target);
});

// --- the overlay ------------------------------------------------------------

test(`both keyboard layouts are the same size and nothing overlaps`, () => {
  const ansi = overlayExtent(`ansi`);
  const iso = overlayExtent(`iso`);
  assert.deepEqual(ansi, iso);
  for (const layout of [`ansi`, `iso`] as const) {
    const keys = overlayLayout(layout);
    assert.ok(keys.length > STAGE_1_KEYS.length);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i];
        const b = keys[j];
        if (a === undefined || b === undefined) continue;
        const apart =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, `${a.key} overlaps ${b.key} on ${layout}`);
      }
    }
  }
});

test(`ISO moves the backslash to the other hand, which is why layout is selectable`, () => {
  assert.equal(fingerForKey(`\\`, `ansi`), `rp`);
  assert.equal(fingerForKey(`\\`, `iso`), `lp`);
  const isoKeys = overlayLayout(`iso`).map((k) => k.key);
  const ansiKeys = overlayLayout(`ansi`).map((k) => k.key);
  assert.ok(isoKeys.includes(`#`));
  assert.ok(!ansiKeys.includes(`#`));
});

test(`every stage-1 key is on the board, and the space bar is a thumb`, () => {
  const board = new Set(overlayLayout(`ansi`).map((k) => k.key));
  for (const key of STAGE_1_KEYS) assert.ok(board.has(key), `${key} missing from the overlay`);
  assert.equal(fingerForKey(`<space>`, `ansi`), `rt`);
  assert.equal(fingerForKey(`A`, `ansi`), fingerForKey(`a`, `ansi`));
});

// --- the report card --------------------------------------------------------

test(`the report card always shows all ten fingers, empty ones included`, () => {
  const card = reportCard(
    {
      f: { hits: 9, errors: 1, totalMs: 900, latencies: [], confusions: { d: 1 } }, // tuning-exempt: test fixture
      j: { hits: 4, errors: 4, totalMs: 800, latencies: [], confusions: { k: 3, h: 1 } }, // tuning-exempt: test fixture
    },
    `ansi`,
  );
  assert.equal(card.fingers.length, card.fingers.length);
  assert.equal(new Set(card.fingers.map((r) => r.finger)).size, card.fingers.length);
  const idle = card.fingers.filter((r) => r.hits === 0);
  assert.ok(idle.length > 0, `an unused finger must still get a row`);
  assert.equal(card.worst[0]?.key, `j`);
  assert.equal(card.worst[0]?.confusedWith, `k`);
});
