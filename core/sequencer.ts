/**
 * Tune playback: where the needle is, and what falls under it this frame.
 *
 * @doc docs/design/09-music.md#tune-format
 *
 * A tune is MIDI-shaped data -- notes at tick positions -- and this turns it
 * into a stream of `SoundEvent`s by advancing a fractional tick cursor by
 * whatever `dtMs` the platform hands it. Nothing here asks what time it is.
 * Feed the same tune the same sequence of `dtMs` values and you get the same
 * events in the same order, which is what makes the music testable at all.
 *
 * Two properties are worth stating because they are easy to break:
 *
 * **The loop is seamless.** The step window is half-open, `[from, to)`, and
 * when it reaches `tune.loop` the cursor wraps to zero *within the same step*
 * rather than waiting for the next one. So a note at tick 0 fires exactly one
 * tick-width after the last note of the bar, with no frame-length gap and no
 * double-trigger at the seam. `sequencer.test.ts` asserts the note stream
 * across a loop boundary matches the stream from the start.
 *
 * **Tempo is a multiplier, not a rewrite.** The combo scales `msPerTick` and
 * nothing else, so a tune played fast is the same tick data read faster. That
 * keeps the loop point exact at every tempo -- a sequencer that scaled the tick
 * positions instead would accumulate rounding error and drift off the seam.
 *
 * There is no rewind here, and that is deliberate. A tune change *crossfades*
 * (docs/design/09-music.md#the-music-follows-the-scenery), so nothing is ever
 * moved back to the top: a tune that is sounding plays on from where it is
 * while its gain comes down, and a tune that is not sounding has no needle to
 * move -- `core/sound.ts` gives an arriving tune a fresh one. A tune therefore
 * only ever begins at its beginning.
 *
 * And a crossfade means **two of these advancing at once**, at unrelated
 * tempos and over unrelated loop lengths. Every seam guard below is per state
 * rather than per frame for that reason: two machines cannot see each other's
 * loop point and neither can drag the other over it.
 */

import { msPerTick } from './synth.js';
import { tuningValue } from './tuning.js';
import type { SoundEvent, Tuning } from './types.js';
import type { Tune, TuneNote, TuneTrack } from './tunes.js';

/** The needle position. Immutable, like every other core state record. */
export interface SequencerState {
  /** Fractional tick offset into the loop. */
  readonly posTicks: number;
  readonly playing: boolean;
  /** The tempo multiplier in force, so a change can be announced once. */
  readonly tempoRatio: number;
}

export interface SequencerStep {
  readonly state: SequencerState;
  readonly events: readonly SoundEvent[];
}

/** A stopped needle at the top of the tune. */
export function createSequencer(): SequencerState {
  return { posTicks: 0, playing: false, tempoRatio: 1 };
}

export function startSequencer(state: SequencerState): SequencerState {
  return { ...state, playing: true };
}

export function stopSequencer(state: SequencerState): SequencerState {
  return { ...state, playing: false };
}

// --- tempo ------------------------------------------------------------------

/**
 * How long a combo has to run before the music is at full tilt.
 *
 * Derived rather than invented, because it is a real milestone the player can
 * feel: `smudge_max / smudge_decay_per_key` is exactly the number of clean
 * keystrokes that scrubs a full smudge meter back to a clean page. Reaching
 * top tempo therefore means "you have typed away as much damage as the page can
 * hold", which is a better thing for the tempo to mean than an arbitrary count,
 * and it moves correctly on its own if either smudge row is ever retuned.
 */
export function comboForFullTempo(tuning: Tuning): number {
  const span = tuningValue(tuning, 'smudge_max');
  const perKey = tuningValue(tuning, 'smudge_decay_per_key');
  if (!(perKey > 0)) return span;
  return span / perKey;
}

/**
 * The tempo multiplier for a combo, bounded above by `combo_tempo_max`.
 *
 * Linear from 1 at no combo to the ceiling at `comboForFullTempo`, and flat
 * from there. The bound is the point: a runaway combo must not run the music
 * off into chipmunk territory, and the ceiling is a documented tuning row
 * precisely so the limit is visible rather than buried in an easing curve.
 */
export function comboTempoRatio(combo: number, tuning: Tuning): number {
  const ceiling = tuningValue(tuning, 'combo_tempo_max');
  const full = comboForFullTempo(tuning);
  if (!(full > 0)) return ceiling;
  const fraction = Math.min(1, Math.max(0, combo / full));
  return 1 + fraction * (ceiling - 1);
}

// --- stepping ---------------------------------------------------------------

/**
 * A guard on how many times one step may cross the loop point. A `dtMs` large
 * enough to lap the tune dozens of times is a tab that was backgrounded, not
 * music -- replaying every note of those laps at once would be a wall of sound.
 */
const MAX_LAPS_PER_STEP = 4; // tuning-exempt: a guard against a stalled frame clock, not a musical choice

/**
 * The smallest residue worth stepping, in ticks.
 *
 * The needle advances by `dtMs / msPerTick`, and those divisions do not sum
 * back to a whole number of ticks exactly. Without this the last sliver of a
 * lap -- a few parts in 10^13 of a tick -- crossed the loop point, wrapped, and
 * opened a window starting at zero, which re-fired the downbeat a hair before
 * the real one. Once per loop, on every channel at tick 0, and audible as a
 * flam on the first beat of every repeat.
 *
 * This is a floating-point noise floor, not a musical duration: it is smaller
 * than a tick by nine orders of magnitude, so no note anyone could write is
 * short enough to fall through it.
 */
const TICK_EPSILON = 1e-9; // tuning-exempt: floating-point noise floor, not a musical duration

/** Notes on one track whose onset falls in `[from, to)`, appended in order. */
function collect(
  track: TuneTrack,
  tuneId: string,
  from: number,
  to: number,
  perTick: number,
  into: SoundEvent[],
): void {
  for (const note of track.notes) {
    if (note.t < from || note.t >= to) continue;
    into.push(noteEvent(track, tuneId, note, perTick));
  }
}

/**
 * One tune note as a `SoundEvent`.
 *
 * A note's own duty wins over its track's, which is how a single pulse channel
 * changes timbre mid-phrase -- see docs/design/09-music.md#the-gothic-sound.
 *
 * `duty`, `arp` and `arpHz` are only attached when the note actually has them:
 * the event type marks them optional and `exactOptionalPropertyTypes` means an
 * explicit `undefined` is not the same thing as an absent key. It also keeps
 * the events small and cleanly JSON-serialisable, which is the contract.
 *
 * `tune` is not optional, and it is the one field here that is about the mix
 * rather than the note. A tune change crossfades, so two sequencers run across
 * a boundary and the platform gives each its own fader and its own four voices
 * -- and a note that could not say which machine it came from would be played
 * on whichever one happened to be sounding, cutting the other off mid-phrase.
 * See docs/design/09-music.md#two-machines-for-the-width-of-a-boundary.
 */
function noteEvent(
  track: TuneTrack,
  tuneId: string,
  note: TuneNote,
  perTick: number,
): SoundEvent {
  const event: {
    type: 'note';
    ch: TuneTrack['ch'];
    tune: string;
    midi: number;
    vel: number;
    ms: number;
    duty?: number;
    arp?: readonly number[];
    arpHz?: number;
  } = {
    type: 'note',
    ch: track.ch,
    tune: tuneId,
    midi: note.midi,
    vel: note.vel,
    ms: note.dur * perTick,
  };
  const duty = note.duty ?? track.duty;
  if (duty !== null) event.duty = duty;
  if (note.arp !== null && note.arpHz !== null) {
    event.arp = note.arp;
    event.arpHz = note.arpHz;
  }
  return event;
}

/**
 * Advance the needle by `dtMs` and return everything that started under it.
 *
 * @param tempoRatio the combo scaling, from `comboTempoRatio`
 */
export function advanceSequencer(
  state: SequencerState,
  tune: Tune,
  dtMs: number,
  tempoRatio: number,
): SequencerStep {
  const settled: SequencerState = { ...state, tempoRatio };
  if (!state.playing || !(dtMs > 0)) return { state: settled, events: [] };

  const perTick = msPerTick(tune.bpm, tune.ppq, tempoRatio);
  const events: SoundEvent[] = [];
  let pos = state.posTicks;
  let remaining = dtMs / perTick;
  let laps = 0;

  while (remaining > TICK_EPSILON && laps <= MAX_LAPS_PER_STEP) {
    const room = tune.loop - pos;
    const span = Math.min(remaining, room);
    for (const track of tune.tracks) collect(track, tune.id, pos, pos + span, perTick, events);
    pos += span;
    remaining -= span;
    if (tune.loop - pos <= TICK_EPSILON) {
      pos = 0;
      laps += 1;
    }
  }

  return { state: { posTicks: pos, playing: true, tempoRatio }, events };
}
