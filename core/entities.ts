/**
 * The scribe, the monsters that never advance, and the blot-cloud.
 *
 * @doc docs/design/03-pacing.md#the-threat-is-idleness-not-slowness
 *
 * Two rules govern this whole module, and both are load-bearing enough to have
 * their own ADR.
 *
 * **Monsters idle.** A bat bobs, a skeleton rattles, and neither moves one pixel
 * closer to the player however long the player takes. Every animation here is a
 * pure function of accumulated `phaseMs`, so nothing in it *can* express "closer
 * over time" -- there is no velocity field to set. That is deliberate: the
 * player this game is for types at 8-15 WPM, and anything that closes on a clock
 * fails him during precisely the fortnight he is most likely to quit.
 * See docs/decisions/0004-idle-threat-not-speed-timer.md.
 *
 * **The threat is silence, not slowness.** The blot-cloud is the only pressure
 * in the game. It watches one number -- how long since the last *correct*
 * keystroke -- and nothing else. Five seconds of deliberation over a single key
 * is free at every stage the beginner will see. Stopping to hunt the keyboard is
 * not, and that is the entire mechanic: it punishes the one behaviour the game
 * exists to eliminate, and nothing else. There is no other failure on a timer
 * anywhere in `core/`, and adding one would be a regression however natural it
 * feels.
 *
 * A wrong keystroke does not drive the cloud back. That is not an oversight
 * either: mashing keys while hunting for the right one is the behaviour, and a
 * cloud that a wrong key placated would reward it.
 */

import { tuningValue } from './tuning.js';
import type { CloudState, Tuning } from './types.js';

// --- animation cadence ------------------------------------------------------

/**
 * Frame durations and idle amplitudes.
 *
 * `tuning-exempt`, on the same grounds as the band composition in
 * `core/draw.ts`: these are properties of the *art*, not of the difficulty. How
 * fast a bat's wings beat is a drawing decision with no effect on whether the
 * player can keep up, and a row in docs/design/07-tuning.md would invite someone
 * to turn it expecting the game to get easier.
 *
 * Anything that changes what the player must *do* -- the idle threshold, the
 * telegraph, the smudge a strike deals -- is read from `tuning` below, as it
 * must be.
 */
const ANIM = {
  scribeIdleMs: 520,   // tuning-exempt: animation cadence, art not difficulty
  scribeWalkMs: 120,   // tuning-exempt: animation cadence, art not difficulty
  scribeBobMs: 2400,   // tuning-exempt: animation cadence, art not difficulty
  batFlapMs: 150,      // tuning-exempt: animation cadence, art not difficulty
  batBobMs: 900,       // tuning-exempt: animation cadence, art not difficulty
  skeletonRattleMs: 380, // tuning-exempt: animation cadence, art not difficulty
  skeletonBobMs: 1500, // tuning-exempt: animation cadence, art not difficulty
  cloudDriftMs: 700,   // tuning-exempt: animation cadence, art not difficulty
} as const;

/** Idle bob amplitude, in virtual pixels. Two, so it reads without wobbling. */
const BOB_PX = 2;

const TAU = Math.PI * 2;

// --- entities ---------------------------------------------------------------

export type EntityKind = 'scribe' | 'bat' | 'skeleton';

/**
 * One thing standing in the level.
 *
 * `x` and `y` are set when the entity is placed and are never touched by
 * `stepEntity`. The only state that advances is `phaseMs`, which is what makes
 * "monsters do not approach" a property of the type rather than of anyone's
 * discipline.
 */
export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  /** Virtual pixels; the entity's home, which it never leaves. */
  readonly x: number;
  readonly y: number;
  /** Accumulated animation time. The only thing `stepEntity` changes. */
  readonly phaseMs: number;
  /** -1 faces left, 1 faces right. Fixed at placement. */
  readonly facing: number;
}

/**
 * Place an entity.
 *
 * `phaseOffsetMs` staggers a row of bats so they do not beat in lockstep. It is
 * an authored offset rather than a random one, because randomness in `core/`
 * must come from the injected PRNG and a level's decoration does not deserve a
 * draw from it -- see docs/architecture/core-purity.md.
 */
export function createEntity(
  id: string,
  kind: EntityKind,
  x: number,
  y: number,
  phaseOffsetMs = 0,
  facing = 1,
): Entity {
  return { id, kind, x, y, phaseMs: phaseOffsetMs, facing };
}

/**
 * Advance one entity's animation clock.
 *
 * Note what is *not* here: no movement, no pursuit, no timer that eventually
 * costs the player something. An entity's position is exactly where it was
 * placed, for ever.
 */
export function stepEntity(entity: Entity, dtMs: number): Entity {
  return { ...entity, phaseMs: entity.phaseMs + dtMs };
}

/** Advance a whole level's worth. */
export function stepEntities(entities: readonly Entity[], dtMs: number): Entity[] {
  return entities.map((e) => stepEntity(e, dtMs));
}

/** What to draw for an entity this frame. A projection, never stored. */
export interface EntityPose {
  readonly spriteId: string;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly flip: boolean;
}

/**
 * Which frame of a cycle `elapsedMs` lands on. Pure, total, and monotonic in
 * time, which is what makes the animation replayable from a `dtMs` trace.
 */
export function frameAt(elapsedMs: number, frameMs: number, frameCount: number): number {
  if (frameCount <= 0 || frameMs <= 0) return 0;
  const frame = Math.floor(elapsedMs / frameMs) % frameCount;
  return frame < 0 ? frame + frameCount : frame;
}

/**
 * A whole-pixel vertical bob. Rounded, because a sprite drawn at a fractional y
 * on a chunky pixel grid shimmers instead of bobbing.
 */
export function bobOffset(elapsedMs: number, periodMs: number, amplitudePx: number): number {
  if (periodMs <= 0) return 0;
  return Math.round(Math.sin((elapsedMs / periodMs) * TAU) * amplitudePx);
}

/** Frame counts, as the sheet in `core/sprites.ts` holds them. */
const FRAMES = {
  scribeIdle: 2,       // tuning-exempt: frame count of the art in core/sprites.ts
  scribeWalk: 4,       // tuning-exempt: frame count of the art in core/sprites.ts
  bat: 2,              // tuning-exempt: frame count of the art in core/sprites.ts
  skeleton: 2,         // tuning-exempt: frame count of the art in core/sprites.ts
} as const;

/**
 * What an entity looks like right now.
 *
 * `moving` is the only input that is not time: the scribe walks while the
 * player is typing and idles when they are not, which is the one place the
 * world responds to the keyboard rather than to a clock.
 */
export function poseOf(entity: Entity, moving = false): EntityPose {
  const flip = entity.facing < 0;
  if (entity.kind === 'scribe') {
    return moving
      ? {
          spriteId: 'scribe_walk',
          frame: frameAt(entity.phaseMs, ANIM.scribeWalkMs, FRAMES.scribeWalk),
          x: entity.x,
          y: entity.y,
          flip,
        }
      : {
          spriteId: 'scribe_idle',
          frame: frameAt(entity.phaseMs, ANIM.scribeIdleMs, FRAMES.scribeIdle),
          x: entity.x,
          y: entity.y + bobOffset(entity.phaseMs, ANIM.scribeBobMs, 1),
          flip,
        };
  }
  if (entity.kind === 'bat') {
    return {
      spriteId: 'bat',
      frame: frameAt(entity.phaseMs, ANIM.batFlapMs, FRAMES.bat),
      x: entity.x,
      y: entity.y + bobOffset(entity.phaseMs, ANIM.batBobMs, BOB_PX),
      flip,
    };
  }
  return {
    spriteId: 'skeleton',
    frame: frameAt(entity.phaseMs, ANIM.skeletonRattleMs, FRAMES.skeleton),
    x: entity.x,
    y: entity.y + bobOffset(entity.phaseMs, ANIM.skeletonBobMs, 1),
    flip,
  };
}

// --- the blot-cloud ---------------------------------------------------------

export type CloudPhase = CloudState['phase'];

/**
 * The cloud's state.
 *
 * A superset of `CloudState` in `core/types.ts`, which has no room for the idle
 * clock the machine actually runs on. `toCloudState` projects it back down for
 * `GameState`. If `CloudState` ever gains `idleMs` and `strikes` this type
 * collapses into it; until then the extra fields live here rather than in a
 * module this pass is not allowed to touch.
 */
export interface BlotCloud {
  readonly phase: CloudPhase;
  /** Time in the current phase. */
  readonly phaseMs: number;
  /** Time since the last correct keystroke. The whole mechanic, in one number. */
  readonly idleMs: number;
  /** 0 = fully retreated, 1 = overhead. Virtual-resolution-free on purpose. */
  readonly x: number;
  /** How many times it has dripped this passage; for the sound and the HUD. */
  readonly strikes: number;
}

/** Everything the cloud reacts to in one step. */
export interface CloudInput {
  readonly stage: number;
  /** True on a step in which the player struck the *right* key. */
  readonly correctKey: boolean;
  /**
   * The threat can be switched off outright. ADR 0004 requires that switch to
   * exist and to stay: if the cloud stresses this player rather than motivating
   * him, the game must still be playable without it.
   */
  readonly enabled: boolean;
  /** Quill-nib upgrades that slow the cloud; see `core/items.ts`. */
  readonly cloudNibs?: number;
}

/** A step's outcome: the new cloud, and any smudge it dealt this step. */
export interface CloudStep {
  readonly cloud: BlotCloud;
  /** Smudge dealt this step, for `core/damage.ts`. Zero on almost every step. */
  readonly smudge: number;
}

/** A cloud that is nowhere, which is where a passage starts. */
export function createCloud(): BlotCloud {
  return { phase: 'absent', phaseMs: 0, idleMs: 0, x: 0, strikes: 0 };
}

/**
 * Silence the cloud will tolerate, at this stage.
 *
 * Starts generous -- eight seconds at stage 0 -- and tightens by stage, with a
 * floor it never goes below. A quill nib buys back exactly one stage's worth of
 * tightening, which is why the upgrade is expressed in `idle_step_ms` rather
 * than in a number of its own: "slower cloud" means "one stage kinder", and
 * that is a sentence the tuning table can already say.
 */
export function idleThresholdMs(stage: number, tuning: Tuning, cloudNibs = 0): number {
  const base = tuningValue(tuning, 'idle_base_ms');
  const step = tuningValue(tuning, 'idle_step_ms');
  const floor = tuningValue(tuning, 'idle_floor_ms');
  return Math.max(floor, base - stage * step) + cloudNibs * step;
}

/**
 * Advance the cloud by `dtMs`.
 *
 * The machine:
 *
 *   absent      -- silence past the stage threshold -->  approaching
 *   approaching -- `cloud_approach_ms` of telegraph  -->  striking (+smudge)
 *   striking    -- another `cloud_approach_ms`       -->  striking (+smudge)
 *   any phase   -- one correct keystroke             -->  absent
 *
 * The telegraph is the point of the middle state: the player gets
 * `cloud_approach_ms` of a visibly gathering cloud before anything is lost, so a
 * strike is never a surprise and is always avoidable by doing the one thing the
 * game wants -- typing the next correct character.
 *
 * Retreat is instantaneous and total. A cloud that receded gradually would leave
 * a player who has just recovered still being punished for the pause they have
 * already ended.
 */
export function stepCloud(
  cloud: BlotCloud,
  input: CloudInput,
  dtMs: number,
  tuning: Tuning,
): CloudStep {
  if (!input.enabled) return { cloud: createCloud(), smudge: 0 };
  if (input.correctKey) return { cloud: { ...createCloud(), strikes: cloud.strikes }, smudge: 0 };

  const idleMs = cloud.idleMs + dtMs;
  const approachMs = tuningValue(tuning, 'cloud_approach_ms');
  const threshold = idleThresholdMs(input.stage, tuning, input.cloudNibs ?? 0);

  if (cloud.phase === 'absent') {
    if (idleMs < threshold) return { cloud: { ...cloud, idleMs }, smudge: 0 };
    // Cross into the telegraph carrying the overshoot, so a long frame cannot
    // buy the player time the tuning table did not give them.
    const phaseMs = idleMs - threshold;
    return {
      cloud: { ...cloud, phase: 'approaching', phaseMs, idleMs, x: approachFraction(phaseMs, approachMs) },
      smudge: 0,
    };
  }

  const phaseMs = cloud.phaseMs + dtMs;
  if (phaseMs < approachMs) {
    const x = cloud.phase === 'approaching' ? approachFraction(phaseMs, approachMs) : 1;
    return { cloud: { ...cloud, phaseMs, idleMs, x }, smudge: 0 };
  }

  // Overhead, and still nothing typed: it drips. Silence that continues drips
  // again every `cloud_approach_ms`, so walking away is the one way to lose a
  // heart to the cloud, and it takes minutes rather than seconds.
  return {
    cloud: {
      phase: 'striking',
      phaseMs: phaseMs - approachMs,
      idleMs,
      x: 1,
      strikes: cloud.strikes + 1,
    },
    smudge: tuningValue(tuning, 'cloud_smudge'),
  };
}

/** How far in the cloud has drifted, 0..1. */
function approachFraction(phaseMs: number, approachMs: number): number {
  if (approachMs <= 0) return 1;
  return Math.min(1, phaseMs / approachMs);
}

/** True while the player can see the threat gathering and still stop it. */
export function isTelegraphing(cloud: BlotCloud): boolean {
  return cloud.phase === 'approaching';
}

/** Project onto the shared `CloudState` that `GameState` carries. */
export function toCloudState(cloud: BlotCloud): CloudState {
  return { phase: cloud.phase, phaseMs: cloud.phaseMs, x: cloud.x };
}

/** Sprite frames, in the order `core/sprites.ts` lists them for `blot_cloud`. */
const CLOUD_FRAME = {
  far: 0,
  near: 1,
  strike: 2,
} as const;

/**
 * When the drifting cloud swaps from its far frame to its near one: half way
 * through the telegraph. Art, not difficulty -- the strike lands at the same
 * moment whichever frame is on screen.
 */
const NEAR_AT = 0.5;   // tuning-exempt: art, the frame swap point of the telegraph

/**
 * What to draw for the cloud, or null when there is nothing to draw.
 *
 * The far frame while it is still gathering and the near one once it is more
 * than half way in, so the telegraph reads as *approach* rather than as a thing
 * that blinks into existence overhead.
 */
export function cloudPose(cloud: BlotCloud): { spriteId: string; frame: number; x: number } | null {
  if (cloud.phase === 'absent') return null;
  if (cloud.phase === 'striking') {
    return { spriteId: 'blot_cloud', frame: CLOUD_FRAME.strike, x: cloud.x };
  }
  return {
    spriteId: 'blot_cloud',
    frame: cloud.x < NEAR_AT ? CLOUD_FRAME.far : CLOUD_FRAME.near,
    x: cloud.x,
  };
}

/**
 * A drift wobble for the cloud, so it hangs rather than hovers. Art only: it
 * never changes when the cloud strikes.
 */
export function cloudBob(elapsedMs: number): number {
  return bobOffset(elapsedMs, ANIM.cloudDriftMs, 1);
}
