/**
 * The crossing, the flourishes and the reading mode, as drawn.
 *
 * @doc docs/design/05-scenery-warps.md#warps
 *
 * `core/warp.test.ts` asserts that `WarpState.echoX` never changes. That is the
 * arithmetic; this is the picture, and they are not the same claim. A plan whose
 * `echoX` is constant can still be drawn through a rail offset, a cursor or a
 * viewport that is not, and the phrase would slide anyway -- which is precisely
 * the failure the whole mechanic dies of, because "during the phase, the echoed
 * words are the only thing on screen that does not change" is a statement about
 * pixels and nothing else.
 *
 * So the test here runs a real crossing, drives `drawFrame` frame by frame with
 * the two ribbons actually swapping underneath, and asserts that the *drawn*
 * column of every glyph of the phrase is identical every time -- while the world
 * behind it and the text under it both change. If that holds, the effect holds.
 *
 * The same three properties the rail always had are re-asserted against the new
 * paths, because all three are easy to break from here: nothing a set piece
 * draws may reach the rail, nothing may take the strip reserved under it for a
 * first-run note, and the fallback banner stays the last command in the list --
 * docs/decisions/0009-fallbacks-must-announce-themselves.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIRTUAL_W,
  drawFrame,
  sceneLayout,
  type FrameState,
  type SceneState,
  type WarpView,
} from './draw.js';
import { CELL_W, createRail, focalX } from './rail.js';
import { createCloud, createEntity } from './entities.js';
import { createDamage } from './damage.js';
import { SPRITE_SIZE } from './sprites.js';
import { DEFAULT_THEME } from './worlds.js';
import { classify } from './illumination.js';
import { SETPIECE_IDS, setpieceState } from './setpieces.js';
import { beginWarp, planWarp, stepWarp, warpComplete, type WarpState } from './warp.js';
import {
  createLectio, lectioAnchorIndex, lectioWord, readingOffset, splitReadingWords, stepLectio,
} from './lectio.js';
import type { RouteEdge } from './route.js';
import type { DrawCmd, Glyph, Key, Score, Tuning } from './types.js';

/** The rows data/tuning.json carries that any of this path reads. */
const TUNING: Tuning = { rail_cursor_x: 0.5, rail_scroll_lerp: 0.25, focal_guide_width: 40, gate_accuracy: 0.95, mastery_min_samples: 20, overlay_retired_alpha: 0.15, report_trend_parts: 20, report_finger_min_hits: 12, report_reach_ratio: 2.0, report_key_min_attempts: 12, report_worst_key_rate: 0.12, smudge_max: 100, smudge_per_error_base: 12, smudge_per_error_step: 1, smudge_decay_per_key: 3, hearts_start: 3, hearts_max: 5, idle_base_ms: 8000, idle_step_ms: 400, idle_floor_ms: 3000, cloud_approach_ms: 2500, cloud_smudge: 25, monster_burst_ms: 320, strike_reach: 36, stomp_ms: 460, ink_ms: 420, strike_hop_px: 12, strike_contact_px: 7, strike_bounce_ratio: 0.6, strike_nib_arc_px: 14, strike_rise_travel: 0.7, warp_phase_ms: 1400, warp_echo_hold_ms: 900, lectio_start_words_per_min: 180, lectio_ramp_words_per_min: 20, lectio_max_words_per_min: 700, lectio_pace_step: 40, lectio_comma_hold: 1.5, lectio_stop_hold: 2.5, wpm_chars_per_word: 5 }; // tuning-exempt: test fixture mirroring data/tuning.json

const FRAME_MS = 16;  // tuning-exempt: test fixture, a frame at 60Hz
const STAGE = 1;      // tuning-exempt: test fixture

const KEYS: readonly Key[] = ['f', 'j', '<space>', 'a', 's', 'd', 'g', 'h', 'k', 'l', ';'];
const KEY_SET: ReadonlySet<Key> = new Set(KEYS);
const SCORE: Score = { wpm: 0, accuracy: 1, medianLatencyMs: 0 };

const LAYOUT = sceneLayout(DEFAULT_THEME, TUNING);
const RAIL_TOP = LAYOUT.top + LAYOUT.height;

function glyphsOf(text: string): Glyph[] {
  return [...classify(text, KEY_SET, 'ansi', 'rt')];
}

function scene(over: Partial<SceneState> = {}): SceneState {
  return {
    theme: DEFAULT_THEME,
    cameraX: 0,
    walking: false,
    animMs: 0,
    scribe: createEntity('scribe', 'scribe', LAYOUT.scribeX, LAYOUT.groundY - SPRITE_SIZE),
    entities: [],
    cloud: createCloud(),
    damage: createDamage(TUNING),
    heartsMax: TUNING['hearts_max'] ?? 0,
    candles: [{ x: 0, lit: true }],
    strikes: [],
    ...over,
  };
}

function frame(glyphs: readonly Glyph[], cursor: number, over: Partial<FrameState> = {}): FrameState {
  return {
    mode: 'level',
    ref: 'Genesis 1:1  part 1/2',
    stage: STAGE,
    glyphs,
    cursor,
    blocked: false,
    score: SCORE,
    keyStats: {},
    layout: 'ansi',
    keySet: KEYS,
    scene: scene(),
    ...over,
  };
}

function bottomOf(cmd: DrawCmd): number {
  if (cmd.op === 'rect' || cmd.op === 'tile') return cmd.y + cmd.h;
  if (cmd.op === 'sprite') return cmd.y + SPRITE_SIZE;
  return Number.NEGATIVE_INFINITY;
}

// --- the crossing -----------------------------------------------------------

/**
 * Two passages that share a phrase, with the phrase in a *different* place in
 * each -- which is the whole point of the fixture. If both copies sat at the
 * same index the origin and destination ribbon offsets would coincide, and a
 * renderer that had quietly gone back to deriving the column from the rail
 * would pass anyway.
 */
const PHRASE = 'a flask';
const ORIGIN_TEXT = 'all half full and a flask stands full; a lad shall fall';
const DEST_TEXT = 'a flask; and all shall fall as a lad shall fall at half a dash';

/** The one row of the route table this fixture needs. */
const EDGE: RouteEdge = {
  id: 'fixture',
  kind: 'progression',
  from: 'Fixture 1',
  to: 'Fixture 2',
  echo: PHRASE,
  echoKjv: null,
  note: 'a fixture, not a passage',
};

/** Where the player was standing when the doorway opened. Not on the phrase. */
const ORIGIN_CURSOR = 3; // tuning-exempt: test fixture, a cursor away from the echo

function planFixture(): ReturnType<typeof planWarp> {
  return planWarp({
    edge: EDGE,
    translation: 'WEB',
    originText: ORIGIN_TEXT,
    originCursor: ORIGIN_CURSOR,
    destText: DEST_TEXT,
    viewportW: VIRTUAL_W,
    tuning: TUNING,
  });
}

type TextCmd = Extract<DrawCmd, { op: 'text' }>;

/**
 * The pinned phrase, as drawn.
 *
 * Discriminated from the ribbon's own glyphs by carrying an alpha: a rail glyph
 * never does, and the held phrase always does, because its alpha is the one
 * thing about it that is allowed to change.
 */
function heldGlyphXs(cmds: readonly DrawCmd[]): number[] {
  return cmds
    .filter((cmd): cmd is TextCmd => cmd.op === 'text' && cmd.style === 'rail-cursor' && cmd.alpha !== undefined)
    .map((cmd) => cmd.x);
}

/** The frame the platform draws mid-crossing: the two ribbons, and the plan. */
function crossingFrame(
  state: WarpState,
  originGlyphs: readonly Glyph[],
  destGlyphs: readonly Glyph[],
  over: Partial<FrameState> = {},
): { frame: FrameState; offset: number } {
  const holding = state.phase === 'holding';
  const plan = state.plan;
  const offset = holding
    ? plan.echoX - plan.originSpan.first * CELL_W
    : plan.arrivalOffset;
  const view: WarpView = {
    phrase: plan.phrase,
    echoX: state.echoX,
    echoAlpha: state.echoAlpha,
    worldMix: state.worldMix,
    toTheme: 'garden',
    cameraX: 0,
  };
  return {
    frame: frame(
      holding ? originGlyphs : destGlyphs,
      holding ? plan.originSpan.first : plan.destSpan.first,
      { warp: view, ...over },
    ),
    offset,
  };
}

test('THE HELD PHRASE OCCUPIES THE IDENTICAL SCREEN COLUMN ON EVERY FRAME OF A CROSSING', () => {
  const plan = planFixture();
  const originGlyphs = glyphsOf(ORIGIN_TEXT);
  const destGlyphs = glyphsOf(DEST_TEXT);

  // The two ribbons really do put the phrase in different places, so the two
  // offsets really are different numbers.
  assert.notEqual(plan.originSpan.first, plan.destSpan.first);
  const originOffset = plan.echoX - plan.originSpan.first * CELL_W;
  assert.notEqual(originOffset, plan.arrivalOffset, 'the fixture does not exercise the swap');

  let state: WarpState = beginWarp(plan, TUNING);
  let columns: number[] | null = null;
  const mixes: number[] = [];
  const ribbons = new Set<number>();
  let frames = 0;
  let swapped = false;

  while (!warpComplete(state)) {
    const drawn = crossingFrame(state, originGlyphs, destGlyphs);
    const cmds = drawFrame(drawn.frame, { offset: drawn.offset, targetOffset: drawn.offset }, TUNING);
    const held = heldGlyphXs(cmds);
    assert.ok(held.length > 0, 'the phrase was not drawn at all');
    assert.equal(held[0], plan.echoX, 'the first glyph left the planned column');
    if (columns === null) columns = held;
    else assert.deepEqual(held, columns, 'the held phrase moved');
    if (state.phase === 'releasing') swapped = true;
    mixes.push(state.worldMix);
    ribbons.add(drawn.offset);
    frames += 1;
    state = stepWarp(state, FRAME_MS, TUNING);
  }

  assert.ok(frames > 1, 'the crossing lasted more than one frame');
  assert.ok(swapped, 'the ribbon never swapped, so nothing was actually held across a cut');
  assert.equal(ribbons.size, 2, 'the ribbon underneath did not change');
  assert.equal(mixes[0], 0, 'the world starts at the origin');
  assert.ok((mixes[mixes.length - 1] ?? 0) > 0, 'the world never moved');

  // And the columns are whole cells apart from the first, which is what makes
  // the phrase read as text on the rail rather than as a caption over it.
  const first = columns?.[0] ?? 0;
  (columns ?? []).forEach((x, i) => {
    assert.equal((x - first) % CELL_W, 0, `glyph ${String(i)} is off the cell grid`);
  });
});

test('a crossing asks for nothing: no caret, no next key, nothing owed', () => {
  const plan = planFixture();
  const state = beginWarp(plan, TUNING);
  const drawn = crossingFrame(state, glyphsOf(ORIGIN_TEXT), glyphsOf(DEST_TEXT));
  const cmds = drawFrame(drawn.frame, { offset: drawn.offset, targetOffset: drawn.offset }, TUNING);

  // The caret is the one vertical line in an ordinary frame. Mid-crossing there
  // is none, because there is nothing to type -- and gold therefore says exactly
  // one thing on screen: the phrase.
  assert.equal(cmds.some((cmd) => cmd.op === 'line' && cmd.x1 === cmd.x2), false);
  assert.equal(
    cmds.some((cmd) => cmd.op === 'text' && cmd.value.startsWith('next:')),
    false,
    'the overlay named a key on a ribbon that is already leaving',
  );

  // The focal guide stays: it is the anchor, and it is what the phrase is held
  // against. Two horizontal rules, exactly as in any other frame.
  const rules = cmds.filter((cmd) => cmd.op === 'line' && cmd.y1 === cmd.y2);
  assert.equal(rules.length, 2);
});

test('nothing a crossing draws takes the strip reserved under the rail', () => {
  const plan = planFixture();
  const note = 'The bar means a space. Either thumb.';
  let state: WarpState = beginWarp(plan, TUNING);
  const originGlyphs = glyphsOf(ORIGIN_TEXT);
  const destGlyphs = glyphsOf(DEST_TEXT);

  while (!warpComplete(state)) {
    const drawn = crossingFrame(state, originGlyphs, destGlyphs, { note });
    const cmds = drawFrame(drawn.frame, { offset: drawn.offset, targetOffset: drawn.offset }, TUNING);
    const strip = cmds.find((cmd) => cmd.op === 'text' && cmd.value === note);
    assert.ok(strip !== undefined && strip.op === 'text', 'the note was covered by the crossing');
    for (const x of heldGlyphXs(cmds)) assert.ok(Number.isFinite(x));
    // Every themed command -- the arriving world included -- stays in the band.
    for (const cmd of cmds) {
      if (!('theme' in cmd) || cmd.theme === undefined) continue;
      assert.ok(bottomOf(cmd) <= RAIL_TOP, `a ${cmd.op} reached past the rail`);
    }
    state = stepWarp(state, FRAME_MS, TUNING);
  }
});

// --- set pieces -------------------------------------------------------------

const PROGRESS_STEPS = 9;   // tuning-exempt: test fixture, a sweep of the passage
const CLOCK_STEPS = 13;     // tuning-exempt: test fixture, a sweep of the art clock
const CLOCK_STEP_MS = 340;  // tuning-exempt: test fixture, off every art period

/**
 * What a set piece added to a frame, and nothing else.
 *
 * A multiset difference against the same frame drawn without one, so the
 * assertions below are about the flourish's own rects rather than about the
 * hearts in the HUD or the parallax it was drawn over.
 */
function addedBy(withPiece: readonly DrawCmd[], without: readonly DrawCmd[]): DrawCmd[] {
  const pool = new Map<string, number>();
  for (const cmd of without) {
    const key = JSON.stringify(cmd);
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  const out: DrawCmd[] = [];
  for (const cmd of withPiece) {
    const key = JSON.stringify(cmd);
    const left = pool.get(key) ?? 0;
    if (left > 0) pool.set(key, left - 1);
    else out.push(cmd);
  }
  return out;
}

test('EVERY SET PIECE STAYS INSIDE THE SCENERY BAND, AT EVERY POINT OF EVERY PASSAGE', () => {
  const glyphs = glyphsOf(ORIGIN_TEXT);
  let drew = 0;
  for (const id of SETPIECE_IDS) {
    for (let p = 0; p <= PROGRESS_STEPS; p += 1) {
      for (let t = 0; t < CLOCK_STEPS; t += 1) {
        const animMs = t * CLOCK_STEP_MS;
        const piece = setpieceState(id, { elapsedMs: animMs, progress: p / PROGRESS_STEPS });
        const cmds = drawFrame(
          frame(glyphs, 0, { scene: scene({ setpiece: piece, animMs }) }),
          createRail(0),
          TUNING,
        );
        const plain = drawFrame(
          frame(glyphs, 0, { scene: scene({ animMs }) }),
          createRail(0),
          TUNING,
        );
        for (const cmd of addedBy(cmds, plain)) {
          drew += 1;
          assert.ok(
            bottomOf(cmd) <= RAIL_TOP,
            `${id}: a ${cmd.op} reached ${String(bottomOf(cmd))}, past the rail at ${String(RAIL_TOP)}`,
          );
          assert.ok(
            cmd.op === 'rect' && cmd.y >= LAYOUT.top,
            `${id}: a ${cmd.op} at ${JSON.stringify(cmd)} left the scenery band`,
          );
          // A flourish speaks the art palette, never the interface one: a HUD
          // that had an opinion about the weather is the merge the two palettes
          // exist to prevent.
          assert.ok('theme' in cmd && cmd.theme !== undefined, `${id}: an untinted command`);
        }
      }
    }
  }
  assert.ok(drew > 0, 'no set piece drew anything at all');
});

test('a set piece does not move the focal x, and a passage with none draws nothing extra', () => {
  const glyphs = glyphsOf(ORIGIN_TEXT);
  const target = focalX(VIRTUAL_W, TUNING);
  const plain = drawFrame(frame(glyphs, 0), createRail(0), TUNING);

  for (const id of SETPIECE_IDS) {
    const piece = setpieceState(id, { elapsedMs: CLOCK_STEP_MS, progress: 0.5 }); // tuning-exempt: test fixture, mid-passage
    const cmds = drawFrame(
      frame(glyphs, 0, { scene: scene({ setpiece: piece }) }),
      createRail(0),
      TUNING,
    );
    const caret = cmds.find((cmd) => cmd.op === 'line' && cmd.x1 === cmd.x2);
    assert.ok(caret !== undefined && caret.op === 'line');
    assert.equal(caret.x1, target, `${id} moved the caret`);
    assert.ok(cmds.length > plain.length, `${id} drew nothing at all`);
  }

  // A passage with no set piece is byte-identical to one drawn before set pieces
  // existed, which is what "most passages have none" has to mean.
  const none = drawFrame(frame(glyphs, 0, { scene: scene() }), createRail(0), TUNING);
  assert.deepEqual(none, plain);
});

test('THE FALLBACK BANNER IS STILL THE LAST COMMAND, BEHIND A CROSSING AND A SET PIECE', () => {
  const plan = planFixture();
  const state = beginWarp(plan, TUNING);
  const piece = setpieceState('darkness_at_noon', { elapsedMs: 0, progress: 1 });
  const drawn = crossingFrame(state, glyphsOf(ORIGIN_TEXT), glyphsOf(DEST_TEXT), {
    scene: scene({ setpiece: piece }),
    note: 'The bar means a space. Either thumb.',
    notice: ['NOT THE REAL DATA', 'these are built-in substitutes'],
  });
  const cmds = drawFrame(drawn.frame, { offset: drawn.offset, targetOffset: drawn.offset }, TUNING);
  const last = cmds[cmds.length - 1];
  assert.ok(last !== undefined && last.op === 'text');
  assert.equal(last.value, 'these are built-in substitutes');
});

// --- reading ----------------------------------------------------------------

test('READING MODE DRAWS ONE WORD, ANCHORED, AND ASKS FOR NO KEYS', () => {
  const glyphs = glyphsOf(`${ORIGIN_TEXT} ${DEST_TEXT}`);
  const words = splitReadingWords(glyphs, [], TUNING);
  const target = focalX(VIRTUAL_W, TUNING);
  let state = createLectio(TUNING);
  const guides = new Set<string>();
  const anchors = new Set<number>();
  let shown = 0;

  for (let i = 0; i < CLOCK_STEPS * CLOCK_STEPS; i += 1) {
    const word = lectioWord(state, words);
    if (word === null) break;
    const offset = readingOffset(word, VIRTUAL_W, TUNING);
    const cmds = drawFrame(
      frame(glyphs, lectioAnchorIndex(word), {
        mode: 'lectio',
        readingWord: word,
        score: { wpm: state.wpm, accuracy: 1, medianLatencyMs: 0 },
      }),
      { offset, targetOffset: offset },
      TUNING,
    );

    // One word, and only one. Every rail glyph on the frame belongs to it, and
    // the gold one -- the anchor -- is on the focal column on every frame.
    const rail = cmds.filter((cmd) => cmd.op === 'text' && cmd.style.startsWith('rail-'));
    assert.ok(rail.length > 0, 'reading drew nothing');
    assert.ok(rail.length <= word.end - word.start, 'more glyphs than the word has');
    shown += 1;
    for (const cmd of cmds) {
      if (cmd.op !== 'text' || cmd.style !== 'rail-cursor') continue;
      anchors.add(cmd.x);
    }

    // No caret: nothing is being asked for, so nothing marks a keystroke. What
    // marks the column is the guide, and it is where it always is.
    assert.equal(cmds.some((cmd) => cmd.op === 'line' && cmd.x1 === cmd.x2), false);
    for (const cmd of cmds) {
      if (cmd.op === 'line' && cmd.y1 === cmd.y2) guides.add(`${String(cmd.x1)}:${String(cmd.y1)}`);
    }
    // No board and no key hint: reading asks for nothing, so it points at
    // nothing. An overlay lit for a key nobody is being asked for is the
    // overlay lying.
    assert.equal(cmds.some((cmd) => cmd.op === 'text' && cmd.style === 'key'), false);
    assert.equal(
      cmds.some((cmd) => cmd.op === 'text' && cmd.value.startsWith('next:')),
      false,
    );
    state = stepLectio(state, FRAME_MS, words, true, TUNING);
  }

  // Two rules, at two heights, on one column, for the whole sitting.
  assert.equal(guides.size, 2);
  // And the words really did change under them, or none of the above is a claim.
  assert.ok(state.index > 0, 'the sitting never advanced');
  assert.ok(shown > state.index, 'the fixture barely drew anything');
  assert.deepEqual([...anchors], [target], 'the anchor column moved');
});

test('reading mode names the way out where the next key would have been', () => {
  const glyphs = glyphsOf(ORIGIN_TEXT);
  const cmds = drawFrame(
    frame(glyphs, 0, { mode: 'lectio' }),
    createRail(0),
    TUNING,
  );
  const hint = cmds.find((cmd) => cmd.op === 'text' && cmd.style === 'hint-center');
  assert.ok(hint !== undefined && hint.op === 'text');
  assert.match(hint.value, /esc/);
});
