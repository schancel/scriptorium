/**
 * Reading tune files, and finding the one a theme asks for.
 *
 * @doc docs/design/09-music.md#tune-format
 *
 * The platform loads the JSON -- core never reaches out -- and this validates
 * it into the shape the sequencer can trust. Validation is strict on purpose:
 * a tune naming a fifth channel, or holding a note with no pitch, must fail
 * loudly at load rather than silently producing an event stream the audio
 * layer quietly drops. There is no way to see a wrong note in a code review,
 * so the loader has to be the reviewer.
 *
 * Normalising happens here too, so nothing downstream carries an `undefined`:
 * an absent `duty` becomes `null`, an absent `arp` becomes `null`, a noise
 * note authored as `"timbre": "snare"` becomes its General MIDI key number, and
 * a triangle note's velocity becomes full because the hardware has no volume
 * register for it. By the time a tune leaves this file every field is present.
 */

import {
  FULL_VELOCITY,
  MAX_ARP_STEPS,
  arpStepCount,
  isChannel,
  isPulse,
  msPerTick,
  nearestDuty,
  percussionMidi,
} from './synth.js';
import type { Channel } from './synth.js';

/** One note event. `t` and `dur` are in ticks; see the tune format. */
export interface TuneNote {
  readonly t: number;
  readonly dur: number;
  /** Pitch, or a General MIDI percussion key on the noise channel. */
  readonly midi: number;
  /** 0..127. Ignored on the triangle. */
  readonly vel: number;
  /** Semitone offsets cycled to fake a chord, or null for a plain note. */
  readonly arp: readonly number[] | null;
  readonly arpHz: number | null;
  /**
   * A duty cycle for this note alone, overriding the track's.
   *
   * Duty switching mid-phrase is how one square wave delivers two timbres --
   * the gothic themes lean on it, per docs/design/09-music.md#the-gothic-sound
   * -- and a channel may only appear once in a tune, so it cannot be done by
   * splitting the part across two tracks. Null means "whatever the track says".
   */
  readonly duty: number | null;
}

export interface TuneTrack {
  readonly ch: Channel;
  /** Pulse duty cycle, or null on the channels that have none. */
  readonly duty: number | null;
  readonly notes: readonly TuneNote[];
}

export interface Tune {
  readonly id: string;
  readonly name: string;
  /** Provenance, and the public-domain claim. Required; see the design doc. */
  readonly source: string;
  readonly bpm: number;
  readonly ppq: number;
  /** Length of the loop in ticks. Playback wraps here, not at the last note. */
  readonly loop: number;
  readonly tracks: readonly TuneTrack[];
}

/** The default arpeggio rate when a tune gives offsets but no speed. */
const DEFAULT_ARP_HZ = 60; // tuning-exempt: the period arpeggio rate, per docs/design/09-music.md

const MIDI_MAX = 127; // tuning-exempt: MIDI note and velocity are 7-bit

// --- reading ----------------------------------------------------------------

function fail(what: string): never {
  throw new Error(`tunes: ${what}`);
}

function record(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${what} is not an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function str(from: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = from[key];
  if (typeof value !== 'string' || value.length === 0) fail(`${what} has no "${key}"`);
  return value;
}

function num(from: Readonly<Record<string, unknown>>, key: string, what: string): number {
  const value = from[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${what} has no numeric "${key}"`);
  }
  return value;
}

function optionalNum(from: Readonly<Record<string, unknown>>, key: string, what: string): number | null {
  const value = from[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${what} has a non-numeric "${key}"`);
  }
  return value;
}

function positive(from: Readonly<Record<string, unknown>>, key: string, what: string): number {
  const value = num(from, key, what);
  if (!(value > 0)) fail(`${what}: "${key}" must be positive`);
  return value;
}

/** Semitone offsets, or null. An empty list is treated as "not arpeggiated". */
function readArp(from: Readonly<Record<string, unknown>>, what: string): readonly number[] | null {
  const value = from['arp'];
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) fail(`${what}: "arp" is not an array`);
  const steps = value as readonly unknown[];
  if (steps.length === 0) return null;
  return steps.map((step) => {
    if (typeof step !== 'number' || !Number.isInteger(step)) {
      fail(`${what}: "arp" holds a non-integer offset`);
    }
    return step;
  });
}

/**
 * The pitch of a note.
 *
 * On the noise channel a name is accepted in place of a number, because
 * "snare" is what the author means and 38 is what General MIDI calls it. Every
 * other channel must state a real MIDI note.
 */
function readMidi(
  from: Readonly<Record<string, unknown>>,
  ch: Channel,
  what: string,
): number {
  const timbre = from['timbre'];
  if (ch === 'noise' && typeof timbre === 'string') return percussionMidi(timbre);
  const value = optionalNum(from, 'midi', what);
  if (value === null) {
    if (ch === 'noise') return percussionMidi('snare');
    fail(`${what} has no "midi" and is not on the noise channel`);
  }
  if (!Number.isInteger(value) || value < 0 || value > MIDI_MAX) {
    fail(`${what}: "midi" ${String(value)} is outside 0..127`);
  }
  return value;
}

function readNote(parsed: unknown, ch: Channel, what: string): TuneNote {
  const raw = record(parsed, what);
  const t = num(raw, 't', what);
  if (t < 0) fail(`${what}: "t" is negative`);
  const dur = positive(raw, 'dur', what);
  const midi = readMidi(raw, ch, what);

  // The triangle has no volume register on the 2A03, so a velocity on it would
  // be a number that quietly does nothing. Full, always, as on the hardware.
  const authoredVel = optionalNum(raw, 'vel', what);
  const vel = ch === 'triangle' ? FULL_VELOCITY : (authoredVel ?? FULL_VELOCITY);
  if (vel < 0 || vel > MIDI_MAX) fail(`${what}: "vel" is outside 0..127`);

  const arp = readArp(raw, what);
  const arpHz = arp === null ? null : (optionalNum(raw, 'arpHz', what) ?? DEFAULT_ARP_HZ);
  if (arpHz !== null && !(arpHz > 0)) fail(`${what}: "arpHz" must be positive`);

  const authoredDuty = optionalNum(raw, 'duty', what);
  const duty = isPulse(ch) && authoredDuty !== null ? nearestDuty(authoredDuty) : null;
  return { t, dur, midi, vel, arp, arpHz, duty };
}

function readTrack(parsed: unknown, index: number, tuneId: string): TuneTrack {
  const what = `tune "${tuneId}" track ${String(index)}`;
  const raw = record(parsed, what);
  const ch = raw['ch'];
  if (!isChannel(ch)) {
    fail(`${what}: "${String(ch)}" is not one of the four channels`);
  }
  const notes = raw['notes'];
  if (!Array.isArray(notes)) fail(`${what} has no "notes" array`);

  const authoredDuty = optionalNum(raw, 'duty', what);
  const duty = isPulse(ch) && authoredDuty !== null ? nearestDuty(authoredDuty) : null;

  const read = (notes as readonly unknown[]).map((note, i) =>
    readNote(note, ch, `${what} note ${String(i)}`),
  );
  // Sorted so the sequencer's window scan and the event order it produces are
  // both independent of how the file happened to be written.
  const sorted = [...read].sort((a, b) => a.t - b.t);
  return { ch, duty, notes: sorted };
}

/**
 * Validate one parsed tune file.
 *
 * @throws with the tune id and the offending track or note in the message,
 *         because a bad tune is found by reading the error, never by listening
 */
export function loadTune(parsed: unknown): Tune {
  const raw = record(parsed, 'tune file');
  const id = str(raw, 'id', 'tune file');
  const what = `tune "${id}"`;
  const tracks = raw['tracks'];
  if (!Array.isArray(tracks)) fail(`${what} has no "tracks" array`);
  const read = (tracks as readonly unknown[]).map((track, i) => readTrack(track, i, id));

  const seen = new Set<Channel>();
  for (const track of read) {
    if (seen.has(track.ch)) fail(`${what} uses channel "${track.ch}" twice`);
    seen.add(track.ch);
  }

  const loop = positive(raw, 'loop', what);
  for (const track of read) {
    for (const note of track.notes) {
      if (note.t >= loop) fail(`${what}: a note starts at or after the loop point`);
    }
  }

  const bpm = positive(raw, 'bpm', what);
  const ppq = positive(raw, 'ppq', what);
  checkArpeggios(read, bpm, ppq, what);

  return {
    id,
    name: str(raw, 'name', what),
    source: str(raw, 'source', what),
    bpm,
    ppq,
    loop,
    tracks: read,
  };
}

/**
 * No note may want more arpeggio rungs than `MAX_ARP_STEPS`.
 *
 * A note that wants more is not refused by the synth, it is *clamped* by it --
 * so the arpeggio simply stops moving partway through and holds its last pitch
 * to the end of the note. That is not silence and it is not a wrong note; it is
 * a drone going flat in the middle, which is exactly the kind of fault nobody
 * finds by listening to a tune they are not listening closely to. It hid in
 * `veni-creator` -- the abbey's tune, and the one `void` borrows, so the
 * most-heard music in the game -- until somebody did the arithmetic.
 *
 * So the loader does the arithmetic instead, at the one moment a bad tune can
 * still be reported by reading an error. Measured at `tempoRatio` 1, which is
 * the slowest the sequencer ever plays: the combo only ever speeds the music up
 * (`combo_tempo_max` is above 1), and a faster tempo shortens every note, so
 * the note that fits at rest fits at every tempo.
 * See docs/design/09-music.md#the-arpeggio-ceiling.
 */
function checkArpeggios(
  tracks: readonly TuneTrack[],
  bpm: number,
  ppq: number,
  what: string,
): void {
  const perTick = msPerTick(bpm, ppq, 1);
  for (const track of tracks) {
    for (const note of track.notes) {
      if (note.arp === null || note.arpHz === null) continue;
      const rungs = arpStepCount(note.dur * perTick, note.arpHz);
      if (rungs <= MAX_ARP_STEPS) continue;
      fail(
        `${what}: the ${track.ch} note at tick ${String(note.t)} wants `
        + `${String(rungs)} arpeggio steps, over the ${String(MAX_ARP_STEPS)} limit. `
        + 'Split the note or lower its "arpHz".',
      );
    }
  }
}

// --- lookup -----------------------------------------------------------------

/** Tunes by id. */
export type TuneLibrary = ReadonlyMap<string, Tune>;

export function createLibrary(tunes: readonly Tune[]): TuneLibrary {
  const map = new Map<string, Tune>();
  for (const tune of tunes) {
    if (map.has(tune.id)) fail(`two tunes share the id "${tune.id}"`);
    map.set(tune.id, tune);
  }
  return map;
}

/** Theme id -> tune id, read from the generated `data/themes.json`. */
export type ThemeTunes = ReadonlyMap<string, string>;

/**
 * The theme table's tune column.
 *
 * @throws if a theme row names no tune. Silently defaulting would leave one
 *         scene mute with nothing to notice it by.
 */
export function loadThemeTunes(parsed: unknown): ThemeTunes {
  const raw = record(parsed, 'themes file');
  const themes = raw['themes'];
  if (!Array.isArray(themes)) fail('themes file has no "themes" array');
  const map = new Map<string, string>();
  for (const entry of themes as readonly unknown[]) {
    const theme = record(entry, 'theme row');
    const id = str(theme, 'id', 'theme row');
    map.set(id, str(theme, 'tune', `theme "${id}"`));
  }
  return map;
}

/** The tune id a theme asks for, or null for a theme with no row. */
export function tuneIdForTheme(themes: ThemeTunes, theme: string): string | null {
  return themes.get(theme) ?? null;
}

/**
 * The tune a theme plays, or null when either the theme or its tune is
 * missing. Null rather than a throw: an unscored theme should leave the game
 * silent, never refuse to start it.
 */
export function tuneForTheme(
  library: TuneLibrary,
  themes: ThemeTunes,
  theme: string,
): Tune | null {
  const id = tuneIdForTheme(themes, theme);
  if (id === null) return null;
  return library.get(id) ?? null;
}
