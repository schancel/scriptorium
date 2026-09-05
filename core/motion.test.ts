/**
 * @doc docs/design/12-motion-and-comfort.md#what-reduced-motion-changes
 *
 * Two properties are worth more than the rest of this file put together:
 *
 *  - **`auto` follows the operating system, and nothing else does.** That is the
 *    whole accessibility claim of ADR 0011 -- a player who has already told his
 *    machine gets the reduced presentation without ever finding a menu -- and it
 *    is one function, so it is checked rather than trusted.
 *  - **A held stretch costs travel and never gives it back at once.** The camera
 *    reads `travelledWords`, and if it were not monotone the world would lurch
 *    forward by a whole conversation on the frame a hold ended.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOTION_SETTINGS,
  animScale,
  cameraLerp,
  deferredWords,
  isHeldWord,
  isMotionSetting,
  parallaxScale,
  reducedMotion,
  travelledTotal,
  travelledWords,
} from './motion.js';
import { loadTuning } from './tuning.js';
import type { Tuning } from './types.js';

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

const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));

// --- which presentation -------------------------------------------------------

test('THE DEFAULT SETTING IS THE ONE THE OPERATING SYSTEM WAS ALREADY TOLD', () => {
  // The whole of docs/decisions/0011-respect-reduced-motion.md in two lines: a
  // player who has turned the system setting on gets the reduced presentation
  // without ever opening a menu, and a player who has not is unaffected.
  assert.equal(reducedMotion('auto', true), true);
  assert.equal(reducedMotion('auto', false), false);
});

test('and either choice overrides the system, in both directions', () => {
  // Not only "reduced regardless": somebody may want the full presentation on a
  // machine whose system setting is on for everything else, and a switch that
  // could only be turned one way would not be a switch.
  assert.equal(reducedMotion('reduced', false), true);
  assert.equal(reducedMotion('reduced', true), true);
  assert.equal(reducedMotion('full', true), false);
  assert.equal(reducedMotion('full', false), false);
});

test('every setting is readable back, and nothing else is', () => {
  for (const setting of MOTION_SETTINGS) assert.ok(isMotionSetting(setting));
  for (const junk of ['', 'on', 'off', 'AUTO', 'reduce']) {
    assert.equal(isMotionSetting(junk), false, `"${junk}" is not a setting`);
  }
});

// --- how much of the motion survives -----------------------------------------

test('THE FULL PRESENTATION IS EXACTLY WHAT IT ALWAYS WAS', () => {
  // Every scale is 1 when the motion is not reduced, so an unreduced frame is
  // arithmetically the frame the game drew before any of this existed. If this
  // ever fails, the accessibility work has quietly changed the game for
  // everybody, which is the outcome ADR 0011 explicitly rejected.
  assert.equal(parallaxScale(tuning, false), 1);
  assert.equal(animScale(tuning, false), 1);
  const full = 0.18; // tuning-exempt: the platform's own camera easing, as a fixture
  assert.equal(cameraLerp(tuning, false, full), full);
});

test('reduced freezes the parallax and eases the rest down rather than stopping it', () => {
  // "Parallax is frozen or near-frozen. Layers at differing rates are the
  // strongest part of the stimulus and the least load-bearing part of the
  // design." Set pieces are brief and are what the passage looks like, so they
  // are slowed and not stopped -- a flame that has stopped flickering is not a
  // flame.
  assert.equal(parallaxScale(tuning, true), 0);
  const anim = animScale(tuning, true);
  assert.ok(anim > 0, 'a reduced set piece still runs');
  assert.ok(anim < 1, 'and runs slower than an unreduced one');
});

test('the reduced camera steps without teleporting, so the scribe still walks', () => {
  const full = 0.18; // tuning-exempt: the platform's own camera easing, as a fixture
  const reduced = cameraLerp(tuning, true, full);
  assert.ok(reduced > full, 'a step has to be quicker than the slide it replaces');
  assert.ok(reduced < 1, 'at 1 the world teleports and nobody is ever seen walking');
});

// --- held scenes --------------------------------------------------------------

/** Six words, the middle two of them standing in a held scene. */
const HELD: readonly boolean[] = [false, false, true, true, false, false];

test('a word in a held scene is worth no travel, and every other word is worth one', () => {
  assert.equal(travelledWords(HELD, 0), 0);
  assert.equal(travelledWords(HELD, 2), 2, 'two words travelled before the hold');
  assert.equal(travelledWords(HELD, 3), 2, 'and the hold adds nothing'); // tuning-exempt: word indices in the fixture
  assert.equal(travelledWords(HELD, 4), 2); // tuning-exempt: word indices in the fixture
  assert.equal(travelledWords(HELD, 5), 3, 'the world moves again on the way out'); // tuning-exempt: word indices
  assert.equal(travelledTotal(HELD), 4, 'four of the six words are a walk'); // tuning-exempt: word indices
});

test('A HELD STRETCH DOES NOT MOVE THE WORLD, AND DOES NOT GIVE IT BACK AT THE END', () => {
  // The property the camera depends on. Typing through the whole hold leaves the
  // travelled distance exactly where it was when the hold began -- so the world
  // is still while the conversation runs -- and the first word out of it is
  // worth one stride and not five.
  const before = travelledWords(HELD, 2);
  const steps = 8; // tuning-exempt: samples across the held stretch
  for (let i = 0; i <= steps; i += 1) {
    const at = 2 + (i / steps) * 2; // tuning-exempt: from word 2 to word 4, the held pair
    assert.equal(travelledWords(HELD, at), before, `the world moved at ${String(at)}`);
  }
  assert.equal(travelledWords(HELD, 4 + 1), before + 1, 'one stride at a time'); // tuning-exempt: word indices
});

test('travel never runs backwards as the cursor runs forwards', () => {
  // Monotone, or the world would slide the wrong way at a scene edge -- which is
  // the one direction the parallax never moves and the only thing on screen that
  // would look like a mistake rather than a place.
  let last = 0;
  const steps = 60; // tuning-exempt: samples across the whole fixture
  for (let i = 0; i <= steps; i += 1) {
    const at = (i / steps) * HELD.length;
    const now = travelledWords(HELD, at);
    assert.ok(now >= last, `travel went backwards at ${String(at)}`);
    last = now;
  }
});

test('the fraction of a held word does not creep forward and snap back', () => {
  // Inside a travelling word the world moves smoothly with the keystrokes; inside
  // a held one it must not move at all, or the picture would drift a stride and
  // jump back on the space bar.
  assert.equal(travelledWords(HELD, 2), travelledWords(HELD, 2.5)); // tuning-exempt: mid-word
  assert.equal(travelledWords(HELD, 2), travelledWords(HELD, 2.9)); // tuning-exempt: late in a word
  assert.notEqual(travelledWords(HELD, 0), travelledWords(HELD, 0.5)); // tuning-exempt: mid-word
});

test('a passage with nothing held is the walk it always was', () => {
  const walking: readonly boolean[] = [false, false, false, false];
  assert.equal(travelledWords(walking, 3), 3); // tuning-exempt: word indices in the fixture
  assert.equal(travelledWords(walking, 2.5), 2.5); // tuning-exempt: mid-word
  assert.equal(travelledTotal(walking), walking.length);
});

test('a passage held from end to end never travels at all', () => {
  const standing: readonly boolean[] = [true, true, true];
  assert.equal(travelledTotal(standing), 0);
  for (const at of [0, 1, 2, 2.5]) { // tuning-exempt: samples across the fixture
    assert.equal(travelledWords(standing, at), 0);
  }
});

test('a word off the end of the map is not held, and cannot be', () => {
  // The cursor sits one past the final glyph at the end of a chapter, so the
  // question is asked about a word that does not exist. It has to answer, and it
  // has to answer "travelling" -- a passage that ended held would leave the
  // camera short of its own last checkpoint.
  assert.equal(isHeldWord(HELD, HELD.length), false);
  assert.equal(isHeldWord(HELD, -1), false);
  assert.equal(isHeldWord(HELD, 2), true);
  assert.equal(travelledWords(HELD, HELD.length + 2), travelledTotal(HELD));
});


// --- a blow landing ----------------------------------------------------------
//
// docs/design/03-pacing.md#the-camera-must-not-eat-the-leap. The scribe leaps
// from a fixed screen column toward a monster whose column the camera decides,
// so a camera still closing on it takes the gap out from under the leap. The
// answer is the same arithmetic held scenes use, which is why it is here.

test('nothing deferred is the target it always was', () => {
  for (const at of [0, 1, HELD.length]) {
    assert.equal(deferredWords(travelledWords(HELD, at), null), travelledWords(HELD, at));
  }
});

test('A DEFERRED CAMERA CAN HOLD STILL AND HAS NO WAY TO ADVANCE', () => {
  // The load-bearing property, stated as an inequality: whatever the deferral
  // is, the answer is never larger than the word-driven target. So the world
  // cannot be moved by anything except the player typing -- ADR 0004 applied to
  // the camera as well as to the monsters.
  const walking = HELD.map(() => false);
  for (let held = 0; held <= walking.length; held += 1) {
    for (let at = 0; at <= walking.length; at += 1) {
      const travelled = travelledWords(walking, at);
      const deferred = deferredWords(travelled, held);
      assert.ok(deferred <= travelled, `${String(deferred)} > ${String(travelled)}`);
      assert.ok(deferred <= held, 'and never past where the blow began');
    }
  }
});

test('and typing on during a blow moves nothing, then moves exactly what was typed', () => {
  const walking = HELD.map(() => false);
  const began = travelledWords(walking, 2); // tuning-exempt: a word index in the fixture
  // Three more words while the hop is in the air, and the camera does not stir.
  for (const at of [2, 3, 4, 5]) { // tuning-exempt: word indices in the fixture
    assert.equal(deferredWords(travelledWords(walking, at), began), began);
  }
  // The blow ends; the target is the travel he typed, and not a pixel more.
  assert.equal(
    deferredWords(travelledWords(walking, 5), null), // tuning-exempt: a word index
    travelledWords(walking, 5), // tuning-exempt: a word index in the fixture
  );
});
