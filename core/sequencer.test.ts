/**
 * @doc docs/design/09-music.md#tune-format
 *
 * Two properties are asserted here because both are inaudible until they are
 * badly wrong: the loop seam drops or doubles no note, and the same sequence of
 * `dtMs` values always yields the same event stream. A sequencer that is only
 * *nearly* deterministic produces bugs that cannot be reproduced.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  advanceSequencer,
  comboForFullTempo,
  comboTempoRatio,
  createSequencer,
  startSequencer,
  stopSequencer,
} from './sequencer.js';
import { loadTune } from './tunes.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { SequencerState } from './sequencer.js';
import type { Tune } from './tunes.js';
import type { SoundEvent, Tuning } from './types.js';

/** Read a real data file, whether the tests run from build/ or from source. */
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

/**
 * A four-note scale figure, one bar long. 60 bpm at 4 ppq makes a tick exactly
 * 250 ms, so every duration below is an exact integer and no assertion in this
 * file has to reason about floating point.
 */
const BAR: Tune = loadTune({
  id: 'fixture', name: 'Fixture', source: 'written for this test',
  bpm: 60, ppq: 4, loop: 8, // tuning-exempt: test fixture -- one tick is 250 ms
  tracks: [
    {
      ch: 'pulse1', duty: 0.5, // tuning-exempt: test fixture
      notes: [
        { t: 0, dur: 2, midi: 60, vel: 100 }, // tuning-exempt: test fixture
        { t: 2, dur: 2, midi: 62, vel: 100 }, // tuning-exempt: test fixture
        { t: 4, dur: 2, midi: 64, vel: 100 }, // tuning-exempt: test fixture
        { t: 6, dur: 2, midi: 65, vel: 100 }, // tuning-exempt: test fixture
      ],
    },
    { ch: 'triangle', notes: [{ t: 0, dur: 8, midi: 36 }] }, // tuning-exempt: test fixture
  ],
});

const TICK_MS = 250; // tuning-exempt: test fixture -- one tick of BAR
const BAR_MS = TICK_MS * BAR.loop;

/** Just the melodic line of a run, as note numbers, so a stream is readable. */
function pitches(events: readonly SoundEvent[]): number[] {
  return events
    .filter((e): e is Extract<SoundEvent, { type: 'note' }> => e.type === 'note')
    .filter((e) => e.ch === 'pulse1')
    .map((e) => e.midi);
}

/** Run a sequence of frame lengths through a fresh sequencer. */
function run(frames: readonly number[], ratio = 1): SoundEvent[] {
  let state: SequencerState = startSequencer(createSequencer());
  const events: SoundEvent[] = [];
  for (const dtMs of frames) {
    const step = advanceSequencer(state, BAR, dtMs, ratio);
    state = step.state;
    events.push(...step.events);
  }
  return events;
}

function repeat(count: number, dtMs: number): number[] {
  return new Array<number>(count).fill(dtMs);
}

test('a stopped sequencer is silent, and starting it does not skip the downbeat', () => {
  const idle = advanceSequencer(createSequencer(), BAR, BAR_MS, 1);
  assert.deepEqual(idle.events, []);
  assert.equal(idle.state.posTicks, 0);

  const first = advanceSequencer(startSequencer(createSequencer()), BAR, TICK_MS, 1);
  assert.deepEqual(pitches(first.events), [60]); // tuning-exempt: test fixture -- the downbeat
});

test('a tune loops seamlessly at its loop point', () => {
  // Two bars, a tick at a time. The seam must produce the second bar exactly,
  // with nothing dropped at the end of the first and nothing doubled at the top
  // of the second.
  const twoBars = pitches(run(repeat(BAR.loop * 2, TICK_MS)));
  const oneBar = [60, 62, 64, 65]; // tuning-exempt: test fixture -- the figure
  assert.deepEqual(twoBars, [...oneBar, ...oneBar]);

  // The needle comes back to exactly zero, not to a hair past it.
  let state = startSequencer(createSequencer());
  state = advanceSequencer(state, BAR, BAR_MS, 1).state;
  assert.equal(state.posTicks, 0);
});

test('a frame that straddles the seam still lands every note once', () => {
  // Frames deliberately out of phase with the bar: 7 frames of 300 ms crosses
  // the loop point mid-frame and runs past it.
  const straddled = pitches(run(repeat(7, 300))); // tuning-exempt: test fixture -- 2100 ms, out of phase
  assert.deepEqual(straddled, [60, 62, 64, 65, 60]); // tuning-exempt: test fixture
});

test('TWO SEQUENCERS CROSS TWO SEAMS, AND NEITHER DRAGS THE OTHER OVER ONE', () => {
  // A crossfade runs two of these at once, at unrelated tempos and over
  // unrelated loop lengths, so the seam guard has to hold per needle rather
  // than per frame. Advanced together, each has to produce exactly the stream
  // it produces alone. docs/design/09-music.md#two-seams-not-one
  const OTHER = loadTune({
    id: 'other', name: 'Other', source: 'written for this test',
    // A different tempo and a shorter loop, so its seam never lines up with the
    // fixture's: 90 bpm at 3 ppq is a tick of 222.2 ms, which does not divide
    // into anything above and is exactly the ragged case the epsilon is for.
    bpm: 90, ppq: 3, loop: 5, // tuning-exempt: test fixture -- an awkward second machine
    tracks: [
      {
        ch: 'pulse1', duty: 0.25, // tuning-exempt: test fixture
        notes: [
          { t: 0, dur: 1, midi: 72, vel: 90 },  // tuning-exempt: test fixture
          { t: 3, dur: 1, midi: 74, vel: 90 },  // tuning-exempt: test fixture
        ],
      },
    ],
  });

  const frames = repeat(60, 137); // tuning-exempt: test fixture -- ragged frames, several laps of both
  const alone = (tune: Tune): number[] => {
    let state: SequencerState = startSequencer(createSequencer());
    const out: SoundEvent[] = [];
    for (const dtMs of frames) {
      const step = advanceSequencer(state, tune, dtMs, 1);
      state = step.state;
      out.push(...step.events);
    }
    return pitches(out);
  };

  let a: SequencerState = startSequencer(createSequencer());
  let b: SequencerState = startSequencer(createSequencer());
  const fromA: SoundEvent[] = [];
  const fromB: SoundEvent[] = [];
  for (const dtMs of frames) {
    const stepA = advanceSequencer(a, BAR, dtMs, 1);
    const stepB = advanceSequencer(b, OTHER, dtMs, 1);
    a = stepA.state;
    b = stepB.state;
    fromA.push(...stepA.events);
    fromB.push(...stepB.events);
  }
  assert.deepEqual(pitches(fromA), alone(BAR));
  assert.deepEqual(pitches(fromB), alone(OTHER));

  // Each stream also names its own tune, which is what keeps the two machines
  // off one another's channels once the platform has them.
  const named = (events: readonly SoundEvent[]): string[] => [...new Set(
    events.filter((e): e is Extract<SoundEvent, { type: 'note' }> => e.type === 'note')
      .map((e) => e.tune),
  )];
  assert.deepEqual(named(fromA), ['fixture']);
  assert.deepEqual(named(fromB), ['other']);
});

test('the same dtMs sequence always produces the same events', () => {
  const frames = [17, 33, 250, 1, 999, 16, 16, 480, 250]; // tuning-exempt: test fixture -- ragged frame times
  assert.deepEqual(run(frames), run(frames));
  // And chunking is irrelevant: one big frame equals many small ones.
  assert.deepEqual(pitches(run([BAR_MS])), pitches(run(repeat(BAR.loop, TICK_MS))));
});

test('note lengths are in milliseconds, scaled by the tempo', () => {
  const [first] = run([TICK_MS]).filter((e) => e.type === 'note');
  assert.ok(first !== undefined && first.type === 'note');
  assert.equal(first.ms, TICK_MS * 2);
  // At double tempo the same note is half as long.
  const [fast] = run([TICK_MS], 2).filter((e) => e.type === 'note');
  assert.ok(fast !== undefined && fast.type === 'note');
  assert.equal(fast.ms, TICK_MS);
});

test('the triangle carries no velocity of its own', () => {
  const bass = run([TICK_MS]).find((e) => e.type === 'note' && e.ch === 'triangle');
  assert.ok(bass !== undefined && bass.type === 'note');
  assert.equal(bass.duty, undefined);
  assert.equal(bass.vel, 127); // tuning-exempt: test fixture -- full, as the 2A03 triangle always is
});

test('tempo scaling is bounded above by combo_tempo_max', () => {
  const ceiling = tuningValue(tuning, 'combo_tempo_max');
  const full = comboForFullTempo(tuning);
  assert.ok(full > 0);

  assert.equal(comboTempoRatio(0, tuning), 1);
  assert.equal(comboTempoRatio(-1, tuning), 1);
  assert.equal(comboTempoRatio(full, tuning), ceiling);

  // Monotonic up to the ceiling, and pinned there for ever after.
  let previous = 1;
  for (let combo = 0; combo <= full * 4; combo += 1) { // tuning-exempt: test fixture -- well past the ceiling
    const ratio = comboTempoRatio(combo, tuning);
    assert.ok(ratio >= previous - Number.EPSILON, `combo ${String(combo)} went backwards`);
    assert.ok(ratio <= ceiling, `combo ${String(combo)} exceeded combo_tempo_max`);
    previous = ratio;
  }
  assert.equal(comboTempoRatio(Number.MAX_SAFE_INTEGER, tuning), ceiling);
});

test('a fresh needle is at the top; stopping holds one where it is', () => {
  // There is no rewind: a tune change crossfades, so a sounding tune is never
  // moved back to the top and an arriving one has nowhere else to start.
  // docs/design/09-music.md#two-machines-for-the-width-of-a-boundary
  let state = startSequencer(createSequencer());
  state = advanceSequencer(state, BAR, TICK_MS * 3, 1).state; // tuning-exempt: test fixture
  assert.equal(state.posTicks, 3); // tuning-exempt: test fixture

  assert.equal(stopSequencer(state).posTicks, 3); // tuning-exempt: test fixture
  assert.equal(createSequencer().posTicks, 0);
  assert.deepEqual(advanceSequencer(stopSequencer(state), BAR, BAR_MS, 1).events, []);
});
