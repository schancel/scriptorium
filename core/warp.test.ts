/**
 * Warps: the echo is verified against the text, and it is what does not move.
 *
 * @doc docs/design/05-scenery-warps.md#warps
 *
 * Two claims, both easy to break and neither visible when broken.
 *
 * **The phrase occurs in both passages, in both translations.** "A translation
 * switch can silently break an echo", and the `only-son` edge is the case that
 * forced an `echo_kjv` column: WEB and KJV disagree about exactly the possessive
 * pronoun the echo is made of. So every edge is looked up in the real
 * `data/texts/`, under WEB and KJV, with the override honoured.
 *
 * **The phrase is the only thing that does not change.** The world mixes from
 * the origin's scenery to the destination's while the echo stays lit on the
 * screen column it already occupied -- so the test steps a whole crossing frame
 * by frame and asserts the column is the same number every frame while the mix
 * runs 0 to 1.
 *
 * And the flashback contract from the same doc: entering and leaving restores
 * the exact verse, cursor, hearts, smudge and combo, and skipping costs nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  beginWarp,
  echoFor,
  enterFlashback,
  heldSpan,
  insideFlashback,
  leaveFlashback,
  locateEcho,
  planWarp,
  skipFlashback,
  stepWarp,
  warpComplete,
  type FlashbackFrame,
  type WarpState,
} from './warp.js';
import { edgeById, loadRoute } from './route.js';
import { bookFileName, loadBook, parseReference, sectionFor } from './corpus.js';
import { CELL_W, focalX } from './rail.js';
import { applyError, createDamage } from './damage.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { ReturnFrame, Tuning } from './types.js';

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

const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));
const route = loadRoute(loadDataFile('routes/pilgrimage.json'));

/** Both shipped translations, and how `Progress.translation` names them. */
const EDITIONS: readonly (readonly [string, string])[] = [
  ['web', 'WEB'],
  ['kjv', 'KJV'],
];

/** The ribbon for a chapter: its units in order, as one run of text. */
function ribbon(edition: string, ref: string): string | null {
  const parsed = parseReference(ref);
  const url = dataUrl(`texts/${edition}/${bookFileName(parsed.book)}`);
  if (url === null) return null;
  const book = loadBook(JSON.parse(readFileSync(url, 'utf8')) as unknown);
  const section = sectionFor(book, parsed.chapter);
  return section === null ? null : section.units.join(' ');
}

const VIEWPORT_W = 640;   // tuning-exempt: test fixture, a virtual viewport width
const FRAME_MS = 16;      // tuning-exempt: test fixture, a frame at 60Hz
const CURSOR = 4;         // tuning-exempt: test fixture, an arbitrary cursor index
const UNIT = 7;           // tuning-exempt: test fixture, an arbitrary verse
const STAGE = 3;          // tuning-exempt: test fixture, an arbitrary stage

test('THE ECHO OCCURS IN BOTH PASSAGES, IN BOTH TRANSLATIONS', () => {
  let checked = 0;
  for (const edge of route.edges) {
    for (const [edition, translation] of EDITIONS) {
      const phrase = echoFor(edge, translation);
      for (const ref of [edge.from, edge.to]) {
        const text = ribbon(edition, ref);
        if (text === null) continue;
        checked += 1;
        assert.ok(
          locateEcho(text, phrase) >= 0,
          `edge ${edge.id}: echo "${phrase}" is absent from ${edition} ${ref}`,
        );
      }
    }
  }
  assert.equal(checked, route.edges.length * EDITIONS.length * 2, 'every side of every edge');
});

test('echo_kjv overrides echo, and only where the table says so', () => {
  const onlySon = edgeById(route, 'only-son');
  assert.ok(onlySon !== null);
  assert.equal(echoFor(onlySon, 'WEB'), 'your son');
  assert.equal(echoFor(onlySon, 'KJV'), 'thy son');
  assert.equal(echoFor(onlySon, 'kjv'), 'thy son', 'the translation name is not case-sensitive');

  for (const edge of route.edges) {
    if (edge.echoKjv !== null) continue;
    assert.equal(echoFor(edge, 'KJV'), edge.echo, `${edge.id} has no override`);
  }
});

test('the overridden phrase is the one that is actually in the KJV text', () => {
  const onlySon = edgeById(route, 'only-son');
  assert.ok(onlySon !== null);
  for (const ref of [onlySon.from, onlySon.to]) {
    const kjv = ribbon('kjv', ref);
    const web = ribbon('web', ref);
    if (kjv === null || web === null) continue;
    assert.ok(locateEcho(kjv, 'thy son') >= 0, `KJV ${ref}`);
    assert.ok(locateEcho(web, 'your son') >= 0, `WEB ${ref}`);
  }
});

function planFor(edgeId: string, translation: string, edition: string) {
  const edge = edgeById(route, edgeId);
  assert.ok(edge !== null);
  const originText = ribbon(edition, edge.from);
  const destText = ribbon(edition, edge.to);
  assert.ok(originText !== null && destText !== null);
  return planWarp({
    edge,
    translation,
    originText,
    originCursor: CURSOR,
    destText,
    viewportW: VIEWPORT_W,
    tuning,
  });
}

test('THE ECHOED WORDS ARE THE ONE THING THAT DOES NOT CHANGE', () => {
  const plan = planFor('beginning', 'WEB', 'web');
  let state: WarpState = beginWarp(plan, tuning);
  const columns: number[] = [state.echoX];
  const mixes: number[] = [state.worldMix];
  let litWhileTheWorldChanged = false;

  while (!warpComplete(state)) {
    state = stepWarp(state, FRAME_MS, tuning);
    columns.push(state.echoX);
    mixes.push(state.worldMix);
    if (state.worldMix > 0 && state.worldMix < 1 && state.echoAlpha === 1) {
      litWhileTheWorldChanged = true;
    }
  }

  assert.ok(columns.length > 1, 'the crossing lasted more than one frame');
  for (const x of columns) assert.equal(x, plan.echoX, 'the held phrase moved');
  assert.equal(mixes[0], 0, 'the world starts at the origin');
  assert.equal(mixes[mixes.length - 1], 1, 'and arrives at the destination');
  for (let i = 1; i < mixes.length; i += 1) {
    assert.ok((mixes[i] ?? 0) >= (mixes[i - 1] ?? 0), 'the world mix went backwards');
  }
  assert.ok(litWhileTheWorldChanged, 'the phrase was never lit mid-crossing');
});

test('the phrase is held for warp_echo_hold_ms, then released by warp_phase_ms', () => {
  const plan = planFor('beginning', 'WEB', 'web');
  const hold = tuningValue(tuning, 'warp_echo_hold_ms');
  const total = tuningValue(tuning, 'warp_phase_ms');

  let state = beginWarp(plan, tuning);
  assert.equal(state.echoAlpha, 1);
  assert.equal(state.phase, 'holding');

  state = stepWarp(beginWarp(plan, tuning), hold, tuning);
  assert.equal(state.echoAlpha, 1, 'fully lit for the whole hold');
  assert.equal(state.phase, 'holding');

  state = stepWarp(state, FRAME_MS, tuning);
  assert.ok(state.echoAlpha < 1 && state.echoAlpha > 0, 'then it releases');
  assert.equal(state.phase, 'releasing');

  state = stepWarp(beginWarp(plan, tuning), total, tuning);
  assert.equal(state.echoAlpha, 0);
  assert.equal(state.worldMix, 1);
  assert.equal(warpComplete(state), true);
});

test('the destination is placed so its copy of the phrase lands on the same column', () => {
  for (const [edition, translation] of EDITIONS) {
    for (const edge of route.edges) {
      if (ribbon(edition, edge.from) === null) continue;
      const plan = planFor(edge.id, translation, edition);
      assert.equal(
        plan.arrivalOffset + plan.destSpan.first * CELL_W,
        plan.echoX,
        `${edge.id} in ${edition}: the phrase would jump on arrival`,
      );
      const span = echoFor(edge, translation).length;
      assert.equal(plan.originSpan.last - plan.originSpan.first + 1, span);
      assert.equal(plan.destSpan.last - plan.destSpan.first + 1, span);
    }
  }
});

test('a warp entered on the phrase holds it on the focal guide itself', () => {
  const edge = edgeById(route, 'beginning');
  assert.ok(edge !== null);
  const originText = ribbon('web', edge.from);
  const destText = ribbon('web', edge.to);
  assert.ok(originText !== null && destText !== null);
  const at = locateEcho(originText, edge.echo);
  const plan = planWarp({
    edge,
    translation: 'WEB',
    originText,
    originCursor: at,
    destText,
    viewportW: VIEWPORT_W,
    tuning,
  });
  assert.equal(plan.echoX, focalX(VIEWPORT_W, tuning));
  assert.equal(heldSpan(beginWarp(plan, tuning)).first, plan.originSpan.first);
  assert.equal(heldSpan(stepWarp(beginWarp(plan, tuning), tuningValue(tuning, 'warp_phase_ms'), tuning)).first, plan.destSpan.first);
});

test('a phrase absent from either side is a loud failure, not a warp holding nothing', () => {
  const edge = edgeById(route, 'beginning');
  assert.ok(edge !== null);
  assert.throws(
    () => planWarp({ edge, translation: 'WEB', originText: 'nothing like it', originCursor: 0, destText: 'nor here', viewportW: VIEWPORT_W, tuning }),
    /absent from Genesis 1/,
  );
  assert.throws(
    () => planWarp({ edge, translation: 'WEB', originText: edge.echo, originCursor: 0, destText: 'nor here', viewportW: VIEWPORT_W, tuning }),
    /absent from John 1/,
  );
});

// --- flashbacks -------------------------------------------------------------

function frameAt(): FlashbackFrame {
  return { ref: 'John 19', unit: UNIT, cursor: CURSOR, damage: createDamage(tuning) };
}

test('A FLASHBACK ROUND TRIP RESTORES VERSE, CURSOR, HEARTS, SMUDGE AND COMBO', () => {
  const edge = edgeById(route, 'only-son');
  assert.ok(edge !== null);
  const before = frameAt();
  const entered = enterFlashback(edge, before, []);
  assert.equal(entered.destination, 'Genesis 22');
  assert.equal(insideFlashback(entered.stack), true);

  // A rough time of it inside the secret room: errors, a broken combo, a heart.
  let inside = before.damage;
  for (let i = 0; i < CELL_W; i += 1) inside = applyError(inside, STAGE, tuning).damage;
  assert.notDeepEqual(inside, before.damage, 'the flashback did cost something in the room');

  const left = leaveFlashback(entered.stack);
  assert.deepEqual(left.frame, before, 'the frame came back untouched');
  assert.equal(left.frame.ref, 'John 19');
  assert.equal(left.frame.unit, UNIT);
  assert.equal(left.frame.cursor, CURSOR);
  assert.equal(left.frame.damage.hearts, before.damage.hearts);
  assert.equal(left.frame.damage.smudge, before.damage.smudge);
  assert.equal(left.frame.damage.combo, before.damage.combo);
  assert.equal(insideFlashback(left.stack), false);
});

test('SKIPPING A FLASHBACK COSTS NOTHING AT ALL', () => {
  const before = frameAt();
  const stack: readonly FlashbackFrame[] = [];
  const after = skipFlashback(stack);
  assert.equal(after, stack, 'the same stack, not a copy of it');
  assert.equal(insideFlashback(after), false);
  assert.deepEqual(frameAt(), before, 'and the verse the player stands on is untouched');
});

test('doorways nest, and unwind in the order they were entered', () => {
  const serpent = edgeById(route, 'serpent');
  const threeDays = edgeById(route, 'three-days');
  assert.ok(serpent !== null && threeDays !== null);
  const outer: FlashbackFrame = { ref: 'John 3', unit: UNIT, cursor: CURSOR, damage: createDamage(tuning) };
  const inner: FlashbackFrame = { ref: 'Matthew 12', unit: 1, cursor: 0, damage: createDamage(tuning) };

  const first = enterFlashback(serpent, outer, []);
  const second = enterFlashback(threeDays, inner, first.stack);
  assert.equal(second.stack.length, 2);

  const back = leaveFlashback(second.stack);
  assert.deepEqual(back.frame, inner);
  const home = leaveFlashback(back.stack);
  assert.deepEqual(home.frame, outer);
  assert.equal(insideFlashback(home.stack), false);
});

test('a progression edge is not a doorway, and no doorway can be left twice', () => {
  const beginning = edgeById(route, 'beginning');
  assert.ok(beginning !== null);
  assert.throws(() => enterFlashback(beginning, frameAt(), []), /not a doorway/);
  assert.throws(() => leaveFlashback([]), /no flashback to leave/);
});

test('the frame IS the shared ReturnFrame, verse included, and not a second copy of it', () => {
  const frame = frameAt();
  // Assignable both ways, at compile time: `FlashbackFrame` is `ReturnFrame`.
  // Two interfaces for one thing is how the two drift, and the field the shared
  // one was missing is the verse -- a chapter reference plus a glyph cursor
  // cannot say which verse the player was on, because the cursor indexes one
  // chunk's ribbon rather than the chapter.
  const shared: ReturnFrame = frame;
  const back: FlashbackFrame = shared;
  assert.deepEqual(back, frame);
  assert.equal('unit' in shared, true, 'the shared frame carries the verse');
  assert.equal(shared.unit, UNIT);
  assert.equal(back.unit, UNIT);
});
