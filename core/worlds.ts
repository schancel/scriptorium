/**
 * Worlds: what a theme actually looks like.
 *
 * @doc docs/design/05-scenery-warps.md#themes
 *
 * `docs/design/05-scenery-warps.md` names twelve themes and describes each in a
 * sentence -- "stone greys, candle amber", "ochre, bleached sky". `data/themes.json`
 * is compiled from that table and carries the prose and the tune. This module is
 * the picture: for each of those ids, the sixteen colours the art roles in
 * `core/sprites.ts` resolve to, which tiles the ground is built from, and how
 * the parallax layers are stacked.
 *
 * ## Why the palette is a per-theme array of roles
 *
 * Every sprite in the game is written in role indices -- `robe`, `accent`,
 * `groundTop` -- and never in colours. A theme supplies one colour per role, in
 * `PALETTE_ROLES` order. So the *same sixteen pixels* of `tile_stone` read as
 * cloister grey in the abbey and as ochre in the wilderness, and the scribe's
 * habit takes the light of wherever he is standing, with no second tileset and
 * no per-theme art. Twelve themes cost twelve rows of colour here rather than
 * twelve copies of every sprite.
 *
 * Colours are 24-bit RGB integers rather than CSS strings, for the reason the
 * display list gives: a Flutter painter reads the same integer a Canvas renderer
 * does, and neither `core/` nor the port needs a colour parser. They are art
 * data, not tunables -- docs/design/07-tuning.md is about the player's
 * experience, and nobody tunes difficulty by editing a shade of grey.
 *
 * Skin and heart-red are shared across every theme on purpose. A heart must read
 * as a heart in the tomb as clearly as in the garden, and a face that changed
 * colour with the scenery would read as a different character.
 */

import { PALETTE_ROLES } from './sprites.js';

// --- palettes ---------------------------------------------------------------

/** Shared across every theme; see the module header. */
const SKIN = 0xe8b892;
const SKIN_SHADE = 0xb98a68;
const BLOOD = 0xd42a3c;
const BLOOD_DARK = 0x8a1424;
const TRANSPARENT = 0;

/** The eleven colours a theme actually chooses. */
interface ThemeInk {
  readonly outline: number;
  readonly shade: number;
  readonly mid: number;
  readonly light: number;
  readonly highlight: number;
  readonly robe: number;
  readonly robeShade: number;
  readonly accent: number;
  readonly flame: number;
  readonly groundTop: number;
  readonly groundBody: number;
}

/**
 * Expand a theme's choices into the full role array, in `PALETTE_ROLES` order.
 *
 * A builder rather than sixteen literals per theme, so the ordering is stated
 * once. A palette whose roles had silently drifted out of order would recolour
 * every sprite in the game at once, and the test asserts the length matches
 * `PALETTE_ROLES` for exactly that reason.
 */
function palette(ink: ThemeInk): readonly number[] {
  return Object.freeze([
    TRANSPARENT,
    ink.outline, ink.shade, ink.mid, ink.light, ink.highlight,
    SKIN, SKIN_SHADE,
    ink.robe, ink.robeShade,
    ink.accent, ink.flame,
    BLOOD, BLOOD_DARK,
    ink.groundTop, ink.groundBody,
  ]);
}

// --- the layers -------------------------------------------------------------

/**
 * How far each parallax layer lags the camera, and where it sits in the frame.
 *
 * `tuning-exempt` on the same grounds as the band composition in `core/draw.ts`:
 * display-list coordinates are virtual and the platform scales them, so these
 * choose the *composition* of the picture and nothing a player could win or lose
 * by. Depth is a drawing decision; difficulty lives in docs/design/07-tuning.md.
 */
const DEPTH = {
  far: 0.15,     // tuning-exempt: parallax depth, art composition
  mid: 0.4,      // tuning-exempt: parallax depth, art composition
  ground: 1,
} as const;

const BAND = {
  farY: 40,      // tuning-exempt: parallax band composition
  farH: 96,      // tuning-exempt: parallax band composition
  midY: 200,     // tuning-exempt: parallax band composition
  midH: 96,      // tuning-exempt: parallax band composition
  groundY: 296,  // tuning-exempt: parallax band composition
  groundH: 64,   // tuning-exempt: parallax band composition
} as const;

/**
 * One scrolling band of scenery.
 *
 * `factor` is how much of the camera's motion the layer takes: 1 is the ground
 * the scribe stands on, and smaller is further away. There are three because
 * three is enough for depth and a fourth is a frame's worth of drawing for a
 * band nobody looks at.
 */
export interface ParallaxLayer {
  readonly id: string;
  /** A tile id in `core/sprites.ts`. */
  readonly tileId: string;
  readonly factor: number;
  readonly y: number;
  readonly h: number;
}

function layers(far: string, mid: string, ground: string): readonly ParallaxLayer[] {
  return Object.freeze([
    { id: 'far', tileId: far, factor: DEPTH.far, y: BAND.farY, h: BAND.farH },
    { id: 'mid', tileId: mid, factor: DEPTH.mid, y: BAND.midY, h: BAND.midH },
    { id: 'ground', tileId: ground, factor: DEPTH.ground, y: BAND.groundY, h: BAND.groundH },
  ]);
}

// --- worlds -----------------------------------------------------------------

/** The drawable half of a theme. The prose and the tune stay in `data/themes.json`. */
export interface World {
  readonly id: string;
  /** One colour per role, in `PALETTE_ROLES` order. */
  readonly palette: readonly number[];
  /** The tile the level's floor is built from. */
  readonly groundTile: string;
  readonly parallax: readonly ParallaxLayer[];
}

function makeWorld(id: string, ink: ThemeInk, far: string, mid: string, ground: string): World {
  return { id, palette: palette(ink), groundTile: ground, parallax: layers(far, mid, ground) };
}

/**
 * The twelve themes, in the order docs/design/05-scenery-warps.md lists them.
 *
 * Each row chooses eleven colours and three tiles: what stands in the far
 * distance, what stands in the middle, and what the scribe walks on.
 *
 * The two levers cost very different amounts, and choosing between them is the
 * whole craft of this table. A recolour is free -- `tile_stone` is cloister grey
 * in the abbey and ochre in the wilderness with no second tileset -- so it
 * carries every theme that is honestly the same *place* under a different light:
 * the abbey, the temple and the tomb all stand on cut stone, and they differ by
 * candle amber, deep red and cold blue. New art is for what a recolour cannot
 * reach. The sea is not the abbey in blue, because the abbey stands in an arcade
 * and the sea rolls, and no palette turns an arch into a wave.
 *
 * So no two themes stack the same three tiles, and `worlds.test.ts` asserts it.
 * That assertion is the reason the tiles exist: twelve palettes over one
 * silhouette is twelve lightings of the same room.
 *
 * `void` is the hardest case the table has: a world whose whole point is that
 * there is nothing to see in it still has to differ between the horizon and the
 * scribe's feet, or it is one backdrop sliding over itself. It does it in the
 * dark -- an all-`outline` swell behind an all-ground deep -- rather than by
 * giving up and putting a landmark in a chapter that has none yet.
 */
export const WORLDS: ReadonlyMap<string, World> = new Map(
  [
    makeWorld('abbey', {
      outline: 0x14121a, shade: 0x2e2b38, mid: 0x4a4655, light: 0x6f6a7d, highlight: 0xd8d3c4,
      robe: 0x5a4632, robeShade: 0x3a2c20, accent: 0xe8a02c, flame: 0xffe6a8,
      groundTop: 0x5b5566, groundBody: 0x36323f,
      // The cloister: an arcade in the distance, cut stone underfoot.
    }, 'tile_arch', 'tile_stone', 'tile_stone'),

    makeWorld('garden', {
      outline: 0x0f1a10, shade: 0x1f3a22, mid: 0x2f5c33, light: 0x4c8c46, highlight: 0xd8f0b0,
      robe: 0x6a4a2a, robeShade: 0x402c18, accent: 0xf0c64a, flame: 0xfff3c0,
      groundTop: 0x4e9440, groundBody: 0x2b5c2a,
      // Eden: canopy over canopy, and grass to walk on.
    }, 'tile_foliage', 'tile_foliage', 'tile_grass'),

    makeWorld('desert', {
      outline: 0x2a1c10, shade: 0x6b4a24, mid: 0xa8763a, light: 0xd9a860, highlight: 0xf6e3b6,
      robe: 0x8a6a3a, robeShade: 0x5a4424, accent: 0xf0b03a, flame: 0xfff0c8,
      groundTop: 0xe0c07a, groundBody: 0xbb9450,
      // Wandering: dunes to the horizon, and more of them nearer.
    }, 'tile_dune', 'tile_dune', 'tile_sand'),

    makeWorld('sea', {
      outline: 0x081625, shade: 0x14324e, mid: 0x1f5a80, light: 0x3a8fb5, highlight: 0xdff2f7,
      robe: 0x4a4a6a, robeShade: 0x2c2c44, accent: 0xe8c86a, flame: 0xfffbe0,
      groundTop: 0x2f6f8e, groundBody: 0x18415c,
      // The deep, from the shore: surf far out, open water, wet sand.
    }, 'tile_wave', 'tile_water', 'tile_sand'),

    makeWorld('mountain', {
      outline: 0x14161c, shade: 0x2c313c, mid: 0x4a505e, light: 0x767d8c, highlight: 0xdde1e8,
      robe: 0x53414f, robeShade: 0x33262f, accent: 0xe2622c, flame: 0xffb14a,
      groundTop: 0x5a6070, groundBody: 0x353a46,
      // Sinai: the peak behind, a rock face nearer, scree underfoot.
    }, 'tile_peak', 'tile_stone', 'tile_rubble'),

    makeWorld('storm', {
      outline: 0x100b1c, shade: 0x241a3c, mid: 0x3d2c5e, light: 0x5f4a86, highlight: 0xe6dcff,
      robe: 0x4a3a5c, robeShade: 0x2a2038, accent: 0xf2e14a, flame: 0xffffd8,
      groundTop: 0x40315e, groundBody: 0x241a38,
      // Jonah: cloud on top of the sea, and the sea all the way down.
    }, 'tile_cloud', 'tile_wave', 'tile_water'),

    makeWorld('city', {
      outline: 0x2a1e18, shade: 0x6b5442, mid: 0x9c7c5e, light: 0xc9a882, highlight: 0xf4e6cf,
      robe: 0x6d4b34, robeShade: 0x412c1e, accent: 0xc0392b, flame: 0xf0a05a,
      groundTop: 0xb08f6a, groundBody: 0x7c6046,
      // Jerusalem: a skyline over the wall, and the wall's own brick paved flat.
    }, 'tile_roofs', 'tile_brick', 'tile_brick'),

    makeWorld('temple', {
      outline: 0x1d0f10, shade: 0x4a1e20, mid: 0x7d3236, light: 0xb05a4a, highlight: 0xffe8c8,
      robe: 0x7a2430, robeShade: 0x4a1420, accent: 0xf2c14e, flame: 0xfff2b0,
      groundTop: 0x8a5a3a, groundBody: 0x5a3424,
      // The sanctuary: a colonnade twice over, receding, on a stone floor.
    }, 'tile_pillars', 'tile_pillars', 'tile_stone'),

    makeWorld('tomb', {
      outline: 0x05070c, shade: 0x121a28, mid: 0x1e2c42, light: 0x36506e, highlight: 0xb8d0e0,
      robe: 0x2a2c3a, robeShade: 0x181a24, accent: 0x6ea8c8, flame: 0xd8f0ff,
      groundTop: 0x24344c, groundBody: 0x121a28,
      // The catacomb: a wall of bone behind the crypt wall, broken floor.
    }, 'tile_bone', 'tile_stone', 'tile_rubble'),

    makeWorld('daybreak', {
      outline: 0x05040a, shade: 0x1a1a22, mid: 0x4a4438, light: 0xbfae7a, highlight: 0xfffef2,
      robe: 0xe8e0c8, robeShade: 0x9c9478, accent: 0xffd75e, flame: 0xffffff,
      groundTop: 0xc9b26a, groundBody: 0x6e5f38,
      // Daybreak: cloud opening over white stone, the light gathering out of it.
    }, 'tile_cloud', 'tile_cloud', 'tile_stone'),

    makeWorld('void', {
      outline: 0x05060a, shade: 0x090b12, mid: 0x141826, light: 0x1e2436, highlight: 0x9aa6c0,
      robe: 0x2a2c3a, robeShade: 0x14161e, accent: 0x46506e, flame: 0x7f8cb0,
      groundTop: 0x0b0e16, groundBody: 0x070910,
      // Before the first day. The ground is painted within a shade of the sky on
      // purpose: there is no horizon in this world, because there is not yet
      // anything for a horizon to be between. What the player sees is the deep
      // moving in the dark, which is the whole of what the two verses describe.
      // The swell behind it is drawn in `outline`, which is the only ink darker
      // than the sky -- so it is a mass, not a skyline.
    }, 'tile_swell', 'tile_swell', 'tile_deep'),

    makeWorld('firmament', {
      outline: 0x05071a, shade: 0x0b1030, mid: 0x1c2454, light: 0x39447f, highlight: 0xf2f4ff,
      robe: 0x3a3f66, robeShade: 0x22253f, accent: 0xffe9a8, flame: 0xfffdf0,
      groundTop: 0x2c4a38, groundBody: 0x182a20,
      // The fourth day: lights set in the expanse, over land that is already
      // there. Two fields of stars at two depths -- which is the one place
      // parallax does the work by itself, because near stars moving against far
      // ones is exactly what a night sky looks like from a moving thing.
    }, 'tile_stars', 'tile_stars', 'tile_grass'),
  ].map((w) => [w.id, w]),
);

// --- blending between two worlds --------------------------------------------

/**
 * How many steps a palette blend is quantised into.
 *
 * `tuning-exempt` for the same reason `DEPTH` is, and for one more: the renderer
 * bakes every sprite once per palette it is asked for, so a *continuous* blend
 * is a cache with no bound. A fixed number of steps is a fixed number of bakes --
 * at most one per pair of themes per step -- and at sixteen the banding across a
 * transition is finer than the parallax it is painted on.
 *
 * The window the blend runs over is `scene_blend_verses` and lives in the tuning
 * table, because that one is about how the game feels; this one is about how the
 * picture is stored.
 */
const BLEND_STEPS = 16;  // tuning-exempt: art -- quantisation of a baked palette

/**
 * The separator in a blended theme id. Not a character any authored theme id
 * uses, so `worldFor('garden')` can never be mistaken for a blend.
 */
const BLEND_SEP = '~';

/** Fields in a blended id: the theme left, the theme arriving, and the step. */
const BLEND_FIELDS = 3;  // tuning-exempt: the shape of an id, not a number to turn

const BYTE = 0xff;
const R_SHIFT = 16;      // tuning-exempt: bit position of the red channel
const G_SHIFT = 8;       // tuning-exempt: bit position of the green channel

function mixByte(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t) & BYTE;
}

/** Two 24-bit colours mixed per channel. Linear, which is what an ease wants. */
function mixRgb(from: number, to: number, t: number): number {
  const r = mixByte((from >> R_SHIFT) & BYTE, (to >> R_SHIFT) & BYTE, t);
  const g = mixByte((from >> G_SHIFT) & BYTE, (to >> G_SHIFT) & BYTE, t);
  const b = mixByte(from & BYTE, to & BYTE, t);
  return (r << R_SHIFT) | (g << G_SHIFT) | b;
}

/**
 * The id of the palette `mix` of the way from one theme to another.
 *
 * Returns a plain theme id at either end and for a blend with itself, so a frame
 * that is not mid-transition emits exactly the commands it always did -- the
 * display list of a settled scene is byte-for-byte what it was before this
 * existed, which is what makes the transition impossible to leave switched on.
 *
 * The id is data, like every other field in the display list: it survives
 * `JSON.stringify`, and a renderer resolves it through `worldFor` without
 * knowing a transition is happening.
 */
export function blendThemeId(from: string, to: string, mix: number): string {
  if (from === to) return from;
  const step = Math.round(Math.min(1, Math.max(0, mix)) * BLEND_STEPS);
  if (step <= 0) return from;
  if (step >= BLEND_STEPS) return to;
  return `${from}${BLEND_SEP}${to}${BLEND_SEP}${String(step)}`;
}

/**
 * Blended worlds already built, keyed by their id.
 *
 * Memoisation, not state: `worldFor` is a pure function of its argument and this
 * only stops it recomputing sixteen colours per draw command. It is bounded by
 * construction -- pairs of themes times `BLEND_STEPS` -- and in practice holds
 * the handful of boundaries the authored scene map actually contains.
 */
const BLENDED = new Map<string, World>();

/**
 * Build the world a blend id names, or null when the id is not a blend.
 *
 * The tiles and the layer geometry come from the theme being left, not mixed:
 * "colour eases from one scene's palette to the next across the boundary, and
 * tiles change at the boundary itself". Interpolating tile art would look like
 * neither thing.
 */
function blendedWorld(id: string): World | null {
  const parts = id.split(BLEND_SEP);
  if (parts.length !== BLEND_FIELDS) return null;
  const [fromId, toId, stepText] = parts;
  if (fromId === undefined || toId === undefined || stepText === undefined) return null;
  const from = WORLDS.get(fromId);
  const to = WORLDS.get(toId);
  const step = Number(stepText);
  if (from === undefined || to === undefined || !Number.isInteger(step)) return null;
  if (step <= 0 || step >= BLEND_STEPS) return null;
  const t = step / BLEND_STEPS;
  const palette = from.palette.map((colour, index) => {
    const other = to.palette[index];
    // The transparent role stays transparent: mixing it toward a colour would
    // paint the pixels the art deliberately leaves out.
    return other === undefined || index === 0 ? colour : mixRgb(colour, other, t);
  });
  return {
    id,
    palette: Object.freeze(palette),
    groundTile: from.groundTile,
    parallax: from.parallax,
  };
}

/**
 * The documented fallback. "Any passage on a route with no row here resolves to
 * `abbey`", and a user-loaded Gutenberg book gets the abbey throughout -- a
 * neutral library rather than a keyword heuristic confidently rendering a desert
 * because a novel mentioned sand.
 */
export const DEFAULT_THEME = 'abbey';

/**
 * The world for a theme id, falling back to the abbey. Never null.
 *
 * Accepts a blended id from `blendThemeId` as well as an authored one, which is
 * what lets the renderer stay ignorant of transitions: it resolves whatever
 * string the command carries and paints with the sixteen colours it gets back.
 */
export function worldFor(themeId: string): World {
  const authored = WORLDS.get(themeId);
  if (authored !== undefined) return authored;
  const cached = BLENDED.get(themeId);
  if (cached !== undefined) return cached;
  const built = blendedWorld(themeId);
  if (built === null) return WORLDS.get(DEFAULT_THEME) ?? unreachable();
  BLENDED.set(themeId, built);
  return built;
}

function unreachable(): never {
  throw new Error('worlds: the default theme is missing from WORLDS');
}

/** The colour a role resolves to in this world. */
export function colourFor(world: World, roleIndex: number): number {
  return world.palette[roleIndex] ?? TRANSPARENT;
}

/** The index of a named role, or -1. The inverse of `PALETTE_ROLES`. */
export function roleIndex(role: string): number {
  return PALETTE_ROLES.indexOf(role);
}

// --- the theme table --------------------------------------------------------

/** One row of `data/themes.json`, compiled from the scenery doc. */
export interface ThemeDoc {
  readonly id: string;
  readonly palette: string;
  readonly mood: string;
  readonly tune: string;
}

/**
 * Parse `data/themes.json`, which the platform loads.
 *
 * Throws on a theme with no world, for the same reason `core/items.ts` throws on
 * an item with no implementation: the docs are canonical, so a theme in the
 * table and not in this file means the code is behind, and silently falling back
 * to the abbey would hide it for as long as nobody happened to play that
 * passage.
 *
 * @throws if the file is malformed or names a theme this module cannot draw
 */
export function loadThemes(parsed: unknown): ThemeDoc[] {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('worlds: expected the parsed themes file, got a non-object');
  }
  const rows: unknown = (parsed as { themes?: unknown }).themes;
  if (!Array.isArray(rows)) throw new Error('worlds: parsed file has no "themes" array');
  return rows.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`worlds: themes[${String(index)}] is not an object`);
    }
    const row = raw as Record<string, unknown>;
    for (const field of ['id', 'palette', 'mood', 'tune']) {
      if (typeof row[field] !== 'string') {
        throw new Error(`worlds: themes[${String(index)}].${field} is not a string`);
      }
    }
    const doc = row as unknown as ThemeDoc;
    if (!WORLDS.has(doc.id)) throw new Error(`worlds: theme "${doc.id}" has no world`);
    return doc;
  });
}
