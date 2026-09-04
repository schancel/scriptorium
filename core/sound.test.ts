/**
 * @doc docs/design/09-music.md#music
 *
 * The promise this file exists to keep is the quiet one: `audio_default_on` is
 * 0, and until the player asks, `stepSound` returns an empty array no matter
 * what the game does. Everything else here is the theme-to-tune wiring.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createAudio,
  masterGain,
  setAudioOn,
  stepSound,
  type AudioState,
  type Songbook,
} from './sound.js';
import { createLibrary, loadThemeTunes, loadTune } from './tunes.js';
import { comboForFullTempo } from './sequencer.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { SoundEvent, Tuning } from './types.js';

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

/** Two one-note tunes, so a theme change is visible as a pitch change. */
function fixture(id: string, midi: number) {
  return loadTune({
    id, name: id, source: 'written for this test',
    bpm: 60, ppq: 4, loop: 8, // tuning-exempt: test fixture -- one tick is 250 ms
    tracks: [{ ch: 'pulse1', duty: 0.5, notes: [{ t: 0, dur: 4, midi, vel: 100 }] }], // tuning-exempt: test fixture
  });
}

const HIGH = 72; // tuning-exempt: test fixture -- the abbey tune's one note
const LOW = 48;  // tuning-exempt: test fixture -- the tomb tune's one note
const FRAME_MS = 250; // tuning-exempt: test fixture -- one tick of the fixtures
const BAR_MS = 2000;  // tuning-exempt: test fixture -- one whole loop of the fixtures

const songbook: Songbook = {
  library: createLibrary([fixture('hymn-a', HIGH), fixture('hymn-b', LOW)]),
  themes: loadThemeTunes({
    themes: [
      { id: 'abbey', tune: 'hymn-a' },
      { id: 'tomb', tune: 'hymn-b' },
      { id: 'silent', tune: 'no-such-tune' },
    ],
  }),
};

function frame(theme: string, combo = 0, cues: readonly ('error' | 'candle')[] = []) {
  return { theme, combo, cues };
}

function notes(events: readonly SoundEvent[]): readonly Extract<SoundEvent, { type: 'note' }>[] {
  return events.filter((e): e is Extract<SoundEvent, { type: 'note' }> => e.type === 'note');
}

test('audio starts muted, because audio_default_on says so', () => {
  assert.equal(tuningValue(tuning, 'audio_default_on'), 0);
  const state = createAudio(tuning);
  assert.equal(state.on, false);

  // A whole bar goes by with the game in full swing and nothing is emitted.
  const step = stepSound(state, songbook, frame('abbey', 40, ['error', 'candle']), BAR_MS, tuning); // tuning-exempt: test fixture
  assert.deepEqual(step.events, []);
  assert.equal(step.state.seq.playing, false);
});

test('turning sound on starts the theme’s tune', () => {
  const state = setAudioOn(createAudio(tuning), true);
  const step = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning);
  assert.deepEqual(notes(step.events).map((n) => n.midi), [HIGH]);
  assert.equal(step.state.tuneId, 'hymn-a');
  assert.equal(step.state.seq.playing, true);

  // And turning it off again stops the needle where it stands.
  const off = setAudioOn(step.state, false);
  assert.equal(off.seq.playing, false);
  assert.deepEqual(stepSound(off, songbook, frame('abbey'), BAR_MS, tuning).events, []);
});

test('a theme change swaps the tune and rewinds it', () => {
  let state: AudioState = setAudioOn(createAudio(tuning), true);
  state = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning).state;
  assert.ok(state.seq.posTicks > 0);

  const moved = stepSound(state, songbook, frame('tomb'), FRAME_MS, tuning);
  assert.equal(moved.state.tuneId, 'hymn-b');
  // Rewound, so the new tune's downbeat sounds rather than being skipped.
  assert.deepEqual(notes(moved.events).map((n) => n.midi), [LOW]);
});

test('a theme whose tune is missing is silent, not fatal', () => {
  const state = setAudioOn(createAudio(tuning), true);
  const step = stepSound(state, songbook, frame('silent'), BAR_MS, tuning);
  assert.deepEqual(step.events, []);
  assert.equal(step.state.tuneId, null);

  const unknown = stepSound(state, songbook, frame('no-such-theme'), BAR_MS, tuning);
  assert.deepEqual(unknown.events, []);
});

test('a tempo change is announced once, and only when it changes', () => {
  const state = setAudioOn(createAudio(tuning), true);

  // No combo, and the needle already runs at the authored tempo: nothing to say.
  const first = stepSound(state, songbook, frame('abbey', 0), FRAME_MS, tuning);
  assert.equal(first.events.filter((e) => e.type === 'tempo').length, 0);
  assert.equal(first.state.seq.tempoRatio, 1);

  // A rising combo speeds the music up, to the documented ceiling and no further.
  const ceiling = tuningValue(tuning, 'combo_tempo_max');
  const flat = comboForFullTempo(tuning);
  const fast = stepSound(first.state, songbook, frame('abbey', flat * 2), FRAME_MS, tuning); // tuning-exempt: test fixture -- past the ceiling
  assert.deepEqual(fast.events.filter((e) => e.type === 'tempo'), [{ type: 'tempo', ratio: ceiling }]);

  // Held there, it is announced once and not again every frame.
  const held = stepSound(fast.state, songbook, frame('abbey', flat * 2), FRAME_MS, tuning); // tuning-exempt: test fixture
  assert.equal(held.events.filter((e) => e.type === 'tempo').length, 0);

  // And dropping the combo announces the way back down.
  const dropped = stepSound(held.state, songbook, frame('abbey', 0), FRAME_MS, tuning);
  assert.deepEqual(dropped.events.filter((e) => e.type === 'tempo'), [{ type: 'tempo', ratio: 1 }]);
});

test('cues become sfx events, and never while muted', () => {
  const on = setAudioOn(createAudio(tuning), true);
  const step = stepSound(on, songbook, frame('abbey', 0, ['error', 'candle']), FRAME_MS, tuning);
  const sfx = step.events.filter((e) => e.type === 'sfx');
  assert.deepEqual(sfx.map((e) => e.id), ['error', 'candle']);
  for (const event of sfx) assert.ok(event.type === 'sfx' && (event.vel ?? 0) > 0);

  // The cues follow the notes, so the platform can execute in one pass.
  const kinds = step.events.map((e) => e.type);
  assert.ok(kinds.lastIndexOf('note') < kinds.indexOf('sfx'));

  const muted = stepSound(createAudio(tuning), songbook, frame('abbey', 0, ['error']), FRAME_MS, tuning);
  assert.deepEqual(muted.events, []);
});

test('every event survives a JSON round trip', () => {
  const on = setAudioOn(createAudio(tuning), true);
  const step = stepSound(on, songbook, frame('abbey', 0, ['error']), FRAME_MS, tuning);
  assert.ok(step.events.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(step.events)) as unknown, step.events);
});

test('master_volume is the one loudness knob', () => {
  assert.equal(masterGain(tuning), tuningValue(tuning, 'master_volume'));
});
