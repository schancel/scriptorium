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

/**
 * The stomp, in three frames: the hop out, the landing, the bounce back.
 *
 * The skeleton's verb. A pose is not an action -- the scribe used to hold a
 * strike frame while a monster evaporated beside him -- so this one *travels*:
 * `core/draw.ts` carries him along an arc toward the skull and back, and these
 * frames are what he looks like on the way.
 *
 * Everything above the waist is the idle figure, pixel for pixel, including the
 * quill at his side. Only the legs change. At 16x16 a figure that redraws itself
 * between frames reads as two different figures, and the whole point of the
 * three is that it is plainly *him* doing something.
 *
 * Rise: knees drawn up under the robe, feet tucked.
 */
const SCRIBE_HOP_0: readonly string[] = [
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
  '...KKRRRRRRKK...',
  '.....KK..KK.....',
  '................',
];

/**
 * Contact: both legs driven straight down into a point, with the impact thrown
 * out sideways beneath them. This is the frame that has to read as *landing on
 * something*, so the figure narrows to a wedge and the flecks say where it hit.
 */
const SCRIBE_HOP_1: readonly string[] = [
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
  '...KRRRRRRRRK...',
  '....KRRRRRRK....',
  '.....KRRRRK.....',
  '.....KKKKKK.....',
  '...KK......KK...',
];

/** Bounce: legs flung wide as he comes off the skull. */
const SCRIBE_HOP_2: readonly string[] = [
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
  '..KRK......KRK..',
  '..KK........KK..',
  '................',
];

// --- the ink throw ----------------------------------------------------------

/**
 * The nib in flight: the bat's verb, and the thing that was missing.
 *
 * A thrown object has to be *small* and it has to be *pointed*, or at this size
 * it reads as a second monster. So it is a five-pixel-long dart of accent ink
 * with one highlight down its spine, and it takes up a quarter of the cell --
 * which is also what makes the arc legible, because a small thing crossing a gap
 * is a trajectory and a large one is a wipe.
 *
 * Two frames, mirrored, so it tumbles as it goes. It is on screen for a couple
 * of hundred milliseconds; a tumble is all the animation that time can hold.
 */
const NIB_0: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..........KK....',
  '.........KAAK...',
  '........KAAWK...',
  '.......KAAWK....',
  '......KAAWK.....',
  '.....KKAWK......',
  '......KKK.......',
  '................',
  '................',
  '................',
  '................',
];

/** The same nib, tumbled over. */
const NIB_1: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '....KK..........',
  '...KAAK.........',
  '...KWAAK........',
  '....KWAAK.......',
  '.....KWAAK......',
  '......KWAKK.....',
  '.......KKK......',
  '................',
  '................',
  '................',
  '................',
];

/**
 * The ink bursting on the bat: a blot, then a splatter.
 *
 * Deliberately *not* the `burst` sprite. The burst is what a monster turns into
 * and it is bright; this is what hits it, and it is ink -- the same dark the
 * blot-cloud is drawn in, because the scribe and the thing that threatens his
 * page throw the same substance. Two frames, and the second is strictly larger
 * with droplets thrown clear of it, so the splash spreads rather than fading.
 */
const INK_BURST_0: readonly string[] = [
  '................',
  '................',
  '................',
  '.......KK.......',
  '......KDDK......',
  '.....KDDDDK.....',
  '....KDDDDDDK....',
  '....KDDDDDDK....',
  '....KDDDDDDK....',
  '.....KDDDDK.....',
  '......KDDK......',
  '.......KK.......',
  '................',
  '................',
  '................',
  '................',
];

const INK_BURST_1: readonly string[] = [
  '..K..........K..',
  '....K......K....',
  '.......KK.......',
  '.....KKDDKK.....',
  '...KKDDDDDDKK...',
  '..KDDDDDDDDDDK..',
  '.KDDDDDDDDDDDDK.',
  '.KDDDDDDDDDDDDK.',
  '.KDDDDDDDDDDDDK.',
  '..KDDDDDDDDDDK..',
  '...KKDDDDDDKK...',
  '.....KKDDKK.....',
  '.......KK.......',
  '....K......K....',
  '..K..........K..',
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

/**
 * Water, in a calm swell: a lit surface with ripples receding into the body.
 *
 * Horizontal by construction. Every mark in it runs across the tile, because a
 * surface is the one thing water has that stone has not, and a dash running any
 * other way reads as a crack.
 */
const TILE_WATER: readonly string[] = [
  'GGGGGGGGGGGGGGGG',
  'GGGWWGGGGGWWGGGG',
  'gggggggggggggggg',
  'ggGGGGGgggGGGGGg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'GGGGgggGGGGGgggG',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggGGGGGGgggGGGgg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'GGgggGGGGGgggGGG',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggGGGGgggGGGGGgg',
];

/**
 * Brick, in a running bond: four courses, each offset half a brick.
 *
 * The whole difference from `tile_stone` is the size of the unit and the
 * regularity of the joint -- stone is three tall courses with a joint wherever
 * the mason found one, brick is four short courses that line up everywhere.
 * That is what reads as a city wall rather than as a quarry face.
 */
const TILE_BRICK: readonly string[] = [
  'KKKKKKKKKKKKKKKK',
  'LLLLLLLKLLLLLLLL',
  'MMMMMMMKMMMMMMMM',
  'DDDDDDDKDDDDDDDD',
  'KKKKKKKKKKKKKKKK',
  'LLLKLLLLLLLKLLLL',
  'MMMKMMMMMMMKMMMM',
  'DDDKDDDDDDDKDDDD',
  'KKKKKKKKKKKKKKKK',
  'LLLLLLLKLLLLLLLL',
  'MMMMMMMKMMMMMMMM',
  'DDDDDDDKDDDDDDDD',
  'KKKKKKKKKKKKKKKK',
  'LLLKLLLLLLLKLLLL',
  'MMMKMMMMMMMKMMMM',
  'DDDKDDDDDDDKDDDD',
];

/**
 * Bone: long bones stacked the way an ossuary stacks them, ends outward.
 *
 * Bright at the joints and dull along the shaft, because that is how a femur
 * catches light and it is the only cue four pixels can carry. Deliberately not
 * skulls: a face at this size pulls the eye straight off the rail, and the
 * scenery's whole job is to say where the scribe is and then stay behind him.
 */
const TILE_BONE: readonly string[] = [
  'DDDDDDDDDDDDDDDD',
  'WWDDDDDDWWDDDDDD',
  'WWLLLLLLWWLLLLLL',
  'WWDDDDDDWWDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'DDDDWWDDDDDDWWDD',
  'LLLLWWLLLLLLWWLL',
  'DDDDWWDDDDDDWWDD',
  'DDDDDDDDDDDDDDDD',
  'WWDDDDDDWWDDDDDD',
  'WWLLLLLLWWLLLLLL',
  'WWDDDDDDWWDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'DDDDWWDDDDDDWWDD',
  'LLLLWWLLLLLLWWLL',
  'DDDDWWDDDDDDWWDD',
];

/**
 * Rubble: broken chips, with nothing squared about them.
 *
 * The chips begin and end on different rows, and that is the only thing keeping
 * this from being a second brick wall. Courses that agree with each other read
 * as masonry whatever colours a theme lends them; courses that do not read as
 * something that fell down.
 */
const TILE_RUBBLE: readonly string[] = [
  'KGGGKKKKGGGGKKKK',
  'KgggKGGGggggKKGG',
  'KgggKgggggggKKgg',
  'KKKKKgggKKKKKKgg',
  'KKGGGGKKKKKGGGKK',
  'KKggggKGGGKgggKK',
  'KKggggKgggKgggKK',
  'KKKKKKKgggKKKKKK',
  'GGGKKKKKKGGGKKKK',
  'gggKGGGGKgggKGGG',
  'gggKggggKgggKggg',
  'KKKKggggKKKKKggg',
  'KGGGGKKKKKGGGKKK',
  'KggggKGGGKgggKGG',
  'KggggKgggKgggKgg',
  'KKKKKKgggKKKKKgg',
];

// --- the middle and far distance --------------------------------------------

/**
 * Everything above is ground: every pixel painted, because a floor with a hole
 * in it shows the sky through the scribe's feet. Everything below is *distance*,
 * and there the transparent pixels are the point -- `core/draw.ts` lays a themed
 * sky rect behind the parallax, so an unpainted pixel here is that sky showing
 * through a ridge line.
 *
 * Two things to know before editing one:
 *
 *  - **They are drawn tiled**, so a shape has to meet its own left and right
 *    edge. A dune crests in the middle of the cell and troughs at the seam; a
 *    colonnade puts whole columns inside the cell and nothing across the join.
 *  - **`shade` is the sky's own role.** A dark drawn in `shade` is invisible
 *    against the sky it stands in front of, which is why the darks down here are
 *    `outline` -- a column has a black edge rather than a grey one.
 *
 * And all of them are quiet on purpose. A parallax band is a backdrop drawn at
 * under half opacity behind the one line of text the player is reading. A tile
 * busy enough to be interesting at this distance is a tile competing with the
 * rail, which is the one thing scenery may never do.
 */

/** A dune: one crest to a cell, troughing at the seam so a row of them rolls. */
const TILE_DUNE: readonly string[] = [
  '................',
  '................',
  '................',
  '......GGG.......',
  '....GGGGGG......',
  '...GGGGGGGGG....',
  '.GGGGGGGGGGGGGG.',
  'GGGGGGGGGGGGGGGG',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggggGGGGGgggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
];

/**
 * Waves: two crests to a cell, each capped with foam.
 *
 * Twice the frequency of the dune and half its height, which is the whole
 * difference between water and sand at this size -- a slow single swell reads as
 * a hill however blue you paint it. The foam is the `highlight` role, so it is
 * white in the sea and lightning-lit in the storm.
 */
const TILE_WAVE: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '...WW......WW...',
  '..WGGW....WGGW..',
  '.WGGGGW..WGGGGW.',
  'WGGGGGGWWGGGGGGW',
  'GGGGGGGGGGGGGGGG',
  'gggggggggggggggg',
  'gggggggggggggggg',
  'ggGGGGggggGGGGgg',
  'gggggggggggggggg',
  'gggggGGGGGGggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
];

/**
 * A peak, snow-capped, with its east face in shadow.
 *
 * The cap is what makes it a mountain rather than a triangle, and the shadow on
 * one side is what makes it a solid rather than a cut-out. Both are two colours'
 * worth of work and there is no third.
 */
const TILE_PEAK: readonly string[] = [
  '................',
  '................',
  '.......WW.......',
  '.......WW.......',
  '......WWWW......',
  '.....WWWWWW.....',
  '.....LWWWWM.....',
  '....LLWWWWMM....',
  '...LLLLLLMMMM...',
  '...LLLLLLMMMM...',
  '..LLLLLLLMMMMM..',
  '.LLLLLLLLMMMMMM.',
  '.LLLLLLLLMMMMMM.',
  'LLLLLLLLLMMMMMMM',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMM',
];

/**
 * A skyline: flat roofs at three heights, and a tower with its merlons showing.
 *
 * The tower is the tile's one piece of detail and it earns it -- roofs alone at
 * three heights read as a wall, and the notched top of something taller than the
 * rest is what says a city was built here rather than fortified.
 */
const TILE_ROOFS: readonly string[] = [
  '................',
  '................',
  '....L.L.........',
  '....LLL.........',
  '....MMM.........',
  '....MMM...LLLL..',
  'LLLLMMM...MMMM..',
  'MMMMMMM...MMMMLL',
  'MMMMMMMLLLMMMMMM',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMM',
  'MMKMMMMKMMMMKMMM',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMM',
];

/**
 * A colonnade: two columns under an architrave, lit down one side.
 *
 * The columns run the full height of the cell so that a band deeper than one
 * tile stacks into a storey rather than into a fence, and the sky between them
 * is what makes them columns instead of stripes.
 */
const TILE_PILLARS: readonly string[] = [
  'LLLLLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'KKKKKKKKKKKKKKKK',
  '.LLLLLL..LLLLLL.',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '..LMMK....LMMK..',
  '.LMMMMK..LMMMMK.',
  '.MMMMMM..MMMMMM.',
  'MMMMMMMMMMMMMMMM',
];

/**
 * An arcade: two round-headed arches and the piers between them.
 *
 * The cloister, which is the abbey's own architecture and the reason the default
 * theme no longer stands in front of a plain wall. What reads at this size is
 * not the moulding but the *opening* -- daylight in the shape of an arch -- so
 * the arch is cut out of the wall and nothing else is drawn.
 */
const TILE_ARCH: readonly string[] = [
  'LLLLLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'MMM..MMMMMM..MMM',
  'MM....MMMM....MM',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'M......MM......M',
  'MMMMMMMMMMMMMMMM',
];

/**
 * A canopy: two crowns of leaf, scalloped along the top and dense below.
 *
 * The dabs in the mass are the `shade` role, which is the sky's own colour, so
 * they read as chinks of light through the leaves rather than as dark spots on
 * them. It is the one place in this file where drawing in the sky's colour is
 * the effect and not the mistake.
 */
const TILE_FOLIAGE: readonly string[] = [
  '....GG......GG..',
  '...GGGG....GGGG.',
  '..GGGGGG..GGGGGG',
  '.GGGGGGGGGGGGGG.',
  'gggggggggggggggg',
  'gggDggggggggDggg',
  'gggggggggggggggg',
  'gDgggggggDgggggg',
  'gggggggggggggggg',
  'ggggggDgggggggDg',
  'gggggggggggggggg',
  'gggDgggggggggDgg',
  'gggggggggggggggg',
  'gDggggggggDggggg',
  'gggggggggggggggg',
  'ggggggggDgggggDg',
];

/**
 * A cloud bank: lit along the top, tapering away underneath.
 *
 * The taper is the whole trick. A cloud with a flat bottom is a shelf, and a
 * band of shelves is a ceiling -- which is exactly wrong for the two themes that
 * want it, one of which is the sky opening and the other the sky closing.
 */
const TILE_CLOUD: readonly string[] = [
  '................',
  '...LLLL.........',
  '..LLLLLLL...LLL.',
  '.LLLLLLLLL.LLLLL',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMMMMMM',
  'MMMMMMMMMMMM....',
  '.MMMMMMMM.......',
  '..MMMM..........',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

/**
 * The face of the deep: slow, broad marks with no surface and no alignment.
 *
 * Every pixel is painted, because it is a ground tile as well as a distance one
 * -- the void stands all three of its layers on it. The marks are long and
 * unaligned on purpose: a repeating course would read as masonry and a crest
 * would read as a wave, and this is water before there is anything to see it by.
 * In the void its three roles are three shades of near-black, so what the player
 * gets is darkness that is visibly *moving*; in any other palette the same
 * pixels are a deep swell.
 */
const TILE_DEEP: readonly string[] = [
  'gggggggggggggggg',
  'ggggggKKKggggggg',
  'gggggggggggggggg',
  'ggKKKKgggggggggg',
  'gggggggggggggggg',
  'gggggggggGGGGggg',
  'gggggggggggggggg',
  'gGGGggggggggggGG',
  'gggggggggggggggg',
  'ggggggggKKKKgggg',
  'gggggggggggggggg',
  'gggKKgggggggggKK',
  'gggggggggggggggg',
  'gggggGGGGggggggg',
  'gggggggggggggggg',
  'gggggggggggggggg',
];

/**
 * A swell in the dark: one slow rise, drawn entirely in `outline`.
 *
 * The distance tile the void stands behind itself. `outline` rather than `shade`
 * because shade *is* the sky -- so this is the one shape in the game that is
 * darker than the air around it, which is what a mass of water looks like before
 * there is any light to catch its surface. One crest per cell and no foam: a
 * second crest would make it a wave, and there is nothing yet for a wave to
 * break against.
 */
const TILE_SWELL: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......KK.......',
  '.....KKKKKK.....',
  '...KKKKKKKKKK...',
  '.KKKKKKKKKKKKKK.',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
  'KKKKKKKKKKKKKKKK',
];

/**
 * Stars in the expanse: points of light and nothing else.
 *
 * A distance tile, so almost all of it is sky showing through. The one plus-shaped
 * star is the whole composition -- a field of even dots reads as noise or as dust
 * on the screen, and a single brighter one with arms is what says *star* at this
 * size. Bright points are `highlight` and faint ones are `light`, never `shade`,
 * which is the sky itself.
 */
const TILE_STARS: readonly string[] = [
  '..W........L....',
  '............W...',
  '....L...........',
  '.W..............',
  '................',
  '........L.......',
  '.......LWL......',
  '........L.......',
  '..W.............',
  '.............W..',
  '.....L..........',
  '..........W.....',
  '...W............',
  '................',
  '.L...........W..',
  '......W.........',
];

// --- the followers ----------------------------------------------------------

/**
 * The people walking behind the scribe.
 *
 * docs/design/11-followers.md#art-without-ten-bespoke-sprites: "Ten hand-drawn
 * figures is a lot of art for something deliberately in the background, and
 * detail at 16x16 reads as noise anyway." So there are no bespoke follower
 * sprites at all. There are **three body silhouettes**, each recoloured into
 * three cloths from the theme's own palette, and a **mark** laid over the top --
 * a staff, a crook, a lamb, a scroll. The mark is what the eye reads; the body
 * is shared.
 *
 * Two of the three bodies are the scribe's own frames with the quill taken out
 * of his hand, computed rather than redrawn, which is the point: a follower is
 * the same build and the same size as the player, so the line reads as people
 * walking *with* him rather than as a parade of mascots. Edit the scribe and
 * they change with him, which is exactly the coupling that should exist.
 *
 * Frames are `[walk, walk, idle, idle]` for every body, and every one of them
 * puts the feet on the same row, so a follower's y never moves: they walk when
 * he walks and settle when he idles, and nothing about them ever leaves the
 * ground line. See `core/followers.ts`.
 */

/**
 * The ink character a palette role is written with.
 *
 * Roles are named rather than indexed here for the same reason the art is
 * written in ink characters at all: `ink('robeShade')` says which pixel is meant
 * and `INK_CHARS.charAt(9)` does not.
 */
function ink(role: string): string {
  return INK_CHARS.charAt(PALETTE_ROLES.indexOf(role));
}

/** Ink for the quill: the three roles it is drawn in, and nothing else. */
const QUILL_INK = new RegExp(`[${ink('highlight')}${ink('light')}${ink('accent')}]`, 'g');

/** The scribe, without the quill. What is left is a hooded figure walking. */
function unarmed(rows: readonly string[]): readonly string[] {
  return rows.map((row) => row.replace(QUILL_INK, INK_CHARS.charAt(NONE)));
}

/**
 * Take the hood off.
 *
 * The hood is `robeShade` beside the face; hair is `robeShade` above it. So the
 * rule is one line: on any row that has skin on it, the robe-shade either side
 * *is* the hood, and turning it to skin opens the face out. Rows with no skin --
 * the crown of the head -- keep their `robeShade` and become hair.
 *
 * Derived rather than drawn because it then holds for every frame including the
 * settled idle, which sits one pixel lower than the others.
 */
function bareheaded(rows: readonly string[]): readonly string[] {
  const skin = ink('skin');
  const hood = ink('robeShade');
  return rows.map((row) => (row.includes(skin) ? row.split(hood).join(skin) : row));
}

/**
 * The same figure in another cloth.
 *
 * A recolour and not a redraw: the pixels stay where they are and only the two
 * garment roles change, so three cloths cost nothing but a role swap. Which
 * three colours those roles resolve to is still the *theme's* business -- a
 * follower in the wilderness is ochre like everything else there.
 */
function inCloth(rows: readonly string[], body: string, shade: string): readonly string[] {
  const robe = ink('robe');
  const robeShade = ink('robeShade');
  return rows.map((row) => row.split(robe).join(body).split(robeShade).join(shade));
}

/** A child: shorter, with a child's larger head, and the same feet. */
const CHILD_WALK_0: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '....KrrrrrrK....',
  '....KSSSSSSK....',
  '....KSKSSKSK....',
  '....KSSSSSSK....',
  '.....KSSSSK.....',
  '....KKRRRRKK....',
  '...KRRRRRRRRK...',
  '...KRRRRRRRRK...',
  '...KRK....KRK...',
  '..KKK......KKK..',
  '................',
];

/** Passing: legs together. */
const CHILD_WALK_1: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '....KrrrrrrK....',
  '....KSSSSSSK....',
  '....KSKSSKSK....',
  '....KSSSSSSK....',
  '.....KSSSSK.....',
  '....KKRRRRKK....',
  '...KRRRRRRRRK...',
  '...KRRRRRRRRK...',
  '.....KRRRRK.....',
  '.....KKKKKK.....',
  '................',
];

/** Standing. */
const CHILD_IDLE_0: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '....KrrrrrrK....',
  '....KSSSSSSK....',
  '....KSKSSKSK....',
  '....KSSSSSSK....',
  '.....KSSSSK.....',
  '....KKRRRRKK....',
  '...KRRRRRRRRK...',
  '...KRRRRRRRRK...',
  '...KRRRRRRRRK...',
  '...KKKK..KKKK...',
  '................',
];

/** Breathing: the figure settles a pixel; the feet do not move. */
const CHILD_IDLE_1: readonly string[] = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.....KKKKK......',
  '....KrrrrrrK....',
  '....KSSSSSSK....',
  '....KSKSSKSK....',
  '....KSSSSSSK....',
  '.....KSSSSK.....',
  '....KKRRRRKK....',
  '...KRRRRRRRRK...',
  '...KRRRRRRRRK...',
  '...KKKK..KKKK...',
  '................',
];

/** The three silhouettes, in the order a body id names them. */
const BODY_FRAMES: ReadonlyMap<string, readonly (readonly string[])[]> = new Map([
  ['hooded', [SCRIBE_WALK_0, SCRIBE_WALK_1, SCRIBE_IDLE_0, SCRIBE_IDLE_1].map(unarmed)],
  ['bare', [SCRIBE_WALK_0, SCRIBE_WALK_1, SCRIBE_IDLE_0, SCRIBE_IDLE_1]
    .map((rows) => bareheaded(unarmed(rows)))],
  ['child', [CHILD_WALK_0, CHILD_WALK_1, CHILD_IDLE_0, CHILD_IDLE_1]],
]);

/**
 * The three cloths, as a pair of art roles.
 *
 * Not three palettes: three *roles*, so the colours still come from whichever
 * theme the passage is set in. A follower is never a colour the world it is
 * standing in does not already contain.
 */
const CLOTHS: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['robe', [ink('robe'), ink('robeShade')]],
  ['mid', [ink('mid'), ink('shade')]],
  ['light', [ink('light'), ink('highlight')]],
]);

/** Every body silhouette, in every cloth. Three by three, and no more art. */
export const FOLLOWER_BODIES: readonly string[] = [...BODY_FRAMES.keys()];
export const FOLLOWER_CLOTHS: readonly string[] = [...CLOTHS.keys()];

/** The sprite id a body and a cloth name together. */
export function followerBodyId(body: string, cloth: string): string {
  return `follower_${body}_${cloth}`;
}

/** The sprite id a mark names. */
export function followerMarkId(mark: string): string {
  return `mark_${mark}`;
}

function followerBodySprites(): PixelSprite[] {
  const out: PixelSprite[] = [];
  for (const [body, frames] of BODY_FRAMES) {
    for (const [cloth, roles] of CLOTHS) {
      out.push(sprite(
        followerBodyId(body, cloth),
        frames.map((rows) => inCloth(rows, roles[0], roles[1])),
      ));
    }
  }
  return out;
}

/**
 * Frame indices into a follower body. Facts about the art in this file, exported
 * for the same reason `HOP_RISE` is.
 */
export const FOLLOWER_WALK_FRAMES = 2;  // tuning-exempt: frame count of the art in this file
export const FOLLOWER_IDLE_FIRST = 2;   // tuning-exempt: an index into the art in this file
export const FOLLOWER_IDLE_FRAMES = 2;  // tuning-exempt: frame count of the art in this file

/**
 * The marks.
 *
 * One per passage the route names, drawn in the four columns beside the figure
 * so that it never covers the body it identifies -- the same corner of the cell
 * the scribe's quill occupies, which is what makes a follower read as the scribe
 * carrying something else. Every one of them is a *thing from the passage*: the
 * staff at the bush, the crook of the psalm, the lamb of the Passover, the
 * linen Joseph of Arimathaea brought.
 *
 * Nothing here is a badge, a count or an icon of a mechanic. A follower is a
 * record of somewhere the player has been and it is not allowed to say anything
 * else -- see docs/design/11-followers.md#they-have-no-abilities-deliberately.
 */
/* tuning-exempt: every row below is a picture, not a number. */
const MARK_ROWS: ReadonlyMap<string, readonly string[]> = new Map([
  // Eve, Genesis 1: a green shoot, of "every herb yielding seed".
  ['shoot', [
    '................',
    '................',
    '..............G.',
    '............GGG.',
    '.............GG.',
    '..............GG',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '................',
  ]],
  // Adam, Genesis 3: a hoe, "to till the ground from which he was taken".
  ['hoe', [
    '................',
    '................',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............DD',
    '..............DD',
    '................',
  ]],
  // Abraham, Genesis 22: the horn of the ram caught in the thicket.
  ['horn', [
    '................',
    '................',
    '................',
    '..............L.',
    '.............LWL',
    '............LW.L',
    '............LW.L',
    '............LWL.',
    '............LL..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // Moses, Exodus 3: the staff, which he cast on the ground.
  ['staff', [
    '................',
    '.............MM.',
    '.............MM.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '................',
  ]],
  // The firstborn, Exodus 12: the lamb of the Passover, carried.
  ['lamb', [
    '................',
    '................',
    '................',
    '................',
    '.............WW.',
    '............WWWW',
    '............WWWW',
    '............W..W',
    '............W..W',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // The gatherer, Exodus 16: the pot with an omer of manna kept in it.
  ['pot', [
    '................',
    '................',
    '................',
    '.............DD.',
    '............DDDD',
    '............DWWD',
    '............DWWD',
    '............DWWD',
    '............DDDD',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // The one who looked, Numbers 21: the bronze serpent set on a standard.
  ['serpent', [
    '................',
    '............AAA.',
    '............A..A',
    '.............AA.',
    '............AA..',
    '.............A..',
    '..............A.',
    '..............A.',
    '..............A.',
    '..............A.',
    '..............A.',
    '..............A.',
    '..............A.',
    '..............A.',
    '..............A.',
    '................',
  ]],
  // The psalmist, Psalm 22: a harp.
  ['harp', [
    '................',
    '................',
    '..............MM',
    '.............MLM',
    '............MLLM',
    '............MLLM',
    '............MLLM',
    '............MMMM',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // The shepherd, Psalm 23: the crook.
  ['crook', [
    '................',
    '............MMM.',
    '............M.M.',
    '............MMM.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '................',
  ]],
  // Jonah, Jonah 1: the fish.
  ['fish', [
    '................',
    '................',
    '................',
    '................',
    '...............D',
    '............DDDD',
    '............DD.D',
    '............DDDD',
    '...............D',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // The man with the withered hand, Matthew 12: the bruised reed, unbroken.
  ['reed', [
    '................',
    '................',
    '...............G',
    '..............G.',
    '.............G..',
    '............G...',
    '............G...',
    '.............G..',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '..............G.',
    '................',
  ]],
  // Simon of Cyrene, Matthew 27: the beam he was compelled to bear.
  ['beam', [
    '................',
    '..............M.',
    '..............M.',
    '............MMMM',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '..............M.',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // John the Baptist, John 1: the scroll he answered out of.
  ['scroll', [
    '................',
    '................',
    '................',
    '............WWWW',
    '............WDDW',
    '............WDDW',
    '............WDDW',
    '............WWWW',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // Nicodemus, John 3: a lamp, because he came by night.
  ['lamp', [
    '................',
    '................',
    '..............D.',
    '..............D.',
    '............DDDD',
    '............DFFD',
    '............DFFD',
    '............DDDD',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // The boy, John 6: the basket the five loaves came out of.
  ['basket', [
    '................',
    '................',
    '................',
    '................',
    '............LLL.',
    '............MMMM',
    '............MLLM',
    '............MLLM',
    '............MMM.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // The woman, John 8: the stone that was put down and not thrown.
  ['stone', [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..............DD',
    '.............DDD',
    '..............DD',
    '................',
  ]],
  // The doorkeeper, John 10: the key to the fold.
  ['key', [
    '................',
    '................',
    '.............AA.',
    '............A..A',
    '............A..A',
    '.............AA.',
    '..............A.',
    '..............AA',
    '..............A.',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // Joseph of Arimathaea, John 19: the linen he brought.
  ['linen', [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '............WWWW',
    '............WWWW',
    '............WWWW',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
  // Revelation 22: a cup, for "let him take the water of life freely".
  ['cup', [
    '................',
    '................',
    '................',
    '............AAAA',
    '............ALLA',
    '............AAAA',
    '.............AA.',
    '.............AA.',
    '............AAAA',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]],
]);

/** Every mark the roster may name. */
export const FOLLOWER_MARKS: readonly string[] = [...MARK_ROWS.keys()];

function followerMarkSprites(): PixelSprite[] {
  return [...MARK_ROWS].map(([mark, rows]) => sprite(followerMarkId(mark), [rows]));
}

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
    sprite('scribe_hop', [SCRIBE_HOP_0, SCRIBE_HOP_1, SCRIBE_HOP_2]),
    sprite('nib', [NIB_0, NIB_1]),
    sprite('ink_burst', [INK_BURST_0, INK_BURST_1]),
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
    // Ground: every pixel painted, so a floor has no holes in it.
    sprite('tile_stone', [TILE_STONE]),
    sprite('tile_grass', [TILE_GRASS]),
    sprite('tile_sand', [TILE_SAND]),
    sprite('tile_water', [TILE_WATER]),
    sprite('tile_brick', [TILE_BRICK]),
    sprite('tile_bone', [TILE_BONE]),
    sprite('tile_rubble', [TILE_RUBBLE]),
    sprite('tile_deep', [TILE_DEEP]),
    // Distance: the sky shows through what is not painted.
    sprite('tile_dune', [TILE_DUNE]),
    sprite('tile_wave', [TILE_WAVE]),
    sprite('tile_peak', [TILE_PEAK]),
    sprite('tile_roofs', [TILE_ROOFS]),
    sprite('tile_pillars', [TILE_PILLARS]),
    sprite('tile_arch', [TILE_ARCH]),
    sprite('tile_foliage', [TILE_FOLIAGE]),
    sprite('tile_cloud', [TILE_CLOUD]),
    sprite('tile_swell', [TILE_SWELL]),
    sprite('tile_stars', [TILE_STARS]),
    // The line behind the scribe: three silhouettes in three cloths, and one
    // mark per passage the route names. No bespoke follower art -- see the
    // header above `unarmed`.
    ...followerBodySprites(),
    ...followerMarkSprites(),
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
export const HOP_FRAMES = 3;          // tuning-exempt: frame count of the art in this file
export const NIB_FRAMES = 2;          // tuning-exempt: frame count of the art in this file
export const INK_BURST_FRAMES = 2;    // tuning-exempt: frame count of the art in this file

/**
 * The three phases of `scribe_hop`, by name.
 *
 * Indices into this file's own art, exported for the same reason `BURST_FRAMES`
 * is: `core/entities.ts` chooses between them by fraction of the stomp, and a
 * consumer that spelled `1` for "contact" would be a second copy of a fact that
 * only changes when the pictures above do.
 */
export const HOP_RISE = 0;            // tuning-exempt: an index into the art in this file
export const HOP_CONTACT = 1;         // tuning-exempt: an index into the art in this file
export const HOP_BOUNCE = 2;          // tuning-exempt: an index into the art in this file

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
