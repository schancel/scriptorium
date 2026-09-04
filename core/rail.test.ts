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
import { PALETTE_ORDER, VIRTUAL_W, drawFrame, reportCard, type FrameState } from './draw.js';
import {
  DEFAULT_SPACE_THUMB,
  fingerForKey,
  overlayExtent,
  overlayLayout,
  reportFingers,
} from './keyboard.js';
import { classify as illuminate, fingerFor } from './illumination.js';
import type { DrawCmd, Glyph, Key, KeyStat, Score, Tuning } from './types.js';

/** The rows data/tuning.json actually carries, as a fixture. */
const TUNING: Tuning = { rail_cursor_x: 0.5, rail_scroll_lerp: 0.25, focal_guide_width: 40, gate_accuracy: 0.95, mastery_min_samples: 20 }; // tuning-exempt: test fixture mirroring data/tuning.json

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
    // Greyed but producible: every character in Genesis 1 is on the board, it is
    // only the keys that are untaught at stage 1.
    if (!LIVE_CHARS.has(ch)) return { ch, live: false, strokes: [], producible: true };
    const key: Key = ch === ` ` ? `<space>` : ch;
    return { ch, live: true, strokes: [{ key, finger: fingerFor(key, `ansi`) }], producible: true };
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

// --- the space affordance ---------------------------------------------------

/**
 * A space that is still owed is marked with a low bar in its own cell, so the
 * marks are the only rects narrow enough to fit one. Every key face on the
 * overlay is wider than a glyph cell, and every band is the width of the screen.
 */
function spaceMarksOf(cmds: readonly DrawCmd[]): Extract<DrawCmd, { op: `rect` }>[] {
  return cmds.filter(
    (c): c is Extract<DrawCmd, { op: `rect` }> => c.op === `rect` && c.w <= CELL_W,
  );
}

const GOLD = PALETTE_ORDER.indexOf(`gold`);

/** Width of the widest highlighted key face, which is the key being asked for. */
function highlightedKeyWidth(cmds: readonly DrawCmd[]): number {
  let widest = 0;
  for (const c of cmds) {
    if (c.op !== `rect` || c.color !== GOLD || c.w <= CELL_W || c.w >= VIRTUAL_W) continue;
    widest = Math.max(widest, c.w);
  }
  return widest;
}

const FIRST_SPACE = SPACED.findIndex((g) => g.ch === ` `);
const FIRST_LETTER = SPACED.findIndex((g) => g.live && g.ch !== ` `);

test(`the fixture has both a space and a letter to sit the cursor on`, () => {
  assert.ok(FIRST_SPACE > 0);
  assert.ok(FIRST_LETTER >= 0);
  assert.equal(SPACED[FIRST_SPACE]?.live, true);
});

test(`a space still owed is drawn; one already typed is not`, () => {
  const { offset } = layoutRail(SPACED, FIRST_SPACE, VIRTUAL_W, TUNING);
  const cmds = drawFrame(frame(SPACED, FIRST_SPACE), createRail(offset), TUNING);
  const focal = focalX(VIRTUAL_W, TUNING);
  const marks = spaceMarksOf(cmds);

  assert.ok(marks.length > 0, `a pending space must leave something to press`);
  // Nothing behind the cursor: a typed space goes back to being a gap.
  for (const m of marks) assert.ok(m.x >= focal, `a space behind the cursor was marked`);

  const { first, last } = visibleRange(SPACED.length, offset, VIRTUAL_W);
  let owed = 0;
  for (let i = Math.max(first, FIRST_SPACE); i < last; i++) {
    if (SPACED[i]?.ch === ` ` && SPACED[i]?.live === true) owed += 1;
  }
  assert.equal(marks.length, owed, `one mark per space still owed, no more and no fewer`);
});

test(`the caret is unambiguous when it lands on a space`, () => {
  const focal = focalX(VIRTUAL_W, TUNING);
  for (const blocked of [false, true]) {
    const { offset } = layoutRail(SPACED, FIRST_SPACE, VIRTUAL_W, TUNING);
    const cmds = drawFrame(
      { ...frame(SPACED, FIRST_SPACE), blocked },
      createRail(offset),
      TUNING,
    );
    const caret = caretsOf(cmds)[0];
    const under = spaceMarksOf(cmds).find((m) => m.x === focal);
    assert.ok(under !== undefined, `the space under the cursor is unmarked`);
    // Full cell width and the caret's own colour, so the two read as one thing.
    assert.equal(under.w, CELL_W);
    assert.equal(under.color, caret?.color);
    // And louder than the spaces merely pending behind it.
    for (const m of spaceMarksOf(cmds)) {
      if (m.x !== focal) assert.ok(m.w < under.w && m.color !== under.color);
    }
  }
});

test(`the marks never disturb the caret or the focal guide`, () => {
  const { offset } = layoutRail(SPACED, FIRST_SPACE, VIRTUAL_W, TUNING);
  const cmds = drawFrame(frame(SPACED, FIRST_SPACE), createRail(offset), TUNING);
  assert.equal(caretsOf(cmds).length, 1);
  assert.equal(rulesOf(cmds).length, 2);
});

test(`a passage with every space typed draws no marks at all`, () => {
  const { offset } = layoutRail(SPACED, SPACED.length, VIRTUAL_W, TUNING);
  const cmds = drawFrame(frame(SPACED, SPACED.length), createRail(offset), TUNING);
  assert.equal(spaceMarksOf(cmds).length, 0);
});

test(`the space bar is the key the overlay lights when a space is next`, () => {
  const spaceFrame = drawFrame(
    frame(SPACED, FIRST_SPACE),
    createRail(layoutRail(SPACED, FIRST_SPACE, VIRTUAL_W, TUNING).offset),
    TUNING,
  );
  const letterFrame = drawFrame(
    frame(SPACED, FIRST_LETTER),
    createRail(layoutRail(SPACED, FIRST_LETTER, VIRTUAL_W, TUNING).offset),
    TUNING,
  );
  const onSpace = highlightedKeyWidth(spaceFrame);
  const onLetter = highlightedKeyWidth(letterFrame);
  assert.ok(onLetter > 0, `some key is highlighted for a letter`);
  // The space bar is the widest key on the board; nothing else could be this.
  assert.ok(onSpace > onLetter, `the space bar is not the highlighted key`);

  const hint = spaceFrame.find(
    (c): c is Extract<DrawCmd, { op: `text` }> => c.op === `text` && c.style === `hint-center`,
  );
  assert.ok(hint?.value.includes(`space`), `the hint should name the space bar: ${hint?.value}`);
});

// --- the overlay ------------------------------------------------------------

/**
 * The overlay's key faces, paired back with the keys they were drawn for.
 *
 * Every key face carries an `alpha` -- it is either taught or dimmed -- and
 * nothing else in a level frame does, so the rects can be matched one for one
 * against `overlayLayout` in paint order. Cheaper and less brittle than
 * re-deriving the board's pixel geometry here.
 */
function keyFaces(cmds: readonly DrawCmd[]): { key: Key; lit: boolean; dim: boolean }[] {
  const rects = cmds.filter(
    (c): c is Extract<DrawCmd, { op: `rect` }> => c.op === `rect` && c.alpha !== undefined,
  );
  const keys = overlayLayout(`ansi`);
  assert.equal(rects.length, keys.length, `one face per key`);
  return keys.map((k, i) => ({
    key: k.key,
    lit: rects[i]?.color === GOLD,
    dim: (rects[i]?.alpha ?? 1) < 1,
  }));
}

/** Stage 8: home row, the letters below, and the shift that lights capitals. */
const SHIFT_KEYS: readonly Key[] = [...STAGE_1_KEYS, `<shift>`];

function overlayFor(text: string): { key: Key; lit: boolean; dim: boolean }[] {
  const glyphs = illuminate(text, new Set(SHIFT_KEYS), `ansi`);
  assert.equal(glyphs[0]?.live, true, `${text} must be live for this test to mean anything`);
  return keyFaces(
    drawFrame({ ...frame(glyphs, 0), keySet: SHIFT_KEYS }, createRail(0), TUNING),
  );
}

test(`a capital lights the letter and the shift held by the other hand`, () => {
  // The visible payoff of the stroke model, and the thing the overlay could not
  // do before: point at the *far* shift. Pointing at the near one would drill
  // the same-hand shift, which is the two-finger typist's habit and the reason
  // stage 8 exists at all.
  const left = overlayFor(`A`);
  assert.deepEqual(
    left.filter((f) => f.lit).map((f) => f.key).sort(),
    [`<rshift>`, `a`],
    `a left-hand capital takes the right shift`,
  );

  const right = overlayFor(`J`);
  assert.deepEqual(
    right.filter((f) => f.lit).map((f) => f.key).sort(),
    [`<shift>`, `j`],
    `a right-hand capital takes the left shift`,
  );

  // An unshifted letter still lights exactly one key: no shift is owed.
  assert.deepEqual(overlayFor(`a`).filter((f) => f.lit).map((f) => f.key), [`a`]);
});

test(`both shift keys stop being dim when the curriculum teaches shift`, () => {
  // The board draws two shift keys and the curriculum names one. Keying the
  // dimming off the drawn name left `<rshift>` greyed for ever -- half of what
  // stage 8 unlocks, permanently marked untaught.
  for (const face of overlayFor(`A`)) {
    if (face.key === `<shift>` || face.key === `<rshift>`) {
      assert.equal(face.dim, false, `${face.key} should be taught at stage 8`);
    }
  }
  const untaught = keyFaces(
    drawFrame(frame(SPACED, 0), createRail(0), TUNING),
  ).filter((f) => f.key === `<shift>` || f.key === `<rshift>`);
  assert.equal(untaught.length, 2);
  for (const face of untaught) assert.equal(face.dim, true, `${face.key} at stage 1`);
});

test(`the hint names both keys of a capital, and the finger for each`, () => {
  const glyphs = illuminate(`A`, new Set(SHIFT_KEYS), `ansi`);
  const cmds = drawFrame({ ...frame(glyphs, 0), keySet: SHIFT_KEYS }, createRail(0), TUNING);
  const hint = cmds.find(
    (c): c is Extract<DrawCmd, { op: `text` }> => c.op === `text` && c.style === `hint-center`,
  );
  assert.ok(hint !== undefined);
  assert.ok(hint.value.includes(`shift`), hint.value);
  assert.ok(hint.value.includes(`a`), hint.value);
  // Named in striking order, and the shift is the far pinky: `a` is a left-hand
  // letter, so the hint must read "shift (R pinky)" and never "shift (L pinky)".
  assert.ok(hint.value.startsWith(`next: shift (R pinky)`), hint.value);
  assert.ok(hint.value.endsWith(`a (L pinky)`), hint.value);
});

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

const TWO_FINGER_STATS: Readonly<Record<Key, KeyStat>> = {
  f: { hits: 9, errors: 1, totalMs: 900, latencies: [], confusions: { d: 1 } }, // tuning-exempt: test fixture
  j: { hits: 4, errors: 4, totalMs: 800, latencies: [], confusions: { k: 3, h: 1 } }, // tuning-exempt: test fixture
};

test(`the report card shows every finger the game asks for, empty ones included`, () => {
  const card = reportCard(TWO_FINGER_STATS, `ansi`);
  assert.deepEqual(card.fingers.map((r) => r.finger), reportFingers(DEFAULT_SPACE_THUMB));
  assert.equal(new Set(card.fingers.map((r) => r.finger)).size, card.fingers.length);
  const idle = card.fingers.filter((r) => r.hits === 0);
  assert.ok(idle.length > 0, `an unused finger must still get a row`);
  assert.equal(card.worst[0]?.key, `j`);
  assert.equal(card.worst[0]?.confusedWith, `k`);
});

test(`the card never prints a column for the thumb the player does not use`, () => {
  // A permanently empty column is an artefact of the model, not a diagnosis of
  // the player -- and this table exists to diagnose the player.
  for (const thumb of [`lt`, `rt`] as const) {
    const card = reportCard(TWO_FINGER_STATS, `ansi`, thumb);
    const shown = card.fingers.map((r) => r.finger);
    assert.ok(shown.includes(thumb));
    assert.ok(!shown.includes(thumb === `lt` ? `rt` : `lt`), `both thumbs on the card`);
  }
});

test(`space is credited to the thumb the player actually uses`, () => {
  const stats: Readonly<Record<Key, KeyStat>> = {
    '<space>': { hits: 8, errors: 0, totalMs: 800, latencies: [], confusions: {} }, // tuning-exempt: test fixture
  };
  for (const thumb of [`lt`, `rt`] as const) {
    const row = reportCard(stats, `ansi`, thumb).fingers.find((r) => r.finger === thumb);
    assert.equal(row?.hits, 8); // tuning-exempt: matches the fixture above
  }
});


// --- gilding on the rail ----------------------------------------------------
//
// docs/design/01-illumination.md#gilding-a-mode-for-people-who-already-type.
// The page gilds itself behind the scribe: a greyed character he has typed is
// gold, and one he has not is still dim, because it is still untaught.

const DIM = PALETTE_ORDER.indexOf(`dim`);

/** The colour the ribbon drew a given glyph index in. */
function glyphColour(cmds: readonly DrawCmd[], glyphs: readonly Glyph[], i: number, offset: number): number | null {
  const x = i * CELL_W + offset;
  for (const c of cmds) {
    if (c.op !== `text`) continue;
    if (c.x === x && c.value === glyphs[i]?.ch) return c.color;
  }
  return null;
}

/** The first greyed, non-space glyph in the ribbon. */
const FIRST_GREYED = SPACED.findIndex((g) => !g.live && g.ch !== ` `);

test(`the fixture has a greyed character to gild`, () => {
  assert.ok(FIRST_GREYED >= 0);
  assert.equal(SPACED[FIRST_GREYED]?.producible, true);
});

test(`a greyed character behind the cursor is dim normally and gold when gilded`, () => {
  const cursor = FIRST_GREYED + 1;
  const { offset } = layoutRail(SPACED, cursor, VIRTUAL_W, TUNING);
  const rail = createRail(offset);

  // Off: it was never typed, so drawing it as done would credit a keystroke the
  // player never made.
  const plain = drawFrame(frame(SPACED, cursor), rail, TUNING);
  assert.equal(glyphColour(plain, SPACED, FIRST_GREYED, offset), DIM);

  // On: it was typed. Gold is the only feedback that says the extra work landed.
  const gilded = drawFrame({ ...frame(SPACED, cursor), gilding: true }, rail, TUNING);
  assert.equal(glyphColour(gilded, SPACED, FIRST_GREYED, offset), GOLD);
});

test(`a greyed character ahead of the cursor stays dim even while gilding`, () => {
  // The mode changes what is asked for, not what has been taught -- and showing
  // an untaught letter as lit is the one thing illumination exists to prevent.
  const { offset } = layoutRail(SPACED, 0, VIRTUAL_W, TUNING);
  const cmds = drawFrame({ ...frame(SPACED, 0), gilding: true }, createRail(offset), TUNING);
  const ahead = SPACED.findIndex((g, i) => i > 0 && !g.live && g.ch !== ` `);
  assert.ok(ahead > 0);
  assert.equal(glyphColour(cmds, SPACED, ahead, offset), DIM);
});

test(`the gild total is in the HUD when gilding, and absent when not`, () => {
  const rail = createRail(0);
  const points = 42;   // tuning-exempt: test fixture
  const on = drawFrame({ ...frame(SPACED, 0), gilding: true, gildPoints: points }, rail, TUNING);
  const off = drawFrame(frame(SPACED, 0), rail, TUNING);
  const hud = (cmds: readonly DrawCmd[]): string =>
    cmds.filter((c): c is Extract<DrawCmd, { op: `text` }> => c.op === `text`)
      .map((c) => c.value).find((v) => v.startsWith(`WPM `)) ?? ``;

  assert.ok(hud(on).includes(`GILD ${String(points)}`));
  // A score of zero in a mode with no scoring in it is a number the player
  // cannot move, so it is not drawn at all.
  assert.ok(!hud(off).includes(`GILD`));
});

test(`gilding points the overlay at the character under the cursor, or at nothing`, () => {
  // A gilded character carries no strokes, so nothing lights. Pointing at the
  // next live character instead would name a key that is not being asked for,
  // and pointing at the greyed one would show a beginner where an untaught key
  // lives -- which is the habit illumination exists to remove.
  const cmds = drawFrame({ ...frame(SPACED, FIRST_GREYED), gilding: true }, createRail(0), TUNING);
  assert.equal(highlightedKeyWidth(cmds), 0, `an untaught key was pointed at`);
  const hint = cmds.some((c) => c.op === `text` && c.value.startsWith(`next: `));
  assert.equal(hint, false, `the hint named a key the curriculum has not taught`);

  // Off, the same cursor points past the greyed run at the next live key.
  const plain = drawFrame(frame(SPACED, FIRST_GREYED), createRail(0), TUNING);
  assert.ok(highlightedKeyWidth(plain) > 0);
});
