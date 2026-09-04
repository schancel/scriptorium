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
 *
 * **A monster is a word.** Every monster carries the index of the word that
 * fells it, and nothing else can. Completing that word starts its burst; the
 * burst runs for `monster_burst_ms` and then the monster is swept from the
 * level. There is no health, no contact, no failure and no way to lose a fight,
 * because a fight the player could lose would be a fight he could lose by being
 * slow -- see docs/design/03-pacing.md#a-monster-is-a-word. `strikeWord` is the
 * only function in this file that can change a monster's fate, it takes a word
 * index rather than a duration, and the functions that do take milliseconds
 * (`burstPose`, `scribeStrike`, `strikeMissiles`) are drawing an animation that
 * a keystroke already started.
 *
 * **Each enemy has its own verb.** A skeleton is stomped and a bat is inked --
 * see docs/design/03-pacing.md#defeating-a-monster-must-read-as-an-action. Both
 * resolve on the completed word and neither can miss: a `Strike` holds a verb, a
 * target and an elapsed time, and there is deliberately no fifth field in which
 * an aim, a timing window or a failure could be written. And strikes are a
 * *list*, because a fluent typist finishes a word every ~430 ms while a stomp
 * runs longer, so the second blow starts while the first is still playing.
 */

import { tuningValue } from './tuning.js';
import {
  BURST_FRAMES, HOP_BOUNCE, HOP_CONTACT, HOP_RISE, INK_BURST_FRAMES, NIB_FRAMES,
} from './sprites.js';
import type { BlotCloud, CloudState, Tuning } from './types.js';

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
  nibSpinMs: 70,       // tuning-exempt: animation cadence, art not difficulty
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
  /**
   * The word whose completion fells this monster; null for anything that is not
   * fought, which is the scribe and any pure decoration.
   *
   * A word index and not a distance, a timer or a hit box. That choice is the
   * whole no-failure guarantee expressed as a type: there is nowhere in this
   * record to write "and it gets you in four seconds", so nothing downstream can
   * read one.
   */
  readonly word: number | null;
  /**
   * Milliseconds since the strike landed, or null while the monster stands.
   *
   * Only `strikeWord` may turn this from null into a number, and `strikeWord`
   * only ever runs on a completed word. Once it is a number the clock does move
   * it -- an animation has to run -- but nothing is at stake while it does, and
   * the entity is swept away at the end of it.
   */
  readonly burstMs: number | null;
  /** True when this monster's burst leaves an ink pot. Rolled once, at the strike. */
  readonly drop: boolean;
}

/**
 * Place an entity.
 *
 * `phaseOffsetMs` staggers a row of bats so they do not beat in lockstep. It is
 * an authored offset rather than a random one, because randomness in `core/`
 * must come from the injected PRNG and a level's decoration does not deserve a
 * draw from it -- see docs/architecture/core-purity.md.
 *
 * `word` is what makes a monster fightable. Left out, the entity is scenery that
 * bobs for ever and nothing can ever happen to it.
 */
export function createEntity(
  id: string,
  kind: EntityKind,
  x: number,
  y: number,
  phaseOffsetMs = 0,
  facing = 1,
  word: number | null = null,
): Entity {
  return { id, kind, x, y, phaseMs: phaseOffsetMs, facing, word, burstMs: null, drop: false };
}

/**
 * Advance one entity's animation clock.
 *
 * Note what is *not* here: no movement, no pursuit, no timer that eventually
 * costs the player something. An entity's position is exactly where it was
 * placed, for ever. The one clock that does run is a burst already begun, and a
 * burst is a thing that has finished happening rather than a thing about to.
 */
export function stepEntity(entity: Entity, dtMs: number): Entity {
  const phaseMs = entity.phaseMs + dtMs;
  if (entity.burstMs === null) return { ...entity, phaseMs };
  return { ...entity, phaseMs, burstMs: entity.burstMs + dtMs };
}

/** Advance a whole level's worth. */
export function stepEntities(entities: readonly Entity[], dtMs: number): Entity[] {
  return entities.map((e) => stepEntity(e, dtMs));
}

// --- felling a monster ------------------------------------------------------

/** How long a struck monster takes to burst and leave the screen. */
export function burstDurationMs(tuning: Tuning): number {
  return tuningValue(tuning, 'monster_burst_ms');
}

/**
 * The verb each enemy is felled with.
 *
 * Ground things are stomped and flying things are inked, which is a rule about
 * the *kind* and not about the individual: two skeletons must not be dispatched
 * two different ways or the vocabulary stops being a vocabulary. Anything else
 * -- the scribe, decoration that somehow ended up anchored -- is inked, because
 * a thrown nib needs no ground to land on.
 */
export type StrikeVerb = 'stomp' | 'ink';

export function verbFor(kind: EntityKind): StrikeVerb {
  return kind === 'skeleton' ? 'stomp' : 'ink';
}

/**
 * A blow in progress.
 *
 * Four fields, and the absence of a fifth is the point. There is nowhere here to
 * record an aim, a timing window, a hit or a miss, so nothing downstream can
 * read one -- the outcome was settled by `strikeWord` on the keystroke that
 * completed the word, and this record only says what is being drawn about it.
 * See docs/decisions/0004-idle-threat-not-speed-timer.md: an attack that could
 * miss is a speed check wearing a costume.
 *
 * `x` and `y` are the *world* position of the monster being struck, not a screen
 * one, because the camera moves between the keystroke and the end of the
 * animation and the nib has to land on the bat rather than on where the bat was.
 */
export interface Strike {
  readonly verb: StrikeVerb;
  readonly x: number;
  readonly y: number;
  /** Milliseconds since the keystroke that began it. */
  readonly elapsedMs: number;
}

/** How long one verb runs. Its own tuning row, because the verbs differ. */
export function strikeSpanMs(verb: StrikeVerb, tuning: Tuning): number {
  return tuningValue(tuning, verb === 'stomp' ? 'stomp_ms' : 'ink_ms');
}

/**
 * How far past the scribe a monster is placed.
 *
 * Read here rather than in the platform so the number is named once in `core/`.
 * Without it a monster's world x is the camera position its word puts him at, so
 * it stands exactly where he arrives and the blow has no distance to cross --
 * which is the first of the two faults in
 * docs/design/03-pacing.md#defeating-a-monster-must-read-as-an-action.
 */
export function strikeReachPx(tuning: Tuning): number {
  return tuningValue(tuning, 'strike_reach');
}

/**
 * Begin a blow on the monster that has just been felled.
 *
 * The only way to make a `Strike`, and it takes an already-struck `Entity`, so
 * the only thing that can start one is `strikeWord` -- which only a completed
 * word can call.
 */
export function beginStrike(felled: Entity): Strike {
  return { verb: verbFor(felled.kind), x: felled.x, y: felled.y, elapsedMs: 0 };
}

/**
 * Advance every blow in flight, and drop the ones that have landed and finished.
 *
 * A list rather than a slot. At 140 WPM a word lands every ~430 ms and a stomp
 * runs longer than that, so a second blow begins while the first is still
 * playing; a single slot would cut the first one off mid-hop, and it would only
 * ever do so at the speed where somebody would notice.
 */
export function stepStrikes(strikes: readonly Strike[], dtMs: number, tuning: Tuning): Strike[] {
  const out: Strike[] = [];
  for (const strike of strikes) {
    const elapsedMs = strike.elapsedMs + dtMs;
    if (elapsedMs < strikeSpanMs(strike.verb, tuning)) out.push({ ...strike, elapsedMs });
  }
  return out;
}

/** True while a monster is mid-burst: struck, and still on screen. */
export function isBursting(entity: Entity): boolean {
  return entity.burstMs !== null;
}

/** True once a burst has run its course and the entity should be swept away. */
export function burstFinished(entity: Entity, tuning: Tuning): boolean {
  return entity.burstMs !== null && entity.burstMs >= burstDurationMs(tuning);
}

/**
 * The monsters anchored to a word and still standing.
 *
 * Asked *before* the strike, so a caller can roll each one's drop from the
 * injected PRNG and hand the answers back to `strikeWord`. Splitting the query
 * from the change is what keeps this module free of the generator: a monster's
 * fate is decided here, and the coin that decides its loot is tossed by whoever
 * owns the seed. See docs/architecture/core-purity.md.
 */
export function monstersAt(entities: readonly Entity[], word: number): Entity[] {
  return entities.filter((e) => e.word === word && e.burstMs === null);
}

/** A strike's outcome: the level after it, and what was felled. */
export interface StrikeResult {
  readonly entities: Entity[];
  /** The monsters this strike felled, already bursting. Usually none or one. */
  readonly defeated: readonly Entity[];
}

/**
 * The player has just completed `word`: whatever was anchored to it is felled.
 *
 * This is the entire combat system. It takes no duration, no damage and no
 * distance, and there is no sibling function that hurts the player -- a monster
 * can be defeated and it can be ignored, and those are the only two things that
 * can ever happen to one. `drops` names the ids the caller's PRNG chose to leave
 * an ink pot.
 */
export function strikeWord(
  entities: readonly Entity[],
  word: number,
  drops: ReadonlySet<string> = new Set<string>(),
): StrikeResult {
  const defeated: Entity[] = [];
  const next = entities.map((entity): Entity => {
    if (entity.word !== word || entity.burstMs !== null) return entity;
    const struck: Entity = { ...entity, burstMs: 0, drop: drops.has(entity.id) };
    defeated.push(struck);
    return struck;
  });
  return { entities: next, defeated };
}

/**
 * Step a level's monsters and sweep away the ones whose burst has finished.
 *
 * Separate from `stepEntities` because sweeping needs the tuning table and the
 * scribe does not: the scribe is stepped by the plain function and never leaves.
 */
export function stepMonsters(entities: readonly Entity[], dtMs: number, tuning: Tuning): Entity[] {
  return stepEntities(entities, dtMs).filter((e) => !burstFinished(e, tuning));
}

/** How far through its burst a monster is, 0..1. Zero for one still standing. */
export function burstFraction(entity: Entity, tuning: Tuning): number {
  const span = burstDurationMs(tuning);
  if (entity.burstMs === null || span <= 0) return 0;
  return Math.min(1, Math.max(0, entity.burstMs / span));
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
  scribeStrike: 2,     // tuning-exempt: frame count of the art in core/sprites.ts
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

/**
 * What to draw for a monster that has been struck, or null for one still
 * standing.
 *
 * The frame is a *fraction of the burst*, not a cadence of its own, so
 * `monster_burst_ms` is the only number that decides how long the animation
 * lasts. A frame rate here as well would be a second duration quietly
 * disagreeing with the documented one.
 */
export function burstPose(entity: Entity, tuning: Tuning): EntityPose | null {
  if (entity.burstMs === null) return null;
  const fraction = burstFraction(entity, tuning);
  const last = BURST_FRAMES - 1;
  return {
    spriteId: 'burst',
    frame: Math.min(last, Math.floor(fraction * BURST_FRAMES)),
    x: entity.x,
    y: entity.y,
    flip: false,
  };
}

// --- the two verbs ----------------------------------------------------------

/**
 * The shape of both verbs, in fractions of their own span.
 *
 * `tuning-exempt` on exactly the grounds `ANIM` is: these choreograph a picture
 * and none of them changes what the player must do. How high the scribe hops is
 * a drawing decision; *how long he hops for* is `stomp_ms` and is a row in
 * docs/design/07-tuning.md, because a duration is something someone might
 * legitimately want to turn.
 */
const STRIKE = {
  hopPeakPx: 12,      // tuning-exempt: art -- how high the leap arcs
  contactLiftPx: 7,   // tuning-exempt: art -- he lands on the skull, not through it
  nibArcPx: 14,       // tuning-exempt: art -- how high the thrown nib arcs
  riseTo: 0.4,        // tuning-exempt: art -- fraction of the stomp spent leaping
  contactTo: 0.6,     // tuning-exempt: art -- and where the contact frame gives way
  reachAt: 0.7,       // tuning-exempt: art -- how far along the leap carries him before the drop
  bouncePeak: 0.6,    // tuning-exempt: art -- the bounce arcs lower than the leap did
  flightTo: 0.6,      // tuning-exempt: art -- fraction of the ink verb the nib is in the air
} as const;

/**
 * One thing to draw for a strike, positioned *along the path* from the scribe to
 * the monster rather than in pixels.
 *
 * `travel` and `lift` and not an `x` and a `y`, because only `core/draw.ts`
 * knows where the camera has put the monster this frame. Handing back pixels
 * would freeze the target at the position it had on the keystroke, and the nib
 * would land where the bat was rather than on the bat.
 */
export interface StrikeVisual {
  readonly spriteId: string;
  readonly frame: number;
  /** The struck monster's world x and y: the far end of the path. */
  readonly toX: number;
  readonly toY: number;
  /** 0 at the scribe, 1 at the monster. */
  readonly travel: number;
  /** Whole pixels above the straight line between them; never negative. */
  readonly lift: number;
  readonly flip: boolean;
}

/** How far through a strike we are, 0..1. */
function strikeFraction(strike: Strike, tuning: Tuning): number {
  const span = strikeSpanMs(strike.verb, tuning);
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, strike.elapsedMs / span));
}

/**
 * The stomp: he leaps, he lands on the skull, he bounces back off it.
 *
 * Three phases over one duration, so `stomp_ms` is the only number that decides
 * how long it takes -- a frame rate of its own here would be a second duration
 * quietly disagreeing with the documented one, exactly as it would in
 * `burstPose`. He always arrives (`travel` reaches 1 at the contact frame) and
 * he always comes home (`travel` returns to 0), whatever the frame trace: there
 * is no branch in which the leap falls short.
 */
function stompVisual(strike: Strike, fraction: number): StrikeVisual {
  const base = { toX: strike.x, toY: strike.y, flip: false };
  if (fraction < STRIKE.riseTo) {
    const u = fraction / STRIKE.riseTo;
    return {
      ...base, spriteId: 'scribe_hop', frame: HOP_RISE,
      travel: u * STRIKE.reachAt, lift: STRIKE.hopPeakPx * u,
    };
  }
  if (fraction < STRIKE.contactTo) {
    const u = (fraction - STRIKE.riseTo) / (STRIKE.contactTo - STRIKE.riseTo);
    return {
      ...base, spriteId: 'scribe_hop', frame: HOP_CONTACT,
      travel: STRIKE.reachAt + (1 - STRIKE.reachAt) * u,
      lift: STRIKE.hopPeakPx + (STRIKE.contactLiftPx - STRIKE.hopPeakPx) * u,
    };
  }
  const u = (fraction - STRIKE.contactTo) / (1 - STRIKE.contactTo);
  return {
    ...base, spriteId: 'scribe_hop', frame: HOP_BOUNCE,
    travel: 1 - u,
    lift: STRIKE.contactLiftPx * (1 - u)
      + Math.sin(u * Math.PI) * STRIKE.hopPeakPx * STRIKE.bouncePeak,
  };
}

/**
 * The ink: the nib crosses the gap, then bursts on the bat.
 *
 * The nib is the only thing in the game that travels, and it travels because the
 * owner's report on the pose-only build was that felling something read as
 * standing next to it. It cannot be aimed and it cannot fall short -- `travel`
 * is a fraction of elapsed time and reaches 1 by `flightTo`, always.
 */
function inkVisual(strike: Strike, fraction: number): StrikeVisual {
  const base = { toX: strike.x, toY: strike.y, flip: false };
  if (fraction < STRIKE.flightTo) {
    const u = fraction / STRIKE.flightTo;
    return {
      ...base,
      spriteId: 'nib',
      frame: frameAt(strike.elapsedMs, ANIM.nibSpinMs, NIB_FRAMES),
      travel: u,
      lift: Math.sin(u * Math.PI) * STRIKE.nibArcPx,
    };
  }
  const u = (fraction - STRIKE.flightTo) / (1 - STRIKE.flightTo);
  return {
    ...base,
    spriteId: 'ink_burst',
    frame: Math.min(INK_BURST_FRAMES - 1, Math.floor(u * INK_BURST_FRAMES)),
    travel: 1,
    lift: 0,
  };
}

/**
 * The scribe's own pose while he is striking, or null when he stands.
 *
 * The pose outranks walking and idling for as long as the verb runs, because at
 * the moment something is destroyed the player should be looking at the blow and
 * not at a gait cycle.
 *
 * With more than one blow in flight he takes the **most recent** -- the last
 * entry, since `stepStrikes` preserves the order they were begun in. A fluent
 * typist starts a second strike a third of the way through the first, and a
 * scribe who finished the older animation first would be replaying a blow the
 * player has already moved on from.
 *
 * A stomp is the scribe: he is the thing that travels, so this carries the arc.
 * An ink throw leaves him standing, and what travels is in `strikeMissiles`.
 */
export function scribeStrike(
  scribe: Entity,
  strikes: readonly Strike[],
  tuning: Tuning,
): StrikeVisual | null {
  const latest = strikes[strikes.length - 1];
  if (latest === undefined) return null;
  const fraction = strikeFraction(latest, tuning);
  if (latest.verb === 'stomp') return { ...stompVisual(latest, fraction), flip: scribe.facing < 0 };
  return {
    spriteId: 'scribe_strike',
    frame: Math.min(FRAMES.scribeStrike - 1, Math.floor(fraction * FRAMES.scribeStrike)),
    toX: latest.x,
    toY: latest.y,
    travel: 0,
    lift: 0,
    flip: scribe.facing < 0,
  };
}

/**
 * What each blow has in the air: one visual per ink throw, and none for a stomp.
 *
 * Every live strike, not just the most recent, so an earlier nib keeps flying
 * while a later hop plays over the top of it. A stomp contributes nothing here
 * because the scribe *is* the missile, and drawing him twice would be a second
 * scribe.
 */
export function strikeMissiles(strikes: readonly Strike[], tuning: Tuning): StrikeVisual[] {
  const out: StrikeVisual[] = [];
  for (const strike of strikes) {
    if (strike.verb !== 'ink') continue;
    out.push(inkVisual(strike, strikeFraction(strike, tuning)));
  }
  return out;
}

// --- the blot-cloud ---------------------------------------------------------

export type CloudPhase = CloudState['phase'];

/**
 * The cloud's state now lives in `core/types.ts`, where `GameState` can hold it
 * whole, and is re-exported here because this module is where it is stepped.
 *
 * It was declared locally because the pass that wrote this machine could not
 * edit the shared types, and `CloudState` had no room for `idleMs` -- the one
 * number the whole mechanic is. `GameState.cloud` is a `BlotCloud` now;
 * `toCloudState` still projects it down for anything that only wants to draw it.
 */
export type { BlotCloud } from './types.js';

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
