/**
 * The corpus: book files, citations, and candle-spaced chunks.
 *
 * @doc docs/architecture/data-schemas.md#text
 *
 * A "book" is an ordered set of named, numbered chunks, so Genesis and a novel
 * are structurally identical -- the shape is fixed by the data-schemas doc and
 * parsed here. Nothing in this module fetches; the platform hands it the parsed
 * object, per docs/architecture/core-purity.md.
 *
 * Two jobs beyond parsing:
 *
 * **Reference resolution.** A citation and a filename are not the same string.
 * `Psalm 23` is how a psalm is cited -- and how docs/design/04-route.md and
 * data/scenes/bible.json spell it -- while the book is titled `Psalms` and its
 * file is `psalms.json`. Today `tools/fetch_bible.py` papers over that by
 * writing the book to disk twice, once under each name, at a cost of ~500KB.
 * `resolveBook` is the resolver that makes the duplicate unnecessary: every
 * citation the corpus admits maps to exactly one canonical title and one file.
 *
 * **Chunking.** A chapter is not a sitting. Genesis 1 is 31 verses and 20+
 * minutes for a beginner; losing that to a closed tab or a death would end the
 * session and possibly the habit. `chunksFor` cuts a chapter at candle
 * intervals -- see docs/design/03-pacing.md -- so progress is saved every few
 * verses and death costs a verse rather than a chapter.
 */

import type { Tuning } from './types.js';
import { tuningValue } from './tuning.js';

// --- the file shape ---------------------------------------------------------

/** A chapter: a named run of units. For a novel, units are paragraphs. */
export interface Section {
  readonly name: string;
  readonly units: readonly string[];
}

/** One book file, as `data/texts/<edition>/<stem>.json` holds it. */
export interface Book {
  readonly title: string;
  readonly edition: string;
  readonly sections: readonly Section[];
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`corpus: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`corpus: ${what} is not a string`);
  return value;
}

/**
 * Parse a fetched book file.
 *
 * Strict rather than forgiving: a half-read book would show up as a chapter of
 * missing verses, which reads to the player as corrupted Scripture rather than
 * as a failed download.
 *
 * @throws if the object is not shaped like a book file
 */
export function loadBook(parsed: unknown): Book {
  const doc = asRecord(parsed, 'parsed file');
  const rawSections = doc['sections'];
  if (!Array.isArray(rawSections)) throw new Error('corpus: parsed file has no "sections" array');
  const sections: Section[] = rawSections.map((raw, index) => {
    const row = asRecord(raw, `sections[${index}]`);
    const units = row['units'];
    if (!Array.isArray(units)) throw new Error(`corpus: sections[${index}].units is not an array`);
    return {
      name: asString(row['name'], `sections[${index}].name`),
      units: units.map((u, j) => asString(u, `sections[${index}].units[${j}]`)),
    };
  });
  if (sections.length === 0) throw new Error('corpus: book has no sections');
  return {
    title: asString(doc['title'], 'title'),
    edition: asString(doc['edition'], 'edition'),
    sections,
  };
}

/** The chapter named `chapter`, or null. Names are strings; `1` is not `01`. */
export function sectionFor(book: Book, chapter: number): Section | null {
  const wanted = String(chapter);
  return book.sections.find((s) => s.name === wanted) ?? null;
}

/** The chapter numbers a book actually holds, in file order. */
export function chapterNumbers(book: Book): number[] {
  const out: number[] = [];
  for (const section of book.sections) {
    const n = Number(section.name);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

// --- the canon --------------------------------------------------------------

interface CanonEntry {
  readonly title: string;
  /** Spellings a citation may use that are not the title. */
  readonly aliases: readonly string[];
}

/**
 * Canonical titles, in canonical order, with the citation spellings that must
 * resolve to them.
 *
 * The titles match `tools/fetch_bible.py`, because they are what the fetched
 * files are named after. The aliases are the cases where the way a passage is
 * *cited* differs from the way the book is *titled* -- the whole reason this
 * table exists rather than a lowercase-and-strip-spaces one-liner.
 */
export const CANON: readonly CanonEntry[] = [
  { title: 'Genesis', aliases: [] },
  { title: 'Exodus', aliases: [] },
  { title: 'Leviticus', aliases: [] },
  { title: 'Numbers', aliases: [] },
  { title: 'Deuteronomy', aliases: [] },
  { title: 'Joshua', aliases: [] },
  { title: 'Judges', aliases: [] },
  { title: 'Ruth', aliases: [] },
  { title: '1 Samuel', aliases: [] },
  { title: '2 Samuel', aliases: [] },
  { title: '1 Kings', aliases: [] },
  { title: '2 Kings', aliases: [] },
  { title: '1 Chronicles', aliases: [] },
  { title: '2 Chronicles', aliases: [] },
  { title: 'Ezra', aliases: [] },
  { title: 'Nehemiah', aliases: [] },
  { title: 'Esther', aliases: [] },
  { title: 'Job', aliases: [] },
  { title: 'Psalms', aliases: ['Psalm'] },
  { title: 'Proverbs', aliases: ['Proverb'] },
  { title: 'Ecclesiastes', aliases: [] },
  { title: 'Song of Songs', aliases: ['Song of Solomon', 'Canticles'] },
  { title: 'Isaiah', aliases: [] },
  { title: 'Jeremiah', aliases: [] },
  { title: 'Lamentations', aliases: [] },
  { title: 'Ezekiel', aliases: [] },
  { title: 'Daniel', aliases: [] },
  { title: 'Hosea', aliases: [] },
  { title: 'Joel', aliases: [] },
  { title: 'Amos', aliases: [] },
  { title: 'Obadiah', aliases: [] },
  { title: 'Jonah', aliases: [] },
  { title: 'Micah', aliases: [] },
  { title: 'Nahum', aliases: [] },
  { title: 'Habakkuk', aliases: [] },
  { title: 'Zephaniah', aliases: [] },
  { title: 'Haggai', aliases: [] },
  { title: 'Zechariah', aliases: [] },
  { title: 'Malachi', aliases: [] },
  { title: 'Matthew', aliases: [] },
  { title: 'Mark', aliases: [] },
  { title: 'Luke', aliases: [] },
  { title: 'John', aliases: [] },
  { title: 'Acts', aliases: ['Acts of the Apostles'] },
  { title: 'Romans', aliases: [] },
  { title: '1 Corinthians', aliases: [] },
  { title: '2 Corinthians', aliases: [] },
  { title: 'Galatians', aliases: [] },
  { title: 'Ephesians', aliases: [] },
  { title: 'Philippians', aliases: [] },
  { title: 'Colossians', aliases: [] },
  { title: '1 Thessalonians', aliases: [] },
  { title: '2 Thessalonians', aliases: [] },
  { title: '1 Timothy', aliases: [] },
  { title: '2 Timothy', aliases: [] },
  { title: 'Titus', aliases: [] },
  { title: 'Philemon', aliases: [] },
  { title: 'Hebrews', aliases: [] },
  { title: 'James', aliases: [] },
  { title: '1 Peter', aliases: [] },
  { title: '2 Peter', aliases: [] },
  { title: '1 John', aliases: [] },
  { title: '2 John', aliases: [] },
  { title: '3 John', aliases: [] },
  { title: 'Jude', aliases: [] },
  { title: 'Revelation', aliases: ['Revelations', 'Apocalypse'] },
];

/**
 * Filename convention, shared with `tools/fetch_bible.py` and
 * `tools/validate_data.py`: lowercase the title and drop everything that is not
 * a letter or a digit, so `1 Corinthians` becomes `1corinthians`.
 */
function stem(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, ''); // tuning-exempt: a character range, not a number
}

const BY_STEM: ReadonlyMap<string, string> = new Map(
  CANON.flatMap((entry) => [entry.title, ...entry.aliases].map((name) => [stem(name), entry.title])),
);

/** A citation's canonical book title, or null when nothing in the canon matches. */
export function canonicalBook(citation: string): string | null {
  return BY_STEM.get(stem(citation)) ?? null;
}

/**
 * The file a citation names, without its directory: `Psalm` -> `psalms.json`.
 *
 * An unknown title falls through to the same stem convention rather than
 * throwing, because an imported public-domain book is not in the canon and must
 * still resolve. Only the *aliasing* needs a table.
 */
export function bookFileName(citation: string): string {
  return `${stem(canonicalBook(citation) ?? citation)}.json`;
}

// --- citations --------------------------------------------------------------

export interface Reference {
  /** The canonical title where one exists, otherwise the citation as written. */
  readonly book: string;
  readonly chapter: number;
  /** The last chapter of a range: `Genesis 2-3`. Equal to `chapter` otherwise. */
  readonly lastChapter: number;
  /**
   * The first verse of a verse range: `Genesis 1:3-5`. Null when the citation
   * names whole chapters.
   *
   * Null rather than 1, because "the chapter" and "the chapter from verse 1" are
   * different claims and the scene map has to tell them apart: a `Genesis 1` row
   * is the chapter's default and a `Genesis 1:1-2` row beats it over two verses.
   * Defaulting to 1 would collapse the two into the same range and the finer row
   * would win everywhere or nowhere.
   */
  readonly verse: number | null;
  /** The last verse of a verse range. Equal to `verse`, or null with it. */
  readonly lastVerse: number | null;
}

/**
 * `Book C`, `Book C-C`, `Book C:V` or `Book C:V-V`.
 *
 * One expression rather than two, because a citation with a colon in it is the
 * same citation with more of it spelled out -- and two regexes tried in order is
 * two places for the book name to be split off differently.
 */
const CITATION = /^\s*(.+?)\s+(\d+)(?:\s*:\s*(\d+)(?:\s*-\s*(\d+))?|\s*-\s*(\d+))?\s*$/;

/**
 * Parse `Genesis 1`, `1 Kings 3`, `Psalm 22-23` or `Genesis 1:3-5`.
 *
 * A verse range names one chapter. `Genesis 1:26-31` is a span *inside* chapter
 * 1, so `chapter` and `lastChapter` are both 1 and the span is in `verse` and
 * `lastVerse` -- there is deliberately no way to write a range that crosses a
 * chapter boundary at verse precision. A scene that ran from one chapter into
 * the middle of the next would have to be resolved against a chapter length the
 * scene map has never been given, and the level the player is typing is a
 * chapter anyway.
 *
 * @throws if the string is not a passage reference
 */
export function parseReference(citation: string): Reference {
  const match = CITATION.exec(citation);
  if (match === null) throw new Error(`corpus: unparseable reference "${citation}"`);
  const [, name, first, verse, lastVerse, lastChapter] = match;
  if (name === undefined || first === undefined) {
    throw new Error(`corpus: unparseable reference "${citation}"`);
  }
  const chapter = Number(first);
  const verseFirst = verse === undefined ? null : Number(verse);
  return {
    book: canonicalBook(name) ?? name.trim(),
    chapter,
    lastChapter: lastChapter === undefined ? chapter : Number(lastChapter),
    verse: verseFirst,
    lastVerse: verseFirst === null ? null : (lastVerse === undefined ? verseFirst : Number(lastVerse)),
  };
}

/** `Genesis 1`. The inverse of `parseReference` for a single chapter. */
export function formatReference(book: string, chapter: number): string {
  return `${book} ${String(chapter)}`;
}

// --- chunking ---------------------------------------------------------------

/** A candle-to-candle span of a chapter. Both bounds are 1-based and inclusive. */
export interface Chunk {
  readonly first: number;
  readonly last: number;
}

/**
 * Cut a chapter into candle-spaced chunks.
 *
 * `candle_interval` is the checkpoint spacing from the tuning table. A chapter
 * shorter than one interval is a single chunk; the final chunk is short rather
 * than padded, because a checkpoint past the end of the text is not a place the
 * player can stand.
 */
export function chunksFor(unitCount: number, tuning: Tuning): Chunk[] {
  const interval = Math.max(1, Math.trunc(tuningValue(tuning, 'candle_interval')));
  const out: Chunk[] = [];
  for (let first = 1; first <= unitCount; first += interval) {
    out.push({ first, last: Math.min(unitCount, first + interval - 1) });
  }
  return out.length === 0 ? [{ first: 1, last: 1 }] : out;
}

/**
 * Index of the chunk holding `unit`, clamped into range.
 *
 * A saved position that no longer exists -- a shorter chapter in the other
 * translation, say -- resolves to the nearest real chunk rather than dropping
 * the player back at the start of the book.
 */
export function chunkIndexFor(chunks: readonly Chunk[], unit: number): number {
  for (const [index, chunk] of chunks.entries()) {
    if (unit >= chunk.first && unit <= chunk.last) return index;
  }
  return unit < 1 ? 0 : Math.max(0, chunks.length - 1);
}

/** `Genesis 1:1-3`, or `Genesis 1:4` for a chunk of one verse. */
export function chunkRef(book: string, chapter: number, chunk: Chunk): string {
  const span = chunk.first === chunk.last
    ? String(chunk.first)
    : `${String(chunk.first)}-${String(chunk.last)}`;
  return `${formatReference(book, chapter)}:${span}`;
}
