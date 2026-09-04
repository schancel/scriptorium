/**
 * The frame, as sound. The audio half of `draw.ts`.
 *
 * @doc docs/design/09-music.md#music
 *
 * `stepSound` is to the speakers what `drawFrame` is to the canvas: it takes
 * what the game currently is, plus the milliseconds since last time, and
 * returns a flat array of `SoundEvent`s for the platform to execute. It makes
 * no noise, holds no `AudioContext`, and knows nothing about how a square wave
 * is produced. `platform/web/web_audio.ts` is the only file that does.
 *
 * Three decisions live here rather than in the platform, because all three are
 * about the game and not about the browser:
 *
 * **Muted until asked.** `audio_default_on` is 0. Browsers block autoplay, so
 * unmuted-by-default would be a promise the page cannot keep -- but the real
 * reason is the player. A beginner concentrating on finding the `j` key does
 * not need a surprise fanfare, and a tutor that startles him has already lost.
 *
 * **The theme owns the tune.** A scene change swaps the tune and rewinds it,
 * so entering the tomb starts the Passion Chorale at its beginning rather than
 * wherever the desert happened to have got to.
 *
 * **The combo drives the tempo, and nothing else does.** The music accelerating
 * under a clean run is the whole reward mechanism -- see the design doc -- and
 * `comboTempoRatio` bounds it at `combo_tempo_max`.
 */

import {
  advanceSequencer,
  comboTempoRatio,
  createSequencer,
  rewindSequencer,
  startSequencer,
  stopSequencer,
} from './sequencer.js';
import { tuneForTheme } from './tunes.js';
import { tuningValue } from './tuning.js';
import type { SequencerState } from './sequencer.js';
import type { ThemeTunes, Tune, TuneLibrary } from './tunes.js';
import type { SoundEvent, Tuning } from './types.js';

// --- cues -------------------------------------------------------------------

/**
 * The things that make a noise besides the music.
 *
 * Deliberately short, and deliberately without a per-keystroke click. A typing
 * tutor that clatters on every key trains the player to listen for the sound
 * instead of watching the rail, and the one thing the rail exists to do is hold
 * the eye still.
 */
export type Cue =
  | 'error'
  | 'smudge_full'
  | 'heart_lost'
  | 'cloud'
  | 'candle'
  | 'promotion'
  | 'warp';

/**
 * How loud each cue is, as a MIDI velocity. Voice design rather than a feel
 * knob, exactly as the envelopes in `synth.ts` are: these set the relative
 * weight of the vocabulary, and the one number a player would ever want to
 * turn -- overall loudness -- is `master_volume` and is a tuning row.
 */
const CUE_VELOCITY: Readonly<Record<Cue, number>> = {
  error: 70,       // tuning-exempt: cue mix
  smudge_full: 96, // tuning-exempt: cue mix
  heart_lost: 110, // tuning-exempt: cue mix
  cloud: 60,       // tuning-exempt: cue mix
  candle: 84,      // tuning-exempt: cue mix
  promotion: 112,  // tuning-exempt: cue mix
  warp: 90,        // tuning-exempt: cue mix
};

// --- state ------------------------------------------------------------------

export interface AudioState {
  /** False until the player asks for sound; see `audio_default_on`. */
  readonly on: boolean;
  /** The theme whose tune is loaded, so a change can be detected. */
  readonly theme: string;
  readonly tuneId: string | null;
  readonly seq: SequencerState;
}

/** Everything the audio needs to know about this frame. */
export interface SoundFrame {
  readonly theme: string;
  /** Consecutive correct keystrokes; drives the tempo. */
  readonly combo: number;
  /** Things that happened since the last step. */
  readonly cues: readonly Cue[];
}

/** The score, as the platform loaded it. */
export interface Songbook {
  readonly library: TuneLibrary;
  readonly themes: ThemeTunes;
}

export interface SoundStep {
  readonly state: AudioState;
  readonly events: readonly SoundEvent[];
}

/**
 * The opening state. Muted or not is read from the tuning table rather than
 * assumed, so the "starts muted" promise is one row in one document.
 */
export function createAudio(tuning: Tuning): AudioState {
  return {
    on: tuningValue(tuning, 'audio_default_on') === 1,
    theme: '',
    tuneId: null,
    seq: createSequencer(),
  };
}

/** Turn sound on or off. Turning it off stops the needle where it stands. */
export function setAudioOn(state: AudioState, on: boolean): AudioState {
  if (on === state.on) return state;
  return { ...state, on, seq: on ? state.seq : stopSequencer(state.seq) };
}

/** The output gain the platform should set. The one loudness knob there is. */
export function masterGain(tuning: Tuning): number {
  return tuningValue(tuning, 'master_volume');
}

// --- the step ---------------------------------------------------------------

function cueEvents(cues: readonly Cue[]): SoundEvent[] {
  return cues.map((cue): SoundEvent => ({ type: 'sfx', id: cue, vel: CUE_VELOCITY[cue] }));
}

/**
 * One frame of sound.
 *
 * Order within the returned array matters and is stable: a tempo change is
 * announced first, then the notes that fell under the needle, then the cues.
 * The platform may execute them in one pass without sorting.
 */
export function stepSound(
  state: AudioState,
  songbook: Songbook,
  frame: SoundFrame,
  dtMs: number,
  tuning: Tuning,
): SoundStep {
  const tune: Tune | null = tuneForTheme(songbook.library, songbook.themes, frame.theme);
  const tuneId = tune === null ? null : tune.id;

  // A new theme starts its tune from the top rather than mid-phrase.
  const changed = tuneId !== state.tuneId;
  const base: AudioState = changed
    ? { ...state, theme: frame.theme, tuneId, seq: rewindSequencer(state.seq) }
    : { ...state, theme: frame.theme };

  if (!base.on || tune === null) {
    return { state: { ...base, seq: stopSequencer(base.seq) }, events: [] };
  }

  const ratio = comboTempoRatio(frame.combo, tuning);
  const events: SoundEvent[] = [];
  if (ratio !== base.seq.tempoRatio) events.push({ type: 'tempo', ratio });

  const step = advanceSequencer(startSequencer(base.seq), tune, dtMs, ratio);
  events.push(...step.events, ...cueEvents(frame.cues));
  return { state: { ...base, seq: step.state }, events };
}
