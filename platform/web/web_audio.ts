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
 * **Voices are monophonic per channel.** The 2A03 has one oscillator per
 * channel, so a new note cuts the one before it. That is emulation, not
 * economy: polyphonic pulse channels would quietly dissolve the constraint the
 * whole arrangement style is built on, and the tunes would stop sounding like
 * the machine they are written for.
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
  const voices = new Map<Channel, Voice>();

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

  /** Cut whatever this channel was sounding; the hardware has one voice each. */
  function release(ch: Channel, at: number): void {
    const voice = voices.get(ch);
    if (voice === undefined) return;
    voices.delete(ch);
    const gain = voice.gain.gain;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(Math.max(gain.value, 0), at);
    gain.linearRampToValueAtTime(0, at + TAIL);
    voice.source.stop(at + TAIL + TAIL);
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
    ch: Channel,
    midi: number,
    vel: number,
    ms: number,
    duty: number | undefined,
    arp: readonly number[] | undefined,
    arpHz: number | undefined,
  ): void {
    const context = ctx;
    const out = master;
    if (context === null || out === null) return;

    const at = context.currentTime + LOOKAHEAD;
    release(ch, at);

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
    voices.set(ch, { source, gain });
  }

  function playCue(id: string, vel: number | undefined): void {
    // The id arrives off a `SoundEvent`, which is a string by contract, so the
    // lookup is widened here rather than the table being widened above.
    const cue: CueVoice | undefined = (CUES as Partial<Record<string, CueVoice>>)[id];
    if (cue === undefined) return;
    playNote(cue.ch, cue.midi, vel ?? 100, cue.ms, cue.duty, cue.arp, cue.arpHz);
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
      for (const ch of [...voices.keys()]) release(ch, context.currentTime);
      voices.clear();
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
          playNote(event.ch, event.midi, event.vel, event.ms, event.duty, event.arp, event.arpHz);
        } else if (event.type === 'sfx') {
          playCue(event.id, event.vel);
        } else {
          ratio = event.ratio;
        }
      }
    },

    tempoRatio(): number {
      return ratio;
    },

    report(): AudioReport {
      return {
        state: ctx === null ? 'none' : ctx.state,
        contexts,
        notesScheduled,
        sampleRate: ctx === null ? 0 : ctx.sampleRate,
        lastError,
      };
    },

    onStateChange(listener: () => void): void {
      stateListeners.push(listener);
    },
  };
}
