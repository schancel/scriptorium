/**
 * @doc docs/architecture/data-schemas.md#text
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Tuning } from './types.js';
import {
  CANON,
  bookFileName,
  canonicalBook,
  chunkIndexFor,
  chunkRef,
  chunksFor,
  chapterNumbers,
  loadBook,
  parseReference,
  sectionFor,
} from './corpus.js';
import { loadTuning, tuningValue } from './tuning.js';

function dataUrl(name: string): URL | null {
  for (const rel of ['../../data/', '../data/']) {
    const url = new URL(rel + name, import.meta.url);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

function loadDataFile(name: string): unknown {
  const url = dataUrl(name);
  if (url === null) throw new Error(`test: cannot locate data/${name}`);
  return JSON.parse(readFileSync(url, 'utf8')) as unknown;
}

const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));

/**
 * Facts about the text and about citation syntax. None of them is a tunable:
 * turning one would not change how the game feels, it would make the assertion
 * wrong.
 */
const GENESIS_1_VERSES = 31;   // tuning-exempt: the verse count of Genesis 1
const KINGS_CHAPTER = 3;       // tuning-exempt: a chapter number in a citation
const PSALM_FIRST = 22;        // tuning-exempt: the range docs/design/04-route.md cites
const PSALM_LAST = 23;         // tuning-exempt: likewise
const PAST_THE_END = 999;      // tuning-exempt: a bookmark beyond any real chapter
const FOURTH_VERSE = 4;        // tuning-exempt: a verse number

test('a book file parses, and a malformed one is a load error not a silent gap', () => {
  const book = loadBook({
    title: 'Genesis',
    edition: 'WEB',
    sections: [{ name: '1', units: ['a', 'b'] }],
  });
  assert.equal(book.title, 'Genesis');
  assert.equal(sectionFor(book, 1)?.units.length, 2);
  assert.equal(sectionFor(book, 2), null);
  assert.deepEqual(chapterNumbers(book), [1]);

  assert.throws(() => loadBook(null));
  assert.throws(() => loadBook({ title: 'x', edition: 'y', sections: [] }));
  assert.throws(() => loadBook({ title: 'x', edition: 'y', sections: [{ name: '1' }] }));
  assert.throws(() =>
    loadBook({ title: 'x', edition: 'y', sections: [{ name: '1', units: [1] }] }),
  );
});

test('a citation and a title are not the same string, and both resolve to one file', () => {
  // The wart this resolver exists for: docs/design/04-route.md and
  // data/scenes/bible.json cite `Psalm 22`; the book is titled `Psalms`; and
  // tools/fetch_bible.py currently writes the file twice to paper over it.
  assert.equal(canonicalBook('Psalm'), 'Psalms');
  assert.equal(canonicalBook('Psalms'), 'Psalms');
  assert.equal(bookFileName('Psalm'), bookFileName('Psalms'));
  assert.equal(bookFileName('Psalm'), 'psalms.json');

  assert.equal(bookFileName('1 Corinthians'), '1corinthians.json');
  assert.equal(bookFileName('Song of Solomon'), 'songofsongs.json');
  assert.equal(canonicalBook('Revelations'), 'Revelation');

  // An imported public-domain book is not in the canon and must still resolve.
  assert.equal(canonicalBook('The Hound of the Baskervilles'), null);
  assert.equal(bookFileName('The Hound of the Baskervilles'), 'thehoundofthebaskervilles.json');
});

test('every citation the shipped data uses resolves to a canonical book', () => {
  const route = loadDataFile('routes/pilgrimage.json') as {
    edges: readonly { from: string; to: string }[];
  };
  const scenes = loadDataFile('scenes/bible.json') as { scenes: readonly { range: string }[] };

  const cited = new Set<string>();
  for (const edge of route.edges) {
    cited.add(edge.from);
    cited.add(edge.to);
  }
  for (const scene of scenes.scenes) cited.add(scene.range);

  for (const citation of cited) {
    const ref = parseReference(citation);
    assert.notEqual(
      canonicalBook(ref.book),
      null,
      `"${citation}" does not resolve to a book in the canon`,
    );
  }
});

test('resolved filenames are the ones actually on disk, when the texts are fetched', () => {
  const anchor = dataUrl('tuning.json');
  assert.notEqual(anchor, null);
  if (anchor === null) return;
  let checked = 0;
  for (const entry of CANON) {
    for (const edition of ['web', 'kjv']) {
      const path = new URL(`texts/${edition}/${bookFileName(entry.title)}`, anchor);
      if (!existsSync(fileURLToPath(new URL(`texts/${edition}/`, anchor)))) continue;
      assert.ok(existsSync(fileURLToPath(path)), `missing ${entry.title} in ${edition}`);
      checked += 1;
    }
  }
  // `Psalm 22` resolves to psalms.json, so psalm.json is never opened by name.
  if (checked > 0) assert.ok(checked >= CANON.length);
});

test('references parse, including numbered books and ranges', () => {
  assert.deepEqual(parseReference('Genesis 1'), { book: 'Genesis', chapter: 1, lastChapter: 1 });
  assert.deepEqual(parseReference('1 Kings 3'), {
    book: '1 Kings',
    chapter: KINGS_CHAPTER,
    lastChapter: KINGS_CHAPTER,
  });
  assert.deepEqual(parseReference('Psalm 22-23'), {
    book: 'Psalms',
    chapter: PSALM_FIRST,
    lastChapter: PSALM_LAST,
  });
  assert.throws(() => parseReference('Genesis'));
  assert.throws(() => parseReference(''));
});

test('a chapter is cut at candle intervals, covering every verse exactly once', () => {
  const interval = tuningValue(tuning, 'candle_interval');
  const verses = GENESIS_1_VERSES;
  const chunks = chunksFor(verses, tuning);

  assert.equal(chunks[0]?.first, 1);
  assert.equal(chunks[chunks.length - 1]?.last, verses);
  assert.equal(chunks.length, Math.ceil(verses / interval));

  const covered: number[] = [];
  for (const chunk of chunks) {
    assert.ok(chunk.last >= chunk.first);
    assert.ok(chunk.last - chunk.first + 1 <= interval);
    for (let v = chunk.first; v <= chunk.last; v += 1) covered.push(v);
  }
  assert.deepEqual(
    covered,
    Array.from({ length: verses }, (_unused, i) => i + 1),
  );
});

test('a chapter shorter than one candle is a single chunk', () => {
  const chunks = chunksFor(2, tuning);
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], { first: 1, last: 2 });
  // And an empty section still yields somewhere to stand rather than nothing.
  assert.equal(chunksFor(0, tuning).length, 1);
});

test('a saved verse finds its chunk, and an impossible one clamps', () => {
  const chunks = chunksFor(GENESIS_1_VERSES, tuning);
  const interval = tuningValue(tuning, 'candle_interval');
  assert.equal(chunkIndexFor(chunks, 1), 0);
  assert.equal(chunkIndexFor(chunks, interval + 1), 1);
  // A bookmark past the end of a shorter chapter must not send the player home.
  assert.equal(chunkIndexFor(chunks, PAST_THE_END), chunks.length - 1);
  assert.equal(chunkIndexFor(chunks, 0), 0);
});

test('a chunk names itself the way a verse is cited', () => {
  const first = chunksFor(GENESIS_1_VERSES, tuning)[0];
  assert.notEqual(first, undefined);
  if (first === undefined) return;
  assert.equal(chunkRef('Genesis', 1, first), `Genesis 1:1-${String(first.last)}`);
  assert.equal(
    chunkRef('Genesis', 1, { first: FOURTH_VERSE, last: FOURTH_VERSE }),
    `Genesis 1:${String(FOURTH_VERSE)}`,
  );
});
