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
 * **The theme owns the tune, and the scenery owns the theme.** The picture is
 * resolved per verse, so the music is too -- and a tune change *crossfades*
 * rather than restarting, which is what makes that affordable: two sequencers
 * run across a boundary, one falling and one rising, over the same window the
 * palette eases across. The falling tune plays on from where it is; the rising
 * one starts at its own beginning; and the two gains sum to one, so a boundary
 * is never louder or quieter than a settled scene and two tunes at full gain
 * cannot happen. It is driven by `blend.mix` -- the verse under the cursor and
 * how far through it the player has typed -- and so, like everything else here,
 * it does not move while the player is thinking.
 * See docs/design/09-music.md#the-music-follows-the-scenery.
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

/**
 * One tune sounding: its own needle, and how loud it is in the mix.
 *
 * There are two of these only across a scene boundary, and one everywhere else.
 * The pair is the whole of the crossfade: a voice is *held* for as long as its
 * tune is wanted, so the falling tune keeps its place in the phrase, and a tune
 * nobody wants any more is dropped -- which is why a tune that comes back later
 * comes back at its beginning rather than in the middle of the bar it was in
 * when the player last stood somewhere it played.
 */
export interface AudioVoice {
  readonly tuneId: string;
  /**
   * 0..1. Where there are two, the pair sums to exactly 1: the scene under the
   * cursor plays at `1 - mix` and the one over the boundary at `mix`. So the
   * boundary is no louder and no quieter than a settled scene, and two tunes at
   * full gain is not a state this record can hold.
   */
  readonly gain: number;
  readonly seq: SequencerState;
}

export interface AudioState {
  /** Whether sound is wanted at all; see `audio_default_on`. On by default. */
  readonly on: boolean;
  /** What is sounding. At most two: the tune being left and the tune arriving. */
  readonly voices: readonly AudioVoice[];
  /** The tempo multiplier in force, so a change is announced once. */
  readonly tempoRatio: number;
}

/** Everything the audio needs to know about this frame. */
export interface SoundFrame {
  readonly theme: string;
  /**
   * The scene over the nearest boundary, and how far the crossfade has run.
   *
   * The same two numbers the palette is eased with, handed over rather than
   * re-derived, so the picture and the music cross at the same instant and by
   * the same arithmetic. `mix` is 0 at a settled scene and 0.5 at the boundary
   * itself; it is a function of the verse under the cursor and how far through
   * it the player has typed, and of nothing else -- so an idle frame moves the
   * mix by exactly nothing.
   * See docs/design/05-scenery-warps.md#between-two-scenes-the-palette-moves-and-the-tiles-cut.
   */
  readonly blend?: {
    readonly theme: string;
    readonly mix: number;
  };
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
    voices: [],
    tempoRatio: 1,
  };
}

/** Turn sound on or off. Turning it off stops every needle where it stands. */
export function setAudioOn(state: AudioState, on: boolean): AudioState {
  if (on === state.on) return state;
  if (on) return { ...state, on };
  return { ...state, on, voices: state.voices.map((v) => ({ ...v, seq: stopSequencer(v.seq) })) };
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

/** The midpoint of a range, which is as far as a crossfade ever travels. */
const HALF = 0.5; // tuning-exempt: the midpoint of a range, not a knob

/** A tune that should be sounding this frame, and how loud. */
interface Wanted {
  readonly tune: Tune;
  readonly gain: number;
}

/**
 * What the mix should be, from where the player is standing.
 *
 * At most two, and **exactly** two only when the scene under the cursor and the
 * scene over the nearest boundary have different tunes and the crossfade has
 * actually begun. `blend` already resolves overlapping windows to the nearest
 * boundary, which is what makes a third voice impossible here rather than
 * something this function has to guard against: it is handed one boundary, so it
 * can only ever name two tunes.
 *
 * Two themes sharing a tune -- which the songbook allows and has done before --
 * is one voice at full gain rather than two at half, because the tune is not
 * changing and there is nothing to fade.
 */
function wantedVoices(songbook: Songbook, frame: SoundFrame): readonly Wanted[] {
  const here = tuneForTheme(songbook.library, songbook.themes, frame.theme);
  const blend = frame.blend;
  const mix = blend === undefined ? 0 : Math.min(HALF, Math.max(0, blend.mix));
  const other = blend === undefined || mix <= 0
    ? null
    : tuneForTheme(songbook.library, songbook.themes, blend.theme);
  // A theme whose tune is missing is silent rather than fatal, on either side --
  // and a crossing into one is a fade toward silence rather than a cut to it,
  // which is the same sentence the rest of this function is written in.
  if (here === null) return other === null ? [] : [{ tune: other, gain: mix }];
  if (other === null) return [{ tune: here, gain: 1 - mix }];
  if (other.id === here.id) return [{ tune: here, gain: 1 }];
  return [{ tune: here, gain: 1 - mix }, { tune: other, gain: mix }];
}

/**
 * One frame of sound.
 *
 * Order within the returned array matters and is stable: a tempo change first,
 * then every fader that moved, then the notes that fell under the needles, then
 * the cues. The faders precede the notes so that a tune's gain is set before the
 * first note that goes through it; the cues come last and pass through no fader
 * at all. The platform may execute the array in one pass without sorting.
 *
 * Muted, this still runs and still returns nothing: the needles are stopped
 * where they stand rather than being abandoned, so the toggle is a pause and not
 * a reset.
 */
export function stepSound(
  state: AudioState,
  songbook: Songbook,
  frame: SoundFrame,
  dtMs: number,
  tuning: Tuning,
): SoundStep {
  if (!state.on) {
    const stopped = state.voices.map((voice) => ({ ...voice, seq: stopSequencer(voice.seq) }));
    return { state: { ...state, voices: stopped }, events: [] };
  }

  const wanted = wantedVoices(songbook, frame);
  const ratio = comboTempoRatio(frame.combo, tuning);
  const events: SoundEvent[] = [];
  if (ratio !== state.tempoRatio) events.push({ type: 'tempo', ratio });

  // A tune nobody wants any more is faded out rather than dropped mid-note: the
  // platform is holding a gain node for it, and a level change that simply
  // stopped sending notes would leave whatever was sounding hanging at full.
  for (const gone of state.voices) {
    if (gone.gain > 0 && !wanted.some((want) => want.tune.id === gone.tuneId)) {
      events.push({ type: 'mix', tune: gone.tuneId, gain: 0 });
    }
  }
  for (const want of wanted) {
    const held = state.voices.find((voice) => voice.tuneId === want.tune.id);
    // Announced when it changes and not otherwise, exactly as the tempo is --
    // which is also what makes "an idle frame does not move the mix" a property
    // anybody can see: an idle frame emits no mix event at all.
    if (held === undefined || held.gain !== want.gain) {
      events.push({ type: 'mix', tune: want.tune.id, gain: want.gain });
    }
  }

  const voices: AudioVoice[] = [];
  for (const want of wanted) {
    const held = state.voices.find((voice) => voice.tuneId === want.tune.id);
    // A held voice keeps its needle; an arriving one gets a fresh one, which is
    // at the top of its tune. Each has its own state, so each crosses its own
    // loop seam without the other's tempo or loop length reaching it.
    const seq = startSequencer(held?.seq ?? createSequencer());
    const step = advanceSequencer(seq, want.tune, dtMs, ratio);
    events.push(...step.events);
    voices.push({ tuneId: want.tune.id, gain: want.gain, seq: step.state });
  }

  events.push(...cueEvents(frame.cues, frame.combo, tuning));
  return { state: { on: true, voices, tempoRatio: ratio }, events };
}
