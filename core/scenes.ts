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
 * A range is `Book C` or `Book C-C`, parsed by `core/corpus.ts` so that the way
 * a passage is *cited* and the way its book is *titled* cannot drift apart:
 * `Psalm 22-23` in the table matches the routed passage `Psalm 22`, and both
 * resolve through the canon to `Psalms`. Ranges must not overlap -- two rows
 * claiming one chapter would make the theme depend on table order, which is the
 * one thing a hand-authored table must never do -- and `overlappingRanges`
 * states that as a function the tests and `tools/validate_data.py` both assert.
 */

import { canonicalBook, parseReference } from './corpus.js';
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
  readonly theme: string;
  readonly setpiece: string | null;
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

/** The canonical book a citation names, or the citation's own book for an import. */
function bookOf(citation: string): { book: string; first: number; last: number } {
  const parsed = parseReference(citation);
  return {
    book: canonicalBook(parsed.book) ?? parsed.book,
    first: parsed.chapter,
    last: parsed.lastChapter,
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
    const setpiece = row['setpiece'];
    if (setpiece !== null && setpiece !== undefined && typeof setpiece !== 'string') {
      throw new Error(`scenes: range "${range}" has a non-string setpiece`);
    }
    return {
      range,
      book: span.book,
      first: span.first,
      last: span.last,
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

/** The row covering a citation, or null. */
export function rowFor(map: SceneMap | null, citation: string): SceneRow | null {
  if (map === null) return null;
  const span = bookOf(citation);
  return map.rows.find((row) => covers(row, span.book, span.first)) ?? null;
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
      out.push([row.range, other.range]);
    }
  }
  return out;
}
