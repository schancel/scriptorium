/**
 * The voice model: what a note *is*, before anything is allowed to make a sound.
 *
 * @doc docs/design/09-music.md#how-chords-work
 *
 * Four voices and no more, because the 2A03's poverty is the reason its music
 * sounds the way it does. Two pulses, one triangle, one noise channel -- so a
 * three-note chord under a melody is arithmetically impossible and every chord
 * in this game is an illusion.
 *
 * The load-bearing illusion is the arpeggio. `arpMidiAt` is the whole trick in
 * one line: a note carrying `arp: [0,4,7]` is not a chord, it is *one* voice
 * stepping through those semitone offsets at `arpHz`. Above roughly 30 Hz the
 * ear stops hearing three notes and starts hearing one buzzing chord, which is
 * why the shimmer under a Castlevania melody costs a single channel.
 *
 * Nothing here synthesises anything. It returns pitches, times and envelope
 * shapes as plain numbers; `platform/web/web_audio.ts` is the only file in the
 * repository permitted to turn them into air. The split is the same one
 * `draw.ts` has with the canvas renderer, and for the same reason: a Dart port
 * rewrites the player, never the music.
 */

import type { SoundEvent } from './types.js';

// --- channels ---------------------------------------------------------------

/** The four voices. There is no fifth, and adding one is not a small change. */
export type Channel = Extract<SoundEvent, { type: 'note' }>['ch'];

export const CHANNELS: readonly Channel[] = ['pulse1', 'pulse2', 'triangle', 'noise'];

const CHANNEL_SET: ReadonlySet<string> = new Set<string>(CHANNELS);

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && CHANNEL_SET.has(value);
}

/** True for the two channels that take a duty cycle. */
export function isPulse(ch: Channel): boolean {
  return ch === 'pulse1' || ch === 'pulse2';
}

/**
 * The duty cycles the hardware offers. 75% is omitted: it is 25% inverted and
 * sounds identical, so it would be a fourth name for a third timbre.
 */
export const DUTIES: readonly number[] = [0.125, 0.25, 0.5]; // tuning-exempt: 2A03 duty settings, a hardware fact

/** Snap an authored duty to the nearest one the hardware could actually produce. */
export function nearestDuty(duty: number): number {
  let best = DUTIES[0] ?? 0.5; // tuning-exempt: 2A03 duty settings, a hardware fact
  for (const candidate of DUTIES) {
    if (Math.abs(candidate - duty) < Math.abs(best - duty)) best = candidate;
  }
  return best;
}

// --- pitch ------------------------------------------------------------------

/**
 * Concert pitch and equal temperament. These three are facts about music
 * rather than choices about this game -- moving A440 or the twelve-tone octave
 * would not tune the game, it would detune the universe -- so they are exempt
 * rather than tuning rows.
 */
const A4_MIDI = 69;              // tuning-exempt: MIDI note 69 is A4, by definition
const A4_HZ = 440;               // tuning-exempt: concert pitch
const SEMITONES_PER_OCTAVE = 12; // tuning-exempt: equal temperament
const MIDI_VELOCITY_MAX = 127;   // tuning-exempt: MIDI velocity is 7-bit

/** Full velocity, for the channels that do not take one. */
export const FULL_VELOCITY = MIDI_VELOCITY_MAX;

/** Frequency of a MIDI note number, in hertz. Fractional notes are allowed. */
export function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / SEMITONES_PER_OCTAVE);
}

/** A MIDI velocity as a 0..1 amplitude fraction. */
export function velocityGain(vel: number): number {
  const clamped = Math.min(MIDI_VELOCITY_MAX, Math.max(0, vel));
  return clamped / MIDI_VELOCITY_MAX;
}

// --- time -------------------------------------------------------------------

const MS_PER_MINUTE = 60000; // tuning-exempt: SI unit conversion, mirrors the one in typing.ts
const MS_PER_SECOND = 1000;  // tuning-exempt: SI unit conversion

/**
 * Milliseconds per tick, given a tempo. `ppq` is pulses per quarter note, so a
 * quarter note lasts `ppq` ticks and a minute holds `bpm` of them.
 *
 * @param tempoRatio the combo scaling; 1 is the tune's authored tempo
 * @throws if bpm, ppq or the ratio is not positive -- a non-positive tempo
 *         yields an infinite or negative note length, which downstream becomes
 *         a scheduler that never advances
 */
export function msPerTick(bpm: number, ppq: number, tempoRatio: number): number {
  if (!(bpm > 0) || !(ppq > 0) || !(tempoRatio > 0)) {
    throw new Error('synth: bpm, ppq and tempoRatio must all be positive');
  }
  return MS_PER_MINUTE / (bpm * tempoRatio * ppq);
}

// --- the arpeggio -----------------------------------------------------------

/** One rung of an arpeggio: a pitch, and how far into the note it starts. */
export interface ArpStep {
  readonly atMs: number;
  readonly midi: number;
}

/**
 * A hard ceiling on rungs per note: a guard against malformed tune data, and
 * nothing about how the music should sound.
 *
 * It was 512, which is a couple of hundred rungs past a held whole note and
 * looked generous -- and it was not, because plainsong does not hold whole
 * notes. `veni-creator` is a chant over a pedal drone: its longest `pulse2`
 * note runs 384 ticks, which at 96 bpm is ten seconds, which at the house
 * 60 Hz arpeggio is 600 rungs. `expandArp` clamped it, so the drone froze on
 * its last pitch about two thirds of the way through every long note, in the
 * abbey's own tune -- the tune the player hears first and hears most, and the
 * one `void` borrows.
 *
 * A guard that catches real music is mis-sized, so this is now set well past
 * anything anyone would write: 4096 rungs is over a minute of the house
 * arpeggio, and the longest loop in the whole library is under a minute. A typo
 * -- an `arpHz` in the thousands, a duration authored in milliseconds -- is
 * still orders of magnitude past it and still refused.
 *
 * And it is no longer the only line of defence. `loadTune` now rejects any note
 * that would exceed this, so a tune that outgrows the ceiling fails loudly at
 * load rather than quietly freezing an arpeggio in a tune nobody is listening
 * closely to. See docs/design/09-music.md#the-arpeggio-ceiling.
 */
export const MAX_ARP_STEPS = 4096; // tuning-exempt: a guard against malformed tune data, not a musical choice

/**
 * How many rungs a note of `durationMs` wants at `arpHz`, before the ceiling.
 *
 * The one place that arithmetic is written down, so the loader's question --
 * "does this note fit?" -- and the expander's answer are the same sum rather
 * than two sums that agree today.
 */
export function arpStepCount(durationMs: number, arpHz: number): number {
  if (!(arpHz > 0) || !(durationMs > 0)) return 1;
  return Math.max(1, Math.ceil(durationMs / (MS_PER_SECOND / arpHz)));
}

/**
 * The pitch an arpeggiated note is sounding at `tMs` into itself.
 *
 * This is the whole illusion. The note's `midi` is the root; `arp` holds
 * semitone offsets from it, cycled at `arpHz`. `[0,4,7]` is major, `[0,3,7]`
 * minor, `[0,3,6]` diminished -- and that last one, cycled fast over a pedal
 * bass, is the sound of impending doom in every 8-bit game ever written.
 *
 * An empty `arp` or a non-positive `arpHz` means the note is not arpeggiated,
 * and it sits on its root.
 */
export function arpMidiAt(
  midi: number,
  arp: readonly number[] | undefined,
  arpHz: number | undefined,
  tMs: number,
): number {
  if (arp === undefined || arp.length === 0) return midi;
  if (arpHz === undefined || !(arpHz > 0)) return midi;
  const index = Math.floor(Math.max(0, tMs) * arpHz / MS_PER_SECOND) % arp.length;
  return midi + (arp[index] ?? 0);
}

/**
 * Every rung of an arpeggiated note, in order, for a note of `durationMs`.
 *
 * Returned as data so the platform can hand the whole run to the audio clock in
 * one go. Scheduling ahead is the only way a 60 Hz arpeggio survives -- a
 * frame-by-frame pitch change would land on 60 fps at best and audibly stagger.
 */
export function expandArp(
  midi: number,
  arp: readonly number[] | undefined,
  arpHz: number | undefined,
  durationMs: number,
): readonly ArpStep[] {
  if (arp === undefined || arp.length === 0) return [{ atMs: 0, midi }];
  if (arpHz === undefined || !(arpHz > 0)) return [{ atMs: 0, midi }];
  if (!(durationMs > 0)) return [{ atMs: 0, midi: midi + (arp[0] ?? 0) }];

  const stepMs = MS_PER_SECOND / arpHz;
  const count = Math.min(MAX_ARP_STEPS, arpStepCount(durationMs, arpHz));
  const steps: ArpStep[] = [];
  for (let i = 0; i < count; i += 1) {
    steps.push({ atMs: i * stepMs, midi: midi + (arp[i % arp.length] ?? 0) });
  }
  return steps;
}

// --- envelopes --------------------------------------------------------------

/**
 * An ADSR shape as plain numbers. `peak` and `sustain` are 0..1 gains; the
 * three times are milliseconds. The platform turns this into gain automation
 * and nothing else reads it.
 */
export interface Envelope {
  readonly peak: number;
  readonly attackMs: number;
  readonly decayMs: number;
  /** Fraction of `peak` held for the body of the note. */
  readonly sustain: number;
  readonly releaseMs: number;
}

/**
 * Voice design, per channel. Every number is exempt for the same reason the
 * band geometry in `draw.ts` is: these choose what the instrument *is*, not how
 * the game plays. A tuning row for `pulse_decay_ms` would invite someone to
 * turn it expecting the game to get easier.
 *
 * The one that is not a taste decision is `triangleLevel`. The 2A03's triangle
 * has no volume register at all -- it is on at one amplitude or it is off -- so
 * the bass ignores velocity here as a matter of hardware fidelity, not because
 * it was convenient.
 */
const V = {
  pulseHeadroom: 0.55,   // tuning-exempt: voice design -- two pulses share the mix
  pulseAttackMs: 2,      // tuning-exempt: voice design
  pulseDecayMs: 40,      // tuning-exempt: voice design
  pulseSustain: 0.72,    // tuning-exempt: voice design
  pulseReleaseMs: 55,    // tuning-exempt: voice design
  triangleLevel: 0.5,    // tuning-exempt: hardware fidelity -- the 2A03 triangle has no volume register
  triangleAttackMs: 3,   // tuning-exempt: voice design
  triangleReleaseMs: 35, // tuning-exempt: voice design
  noiseHeadroom: 0.4,    // tuning-exempt: voice design -- percussion sits under the melody
  noiseAttackMs: 0.5,    // tuning-exempt: voice design
} as const;

/**
 * The envelope a note of this channel and velocity gets.
 *
 * Triangle ignores `vel` -- see `V.triangleLevel`. Noise is a percussive
 * one-shot, so it decays to silence rather than sustaining: its shape comes
 * from `noiseVoice`, and this only sets the level it starts at.
 */
export function envelopeFor(ch: Channel, vel: number, timbre?: string): Envelope {
  if (ch === 'triangle') {
    return {
      peak: V.triangleLevel,
      attackMs: V.triangleAttackMs,
      decayMs: 0,
      sustain: 1,
      releaseMs: V.triangleReleaseMs,
    };
  }
  if (ch === 'noise') {
    const voice = noiseVoice(timbre);
    return {
      peak: velocityGain(vel) * V.noiseHeadroom * voice.level,
      attackMs: V.noiseAttackMs,
      decayMs: voice.decayMs,
      sustain: 0,
      releaseMs: voice.decayMs,
    };
  }
  return {
    peak: velocityGain(vel) * V.pulseHeadroom,
    attackMs: V.pulseAttackMs,
    decayMs: V.pulseDecayMs,
    sustain: V.pulseSustain,
    releaseMs: V.pulseReleaseMs,
  };
}

// --- percussion -------------------------------------------------------------

/** The percussion vocabulary. A tune naming anything else gets a snare. */
export const NOISE_TIMBRES: readonly string[] = ['snare', 'hat', 'kick', 'crash'];

/**
 * A noise hit, described rather than generated. `cutoffHz` and `mode` name a
 * filter over white noise, which is how the 2A03's short-period noise mode is
 * approximated on hardware that has no linear feedback shift register.
 */
export interface NoiseVoice {
  readonly mode: 'lowpass' | 'highpass' | 'bandpass';
  readonly cutoffHz: number;
  readonly q: number;
  readonly decayMs: number;
  /** Relative loudness within the noise channel; the mix is set elsewhere. */
  readonly level: number;
}

/** Percussion voice design; exempt for the same reason `V` above is. */
const PERCUSSION: Readonly<Record<string, NoiseVoice>> = {
  snare: { mode: 'bandpass', cutoffHz: 1800, q: 0.8, decayMs: 130, level: 1 },   // tuning-exempt: voice design
  hat:   { mode: 'highpass', cutoffHz: 7000, q: 0.7, decayMs: 35, level: 0.55 }, // tuning-exempt: voice design
  kick:  { mode: 'lowpass',  cutoffHz: 160,  q: 1.2, decayMs: 120, level: 1 },   // tuning-exempt: voice design
  crash: { mode: 'highpass', cutoffHz: 4200, q: 0.5, decayMs: 700, level: 0.7 }, // tuning-exempt: voice design
};

export function noiseVoice(timbre?: string): NoiseVoice {
  const named = timbre === undefined ? undefined : PERCUSSION[timbre];
  const fallback = PERCUSSION['snare'];
  if (fallback === undefined) throw new Error('synth: percussion table lost its snare');
  return named ?? fallback;
}

/**
 * General MIDI percussion key numbers for the timbres above.
 *
 * The `SoundEvent` note carries a `midi` field and no timbre, which is exactly
 * right: on the 2A03 the noise channel has no pitch either, only a 4-bit period
 * index, and General MIDI has meant "drum, selected by note number" on channel
 * 10 since 1991. So a noise note's `midi` *is* which drum, and a tune may
 * author it either way -- `"timbre": "snare"` or `"midi": 38` -- with
 * `core/tunes.ts` normalising one into the other at load.
 */
const GM_PERCUSSION: Readonly<Record<string, number>> = {
  kick: 36,  // tuning-exempt: General MIDI percussion key map
  snare: 38, // tuning-exempt: General MIDI percussion key map
  hat: 42,   // tuning-exempt: General MIDI percussion key map
  crash: 49, // tuning-exempt: General MIDI percussion key map
};

/** The GM key number for a named timbre; an unknown name becomes a snare. */
export function percussionMidi(timbre: string): number {
  const found = GM_PERCUSSION[timbre] ?? GM_PERCUSSION['snare'];
  if (found === undefined) throw new Error('synth: percussion map lost its snare');
  return found;
}

/** The timbre a noise note's key number names; anything unmapped is a snare. */
export function timbreForMidi(midi: number): string {
  for (const [name, key] of Object.entries(GM_PERCUSSION)) {
    if (key === midi) return name;
  }
  return 'snare';
}
