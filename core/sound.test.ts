/**
 * @doc docs/design/09-music.md#music
 *
 * The promise this file exists to keep is the quiet one: `audio_default_on` is
 * 0, and until the player asks, `stepSound` returns an empty array no matter
 * what the game does. Everything else here is the theme-to-tune wiring, and
 * since the music follows the scenery, the crossfade that makes that bearable:
 * two tunes at a boundary, never three, neither at full gain, and the mix moved
 * by the player's typing rather than by a clock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  STRIKE_CUES as STRIKES,
  createAudio,
  masterGain,
  setAudioOn,
  stepSound,
  type AudioState,
  type Cue,
  type Songbook,
} from './sound.js';
import type { StrikeVerb } from './entities.js';
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
      // Two themes on one tune: the songbook allows it and has shipped it, and
      // walking between them is not a tune change and must not fade anything.
      { id: 'cloister', tune: 'hymn-a' },
      { id: 'silent', tune: 'no-such-tune' },
    ],
  }),
};

function frame(theme: string, combo = 0, cues: readonly Cue[] = []) {
  return { theme, combo, cues };
}

/** A frame standing `mix` of the way across a boundary toward `other`. */
function crossing(theme: string, other: string, mix: number, combo = 0) {
  return { theme, blend: { theme: other, mix }, combo, cues: [] as readonly Cue[] };
}

function notes(events: readonly SoundEvent[]): readonly Extract<SoundEvent, { type: 'note' }>[] {
  return events.filter((e): e is Extract<SoundEvent, { type: 'note' }> => e.type === 'note');
}

function mixes(events: readonly SoundEvent[]): readonly Extract<SoundEvent, { type: 'mix' }>[] {
  return events.filter((e): e is Extract<SoundEvent, { type: 'mix' }> => e.type === 'mix');
}

/** What one tune is sounding at, or 0 when it is not sounding at all. */
function gainOf(state: AudioState, tuneId: string): number {
  return state.voices.find((voice) => voice.tuneId === tuneId)?.gain ?? 0;
}

test('AUDIO STARTS ON, because audio_default_on says so', () => {
  // It started muted, and the owner played for hours without hearing one of the
  // ten tunes: "Music should be on, I haven't yet heard anything." The autoplay
  // worry the mute answered is the platform's, and the platform answers it with
  // the first keystroke -- a user gesture, which is what a browser wants.
  // docs/design/09-music.md#audio-is-on-and-starts-on-the-first-keystroke
  assert.equal(tuningValue(tuning, 'audio_default_on'), 1);
  const state = createAudio(tuning);
  assert.equal(state.on, true);

  // A bar of the game in full swing, and the music and the cues are both there.
  const step = stepSound(state, songbook, frame('abbey', 40, ['error', 'candle']), BAR_MS, tuning); // tuning-exempt: test fixture
  assert.ok(step.events.length > 0, 'a full bar produced no sound at all');
  assert.deepEqual(step.state.voices.map((v) => v.tuneId), ['hymn-a']);
  assert.equal(step.state.voices[0]?.seq.playing, true);
});

test('and turning it off still stops everything', () => {
  // The toggle is the door out, and it is the only door there ever was in.
  const muted = setAudioOn(createAudio(tuning), false);
  assert.equal(muted.on, false);
  const step = stepSound(muted, songbook, frame('abbey', 40, ['error', 'candle']), BAR_MS, tuning); // tuning-exempt: test fixture
  assert.deepEqual(step.events, []);
  assert.ok(step.state.voices.every((v) => !v.seq.playing));
});

test('turning sound on starts the theme’s tune', () => {
  const state = setAudioOn(createAudio(tuning), true);
  const step = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning);
  assert.deepEqual(notes(step.events).map((n) => n.midi), [HIGH]);
  assert.deepEqual(notes(step.events).map((n) => n.tune), ['hymn-a']);
  assert.equal(gainOf(step.state, 'hymn-a'), 1);
  assert.equal(step.state.voices[0]?.seq.playing, true);

  // A settled scene announces its one tune at full and says nothing more.
  assert.deepEqual(mixes(step.events), [{ type: 'mix', tune: 'hymn-a', gain: 1 }]);
  const again = stepSound(step.state, songbook, frame('abbey'), FRAME_MS, tuning);
  assert.deepEqual(mixes(again.events), []);

  // And turning it off again stops the needle where it stands.
  const off = setAudioOn(step.state, false);
  assert.ok(off.voices.every((v) => !v.seq.playing));
  assert.equal(off.voices[0]?.seq.posTicks, step.state.voices[0]?.seq.posTicks);
  assert.deepEqual(stepSound(off, songbook, frame('abbey'), BAR_MS, tuning).events, []);
});

test('a theme change with no boundary swaps the tune, and the new one begins at its beginning', () => {
  // What a *level* change is: the chapter under the player becomes another
  // chapter, there is no verse boundary to ease across, and the tune that
  // arrives has not been playing.
  let state: AudioState = setAudioOn(createAudio(tuning), true);
  state = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning).state;
  assert.ok((state.voices[0]?.seq.posTicks ?? 0) > 0);

  const moved = stepSound(state, songbook, frame('tomb'), FRAME_MS, tuning);
  assert.deepEqual(moved.state.voices.map((v) => v.tuneId), ['hymn-b']);
  // At its beginning, so the new tune's downbeat sounds rather than being skipped.
  assert.deepEqual(notes(moved.events).map((n) => n.midi), [LOW]);
  // And the tune that left is faded out rather than abandoned at full gain.
  assert.deepEqual(mixes(moved.events), [
    { type: 'mix', tune: 'hymn-a', gain: 0 },
    { type: 'mix', tune: 'hymn-b', gain: 1 },
  ]);
});

test('TWO TUNES AT A BOUNDARY, NEITHER OF THEM AT FULL', () => {
  // The whole of the crossfade: at the boundary itself the tune being left and
  // the tune arriving are both at one half, which is the frame the tiles cut on.
  // docs/design/09-music.md#two-machines-for-the-width-of-a-boundary
  let state: AudioState = setAudioOn(createAudio(tuning), true);
  state = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning).state;
  const before = state.voices[0]?.seq.posTicks ?? 0;

  const step = stepSound(state, songbook, crossing('abbey', 'tomb', 0.5), FRAME_MS, tuning); // tuning-exempt: the boundary itself
  assert.deepEqual([...step.state.voices].map((v) => v.tuneId).sort(), ['hymn-a', 'hymn-b']);
  assert.equal(gainOf(step.state, 'hymn-a'), 0.5); // tuning-exempt: half of a crossing
  assert.equal(gainOf(step.state, 'hymn-b'), 0.5); // tuning-exempt: half of a crossing
  for (const voice of step.state.voices) assert.ok(voice.gain < 1, 'a tune sounded at full gain mid-crossing');

  // The falling tune is not cut off and not rewound: it carries on by exactly
  // the tick this frame was worth, which is the objection this answers. The
  // arriving one starts at the top, because it has not been playing.
  const needle = (id: string): number =>
    step.state.voices.find((v) => v.tuneId === id)?.seq.posTicks ?? -1;
  assert.equal(needle('hymn-a'), before + 1);
  assert.equal(needle('hymn-b'), 1);

  // Both machines sound across a whole bar of the crossing, and every note says
  // which one it came from -- without that the platform would put them on one
  // pulse channel and they would cut each other to pieces.
  const bar = stepSound(step.state, songbook, crossing('abbey', 'tomb', 0.5), BAR_MS, tuning); // tuning-exempt: the boundary itself
  assert.deepEqual([...new Set(notes(bar.events).map((n) => n.tune))].sort(), ['hymn-a', 'hymn-b']);
});

test('the two gains sum to one all the way across, so nothing dips in the middle', () => {
  let state: AudioState = setAudioOn(createAudio(tuning), true);
  const STEPS = 10; // tuning-exempt: test fixture -- samples across one window
  for (let i = 0; i <= STEPS; i += 1) {
    // Toward the boundary as the old scene, and away from it as the new one:
    // the ease is symmetrical, so the second half is the first half mirrored.
    const mix = (i / STEPS) * 0.5; // tuning-exempt: half is as far as a crossing goes
    const near = stepSound(state, songbook, crossing('abbey', 'tomb', mix), FRAME_MS, tuning);
    const far = stepSound(state, songbook, crossing('tomb', 'abbey', mix), FRAME_MS, tuning);
    for (const carried of [near, far]) {
      const total = carried.state.voices.reduce((sum, v) => sum + v.gain, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `the mix summed to ${String(total)}`); // tuning-exempt: floating-point noise floor
      assert.ok(carried.state.voices.length <= 2, 'a third voice appeared at a boundary');
    }
    state = near.state;
  }
});

test('THE MIX MOVES WITH THE PASSAGE AND NOT WITH THE CLOCK', () => {
  // docs/decisions/0004-idle-threat-not-speed-timer.md, applied to the mix: the
  // world must not change while the player is thinking. The needles still turn
  // -- the music plays on -- but the balance between them is a function of the
  // verse under the cursor, so an idle frame emits no mix event at all.
  let state: AudioState = setAudioOn(createAudio(tuning), true);
  const standing = crossing('abbey', 'tomb', 0.3); // tuning-exempt: partway across
  state = stepSound(state, songbook, standing, FRAME_MS, tuning).state;

  const gains = state.voices.map((v) => `${v.tuneId}:${String(v.gain)}`).sort();
  for (let i = 0; i < 200; i += 1) { // tuning-exempt: test fixture -- a long think
    const idle = stepSound(state, songbook, standing, FRAME_MS, tuning);
    assert.deepEqual(mixes(idle.events), [], 'the mix moved while nobody was typing');
    state = idle.state;
  }
  assert.deepEqual(state.voices.map((v) => `${v.tuneId}:${String(v.gain)}`).sort(), gains);
  // And the music did keep playing through all of it.
  assert.ok(state.voices.every((v) => v.seq.playing));
});

test('two themes on one tune is one voice at full, not two at half', () => {
  const state = setAudioOn(createAudio(tuning), true);
  const step = stepSound(state, songbook, crossing('abbey', 'cloister', 0.5), FRAME_MS, tuning); // tuning-exempt: the boundary itself
  assert.deepEqual(step.state.voices.map((v) => v.tuneId), ['hymn-a']);
  assert.equal(gainOf(step.state, 'hymn-a'), 1);
});

test('a boundary against a theme with no tune fades toward silence, not to a fault', () => {
  const state = setAudioOn(createAudio(tuning), true);
  const step = stepSound(state, songbook, crossing('abbey', 'silent', 0.5), FRAME_MS, tuning); // tuning-exempt: the boundary itself
  assert.deepEqual(step.state.voices.map((v) => v.tuneId), ['hymn-a']);
  assert.equal(gainOf(step.state, 'hymn-a'), 0.5); // tuning-exempt: half of a crossing
});

test('a tune that comes back later comes back at its beginning', () => {
  // The sea returns on the fifth day of Genesis 1. It stopped, so it begins
  // again rather than resuming a bar nobody was standing in.
  let state: AudioState = setAudioOn(createAudio(tuning), true);
  state = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning).state;
  state = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning).state;
  state = stepSound(state, songbook, frame('tomb'), FRAME_MS, tuning).state;
  const back = stepSound(state, songbook, frame('abbey'), FRAME_MS, tuning);
  assert.deepEqual(notes(back.events).map((n) => n.midi), [HIGH]);
  assert.equal(back.state.voices[0]?.seq.posTicks, 1);
});

test('a theme whose tune is missing is silent, not fatal', () => {
  const state = setAudioOn(createAudio(tuning), true);
  const step = stepSound(state, songbook, frame('silent'), BAR_MS, tuning);
  assert.deepEqual(step.events, []);
  assert.deepEqual(step.state.voices, []);

  const unknown = stepSound(state, songbook, frame('no-such-theme'), BAR_MS, tuning);
  assert.deepEqual(unknown.events, []);
});

test('a tempo change is announced once, and only when it changes', () => {
  const state = setAudioOn(createAudio(tuning), true);

  // No combo, and the needle already runs at the authored tempo: nothing to say.
  const first = stepSound(state, songbook, frame('abbey', 0), FRAME_MS, tuning);
  assert.equal(first.events.filter((e) => e.type === 'tempo').length, 0);
  assert.equal(first.state.tempoRatio, 1);

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

  const muted = stepSound(setAudioOn(createAudio(tuning), false), songbook,
    frame('abbey', 0, ['error']), FRAME_MS, tuning);
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

test('felling a monster has a voice, and the combo decides how hard it is struck', () => {
  const on = setAudioOn(createAudio(tuning), true);
  const velocityAt = (cue: Cue, combo: number): number => {
    const step = stepSound(on, songbook, frame('abbey', combo, [cue]), FRAME_MS, tuning);
    const sfx = step.events.find((e) => e.type === 'sfx' && e.id === cue);
    assert.ok(sfx !== undefined && sfx.type === 'sfx');
    return sfx.vel ?? 0;
  };

  const full = comboForFullTempo(tuning);
  for (const verb of STRIKES) {
    const quiet = velocityAt(verb, 0);
    const loud = velocityAt(verb, full);
    assert.ok(quiet > 0);
    assert.ok(loud > quiet, `${verb}: a long clean run struck no harder than a cold start`);
    // Bounded, like the tempo: a runaway combo does not run the mix off the top.
    assert.equal(velocityAt(verb, full * 10), loud); // tuning-exempt: test fixture, well past a full combo
    // And it never falls below the base, so losing a combo quietens nothing.
    for (let combo = 0; combo <= full; combo += 1) assert.ok(velocityAt(verb, combo) >= quiet);
  }

  // Only the strike cues move. Everything else is a fixed weight in the mix.
  const other = (combo: number): number => {
    const step = stepSound(on, songbook, frame('abbey', combo, ['candle']), FRAME_MS, tuning);
    const cue = step.events.find((e) => e.type === 'sfx');
    assert.ok(cue !== undefined && cue.type === 'sfx');
    return cue.vel ?? 0;
  };
  assert.equal(other(0), other(full * 10)); // tuning-exempt: test fixture, well past a full combo
});

test('the two verbs are two cues, so the ear is told what the eye is shown', () => {
  // docs/design/03-pacing.md gives a skeleton and a bat different verbs
  // precisely so they read as different things. Both rang one `defeat` cue,
  // which said the opposite. The ids are `StrikeVerb`'s own two words, so the
  // platform passes the verb through rather than looking it up.
  const on = setAudioOn(createAudio(tuning), true);
  const verbs: readonly StrikeVerb[] = ['stomp', 'ink'];
  assert.deepEqual([...verbs], [...STRIKES], 'a verb exists that rings no cue of its own');

  const step = stepSound(on, songbook, frame('abbey', 0, [...STRIKES]), FRAME_MS, tuning);
  const ids = step.events.filter((e) => e.type === 'sfx').map((e) => e.id);
  assert.deepEqual(ids, [...STRIKES]);

  // Different weights at rest, or they would still be one sound with two names.
  const at = (cue: Cue): number => {
    const one = stepSound(on, songbook, frame('abbey', 0, [cue]), FRAME_MS, tuning);
    const sfx = one.events.find((e) => e.type === 'sfx');
    assert.ok(sfx !== undefined && sfx.type === 'sfx');
    return sfx.vel ?? 0;
  };
  assert.notEqual(at('stomp'), at('ink'));
});
