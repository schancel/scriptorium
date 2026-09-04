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
 * **On, and opened by the first keystroke.** `audio_default_on` is 1. It was 0,
 * on the argument that browsers block autoplay and a beginner does not need a
 * surprise fanfare -- and the result was ten transcribed tunes the owner never
 * heard, because the toggle in the corner was the only door in and he did not
 * find it. A keystroke is a user gesture, so the platform opens the context on
 * the player's first key: nothing plays before he has typed, and nothing stands
 * between him and the music once he has. See
 * docs/design/09-music.md#audio-is-on-and-starts-on-the-first-keystroke.
 *
 * **The theme owns the tune.** A scene change swaps the tune and rewinds it,
 * so entering the tomb starts the Passion Chorale at its beginning rather than
 * wherever the desert happened to have got to.
 *
 * **The combo drives the tempo.** The music accelerating under a clean run is
 * the whole reward mechanism -- see the design doc -- and `comboTempoRatio`
 * bounds it at `combo_tempo_max`. It also decides how hard the two *strike*
 * cues are struck, which is the only other thing in the audio the combo
 * touches: felling a monster on a long clean run should sound like it. Both are
 * bounded, and breaking a combo only ever returns them to base.
 */

import {
  advanceSequencer,
  comboForFullTempo,
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
  | 'stomp'
  | 'ink'
  | 'promotion'
  | 'warp';

/**
 * The two cues a felled monster rings, named after the verb that fells it.
 *
 * A skeleton is stomped and a bat is inked -- two verbs the player can see the
 * difference between (docs/design/03-pacing.md#defeating-a-monster-must-read-as-an-action),
 * and until this pair existed both rang one `defeat` cue, so the ear was told
 * the two were the same event. The cue id *is* `StrikeVerb`, so the platform
 * passes the verb straight through and there is no table in which a verb could
 * come to disagree with the noise it makes.
 */
export type StrikeCue = 'stomp' | 'ink';

/** Both of them, in the order the pacing doc's verb table lists the enemies. */
export const STRIKE_CUES: readonly StrikeCue[] = ['stomp', 'ink'];

const IS_STRIKE: ReadonlySet<string> = new Set<string>(STRIKE_CUES);

function isStrikeCue(cue: Cue): cue is StrikeCue {
  return IS_STRIKE.has(cue);
}

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
  // Weight landing: the heaviest of the three good-news voices at rest.
  stomp: 86,       // tuning-exempt: cue mix
  // Something small thrown: lighter than the boot, and it has further to carry.
  ink: 78,         // tuning-exempt: cue mix
  promotion: 112,  // tuning-exempt: cue mix
  warp: 90,        // tuning-exempt: cue mix
};

/**
 * How hard each strike cue rings at a full combo.
 *
 * The only cues whose weight is not fixed, and the only place the combo shows up
 * in the audio besides the tempo. A run of clean typing should be *audible* when
 * it lands a blow, and velocity is the cheapest honest way to say so: the same
 * voice, played harder. Neither ever falls below its own row in `CUE_VELOCITY`,
 * so losing a combo quietens nothing that was already sounding.
 *
 * Cue mix, like the table above: voice design rather than a difficulty knob, and
 * the one number a player would want to turn is `master_volume`.
 */
const STRIKE_VELOCITY_FULL: Readonly<Record<StrikeCue, number>> = {
  stomp: 120, // tuning-exempt: cue mix
  ink: 112,   // tuning-exempt: cue mix
};

// --- state ------------------------------------------------------------------

export interface AudioState {
  /** Whether sound is wanted at all; see `audio_default_on`. On by default. */
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
 * The opening state. On or off is read from the tuning table rather than
 * assumed, so what the game does about sound is one row in one document.
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

/**
 * How hard one cue is struck this frame.
 *
 * Every cue but the two strikes is a fixed weight. A strike is scaled by the
 * combo, between its own row and `STRIKE_VELOCITY_FULL`, at `comboForFullTempo`
 * -- the same milestone the tempo uses, so "a full combo" is one thing in this
 * game.
 */
function cueVelocity(cue: Cue, combo: number, tuning: Tuning): number {
  const base = CUE_VELOCITY[cue];
  if (!isStrikeCue(cue)) return base;
  const full = comboForFullTempo(tuning);
  const fraction = full > 0 ? Math.min(1, Math.max(0, combo / full)) : 1;
  return Math.round(base + fraction * (STRIKE_VELOCITY_FULL[cue] - base));
}

function cueEvents(cues: readonly Cue[], combo: number, tuning: Tuning): SoundEvent[] {
  return cues.map((cue): SoundEvent => ({ type: 'sfx', id: cue, vel: cueVelocity(cue, combo, tuning) }));
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
  events.push(...step.events, ...cueEvents(frame.cues, frame.combo, tuning));
  return { state: { ...base, seq: step.state }, events };
}
