/**
 * Lectio: the ramp is bounded, gated on sustaining, and deterministic.
 *
 * @doc docs/design/02-rail.md#reading-mode
 *
 * The mode's whole risk is the ramp. Unbounded, it runs the text off the screen
 * and the reading mode becomes unusable at exactly the moment it was working.
 * Ungated, it climbs while nobody is reading, so a player who steps away comes
 * back to 700 wpm. And ungoverned by `dtMs`, it would drift with the frame rate,
 * which is the determinism rule in
 * docs/architecture/core-purity.md#the-injected-seams.
 *
 * The focal guide is checked here too. It is the same rail, so the cursor's
 * screen x must be the same constant in reading mode as in typing mode -- a
 * second mode with its own geometry is how the invariant in
 * docs/design/02-rail.md#the-focal-guide gets quietly lost.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createLectio,
  lectioCursor,
  lectioFinished,
  lectioOffset,
  lectioProgress,
  msToMaxPace,
  paceWpm,
  pauseLectio,
  restartLectio,
  stepLectio,
  type LectioState,
} from './lectio.js';
import { CELL_W, focalX } from './rail.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { Tuning } from './types.js';

function dataUrl(name: string): URL | null {
  for (const rel of ['../../data/', '../data/']) {
    const url = new URL(rel + name, import.meta.url);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

const url = dataUrl('tuning.json');
if (url === null) throw new Error('test: cannot locate data/tuning.json');
const tuning: Tuning = loadTuning(JSON.parse(readFileSync(url, 'utf8')) as unknown);

const START = tuningValue(tuning, 'lectio_start_wpm');
const RAMP = tuningValue(tuning, 'lectio_ramp_wpm');
const MAX = tuningValue(tuning, 'lectio_max_wpm');

const MINUTE_MS = 60000;   // tuning-exempt: a minute, in milliseconds
const FRAME_MS = 16;       // tuning-exempt: test fixture, a frame at 60Hz
const HOUR_FRAMES = 225000; // tuning-exempt: an hour of frames at 60Hz
const VIEWPORT_W = 640;    // tuning-exempt: test fixture, a virtual viewport width
const CHAPTER_CHARS = 4000; // tuning-exempt: test fixture, a chapter's worth of text

/** A run of frames, all sustained unless a predicate says otherwise. */
function run(
  frames: number,
  sustained: (index: number) => boolean = (): boolean => true,
  dtMs: number = FRAME_MS,
): LectioState {
  let state = createLectio(tuning);
  for (let i = 0; i < frames; i += 1) state = stepLectio(state, dtMs, sustained(i), tuning);
  return state;
}

test('reading opens at lectio_start_wpm', () => {
  const state = createLectio(tuning);
  assert.equal(state.wpm, START);
  assert.equal(state.charOffset, 0);
  assert.equal(state.sustainedMs, 0);
  assert.equal(paceWpm(0, tuning), START);
});

test('the pace climbs by lectio_ramp_wpm per sustained minute', () => {
  assert.equal(paceWpm(MINUTE_MS, tuning), START + RAMP);
  assert.equal(paceWpm(MINUTE_MS + MINUTE_MS, tuning), START + RAMP + RAMP);
  const minute = run(Math.round(MINUTE_MS / FRAME_MS));
  assert.equal(minute.sustainedMs, MINUTE_MS);
  assert.equal(minute.wpm, START + RAMP);
});

test('THE RAMP IS BOUNDED BY lectio_max_wpm', () => {
  const hour = run(HOUR_FRAMES);
  assert.equal(hour.wpm, MAX);
  assert.ok(hour.sustainedMs > msToMaxPace(tuning), 'well past the ceiling');
  for (const ms of [0, MINUTE_MS, msToMaxPace(tuning), hour.sustainedMs]) {
    const wpm = paceWpm(ms, tuning);
    assert.ok(wpm >= START && wpm <= MAX, `pace ${String(wpm)} escaped its bounds`);
  }
  assert.equal(paceWpm(msToMaxPace(tuning), tuning), MAX, 'and reaches it exactly');
});

test('THE RAMP ONLY ADVANCES WHILE THE PLAYER SUSTAINS IT', () => {
  const frames = Math.round(MINUTE_MS / FRAME_MS);
  const sustained = run(frames);
  const halfHearted = run(frames + frames, (i) => i % 2 === 0);
  assert.equal(halfHearted.sustainedMs, sustained.sustainedMs, 'half the frames, twice as long');
  assert.equal(halfHearted.wpm, sustained.wpm);

  const abandoned = run(frames + frames, (i) => i < frames);
  assert.equal(abandoned.sustainedMs, MINUTE_MS);
  assert.equal(abandoned.wpm, START + RAMP, 'it held, and it did not climb');
  assert.ok(abandoned.elapsedMs > abandoned.sustainedMs, 'while the clock kept running');
});

test('the ramp holds rather than falling back, and only a restart gives it up', () => {
  const climbed = run(Math.round(MINUTE_MS / FRAME_MS));
  const paused = pauseLectio(climbed, MINUTE_MS);
  assert.equal(paused.wpm, climbed.wpm, 'a reader who looks away loses nothing');
  assert.equal(paused.charOffset, climbed.charOffset, 'and the ribbon stood still');
  assert.equal(paused.elapsedMs, climbed.elapsedMs + MINUTE_MS);

  const fresh = restartLectio(climbed, tuning);
  assert.equal(fresh.wpm, START);
  assert.equal(fresh.sustainedMs, 0);
  assert.equal(fresh.charOffset, climbed.charOffset, 'keeping the reader in their place');
});

test('THE SAME dtMs SEQUENCE ALWAYS PRODUCES THE SAME STATE', () => {
  const trace = [FRAME_MS, FRAME_MS + FRAME_MS, 0, FRAME_MS, MINUTE_MS, FRAME_MS];
  const replay = (): LectioState => {
    let state = createLectio(tuning);
    for (const [index, dt] of trace.entries()) state = stepLectio(state, dt, index % 2 === 0, tuning);
    return state;
  };
  assert.deepEqual(replay(), replay());

  const uneven = run(Math.round(MINUTE_MS / FRAME_MS));
  const smooth = run(Math.round(MINUTE_MS / FRAME_MS));
  assert.deepEqual(uneven, smooth);
  assert.equal(stepLectio(createLectio(tuning), -1, true, tuning).charOffset, 0, 'time never runs backwards');
});

test('the text advances at the pace it is being read at', () => {
  const perChar = tuningValue(tuning, 'wpm_chars_per_word');
  const oneMinute = run(Math.round(MINUTE_MS / FRAME_MS));
  /*
   * A sustained minute is read at somewhere between the opening pace and the
   * pace the ramp had reached by the end of it -- not at either one exactly,
   * because the pace was climbing the whole way. Bounding it is the honest
   * assertion; an equality here would only be asserting the shape of the
   * integration.
   */
  assert.ok(oneMinute.charOffset > START * perChar, 'no slower than the opening pace');
  assert.ok(oneMinute.charOffset < (START + RAMP) * perChar, 'no faster than the pace it reached');
  assert.equal(lectioCursor(createLectio(tuning)), 0);
  assert.ok(lectioCursor(oneMinute) > 0);
});

test('the focal guide does not move, in reading mode either', () => {
  const expected = focalX(VIEWPORT_W, tuning);
  let state = createLectio(tuning);
  for (let i = 0; i < HOUR_FRAMES / CELL_W; i += 1) {
    state = stepLectio(state, FRAME_MS, true, tuning);
    const x = lectioOffset(state, VIEWPORT_W, tuning) + state.charOffset * CELL_W;
    assert.ok(Math.abs(x - expected) < 1, `the focal point drifted to ${String(x)}`);
  }
});

test('progress and the end of the passage', () => {
  const fresh = createLectio(tuning);
  assert.equal(lectioProgress(fresh, CHAPTER_CHARS), 0);
  assert.equal(lectioFinished(fresh, CHAPTER_CHARS), false);
  assert.equal(lectioProgress(fresh, 0), 1, 'an empty passage is already read');

  let state = fresh;
  while (!lectioFinished(state, CHAPTER_CHARS)) state = stepLectio(state, FRAME_MS, true, tuning);
  assert.equal(lectioProgress(state, CHAPTER_CHARS), 1);
  assert.ok(state.wpm > START, 'and the reader picked up pace on the way');
});
