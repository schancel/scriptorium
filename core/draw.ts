/**
 * The frame, as data.
 *
 * @doc docs/architecture/display-list.md#commands
 *
 * Nothing here draws. `drawFrame` returns a flat, JSON-serialisable array of
 * commands in paint order and `platform/web/canvas_renderer.ts` executes them.
 * Colours are palette indices; the index -> CSS mapping is the renderer's
 * business, and fonts are named by `style` for the same reason -- a core module
 * that knew a pixel size in a real font would have to be rewritten for every port.
 *
 * The frame has four bands, top to bottom: the HUD, the scenery, the reading
 * rail, and the keyboard overlay. The rail is the one that matters; the others
 * are placed away from it on purpose, because a WPM counter beside the text
 * pulls the eye off the focal point, which is the one thing the rail exists to
 * hold still.
 *
 * ## Two palettes, and why they stay apart
 *
 * `PALETTE_ORDER` below names *interface* slots -- `hud`, `rule`, `error`. The
 * roles in `core/sprites.ts` name *art* -- `robe`, `flame`, `groundTop` -- and a
 * theme in `core/worlds.ts` supplies one colour per role. They are different
 * vocabularies for different pictures, and merging them would give the HUD an
 * opinion about the colour of a bat.
 *
 * A command chooses which vocabulary it speaks by carrying a `theme` or not: a
 * `rect`, `tile` or `sprite` with a `theme` has its colours resolved through that
 * theme's art palette, and everything else through the interface palette. One
 * rule, stated once, and the renderer never has to guess.
 */

import { CELL_W, focalX, visibleRange } from './rail.js';
import { smudgeFraction } from './damage.js';
import {
  burstFraction,
  burstPose,
  cloudBob,
  cloudPose,
  frameAt,
  isBursting,
  poseOf,
  scribeStrike,
  strikeMissiles,
  type Entity,
  type Strike,
  type StrikeVisual,
} from './entities.js';
import { setpieceParam, type SetpieceId, type SetpieceState } from './setpieces.js';
import { CANDLE_UNLIT_FRAME, SPRITE_SIZE } from './sprites.js';
import { roleIndex, worldFor, type ParallaxLayer, type World } from './worlds.js';
import {
  DEFAULT_SPACE_THUMB,
  FINGER_LABELS,
  boardKeyFor,
  curriculumKeyFor,
  fingerForKey,
  keyLabel,
  overlayExtent,
  overlayLayout,
  reportFingers,
} from './keyboard.js';
import { tuningValue } from './tuning.js';
import type {
  BlotCloud,
  DamageState,
  DrawCmd,
  Finger,
  Glyph,
  Key,
  KeyStat,
  KeyboardLayout,
  Mode,
  RailState,
  Score,
  Thumb,
  Tuning,
} from './types.js';

// --- palette ----------------------------------------------------------------

/**
 * Palette slots in index order. A command carries the *index*; the renderer holds
 * the CSS. Naming the slots and deriving the indices from this array means core
 * never spells a colour number, and the renderer's colour list is checked against
 * this one at startup rather than drifting silently out of alignment.
 *
 * The ten finger slots share the array so `pal(finger)` is a lookup, not a table.
 */
export const PALETTE_ORDER: readonly string[] = [
  'bg', 'band', 'dim', 'live', 'done', 'gold', 'hud', 'rule', 'panel',
  'keyFace', 'keyLabel', 'error',
  'lp', 'lr', 'lm', 'li', 'lt', 'rt', 'ri', 'rm', 'rr', 'rp',
];

const PAL_INDEX: ReadonlyMap<string, number> = new Map(PALETTE_ORDER.map((n, i) => [n, i]));

function pal(name: string): number {
  return PAL_INDEX.get(name) ?? 0;
}

// --- geometry ---------------------------------------------------------------

/**
 * The virtual design resolution and the band geometry inside it.
 *
 * Every number below is `tuning-exempt` and none of them is a feel knob. Display
 * list coordinates are virtual by contract (docs/architecture/display-list.md):
 * the platform scales and letterboxes, so these choose the *composition* of the
 * picture -- which band sits where -- and not how the game plays. Putting them in
 * the tuning table would invite someone to turn them expecting an effect on
 * difficulty, and would put twenty rows of pixel arithmetic in a document that is
 * otherwise entirely about the player's experience.
 *
 * The genuine tunables the rail uses -- `rail_cursor_x`, `rail_scroll_lerp`,
 * `focal_guide_width` -- come from `tuning`, as they should.
 */
const M = {
  vw: 640,           // tuning-exempt: virtual design resolution
  vh: 360,           // tuning-exempt: virtual design resolution
  hudH: 22,          // tuning-exempt: band composition
  hudPad: 10,        // tuning-exempt: band composition
  hudTextY: 11,      // tuning-exempt: band composition
  bandTop: 114,      // tuning-exempt: band composition
  bandH: 62,         // tuning-exempt: band composition
  railBaseY: 154,    // tuning-exempt: band composition
  guideTopY: 126,    // tuning-exempt: band composition
  guideBotY: 170,    // tuning-exempt: band composition
  caretTop: 132,     // tuning-exempt: band composition
  caretBot: 166,     // tuning-exempt: band composition
  hintY: 200,        // tuning-exempt: band composition
  kbUnit: 26,        // tuning-exempt: band composition
  kbTop: 210,        // tuning-exempt: band composition
  keyPad: 2,
  spaceMarkY: 157,   // tuning-exempt: band composition -- one px under the rail baseline
  spaceMarkH: 2,
  spaceMarkInset: 3, // tuning-exempt: band composition -- keeps the bar off its neighbours
  reportX: 44,       // tuning-exempt: report card composition
  reportRightX: 372, // tuning-exempt: report card composition
  reportTitleY: 46,  // tuning-exempt: report card composition
  reportBodyY: 74,   // tuning-exempt: report card composition
  reportLineH: 14,   // tuning-exempt: report card composition
  reportColW: 74,    // tuning-exempt: report card composition
  reportFootY: 328,  // tuning-exempt: report card composition
} as const;

/** The design resolution, for the platform's scale-and-letterbox transform. */
export const VIRTUAL_W = M.vw;
export const VIRTUAL_H = M.vh;

/**
 * The scenery band: the strip between the HUD and the rail, and the few pieces
 * of HUD furniture the game layer adds to it.
 *
 * Its top and height are *derived* from `M` rather than restated, so the band
 * cannot drift away from the two things it sits between. Everything else is
 * `tuning-exempt` on the same grounds as `M`: it composes the picture, and
 * nothing a player could win or lose by lives here.
 *
 * The band is deliberately quiet. It is above the rail, it never flashes, and
 * the parallax layers recede on their own authored depth -- because the rail is
 * the point of the game and the scenery serves it. See docs/design/02-rail.md.
 */
const SCENE = {
  top: M.hudH,
  height: M.bandTop - M.hudH,
  heartY: 3,            // tuning-exempt: band composition
  heartStep: 13,        // tuning-exempt: band composition -- hearts sit close so five fit
  meterW: 56,           // tuning-exempt: band composition
  meterH: 6,            // tuning-exempt: band composition
  meterY: 8,            // tuning-exempt: band composition
  stageW: 54,           // tuning-exempt: band composition -- reserved for the STAGE label
  cloudTravel: 190,     // tuning-exempt: art -- how far off the cloud drifts in from
  cloudY: 26,           // tuning-exempt: band composition
  candleFlickerMs: 220, // tuning-exempt: animation cadence, art not difficulty
  candleFrames: 2,      // tuning-exempt: frame count of the art in core/sprites.ts
  unlitAlpha: 0.55,     // tuning-exempt: art -- a candle the scribe has not reached
  layerAlphaBase: 0.45, // tuning-exempt: art -- how far the furthest layer recedes
  layerAlphaSpan: 0.55, // tuning-exempt: art -- and how much nearer depth closes it up
  dropRise: 12,         // tuning-exempt: art -- how far a dropped ink pot floats up
  dropFloor: 0.35,      // tuning-exempt: art -- the pot is never fainter than this
} as const;

/**
 * The coaching strip: one sentence, immediately under the rail.
 *
 * Its top is *derived* from the rail band rather than restated, so the strip
 * cannot drift away from the thing it is explaining. It carries the band's own
 * colour and a hairline above it, which is what makes it read as an aside
 * attached to the text rather than as a second HUD -- and the rest of the
 * picture does not move when it appears, because the hint line and the keyboard
 * are placed below it whether it is there or not. A layout that jumped when the
 * game spoke would pull the eye off the focal point, which is the one thing the
 * rail exists to hold still.
 *
 * It is used three times in a player's life. See docs/design/10-first-run.md.
 */
const COACH = {
  top: M.bandTop + M.bandH,
  height: 18,        // tuning-exempt: band composition
} as const;

/**
 * The data-failure banner.
 *
 * It sits across the top of the scenery band, in the interface palette rather
 * than a theme's, because it is not part of the world -- a warning that a world
 * recoloured would be a warning a world could hide. It is drawn last of all, so
 * nothing, including the report card, can cover it.
 */
const NOTICE = {
  lineH: 12,        // tuning-exempt: band composition
  padY: 2,          // tuning-exempt: band composition
  alpha: 0.92,      // tuning-exempt: art -- the level stays faintly visible behind it
} as const;

/**
 * The scripted flourishes, as geometry.
 *
 * `core/setpieces.ts` returns named scalars in 0..1 and nothing else -- "so
 * `rising_water` returns `water: 0.62` and the renderer decides what 0.62 of a
 * flood looks like". This is that decision, and it is deliberately made in one
 * place: ten little renderers, each with its own idea of the bands, is ten ways
 * for the picture to disagree with itself.
 *
 * Every number here is `tuning-exempt` on the same grounds as `M` and `SCENE`:
 * it composes a picture inside the scenery band. Nothing a player can win or
 * lose by is decided here, and the flourishes cannot reach the rail -- every
 * rect below is clamped into the band between the HUD and `M.bandTop`.
 */
const PIECE = {
  veil: 0.72,        // tuning-exempt: art -- how opaque a full veil ever gets
  wallW: 26,         // tuning-exempt: art -- a sea standing up, in virtual px
  glowH: 20,         // tuning-exempt: art -- a band of light along the horizon
  markW: 5,          // tuning-exempt: art -- a doorpost, in virtual px
  markInset: 46,     // tuning-exempt: art -- how far in the doorposts stand
  lintelH: 5,        // tuning-exempt: art -- the beam across the two posts
  motes: 7,          // tuning-exempt: art -- specks of manna across the band
  moteSize: 3,       // tuning-exempt: art -- and how big each speck is
  moteDrift: 14,     // tuning-exempt: art -- how far a speck drifts down
  fireW: 22,         // tuning-exempt: art -- the fire in the mountain
  fireH: 14,         // tuning-exempt: art -- and how tall it stands
  bushInset: 90,     // tuning-exempt: art -- how far right of centre the bush is
  waterAlpha: 0.7,   // tuning-exempt: art -- water is deep, not opaque
  swellLift: 4,      // tuning-exempt: art -- how far a swell moves the surface
} as const;

/** The art role the sky behind the parallax takes; every theme supplies one. */
const SKY_ROLE = 'shade';

const PERCENT = 100;         // tuning-exempt: fraction -> percent, a unit, not a knob
const CARET_W = 2;
const DIM_ALPHA = 0.35;      // tuning-exempt: how far an untaught key recedes
const PANEL_ALPHA = 0.94;    // tuning-exempt: report card veils the level behind it

/**
 * Rows on the "worst keys" table. Five, because docs/design/08-stats.md says five.
 */
const WORST_KEYS = 5;        // tuning-exempt: fixed by docs/design/08-stats.md

// --- the frame's input ------------------------------------------------------

/**
 * Everything a frame needs. A projection of `GameState` rather than the thing
 * itself: the tutor draws before the platformer sim exists, and the display list
 * should not have to wait on hearts and blot-clouds to be able to draw a verse.
 */
export interface FrameState {
  readonly mode: Mode;
  /** Canonical reference including the verse, e.g. "Genesis 1 - v3". */
  readonly ref: string;
  readonly stage: number;
  readonly glyphs: readonly Glyph[];
  readonly cursor: number;
  /** True when the last keystroke was wrong and the cursor is held. */
  readonly blocked: boolean;
  readonly score: Score;
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  readonly layout: KeyboardLayout;
  /** Everything typable at the current stage; the rest of the board is dimmed. */
  readonly keySet: readonly Key[];
  /**
   * Which thumb the player strikes space with. Optional, because it is a
   * preference the platform may not have asked for yet; absent means the right
   * thumb. It reaches the display list because the report card must not print a
   * column for the thumb this player never uses.
   */
  readonly spaceThumb?: Thumb;
  /**
   * Gilding mode, if the platform is running it.
   *
   * Absent means off, which is what every existing frame means. On, it changes
   * two things and nothing else: a greyed character the player has typed is
   * drawn gold rather than dim, and the cursor is allowed to rest on a greyed
   * character, because in this mode it is a target. The classification itself is
   * untouched -- an untaught letter ahead of the cursor is still dim, because it
   * is still untaught. See
   * docs/design/01-illumination.md#gilding-a-mode-for-people-who-already-type.
   */
  readonly gilding?: boolean;
  /**
   * Points earned by gilding, cumulative over the level. Drawn in the HUD when
   * gilding is on and omitted entirely when it is off -- a score of zero in a
   * mode with no scoring in it would be a number the player cannot move.
   */
  readonly gildPoints?: number;
  /**
   * The world between the HUD and the rail: theme, scribe, monsters, cloud and
   * hearts.
   *
   * Optional, and for the same reason `spaceThumb` is: the tutor drew verses
   * long before there was a platformer to put behind them, and a display list
   * that could not be produced without a blot-cloud would make the rail's own
   * tests depend on the game layer. Absent, the band is simply empty and every
   * existing frame is byte-for-byte what it was.
   */
  readonly scene?: SceneState;
  /**
   * Lines of a warning banner, drawn over everything else. Absent or empty
   * draws nothing.
   *
   * It exists for one failure and it is worth naming: every data loader in the
   * platform falls back silently, so a 404 on the corpus yields a hardcoded five
   * verses of Genesis and an empty theme list -- which reads exactly like
   * working software. A deploy bug hid behind that for hours while the owner
   * played a stub and reported only that the sound was missing. Fallbacks are
   * right for a first run; silence about them is not, so when the platform is
   * running on one it says so on the screen and cannot stop saying it.
   */
  readonly notice?: readonly string[];
  /**
   * One sentence of coaching, drawn in its own strip under the rail. Absent or
   * empty draws nothing, which is what every frame after the first few minutes
   * of a player's life looks like.
   *
   * It reaches the display list as a *string* rather than as a note id, because
   * choosing which of the three sentences is owed is a rule about what the
   * player has already been told, and that rule lives in `core/onboarding.ts`
   * with the wording it decides between. The frame only draws it.
   */
  readonly note?: string;
  /**
   * A doorway standing open in this passage, named in one sentence.
   *
   * It shares the coaching strip with `note` rather than taking a band of its
   * own, because the strip's space is already reserved whether anything is in it
   * or not -- and a second strip would move the picture the first time a doorway
   * appeared, which is the one thing the layout under the rail may never do.
   * A first-run note wins the strip outright: a note is spent three times in a
   * player's life and a doorway stands open for a whole verse.
   */
  readonly doorway?: string;
  /**
   * A crossing between two passages that share a phrase, mid-flight.
   *
   * Absent on every frame but the ~1.4 seconds of a warp, and absent is what
   * every frame in the game used to be. See `WarpView`.
   */
  readonly warp?: WarpView;
}

/**
 * The crossing, as the frame draws it.
 *
 * "During the phase, the echoed words are the only thing on screen that does not
 * change." -- docs/design/05-scenery-warps.md#warps. That sentence is one field:
 * `echoX`, which `core/warp.ts` computes **once**, at the doorway, precisely so
 * that nothing running during the phase can move it. It is carried here and used
 * verbatim; this file never derives it from the rail, the cursor or the viewport,
 * because a column derived twice is a column that eventually differs, and drift
 * in this one is the difference between a phrase that stays lit and a phrase
 * that slides.
 *
 * Everything else here is the part that *is* allowed to change: the destination
 * world washing in over the origin's, and the phrase's own alpha once the hold
 * is over.
 */
export interface WarpView {
  /** The authored phrase, held lit. Never string-matched; see `core/warp.ts`. */
  readonly phrase: string;
  /** The screen column the phrase's first glyph sits on. Computed once, upstream. */
  readonly echoX: number;
  /** 1 while the phrase is held, then down to 0 by arrival. */
  readonly echoAlpha: number;
  /** 0 is the origin's scenery, 1 the destination's. */
  readonly worldMix: number;
  /** The theme arriving. Its sky and parallax wash in over the origin's. */
  readonly toTheme: string;
  /** Where the destination's parallax stands, in the same space as `cameraX`. */
  readonly cameraX: number;
}

/**
 * The level, as the frame needs it.
 *
 * The one thing to understand here is `cameraX`: it is **word-driven**. The
 * platform advances it as words are completed, not on a clock, and everything
 * that appears to move -- the parallax, the monsters sliding past, the candle
 * coming up -- is a function of it. Nothing in this file, and nothing in
 * `core/entities.ts`, can move the world without the player having typed. That
 * is the premise, not a difficulty setting.
 * See docs/decisions/0004-idle-threat-not-speed-timer.md.
 */
/**
 * A candle standing in the world.
 *
 * Whether it is lit is decided by the game layer and carried here, rather than
 * inferred from `cameraX`: "has the player reached this checkpoint" is a rule
 * about the player's progress, and a display list that worked it out from a
 * pixel position would be the second, quietly different, copy of that rule.
 */
export interface SceneCandle {
  /** World x, in the same space as `cameraX`. */
  readonly x: number;
  readonly lit: boolean;
}

export interface SceneState {
  /** A theme id in `core/worlds.ts`; unknown ids resolve to the abbey. */
  readonly theme: string;
  /** Virtual px the world has travelled. Word-driven; never a clock. */
  readonly cameraX: number;
  /** True while the world is still moving, so the scribe walks rather than idles. */
  readonly walking: boolean;
  /** Accumulated animation time, for the art that flickers rather than moves. */
  readonly animMs: number;
  /**
   * The scribe. His `x` is a *screen* position and does not move: the world
   * scrolls past him, which is how a side-scroller has always conveyed travel
   * and is the same trick the rail plays with the text.
   */
  readonly scribe: Entity;
  /** Monsters. Their `x` is a *world* position, and it never changes. */
  readonly entities: readonly Entity[];
  readonly cloud: BlotCloud;
  readonly damage: DamageState;
  /** Hearts of capacity, so the ones already lost can be drawn hollow. */
  readonly heartsMax: number;
  /** The checkpoint candles standing in this stretch of world. */
  readonly candles: readonly SceneCandle[];
  /**
   * The blows still playing, oldest first.
   *
   * The one duration in this record, and the only thing here a clock touches.
   * A strike is begun by a *completed word* and by nothing else, so the poses it
   * selects are a consequence of typing rather than of time passing; the clock
   * only decides when to stop showing them.
   *
   * A list rather than a slot, because at 140 WPM a word lands every ~430 ms
   * while a stomp runs longer -- see
   * docs/design/03-pacing.md#defeating-a-monster-must-read-as-an-action. The
   * scribe takes the most recent; everything in flight is drawn.
   */
  readonly strikes: readonly Strike[];
  /**
   * The passage's scripted flourish, if it has one. Most do not.
   *
   * A `SetpieceState` from `core/setpieces.ts`: named scalars in 0..1 and no
   * draw commands, because "a set piece that emitted draw commands would be a
   * second renderer with its own idea of the palette and the bands". This file
   * turns those scalars into rects inside the scenery band, and nowhere else.
   */
  readonly setpiece?: SetpieceState;
}

// --- the report card --------------------------------------------------------

export interface FingerRow {
  readonly finger: Finger;
  readonly label: string;
  readonly hits: number;
  readonly errors: number;
  /** 0..1; zero when the finger was never used. */
  readonly accuracy: number;
  readonly meanMs: number;
}

export interface WorstKey {
  readonly key: Key;
  readonly hits: number;
  readonly errors: number;
  readonly errorRate: number;
  /** The character most often struck instead, or '' if there is no pattern. */
  readonly confusedWith: string;
}

export interface ReportCard {
  readonly fingers: readonly FingerRow[];
  readonly worst: readonly WorstKey[];
}

/**
 * Aggregate per-key statistics into the card.
 *
 * Every finger the game asks for is always present, including the ones with no
 * data. That is the entire point of the table: a two-finger typist's card is two
 * rows of numbers and seven rows of zeroes, and omitting the empty rows would
 * hide exactly the thing it exists to show.
 *
 * Nine rows, not ten. Only one thumb is on the space bar -- see
 * `keyboard.reportFingers` -- and a permanently empty tenth row would be an
 * artefact of the model rather than a diagnosis of the player, which is the one
 * thing this table must never be.
 */
export function reportCard(
  keyStats: Readonly<Record<Key, KeyStat>>,
  layout: KeyboardLayout,
  spaceThumb: Thumb = DEFAULT_SPACE_THUMB,
): ReportCard {
  const columns = reportFingers(spaceThumb);
  const hits = new Map<Finger, number>();
  const errors = new Map<Finger, number>();
  const totalMs = new Map<Finger, number>();
  for (const f of columns) {
    hits.set(f, 0);
    errors.set(f, 0);
    totalMs.set(f, 0);
  }

  const worst: WorstKey[] = [];
  for (const [key, stat] of Object.entries(keyStats)) {
    const finger = fingerForKey(key, layout, spaceThumb);
    if (finger !== null) {
      hits.set(finger, (hits.get(finger) ?? 0) + stat.hits);
      errors.set(finger, (errors.get(finger) ?? 0) + stat.errors);
      totalMs.set(finger, (totalMs.get(finger) ?? 0) + stat.totalMs);
    }
    const attempts = stat.hits + stat.errors;
    if (stat.errors > 0 && attempts > 0) {
      worst.push({
        key,
        hits: stat.hits,
        errors: stat.errors,
        errorRate: stat.errors / attempts,
        confusedWith: topConfusion(stat),
      });
    }
  }

  const fingers: FingerRow[] = columns.map((finger) => {
    const h = hits.get(finger) ?? 0;
    const e = errors.get(finger) ?? 0;
    const attempts = h + e;
    return {
      finger,
      label: FINGER_LABELS[finger],
      hits: h,
      errors: e,
      accuracy: attempts === 0 ? 0 : h / attempts,
      meanMs: h === 0 ? 0 : (totalMs.get(finger) ?? 0) / h,
    };
  });

  // Rate first, then volume, so a key missed twice out of three does not outrank
  // one missed forty times out of a hundred purely by arithmetic.
  worst.sort((a, b) => b.errorRate - a.errorRate || b.errors - a.errors);
  return { fingers, worst: worst.slice(0, WORST_KEYS) };
}

function topConfusion(stat: KeyStat): string {
  let best = '';
  let bestN = 0;
  for (const [ch, n] of Object.entries(stat.confusions)) {
    if (n > bestN) {
      best = ch;
      bestN = n;
    }
  }
  return best;
}

// --- the scenery band -------------------------------------------------------

/**
 * Where the pieces of the scenery band land.
 *
 * The platform needs this too -- it has to place a bat somewhere, and a bat's
 * feet belong on the same ground the scribe stands on -- so the composition is
 * computed here, once, and handed out. A platform that worked the ground line
 * out for itself would be a second copy of this arithmetic, drifting.
 */
export interface SceneLayout {
  readonly top: number;
  readonly height: number;
  /** The ground's surface. Anything standing has its feet here. */
  readonly groundY: number;
  /**
   * The scribe's screen x. He stands directly over the focal point, which is
   * both the cheapest way to keep him out of the rail's way and the truest: the
   * character and the cursor are the same place in the fiction.
   */
  readonly scribeX: number;
}

/**
 * The vertical span the theme's own parallax bands occupy, so they can be
 * projected into the strip this frame actually has for them.
 *
 * `core/worlds.ts` composes its layers for a full-height platformer -- its
 * ground sits at y 296 of 360, which here is under the keyboard overlay. Rather
 * than restate those numbers, or edit a module this pass consumes, the authored
 * band is normalised into the scenery strip. The relative depth, order and
 * thickness the theme chose all survive; only the absolute height changes, which
 * is exactly what "coordinates are virtual" already promises.
 */
interface Projection {
  readonly from: number;
  readonly span: number;
}

function projectionOf(layers: readonly ParallaxLayer[]): Projection {
  let from = Infinity;
  let to = -Infinity;
  for (const layer of layers) {
    from = Math.min(from, layer.y);
    to = Math.max(to, layer.y + layer.h);
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return { from: 0, span: 1 };
  return { from, span: Math.max(1, to - from) };
}

function projY(projection: Projection, y: number): number {
  return SCENE.top + ((y - projection.from) / projection.span) * SCENE.height;
}

function projH(projection: Projection, h: number): number {
  return (h / projection.span) * SCENE.height;
}

/** The nearest layer: the one the scribe stands on. */
function groundLayer(world: World): ParallaxLayer | undefined {
  return world.parallax[world.parallax.length - 1];
}

function layoutIn(world: World, scribeX: number): SceneLayout {
  const ground = groundLayer(world);
  return {
    top: SCENE.top,
    height: SCENE.height,
    groundY: ground === undefined
      ? SCENE.top + SCENE.height
      : px(projY(projectionOf(world.parallax), ground.y)),
    scribeX,
  };
}

/** Where everything in the band sits, for a theme. */
export function sceneLayout(theme: string, tuning: Tuning): SceneLayout {
  return layoutIn(worldFor(theme), px(focalX(M.vw, tuning) - SPRITE_SIZE / 2));
}

/**
 * Round to a whole virtual pixel.
 *
 * It also normalises negative zero, which is a real and distinct value in
 * JavaScript and does *not* survive `JSON.stringify`. A display list has to
 * round-trip through JSON by contract -- docs/architecture/display-list.md --
 * so a `-0` in a coordinate is a command that is not quite data.
 */
function px(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** A scroll offset folded back into one tile, so the tiling never runs out. */
function wrapToTile(value: number): number {
  const wrapped = value % SPRITE_SIZE;
  return wrapped < 0 ? wrapped + SPRITE_SIZE : wrapped;
}

/** True when a 16px sprite at this x has any part on screen. */
function onScreen(x: number): boolean {
  return x > -SPRITE_SIZE && x < M.vw;
}

/**
 * Put one thing a strike is drawing on the screen.
 *
 * `core/entities.ts` hands back a position *along the path* -- a travel fraction
 * and a lift -- rather than pixels, because it does not know where the camera
 * has put the monster this frame. Resolving it here is what makes the nib land
 * on the bat rather than on the pixel the bat occupied when it was thrown, and
 * it keeps the only piece of arithmetic that needs `cameraX` in the file that
 * already owns `cameraX`.
 *
 * `lift` is never negative and the target is never below the scribe's feet, so
 * nothing this draws can reach down into the rail's band.
 */
function pushStrikeVisual(
  cmds: DrawCmd[],
  scene: SceneState,
  visual: StrikeVisual,
  theme: string,
): void {
  const fromX = scene.scribe.x;
  const fromY = scene.scribe.y;
  const toX = visual.toX - scene.cameraX;
  cmds.push({
    op: 'sprite',
    id: visual.spriteId,
    x: px(fromX + (toX - fromX) * visual.travel),
    y: px(fromY + (visual.toY - fromY) * visual.travel - visual.lift),
    frame: visual.frame,
    flip: visual.flip,
    theme,
  });
}

// --- set pieces -------------------------------------------------------------

/** The bottom of the scenery band. Nothing a flourish draws may pass it. */
const BAND_BOTTOM = SCENE.top + SCENE.height;

/** A themed rect clamped into the scenery band, so no flourish can reach the rail. */
function bandRect(
  cmds: DrawCmd[],
  theme: string,
  role: string,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha: number,
): void {
  const top = Math.max(SCENE.top, y);
  const bottom = Math.min(BAND_BOTTOM, y + h);
  if (bottom <= top || w <= 0 || alpha <= 0) return;
  cmds.push({
    op: 'rect', x: px(x), y: px(top), w: Math.round(w), h: Math.max(1, Math.round(bottom - top)),
    color: roleIndex(role), alpha, theme,
  });
}

/** A full-band veil: the one shape four of the ten flourishes are made of. */
function veil(cmds: DrawCmd[], theme: string, role: string, amount: number): void {
  bandRect(cmds, theme, role, 0, SCENE.top, M.vw, SCENE.height, amount * PIECE.veil);
}

/**
 * One flourish, split into what is drawn behind the scribe and what is drawn
 * over him.
 *
 * The switch is exhaustive by construction -- the `never` in the default is what
 * makes a scene table that grew an eleventh set piece a compile error here as
 * well as a test failure in `core/setpieces.test.ts`. A documented flourish that
 * computed parameters nobody drew would be the same class of bug as one nobody
 * implemented: it would look exactly like working software.
 *
 * Each case is the sentence the design doc uses, in rects. `rising_water`
 * "physically raises the level as the flood does"; `parted_walls` "stands the
 * sea up on either side of the rail"; `darkness_at_noon` "drains the palette
 * over the passage", which here is the world sinking toward its own outline.
 */
function setpieceArt(
  state: SetpieceState,
  theme: string,
  layout: SceneLayout,
): { back: DrawCmd[]; front: DrawCmd[] } {
  const back: DrawCmd[] = [];
  const front: DrawCmd[] = [];
  const p = (name: string): number => setpieceParam(state, name);
  const ground = layout.groundY;
  const rise = ground - SCENE.top;
  const id: SetpieceId = state.id;

  switch (id) {
    case 'light_from_dark': {
      // The void takes light as the verses are written: dark drains off the
      // whole band, and a band of light gathers along the horizon.
      veil(front, theme, 'outline', p('dark'));
      const h = PIECE.glowH * p('light');
      bandRect(back, theme, 'highlight', 0, ground - h, M.vw, h, p('light'));
      break;
    }
    case 'rising_water': {
      // The level itself rises. Driven by progress, never by a clock: the flood
      // rises because verses are being written.
      const lift = rise * p('water') + PIECE.swellLift * p('swell');
      bandRect(back, theme, 'mid', 0, ground - lift, M.vw, lift, PIECE.waterAlpha);
      break;
    }
    case 'burning_bush': {
      // It burns and is not consumed, so nothing here chars: `consumed` is zero
      // at every input and there is deliberately nothing that reads it.
      const x = layout.scribeX + PIECE.bushInset;
      bandRect(back, theme, 'flame', x, ground - SPRITE_SIZE, SPRITE_SIZE, SPRITE_SIZE, p('flame'));
      bandRect(back, theme, 'accent', x - PIECE.markW, ground - SPRITE_SIZE - PIECE.markW,
        SPRITE_SIZE + PIECE.markW + PIECE.markW, SPRITE_SIZE + PIECE.markW, p('glow') * PIECE.veil);
      break;
    }
    case 'blood_on_doorposts': {
      const h = rise * p('marked');
      for (const x of [PIECE.markInset, M.vw - PIECE.markInset - PIECE.markW]) {
        bandRect(back, theme, 'blood', x, ground - h, PIECE.markW, h, p('marked'));
      }
      bandRect(back, theme, 'blood', PIECE.markInset, ground - h,
        M.vw - PIECE.markInset - PIECE.markInset, PIECE.lintelH, p('lintel'));
      break;
    }
    case 'parted_walls': {
      // The sea stands up on either side, and the scribe walks between them.
      const h = rise * p('wall') + PIECE.swellLift * p('sway');
      bandRect(back, theme, 'mid', 0, ground - h, PIECE.wallW, h, PIECE.waterAlpha);
      bandRect(back, theme, 'mid', M.vw - PIECE.wallW, ground - h, PIECE.wallW, h, PIECE.waterAlpha);
      break;
    }
    case 'manna': {
      const step = M.vw / PIECE.motes;
      for (let i = 0; i < PIECE.motes; i += 1) {
        const y = SCENE.top + (rise - PIECE.moteDrift) * p('fall')
          + PIECE.moteDrift * p('drift');
        bandRect(back, theme, 'highlight', i * step + step / 2, y,
          PIECE.moteSize, PIECE.moteSize, p('density'));
      }
      break;
    }
    case 'smoke_and_fire': {
      veil(front, theme, 'shade', p('smoke'));
      bandRect(back, theme, 'flame', (M.vw - PIECE.fireW) / 2, ground - PIECE.fireH,
        PIECE.fireW, PIECE.fireH, p('fire'));
      break;
    }
    case 'swallowed': {
      // The dark closes over the player from both sides, and then over all of it.
      const w = (M.vw / 2) * p('closure');
      bandRect(front, theme, 'outline', 0, SCENE.top, w, SCENE.height, PIECE.veil);
      bandRect(front, theme, 'outline', M.vw - w, SCENE.top, w, SCENE.height, PIECE.veil);
      veil(front, theme, 'outline', p('dark'));
      break;
    }
    case 'darkness_at_noon': {
      veil(front, theme, 'outline', p('grey'));
      break;
    }
    case 'tree_of_life': {
      const h = PIECE.glowH * p('leaves');
      bandRect(back, theme, 'light', 0, SCENE.top, M.vw, h, p('leaves'));
      bandRect(back, theme, 'accent', (M.vw - PIECE.fireW) / 2 + PIECE.swellLift * p('sway'),
        ground - PIECE.fireH, PIECE.fireW, PIECE.fireH, p('bloom'));
      break;
    }
    default: {
      const unhandled: never = id;
      return unhandled;
    }
  }
  return { back, front };
}

/**
 * The band between the HUD and the rail: sky, parallax, candles, monsters, the
 * scribe, and the cloud over the top of him.
 *
 * Back to front, and nothing here is allowed below `M.bandTop`. The rail is what
 * the player is looking at; the scenery says where he is and then stays out of
 * the way.
 */
function pushScene(cmds: DrawCmd[], scene: SceneState, tuning: Tuning): void {
  const world = worldFor(scene.theme);
  const theme = world.id;
  const projection = projectionOf(world.parallax);
  const layout = layoutIn(world, scene.scribe.x);

  // The sky. A themed `rect`, which is what the `theme` field buys: the same
  // command shape, resolved through the art palette instead of the interface one.
  cmds.push({
    op: 'rect', x: 0, y: SCENE.top, w: M.vw, h: SCENE.height,
    color: roleIndex(SKY_ROLE), theme,
  });

  for (const layer of world.parallax) {
    const y = px(projY(projection, layer.y));
    const h = Math.max(1, Math.round(projH(projection, layer.h)));
    // A layer lags the camera by its own depth; the ground alone keeps up.
    const shift = wrapToTile(scene.cameraX * layer.factor);
    cmds.push({
      op: 'tile', id: layer.tileId, x: px(-shift), y, w: M.vw + SPRITE_SIZE, h,
      alpha: SCENE.layerAlphaBase + SCENE.layerAlphaSpan * layer.factor,
      theme,
    });
  }

  // The passage's own flourish, if it has one. Split in two: the sea standing up
  // goes behind the scribe, the darkness at noon goes over him.
  const piece = scene.setpiece === undefined
    ? null
    : setpieceArt(scene.setpiece, theme, layout);
  if (piece !== null) cmds.push(...piece.back);

  const standY = layout.groundY - SPRITE_SIZE;

  for (const candle of scene.candles) {
    const x = px(candle.x - scene.cameraX);
    if (!onScreen(x)) continue;
    // An unlit candle is a candle that is *out* -- its own flameless frame, not
    // the lit art at a low alpha. Dimming the flame drew a fire on a checkpoint
    // nobody had lit, which left the moment of lighting with nothing to be a
    // change from; now the flame arriving is the whole event. It stays a little
    // dimmer as well, because an unreached checkpoint is also further away.
    cmds.push({
      op: 'sprite', id: 'candle', x, y: standY,
      frame: candle.lit
        ? frameAt(scene.animMs, SCENE.candleFlickerMs, SCENE.candleFrames)
        : CANDLE_UNLIT_FRAME,
      alpha: candle.lit ? 1 : SCENE.unlitAlpha,
      theme,
    });
  }

  for (const entity of scene.entities) {
    // A struck monster is drawn as its burst instead of itself. The burst has a
    // duration and the monster does not, which is the only asymmetry in the
    // whole band: everything else here is a function of the camera, and the
    // camera is a function of words typed.
    const pose = burstPose(entity, tuning) ?? poseOf(entity);
    const x = px(pose.x - scene.cameraX);
    if (!onScreen(x)) continue;
    cmds.push({
      op: 'sprite', id: pose.spriteId, x, y: px(pose.y), frame: pose.frame,
      flip: pose.flip, theme,
    });
    // The ink pot it left, floating up out of the burst. It is already in the
    // player's hand by the time this is drawn -- see the pacing doc -- so this
    // is the receipt for a heart, not a thing to be caught.
    if (entity.drop && isBursting(entity)) {
      const risen = burstFraction(entity, tuning);
      cmds.push({
        op: 'sprite', id: 'ink_pot', x, y: px(pose.y - risen * SCENE.dropRise),
        alpha: 1 - risen * (1 - SCENE.dropFloor),
        theme,
      });
    }
  }

  // The strike outranks walking and idling: at the moment something is
  // destroyed the player should be looking at the blow. A stomp carries him
  // along an arc to the skull and back, which is why this is not simply a pose.
  const blow = scribeStrike(scene.scribe, scene.strikes, tuning);
  if (blow === null) {
    const scribe = poseOf(scene.scribe, scene.walking);
    cmds.push({
      op: 'sprite', id: scribe.spriteId, x: px(scribe.x), y: px(scribe.y),
      frame: scribe.frame, flip: scribe.flip, theme,
    });
  } else {
    pushStrikeVisual(cmds, scene, blow, theme);
  }

  // Everything in the air, from every blow still playing -- not just the most
  // recent one. A nib thrown at a bat two words ago is still crossing the gap
  // while the scribe is already stomping something else.
  for (const missile of strikeMissiles(scene.strikes, tuning)) {
    pushStrikeVisual(cmds, scene, missile, theme);
  }

  // The cloud, in front of everything, drifting in from the right as the
  // telegraph runs. `cloud.x` is an approach fraction, not pixels -- see
  // `CloudState` in core/types.ts -- so the span it crosses is chosen here.
  const cloud = cloudPose(scene.cloud);
  if (cloud !== null) {
    cmds.push({
      op: 'sprite', id: cloud.spriteId,
      x: px(layout.scribeX + (1 - cloud.x) * SCENE.cloudTravel),
      y: px(SCENE.cloudY + cloudBob(scene.cloud.phaseMs)),
      frame: cloud.frame,
      theme,
    });
  }

  // Last in the band, and still inside it: the veils a flourish draws over the
  // whole world -- the darkness at noon, the smoke on the mountain, the dark
  // closing over Jonah.
  if (piece !== null) cmds.push(...piece.front);
}

/**
 * The destination's world, washing in over the origin's.
 *
 * A crossfade with only one side drawn: the arriving sky and parallax are pushed
 * over the departing ones at `worldMix`, which reads as the dissolve the design
 * doc asks for and needs no second opinion about how to fade a band that is
 * already composed. It stays entirely inside the scenery band, so the rail and
 * the strip reserved under it for a first-run note are untouched -- the phrase
 * on the rail is the thing that must not move, and the way to guarantee that is
 * to draw nothing near it.
 */
function pushWarpWorld(cmds: DrawCmd[], warp: WarpView): void {
  if (warp.worldMix <= 0) return;
  const world = worldFor(warp.toTheme);
  const theme = world.id;
  const projection = projectionOf(world.parallax);
  cmds.push({
    op: 'rect', x: 0, y: SCENE.top, w: M.vw, h: SCENE.height,
    color: roleIndex(SKY_ROLE), alpha: warp.worldMix, theme,
  });
  for (const layer of world.parallax) {
    const y = px(projY(projection, layer.y));
    const h = Math.max(1, Math.round(projH(projection, layer.h)));
    const shift = wrapToTile(warp.cameraX * layer.factor);
    cmds.push({
      op: 'tile', id: layer.tileId, x: px(-shift), y, w: M.vw + SPRITE_SIZE, h,
      alpha: (SCENE.layerAlphaBase + SCENE.layerAlphaSpan * layer.factor) * warp.worldMix,
      theme,
    });
  }
}

/**
 * The echoed phrase, pinned.
 *
 * The one thing in the whole program that is drawn from a column somebody else
 * computed. `warp.echoX` came from `planWarp`, once, at the doorway; every glyph
 * of the phrase is placed at `echoX + i * CELL_W`, so the first glyph's x is
 * *exactly* the planned number on every frame of the crossing and the rest step
 * off it by whole cells. There is no rail offset in this arithmetic, no cursor
 * and no viewport, which is what makes "it does not move" a property of the code
 * rather than a hope about it.
 *
 * Drawn after the rail so that neither ribbon -- the one leaving or the one
 * arriving -- can be painted over the top of it.
 */
function pushHeldEcho(cmds: DrawCmd[], warp: WarpView): void {
  if (warp.echoAlpha <= 0) return;
  [...warp.phrase].forEach((ch, i) => {
    if (ch === ' ') return;
    cmds.push({
      op: 'text', value: ch, x: warp.echoX + i * CELL_W, y: M.railBaseY,
      style: 'rail-cursor', color: pal('gold'), alpha: warp.echoAlpha,
    });
  });
}

/**
 * The banner that says the game is not running on the real data.
 *
 * Loud on purpose, and unconditional: a fallback is the right behaviour and
 * being quiet about one is not. The whole reason it exists is that a 404 on the
 * corpus produces five hardcoded verses and an empty songbook, which is
 * indistinguishable from a working game -- so this is drawn in the error colour,
 * across the full width, over everything else in the frame, and it does not go
 * away while the condition holds.
 */
function pushNotice(cmds: DrawCmd[], lines: readonly string[]): void {
  const h = lines.length * NOTICE.lineH + NOTICE.padY * 2;
  cmds.push({
    op: 'rect', x: 0, y: SCENE.top, w: M.vw, h, color: pal('error'), alpha: NOTICE.alpha,
  });
  lines.forEach((line, index) => {
    cmds.push({
      op: 'text',
      value: line,
      x: M.vw / 2,
      y: SCENE.top + NOTICE.padY + index * NOTICE.lineH + NOTICE.lineH / 2,
      style: 'hud-center',
      color: pal('bg'),
    });
  });
}

// --- the frame --------------------------------------------------------------

/** The whole frame, back to front. */
export function drawFrame(state: FrameState, rail: RailState, tuning: Tuning): DrawCmd[] {
  const cmds: DrawCmd[] = [];
  cmds.push({ op: 'rect', x: 0, y: 0, w: M.vw, h: M.vh, color: pal('bg') });
  if (state.scene !== undefined) pushScene(cmds, state.scene, tuning);
  const warp = state.warp;
  if (warp !== undefined) pushWarpWorld(cmds, warp);
  pushHud(cmds, state, tuning);
  pushRail(cmds, state, rail, tuning);
  // After the rail, so nothing of either ribbon can be drawn over the phrase
  // the crossing exists to hold still.
  if (warp !== undefined) pushHeldEcho(cmds, warp);
  // One sentence, in the one strip reserved for one. A first-run note outranks a
  // doorway: the note is spent three times in a player's life and never comes
  // back, while the doorway stands open for the rest of its verse.
  const note = state.note;
  const doorway = state.doorway;
  if (note !== undefined && note.length > 0) pushNote(cmds, note, pal('hud'));
  else if (doorway !== undefined && doorway.length > 0) pushNote(cmds, doorway, pal('live'));
  // Reading mode asks for nothing, so it points at nothing. A board lit for a
  // key the player is not being asked for would be the overlay lying.
  if (state.mode === 'lectio') pushReadingHint(cmds);
  else pushKeyboard(cmds, state, tuning);
  if (state.mode === 'report') pushReport(cmds, state);
  // Last, so the report card cannot bury it. Running on fallback data must be
  // impossible to miss from any screen in the game.
  const notice = state.notice;
  if (notice !== undefined && notice.length > 0) pushNotice(cmds, notice);
  return cmds;
}

function pct(fraction: number): number {
  return Math.round(fraction * PERCENT);
}

/**
 * Hearts, on the left of the HUD.
 *
 * A lost heart is drawn as the *outline* of a heart rather than removed. Five
 * slots that empty say "you have lost two"; three hearts that become two say
 * only "there are two hearts", and the difference matters most to the player who
 * has just been hit and is trying to work out how much trouble he is in.
 *
 * Returns the x the rest of the HUD may start at.
 */
function pushHearts(cmds: DrawCmd[], scene: SceneState): number {
  const theme = worldFor(scene.theme).id;
  for (let i = 0; i < scene.heartsMax; i++) {
    cmds.push({
      op: 'sprite',
      id: i < scene.damage.hearts ? 'heart_full' : 'heart_empty',
      x: M.hudPad + i * SCENE.heartStep,
      y: SCENE.heartY,
      theme,
    });
  }
  return M.hudPad + scene.heartsMax * SCENE.heartStep + M.hudPad;
}

/**
 * The smudge meter, on the right, immediately left of the stage label.
 *
 * It is a bar and not a number because it is not a score: what the player needs
 * off it at a glance is "how close is the page to costing me a heart", and a bar
 * answers that without being read. Errors fill it and clean typing drains it --
 * docs/decisions/0005-smudge-meter-over-per-typo-damage.md.
 */
function pushSmudgeMeter(cmds: DrawCmd[], scene: SceneState, tuning: Tuning): void {
  const x = M.vw - M.hudPad - SCENE.stageW - SCENE.meterW;
  cmds.push({
    op: 'rect', x, y: SCENE.meterY, w: SCENE.meterW, h: SCENE.meterH,
    color: pal('rule'), alpha: DIM_ALPHA,
  });
  const filled = Math.round(SCENE.meterW * smudgeFraction(scene.damage, tuning));
  if (filled > 0) {
    cmds.push({
      op: 'rect', x, y: SCENE.meterY, w: filled, h: SCENE.meterH, color: pal('error'),
    });
  }
}

function pushHud(cmds: DrawCmd[], state: FrameState, tuning: Tuning): void {
  cmds.push({ op: 'rect', x: 0, y: 0, w: M.vw, h: M.hudH, color: pal('band') });
  const scene = state.scene;
  const refX = scene === undefined ? M.hudPad : pushHearts(cmds, scene);
  cmds.push({
    op: 'text', value: state.ref, x: refX, y: M.hudTextY,
    style: 'hud', color: pal('hud'),
  });
  // The gild total joins the centre line rather than taking a corner of its own:
  // it is a score for the same stretch of typing the WPM and accuracy describe,
  // and the corners are already the player's health and their stage.
  const gild = state.gilding === true
    ? `    GILD ${Math.round(state.gildPoints ?? 0)}`
    : '';
  // Reading mode reports the pace it is flowing at and nothing else. An accuracy
  // in a mode with no keystrokes in it would be a number the player cannot move,
  // and a WPM would read as a score for something he is not doing.
  cmds.push({
    op: 'text',
    value: state.mode === 'lectio'
      ? `READING    ${Math.round(state.score.wpm)} wpm`
      : `WPM ${Math.round(state.score.wpm)}    ACC ${pct(state.score.accuracy)}%${gild}`,
    x: M.vw / 2, y: M.hudTextY, style: 'hud-center', color: pal('gold'),
  });
  if (scene !== undefined) pushSmudgeMeter(cmds, scene, tuning);
  cmds.push({
    op: 'text', value: `STAGE ${state.stage}`, x: M.vw - M.hudPad, y: M.hudTextY,
    style: 'hud-right', color: pal('hud'),
  });
}

/**
 * The glyph the player owes us, which the overlay lights the keys of.
 *
 * Off, that is the first *live* glyph at or after the cursor: the greyed run in
 * between is not being asked for, so pointing past it is right.
 *
 * On, it is the glyph under the cursor and nothing further. A gilded character
 * carries no strokes, so the overlay lights nothing while the cursor sits on
 * one -- which is correct twice over. Pointing at the next live character would
 * name a key the player is not being asked for yet, and pointing at the greyed
 * one would show a beginner where an untaught key lives, which illumination
 * exists to avoid. The mode is for people who do not need the overlay.
 */
function nextLiveGlyph(state: FrameState): Glyph | null {
  if (state.gilding === true) {
    const here = state.glyphs[state.cursor];
    return here === undefined || here.strokes.length === 0 ? null : here;
  }
  for (let i = state.cursor; i < state.glyphs.length; i++) {
    const g = state.glyphs[i];
    if (g !== undefined && g.live) return g;
  }
  return null;
}

/**
 * The space affordance.
 *
 * A space prints nothing, and a beginner cannot press a key he cannot see -- the
 * owner's report was that it is "difficult to tell the user is supposed to press
 * space", on the key that is a fifth of every keystroke in the game and is live
 * from stage 0. So a space that is still owed gets a mark: a low bar in its cell,
 * where an underscore would sit.
 *
 * Geometry rather than a glyph, deliberately. An interpunct or an underscore
 * character is one or two pixels of ink in a 12px cell at the virtual design
 * resolution, and how many depends on whichever monospace font the platform
 * resolved -- an affordance that survives in one font and vanishes in the next is
 * no affordance. A rect is exactly the size core asks for on every platform.
 *
 * A pending space is drawn inset and in the focal guide's own muted `rule`
 * colour: quieter than a live letter, so the eye still reads words rather than
 * bars, but unmistakably a thing rather than a gap. The space *under the cursor*
 * is drawn full-cell-width in the caret's colour, which is what makes the caret
 * unambiguous when it lands on one: the vertical caret and the bar it sits on
 * agree, and read together as the cell the player owes.
 *
 * A space already typed goes back to blank -- there is nothing left to ask for,
 * and a ribbon of bars behind the cursor would be noise.
 */
function pushSpaceMark(cmds: DrawCmd[], i: number, state: FrameState, offset: number): void {
  const current = i === state.cursor;
  const inset = current ? 0 : M.spaceMarkInset;
  cmds.push({
    op: 'rect',
    x: i * CELL_W + offset + inset,
    y: M.spaceMarkY,
    w: CELL_W - inset * 2,
    h: M.spaceMarkH,
    color: pal(current ? (state.blocked ? 'error' : 'gold') : 'rule'),
  });
}

function pushRail(cmds: DrawCmd[], state: FrameState, rail: RailState, tuning: Tuning): void {
  cmds.push({ op: 'rect', x: 0, y: M.bandTop, w: M.vw, h: M.bandH, color: pal('band') });

  const x0 = focalX(M.vw, tuning);
  const { first, last } = visibleRange(state.glyphs.length, rail.offset, M.vw);
  for (let i = first; i < last; i++) {
    const g = state.glyphs[i];
    if (g === undefined || g.ch === '\n') continue;
    if (g.ch === ' ') {
      // Owed, not yet paid: current or still ahead, and actually asked for.
      if (g.live && i >= state.cursor) pushSpaceMark(cmds, i, state, rail.offset);
      continue;
    }
    const style = glyphStyle(i, state);
    cmds.push({
      op: 'text', value: g.ch, x: i * CELL_W + rail.offset, y: M.railBaseY,
      style, color: pal(styleColour(style)),
    });
  }

  // The focal guide, painted after the text so a glyph never sits on top of the
  // one thing on screen that is guaranteed not to move.
  const centre = x0 + CELL_W / 2;
  const half = (tuning['focal_guide_width'] ?? 0) / 2;
  cmds.push({
    op: 'line', x1: centre - half, y1: M.guideTopY, x2: centre + half, y2: M.guideTopY,
    color: pal('rule'), width: 1,
  });
  cmds.push({
    op: 'line', x1: centre - half, y1: M.guideBotY, x2: centre + half, y2: M.guideBotY,
    color: pal('rule'), width: 1,
  });
  // No caret during a crossing: nothing is being asked for, and gold is how the
  // game says *this one*. While the phrase is held it is the only gold on
  // screen, which is the whole of what the transition has to say.
  if (state.warp === undefined) {
    cmds.push({
      op: 'line', x1: x0, y1: M.caretTop, x2: x0, y2: M.caretBot,
      color: pal(state.blocked ? 'error' : 'gold'), width: CARET_W,
    });
  }
}

/**
 * The way out of reading mode, where the keyboard overlay would otherwise be.
 *
 * Lectio "is the mode available on a day he does not want to drill", so it has
 * to be as easy to leave as it was to enter -- and the one place a player is
 * already looking for instructions is the line under the rail that normally
 * names the next key.
 */
function pushReadingHint(cmds: DrawCmd[]): void {
  cmds.push({
    op: 'text', value: 'reading \u2014 esc: back to typing',
    x: M.vw / 2, y: M.hintY, style: 'hint-center', color: pal('hud'),
  });
}

/**
 * A greyed glyph is dim wherever it sits, including behind the cursor: it was
 * never typed, so showing it as done would credit the player with a keystroke
 * they did not make.
 *
 * Unless it *was* typed. In gilding mode a greyed character behind the cursor
 * has been struck, and it is drawn gold -- the page gilding itself behind the
 * scribe, which is the whole metaphor the mode is named for and the only
 * feedback that says the extra work registered. Ahead of the cursor it is still
 * dim, because it is still an untaught letter; the mode changes what is asked
 * for, not what has been taught.
 */
function glyphStyle(i: number, state: FrameState): string {
  const g = state.glyphs[i];
  if (g === undefined) return 'rail-dim';
  if (!g.live) {
    if (state.gilding !== true || !g.producible) return 'rail-dim';
    if (i < state.cursor) return 'rail-gild';
    if (i === state.cursor) return state.blocked ? 'rail-error' : 'rail-cursor';
    return 'rail-dim';
  }
  if (i < state.cursor) return 'rail-done';
  if (i === state.cursor) return state.blocked ? 'rail-error' : 'rail-cursor';
  return 'rail-live';
}

function styleColour(style: string): string {
  if (style === 'rail-dim') return 'dim';
  if (style === 'rail-done') return 'done';
  if (style === 'rail-cursor') return 'gold';
  if (style === 'rail-gild') return 'gold';
  if (style === 'rail-error') return 'error';
  return 'live';
}

/**
 * Earned fade-out: a key stops being highlighted once its accuracy clears the
 * mastery threshold. The crutch withdraws itself key by key, without the player
 * ever having to decide to give it up.
 */
function isMastered(key: Key, state: FrameState, tuning: Tuning): boolean {
  const stat = state.keyStats[key];
  if (stat === undefined) return false;
  const attempts = stat.hits + stat.errors;
  if (stat.hits < tuningValue(tuning, 'mastery_min_samples')) return false;
  return attempts > 0 && stat.hits / attempts >= tuningValue(tuning, 'gate_accuracy');
}

/**
 * The physical keys the next character costs, minus the ones already mastered.
 *
 * Two translations happen here, and both are the overlay's business alone. The
 * glyph names the *character* owed and the board draws physical keys, so `:`
 * only lines up with the `;` it is struck on once `boardKeyFor` has said so --
 * without it nothing lights at all for a colon. And a capital costs two keys on
 * two hands: the letter, and the shift held by the *opposite* pinky. Lighting
 * both is the point of stage 8, and lighting the near shift instead would drill
 * the wrist-rolling habit the stage exists to replace.
 *
 * Mastery is judged per key, so the shift can go on being pointed at after the
 * letter has earned its fade-out, and vice versa.
 */
function highlightedKeys(
  next: Glyph | null,
  state: FrameState,
  tuning: Tuning,
): ReadonlySet<Key> {
  const out = new Set<Key>();
  if (next === null) return out;
  for (const stroke of next.strokes) {
    if (isMastered(stroke.key, state, tuning)) continue;
    out.add(boardKeyFor(stroke.key, stroke.finger));
  }
  return out;
}

/**
 * A first-run note.
 *
 * Quiet on purpose: the band's own colour, the interface palette's ordinary
 * text, and a hairline to attach it to the rail. Nothing here is gold -- gold
 * is what the game uses to say *press this key next*, and a sentence that
 * borrowed it would compete with the one thing on screen the player has to act
 * on. Nothing here blinks, either. It is a remark, not an alarm.
 */
function pushNote(cmds: DrawCmd[], note: string, colour: number): void {
  cmds.push({
    op: 'rect', x: 0, y: COACH.top, w: M.vw, h: COACH.height, color: pal('band'),
  });
  cmds.push({
    op: 'line', x1: 0, y1: COACH.top, x2: M.vw, y2: COACH.top,
    color: pal('rule'), width: 1,
  });
  cmds.push({
    op: 'text', value: note, x: M.vw / 2, y: COACH.top + COACH.height / 2,
    style: 'note-center', color: colour,
  });
}

/** The keys of the next character, named in striking order: shift first. */
function describeStrokes(next: Glyph): string {
  return next.strokes
    .map((s) => `${keyLabel(boardKeyFor(s.key, s.finger))} (${FINGER_LABELS[s.finger]})`)
    .join(' + ');
}

function pushKeyboard(cmds: DrawCmd[], state: FrameState, tuning: Tuning): void {
  const spaceThumb = state.spaceThumb ?? DEFAULT_SPACE_THUMB;
  const keys = overlayLayout(state.layout, spaceThumb);
  const extent = overlayExtent(state.layout);
  const originX = (M.vw - extent.w * M.kbUnit) / 2;
  const taught = new Set(state.keySet);
  const next = nextLiveGlyph(state);
  const lit = highlightedKeys(next, state, tuning);

  for (const k of keys) {
    const x = originX + k.x * M.kbUnit + M.keyPad;
    const y = M.kbTop + k.y * M.kbUnit + M.keyPad;
    const w = k.w * M.kbUnit - M.keyPad * 2;
    const h = k.h * M.kbUnit - M.keyPad * 2;
    const isNext = lit.has(k.key);
    // Both shift keys are the one `<shift>` the curriculum teaches, so the
    // right-hand one stops being dim exactly when the left-hand one does.
    const known = taught.has(curriculumKeyFor(k.key));
    cmds.push({
      op: 'rect', x, y, w, h,
      color: pal(isNext ? 'gold' : k.finger),
      alpha: known ? 1 : DIM_ALPHA,
    });
    cmds.push({
      op: 'text', value: keyLabel(k.key), x: x + w / 2, y: y + h / 2,
      style: 'key', color: pal(isNext ? 'bg' : 'keyLabel'),
      alpha: known ? 1 : DIM_ALPHA,
    });
  }

  // Nothing is owed mid-crossing, so nothing is named. A `next:` line during a
  // warp would point at a key on a ribbon that is already leaving.
  if (next !== null && state.warp === undefined) {
    cmds.push({
      op: 'text', value: `next: ${describeStrokes(next)}`,
      x: M.vw / 2, y: M.hintY, style: 'hint-center', color: pal('gold'),
    });
  }
}

function pushReport(cmds: DrawCmd[], state: FrameState): void {
  const card = reportCard(state.keyStats, state.layout, state.spaceThumb ?? DEFAULT_SPACE_THUMB);
  cmds.push({
    op: 'rect', x: 0, y: 0, w: M.vw, h: M.vh, color: pal('panel'), alpha: PANEL_ALPHA,
  });
  cmds.push({
    op: 'text', value: `${state.ref} - report`, x: M.reportX, y: M.reportTitleY,
    style: 'title', color: pal('gold'),
  });
  cmds.push({
    op: 'text',
    value: `WPM ${Math.round(state.score.wpm)}   ACCURACY ${pct(state.score.accuracy)}%   MEDIAN ${Math.round(state.score.medianLatencyMs)}ms`,
    x: M.reportX, y: M.reportTitleY + M.reportLineH, style: 'report', color: pal('hud'),
  });

  const head = ['finger', 'keys', 'acc', 'mean'];
  for (let c = 0; c < head.length; c++) {
    cmds.push({
      op: 'text', value: head[c] ?? '', x: M.reportX + c * M.reportColW, y: M.reportBodyY,
      style: 'report', color: pal('dim'),
    });
  }
  for (let r = 0; r < card.fingers.length; r++) {
    const row = card.fingers[r];
    if (row === undefined) continue;
    const y = M.reportBodyY + (r + 1) * M.reportLineH;
    // An unused finger is drawn dim rather than omitted: eight dim rows is the
    // diagnosis the card exists to deliver.
    const colour = pal(row.hits === 0 ? 'dim' : 'hud');
    const cells = [
      row.label,
      String(row.hits),
      row.hits === 0 ? '-' : `${pct(row.accuracy)}%`,
      row.hits === 0 ? '-' : `${Math.round(row.meanMs)}ms`,
    ];
    for (let c = 0; c < cells.length; c++) {
      cmds.push({
        op: 'text', value: cells[c] ?? '', x: M.reportX + c * M.reportColW, y,
        style: 'report', color: colour,
      });
    }
  }

  cmds.push({
    op: 'text', value: 'worst keys', x: M.reportRightX, y: M.reportBodyY,
    style: 'report', color: pal('dim'),
  });
  if (card.worst.length === 0) {
    cmds.push({
      op: 'text', value: 'none - clean sheet', x: M.reportRightX,
      y: M.reportBodyY + M.reportLineH, style: 'report', color: pal('live'),
    });
  }
  for (let r = 0; r < card.worst.length; r++) {
    const row = card.worst[r];
    if (row === undefined) continue;
    const struck = row.confusedWith === '' ? '' : ` struck ${keyLabel(row.confusedWith)}`;
    cmds.push({
      op: 'text',
      value: `${keyLabel(row.key)}   ${pct(row.errorRate)}% wrong${struck}`,
      x: M.reportRightX, y: M.reportBodyY + (r + 1) * M.reportLineH,
      style: 'report', color: pal('error'),
    });
  }

  cmds.push({
    op: 'text', value: 'enter: next part      r: type it again      esc: menu',
    x: M.reportX, y: M.reportFootY, style: 'report', color: pal('dim'),
  });
}
