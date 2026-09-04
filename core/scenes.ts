/**
 * Scenery resolution: a passage citation to a theme, and nothing cleverer.
 *
 * @doc docs/design/05-scenery-warps.md#scenery-is-authored-not-inferred
 *
 * `data/scenes/bible.json` is compiled from the table in
 * docs/design/05-scenery-warps.md and assigns a theme -- and sometimes a set
 * piece -- to ranges of chapters. This module reads that table and answers one
 * question: given `Exodus 14`, what does the level look like?
 *
 * ## Why there is no heuristic here
 *
 * The scene map is "a data layer *over* the text, never derived from it". A
 * user-loaded Gutenberg book has no scene file, so every chapter of it resolves
 * to the abbey, and **that is the correct outcome, not a failure** -- better a
 * neutral library than a keyword heuristic confidently rendering a desert
 * because a novel mentioned sand. So `sceneFor(null, ...)` is a supported call
 * that returns the generic scene, not an error path, and nothing in this file
 * looks at a single character of the passage's prose.
 *
 * ## Ranges
 *
 * A range is `Book C`, `Book C-C` or `Book C:V-V`, parsed by `core/corpus.ts` so
 * that the way a passage is *cited* and the way its book is *titled* cannot
 * drift apart: `Psalm 22-23` in the table matches the routed passage `Psalm 22`,
 * and both resolve through the canon to `Psalms`.
 *
 * Two precisions, and a verse range beats a chapter range covering the same
 * ground. That is what lets Genesis 1 be seven scenes without rewriting the
 * twenty-one chapter rows that are honestly one place each -- "a chapter row
 * stays a useful default and a chapter that moves can be authored finely".
 *
 * Ranges must not overlap *within* a precision -- two chapter rows claiming one
 * chapter, or two verse rows claiming one verse, would make the theme depend on
 * table order, which is the one thing a hand-authored table must never do. A
 * verse row sitting inside a chapter row is not an overlap; it is the mechanism.
 * `overlappingRanges` states that as a function the tests and
 * `tools/validate_data.py` both assert.
 *
 * ## Between two scenes
 *
 * `sceneAtVerse` also answers *how far between two scenes the player is*, so the
 * palette can ease across a boundary while the tiles cut at it. The number it
 * returns is a function of the **verse under the cursor and how far through it
 * the player has typed** -- never of a clock, per
 * docs/decisions/0004-idle-threat-not-speed-timer.md. Stop typing and the world
 * stops changing, which is the whole rule this file is downstream of.
 */

import { canonicalBook, parseReference } from './corpus.js';
import { tuningValue } from './tuning.js';
import type { Tuning } from './types.js';
import { DEFAULT_THEME } from './worlds.js';

// --- the file shape ---------------------------------------------------------

/** One row of the set-piece table, with its range already parsed. */
export interface SceneRow {
  /** The range as the table spells it, e.g. `Exodus 16-17`. */
  readonly range: string;
  /** Canonical book title, so `Psalm` and `Psalms` are the same book. */
  readonly book: string;
  readonly first: number;
  readonly last: number;
  /**
   * The verses a `Book C:V-V` row claims, or null on a chapter row.
   *
   * Null rather than 1 and the chapter's length, because the chapter's length is
   * a fact about the *text* and this file has never been shown a word of it. A
   * chapter row means "wherever nothing finer says otherwise", which is a claim
   * that can be made without knowing how long the chapter is.
   */
  readonly firstVerse: number | null;
  readonly lastVerse: number | null;
  readonly theme: string;
  readonly setpiece: string | null;
}

/** True for a `Book C:V-V` row. The finer precision, and it wins. */
export function isVerseRow(row: SceneRow): boolean {
  return row.firstVerse !== null;
}

export interface SceneMap {
  /** Which text the map is for: `bible`, or the id of an imported book. */
  readonly text: string;
  readonly rows: readonly SceneRow[];
}

/** What a level needs to know about where it is set. */
export interface Scene {
  readonly theme: string;
  readonly setpiece: string | null;
}

/**
 * The documented fallback: "any passage on a route with no row here resolves to
 * `abbey`", and a text with no scene file at all resolves entirely to it.
 */
export const GENERIC_SCENE: Scene = { theme: DEFAULT_THEME, setpiece: null };

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`scenes: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`scenes: ${what} is not a string`);
  return value;
}

interface Span {
  readonly book: string;
  readonly first: number;
  readonly last: number;
  readonly verse: number | null;
  readonly lastVerse: number | null;
}

/** The canonical book a citation names, or the citation's own book for an import. */
function bookOf(citation: string): Span {
  const parsed = parseReference(citation);
  return {
    book: canonicalBook(parsed.book) ?? parsed.book,
    first: parsed.chapter,
    last: parsed.lastChapter,
    verse: parsed.verse,
    lastVerse: parsed.lastVerse,
  };
}

/**
 * Parse a scene file.
 *
 * @throws if the object is not shaped like a scene map, or a range is
 *         backwards. A range whose last chapter precedes its first matches
 *         nothing at all, which would look exactly like a missing row -- an
 *         abbey where the author asked for a sea -- so it is a load error.
 */
export function loadScenes(parsed: unknown): SceneMap {
  const doc = asRecord(parsed, 'parsed file');
  const rawRows = doc['scenes'];
  if (!Array.isArray(rawRows)) throw new Error('scenes: parsed file has no "scenes" array');
  const rows: SceneRow[] = rawRows.map((raw, index) => {
    const row = asRecord(raw, `scenes[${String(index)}]`);
    const range = asString(row['range'], `scenes[${String(index)}].range`);
    const span = bookOf(range);
    if (span.last < span.first) throw new Error(`scenes: range "${range}" runs backwards`);
    if (span.lastVerse !== null && span.verse !== null && span.lastVerse < span.verse) {
      throw new Error(`scenes: range "${range}" runs backwards`);
    }
    const setpiece = row['setpiece'];
    if (setpiece !== null && setpiece !== undefined && typeof setpiece !== 'string') {
      throw new Error(`scenes: range "${range}" has a non-string setpiece`);
    }
    return {
      range,
      book: span.book,
      first: span.first,
      last: span.last,
      firstVerse: span.verse,
      lastVerse: span.lastVerse,
      theme: asString(row['theme'], `range "${range}".theme`),
      setpiece: typeof setpiece === 'string' ? setpiece : null,
    };
  });
  return { text: asString(doc['text'], 'text'), rows };
}

// --- resolution -------------------------------------------------------------

function covers(row: SceneRow, book: string, chapter: number): boolean {
  return row.book === book && chapter >= row.first && chapter <= row.last;
}

/** True when a verse row claims this verse. False for every chapter row. */
function coversVerse(row: SceneRow, book: string, chapter: number, verse: number): boolean {
  if (!covers(row, book, chapter)) return false;
  if (row.firstVerse === null || row.lastVerse === null) return false;
  return verse >= row.firstVerse && verse <= row.lastVerse;
}

/**
 * The row covering a citation, or null.
 *
 * A citation carrying a verse -- `Genesis 1:7`, or the `Genesis 1:1-3` shape
 * `chunkRef` produces -- is answered by the verse row claiming its *first*
 * verse, and falls back to the chapter row when no verse row does. A citation
 * naming only a chapter is answered by the chapter row, because "Genesis 1" is a
 * question about the chapter as a whole and the seven scenes inside it are not
 * an answer to it.
 */
export function rowFor(map: SceneMap | null, citation: string): SceneRow | null {
  if (map === null) return null;
  const span = bookOf(citation);
  if (span.verse !== null) {
    const fine = map.rows.find((row) => coversVerse(row, span.book, span.first, span.verse ?? 0));
    if (fine !== undefined) return fine;
  }
  return map.rows.find((row) => !isVerseRow(row) && covers(row, span.book, span.first)) ?? null;
}

/**
 * The scene for a passage. Never throws for want of a row and never returns
 * null: a passage with no row is an abbey, and so is every passage of a text
 * with no scene map. That is the documented outcome for an imported book.
 */
export function sceneFor(map: SceneMap | null, citation: string): Scene {
  const row = rowFor(map, citation);
  if (row === null) return GENERIC_SCENE;
  return { theme: row.theme, setpiece: row.setpiece };
}

/** Shorthand for the half of a scene most passages need. */
export function themeFor(map: SceneMap | null, citation: string): string {
  return sceneFor(map, citation).theme;
}

/** The set piece a passage is owed, or null. Most passages need only a theme. */
export function setpieceFor(map: SceneMap | null, citation: string): string | null {
  return sceneFor(map, citation).setpiece;
}

/** Every set-piece id the table names, deduplicated, in table order. */
export function setpieceIds(map: SceneMap): readonly string[] {
  const out: string[] = [];
  for (const row of map.rows) {
    if (row.setpiece !== null && !out.includes(row.setpiece)) out.push(row.setpiece);
  }
  return out;
}

/** Every theme id the table names, deduplicated, in table order. */
export function themeIds(map: SceneMap): readonly string[] {
  const out: string[] = [];
  for (const row of map.rows) if (!out.includes(row.theme)) out.push(row.theme);
  return out;
}

/**
 * Pairs of ranges claiming the same chapter.
 *
 * Empty on a well-formed map. Overlap is not a cosmetic problem: with two rows
 * covering a chapter the theme falls out of whichever happens to be listed
 * first, so a table reordered for readability would silently repaint a level.
 */
export function overlappingRanges(map: SceneMap): readonly (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  for (const [index, row] of map.rows.entries()) {
    for (const other of map.rows.slice(index + 1)) {
      if (row.book !== other.book) continue;
      if (row.last < other.first || row.first > other.last) continue;
      // Different precisions do not clash: a verse row inside a chapter row is
      // the whole mechanism, and the finer one wins by rule rather than by
      // being listed first.
      if (isVerseRow(row) !== isVerseRow(other)) continue;
      if (isVerseRow(row) && isVerseRow(other)) {
        const rowLast = row.lastVerse ?? 0;
        const otherFirst = other.firstVerse ?? 0;
        const rowFirst = row.firstVerse ?? 0;
        const otherLast = other.lastVerse ?? 0;
        if (rowLast < otherFirst || rowFirst > otherLast) continue;
      }
      out.push([row.range, other.range]);
    }
  }
  return out;
}

// --- moving between two scenes ----------------------------------------------

/**
 * The scene at a point *inside* a chapter, and how far it has moved toward the
 * next one.
 *
 * `blendTheme` is the theme on the other side of the nearest boundary and
 * `blendMix` is how far the palette has travelled toward it, at most half way --
 * because the ease is symmetrical about the boundary. Just before it the current
 * theme is the old one mixed half toward the new; just after, the new one mixed
 * half back toward the old. Those are the same colour, so the palette is
 * continuous across a cut the tiles make instantly.
 */
export interface SceneAt {
  readonly theme: string;
  readonly setpiece: string | null;
  /** The theme the palette is easing between this one and, or null. */
  readonly blendTheme: string | null;
  /** How far it has eased, 0 at a settled scene and 0.5 at the boundary. */
  readonly blendMix: number;
  /**
   * How far through *this scene's own verses* the player has typed, or null on a
   * chapter row.
   *
   * A set piece is a function of progress through the thing it decorates. On a
   * chapter row that is the chapter, which the caller already knows and this file
   * cannot -- it has never seen how long the chapter is. On a verse row it is the
   * verse span, which this file does know, so it answers rather than making the
   * platform re-derive it from a row it would have to be handed anyway. Without
   * it, `waters_divided` would run from 0.16 to 0.26 across the whole of the
   * second day and read as not moving at all.
   */
  readonly sceneProgress: number | null;
}

/** A settled scene: no boundary near enough to matter. */
function settled(scene: Scene, progress: number | null): SceneAt {
  return {
    theme: scene.theme,
    setpiece: scene.setpiece,
    blendTheme: null,
    blendMix: 0,
    sceneProgress: progress,
  };
}

const HALF = 0.5;  // tuning-exempt: the midpoint of a range, not a knob

/**
 * The verses at which the theme changes inside one chapter.
 *
 * Only boundaries between **two verse rows** count. Where a chapter is authored
 * finely at all it is authored finely throughout, and a boundary against the
 * chapter row underneath would be an ease toward a default the verse rows have
 * already replaced -- at the end of Genesis 1 that is the garden fading toward
 * the daybreak the chapter row still names, which is a scene nobody authored.
 */
function boundariesIn(map: SceneMap, book: string, chapter: number): number[] {
  const fine = map.rows.filter((row) => isVerseRow(row) && covers(row, book, chapter));
  const out: number[] = [];
  for (const row of fine) {
    const at = row.firstVerse ?? 0;
    if (at <= 1) continue;
    const before = fine.find((other) => coversVerse(other, book, chapter, at - 1));
    if (before === undefined || before.theme === row.theme) continue;
    if (!out.includes(at)) out.push(at);
  }
  return out.sort((a, b) => a - b);
}

/**
 * The scene at a fractional verse position.
 *
 * `versePosition` is the verse under the cursor plus how far through that verse
 * the player has typed -- 4.5 is halfway through verse 4. It is the *only* input
 * that moves, and it moves only when a key is struck.
 *
 * `citation` names the chapter (`Genesis 1`); the position says where in it.
 */
export function sceneAtVerse(
  map: SceneMap | null,
  citation: string,
  versePosition: number,
  tuning: Tuning,
): SceneAt {
  if (map === null) return settled(GENERIC_SCENE, null);
  const span = bookOf(citation);
  const verse = Math.max(1, Math.floor(versePosition));
  const cite = (v: number): string => `${span.book} ${String(span.first)}:${String(v)}`;
  const at = (v: number): Scene => sceneFor(map, cite(v));
  const here = at(verse);
  const row = rowFor(map, cite(verse));
  const within = row === null || row.firstVerse === null || row.lastVerse === null
    ? null
    : Math.min(1, Math.max(0,
      (versePosition - row.firstVerse) / (row.lastVerse + 1 - row.firstVerse)));

  const window = tuningValue(tuning, 'scene_blend_verses');
  if (window <= 0) return settled(here, within);
  const half = window * HALF;

  let nearest: number | null = null;
  for (const boundary of boundariesIn(map, span.book, span.first)) {
    const distance = Math.abs(versePosition - boundary);
    if (distance >= half) continue;
    if (nearest === null || distance < Math.abs(versePosition - nearest)) nearest = boundary;
  }
  if (nearest === null) return settled(here, within);

  const other = versePosition < nearest ? at(nearest) : at(nearest - 1);
  if (other.theme === here.theme) return settled(here, within);
  const mix = HALF * (1 - Math.abs(versePosition - nearest) / half);
  return {
    theme: here.theme,
    setpiece: here.setpiece,
    blendTheme: other.theme,
    blendMix: Math.min(HALF, Math.max(0, mix)),
    sceneProgress: within,
  };
}
