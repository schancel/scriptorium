/**
 * Set pieces: the scripted flourishes a handful of passages get.
 *
 * @doc docs/design/05-scenery-warps.md#set-pieces
 *
 * "A set piece is a one-off scripted flourish for a specific passage -- optional
 * per scene, so most passages need only a theme and the memorable ones can be
 * special." Every id the scene table names has a function here;
 * `setpieces.test.ts` fails if the table ever grows one this module cannot run,
 * which is the only way a documented flourish can stay documented and imaginary.
 *
 * ## The register: the world responding, never the player gaining
 *
 * Nothing here is picked up, scored, counted or lost. A set piece is the world
 * answering what is being written -- a storm going flat, light arriving, a stone
 * moved -- which is why every one of them can be a pure function of progress and
 * why missing one costs the player exactly nothing. That constraint is what
 * makes the mechanism safe to grow: a flourish that *gave* something would have
 * to be reconciled with hearts, combo and the mastery gate, and none of these
 * ever touch any of them.
 *
 * ## What a set piece is, and is not
 *
 * It is a **pure function of time and progress to a handful of named scalars**.
 * It is not a display list. `core/draw.ts` owns every rectangle in the game, and
 * a set piece that emitted draw commands would be a second renderer with its own
 * idea of the palette and the bands -- one of those per flourish is one place
 * per flourish for the picture to disagree with itself. So `rising_water` returns `water: 0.62` and
 * the renderer decides what 0.62 of a flood looks like.
 *
 * Every parameter is a fraction in 0..1 for the same reason the blot-cloud's `x`
 * is: a scalar whose units live in the renderer cannot be misread as virtual
 * pixels by the first person to draw it, and a Flutter port scales it to its own
 * geometry without a table of conversions.
 *
 * ## Why a table of small functions rather than a system
 *
 * "Set pieces are scripted, not procedural -- there are few enough that
 * hand-authoring each is cheaper than a system." The mechanism is one record of
 * functions and one clamp. Anything larger would be a system for a handful of
 * cases, and the handful is the point.
 */

// --- the shape --------------------------------------------------------------

/** The flourishes named in the scene table, in the order it names them. */
export type SetpieceId =
  | 'light_from_dark'
  | 'waters_divided'
  | 'land_from_water'
  | 'swarming'
  | 'serpent_in_the_branches'
  | 'fruit_taken'
  | 'fig_leaves'
  | 'walking_in_the_garden'
  | 'flaming_sword'
  | 'rising_water'
  | 'burning_bush'
  | 'blood_on_doorposts'
  | 'parted_walls'
  | 'manna'
  | 'smoke_and_fire'
  | 'swallowed'
  | 'bruised_reed'
  | 'darkness_at_noon'
  | 'out_of_the_gate'
  | 'lifted_up'
  | 'loaves_multiplied'
  | 'lamps_kindled'
  | 'up_to_the_temple'
  | 'gate_of_the_fold'
  | 'tree_of_life';

export const SETPIECE_IDS: readonly SetpieceId[] = [
  'light_from_dark',
  'waters_divided',
  'land_from_water',
  'swarming',
  'serpent_in_the_branches',
  'fruit_taken',
  'fig_leaves',
  'walking_in_the_garden',
  'flaming_sword',
  'rising_water',
  'burning_bush',
  'blood_on_doorposts',
  'parted_walls',
  'manna',
  'smoke_and_fire',
  'swallowed',
  'bruised_reed',
  'darkness_at_noon',
  'out_of_the_gate',
  'lifted_up',
  'loaves_multiplied',
  'lamps_kindled',
  'up_to_the_temple',
  'gate_of_the_fold',
  'tree_of_life',
];

const IMPLEMENTED: ReadonlySet<string> = new Set<string>(SETPIECE_IDS);

/** True when `setpieceState` knows what to do with this id. */
export function isSetpieceId(id: string): id is SetpieceId {
  return IMPLEMENTED.has(id);
}

/**
 * What a set piece is a function of.
 *
 * `progress` is how far through the passage the player has typed, 0..1 -- the
 * flood rises because verses are being written, not because a clock is running,
 * which is docs/decisions/0004-idle-threat-not-speed-timer.md applied to the
 * scenery. `elapsedMs` drives only what must move while the player is still:
 * flame, smoke, swell. Nothing that costs or gains the player anything reads it.
 */
export interface SetpieceInput {
  /** Time in the passage. Injected, never sampled; see core-purity. */
  readonly elapsedMs: number;
  /** Fraction of the passage typed, 0..1. */
  readonly progress: number;
}

export interface SetpieceState {
  readonly id: SetpieceId;
  /** The clamped progress the parameters were computed from. */
  readonly progress: number;
  /** Named scalars, every one a fraction in 0..1. */
  readonly params: Readonly<Record<string, number>>;
}

// --- the arithmetic ---------------------------------------------------------

/**
 * Art timing, exempt on the same grounds as the parallax depths in
 * `core/worlds.ts`: these choose how a flame reads, not how hard the game is.
 * docs/design/07-tuning.md is about the player's experience, and nobody tunes
 * difficulty by editing the period of a flicker.
 */
const TAU = 6.283185307179586;      // tuning-exempt: 2*pi
const HALF = 0.5;                   // tuning-exempt: the midpoint of a unit range
const FLAME_MS = 220;               // tuning-exempt: art timing, a flame's flicker
const SMOKE_MS = 1700;              // tuning-exempt: art timing, smoke rolling
const SWELL_MS = 2600;              // tuning-exempt: art timing, a sea's swell
const DRIFT_MS = 3100;              // tuning-exempt: art timing, manna drifting down
const TURN_MS = 900;                // tuning-exempt: art timing, a blade turning every way

/**
 * How much of a passage a landmark takes to come up, pass and be gone, and how
 * far into the passage it is abreast of the scribe.
 *
 * Art, on the same grounds as the flicker periods above: they choose how a city
 * reads going past, not how hard anything is. At this span a landmark anchored
 * at `GATE_AT` is in sight from about an eighth of the way through the passage
 * and gone by rather over half of it, which leaves the rest of the stretch to
 * whatever the passage arrives at.
 */
const PASS_SPAN = 0.45;             // tuning-exempt: art -- how much of a passage a landmark takes to cross
const GATE_AT = 0.35;               // tuning-exempt: art -- how far in the gate is abreast of him

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A unit sine, phase-shifted into 0..1, so every parameter shares a range. */
function wave(elapsedMs: number, periodMs: number): number {
  return (Math.sin((TAU * elapsedMs) / periodMs) + 1) * HALF;
}

/** Progress squared: slow to start, then quick. Reads as gathering. */
function gathering(progress: number): number {
  return progress * progress;
}

/**
 * Where the scribe stands relative to a landmark anchored at `at`: 0 ahead of
 * him and out of sight, 0.5 abreast of him, 1 behind him and gone.
 *
 * The one reading of a scalar this file has that is a *position* rather than a
 * level, and the whole of what a city needed that a landscape did not -- "a city
 * is a place you arrive at, not a texture that repeats". It is still a pure
 * function of progress, so a landmark is carried past by the words the player
 * types and by nothing else, and `core/draw.ts` turns the fraction into an x
 * across the band and draws nothing at all at either end.
 * See docs/design/05-scenery-warps.md#a-landmark-is-a-pass-fraction.
 */
function passing(progress: number, at: number): number {
  return clamp01(HALF + (progress - at) / PASS_SPAN);
}

type Script = (input: SetpieceInput, progress: number) => Readonly<Record<string, number>>;

/**
 * One function per row of the set-piece table.
 *
 * Each is the sentence the doc uses, in arithmetic. `rising_water` "physically
 * raises the level as the flood does", so `water` is progress. `parted_walls`
 * "stands the sea up on either side of the rail", so `wall` is how far up.
 * `darkness_at_noon` "drains the palette to greyscale over the passage", so
 * `grey` is progress and the renderer needs nothing else from it.
 */
const SCRIPTS: Readonly<Record<SetpieceId, Script>> = {
  /** Genesis 1 and John 1: the void takes light as the verses are written. */
  light_from_dark: (input, progress) => ({
    light: progress,
    dark: 1 - progress,
    shimmer: wave(input.elapsedMs, SMOKE_MS),
  }),

  /**
   * Genesis 3:1-5: the serpent, above, in the branches.
   *
   * `lean` is how far down the bough it has come as the conversation runs, and
   * it stops short of 1 in the drawing rather than here -- it never reaches the
   * ground, because the text does not put it there until verse 14 and because
   * the ground is where the scribe is walking. `coil` gathers, so it is a shape
   * in a tree before it is a thing leaning out of one.
   */
  serpent_in_the_branches: (input, progress) => ({
    lean: progress,
    coil: gathering(progress),
    sway: wave(input.elapsedMs, DRIFT_MS),
  }),

  /** Genesis 3:6: the tree stands, and one fruit leaves the bough. */
  fruit_taken: (input, progress) => ({
    taken: progress,
    ripe: 1 - progress,
    sway: wave(input.elapsedMs, DRIFT_MS),
  }),

  /** Genesis 3:7: leaves close along the ground, one after another. */
  fig_leaves: (input, progress) => ({
    cover: progress,
    sewn: gathering(progress),
    sway: wave(input.elapsedMs, DRIFT_MS),
  }),

  /**
   * Genesis 3:8-23: the cool of the day, and something moving in the garden.
   *
   * `cool` is the light going out of the day and `stir` is the trees moving.
   * There is deliberately no parameter for a figure: the text says they *heard*,
   * and a flourish that drew somebody walking in the garden would be the scenery
   * making a claim the passage does not.
   */
  walking_in_the_garden: (input, progress) => ({
    cool: progress,
    hidden: gathering(progress),
    stir: wave(input.elapsedMs, SMOKE_MS),
  }),

  /**
   * Genesis 3:24: the way back closes, and a blade turns every way.
   *
   * `turn` is a wave rather than progress because turning every way is what the
   * sword *does* rather than something it finishes doing -- the same reason
   * `consumed` is pinned at zero in the burning bush. This is the one row of
   * Genesis 3 that is not held, so it plays over a world that has started
   * scrolling again.
   */
  flaming_sword: (input, progress) => ({
    closed: progress,
    turn: wave(input.elapsedMs, TURN_MS),
    flame: wave(input.elapsedMs, FLAME_MS),
  }),

  /** Genesis 6-9: the level itself rises with the water. */
  rising_water: (input, progress) => ({
    water: progress,
    swell: wave(input.elapsedMs, SWELL_MS),
  }),

  /**
   * Exodus 3. `consumed` is zero at every input and stays there: the bush burns
   * and is not consumed, which is the whole of what the passage says about it.
   * A flourish that slowly charred the bush would be contradicting its text.
   */
  burning_bush: (input) => ({
    flame: wave(input.elapsedMs, FLAME_MS),
    glow: wave(input.elapsedMs, SMOKE_MS),
    consumed: 0,
  }),

  /** Exodus 12: the doorposts are marked as the passage is written. */
  blood_on_doorposts: (input, progress) => ({
    marked: progress,
    lintel: clamp01(progress + progress),
    lamp: wave(input.elapsedMs, FLAME_MS),
  }),

  /** Exodus 14: the sea stands up on either side of the rail. */
  parted_walls: (input, progress) => ({
    wall: gathering(progress),
    sway: wave(input.elapsedMs, SWELL_MS),
    floor: progress,
  }),

  /** Exodus 16-17: bread on the ground each morning. */
  manna: (input, progress) => ({
    fall: progress,
    density: progress,
    drift: wave(input.elapsedMs, DRIFT_MS),
  }),

  /** Exodus 19-20: the mountain in smoke, and the fire in it. */
  smoke_and_fire: (input, progress) => ({
    smoke: progress,
    fire: wave(input.elapsedMs, FLAME_MS),
    roll: wave(input.elapsedMs, SMOKE_MS),
  }),

  /** Jonah 1-2: the dark closes over the player. */
  swallowed: (input, progress) => ({
    closure: gathering(progress),
    dark: progress,
    swell: wave(input.elapsedMs, SWELL_MS),
  }),

  /** Matthew 27 and John 19: the palette drains to greyscale over the passage. */
  darkness_at_noon: (_input, progress) => ({
    grey: progress,
    light: 1 - progress,
  }),

  /**
   * Genesis 1:6-8: the expanse opens, water above it and water below.
   *
   * `gathering` rather than plain progress, because the firmament is *made* and
   * then the waters are divided -- the opening should start slowly and then go.
   */
  waters_divided: (input, progress) => ({
    gap: gathering(progress),
    swell: wave(input.elapsedMs, SWELL_MS),
  }),

  /** Genesis 1:9-13: the sea drains off, and green closes over the ground. */
  land_from_water: (input, progress) => ({
    land: progress,
    green: gathering(progress),
    swell: wave(input.elapsedMs, SWELL_MS),
  }),

  /** Genesis 1:20-25: the band fills with things that were not moving in it. */
  swarming: (input, progress) => ({
    teeming: progress,
    drift: wave(input.elapsedMs, DRIFT_MS),
  }),

  /**
   * Matthew 12: "a bruised reed he will not break, and a smoking flax he will
   * not quench".
   *
   * `quenched` is zero at every input and stays there, exactly as `consumed` is
   * in the burning bush: the whole of what the passage says about the wick is
   * that it is *not* put out, and a flourish that guttered it dark at the end
   * would be contradicting its text.
   */
  bruised_reed: (input, progress) => ({
    lift: progress,
    ember: wave(input.elapsedMs, FLAME_MS),
    quenched: 0,
  }),

  /**
   * John 19:17-22 and Matthew 27:27-33: he is taken out of the city.
   *
   * `gate` is a pass fraction -- the gate comes up out of the right of the band,
   * is abreast of him a third of the way through the stretch, and is gone behind
   * him. `wall` is the city
   * itself getting further away, so it falls rather than rises: this is the one
   * flourish in the table whose main parameter runs *down* the passage, because
   * the thing it draws is being left. `banner` is the only clock in it.
   */
  out_of_the_gate: (input, progress) => ({
    gate: passing(progress, GATE_AT),
    wall: 1 - progress,
    banner: wave(input.elapsedMs, DRIFT_MS),
  }),

  /**
   * John 8:1-11: early in the morning, up through the city to the temple.
   *
   * The same gate the other way round, and then something that arrives and
   * *stays*: `wall` grows as he comes up under it, and `temple` stands the front
   * up over the wall at the end of the stretch and holds it there. A landmark
   * that receded here would be the scenery walking him past the building the
   * rest of the chapter happens inside.
   */
  up_to_the_temple: (_input, progress) => ({
    gate: passing(progress, GATE_AT),
    wall: progress,
    temple: gathering(progress),
  }),

  /** John 3: "as Moses lifted up the serpent" -- a standard rises, and the sky lightens. */
  lifted_up: (input, progress) => ({
    raised: progress,
    glow: progress,
    shimmer: wave(input.elapsedMs, SMOKE_MS),
  }),

  /** John 6: the baskets fill, and there is more at the end than there was. */
  loaves_multiplied: (input, progress) => ({
    baskets: progress,
    fill: gathering(progress),
    drift: wave(input.elapsedMs, DRIFT_MS),
  }),

  /** John 8: the temple lamps kindle one after another until the band is lit. */
  lamps_kindled: (input, progress) => ({
    lamps: progress,
    blaze: gathering(progress),
    flame: wave(input.elapsedMs, FLAME_MS),
  }),

  /** John 10: the gate of the fold opens across the band, and stays open. */
  gate_of_the_fold: (input, progress) => ({
    open: progress,
    flock: gathering(progress),
    sway: wave(input.elapsedMs, DRIFT_MS),
  }),

  /** Revelation 22: the tree barred at the start, open at the end. */
  tree_of_life: (input, progress) => ({
    bloom: progress,
    leaves: progress,
    sway: wave(input.elapsedMs, DRIFT_MS),
  }),
};

/**
 * Run one set piece for one frame.
 *
 * Pure and stateless: the same input always gives the same parameters, so a
 * replayed run replays its scenery, and nothing here has to be saved.
 *
 * @throws if the id is not one this module implements. Silently returning an
 *         empty flourish would hide a scene table that had run ahead of the
 *         code for as long as nobody happened to play that passage.
 */
export function setpieceState(id: string, input: SetpieceInput): SetpieceState {
  if (!isSetpieceId(id)) throw new Error(`setpieces: no such set piece "${id}"`);
  const progress = clamp01(input.progress);
  const script = SCRIPTS[id];
  const raw = script(input, progress);
  const params: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) params[name] = clamp01(value);
  return { id, progress, params: Object.freeze(params) };
}

/** One named parameter, or zero when this set piece does not produce it. */
export function setpieceParam(state: SetpieceState, name: string): number {
  return state.params[name] ?? 0;
}
