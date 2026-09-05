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
import {
  EMPTY_LINE,
  followerCountX,
  followerPoses,
  type FollowerLine,
} from './followers.js';
import { parallaxScale } from './motion.js';
import { setpieceParam, type SetpieceId, type SetpieceState } from './setpieces.js';
import { CANDLE_UNLIT_FRAME, SPRITE_SIZE } from './sprites.js';
import { blendThemeId, roleIndex, worldFor, type ParallaxLayer, type World } from './worlds.js';
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
  partyCountAlpha: 0.7, // tuning-exempt: art -- the count of figures out of shot, quietly
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
 * The report card's composition.
 *
 * Two columns and a foot. The left column is the hands -- the nine-row table and
 * the one sentence that says what its shape means -- and the right column is the
 * keys and the curve. The one line the player is meant to act on sits across the
 * bottom on its own, above the controls, because a sentence indented inside a
 * column reads as a caption of that column.
 *
 * Every number here is `tuning-exempt` on the same grounds as `M` and `SCENE`:
 * it composes a picture, and nothing a player can win or lose by is decided in
 * it. The two `*Cols` are character budgets rather than pixels, which is sound
 * because the card is set in the one monospaced face the renderer gives `report`
 * -- and it is why the wrapping can live in core at all.
 */
const R = {
  x: 44,             // tuning-exempt: report card composition
  rightX: 340,       // tuning-exempt: report card composition
  rightW: 252,       // tuning-exempt: report card composition
  lineH: 14,         // tuning-exempt: report card composition
  titleY: 30,        // tuning-exempt: report card composition
  statY: 48,         // tuning-exempt: report card composition
  statY2: 62,        // tuning-exempt: report card composition
  statMid: 122,      // tuning-exempt: report card composition
  statRight: 206,    // tuning-exempt: report card composition
  headY: 86,         // tuning-exempt: report card composition
  colY: 102,         // tuning-exempt: report card composition
  rowY: 118,         // tuning-exempt: report card composition
  colKeys: 54,       // tuning-exempt: report card composition
  colBar: 96,        // tuning-exempt: report card composition
  barW: 44,          // tuning-exempt: report card composition
  barH: 5,           // tuning-exempt: report card composition
  colAcc: 194,       // tuning-exempt: report card composition
  colMean: 238,      // tuning-exempt: report card composition
  gateHeadY: 180,    // tuning-exempt: report card composition
  gateY: 196,        // tuning-exempt: report card composition
  trendHeadY: 258,   // tuning-exempt: report card composition
  trendY: 266,       // tuning-exempt: report card composition
  trendH: 28,        // tuning-exempt: report card composition
  noteY: 248,        // tuning-exempt: report card composition
  noteCols: 42,      // tuning-exempt: report card composition -- the left column, in characters
  adviceY: 310,      // tuning-exempt: report card composition
  adviceCols: 82,    // tuning-exempt: report card composition -- the whole card, in characters
  footY: 344,        // tuning-exempt: report card composition
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
 * place: a little renderer per flourish, each with its own idea of the bands, is
 * one way per flourish for the picture to disagree with itself.
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
  glowAlpha: 0.3,    // tuning-exempt: art -- how far a light warms a whole band
  emberFloor: 0.4,   // tuning-exempt: art -- a wick that is never quite out
  // Genesis 3. Every one of these is a fraction of the drop from the top of the
  // band to the ground line, or a width in virtual px, and all of them live
  // above that ground line: "keep every one of them behind and above the rail.
  // A serpent in the branches is atmosphere; a serpent near the words is a
  // distraction." The clamp in `bandRect` guarantees the second half of that;
  // these numbers are what keeps the first.
  canopyH: 0.3,      // tuning-exempt: art -- how far down the band a canopy hangs
  boughAt: 0.34,     // tuning-exempt: art -- where the bough crosses, under the canopy
  boughH: 4,         // tuning-exempt: art -- how thick the bough is
  leanTo: 0.32,      // tuning-exempt: art -- how far below the bough a serpent may lean
  serpentW: 3,       // tuning-exempt: art -- the serpent, in virtual px
  trunkW: 6,         // tuning-exempt: art -- a trunk, in virtual px
  fruitSize: 4,      // tuning-exempt: art -- one fruit
  treeW: 4,          // tuning-exempt: art -- a tree in the middle distance
  bladeW: 7,         // tuning-exempt: art -- the sword at its broadest, turning
} as const;

/** The art role the sky behind the parallax takes; every theme supplies one. */
const SKY_ROLE = 'shade';

const PERCENT = 100;         // tuning-exempt: fraction -> percent, a unit, not a knob
const CARET_W = 2;
const DIM_ALPHA = 0.35;      // tuning-exempt: how far an untaught key recedes
const PANEL_ALPHA = 0.94;    // tuning-exempt: report card veils the level behind it
const TREND_ALPHA = 0.7;     // tuning-exempt: art -- an ordinary part on the curve, against a gold one

/**
 * Rows on the "worst keys" table. Five, because docs/design/08-stats.md says five.
 */
const WORST_KEYS = 5;        // tuning-exempt: fixed by docs/design/08-stats.md

/**
 * How far left of a bar the mode rule stands, so it reads as a division between
 * two stretches rather than as a mark on the later one.
 */
const SWITCH_GAP = 1;

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
   * What the record remembers, for the report card: the lifetime key table, the
   * finished parts, and how far the stage is from opening.
   *
   * Optional, and its absence is not an error. The tutor draws frames before a
   * record has been read, and a card that falls back to the session it can see
   * is a smaller loss than a card that cannot be drawn. With it, the hands are
   * read over every part the player has typed rather than over the hundred and
   * fifty keystrokes of this one.
   */
  readonly report?: ReportMemory;
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
   * The standing mode, if the platform is running it.
   *
   * Absent means the blocking default, which is what every existing frame
   * means, and absent produces byte-for-byte the display list it always did.
   * Present and true it changes one thing: the wrong characters in `faults` are
   * drawn in the cells they were struck at, so the page shows what he actually
   * typed and backspace has something visible to remove.
   *
   * It gates the drawing rather than the recording, because `faults` is kept in
   * both modes -- in the blocking one it says which words were not typed clean,
   * and drawing it there would put a wrong letter over the right one the player
   * went on to produce. See
   * docs/decisions/0010-mistakes-may-stand-and-be-deleted.md.
   */
  readonly standing?: boolean;
  /**
   * Wrong characters left standing, by glyph index. Absent or empty draws
   * nothing, and nothing is drawn from it at all unless `standing` is true.
   *
   * A wrong character occupies exactly one cell, like the character it
   * replaced, which is what keeps the reading column where it is: the rail's
   * geometry is `i * CELL_W` and this does not touch `i`.
   */
  readonly faults?: Readonly<Record<number, string>>;
  /**
   * Points earned in this level: gilding, plus what the items were worth.
   *
   * Drawn in the HUD whenever there is a score to draw -- gilding on, or points
   * actually earned -- and omitted at zero with the mode off, because a number
   * nobody can move is not worth the room. It was gilding-only until an ink pot
   * taken on full hearts started scoring
   * (docs/design/03-pacing.md#an-ink-pot-at-full-hearts-must-still-be-worth-something),
   * at which point a beginner could earn points the HUD would not show him --
   * which is the same silence the change was made to end.
   */
  readonly points?: number;
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
   * Draw this frame with the motion reduced.
   *
   * Absent means the full presentation, which is what every frame in the game
   * used to be, and absent produces byte-for-byte the display list it always
   * did. Present and true, the parallax layers stop shifting -- `reduced_parallax`
   * multiplies their authored depths and it is zero -- and nothing else about
   * the picture changes: same bands, same set pieces, same ground line, same
   * focal column.
   *
   * It arrives as *state* rather than being asked for, because
   * `prefers-reduced-motion` is a question only a platform can answer and
   * `core/` never asks a platform anything. The rest of the presentation is not
   * here: the ribbon's step is in `core/rail.ts` and the world's is in the
   * platform's frame loop, because that is where each of those already lived.
   * See docs/design/12-motion-and-comfort.md#what-reduced-motion-changes.
   */
  readonly reduced?: boolean;
  /**
   * The company walking behind the scribe: everyone whose passage he has
   * finished, and everyone whose room he has found.
   *
   * It rides here rather than on `SceneState`, and that placement is the whole
   * of docs/design/11-followers.md#no-abilities-made-structural. `SceneState` is
   * the level the platform *steps*; this is the frame it *draws*. Putting the
   * party on the frame means the level has no followers field for a mechanic to
   * read, and the hearts, the smudge, the cloud and the score are all settled
   * before the party is even assembled.
   *
   * Absent means nobody yet, which is every frame of a new player's first
   * passage, and absent produces byte-for-byte the display list it always did.
   */
  readonly followers?: FollowerLine;
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
   * A follower who has just joined, named in one sentence.
   *
   * Shares the coaching strip, and sits between the two: a first-run note is
   * spent three times in a player's life, an arrival twenty times, and a
   * doorway stands open for the rest of its verse, so the rarer thing wins the
   * strip. The wording is `arrivalLine` in `core/followers.ts`, beside the
   * roster it is formed from.
   * See docs/design/11-followers.md#arriving-with-a-line.
   */
  readonly arrival?: string;
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

/**
 * The palette a scene is easing toward, and how far it has gone.
 *
 * "Colour eases from one scene's palette to the next across the boundary, and
 * tiles change at the boundary itself." The tiles come from `theme`, which cuts;
 * this moves. `mix` is a fraction of the way from this scene's palette to that
 * one, and `core/scenes.ts` computes it from the verse under the cursor -- never
 * from a clock, so the world does not change while the player is thinking.
 *
 * It is two fields rather than a pre-mixed palette because the display list
 * carries palette *indices* and a theme id, never colours. `blendThemeId` folds
 * these into one id the renderer resolves exactly as it resolves any other.
 */
export interface SceneBlend {
  /** A theme id in `core/worlds.ts`. */
  readonly theme: string;
  /** 0 leaves the palette alone; 0.5 is the boundary itself. */
  readonly mix: number;
}

export interface SceneState {
  /** A theme id in `core/worlds.ts`; unknown ids resolve to the abbey. */
  readonly theme: string;
  /**
   * The scene on the other side of a nearby boundary, if there is one.
   *
   * Absent on every settled frame, which is every frame the game used to have --
   * and absent produces byte-for-byte the display list it always did.
   */
  readonly blend?: SceneBlend;
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
//
// docs/design/08-stats.md#the-report-card. This is the primary teaching surface
// in the game, not a score screen, and the per-finger table is the part that
// does the teaching. Everything below is a *reading* of the record; nothing here
// judges the player and nothing here can move a stage.
//
// ## What the table can honestly say, and what it cannot
//
// A key is credited to the finger that *should* strike it, because that is the
// only finger the game knows: the browser delivers a character, never a hand. So
// the table is not a record of which fingers moved. Saying "your right index is
// doing your left pinky's work" would be an invention -- true of the player,
// almost certainly, and not something this data shows.
//
// What the data does show, and shows sharply, is **mean latency per finger**. A
// finger resting on its home key answers in a fraction of the time a finger
// being travelled to does, so a hand that never leaves home row produces means
// inside a narrow band and a two-finger typist produces a spread. That is the
// same signal the mastery gate's latency condition is built on --
// docs/design/06-curriculum.md#the-mastery-gate, "slow-but-accurate is the
// hunt-and-peck signature" -- read per finger instead of per stage. It is the
// finding the card leads with, and `reaching` below is the flag for it.
//
// One skew is worth naming and is in the safe direction: a hit whose latency was
// discarded for following a pause still counts as a hit, so `meanMs` is dragged
// *down* for exactly the keys a player hesitates over. That can hide a slow
// finger; it cannot invent one.

export interface FingerRow {
  readonly finger: Finger;
  readonly label: string;
  readonly hits: number;
  readonly errors: number;
  /** 0..1; zero when the finger was never used. */
  readonly accuracy: number;
  readonly meanMs: number;
  /** This finger's share of every keystroke the card counted. 0..1. */
  readonly share: number;
  /** The current stage's keys this finger is responsible for. */
  readonly keys: readonly Key[];
  /**
   * True when the stage has given this finger no key at all.
   *
   * The distinction between this and `idle` is the whole reason the empty rows
   * are readable rather than merely blank. "Nothing has been asked of this
   * finger yet" is a fact about the curriculum; "this finger has keys and has
   * struck none of them" is a fact about the player. Printing both as a dash
   * would collapse the two, and the row that matters is the second one.
   */
  readonly untaught: boolean;
  /** True when the stage teaches keys for it and not one of them has been struck. */
  readonly idle: boolean;
  /**
   * True when this finger takes at least `report_reach_ratio` times as long per
   * key as the quickest finger with enough samples to be believed. A finger you
   * reach for; not a finger you rest on.
   */
  readonly reaching: boolean;
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
  /** How many of the nine rows the stage has given keys to. */
  readonly taught: number;
  /** The quickest finger with enough samples to be believed, or null. */
  readonly quickest: FingerRow | null;
  /** The slowest finger far enough behind that one to be a finding, or null. */
  readonly slowest: FingerRow | null;
}

/**
 * What the card is a reading of.
 *
 * `keyStats` is the *lifetime* table in the ordinary case, not the session's.
 * One part is a few verses -- a hundred and fifty keystrokes spread over nine
 * fingers -- and nine means built from sixteen samples each is noise presented
 * as a diagnosis. The header line still reports the part; the hands are read
 * over everything the player has typed.
 */
export interface ReportInput {
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  readonly layout: KeyboardLayout;
  readonly spaceThumb?: Thumb;
  /**
   * Everything typable at the current stage. Absent, no row can be called
   * untaught -- the card declines to guess rather than printing "no keys yet"
   * about a finger it has not been told the keys of.
   */
  readonly keySet?: readonly Key[];
}

/**
 * Aggregate per-key statistics into the card.
 *
 * Every finger the game asks for is always present, including the ones with no
 * data. That is the entire point of the table: omitting the empty rows would
 * hide exactly the thing it exists to show.
 *
 * Nine rows, not ten. Only one thumb is on the space bar -- see
 * `keyboard.reportFingers` -- and a permanently empty tenth row would be an
 * artefact of the model rather than a diagnosis of the player, which is the one
 * thing this table must never be.
 */
export function reportCard(input: ReportInput, tuning: Tuning): ReportCard {
  const spaceThumb = input.spaceThumb ?? DEFAULT_SPACE_THUMB;
  const { layout } = input;
  const columns = reportFingers(spaceThumb);
  const minHits = tuningValue(tuning, 'report_finger_min_hits');
  const reachRatio = tuningValue(tuning, 'report_reach_ratio');

  const hits = new Map<Finger, number>();
  const errors = new Map<Finger, number>();
  const totalMs = new Map<Finger, number>();
  const taughtKeys = new Map<Finger, Key[]>();
  for (const f of columns) {
    hits.set(f, 0);
    errors.set(f, 0);
    totalMs.set(f, 0);
  }

  // Which fingers the *stage* has given work to. Without a key set the card
  // cannot tell "not taught" from "not used", so it claims neither.
  const stageKeys = input.keySet;
  if (stageKeys !== undefined) {
    for (const key of stageKeys) {
      const finger = fingerForKey(key, layout, spaceThumb);
      if (finger === null) continue;
      const held = taughtKeys.get(finger);
      if (held === undefined) taughtKeys.set(finger, [key]);
      else held.push(key);
    }
  }

  const worst: WorstKey[] = [];
  let counted = 0;
  for (const [key, stat] of Object.entries(input.keyStats)) {
    const finger = fingerForKey(key, layout, spaceThumb);
    if (finger !== null) {
      hits.set(finger, (hits.get(finger) ?? 0) + stat.hits);
      errors.set(finger, (errors.get(finger) ?? 0) + stat.errors);
      totalMs.set(finger, (totalMs.get(finger) ?? 0) + stat.totalMs);
      counted += stat.hits + stat.errors;
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

  const rows: FingerRow[] = columns.map((finger) => {
    const h = hits.get(finger) ?? 0;
    const e = errors.get(finger) ?? 0;
    const attempts = h + e;
    const keys = taughtKeys.get(finger) ?? [];
    return {
      finger,
      label: FINGER_LABELS[finger],
      hits: h,
      errors: e,
      accuracy: attempts === 0 ? 0 : h / attempts,
      meanMs: h === 0 ? 0 : (totalMs.get(finger) ?? 0) / h,
      share: counted === 0 ? 0 : attempts / counted,
      keys,
      untaught: stageKeys !== undefined && keys.length === 0,
      idle: keys.length > 0 && attempts === 0,
      reaching: false,
    };
  });

  // The spread, measured only over fingers with enough keystrokes behind them.
  // One slow reach for a rare key must not be allowed to libel a finger.
  //
  // The thumb is left out of the comparison entirely, on both sides. It strikes
  // one key, that key is the widest target on the board, and no hand has to
  // travel to it -- so it is always the quickest column and comparing a pinky
  // against it would make every hand in the world look like it was reaching.
  // The question this measurement asks is about the eight fingers that have to
  // find their keys.
  const believable = (r: FingerRow): boolean =>
    !isThumb(r.finger) && r.hits >= minHits && r.meanMs > 0;

  let floor = 0;
  for (const row of rows) {
    if (believable(row) && (floor === 0 || row.meanMs < floor)) floor = row.meanMs;
  }
  const fingers: FingerRow[] = rows.map((row) => ({
    ...row,
    reaching: floor > 0 && believable(row) && row.meanMs >= floor * reachRatio,
  }));

  // Found over `fingers` and not over `rows`, so the row handed back is the
  // identical object the table draws. It was briefly found over `rows`, and the
  // renderer's `row === card.quickest` was then false on every row of every card
  // ever drawn -- an entirely invisible failure, since the only symptom is a
  // highlight that never appears.
  let quickest: FingerRow | null = null;
  let slowest: FingerRow | null = null;
  for (const row of fingers) {
    if (believable(row) && (quickest === null || row.meanMs < quickest.meanMs)) {
      quickest = row;
    }
    if (row.reaching && (slowest === null || row.meanMs > slowest.meanMs)) slowest = row;
  }

  // Rate first, then volume, so a key missed twice out of three does not outrank
  // one missed forty times out of a hundred purely by arithmetic.
  worst.sort((a, b) => b.errorRate - a.errorRate || b.errors - a.errors);
  return {
    fingers,
    worst: worst.slice(0, WORST_KEYS),
    taught: fingers.filter((r) => !r.untaught).length,
    quickest,
    slowest,
  };
}

/** Space is the one thumb key, and no hand travels to it. See `reportCard`. */
function isThumb(finger: Finger): boolean {
  return finger === 'lt' || finger === 'rt';
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

// --- the curve --------------------------------------------------------------

/**
 * One finished stretch of verses, as the curve reads it.
 *
 * Structurally a `HistoryEntry` from `core/progress.ts` with the fields the
 * chart does not draw left off. Declared here rather than imported so the
 * display list depends on no record shape: a port that stores its history
 * differently still draws this chart.
 */
export interface TrendPoint {
  readonly wpm: number;
  readonly accuracy: number;
  /** True when this stretch opened a stage. Drawn gold, and named on the card. */
  readonly promoted: boolean;
  /**
   * True when this stretch was typed with gilding on.
   *
   * Not a colour, unlike `promoted`: gold already means *a stage opened here*
   * and a second meaning for it would make the one bar say two things. What
   * this draws is a rule at the *boundary* between two stretches that disagree,
   * because the mode is not an event -- it is a property of every bar on one
   * side of the line. See docs/design/08-stats.md#history.
   */
  readonly gilding: boolean;
}

export interface Trend {
  /** The window the chart draws, oldest first. */
  readonly points: readonly TrendPoint[];
  /** Every stretch in the record, which is what "so far" is averaged over. */
  readonly parts: number;
  readonly avgWpm: number;
  readonly avgAccuracy: number;
  /** The tallest bar in the window, which is the chart's scale. */
  readonly bestWpm: number;
  readonly promotions: number;
  /** True when the most recently finished stretch opened a stage. */
  readonly justPromoted: boolean;
  /**
   * Indices in `points` that begin a stretch typed in the other mode: the bar
   * immediately right of each mode boundary the chart can see.
   *
   * Never index 0. A boundary is a disagreement between two bars and the first
   * bar in the window has nothing to its left to disagree with -- drawing a rule
   * there would claim a switch that may have happened weeks earlier, or never.
   */
  readonly switches: readonly number[];
  /** True when the most recently finished stretch was typed in the other mode. */
  readonly justSwitched: boolean;
}

/**
 * The progress curve.
 *
 * The running averages are over the *whole* record and the chart is over the
 * last `report_trend_parts`, and those are deliberately different windows: the
 * average is the number the player is beating, and the chart is the shape of
 * the last fortnight. docs/design/08-stats.md opens on why this matters -- the
 * curve is most of the motivation in the first month, and it is the part a
 * beginner cannot feel from the inside.
 */
export function reportTrend(history: readonly TrendPoint[], tuning: Tuning): Trend {
  const window = Math.max(1, Math.trunc(tuningValue(tuning, 'report_trend_parts')));
  const points = history.slice(-window);
  let wpm = 0;
  let accuracy = 0;
  for (const entry of history) {
    wpm += entry.wpm;
    accuracy += entry.accuracy;
  }
  let best = 0;
  let promotions = 0;
  const switches: number[] = [];
  for (const [i, point] of points.entries()) {
    if (point.wpm > best) best = point.wpm;
    if (point.promoted) promotions += 1;
    // A boundary is a disagreement between neighbours, so it needs a neighbour.
    const before = points[i - 1];
    if (before !== undefined && before.gilding !== point.gilding) switches.push(i);
  }
  const last = history[history.length - 1];
  const previous = history[history.length - 2];
  return {
    points,
    parts: history.length,
    avgWpm: history.length === 0 ? 0 : wpm / history.length,
    avgAccuracy: history.length === 0 ? 0 : accuracy / history.length,
    bestWpm: best,
    promotions,
    justPromoted: last !== undefined && last.promoted,
    switches,
    // Read over the whole record rather than the window, exactly as
    // `justPromoted` is: what it answers is "did the question change on the
    // stretch he has just finished", and that is true whether or not the chart
    // happens to be showing the stretch before it.
    justSwitched:
      last !== undefined && previous !== undefined && last.gilding !== previous.gilding,
  };
}

// --- what the card says out loud --------------------------------------------

/**
 * How far the current stage is from opening, as the card needs to say it.
 *
 * Built by the platform from `progress.gateProgress`. Optional on the frame,
 * because the tutor draws before a record exists and a card with no gate line
 * is a smaller loss than a card that cannot be drawn.
 */
export interface GateView {
  /**
   * The stage the gate is being read for.
   *
   * Carried rather than taken off the frame, because after a promotion they
   * differ: the record has moved on and the part still on screen was typed at
   * the old stage. The heading has to name the stage the numbers under it
   * belong to.
   */
  readonly stage: number;
  readonly newKeys: readonly Key[];
  readonly passed: boolean;
  readonly accuracyMet: boolean;
  readonly latencyMet: boolean;
  readonly samples: number;
  readonly accuracy: number;
  readonly medianMs: number;
  readonly requiredAccuracy: number;
  readonly allowedLatencyMs: number;
  readonly requiredSamples: number;
}

/** The record's memory, for the card. Absent, the card reads the session only. */
export interface ReportMemory {
  readonly keyStats: Readonly<Record<Key, KeyStat>>;
  readonly history: readonly TrendPoint[];
  readonly gate?: GateView;
}

/**
 * `1 stretch`, `20 stretches`. A card that says "1 stretches" has stopped being
 * written for anyone.
 *
 * The thing being counted is a chunk of `candle_interval` verses, and the game
 * does not name that on screen -- it names the verses themselves, `Genesis
 * 1:12-14`, wherever one is *identified*. Here it is being *counted*, which a
 * citation cannot do, so it is counted as what it plainly is: a stretch of the
 * page he sat down and typed. See
 * docs/design/03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing.
 */
export function countStretches(n: number): string {
  return n === 1 ? '1 stretch' : `${String(n)} stretches`;
}

/** `e and i`; `c, m, w, v, b and p`. Keys as a player would read them aloud. */
export function nameKeys(keys: readonly Key[]): string {
  const names = keys.map(keyLabel);
  const last = names[names.length - 1];
  if (last === undefined) return '';
  if (names.length === 1) return last;
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

/**
 * The one sentence under the table: what the empty or uneven rows *mean*.
 *
 * The table is the evidence and this is the finding. One finding, never a list:
 * a card that says four things says none of them, and the player reading it has
 * a part to get back to.
 *
 * The order is the order of what is worth knowing. A promotion that has just
 * landed comes first because the next few parts will look like a regression and
 * the player is about to watch it happen -- docs/design/08-stats.md#history
 * requires that be said rather than left to be inferred, and this is the second
 * of the two places it is said.
 */
export function reportNote(card: ReportCard, trend: Trend): string {
  if (trend.justPromoted) {
    return 'A gold mark is a stage opening. More of the page is lit there, so the '
      + 'dip after one is the curriculum, not you.';
  }
  // Second, and for the same reason the promotion note is first: the number he
  // is about to read against the ones before it was not measured over the same
  // job, and he is looking at both on one line. The owner went from 22 wpm to 75
  // this way, and later to 102, without typing any faster.
  if (trend.justSwitched) {
    return 'The rule on the curve is where you changed what the page asks for. The '
      + 'stretches either side of it are two different jobs, so the step is the '
      + 'question moving rather than your hands.';
  }
  const slow = card.slowest;
  const quick = card.quickest;
  if (slow !== null && quick !== null) {
    return `${slow.label} takes ${String(Math.round(slow.meanMs))} ms a key against `
      + `${String(Math.round(quick.meanMs))} on your ${quick.label}. That gap is what `
      + 'reaching for a key costs over resting on it.';
  }
  const idle = card.fingers.filter((row) => row.idle);
  const first = idle[0];
  if (first !== undefined) {
    // One idle finger is worth naming; five is a shape, and naming one of them
    // would understate it. Neither wording accuses: a finger the stage has
    // reached and the player has not is a thing to aim at, not a failure.
    return idle.length === 1
      ? `${first.label} is the finger for ${nameKeys(first.keys)} and has not struck a `
        + 'key yet.'
      : `${String(idle.length)} fingers have keys at this stage and have not been used `
        + 'yet. Those blank rows are the ones to aim at.';
  }
  if (card.taught > 0 && card.taught < card.fingers.length) {
    return 'The blank rows are fingers this stage has no keys for yet. They fill in as '
      + 'the curriculum moves.';
  }
  if (quick === null) {
    return 'Too few keystrokes so far to say much about one finger against another.';
  }
  return 'Your fingers are within reach of each other on speed, which is what touch '
    + 'typing looks like from the inside.';
}

/**
 * One thing to work on next, derived from the data and never from a mood.
 *
 * Ordered by what a player can act on this evening. A single key he is missing
 * is the most actionable thing there is, so it goes first; a finger he is
 * travelling to is the deeper finding, and `reportNote` above is already saying
 * that. The gate's remaining condition comes last because it is the least
 * specific -- "be more accurate" is advice about everything.
 *
 * It never praises and never scolds. "You miss it 34% of the time" is a fact he
 * can do something with; "you are struggling with ;" is a verdict he is not.
 */
export function reportAdvice(card: ReportCard, gate: GateView | undefined, tuning: Tuning): string {
  const minAttempts = tuningValue(tuning, 'report_key_min_attempts');
  const worstRate = tuningValue(tuning, 'report_worst_key_rate');

  const key = card.worst.find(
    (row) => row.hits + row.errors >= minAttempts && row.errorRate >= worstRate,
  );
  if (key !== undefined) {
    const instead = key.confusedWith === ''
      ? ''
      : `, usually striking ${keyLabel(key.confusedWith)} instead`;
    return `Next: the ${keyLabel(key.key)} key — you miss it `
      + `${String(pct(key.errorRate))}% of the time${instead}.`;
  }

  const idle = card.fingers.find((row) => row.idle);
  if (idle !== undefined) {
    return `Next: your ${idle.label} — it is the finger for ${nameKeys(idle.keys)}, and `
      + 'you have not used it yet.';
  }

  const slow = card.slowest;
  const quick = card.quickest;
  if (slow !== null && quick !== null) {
    return `Next: your ${slow.label} — ${String(Math.round(slow.meanMs))} ms a key `
      + `against ${String(Math.round(quick.meanMs))} on your ${quick.label}, which is the `
      + 'difference between resting on a key and travelling to it.';
  }

  if (gate !== undefined && gate.newKeys.length > 0) {
    const keys = nameKeys(gate.newKeys);
    if (gate.samples > 0 && !gate.accuracyMet) {
      return `Next: accuracy on ${keys} — ${String(pct(gate.accuracy))}% over the last `
        + `stretch, and the stage opens at ${String(pct(gate.requiredAccuracy))}%.`;
    }
    if (gate.samples > 0 && !gate.latencyMet) {
      return `Next: speed on ${keys} — ${String(Math.round(gate.medianMs))} ms a key, `
        + `and the stage opens at ${String(Math.round(gate.allowedLatencyMs))} ms.`;
    }
    if (gate.samples < gate.requiredSamples) {
      const owed = Math.max(0, Math.round(gate.requiredSamples - gate.samples));
      return `Next: more of ${keys} — ${String(owed)} more keystrokes on them before `
        + 'the stage can open.';
    }
    return `Next: nothing outstanding — ${keys} are at the standard and the stage `
      + 'opens from here.';
  }

  return 'Next: keep going — a few more verses and this card will have something '
    + 'specific to say.';
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

/** A full-band veil: the one shape four of the flourishes are made of. */
function veil(cmds: DrawCmd[], theme: string, role: string, amount: number): void {
  bandRect(cmds, theme, role, 0, SCENE.top, M.vw, SCENE.height, amount * PIECE.veil);
}

/**
 * How lit the `i`th of `PIECE.motes` things is, as one scalar climbs 0..1.
 *
 * Lamps kindle and baskets fill *one after another* rather than all together,
 * which is the difference between a passage arriving somewhere and a slider
 * being dragged. One line, so the two flourishes that want it cannot disagree.
 */
function inTurn(amount: number, index: number): number {
  return Math.min(1, Math.max(0, amount * PIECE.motes - index));
}

/**
 * One flourish, split into what is drawn behind the scribe and what is drawn
 * over him.
 *
 * The switch is exhaustive by construction -- the `never` in the default is what
 * makes a scene table that grew one more set piece a compile error here as
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
    case 'waters_divided': {
      // The expanse opens: water above it and water below, drawing apart. The
      // band starts full of water and ends with the theme's own sky between two
      // seas, which is what the second day leaves behind.
      const half = SCENE.height / 2;
      const shut = 1 - p('gap');
      const topH = half * shut + PIECE.swellLift * p('swell');
      bandRect(back, theme, 'mid', 0, SCENE.top, M.vw, topH, PIECE.waterAlpha);
      const botH = half * shut;
      bandRect(back, theme, 'mid', 0, ground - botH, M.vw, botH, PIECE.waterAlpha);
      break;
    }
    case 'land_from_water': {
      // The sea drains off the ground, and green closes over what it leaves.
      const water = rise * (1 - p('land'));
      bandRect(back, theme, 'mid', 0, ground - water, M.vw, water, PIECE.waterAlpha);
      const green = PIECE.glowH * p('green');
      bandRect(back, theme, 'light', 0, ground - green, M.vw, green, p('green'));
      break;
    }
    case 'swarming': {
      // Things moving in a band that had nothing moving in it. Spread evenly
      // rather than randomly: `core/rng.ts` exists, and a flourish that consumed
      // draws from it would shift the monster placement stream by being drawn.
      const step = M.vw / PIECE.motes;
      for (let i = 0; i < PIECE.motes; i += 1) {
        const y = SCENE.top + rise * ((i + 1) / (PIECE.motes + 1))
          + PIECE.moteDrift * p('drift');
        bandRect(back, theme, 'accent', i * step + step / 2, y,
          PIECE.moteSize, PIECE.moteSize, p('teeming'));
      }
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
    case 'bruised_reed': {
      // The reed straightens and the wick keeps its ember. `quenched` is zero at
      // every input and nothing here reads it, exactly as nothing reads the
      // bush's `consumed`: the passage says the wick is *not* put out, so the
      // floor under the flicker is the whole point of the picture.
      const x = layout.scribeX + PIECE.bushInset;
      const stalk = PIECE.fireH + (PIECE.glowH - PIECE.fireH) * p('lift');
      bandRect(back, theme, 'light', x, ground - stalk, PIECE.markW, stalk, 1);
      bandRect(back, theme, 'flame', x, ground - stalk - PIECE.moteSize,
        PIECE.markW, PIECE.moteSize, PIECE.emberFloor + (1 - PIECE.emberFloor) * p('ember'));
      break;
    }
    case 'darkness_at_noon': {
      veil(front, theme, 'outline', p('grey'));
      break;
    }
    case 'lifted_up': {
      // A standard rises in the middle of the band and the sky behind it warms.
      const h = rise * p('raised');
      bandRect(back, theme, 'accent', (M.vw - PIECE.markW) / 2, ground - h, PIECE.markW, h, 1);
      bandRect(back, theme, 'accent', (M.vw - PIECE.fireW) / 2, ground - h,
        PIECE.fireW, PIECE.lintelH, p('raised'));
      bandRect(back, theme, 'light', 0, SCENE.top, M.vw, SCENE.height,
        p('glow') * PIECE.glowAlpha);
      break;
    }
    case 'loaves_multiplied': {
      // Baskets fill along the ground, one after another, and there is more at
      // the end of the passage than there was at the start.
      const step = M.vw / PIECE.motes;
      const h = PIECE.moteSize + (PIECE.fireH - PIECE.moteSize) * p('fill');
      for (let i = 0; i < PIECE.motes; i += 1) {
        bandRect(back, theme, 'accent', i * step + step / 2, ground - h,
          PIECE.moteSize + PIECE.moteSize, h, inTurn(p('baskets'), i));
      }
      break;
    }
    case 'lamps_kindled': {
      // The temple lamps kindle one after another down the colonnade, and the
      // whole band takes their light by the end.
      const step = M.vw / PIECE.motes;
      const flicker = PIECE.emberFloor + (1 - PIECE.emberFloor) * p('flame');
      for (let i = 0; i < PIECE.motes; i += 1) {
        bandRect(back, theme, 'flame', i * step + step / 2, ground - PIECE.glowH,
          PIECE.moteSize, PIECE.moteSize, inTurn(p('lamps'), i) * flicker);
      }
      bandRect(back, theme, 'flame', 0, SCENE.top, M.vw, SCENE.height,
        p('blaze') * PIECE.glowAlpha);
      break;
    }
    case 'gate_of_the_fold': {
      // Two leaves swing apart between two posts and stay open. The posts do not
      // move: a gate whose frame moved would read as a wall falling over.
      const middle = M.vw / 2;
      const h = rise;
      const leaf = PIECE.wallW * (1 - p('open'));
      bandRect(back, theme, 'mid', middle - leaf, ground - h, leaf, h, PIECE.waterAlpha);
      bandRect(back, theme, 'mid', middle, ground - h, leaf, h, PIECE.waterAlpha);
      for (const x of [middle - PIECE.wallW - PIECE.markW, middle + PIECE.wallW]) {
        bandRect(back, theme, 'outline', x, ground - h, PIECE.markW, h, 1);
      }
      bandRect(back, theme, 'highlight', middle - PIECE.moteSize
        + PIECE.moteDrift * p('sway'), ground - PIECE.glowH,
        PIECE.moteSize + PIECE.moteSize, PIECE.moteSize, p('flock'));
      break;
    }
    case 'serpent_in_the_branches': {
      // Above, in the branches, and it stays there. The canopy and the bough are
      // fixed -- a tree that moved would read as weather -- and the only thing
      // the completed words move is how far along the bough the serpent has come
      // and how far below it it leans. `leanTo` is a fraction of the drop to the
      // ground, well short of it: the text does not put the serpent on the ground
      // until verse 14, and the ground is where the scribe is walking.
      const canopyBot = SCENE.top + rise * PIECE.canopyH;
      const boughY = SCENE.top + rise * PIECE.boughAt;
      const from = layout.scribeX + PIECE.bushInset - M.vw;
      bandRect(back, theme, 'light', from, SCENE.top, M.vw, canopyBot - SCENE.top, PIECE.waterAlpha);
      bandRect(back, theme, 'outline', from, boughY, M.vw, PIECE.boughH, 1);
      // Along the bough first, then leaning off it. Both are the same word count
      // read twice, which is what makes the tableau player-paced.
      const along = M.vw * p('coil');
      bandRect(back, theme, 'accent', from + M.vw - along, boughY - PIECE.serpentW,
        along, PIECE.serpentW, 1);
      const drop = rise * PIECE.leanTo * p('lean');
      bandRect(back, theme, 'accent',
        from + M.vw - along + PIECE.moteDrift * p('sway'), boughY + PIECE.boughH,
        PIECE.serpentW, drop, 1);
      break;
    }
    case 'fruit_taken': {
      // The tree stands still and one fruit leaves it. Nothing else in the frame
      // moves, because nothing else in the verse does.
      const canopyBot = SCENE.top + rise * PIECE.canopyH;
      const x = layout.scribeX + PIECE.bushInset;
      bandRect(back, theme, 'light', x - PIECE.fireW, SCENE.top,
        PIECE.fireW + PIECE.fireW, canopyBot - SCENE.top, PIECE.waterAlpha);
      bandRect(back, theme, 'outline', x, canopyBot, PIECE.trunkW, ground - canopyBot, 1);
      // Still on the bough, fading as it is taken.
      bandRect(back, theme, 'blood', x - PIECE.fireW, canopyBot - PIECE.fruitSize,
        PIECE.fruitSize, PIECE.fruitSize, p('ripe'));
      // And the one that is taken, coming down out of the canopy.
      const fallen = canopyBot + (ground - PIECE.fruitSize - canopyBot) * p('taken');
      bandRect(back, theme, 'blood', x + PIECE.trunkW + PIECE.moteDrift * p('sway'), fallen,
        PIECE.fruitSize, PIECE.fruitSize, 1);
      break;
    }
    case 'fig_leaves': {
      // Leaves closing along the ground, one after another -- `inTurn`, the same
      // line the lamps and the baskets use, because sewing them together happens
      // in an order and a slider being dragged does not.
      const step = M.vw / PIECE.motes;
      const h = PIECE.lintelH + (PIECE.fireH - PIECE.lintelH) * p('sewn');
      bandRect(back, theme, 'light', 0, ground - PIECE.lintelH, M.vw, PIECE.lintelH, p('cover'));
      for (let i = 0; i < PIECE.motes; i += 1) {
        bandRect(back, theme, 'light', i * step + step / 2 + PIECE.moteDrift * p('sway'),
          ground - h, PIECE.fireW, h, inTurn(p('cover'), i));
      }
      break;
    }
    case 'walking_in_the_garden': {
      // The cool of the day: the light goes out of the band, the trees stir, and
      // a shade gathers along the ground. Nobody is drawn. The text says they
      // *heard*, and a figure walking in the garden would be the scenery making a
      // claim the passage does not.
      const step = M.vw / PIECE.motes;
      for (let i = 0; i < PIECE.motes; i += 1) {
        bandRect(back, theme, 'outline', i * step + PIECE.moteDrift * p('stir'),
          SCENE.top, PIECE.treeW, rise, PIECE.waterAlpha);
      }
      bandRect(back, theme, 'shade', 0, ground - PIECE.glowH, M.vw, PIECE.glowH, p('hidden'));
      veil(front, theme, 'shade', p('cool'));
      break;
    }
    case 'flaming_sword': {
      // The one verse of the chapter that travels, so this plays over a world
      // that has started scrolling again. The way back closes behind him, and the
      // blade turns every way -- which is a width rather than a rotation, because
      // a bar that narrows to a line and opens out again is what a turning blade
      // looks like from one side.
      const x = layout.scribeX - PIECE.bushInset;
      const h = rise * p('closed');
      bandRect(back, theme, 'outline', x, ground - h, PIECE.wallW, h, 1);
      const w = 1 + PIECE.bladeW * p('turn');
      bandRect(front, theme, 'flame', x + PIECE.wallW / 2 - w / 2, ground - rise * PIECE.leanTo,
        w, rise * PIECE.leanTo, PIECE.emberFloor + (1 - PIECE.emberFloor) * p('flame'));
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
function pushScene(
  cmds: DrawCmd[],
  scene: SceneState,
  followers: FollowerLine,
  tuning: Tuning,
  reduced: boolean,
): void {
  const world = worldFor(scene.theme);
  // The tiles, the layer geometry and the ground line all come from the world
  // this scene *is*; only the colours move. That is the whole of "the palette
  // eases and the tiles cut", and it is one line because the display list
  // already separates the two: a `tile` command names its pixels by id and its
  // colours by theme.
  const theme = scene.blend === undefined
    ? world.id
    : blendThemeId(world.id, scene.blend.theme, scene.blend.mix);
  const projection = projectionOf(world.parallax);
  const layout = layoutIn(world, scene.scribe.x);

  // The sky. A themed `rect`, which is what the `theme` field buys: the same
  // command shape, resolved through the art palette instead of the interface one.
  cmds.push({
    op: 'rect', x: 0, y: SCENE.top, w: M.vw, h: SCENE.height,
    color: roleIndex(SKY_ROLE), theme,
  });

  // A layer lags the camera by its own depth; the ground alone keeps up. In
  // reduced motion every depth is multiplied by `reduced_parallax`, which is
  // zero, so the layers hold still: several fields moving at differing rates is
  // the strongest half of the stimulus and the least load-bearing part of the
  // picture. docs/design/12-motion-and-comfort.md#what-reduced-motion-changes
  const depth = parallaxScale(tuning, reduced);
  for (const layer of world.parallax) {
    const y = px(projY(projection, layer.y));
    const h = Math.max(1, Math.round(projH(projection, layer.h)));
    const shift = wrapToTile(scene.cameraX * layer.factor * depth);
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

  // The company, behind him and on the same ground line. Drawn before the
  // scribe so that he is in front of them however tight the spacing is put, and
  // drawn back to front among themselves for the same reason.
  pushFollowers(cmds, followers, layout, scene, theme, tuning);

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
 * The line walking behind the scribe.
 *
 * docs/design/11-followers.md#they-must-not-compete-with-the-rail is a list of
 * things this function must not do, and every one of them is arranged for rather
 * than remembered:
 *
 *  - **Behind him, never ahead.** `core/followers.ts` places every figure at
 *    `scribeX` minus a whole multiple of the spacing, so there is no arithmetic
 *    here that could put one in front.
 *  - **Never above the ground line.** Every pose stands on `groundY`, and the
 *    settle is drawn inside the art rather than by moving the sprite, so a
 *    follower's y is a constant.
 *  - **Never in the reading band.** The figures are sixteen pixels tall with
 *    their feet on the same line the scribe's are on, which is the line the
 *    scenery band ends at.
 *  - **No speech, no icons, no numbers over heads.** At most two sprites per
 *    figure -- a body and the thing it carries, and only the body for a figure
 *    carrying nothing -- and the one number on screen is the count of the
 *    figures that are *not* here, standing where the next of them would have
 *    been.
 *
 * The mark is a second command rather than a second sheet of bespoke sprites,
 * which is what keeps twenty figures down to four silhouettes and nineteen
 * small pictures. See the follower section of `core/sprites.ts`.
 */
function pushFollowers(
  cmds: DrawCmd[],
  line: FollowerLine,
  layout: SceneLayout,
  scene: SceneState,
  theme: string,
  tuning: Tuning,
): void {
  if (line.walking.length === 0 && line.unseen === 0) return;
  const geometry = {
    scribeX: layout.scribeX,
    groundY: layout.groundY,
    walking: scene.walking,
    animMs: scene.animMs,
  };
  const poses = followerPoses(line, geometry, tuning);
  // Furthest first, so a nearer figure is painted over a further one and the
  // line reads as depth rather than as a row of cut-outs.
  for (let i = poses.length - 1; i >= 0; i -= 1) {
    const pose = poses[i];
    if (pose === undefined) continue;
    const x = px(pose.x);
    if (!onScreen(x)) continue;
    const y = px(pose.y);
    cmds.push({ op: 'sprite', id: pose.bodyId, x, y, frame: pose.frame, theme });
    // A figure carrying nothing emits no second command at all, rather than a
    // blank sprite: docs/design/11-followers.md#a-figure-may-carry-nothing.
    if (pose.markId !== null) cmds.push({ op: 'sprite', id: pose.markId, x, y, theme });
  }
  if (line.unseen > 0) {
    // Where the next figure would have stood, on the ground line, in the
    // interface colour. Not over anybody, and nowhere near the rail.
    cmds.push({
      op: 'text',
      value: `+${String(line.unseen)}`,
      x: px(followerCountX(line, geometry, tuning)),
      y: px(layout.groundY - SPRITE_SIZE / 2),
      style: 'hud',
      color: pal('hud'),
      alpha: SCENE.partyCountAlpha,
    });
  }
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
function pushWarpWorld(
  cmds: DrawCmd[],
  warp: WarpView,
  tuning: Tuning,
  reduced: boolean,
): void {
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
    // The arriving world holds still too, or a crossing would be the one place
    // in the game where a reduced presentation still slid three layers past a
    // fixed gaze point. The crossfade itself is untouched: it is 1.4 seconds,
    // it is what the crossing *is*, and it is not what anybody adapted to.
    const shift = wrapToTile(warp.cameraX * layer.factor * parallaxScale(tuning, reduced));
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
  const reduced = state.reduced === true;
  if (state.scene !== undefined) {
    pushScene(cmds, state.scene, state.followers ?? EMPTY_LINE, tuning, reduced);
  }
  const warp = state.warp;
  if (warp !== undefined) pushWarpWorld(cmds, warp, tuning, reduced);
  pushHud(cmds, state, tuning);
  pushRail(cmds, state, rail, tuning);
  // After the rail, so nothing of either ribbon can be drawn over the phrase
  // the crossing exists to hold still.
  if (warp !== undefined) pushHeldEcho(cmds, warp);
  // One sentence, in the one strip reserved for one, and the rarer thing wins
  // it. A first-run note is spent three times in a player's life and never comes
  // back; a follower arrives twenty times; a doorway stands open for the rest
  // of its verse. docs/design/11-followers.md#arriving-with-a-line.
  const note = state.note;
  const arrival = state.arrival;
  const doorway = state.doorway;
  if (note !== undefined && note.length > 0) pushNote(cmds, note, pal('hud'));
  else if (arrival !== undefined && arrival.length > 0) pushNote(cmds, arrival, pal('live'));
  else if (doorway !== undefined && doorway.length > 0) pushNote(cmds, doorway, pal('live'));
  // Reading mode asks for nothing, so it points at nothing. A board lit for a
  // key the player is not being asked for would be the overlay lying.
  if (state.mode === 'lectio') pushReadingHint(cmds);
  else {
    // Behind the board, so the picture is *uncovered* as keys retire rather
    // than introduced at some threshold. Reading mode gets neither: it asks for
    // no keys, and a quill moving for somebody who is not typing would be the
    // one thing the whole band is forbidden to do.
    pushLectern(cmds, state, tuning);
    pushKeyboard(cmds, state, tuning);
  }
  if (state.mode === 'report') pushReport(cmds, state, tuning);
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
  // The score joins the centre line rather than taking a corner of its own: it is
  // a score for the same stretch of typing the WPM and accuracy describe, and the
  // corners are already the player's health and their stage.
  //
  // Shown while gilding, which always has a score to show, and otherwise only
  // once something has actually been earned -- an ink pot taken on full hearts.
  // Zero with nothing scoring is left off: a number the player cannot move is
  // one more thing on a screen whose whole job is to hold his eye on one place.
  const points = Math.round(state.points ?? 0);
  const score = state.gilding === true || points > 0 ? `    SCORE ${points}` : '';
  // Reading mode reports the pace it is flowing at and nothing else. An accuracy
  // in a mode with no keystrokes in it would be a number the player cannot move,
  // and a WPM would read as a score for something he is not doing.
  cmds.push({
    op: 'text',
    value: state.mode === 'lectio'
      ? `READING    pace ${Math.round(state.score.wpm)} wpm`
      : `WPM ${Math.round(state.score.wpm)}    ACC ${pct(state.score.accuracy)}%${score}`,
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
function pushSpaceMark(
  cmds: DrawCmd[],
  i: number,
  state: FrameState,
  offset: number,
  slot?: string,
): void {
  const current = i === state.cursor;
  // A struck space is neither pending nor current: it is a mistake standing on
  // the page, so it takes the full cell like the caret's own mark and the error
  // colour with it. That is why the slot may be named by the caller.
  const marked = slot !== undefined;
  const inset = current || marked ? 0 : M.spaceMarkInset;
  cmds.push({
    op: 'rect',
    x: i * CELL_W + offset + inset,
    y: M.spaceMarkY,
    w: CELL_W - inset * 2,
    h: M.spaceMarkH,
    color: pal(slot ?? (current ? (state.blocked ? 'error' : 'gold') : 'rule')),
  });
}

function pushRail(cmds: DrawCmd[], state: FrameState, rail: RailState, tuning: Tuning): void {
  cmds.push({ op: 'rect', x: 0, y: M.bandTop, w: M.vw, h: M.bandH, color: pal('band') });

  const x0 = focalX(M.vw, tuning);
  const { first, last } = visibleRange(state.glyphs.length, rail.offset, M.vw);
  const faults = state.standing === true ? state.faults : undefined;
  for (let i = first; i < last; i++) {
    const g = state.glyphs[i];
    if (g === undefined || g.ch === '\n') continue;
    const struck = faults?.[i];
    if (struck !== undefined) {
      // What he actually typed, in the cell the right letter wanted, marked
      // wrong. A struck space prints nothing, so it takes the affordance's own
      // mark in the error colour rather than leaving the cell looking empty --
      // an empty cell would read as a character already deleted.
      if (struck === ' ') pushSpaceMark(cmds, i, state, rail.offset, 'error');
      else {
        cmds.push({
          op: 'text', value: struck, x: i * CELL_W + rail.offset, y: M.railBaseY,
          style: 'rail-error', color: pal('error'),
        });
      }
      continue;
    }
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
 * Earned fade-out: a key stops being drawn once its accuracy clears the mastery
 * threshold. The crutch withdraws itself key by key, without the player ever
 * having to decide to give it up.
 *
 * Read over the **lifetime** table when the frame carries one, and over the
 * session's only when it does not. A key is earned over weeks, and `keyStats`
 * on the frame is what this part has seen -- a hundred and fifty keystrokes
 * spread over nine fingers, which is fewer than `mastery_min_samples` on most
 * of them. Judged from that, a key that a player retired months ago comes back
 * at the top of every stretch and the crutch is never actually given up. Same
 * reasoning as the report card's, which reads the lifetime table for the same
 * reason. See docs/design/06-curriculum.md#breaking-the-looking-down-habit.
 */
function isMastered(key: Key, state: FrameState, tuning: Tuning): boolean {
  const stat = (state.report?.keyStats ?? state.keyStats)[key];
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

/**
 * The scribe at his lectern: the composition of the band the keyboard vacates.
 *
 * Every number is `tuning-exempt` on the same grounds as `M`, `SCENE` and
 * `PIECE`: it composes a picture inside a band, and nothing a player can win or
 * lose by is decided in it. The board runs from `M.kbTop` to `M.kbTop + 130`,
 * and the whole vignette is drawn inside that -- it is below the rail by
 * construction and there is no arithmetic here that could reach up into it.
 *
 * He is drawn from rects rather than from `scribe_idle`, and the reason is
 * scale rather than taste: a sprite is 16 px by contract, the band is 130, and
 * a sixteen-pixel figure in it would be an ornament in the middle of an empty
 * strip -- which is the one thing docs/design/02-rail.md#the-scribe-at-his-lectern
 * says this must not be. The set pieces already draw serpents, trees and a
 * turning sword out of rects for the same reason. He is the same scribe because
 * he is the same *roles*: `robe` over `robeShade` with `skin` inside the hood,
 * resolved through the world he is walking in, so his habit is the colour it is
 * in the band above.
 */
const LECTERN = {
  floorY: M.kbTop + 118,  // tuning-exempt: band composition
  headTop: 244,           // tuning-exempt: band composition
  hoodX: 182,             // tuning-exempt: band composition
  hoodW: 28,              // tuning-exempt: band composition
  hoodH: 24,              // tuning-exempt: band composition
  browH: 8,               // tuning-exempt: band composition
  faceInset: 6,           // tuning-exempt: band composition
  faceTop: 8,             // tuning-exempt: band composition
  faceH: 14,              // tuning-exempt: band composition
  bodyTop: 268,           // tuning-exempt: band composition
  bodySteps: 3,           // tuning-exempt: band composition -- a robe, in three widths
  bodyStepH: 20,          // tuning-exempt: band composition
  bodyStepW: 8,           // tuning-exempt: band composition -- how much each step flares
  shoulderW: 36,          // tuning-exempt: band composition
  armTop: 274,            // tuning-exempt: band composition
  armSteps: 4,            // tuning-exempt: band composition
  armW: 10,               // tuning-exempt: band composition
  armH: 5,                // tuning-exempt: band composition
  armStepX: 9,            // tuning-exempt: band composition
  armStepY: 4,            // tuning-exempt: band composition
  handW: 7,               // tuning-exempt: band composition
  pageX: 246,             // tuning-exempt: band composition
  pageY: 262,             // tuning-exempt: band composition
  pageW: 132,             // tuning-exempt: band composition
  slats: 9,               // tuning-exempt: band composition -- lines a page holds
  slatH: 5,               // tuning-exempt: band composition
  slatSkew: 2,            // tuning-exempt: band composition -- the tilt of the desk
  boardPad: 5,            // tuning-exempt: band composition -- the board under the page
  inkPad: 5,              // tuning-exempt: band composition
  inkH: 2,                // tuning-exempt: band composition
  stemW: 16,              // tuning-exempt: band composition
  footW: 62,              // tuning-exempt: band composition
  footH: 6,               // tuning-exempt: band composition
  quillSteps: 8,          // tuning-exempt: band composition -- the shaft, in dabs
  quillDab: 2,            // tuning-exempt: band composition
  quillRise: 22,          // tuning-exempt: band composition -- how far the hand is above the nib
  quillLean: 10,          // tuning-exempt: band composition -- and how far behind it
} as const;

/**
 * How much of the stage's board the player has earned his way out of, 0..1.
 *
 * The share of the keys the curriculum has taught him that have passed the
 * mastery threshold. It is what the lectern's presence is drawn from, so the
 * picture arrives at exactly the rate the crutch leaves: nothing is announced
 * and there is no moment at which it appears.
 */
function retiredShare(state: FrameState, tuning: Tuning): number {
  const keys = state.keySet;
  if (keys.length === 0) return 0;
  let retired = 0;
  for (const key of keys) if (isMastered(key, state, tuning)) retired += 1;
  return retired / keys.length;
}

/**
 * The scribe at his lectern, in the band the keyboard is giving back.
 *
 * The best reward the game has, because it is the thing the game is about: he
 * stops needing the keys drawn for him and gets to watch himself write. So
 * nothing announces it. It is drawn behind the board at the alpha the board has
 * retired to, which means it arrives one key at a time and there is no frame on
 * which it appears -- the crutch simply becomes the work.
 * See docs/design/02-rail.md#the-scribe-at-his-lectern.
 *
 * Three rules it inherits, and all three are structural here rather than
 * remembered:
 *
 *  - **It is below the rail and never enters it.** Every y below is inside the
 *    keyboard's own band, which begins 34 px under the reading band's floor.
 *  - **It never competes with the text.** No gold, nothing that blinks, and its
 *    alpha is the share of the board that has gone, so it is faintest exactly
 *    when the player still needs to look at the keys.
 *  - **It moves only when the player types.** The quill's position and the
 *    written lines are functions of `cursor` and of nothing else. No `animMs`
 *    reaches this function, and none may: a quill scratching while somebody is
 *    thinking is the same lie as a world that scrolls without him.
 *
 * The page holds the stretch he is copying -- `slats` lines, sized to the part,
 * so the last character of the part is the last character of the page. That is
 * what makes a finished page mean something rather than being a loop.
 */
function pushLectern(cmds: DrawCmd[], state: FrameState, tuning: Tuning): void {
  const scene = state.scene;
  // No world, no scribe: the tutor draws frames before there is a scenery band,
  // and those frames stay byte-for-byte what they always were.
  if (scene === undefined) return;
  const share = retiredShare(state, tuning);
  if (share <= 0) return;
  const theme = worldFor(scene.theme).id;

  const put = (x: number, y: number, w: number, h: number, role: string): void => {
    cmds.push({
      op: 'rect',
      x: px(x), y: px(y),
      w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)),
      color: roleIndex(role), alpha: share, theme,
    });
  };

  const L = LECTERN;
  const slatY = (i: number): number => L.pageY + i * L.slatH;
  const slatX = (i: number): number => L.pageX + i * L.slatSkew;
  const lastSlat = L.slats - 1;

  // The desk, from the floor up: a foot, a stem, and a board under the page.
  const stemX = slatX(lastSlat) + L.pageW / 2 - L.stemW / 2;
  put(stemX - L.footW / 2 + L.stemW / 2, L.floorY, L.footW, L.footH, 'shade');
  put(stemX, slatY(lastSlat) + L.slatH, L.stemW, L.floorY - slatY(lastSlat) - L.slatH, 'shade');
  for (let i = 0; i < L.slats; i++) {
    put(slatX(i) - L.boardPad, slatY(i) + L.slatH, L.pageW + L.boardPad * 2, L.slatH, 'mid');
  }

  // The page: one slat per line of copy, stepped right as it comes down, which
  // is the tilt of a lectern without a single diagonal to draw.
  for (let i = 0; i < L.slats; i++) put(slatX(i), slatY(i), L.pageW, L.slatH, 'light');

  // What he has written. A line per line, and the one under the quill is filled
  // as far as he has got along it -- both read off the cursor, so the page is a
  // picture of the passage rather than of the clock.
  const perLine = Math.max(1, Math.ceil(state.glyphs.length / L.slats));
  const at = Math.max(0, Math.min(state.cursor, state.glyphs.length));
  const line = Math.min(lastSlat, Math.floor(at / perLine));
  const runW = L.pageW - L.inkPad * 2;
  for (let i = 0; i < line; i++) {
    put(slatX(i) + L.inkPad, slatY(i) + L.inkH / 2, runW, L.inkH, 'outline');
  }
  const along = Math.max(0, Math.min(1, (at - line * perLine) / perLine));
  const nibX = slatX(line) + L.inkPad + runW * along;
  const nibY = slatY(line) + L.inkH / 2;
  if (along > 0) {
    put(slatX(line) + L.inkPad, nibY, runW * along, L.inkH, 'outline');
  }

  // The scribe. A hood over a robe that flares to the hem, and one arm out over
  // the page -- the same three roles the sprite in the band above is painted in.
  const hoodMid = L.hoodX + L.hoodW / 2;
  put(L.hoodX, L.headTop, L.hoodW, L.hoodH, 'robe');
  put(L.hoodX, L.headTop, L.hoodW, L.browH, 'robeShade');
  put(
    L.hoodX + L.faceInset, L.headTop + L.faceTop,
    L.hoodW - L.faceInset * 2, L.faceH, 'skin',
  );
  for (let i = 0; i < L.bodySteps; i++) {
    const w = L.shoulderW + i * L.bodyStepW;
    put(hoodMid - w / 2, L.bodyTop + i * L.bodyStepH, w, L.bodyStepH, i === 0 ? 'robe' : 'robeShade');
  }
  const armX = hoodMid + L.shoulderW / 2 - L.armW;
  for (let i = 0; i < L.armSteps; i++) {
    put(armX + i * L.armStepX, L.armTop + i * L.armStepY, L.armW, L.armH, 'robe');
  }
  const handX = armX + L.armSteps * L.armStepX;
  const handY = L.armTop + L.armSteps * L.armStepY;

  // The quill, as a line of dabs from the hand to the nib, so it pivots as he
  // writes across the line. Dabs rather than a `line` command because a line
  // carries neither an alpha nor a theme, and this has to fade in with the rest
  // of the picture and be the colour of the world it is in.
  const fromX = nibX - L.quillLean;
  const fromY = nibY - L.quillRise;
  for (let i = 0; i < L.quillSteps; i++) {
    const t = i / L.quillSteps;
    put(
      fromX + (nibX - fromX) * t, fromY + (nibY - fromY) * t,
      L.quillDab, L.quillDab, i === L.quillSteps - 1 ? 'outline' : 'accent',
    );
  }
  put(nibX, nibY, L.quillDab, L.quillDab, 'outline');
  // And his hand rides the quill's shaft, so the arm reads as holding it rather
  // than as pointing near it.
  put(handX, handY, L.handW, L.handW, 'skin');
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
    const curriculum = curriculumKeyFor(k.key);
    const known = taught.has(curriculum);
    // A key he has earned his way out of is not drawn at all. That is what
    // "the curriculum retires the overlay a key at a time" has always meant,
    // and it is what empties the band for a player who has arrived -- what is
    // behind it is `pushLectern`, drawn first so it is uncovered rather than
    // introduced. An untaught key is *not* retired: it is still dim, because it
    // is still something he has not been given.
    if (known && isMastered(curriculum, state, tuning)) continue;
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

/**
 * Break a sentence into lines of at most `cols` characters.
 *
 * Legitimate in core only because the card is set in a monospaced face -- the
 * renderer gives `report` one, and the styles table is the contract. A
 * proportional face would make this the platform's arithmetic, not ours.
 */
function wrapText(text: string, cols: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line === '') line = word;
    else if (line.length + word.length + 1 <= cols) line = `${line} ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line !== '') out.push(line);
  return out;
}

/** The progress curve: one bar per finished stretch of verses, promotions in gold. */
function pushTrend(cmds: DrawCmd[], trend: Trend): void {
  const n = trend.points.length;
  if (n === 0) return;
  // A part typed at nought words a minute is not a part; the floor keeps the
  // scale off a division by zero without inventing a number for the chart.
  const top = Math.max(1, trend.bestWpm);
  const slot = R.rightW / n;
  const width = Math.max(1, slot - 1);
  const base = R.trendY + R.trendH;

  cmds.push({
    op: 'line', x1: R.rightX, y1: base, x2: R.rightX + R.rightW, y2: base,
    color: pal('rule'), width: 1,
  });
  for (let i = 0; i < n; i++) {
    const point = trend.points[i];
    if (point === undefined) continue;
    const h = Math.max(1, Math.round((point.wpm / top) * R.trendH));
    cmds.push({
      op: 'rect',
      x: R.rightX + i * slot,
      y: base - h,
      w: width,
      h,
      color: pal(point.promoted ? 'gold' : 'hud'),
      alpha: point.promoted ? 1 : TREND_ALPHA,
    });
  }
  // Where what the game was asking for changed. A rule *between* two bars and
  // not a colour on one of them: gold already means a stage opened, and the mode
  // is not an event -- it is a property of every bar on one side of the line. It
  // is drawn after the bars and in the guide's own quiet colour, because it is
  // the chart's own furniture rather than one of his evenings.
  for (const at of trend.switches) {
    const x = R.rightX + at * slot - SWITCH_GAP;
    cmds.push({
      op: 'line', x1: x, y1: R.trendY, x2: x, y2: base,
      color: pal('rule'), width: 1,
    });
  }
}

/**
 * The report card.
 *
 * Shown at the end of every part, and reachable from the menu, which is the
 * same picture read at a different moment. It is a teaching surface and not a
 * ceremony: nothing on it animates, nothing waits, and Enter is live from the
 * first frame -- docs/design/08-stats.md#the-report-card. A fluent typist
 * finishing a part a minute must be able to leave it in one keystroke, and a
 * beginner must be able to sit with it for as long as he likes.
 */
function pushReport(cmds: DrawCmd[], state: FrameState, tuning: Tuning): void {
  const spaceThumb = state.spaceThumb ?? DEFAULT_SPACE_THUMB;
  const memory = state.report;
  const card = reportCard(
    {
      keyStats: memory?.keyStats ?? state.keyStats,
      layout: state.layout,
      spaceThumb,
      keySet: state.keySet,
    },
    tuning,
  );
  const trend = reportTrend(memory?.history ?? [], tuning);
  const gate = memory?.gate;

  cmds.push({
    op: 'rect', x: 0, y: 0, w: M.vw, h: M.vh, color: pal('panel'), alpha: PANEL_ALPHA,
  });
  cmds.push({
    op: 'text', value: `${state.ref} - report`, x: R.x, y: R.titleY,
    style: 'title', color: pal('gold'),
  });

  // The two header rows. "so far" is the running average the level's number is
  // read against; without it a good part and a bad one look the same.
  const headerRow = (y: number, label: string, cells: readonly string[], colour: number): void => {
    cmds.push({ op: 'text', value: label, x: R.x, y, style: 'report', color: pal('dim') });
    const xs = [R.x + R.colKeys, R.x + R.statMid, R.x + R.statRight];
    for (let i = 0; i < cells.length; i++) {
      cmds.push({
        op: 'text', value: cells[i] ?? '', x: xs[i] ?? R.x, y, style: 'report', color: colour,
      });
    }
  };
  headerRow(R.statY, 'these verses', [
    `${String(Math.round(state.score.wpm))} wpm`,
    `${String(pct(state.score.accuracy))}% accurate`,
    `${String(Math.round(state.score.medianLatencyMs))} ms a key`,
  ], pal('hud'));
  if (trend.parts > 0) {
    headerRow(R.statY2, 'so far', [
      `${String(Math.round(trend.avgWpm))} wpm`,
      `${String(pct(trend.avgAccuracy))}% accurate`,
      countStretches(trend.parts),
    ], pal('done'));
  }

  // --- the hands ------------------------------------------------------------
  //
  // Gilding names its own blind spot in the heading rather than in a footnote.
  // In that mode the player types more than this table can count -- a gilded
  // character records no key statistics at all, which is what makes the mastery
  // gate's guarantee structural rather than careful (ADR 0008) -- and a table
  // that quietly reported the taught half as the whole would be the card
  // lying about the one player who can tell.
  cmds.push({
    op: 'text',
    value: state.gilding === true
      ? 'your hands - the keys your stage teaches'
      : 'your hands - everything you have typed',
    x: R.x, y: R.headY, style: 'report', color: pal('dim'),
  });
  const head: readonly (readonly [string, number])[] = [
    ['finger', 0], ['struck', R.colKeys], ['share', R.colBar],
    ['acc', R.colAcc], ['mean', R.colMean],
  ];
  for (const [label, dx] of head) {
    cmds.push({
      op: 'text', value: label, x: R.x + dx, y: R.colY, style: 'report', color: pal('dim'),
    });
  }

  let busiest = 0;
  for (const row of card.fingers) if (row.share > busiest) busiest = row.share;

  for (let r = 0; r < card.fingers.length; r++) {
    const row = card.fingers[r];
    if (row === undefined) continue;
    const y = R.rowY + r * R.lineH;
    // Three states, three weights. A finger with data is ordinary text; a finger
    // the stage has taught and the player has not used is *brighter*, because it
    // is the one row here that is a finding about him; a finger the stage has
    // not reached yet recedes, because it is not his fault and not yet his job.
    const colour = row.hits > 0 ? pal('hud') : row.idle ? pal('live') : pal('dim');
    cmds.push({ op: 'text', value: row.label, x: R.x, y, style: 'report', color: colour });
    cmds.push({
      op: 'text', value: String(row.hits + row.errors),
      x: R.x + R.colKeys, y, style: 'report', color: colour,
    });

    // The share bar, in the finger's own overlay colour, so the table and the
    // keyboard below it are read as the same picture of the same hand.
    // Scaled against the busiest finger rather than against the whole hand: no
    // single finger ever approaches all of the keystrokes, so a bar drawn as a
    // fraction of the total is nine short stubs and says nothing. Against the
    // busiest one, the row lengths *are* the shape of the hand, which is the
    // only thing this column is for -- the numbers are in the columns beside it.
    if (row.share > 0 && busiest > 0) {
      cmds.push({
        op: 'rect', x: R.x + R.colBar, y: y - R.barH / 2,
        w: Math.max(1, Math.round((row.share / busiest) * R.barW)), h: R.barH,
        color: pal(row.finger),
      });
    }

    if (row.hits === 0) {
      // The empty row says which kind of empty it is. This is the sentence the
      // whole table is for: a blank the curriculum has not filled in yet reads
      // nothing like a finger the player is not using.
      cmds.push({
        op: 'text',
        value: row.untaught ? 'no keys at this stage' : 'not used yet',
        // Where the bar would have been, running across the two number columns:
        // the sentence is what this row has instead of numbers, and starting it
        // in the accuracy column would push it into the worst-keys list.
        x: R.x + R.colBar, y, style: 'report', color: colour,
      });
      continue;
    }
    cmds.push({
      op: 'text', value: `${String(pct(row.accuracy))}%`,
      x: R.x + R.colAcc, y, style: 'report', color: colour,
    });
    cmds.push({
      op: 'text', value: `${String(Math.round(row.meanMs))} ms`,
      x: R.x + R.colMean, y, style: 'report',
      // The latency column is the diagnosis. A finger being reached for is
      // marked here and nowhere else, because this is the number that says so.
      color: row.reaching
        ? pal('error')
        : row.finger === card.quickest?.finger ? pal('live') : colour,
    });
  }

  const note = wrapText(reportNote(card, trend), R.noteCols);
  for (let i = 0; i < note.length; i++) {
    cmds.push({
      op: 'text', value: note[i] ?? '', x: R.x, y: R.noteY + i * R.lineH,
      style: 'report', color: pal('dim'),
    });
  }

  // --- the keys and the curve -----------------------------------------------

  cmds.push({
    op: 'text', value: 'worst keys', x: R.rightX, y: R.headY, style: 'report', color: pal('dim'),
  });
  if (card.worst.length === 0) {
    cmds.push({
      op: 'text', value: 'none above the noise yet', x: R.rightX,
      y: R.colY, style: 'report', color: pal('live'),
    });
  }
  for (let r = 0; r < card.worst.length; r++) {
    const row = card.worst[r];
    if (row === undefined) continue;
    const struck = row.confusedWith === '' ? '' : `, ${keyLabel(row.confusedWith)} instead`;
    cmds.push({
      op: 'text',
      value: `${keyLabel(row.key)}   ${String(pct(row.errorRate))}% wrong${struck}`,
      x: R.rightX, y: R.colY + r * R.lineH,
      style: 'report', color: pal('error'),
    });
  }

  if (gate !== undefined && gate.newKeys.length > 0) {
    cmds.push({
      op: 'text', value: `stage ${String(gate.stage)} - what is still missing`,
      x: R.rightX, y: R.gateHeadY, style: 'report', color: pal('dim'),
    });
    // Unmet in gold, met in muted text. Gold is the card's accent and it goes to
    // the thing there is still work in; a red row for a condition simply not yet
    // reached would read as a failure, and it is not one.
    // Before a single keystroke has landed on the new keys -- which is exactly
    // where the player stands on the card that follows a promotion -- there is
    // no accuracy and no median to report. Printing "0% needs 95%" there would
    // be the card inventing a failure out of an empty table, on the one screen
    // whose whole job is to stop a promotion looking like a regression.
    const measured = gate.samples > 0;
    const rows: readonly (readonly [string, boolean])[] = [
      [`new keys   ${nameKeys(gate.newKeys)}`, true],
      ...(measured
        ? ([
          [
            `accuracy   ${String(pct(gate.accuracy))}%   opens at `
            + `${String(pct(gate.requiredAccuracy))}%`,
            gate.accuracyMet,
          ],
          [
            `speed      ${String(Math.round(gate.medianMs))} ms   opens at `
            + `${String(Math.round(gate.allowedLatencyMs))} ms`,
            gate.latencyMet,
          ],
        ] as const)
        : []),
      [
        `keystrokes ${String(gate.samples)} of `
        + `${String(Math.round(gate.requiredSamples))} on them`,
        gate.samples >= gate.requiredSamples,
      ],
    ];
    for (let i = 0; i < rows.length; i++) {
      const entry = rows[i];
      if (entry === undefined) continue;
      cmds.push({
        op: 'text', value: entry[0], x: R.rightX, y: R.gateY + i * R.lineH,
        style: 'report', color: entry[1] ? pal('done') : pal('gold'),
      });
    }
  }

  if (trend.points.length > 0) {
    cmds.push({
      op: 'text',
      value: trend.promotions > 0
        ? `last ${countStretches(trend.points.length)} - gold: a stage opened`
        : `last ${countStretches(trend.points.length)} - best `
          + `${String(Math.round(trend.bestWpm))} wpm`,
      x: R.rightX, y: R.trendHeadY, style: 'report', color: pal('dim'),
    });
    pushTrend(cmds, trend);
  }

  // --- the one thing to do next ---------------------------------------------

  const advice = wrapText(reportAdvice(card, gate, tuning), R.adviceCols);
  for (let i = 0; i < advice.length; i++) {
    cmds.push({
      op: 'text', value: advice[i] ?? '', x: R.x, y: R.adviceY + i * R.lineH,
      style: 'report', color: pal('gold'),
    });
  }

  cmds.push({
    op: 'text', value: 'enter: next verses      r: type them again      esc: menu',
    x: R.x, y: R.footY, style: 'report', color: pal('dim'),
  });
}
