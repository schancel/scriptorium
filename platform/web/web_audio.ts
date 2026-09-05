/**
 * Executes sound events on the Web Audio API.
 *
 * The other half of core/sound.ts, and the only file in the repository allowed
 * to touch an `AudioContext`. Everything here is throw-away in a port: it turns
 * MIDI note numbers into hertz, envelopes into gain automation, and duty cycles
 * into periodic waves, and it knows nothing else. There is no musical decision
 * in this file and none may be added -- if a choice about *what* sounds appears
 * here, it belongs in core/sound.ts or in a tune file.
 *
 * Two things it must get right, both of which are about the browser rather than
 * the music:
 *
 * **Nothing exists before a gesture.** No `AudioContext` is constructed until
 * `start()` is called, and `start()` must be called from inside a click or a
 * keypress. Every browser blocks autoplay; one constructed at load sits
 * suspended and the first note is swallowed, which reads as "the sound is
 * broken" rather than "the sound is blocked".
 *
 * **Voices are monophonic per channel, per machine.** The 2A03 has one
 * oscillator per channel, so a new note cuts the one before it. That is
 * emulation, not economy: polyphonic pulse channels would quietly dissolve the
 * constraint the whole arrangement style is built on, and the tunes would stop
 * sounding like the machine they are written for.
 *
 * *Per machine* is the one qualification, and it is what a crossfade costs. A
 * tune change fades one tune into another over a scene boundary
 * (docs/design/09-music.md#two-machines-for-the-width-of-a-boundary), so for the
 * width of that boundary two sequencers are running -- and each gets its own
 * four voices and its own gain node, keyed on the tune id the note carries. One
 * shared set of channels would have the two tunes cutting each other off at
 * every note, which is precisely the mid-phrase chop the crossfade exists to
 * avoid. A cue is not on either machine: it rings straight into the master gain,
 * unfaded, and it still takes the channel it rings on away from both of them,
 * because that part *is* the hardware being honest.
 */

import { masterGain, type Cue } from '../../core/sound.js';
import {
  envelopeFor,
  expandArp,
  isPulse,
  midiToHz,
  nearestDuty,
  noiseVoice,
  timbreForMidi,
  type Channel,
  type Envelope,
} from '../../core/synth.js';
import type { SoundEvent, Tuning } from '../../core/types.js';

const MS_PER_SECOND = 1000;

/** Harmonics in a synthesised pulse wave. Enough for the edge, few enough to alias little. */
const PULSE_PARTIALS = 48;

/** Seconds of white noise to loop for percussion. */
const NOISE_SECONDS = 2;

/** Scheduling slack, in seconds: never ask the clock for a time already past. */
const LOOKAHEAD = 0.012;

/** Extra seconds a node is kept alive past its release, so it is never cut mid-ramp. */
const TAIL = 0.05;

/**
 * Seconds a fader takes to reach a gain it has been given.
 *
 * A de-click, not a fade. The crossfade itself is driven by how far through the
 * passage the player has typed and arrives here as a stream of small steps; this
 * only stops each of those steps being a discontinuity in the waveform. It is
 * the same kind of number as `LOOKAHEAD` above -- about the audio clock, not
 * about the music -- and nothing a player could feel is decided by it.
 */
const MIX_RAMP = 0.02;

/**
 * The slot the cues sound on: not a tune, so no fader touches it.
 *
 * A defeat, a candle and a stomp are not music. They are struck at the weight
 * `core/sound.ts` gives them wherever they fall, including halfway across a
 * boundary. See docs/design/09-music.md#two-machines-for-the-width-of-a-boundary.
 */
const CUE_SLOT = '';

/** A short-lived note in flight on one channel. */
interface Voice {
  readonly source: AudioScheduledSourceNode;
  readonly gain: GainNode;
}

/**
 * A cue's realisation, in the same spirit as the renderer's font table: core
 * says an error happened, and this file decides what an error sounds like.
 */
interface CueVoice {
  readonly ch: Channel;
  readonly midi: number;
  readonly ms: number;
  readonly duty?: number;
  readonly arp?: readonly number[];
  readonly arpHz?: number;
}

/**
 * One voice per cue, and the compiler holds it to that.
 *
 * `Record<Cue, ...>` over core's own union rather than `Record<string, ...>`:
 * `playCue` ignores an id it has no entry for, so a cue added to core and not to
 * this table would fire silently for ever and nobody would learn it was missing
 * -- the same failure shape as a silent data fallback
 * (docs/decisions/0009-fallbacks-must-announce-themselves.md). Typed this way,
 * half the change does not compile.
 */
const CUES: Readonly<Record<Cue, CueVoice>> = {
  error: { ch: 'noise', midi: 38, ms: 90 },
  smudge_full: { ch: 'noise', midi: 49, ms: 500 },
  heart_lost: { ch: 'pulse2', midi: 55, ms: 380, duty: 0.5, arp: [0, -5, -12], arpHz: 12 },
  cloud: { ch: 'noise', midi: 42, ms: 140 },
  candle: { ch: 'pulse1', midi: 76, ms: 260, duty: 0.125, arp: [0, 5, 9], arpHz: 14 },
  // The two strikes. Both are arpeggiated pulse voices, like the candle above
  // them and like the single `defeat` cue they replace, so felling a monster
  // still belongs to the same family of good news -- but they are no longer the
  // same noise, because they are no longer the same thing to watch.
  //
  // A stomp is weight landing. Low, on the candle's own channel and two octaves
  // and a fourth below it, at 50% duty -- the full, hollow square, which is the
  // heaviest timbre the chip has. Its arp *descends*, and at 15 Hz over 200 ms
  // it makes exactly one pass: E4 to A3 to A2, then sits on the root for the
  // last third of the note. That final held root is the landing; a faster cycle
  // would buzz as a chord and the boot would never come down.
  stomp: { ch: 'pulse1', midi: 45, ms: 200, duty: 0.5, arp: [19, 12, 0], arpHz: 15 },
  // An ink nib is thrown and bursts. High and thin -- 12.5% duty, the nasal
  // square, which is what a small hard object sounds like on this hardware --
  // and on `pulse2`, so a stomp and a throw landing on the same keystroke are
  // both heard instead of one cutting the other off the single melody voice.
  // Six steps at 33 Hz fill its 180 ms exactly once: a fourth-stacked climb
  // through +27 is the arc, and the drop back to +21 on the last step is the
  // burst, spreading rather than continuing to rise.
  ink: { ch: 'pulse2', midi: 67, ms: 180, duty: 0.125, arp: [0, 7, 14, 21, 27, 21], arpHz: 33 },
  promotion: { ch: 'pulse1', midi: 72, ms: 620, duty: 0.25, arp: [0, 4, 7, 12], arpHz: 11 },
  warp: { ch: 'pulse2', midi: 60, ms: 700, duty: 0.5, arp: [0, 6, 12, 18], arpHz: 18 },
};

/**
 * What the audio device actually is, as opposed to what the setting says.
 *
 * The sound control used to report `audio.on` -- the *intent* -- and the owner
 * found the gap the only way anyone ever finds it: *"it says 'on' for sound, but
 * no sound."* A stubbed `AudioContext` in the smoke harness cannot prove a
 * browser made a noise, so the control asserted a state nobody had verified,
 * which is the failure
 * docs/decisions/0009-fallbacks-must-announce-themselves.md exists to prevent.
 *
 * So the device is asked, and every field here is a fact read off it at the
 * moment it is asked for -- never a memory of what we did to it. Between them
 * they answer the question we have twice had to guess at: whether a silent
 * machine has no context, a context the browser will not run, or a running
 * context nothing has been sent to.
 */
export interface AudioReport {
  /** The context's own `state`, verbatim. `'none'` when none has been made. */
  readonly state: string;
  /** How many contexts this session has constructed. Never grows without a gesture. */
  readonly contexts: number;
  /** Notes and cues handed to the device. Zero with a running context is the tell. */
  readonly notesScheduled: number;
  /** The device's sample rate, or 0 when there is no device. */
  readonly sampleRate: number;
  /** What the last `start()` threw, or `''` if none has thrown. */
  readonly lastError: string;
  /**
   * What is audible, loudest first: the gain each tune's fader is actually at,
   * read off the node rather than remembered.
   *
   * The fourth silent-machine question, after "is there a device", "will it run"
   * and "has anything been sent to it": *is any of it turned up?* A running
   * context taking notes with every fader at zero is a real state and it sounds
   * exactly like a broken songbook, so the diagnostic says so rather than
   * leaving it to be inferred. Two entries means a crossfade is in progress.
   */
  readonly music: readonly PlayingTune[];
}

/** One tune the device is sounding, and the gain its fader stands at. */
export interface PlayingTune {
  readonly tune: string;
  readonly gain: number;
}

export interface WebAudio {
  /** True once a context exists and is running. */
  isRunning(): boolean;
  /** Construct and resume the context. Must be called from a user gesture. */
  start(): Promise<void>;
  /** Silence everything and release the context. */
  stop(): Promise<void>;
  /** Execute one frame of events from `core/sound.ts`. */
  play(events: readonly SoundEvent[]): void;
  /** The most recent tempo ratio announced by the core, for diagnostics. */
  tempoRatio(): number;
  /** The device as it actually is, for the control and for the menu's diagnostic. */
  report(): AudioReport;
  /**
   * Register a listener for the browser's own `statechange` on the context.
   *
   * The browser suspends and resumes contexts on its own -- a backgrounded tab,
   * an autoplay policy relenting -- and `statechange` is its own signal that it
   * has. More reliable than polling and, unlike polling, it fires on the frame
   * it happens, so the control never sits reading `on` at a device that stopped
   * a second ago.
   */
  onStateChange(listener: () => void): void;
}

export function createWebAudio(tuning: Tuning): WebAudio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let ratio = 1;
  // The diagnostic's three counters. Nothing reads them but `report`, and
  // nothing decides anything by them: they exist so the game can answer "why is
  // this machine silent" instead of us guessing at it a third time.
  let contexts = 0;
  let notesScheduled = 0;
  let lastError = '';
  const stateListeners: (() => void)[] = [];

  function announceState(): void {
    for (const listener of stateListeners) listener();
  }

  const waves = new Map<number, PeriodicWave>();
  /**
   * What is sounding, keyed by machine *and* channel.
   *
   * The slot is the tune id for a note and `CUE_SLOT` for a cue, so two tunes
   * crossfading do not share a pulse channel and cut each other to pieces.
   */
  const voices = new Map<string, Voice>();
  /** One fader per sounding tune, between its notes and the master gain. */
  const layers = new Map<string, GainNode>();
  /**
   * The gain each tune was last given, kept across a context being closed and
   * reopened.
   *
   * `core/sound.ts` announces a gain when it *changes*, so a device rebuilt in
   * the middle of a settled passage would otherwise have to guess -- and a fader
   * that guessed zero would be a silent game with every other diagnostic green.
   * A tune nobody has announced yet is full, for the same reason: an unheard
   * announcement must fail loud rather than silent.
   * See docs/decisions/0009-fallbacks-must-announce-themselves.md.
   */
  const mixLevels = new Map<string, number>();

  /**
   * A pulse wave of the given duty, as a Fourier series.
   *
   * The nth cosine coefficient of a duty-`d` square is `2 sin(n pi d) / (n pi)`.
   * Built once per duty and cached: `createPeriodicWave` is not cheap, and a
   * tune switching duty mid-phrase asks for the same three waves for ever.
   */
  function pulseWave(context: AudioContext, duty: number): PeriodicWave {
    const snapped = nearestDuty(duty);
    const cached = waves.get(snapped);
    if (cached !== undefined) return cached;
    const real = new Float32Array(PULSE_PARTIALS + 1);
    const imag = new Float32Array(PULSE_PARTIALS + 1);
    for (let n = 1; n <= PULSE_PARTIALS; n += 1) {
      real[n] = (2 * Math.sin(n * Math.PI * snapped)) / (n * Math.PI);
    }
    const wave = context.createPeriodicWave(real, imag, { disableNormalization: false });
    waves.set(snapped, wave);
    return wave;
  }

  function whiteNoise(context: AudioContext): AudioBuffer {
    if (noiseBuffer !== null) return noiseBuffer;
    const frames = Math.floor(context.sampleRate * NOISE_SECONDS);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    noiseBuffer = buffer;
    return buffer;
  }

  /** Which voice a machine's channel is: one slot, one channel, one oscillator. */
  function voiceKey(slot: string, ch: Channel): string {
    return `${slot}:${ch}`;
  }

  /** Cut whatever this machine was sounding on this channel. */
  function release(slot: string, ch: Channel, at: number): void {
    const key = voiceKey(slot, ch);
    const voice = voices.get(key);
    if (voice === undefined) return;
    voices.delete(key);
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(Math.max(gain.value, 0), at);
    gain.linearRampToValueAtTime(0, at + TAIL);
    voice.source.stop(at + TAIL + TAIL);
  }

  /**
   * Cut this channel everywhere -- every machine, and the cues.
   *
   * What a cue does, and the one place the old single-machine behaviour has to
   * be preserved deliberately: on the hardware there is one pulse channel, and
   * a candle interrupting the melody is that being true. A cue that only cut
   * *one* of two crossfading tunes would be half-audible over the other.
   */
  function releaseChannel(ch: Channel, at: number): void {
    for (const slot of [...layers.keys(), CUE_SLOT]) release(slot, ch, at);
  }

  /**
   * The fader for one tune, made on demand and connected to the master gain.
   *
   * Bounded by the songbook: at most one node per tune the game has played this
   * sitting, and only ever two of them above zero at once.
   */
  function layerFor(context: AudioContext, out: GainNode, tune: string): GainNode {
    const found = layers.get(tune);
    if (found !== undefined) return found;
    const node = context.createGain();
    node.gain.value = mixLevels.get(tune) ?? 1;
    node.connect(out);
    layers.set(tune, node);
    return node;
  }

  /** Move one tune's fader to the gain core says it should be at. */
  function setMix(tune: string, gain: number): void {
    mixLevels.set(tune, gain);
    const context = ctx;
    const out = master;
    if (context === null || out === null) return;
    const param = layerFor(context, out, tune).gain;
    const at = context.currentTime + LOOKAHEAD;
    param.cancelScheduledValues(at);
    param.setValueAtTime(param.value, at);
    param.linearRampToValueAtTime(gain, at + MIX_RAMP);
  }

  /** Write an ADSR onto a gain node for a note of `seconds` starting at `at`. */
  function shape(param: AudioParam, env: Envelope, at: number, seconds: number): number {
    const attack = env.attackMs / MS_PER_SECOND;
    const decay = env.decayMs / MS_PER_SECOND;
    const releaseAt = at + Math.max(seconds, attack);
    param.setValueAtTime(0, at);
    param.linearRampToValueAtTime(env.peak, at + attack);
    if (decay > 0) {
      param.linearRampToValueAtTime(env.peak * env.sustain, Math.min(at + attack + decay, releaseAt));
    }
    param.linearRampToValueAtTime(0, releaseAt + env.releaseMs / MS_PER_SECOND);
    return releaseAt + env.releaseMs / MS_PER_SECOND;
  }

  function playNote(
    slot: string,
    ch: Channel,
    midi: number,
    vel: number,
    ms: number,
    duty: number | undefined,
    arp: readonly number[] | undefined,
    arpHz: number | undefined,
  ): void {
    const context = ctx;
    const masterOut = master;
    if (context === null || masterOut === null) return;

    const at = context.currentTime + LOOKAHEAD;
    // A cue takes the channel from everything; a tune takes it from itself and
    // from whatever cue was ringing on it, and leaves the other machine alone.
    if (slot === CUE_SLOT) {
      releaseChannel(ch, at);
    } else {
      release(slot, ch, at);
      release(CUE_SLOT, ch, at);
    }
    const out = slot === CUE_SLOT ? masterOut : layerFor(context, masterOut, slot);

    const seconds = Math.max(ms, 0) / MS_PER_SECOND;
    const gain = context.createGain();
    let source: AudioScheduledSourceNode;

    if (ch === 'noise') {
      const timbre = timbreForMidi(midi);
      const voice = noiseVoice(timbre);
      const noise = context.createBufferSource();
      noise.buffer = whiteNoise(context);
      noise.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = voice.mode;
      filter.frequency.value = voice.cutoffHz;
      filter.Q.value = voice.q;
      noise.connect(filter).connect(gain);
      source = noise;
    } else {
      const osc = context.createOscillator();
      if (isPulse(ch)) {
        osc.setPeriodicWave(pulseWave(context, duty ?? nearestDuty(0.5)));
      } else {
        osc.type = 'triangle';
      }
      // The arpeggio, made audible: one oscillator stepping through the chord.
      // Scheduled ahead as a block, because a 60 Hz figure driven a frame at a
      // time would land on the display's clock and audibly stagger.
      const steps = expandArp(midi, arp, arpHz, ms);
      for (const step of steps) {
        osc.frequency.setValueAtTime(midiToHz(step.midi), at + step.atMs / MS_PER_SECOND);
      }
      osc.connect(gain);
      source = osc;
    }

    notesScheduled += 1;
    const env = envelopeFor(ch, vel, ch === 'noise' ? timbreForMidi(midi) : undefined);
    const endsAt = shape(gain.gain, env, at, seconds);
    gain.connect(out);
    source.start(at);
    source.stop(endsAt + TAIL);
    voices.set(voiceKey(slot, ch), { source, gain });
  }

  function playCue(id: string, vel: number | undefined): void {
    // The id arrives off a `SoundEvent`, which is a string by contract, so the
    // lookup is widened here rather than the table being widened above.
    const cue: CueVoice | undefined = (CUES as Partial<Record<string, CueVoice>>)[id];
    if (cue === undefined) return;
    playNote(CUE_SLOT, cue.ch, cue.midi, vel ?? 100, cue.ms, cue.duty, cue.arp, cue.arpHz);
  }

  return {
    isRunning(): boolean {
      return ctx !== null && ctx.state === 'running';
    },

    async start(): Promise<void> {
      if (ctx === null) {
        const context = new AudioContext();
        const gain = context.createGain();
        gain.gain.value = masterGain(tuning);
        gain.connect(context.destination);
        // The browser's own signal that it has suspended or resumed the device
        // behind our back, which is exactly the thing the control has to know
        // and the thing a poll finds out late. Assigned rather than added as a
        // listener so releasing the context releases it too.
        context.onstatechange = (): void => {
          announceState();
        };
        ctx = context;
        master = gain;
        contexts += 1;
      }
      try {
        await ctx.resume();
        lastError = '';
      } catch (error) {
        // Recorded, not swallowed. A refused resume is the commonest reason a
        // machine is silent with the toggle reading on, and until now the only
        // trace it left was in a console nobody playing a game has open.
        lastError = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        announceState();
      }
    },

    async stop(): Promise<void> {
      const context = ctx;
      if (context === null) return;
      for (const key of [...voices.keys()]) {
        const voice = voices.get(key);
        voices.delete(key);
        voice?.source.stop(context.currentTime);
      }
      voices.clear();
      // The faders go with the context they were built in; the *levels* do not,
      // so a device reopened mid-passage comes back at the mix it was at.
      layers.clear();
      waves.clear();
      noiseBuffer = null;
      ctx = null;
      master = null;
      context.onstatechange = null;
      await context.close();
      announceState();
    },

    play(events: readonly SoundEvent[]): void {
      if (ctx === null || ctx.state !== 'running') return;
      for (const event of events) {
        if (event.type === 'note') {
          playNote(
            event.tune, event.ch, event.midi, event.vel, event.ms,
            event.duty, event.arp, event.arpHz,
          );
        } else if (event.type === 'sfx') {
          playCue(event.id, event.vel);
        } else if (event.type === 'mix') {
          setMix(event.tune, event.gain);
        } else {
          ratio = event.ratio;
        }
      }
    },

    tempoRatio(): number {
      return ratio;
    },

    report(): AudioReport {
      const music = [...layers.entries()]
        .map(([tune, node]): PlayingTune => ({ tune, gain: node.gain.value }))
        .filter((playing) => playing.gain > 0)
        .sort((a, b) => b.gain - a.gain);
      return {
        state: ctx === null ? 'none' : ctx.state,
        contexts,
        notesScheduled,
        sampleRate: ctx === null ? 0 : ctx.sampleRate,
        lastError,
        music,
      };
    },

    onStateChange(listener: () => void): void {
      stateListeners.push(listener);
    },
  };
}
