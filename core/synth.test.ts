/**
 * @doc docs/design/09-music.md#how-chords-work
 *
 * The arpeggio is the one part of this engine that is a *claim* rather than a
 * mechanism: three notes are not sounding together, and the assertion is that
 * the right pitch is present at the right millisecond so the ear fuses them
 * anyway. That claim is checked here rather than listened for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHANNELS,
  DUTIES,
  FULL_VELOCITY,
  MAX_ARP_STEPS,
  arpMidiAt,
  envelopeFor,
  expandArp,
  isChannel,
  isPulse,
  midiToHz,
  msPerTick,
  nearestDuty,
  noiseVoice,
  percussionMidi,
  timbreForMidi,
} from './synth.js';

/** Fixtures. Every number below is a musical fact or a chosen test input. */
const A4 = { midi: 69, hz: 440 };                     // tuning-exempt: test fixture -- concert pitch
const A5 = { midi: 81, hz: 880 };                     // tuning-exempt: test fixture -- one octave up
const MAJOR = [0, 4, 7];                              // tuning-exempt: test fixture -- a major triad
const DIMINISHED = [0, 3, 6];                         // tuning-exempt: test fixture -- the gothic arpeggio
const ARP_HZ = 60;                                    // tuning-exempt: test fixture -- the period arpeggio rate
const MIDDLE_C = 60;                                  // tuning-exempt: test fixture -- MIDI middle C
const EPSILON = 1e-9;                                 // tuning-exempt: test fixture -- float comparison slack

test('midiToHz is concert pitch, and an octave is a doubling', () => {
  assert.ok(Math.abs(midiToHz(A4.midi) - A4.hz) < EPSILON);
  assert.ok(Math.abs(midiToHz(A5.midi) - A5.hz) < EPSILON);
  assert.ok(Math.abs(midiToHz(A4.midi + DUTIES.length) - midiToHz(A4.midi)) > EPSILON);
});

test('the four channels are the only channels', () => {
  assert.deepEqual([...CHANNELS], ['pulse1', 'pulse2', 'triangle', 'noise']);
  for (const ch of CHANNELS) assert.ok(isChannel(ch));
  assert.ok(!isChannel('saw'));
  assert.ok(!isChannel('pulse3'));
  assert.ok(!isChannel(null));
  assert.deepEqual(CHANNELS.filter(isPulse), ['pulse1', 'pulse2']);
});

test('a duty snaps to one the hardware could produce', () => {
  for (const duty of DUTIES) assert.equal(nearestDuty(duty), duty);
  assert.equal(nearestDuty(0.13), 0.125); // tuning-exempt: test fixture -- just above 12.5%
  assert.equal(nearestDuty(0.9), 0.5);    // tuning-exempt: test fixture -- above every legal duty
});

test('msPerTick scales with tempo and refuses a nonsense one', () => {
  const bpm = 120;  // tuning-exempt: test fixture
  const ppq = 24;   // tuning-exempt: test fixture
  const quarter = 500; // tuning-exempt: test fixture -- one beat at 120 bpm, in ms
  assert.ok(Math.abs(msPerTick(bpm, ppq, 1) * ppq - quarter) < EPSILON);
  // Double the tempo, half the tick.
  assert.ok(Math.abs(msPerTick(bpm, ppq, 2) - msPerTick(bpm, ppq, 1) / 2) < EPSILON);
  assert.throws(() => msPerTick(0, ppq, 1));
  assert.throws(() => msPerTick(bpm, ppq, 0));
  assert.throws(() => msPerTick(bpm, ppq, -1));
});

test('an arpeggio sounds the right pitch at the right millisecond', () => {
  // At 60 Hz each rung lasts 1000/60 ms. Sample the middle of each of the
  // first six rungs: the chord must cycle 0, 4, 7, 0, 4, 7 from the root.
  const rungMs = 1000 / ARP_HZ;             // tuning-exempt: test fixture -- ms per rung
  const expected = [0, 4, 7, 0, 4, 7];      // tuning-exempt: test fixture -- two cycles of a major triad
  expected.forEach((offset, i) => {
    const mid = (i + 0.5) * rungMs;         // tuning-exempt: test fixture -- middle of the rung
    assert.equal(arpMidiAt(MIDDLE_C, MAJOR, ARP_HZ, mid), MIDDLE_C + offset);
  });
  // And exactly on a boundary the next rung has already taken over.
  assert.equal(arpMidiAt(MIDDLE_C, MAJOR, ARP_HZ, rungMs), MIDDLE_C + 4); // tuning-exempt: test fixture
});

test('expandArp lays the rungs out in order, at the rung interval', () => {
  const durationMs = 100;            // tuning-exempt: test fixture -- a short note
  const rungMs = 1000 / ARP_HZ;      // tuning-exempt: test fixture
  const steps = expandArp(MIDDLE_C, DIMINISHED, ARP_HZ, durationMs);

  assert.equal(steps.length, Math.ceil(durationMs / rungMs));
  steps.forEach((step, i) => {
    assert.ok(Math.abs(step.atMs - i * rungMs) < EPSILON);
    assert.equal(step.midi, MIDDLE_C + (DIMINISHED[i % DIMINISHED.length] ?? 0));
    // The expansion and the sampler must agree; the platform uses the first
    // and the design doc describes the second.
    assert.equal(arpMidiAt(MIDDLE_C, DIMINISHED, ARP_HZ, step.atMs), step.midi);
  });
});

test('a note with no arpeggio is one step on its own root', () => {
  for (const steps of [
    expandArp(MIDDLE_C, undefined, ARP_HZ, 100),   // tuning-exempt: test fixture
    expandArp(MIDDLE_C, [], ARP_HZ, 100),          // tuning-exempt: test fixture
    expandArp(MIDDLE_C, MAJOR, undefined, 100),    // tuning-exempt: test fixture
    expandArp(MIDDLE_C, MAJOR, 0, 100),            // tuning-exempt: test fixture
  ]) {
    assert.deepEqual([...steps], [{ atMs: 0, midi: MIDDLE_C }]);
  }
  assert.equal(arpMidiAt(MIDDLE_C, undefined, ARP_HZ, 1), MIDDLE_C);
});

test('a malformed tune cannot ask for unbounded work', () => {
  const forever = expandArp(MIDDLE_C, MAJOR, 1e6, 1e6); // tuning-exempt: test fixture -- absurd on purpose
  assert.equal(forever.length, MAX_ARP_STEPS);
});

test('the triangle ignores velocity, as the hardware does', () => {
  const quiet = envelopeFor('triangle', 1);
  const loud = envelopeFor('triangle', FULL_VELOCITY);
  assert.deepEqual(quiet, loud);
  // The pulses do not.
  assert.ok(envelopeFor('pulse1', FULL_VELOCITY).peak > envelopeFor('pulse1', 1).peak);
  // A pulse note decays to a sustain; a noise hit falls to silence.
  assert.ok(envelopeFor('pulse2', FULL_VELOCITY).sustain > 0);
  assert.equal(envelopeFor('noise', FULL_VELOCITY, 'snare').sustain, 0);
});

test('percussion round-trips through its General MIDI key', () => {
  for (const timbre of ['kick', 'snare', 'hat', 'crash']) {
    assert.equal(timbreForMidi(percussionMidi(timbre)), timbre);
  }
  // An unknown name, and an unmapped key, both land on the snare.
  assert.equal(percussionMidi('kettledrum'), percussionMidi('snare'));
  assert.equal(timbreForMidi(MIDDLE_C), 'snare');
  assert.deepEqual(noiseVoice('kettledrum'), noiseVoice('snare'));
});
