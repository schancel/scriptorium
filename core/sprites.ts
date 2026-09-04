/**
 * The art: 16x16 pixel sprites, as text.
 *
 * @doc docs/architecture/display-list.md#commands
 *
 * There are no image files in this repository and there must never be. Every
 * sprite is a list of rows of *ink characters*, decoded once into a flat array
 * of palette indices. Three things follow, and each of them is the reason:
 *
 *  - **The repository stays diffable.** A one-pixel change to the scribe's hood
 *    is one visible character in a review, not a binary blob a reviewer has to
 *    take on trust.
 *  - **The port is free.** `frames` is a flat `number[]` of palette indices; a
 *    Flutter `CustomPainter` walks exactly the same array a Canvas renderer
 *    does, and neither needs an asset pipeline, a loader, or a decode step.
 *  - **The art is testable.** `toAscii` renders a frame back to the characters
 *    it was written in, so `sprites.test.ts` can assert on a silhouette. At this
 *    size the silhouette is the whole design: a recognisable shape at 16x16
 *    beats detail nobody can resolve.
 *
 * Colours are indices, never values. A pixel says `robe`, not a shade of brown,
 * and `core/worlds.ts` supplies the sixteen colours a theme wants for those
 * roles -- which is what lets the same stone tile read as abbey grey in the
 * cloister and as ochre in the wilderness without a second tileset.
 *
 * Note this is *not* the UI palette in `core/draw.ts`. That one names interface
 * slots (`hud`, `rule`, `error`); this one names art roles. They are different
 * vocabularies for different pictures and merging them would give the HUD an
 * opinion about the colour of a bat.
 */

// --- the palette ------------------------------------------------------------

/**
 * Art palette roles, in index order. A sprite pixel is an index into this list;
 * a theme in `core/worlds.ts` supplies one colour per role, in this order.
 *
 * Sixteen roles, matching the sixteen ink characters below, because one
 * printable character per role is what makes a row of source readable as a row
 * of pixels.
 */
export const PALETTE_ROLES: readonly string[] = [
  'none', 'outline', 'shade', 'mid', 'light', 'highlight',
  'skin', 'skinShade', 'robe', 'robeShade',
  'accent', 'flame', 'blood', 'bloodDark',
  'groundTop', 'groundBody',
];

/**
 * Ink characters, positionally aligned with `PALETTE_ROLES`: the character's
 * index in this string *is* its palette index.
 *
 * Mnemonic rather than numeric on purpose. `KrSSSSrK` reads as a hooded face at
 * a glance and a row of hex digits does not, and the person who will next edit
 * this art is reading it in a diff, not in a sprite editor.
 */
export const INK_CHARS = '.KDMLWSsRrAFBbGg';

/** The transparent role. Index 0, so an unpainted pixel is falsy. */
export const NONE = 0;

/**
 * Sprite edge, in pixels.
 *
 * Structural, not a tunable: it is the resolution the art is *drawn at*, so
 * changing the number would not tune anything -- it would invalidate every row
 * below. Chunky by choice; see the module header on silhouettes.
 */
export const SPRITE_SIZE = 16; // tuning-exempt: the art's own resolution, not a feel knob

// --- decoding ---------------------------------------------------------------

/** One decoded sprite. `frames[f]` holds `SPRITE_SIZE * SPRITE_SIZE` indices. */
export interface PixelSprite {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  readonly frames: readonly (readonly number[])[];
}

/**
 * Decode one frame's rows into palette indices.
 *
 * Strict about both the row count and the row width: a sprite that is a
 * character short decodes into a picture that is subtly sheared, and a sheared
 * picture is far harder to diagnose from the screen than a thrown error is from
 * a test.
 *
 * @throws if the frame is not `SPRITE_SIZE` rows of `SPRITE_SIZE` ink characters
 */
export function decodeFrame(id: string, rows: readonly string[]): number[] {
  if (rows.length !== SPRITE_SIZE) {
    throw new Error(`sprites: "${id}" has ${String(rows.length)} rows, expected ${String(SPRITE_SIZE)}`);
  }
  const pixels: number[] = [];
  for (const [y, row] of rows.entries()) {
    if (row.length !== SPRITE_SIZE) {
      throw new Error(
        `sprites: "${id}" row ${String(y)} is ${String(row.length)} wide, expected ${String(SPRITE_SIZE)}`,
      );
    }
    for (const ch of row) {
      const index = INK_CHARS.indexOf(ch);
      if (index < 0) throw new Error(`sprites: "${id}" uses unknown ink character "${ch}"`);
      pixels.push(index);
    }
  }
  return pixels;
}

function sprite(id: string, frames: readonly (readonly string[])[]): PixelSprite {
  return {
    id,
    w: SPRITE_SIZE,
    h: SPRITE_SIZE,
    frames: frames.map((rows) => Object.freeze(decodeFrame(id, rows))),
  };
}

// --- the scribe -------------------------------------------------------------

/**
 * The player: a hooded novice with a quill held up in the right hand.
 *
 * The quill is the whole silhouette test. Hood plus robe alone reads as "a
 * monk"; hood plus robe plus a diagonal nib reads as "a scribe", which is the
 * one thing the player character has to say at this size.
 */
const SCRIBE_IDLE_0: readonly string[] = [
  '................',
  '.....KKKKK......',
  '....KrrrrrKK.WW.',
  '....KrrrrrrK.LW.',
  '....KrSSSSrK.L..',
  '....KrSKSKrK.L..',
  '....KrSSSSrK.L..',
  '.....KSSSSK..L..',
  '....KKRRRRKK.L..',
  '...KRRRRRRRRKA..',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '...KKKK..KKKK...',
  '................',
];

/** Breathing: the whole figure settles one pixel and the quill with it. */
const SCRIBE_IDLE_1: readonly string[] = [
  '................',
  '................',
  '.....KKKKK......',
  '....KrrrrrKK.WW.',
  '....KrrrrrrK.LW.',
  '....KrSSSSrK.L..',
  '....KrSKSKrK.L..',
  '....KrSSSSrK.L..',
  '.....KSSSSK..L..',
  '....KKRRRRKKA...',
  '...KRRRRRRRRK...',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '...KKKK..KKKK...',
  '................',
];

/** Contact: legs apart, quill swung back. */
const SCRIBE_WALK_0: readonly string[] = [
  '................',
  '.....KKKKK......',
  '....KrrrrrKK.WW.',
  '....KrrrrrrK.LW.',
  '....KrSSSSrK.L..',
  '....KrSKSKrK.L..',
  '....KrSSSSrK.L..',
  '.....KSSSSK..L..',
  '....KKRRRRKK.L..',
  '...KRRRRRRRRKA..',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '...KRK....KRK...',
  '..KKK......KKK..',
  '................',
];

/** Passing: legs together, body lifted a pixel. */
const SCRIBE_WALK_1: readonly string[] = [
  '................',
  '.....KKKKK......',
  '....KrrrrrKK.WW.',
  '....KrrrrrrK.LW.',
  '....KrSSSSrK..L.',
  '....KrSKSKrK..L.',
  '....KrSSSSrK.L..',
  '.....KSSSSK..L..',
  '....KKRRRRKK.L..',
  '...KRRRRRRRRKA..',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '.....KRRRRK.....',
  '.....KKKKKK.....',
  '................',
];

/** Contact, other foot leading. */
const SCRIBE_WALK_2: readonly string[] = [
  '................',
  '.....KKKKK......',
  '....KrrrrrKK.WW.',
  '....KrrrrrrK.LW.',
  '....KrSSSSrK.L..',
  '....KrSKSKrK.L..',
  '....KrSSSSrK.L..',
  '.....KSSSSK..L..',
  '....KKRRRRKK.L..',
  '...KRRRRRRRRKA..',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '...KRK....KRK...',
  '...KKK......KK..',
  '................',
];

/** Passing again, mirrored lean. */
const SCRIBE_WALK_3: readonly string[] = [
  '................',
  '.....KKKKK......',
  '....KrrrrrKK.WW.',
  '....KrrrrrrK.LW.',
  '....KrSSSSrK.L..',
  '....KrSKSKrK.L..',
  '....KrSSSSrK.L..',
  '.....KSSSSK.L...',
  '....KKRRRRKKL...',
  '...KRRRRRRRRA...',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '.....KRRRRK.....',
  '....KKKKKK......',
  '................',
];

/**
 * The strike, wind-up: the quill is drawn back over the left shoulder.
 *
 * The body is the idle body, unchanged. Only the arm moves, because at 16x16 a
 * figure that redraws itself between frames reads as two different figures
 * rather than as one figure doing something.
 */
const SCRIBE_STRIKE_0: readonly string[] = [
  '................',
  '..W..KKKKK......',
  '..LWKrrrrrKK....',
  '...LKrrrrrrK....',
  '....KrSSSSrK....',
  '....KrSKSKrK....',
  '....KrSSSSrK....',
  '.....KSSSSK.....',
  '....KKRRRRKK....',
  '...KRRRRRRRRK...',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '...KKKK..KKKK...',
  '................',
];

/**
 * The strike, follow-through: the quill is thrust forward, nib clear of the
 * body at the right edge, with the ink trailing behind it.
 *
 * The nib has to leave the silhouette or the pose reads as a shrug. That is the
 * whole design of the frame: everything below the waist is the idle figure, and
 * the one thing that changed is a diagonal of ink pointing at what was hit.
 */
const SCRIBE_STRIKE_1: readonly string[] = [
  '................',
  '.....KKKKK......',
  '....KrrrrrKK....',
  '....KrrrrrrK....',
  '....KrSSSSrK....',
  '....KrSKSKrK....',
  '....KrSSSSrKW...',
  '.....KSSSSKLWA..',
  '....KKRRRRKKLLWA',
  '...KRRRRRRRRK.A.',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '..KRRRRRRRRRRK..',
  '...KRRRRRRRRK...',
  '...KKKK..KKKK...',
  '................',
];

// --- the monsters -----------------------------------------------------------

/**
 * A bat. Wings up.
 *
 * It idles: it bobs on the spot and never advances. Nothing in this file
 * animates a monster *toward* the player, and nothing in `core/entities.ts`
 * does either -- see docs/decisions/0004-idle-threat-not-speed-timer.md.
 */
const BAT_0: readonly string[] = [
  '................',
  'KK............KK',
  'KDK..........KDK',
  'KDDK........KDDK',
  'KDDDK..KK..KDDDK',
  '.KDDDKKDDKKDDDK.',
  '..KDDDDDDDDDDK..',
  '...KDDMDDMDDK...',
  '...KDDFDDFDDK...',
  '....KDDDDDDK....',
  '.....KDDDDK.....',
  '......KDDK......',
  '.......KK.......',
  '................',
  '................',
  '................',
];

/** Wings down. */
const BAT_1: readonly string[] = [
  '................',
  '................',
  '.......KK.......',
  '......KDDK......',
  '..KKKKDDDDKKKK..',
  '.KDDDDDDDDDDDDK.',
  'KDDDDDFDDFDDDDDK',
  'KDDDKDDDDDDKDDDK',
  'KDDK.KDDDDK.KDDK',
  'KDK..KDDDDK..KDK',
  'KK....KDDK....KK',
  '.......KK.......',
  '................',
  '................',
  '................',
  '................',
];

/** A skeleton, rattling in place. */
const SKELETON_0: readonly string[] = [
  '................',
  '.....KKKKK......',
  '....KWWWWWK.....',
  '....WKWWWKW.....',
  '....WWWWWWW.....',
  '.....WKKKW......',
  '......KWK.......',
  '...KWWWWWWWK....',
  '...W.KWWWK.W....',
  '...W.WKKKW.W....',
  '....KKWWWKK.....',
  '......WWW.......',
  '.....W...W......',
  '.....W...W......',
  '....KW...WK.....',
  '................',
];

/** The rattle: shoulders drop, arms swing out. */
const SKELETON_1: readonly string[] = [
  '................',
  '................',
  '.....KKKKK......',
  '....KWWWWWK.....',
  '....WKWWWKW.....',
  '....WWWWWWW.....',
  '.....WKKKW......',
  '......KWK.......',
  '..KWWWWWWWWK....',
  '..W..KWWWK..W...',
  '..W..WKKKW..W...',
  '....KKWWWKK.....',
  '......WWW.......',
  '.....W...W......',
  '....KW...WK.....',
  '................',
];

// --- the burst --------------------------------------------------------------

/**
 * What a felled monster turns into: flash, expand, scatter.
 *
 * Three frames rather than a fade, because a fade at this resolution is a
 * sprite going grey and reads as the game losing interest rather than as the
 * monster being destroyed. A shape that *changes* -- tight, then wide, then
 * nothing but flecks -- is legible in the two hundred milliseconds it is on
 * screen, which is all the time this animation gets.
 *
 * The frames are the whole feedback loop of the game made visible, so they are
 * ordered by size and the test asserts it: frame 0 is smaller than frame 1, and
 * frame 2 is sparser than either. Any other ordering plays the explosion
 * backwards.
 */
const BURST_0: readonly string[] = [
  '................',
  '................',
  '................',
  '.......KK.......',
  '.......WW.......',
  '....K..WW..K....',
  '.....KKWWKK.....',
  '...KWWWWWWWWK...',
  '...KWWWWWWWWK...',
  '.....KKWWKK.....',
  '....K..WW..K....',
  '.......WW.......',
  '.......KK.......',
  '................',
  '................',
  '................',
];

const BURST_1: readonly string[] = [
  '.......KK.......',
  '......K..K......',
  '...K..LLLL..K...',
  '....K.LWWL.K....',
  '.....LLWWLL.....',
  '..K..LWAAWL..K..',
  '...LLWAAAAWLL...',
  '.KLWWAAAAAAWWLK.',
  '.KLWWAAAAAAWWLK.',
  '...LLWAAAAWLL...',
  '..K..LWAAWL..K..',
  '.....LLWWLL.....',
  '....K.LWWL.K....',
  '...K..LLLL..K...',
  '......K..K......',
  '.......KK.......',
];

const BURST_2: readonly string[] = [
  '.K............K.',
  '................',
  '...L........L...',
  '................',
  '.K...A....A...K.',
  '................',
  '....L......L....',
  '................',
  '................',
  '....L......L....',
  '................',
  '.K...A....A...K.',
  '................',
  '...L........L...',
  '................',
  '.K............K.',
];

// --- the blot-cloud ---------------------------------------------------------

/**
 * The ink cloud, in its three phases: far off, looming overhead, and dripping.
 *
 * It is the only threat in the game and it is a threat about *silence*, not
 * about speed. The frames are ordered to match `CloudPhase` in
 * `core/entities.ts` so the drawing follows the state machine rather than
 * guessing at it.
 */
const CLOUD_FAR: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '.....KKKK.......',
  '...KKDDDDKK.....',
  '..KDDDDDDDDK....',
  '..KDDDDDDDDK....',
  '...KKDDDDKK.....',
  '.....KKKK.......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const CLOUD_NEAR: readonly string[] = [
  '................',
  '.....KKKKK......',
  '...KKDDDDDKK....',
  '..KDDDDDDDDDK...',
  '.KDDDDDDDDDDDK..',
  'KDDDDDDDDDDDDDK.',
  'KDDDDDDDDDDDDDK.',
  '.KDDDDDDDDDDDK..',
  '..KKDDDDDDDKK...',
  '....KKDDDKK.....',
  '......KKK.......',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const CLOUD_STRIKE: readonly string[] = [
  '................',
  '.....KKKKK......',
  '...KKDDDDDKK....',
  '..KDDDDDDDDDK...',
  '.KDDDDDDDDDDDK..',
  'KDDDDDDDDDDDDDK.',
  'KDDDDDDDDDDDDDK.',
  '.KDDDDDDDDDDDK..',
  '..KKDDDDDDDKK...',
  '....KKDDDKK.....',
  '.....KDDDK......',
  '......KDK.......',
  '......KDK.......',
  '.......K........',
  '.....KKDKK......',
  '......KKK.......',
];

// --- items ------------------------------------------------------------------

/** A candle: the checkpoint, and the only warm thing in a dark level. */
const CANDLE_0: readonly string[] = [
  '................',
  '................',
  '.......A........',
  '......AFA.......',
  '......AFA.......',
  '.......K........',
  '.....KWWWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '....KKWLWKK.....',
  '...KAAAAAAAK....',
  '...KAAAAAAAK....',
  '..KKAAAAAAAKK...',
  '................',
];

/** The flicker. A candle that does not move is a lamp. */
const CANDLE_1: readonly string[] = [
  '................',
  '.......A........',
  '......AAA.......',
  '......AFA.......',
  '.......F........',
  '.......K........',
  '.....KWWWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '....KKWLWKK.....',
  '...KAAAAAAAK....',
  '...KAAAAAAAK....',
  '..KKAAAAAAAKK...',
  '................',
];

/**
 * The same candle, unlit: no flame, no glow, just the wick.
 *
 * It used to be the lit art at 40% alpha, which drew a flame on a candle nobody
 * had lit -- a ghost of a fire, dimmed. What "not yet yours" should look like is
 * a candle that is *out*, so the moment of lighting has something to be a change
 * from. The stick and the holder are pixel-identical to both lit frames from row
 * six down, so lighting it changes exactly the flame and nothing else.
 */
const CANDLE_UNLIT: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......K........',
  '.....KWWWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '.....KWLWK......',
  '....KKWLWKK.....',
  '...KAAAAAAAK....',
  '...KAAAAAAAK....',
  '..KKAAAAAAAKK...',
  '................',
];

/** An ink pot: a heart, in the fiction of the thing. */
const INK_POT: readonly string[] = [
  '................',
  '................',
  '.....KKKKKK.....',
  '....KDDDDDDK....',
  '....KKKKKKKK....',
  '...KMMMMMMMMK...',
  '..KMMMMMMMMMMK..',
  '..KMMMLLMMMMMK..',
  '..KMMMLLMMMMMK..',
  '..KMMMMMMMMMMK..',
  '..KMMMMMMMMMMK..',
  '..KMMMMMMMMMMK..',
  '...KDDDDDDDDK...',
  '....KKKKKKKK....',
  '................',
  '................',
];

const HEART_FULL: readonly string[] = [
  '................',
  '....KKK..KKK....',
  '...KBBBKKBBBK...',
  '..KBWBBBBBBBBK..',
  '..KBWBBBBBBBBK..',
  '..KBBBBBBBBBBK..',
  '..KBBBBBBBBBBK..',
  '..KbBBBBBBBBbK..',
  '...KbBBBBBBbK...',
  '....KbBBBBbK....',
  '.....KbBBbK.....',
  '......KbbK......',
  '.......KK.......',
  '................',
  '................',
  '................',
];

/** The same silhouette, hollow. A lost heart must read as the shape of a heart. */
const HEART_EMPTY: readonly string[] = [
  '................',
  '....KKK..KKK....',
  '...K...KK...K...',
  '..K..........K..',
  '..K..........K..',
  '..K..........K..',
  '..K..........K..',
  '..K..........K..',
  '...K........K...',
  '....K......K....',
  '.....K....K.....',
  '......K..K......',
  '.......KK.......',
  '................',
  '................',
  '................',
];

// --- tiles ------------------------------------------------------------------

/**
 * Tiles are the same 16x16 grid and the same palette roles, so a theme recolours
 * the world without a second tileset: `tile_stone` is abbey grey in the cloister
 * and ochre in the wilderness because `core/worlds.ts` hands the renderer a
 * different sixteen colours, not because there is a second set of pixels.
 */
const TILE_STONE: readonly string[] = [
  'KKKKKKKKKKKKKKKK',
  'LLLLLLLKLLLLLLLL',
  'LMMMMMLKLMMMMMML',
  'LMMMMMMKMMMMMMML',
  'LMMMMMMKMMMMMMML',
  'DDDDDDDKDDDDDDDD',
  'KKKKKKKKKKKKKKKK',
  'LLLKLLLLLLLLLLLL',
  'LMMKMMMMMMMMMMML',
  'LMMKMMMMMMMMMMML',
  'DDDKDDDDDDDDDDDD',
  'KKKKKKKKKKKKKKKK',
  'LLLLLLLLLLLKLLLL',
  'LMMMMMMMMMMKMMML',
  'LMMMMMMMMMMKMMML',
  'DDDDDDDDDDDKDDDD',
];

const TILE_GRASS: readonly string[] = [
  'GGGGGGGGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
  'GgGGGGgGGGGGgGGG',
  'gggGgggggGgggggg',
  'gggggggggggggggg',
  'ggggDgggggggDggg',
  'gggggggggggggggg',
  'gggggggDgggggggg',
  'gggggggggggggggg',
  'gDgggggggggggggg',
  'gggggggggggDgggg',
  'gggggggggggggggg',
  'ggggggDggggggggg',
  'gggggggggggggggg',
  'gggDggggggggggDg',
  'gggggggggggggggg',
];

const TILE_SAND: readonly string[] = [
  'GGGGGGGGGGGGGGGG',
  'GGGGgGGGGGGGgGGG',
  'GGGGGGGGgGGGGGGG',
  'gGGGGGGGGGGGGGGg',
  'ggGgggGgggGggggg',
  'gggggggggggggggg',
  'ggGggggggggGgggg',
  'gggggggggggggggg',
  'gggggGgggggggggg',
  'gggggggggGgggggg',
  'gggggggggggggggg',
  'gGggggggggggggGg',
  'gggggggggggggggg',
  'ggggggGggggggggg',
  'gggggggggggggggg',
  'gggGgggggggggggg',
];

// --- the sheet --------------------------------------------------------------

/**
 * Every sprite the game can name, keyed by the `id` a display-list `sprite` or
 * `tile` command carries.
 */
export const SPRITES: ReadonlyMap<string, PixelSprite> = new Map(
  [
    sprite('scribe_idle', [SCRIBE_IDLE_0, SCRIBE_IDLE_1]),
    sprite('scribe_walk', [SCRIBE_WALK_0, SCRIBE_WALK_1, SCRIBE_WALK_2, SCRIBE_WALK_3]),
    sprite('scribe_strike', [SCRIBE_STRIKE_0, SCRIBE_STRIKE_1]),
    sprite('bat', [BAT_0, BAT_1]),
    sprite('skeleton', [SKELETON_0, SKELETON_1]),
    sprite('burst', [BURST_0, BURST_1, BURST_2]),
    sprite('blot_cloud', [CLOUD_FAR, CLOUD_NEAR, CLOUD_STRIKE]),
    // Frame 2 is the unlit candle; the flicker cycle is frames 0 and 1, so an
    // animation that wraps on two frames never reaches it by accident.
    sprite('candle', [CANDLE_0, CANDLE_1, CANDLE_UNLIT]),
    sprite('ink_pot', [INK_POT]),
    sprite('heart_full', [HEART_FULL]),
    sprite('heart_empty', [HEART_EMPTY]),
    sprite('tile_stone', [TILE_STONE]),
    sprite('tile_grass', [TILE_GRASS]),
    sprite('tile_sand', [TILE_SAND]),
  ].map((s) => [s.id, s]),
);

/**
 * Frames of `burst`, and the frame of `candle` that has no flame.
 *
 * Exported because they are facts about *this file's* art rather than about the
 * game, and a consumer that spelled them itself would be a second copy of a
 * number that only changes when the pictures above do.
 */
export const BURST_FRAMES = 3;        // tuning-exempt: frame count of the art in this file
export const CANDLE_UNLIT_FRAME = 2;  // tuning-exempt: an index into the art in this file

/** Look one up. Null rather than a throw: a missing sprite is a drawing bug. */
export function spriteFor(id: string): PixelSprite | null {
  return SPRITES.get(id) ?? null;
}

/** Wrap a frame index into a sprite's frame count, so animation cannot overrun. */
export function frameIndex(art: PixelSprite, frame: number): number {
  const count = art.frames.length;
  if (count === 0) return 0;
  const wrapped = Math.trunc(frame) % count;
  return wrapped < 0 ? wrapped + count : wrapped;
}

/** The palette index at `(x, y)` of a frame; `NONE` outside the sprite. */
export function pixelAt(art: PixelSprite, frame: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= art.w || y >= art.h) return NONE;
  const pixels = art.frames[frameIndex(art, frame)];
  if (pixels === undefined) return NONE;
  return pixels[y * art.w + x] ?? NONE;
}

/**
 * Render a frame back to the ink characters it was written in.
 *
 * This is the squint test. `sprites.test.ts` asserts on the result, because the
 * only way to be wrong about 16x16 art is to look at it, and the only way to
 * keep looking at it after the fact is to make the picture assertable.
 */
export function toAscii(art: PixelSprite, frame: number): string {
  const rows: string[] = [];
  for (let y = 0; y < art.h; y++) {
    let row = '';
    for (let x = 0; x < art.w; x++) {
      row += INK_CHARS.charAt(pixelAt(art, frame, x, y));
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/**
 * The silhouette alone: ink or nothing. What a player actually resolves at this
 * size, and therefore what the shape has to be right in.
 */
export function toSilhouette(art: PixelSprite, frame: number): string {
  const solid = INK_CHARS.charAt(1);
  const empty = INK_CHARS.charAt(0);
  const rows: string[] = [];
  for (let y = 0; y < art.h; y++) {
    let row = '';
    for (let x = 0; x < art.w; x++) {
      row += pixelAt(art, frame, x, y) === NONE ? empty : solid;
    }
    rows.push(row);
  }
  return rows.join('\n');
}
