/**
 * @doc docs/design/08-stats.md#definitions
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Glyph, Stage, Tuning } from './types.js';
import { applyKey, atEnd, createTypingState, median, score, tick } from './typing.js';
import { classify } from './illumination.js';
import { keySetFor, loadStages } from './curriculum.js';
import { loadTuning, tuningValue } from './tuning.js';

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
const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));

const MS_PER_MINUTE = 60000; // tuning-exempt: SI unit conversion, mirrors the one in typing.ts

const VERSE = 'In the beginning God created the heavens and the earth.';

function at(stage: number, text: string): Glyph[] {
  return classify(text, keySetFor(stages, stage), 'ansi');
}

/** Type the passage perfectly, taking `gapMs` between keystrokes. */
function typeAll(glyphs: readonly Glyph[], gapMs: number) {
  let state = createTypingState(glyphs);
  while (!atEnd(state)) {
    const glyph = state.glyphs[state.cursor];
    if (glyph === undefined) break;
    state = tick(state, gapMs);
    state = applyKey(state, glyph.ch, tuning);
  }
  return state;
}

test('a wrong keystroke never advances the cursor', () => {
  const start = createTypingState(at(0, 'fjf'));
  const wrong = applyKey(start, 'j', tuning);

  assert.equal(wrong.cursor, start.cursor);
  assert.equal(wrong.keystrokes, start.keystrokes + 1);
  assert.equal(wrong.correct, start.correct);
  assert.equal(wrong.blocked, true);

  const stat = wrong.keyStats['f'];
  assert.ok(stat !== undefined);
  assert.equal(stat.hits, 0);
  assert.equal(stat.errors, 1);
  assert.equal(stat.confusions['j'], 1, 'the confusion matrix records what was struck instead');
  assert.equal(stat.latencies.length, 0);

  // Striking it again records a second confusion and still holds the cursor.
  const twice = applyKey(wrong, 'k', tuning);
  assert.equal(twice.cursor, start.cursor);
  assert.equal(twice.keyStats['f']?.errors, 2);
  assert.equal(twice.keyStats['f']?.confusions['k'], 1);

  // Only the correct key releases it.
  const right = applyKey(twice, 'f', tuning);
  assert.equal(right.cursor, start.cursor + 1);
  assert.equal(right.correct, 1);
  assert.equal(right.blocked, false);
  assert.equal(right.keyStats['f']?.hits, 1);
});

test('accuracy counts every keypress, corrections included', () => {
  let state = createTypingState(at(0, 'fj'));
  state = applyKey(state, 'j', tuning);
  state = applyKey(state, 'f', tuning);
  state = applyKey(state, 'j', tuning);
  assert.equal(state.correct, 2);
  assert.equal(state.keystrokes, state.correct + 1);
  assert.equal(score(state, tuning).accuracy, 2 / (2 + 1));
});

test('greyed characters do not count toward WPM', () => {
  const glyphs = at(1, VERSE);
  const live = glyphs.filter((g) => g.live).length;
  assert.ok(live > 0 && live < glyphs.length, 'the fixture must be partly greyed');

  let state = typeAll(glyphs, 0);
  state = tick(state, MS_PER_MINUTE);

  const perWord = tuningValue(tuning, 'wpm_chars_per_word');
  assert.equal(state.correct, live);
  assert.equal(state.keystrokes, live);
  assert.equal(score(state, tuning).wpm, live / perWord);

  // The tempting bug: counting the whole verse instead of what was typed.
  assert.ok(score(state, tuning).wpm < glyphs.length / perWord);

  // At the last stage the same verse is fully live, so the same minute scores
  // strictly higher -- the dip the history view warns about, in reverse.
  const lit = at(stages.length - 1, VERSE);
  assert.equal(lit.filter((g) => g.live).length, lit.length);
  const litState = tick(typeAll(lit, 0), MS_PER_MINUTE);
  assert.ok(score(litState, tuning).wpm > score(state, tuning).wpm);
});

test('WPM is correct characters over five, per minute', () => {
  const perWord = tuningValue(tuning, 'wpm_chars_per_word');
  const glyphs = at(0, 'fjfjfjfjfj');
  let state = typeAll(glyphs, 0);
  state = tick(state, MS_PER_MINUTE);
  assert.equal(state.correct, glyphs.length);
  assert.equal(score(state, tuning).wpm, glyphs.length / perWord);

  // Half a minute, same characters: twice the rate.
  let half = typeAll(glyphs, 0);
  half = tick(half, MS_PER_MINUTE / 2);
  assert.equal(score(half, tuning).wpm, (glyphs.length / perWord) * 2);

  // No time has passed: no rate, rather than an infinity.
  assert.equal(score(createTypingState(glyphs), tuning).wpm, 0);
});

test('a latency sample after a long pause is discarded', () => {
  const idleMs = tuningValue(tuning, 'idle_base_ms');
  const quickMs = tuningValue(tuning, 'gate_latency_floor_ms');

  let state = createTypingState(at(0, 'fjf'));
  state = tick(state, idleMs + quickMs);
  state = applyKey(state, 'f', tuning);

  const thinking = state.keyStats['f'];
  assert.ok(thinking !== undefined);
  assert.equal(thinking.hits, 1, 'the keystroke still counts for accuracy and WPM');
  assert.equal(thinking.latencies.length, 0, 'but not for the muscle-memory signal');
  assert.equal(thinking.totalMs, 0);

  // A normal gap is retained.
  state = tick(state, quickMs);
  state = applyKey(state, 'j', tuning);
  assert.deepEqual(state.keyStats['j']?.latencies, [quickMs]);
  assert.equal(state.keyStats['j']?.totalMs, quickMs);

  // A pause exactly at the threshold is still thinking-free.
  let edge = createTypingState(at(0, 'fj'));
  edge = tick(edge, idleMs);
  edge = applyKey(edge, 'f', tuning);
  assert.deepEqual(edge.keyStats['f']?.latencies, [idleMs]);
});

test('greyed runs auto-advance; the cursor never rests on one', () => {
  // 'z' is untaught at stage 0, so the cursor snaps from 'f' to 'j'.
  const glyphs = at(0, 'fzzj');
  assert.deepEqual(glyphs.map((g) => g.live), [true, false, false, true]);

  let state = createTypingState(glyphs);
  assert.equal(state.cursor, 0);
  state = applyKey(state, 'f', tuning);
  assert.equal(state.cursor, glyphs.length - 1, 'snapped past the greyed run');

  // Leading greyed characters are already snapped past at creation.
  const leading = createTypingState(at(0, 'zzf'));
  assert.equal(leading.cursor, 2);

  // And tick alone will do it, for a state built some other way.
  const raw = { ...createTypingState(at(0, 'zzf')), cursor: 0 };
  assert.equal(tick(raw, 0).cursor, 2);
});

test('a trailing greyed run does not strand the player at the end', () => {
  const glyphs = at(0, 'fz');
  let state = createTypingState(glyphs);
  assert.equal(atEnd(state), false);
  state = applyKey(state, 'f', tuning);
  assert.equal(atEnd(state), true);
  assert.equal(atEnd(createTypingState(at(0, 'zzz'))), true, 'nothing live at all');
  assert.equal(atEnd(createTypingState([])), true);
});

test('tick advances both clocks and applyKey resets the keystroke clock', () => {
  const quickMs = tuningValue(tuning, 'gate_latency_floor_ms');
  let state = createTypingState(at(0, 'fj'));
  state = tick(state, quickMs);
  state = tick(state, quickMs);
  assert.equal(state.elapsedMs, quickMs * 2);
  assert.equal(state.sinceKeyMs, quickMs * 2);
  state = applyKey(state, 'f', tuning);
  assert.equal(state.elapsedMs, quickMs * 2, 'elapsed time is not rewound');
  assert.equal(state.sinceKeyMs, 0);

  // A wrong key is not idleness either; the cloud clock resets on any keypress.
  state = tick(state, quickMs);
  state = applyKey(state, 'f', tuning);
  assert.equal(state.blocked, true);
  assert.equal(state.sinceKeyMs, 0);
});

test('nothing is mutated: applyKey and tick return new state', () => {
  const glyphs = at(0, 'fjf');
  const state = createTypingState(glyphs);
  const before = JSON.stringify(state);
  applyKey(state, 'f', tuning);
  applyKey(state, 'x', tuning);
  tick(state, MS_PER_MINUTE);
  score(state, tuning);
  assert.equal(JSON.stringify(state), before);

  // Per-key stats are copied, not shared, between successive states.
  const first = applyKey(state, 'f', tuning);
  const second = applyKey(first, 'j', tuning);
  assert.notEqual(first.keyStats, second.keyStats);
  assert.equal(first.keyStats['j'], undefined);

  // The glyph array handed in is copied, so a later mutation cannot leak in.
  const mutable = at(0, 'fj');
  const held = createTypingState(mutable);
  mutable.length = 0;
  assert.equal(held.glyphs.length, 2);
});

test('median handles empty, odd and even sample sets', () => {
  const quickMs = tuningValue(tuning, 'gate_latency_floor_ms');
  assert.equal(median([]), 0);
  assert.equal(median([quickMs]), quickMs);
  assert.equal(median([quickMs * 2, quickMs, quickMs * 2]), quickMs * 2);
  assert.equal(median([quickMs, quickMs * 2]), (quickMs * 2 + quickMs) / 2);
  // The input is not reordered.
  const samples = [quickMs * 2, quickMs];
  median(samples);
  assert.deepEqual(samples, [quickMs * 2, quickMs]);
});

test('score reports the median latency across every key', () => {
  const quickMs = tuningValue(tuning, 'gate_latency_floor_ms');
  const state = typeAll(at(0, 'fjfj'), quickMs);
  assert.equal(score(state, tuning).medianLatencyMs, quickMs);
  assert.equal(score(state, tuning).accuracy, 1);
});
