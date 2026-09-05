/**
 * Reading mode: one word at a time, on one column, at a pace in real words.
 *
 * @doc docs/design/02-rail.md#reading-mode
 *
 * The mode's whole risk used to be the ramp. It still is -- unbounded it runs
 * the passage past faster than anyone reads, ungated it climbs while nobody is
 * reading, and ungoverned by `dtMs` it drifts with the frame rate, which is the
 * determinism rule in docs/architecture/core-purity.md#the-injected-seams.
 *
 * But the mode's *shape* is now the thing worth asserting, because it was wrong
 * and the owner caught it. It scrolled the ribbon at a rising pace, which is a
 * teleprompter, and a teleprompter is the thing speed reading exists to escape.
 * So the properties below come first:
 *
 *  - one word on the screen, and only ever one;
 *  - the anchor letter on the focal column, on every frame of a whole chapter;
 *  - nothing between two words of the same word -- the offset is a function of
 *    *which word*, so there is no intermediate position for anything to slide
 *    through;
 *  - the anchor is the RSVP convention rather than the middle of the word;
 *  - a pace in words, counted as words;
 *  - and a pace the player can bring down without leaving the mode.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  anchorOffset,
  createLectio,
  easePace,
  lectioAnchorIndex,
  lectioFinished,
  lectioProgress,
  lectioWord,
  msForPace,
  msToMaxPace,
  paceWpm,
  pauseLectio,
  quickenPace,
  readingOffset,
  restartLectio,
  setPace,
  splitReadingWords,
  stepLectio,
  wordHoldMs,
  type LectioState,
  type ReadingWord,
} from './lectio.js';
import { classify } from './illumination.js';
import { CELL_W, focalX } from './rail.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { Glyph, Key, Tuning } from './types.js';

function dataUrl(name: string): URL | null {
  for (const rel of ['../../data/', '../data/']) {
    const url = new URL(rel + name, import.meta.url);
    if (existsSync(fileURLToPath(url))) return url;
  }
  return null;
}

const url = dataUrl('tuning.json');
if (url === null) throw new Error('test: cannot locate data/tuning.json');
const tuning: Tuning = loadTuning(JSON.parse(readFileSync(url, 'utf8')) as unknown);

const START = tuningValue(tuning, 'lectio_start_words_per_min');
const RAMP = tuningValue(tuning, 'lectio_ramp_words_per_min');
const MAX = tuningValue(tuning, 'lectio_max_words_per_min');
const STEP = tuningValue(tuning, 'lectio_pace_step');
const COMMA_HOLD = tuningValue(tuning, 'lectio_comma_hold');
const STOP_HOLD = tuningValue(tuning, 'lectio_stop_hold');

const MINUTE_MS = 60000;   // tuning-exempt: a minute, in milliseconds
const FRAME_MS = 16;       // tuning-exempt: test fixture, a frame at 60Hz
const HOUR_FRAMES = 225000; // tuning-exempt: an hour of frames at 60Hz
const VIEWPORT_W = 640;    // tuning-exempt: test fixture, a virtual viewport width

/** Everything typable, so nothing in a fixture is greyed for the wrong reason. */
const KEY_SET: ReadonlySet<Key> = new Set<Key>([
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
  'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
  '<space>', '<shift>', ',', '.', ';', "'", '-',
]);

function glyphsOf(text: string): Glyph[] {
  return [...classify(text, KEY_SET, 'ansi', 'rt')];
}

/** A ribbon, its words, and the verse each glyph belongs to. */
function passage(units: readonly string[]): {
  glyphs: Glyph[];
  verseAt: number[];
  words: readonly ReadingWord[];
} {
  const glyphs: Glyph[] = [];
  const verseAt: number[] = [];
  units.forEach((unit, index) => {
    // Exactly how `buildRibbon` joins them: a space, and no line break.
    for (const glyph of glyphsOf(index === 0 ? unit : ` ${unit}`)) {
      glyphs.push(glyph);
      verseAt.push(index + 1);
    }
  });
  return { glyphs, verseAt, words: splitReadingWords(glyphs, verseAt, tuning) };
}

const CHAPTER = passage([
  'In the beginning God created the heavens and the earth.',
  'Now the earth was formless and empty. Darkness was on the surface of the deep,'
  + ' and God’s Spirit was hovering over the surface of the waters.',
  'God said, “Let there be light,” and there was light.',
  'God saw the light, and saw that it was good. God divided the light from the darkness.',
]);

/** The text of one word, read back off the ribbon. */
function textOf(glyphs: readonly Glyph[], word: ReadingWord): string {
  let out = '';
  for (let i = word.start; i < word.end; i += 1) out += glyphs[i]?.ch ?? '';
  return out;
}

/** A run of frames, all sustained unless a predicate says otherwise. */
function run(
  frames: number,
  sustained: (index: number) => boolean = (): boolean => true,
  dtMs: number = FRAME_MS,
): LectioState {
  let state = createLectio(tuning);
  for (let i = 0; i < frames; i += 1) {
    state = stepLectio(state, dtMs, CHAPTER.words, sustained(i), tuning);
  }
  return state;
}

// --- the shape of the mode ---------------------------------------------------

test('THE PASSAGE IS A LIST OF WORDS, AND EVERY CHARACTER OF IT IS IN ONE', () => {
  const { glyphs, words } = CHAPTER;
  assert.ok(words.length > 40, `only ${String(words.length)} words`); // tuning-exempt: fixture floor

  // Every non-separator glyph is inside exactly one word, in order, and no word
  // contains a separator. Nothing is filtered and nothing is rewritten -- the
  // mode shows the real text, per
  // docs/decisions/0003-illumination-over-corpus-filtering.md.
  let at = 0;
  for (const word of words) {
    assert.ok(word.start >= at, 'words overlap or run backwards');
    for (let i = at; i < word.start; i += 1) {
      assert.ok(' \n\t'.includes(glyphs[i]?.ch ?? ''), 'a character fell between two words');
    }
    assert.ok(word.end > word.start, 'an empty word');
    for (let i = word.start; i < word.end; i += 1) {
      assert.ok(!' \n\t'.includes(glyphs[i]?.ch ?? ''), 'a separator inside a word');
    }
    at = word.end;
  }
  for (let i = at; i < glyphs.length; i += 1) {
    assert.ok(' \n\t'.includes(glyphs[i]?.ch ?? ''), 'a character fell off the end');
  }

  const rejoined = words.map((w) => textOf(glyphs, w)).join(' ');
  assert.ok(rejoined.startsWith('In the beginning God created'), rejoined.slice(0, 40)); // tuning-exempt: how much of the failure to print
});

test('THE ANCHOR IS THE RSVP CONVENTION AND NOT THE MIDDLE OF THE WORD', () => {
  // First letter for one, second for short, third for medium, fourth for long,
  // and it stops there: a fourteen-letter word anchors where a ten-letter one
  // does. docs/design/02-rail.md#the-anchor-exactly
  assert.equal(anchorOffset(1), 0);
  for (const n of [2, 3, 4, 5]) assert.equal(anchorOffset(n), 1, `${String(n)} letters`); // tuning-exempt: the RSVP tiers, which is what this test is for
  for (const n of [6, 7, 8, 9]) assert.equal(anchorOffset(n), 2, `${String(n)} letters`); // tuning-exempt: as above
  for (const n of [10, 13, 14, 20, 45]) assert.equal(anchorOffset(n), 3, `${String(n)} letters`); // tuning-exempt: as above

  // And it is left of centre for everything but the very shortest, which is the
  // whole reason the convention exists.
  for (const n of [4, 6, 9, 10, 14, 30]) { // tuning-exempt: word lengths to check the convention over
    assert.ok(anchorOffset(n) < n / 2, `${String(n)} letters anchored at or past centre`);
  }

  // On real words, measured over the *letters*: a trailing comma is not part of
  // the word and may not shift where the eye is asked to land.
  const anchored = (text: string): string => {
    const glyphs = glyphsOf(text);
    const word = splitReadingWords(glyphs, [], tuning)[0];
    assert.ok(word !== undefined);
    return glyphs[lectioAnchorIndex(word)]?.ch ?? '';
  };
  assert.equal(anchored('a'), 'a');
  assert.equal(anchored('the'), 'h');
  assert.equal(anchored('beginning'), 'g');
  assert.equal(anchored('beginning,'), 'g', 'the comma moved the anchor');
  assert.equal(anchored('lovingkindness'), 'i', 'fourteen letters, still the fourth');
  assert.equal(anchored('“lovingkindness,”'), 'i', 'and quotes moved nothing');
});

test('PUNCTUATION EARNS A BEAT, AND SO DOES THE END OF A VERSE', () => {
  const { glyphs, words } = CHAPTER;
  const holdOf = (text: string): number => {
    const found = words.find((w) => textOf(glyphs, w) === text);
    assert.ok(found !== undefined, `no word "${text}" in the fixture`);
    return found.hold;
  };
  assert.equal(holdOf('the'), 1, 'an ordinary word is one beat');
  assert.equal(holdOf('said,'), COMMA_HOLD);
  assert.equal(holdOf('deep,'), COMMA_HOLD);
  assert.equal(holdOf('empty.'), STOP_HOLD);
  assert.equal(holdOf('light,”'), COMMA_HOLD, 'the quote carries no beat of its own');
  assert.ok(STOP_HOLD > COMMA_HOLD && COMMA_HOLD > 1, 'a full stop outlasts a comma');

  // The ribbon joins verses with a space rather than a line break, so without
  // this one verse runs into the next with no beat between them at all.
  const lastOfVerseOne = words.find((w) => textOf(glyphs, w) === 'earth.');
  assert.ok(lastOfVerseOne !== undefined);
  assert.equal(lastOfVerseOne.hold, STOP_HOLD);
  const versed = passage(['one two three', 'four five six']);
  const boundary = versed.words[2];
  assert.ok(boundary !== undefined && textOf(versed.glyphs, boundary) === 'three');
  assert.equal(boundary.hold, STOP_HOLD, 'a verse that ended should feel like it ended');
  assert.equal(versed.words[1]?.hold, 1, 'and the word before it is ordinary');
});

test('THE ANCHOR COLUMN IS THE SAME COLUMN ON EVERY FRAME OF A WHOLE CHAPTER', () => {
  const expected = focalX(VIEWPORT_W, tuning);
  const columns = new Set<number>();
  const drawnPerFrame = new Set<number>();
  let state = createLectio(tuning);
  let frames = 0;
  let seen = 0;
  while (!lectioFinished(state, CHAPTER.words)) {
    const word = lectioWord(state, CHAPTER.words);
    assert.ok(word !== null);
    // Exactly one word is on the screen, and it is a real one.
    drawnPerFrame.add(word.end - word.start);
    seen += 1;
    const offset = readingOffset(word, VIEWPORT_W, tuning);
    columns.add(offset + lectioAnchorIndex(word) * CELL_W);
    // And the anchor is inside the word it anchors, always.
    assert.ok(word.anchor >= 0 && word.anchor < word.end - word.start);
    state = stepLectio(state, FRAME_MS, CHAPTER.words, true, tuning);
    frames += 1;
    assert.ok(frames < HOUR_FRAMES, 'the sitting never ended');
  }
  assert.ok(seen > frames / 2, 'the fixture barely drew anything');
  assert.equal(columns.size, 1, `the anchor drifted: ${[...columns].join(', ')}`);
  assert.ok(columns.has(expected), `anchored at ${[...columns].join(', ')}, not ${String(expected)}`);
  assert.ok(!drawnPerFrame.has(0), 'an empty word reached the screen');
});

test('NOTHING SLIDES: THE OFFSET IS A FUNCTION OF WHICH WORD AND OF NOTHING ELSE', () => {
  /*
   * The old mode's offset was a fractional character count driven by a clock,
   * so it was different on every frame -- which is what made it a teleprompter.
   * The claim now is stronger than "it moves less": there is no expression in
   * which time appears, so two frames showing the same word are the same
   * picture, and the set of offsets a sitting ever produces is exactly the set
   * of words in it.
   */
  const offsets = new Map<number, number>();
  let state = createLectio(tuning);
  let previous: { index: number; offset: number } | null = null;
  while (!lectioFinished(state, CHAPTER.words)) {
    const word = lectioWord(state, CHAPTER.words);
    assert.ok(word !== null);
    const offset = readingOffset(word, VIEWPORT_W, tuning);
    if (previous !== null && previous.index === state.index) {
      assert.equal(offset, previous.offset, 'the ribbon moved without the word changing');
    }
    offsets.set(state.index, offset);
    previous = { index: state.index, offset };
    state = stepLectio(state, FRAME_MS, CHAPTER.words, true, tuning);
  }
  assert.equal(offsets.size, CHAPTER.words.length, 'a word was skipped or shown twice');

  // Same word, wildly different clocks: same offset. Nothing a frame timer does
  // can reach this number.
  const word = CHAPTER.words[7]; // tuning-exempt: test fixture, an arbitrary word in the middle
  assert.ok(word !== undefined);
  const at = readingOffset(word, VIEWPORT_W, tuning);
  assert.equal(readingOffset(word, VIEWPORT_W, tuning), at);
  assert.equal(at, focalX(VIEWPORT_W, tuning) - lectioAnchorIndex(word) * CELL_W);
});

// --- the pace ----------------------------------------------------------------

test('the pace is words per minute, literally', () => {
  const plain: ReadingWord = { start: 0, end: 3, anchor: 1, hold: 1 }; // tuning-exempt: a three-letter word
  // 180 words a minute means a word every third of a second and nothing else --
  // not 180 * wpm_chars_per_word characters, which is what it used to mean.
  assert.equal(wordHoldMs(plain, START), MINUTE_MS / START);
  assert.equal(wordHoldMs(plain, MAX), MINUTE_MS / MAX);
  assert.equal(
    wordHoldMs({ ...plain, hold: STOP_HOLD }, START),
    (MINUTE_MS / START) * STOP_HOLD,
    'and punctuation is a multiple of that beat',
  );

  // Counted end to end: a minute of ordinary words at a held pace shows the
  // number of words the pace names.
  const ordinary = passage([Array.from({ length: 400 }, () => 'word').join(' ')]); // tuning-exempt: fixture length
  let state = setPace(createLectio(tuning), START, tuning);
  for (let i = 0; i < MINUTE_MS / FRAME_MS; i += 1) {
    state = stepLectio(state, FRAME_MS, ordinary.words, false, tuning);
  }
  assert.ok(Math.abs(state.index - START) <= 1, `${String(state.index)} words in a minute`);
});

test('reading opens at the opening pace, on the first word', () => {
  const state = createLectio(tuning);
  assert.equal(state.wpm, START);
  assert.equal(state.index, 0);
  assert.equal(state.holdMs, 0);
  assert.equal(state.sustainedMs, 0);
  assert.equal(paceWpm(0, tuning), START);
});

test('the pace climbs by lectio_ramp_words_per_min per sustained minute', () => {
  assert.equal(paceWpm(MINUTE_MS, tuning), START + RAMP);
  assert.equal(paceWpm(MINUTE_MS + MINUTE_MS, tuning), START + RAMP + RAMP);
  const minute = run(Math.round(MINUTE_MS / FRAME_MS));
  assert.equal(minute.sustainedMs, MINUTE_MS);
  assert.equal(minute.wpm, START + RAMP);
});

test('THE RAMP IS BOUNDED BY lectio_max_words_per_min', () => {
  const hour = run(HOUR_FRAMES);
  assert.equal(hour.wpm, MAX);
  assert.ok(hour.sustainedMs > msToMaxPace(tuning), 'well past the ceiling');
  for (const ms of [0, MINUTE_MS, msToMaxPace(tuning), hour.sustainedMs]) {
    const wpm = paceWpm(ms, tuning);
    assert.ok(wpm >= START && wpm <= MAX, `pace ${String(wpm)} escaped its bounds`);
  }
  assert.equal(paceWpm(msToMaxPace(tuning), tuning), MAX, 'and reaches it exactly');
});

test('THE RAMP ONLY ADVANCES WHILE THE PLAYER SUSTAINS IT', () => {
  const frames = Math.round(MINUTE_MS / FRAME_MS);
  const sustained = run(frames);
  const halfHearted = run(frames + frames, (i) => i % 2 === 0);
  assert.equal(halfHearted.sustainedMs, sustained.sustainedMs, 'half the frames, twice as long');
  assert.equal(halfHearted.wpm, sustained.wpm);

  const abandoned = run(frames + frames, (i) => i < frames);
  assert.equal(abandoned.sustainedMs, MINUTE_MS);
  assert.equal(abandoned.wpm, START + RAMP, 'it held, and it did not climb');
  assert.ok(abandoned.elapsedMs > abandoned.sustainedMs, 'while the clock kept running');
});

test('the ramp holds rather than falling back, and only a restart gives it up', () => {
  const climbed = run(Math.round(MINUTE_MS / FRAME_MS));
  const paused = pauseLectio(climbed, MINUTE_MS);
  assert.equal(paused.wpm, climbed.wpm, 'a reader who looks away loses nothing');
  assert.equal(paused.index, climbed.index, 'and the word stood still');
  assert.equal(paused.elapsedMs, climbed.elapsedMs + MINUTE_MS);

  const fresh = restartLectio(climbed, tuning);
  assert.equal(fresh.wpm, START);
  assert.equal(fresh.sustainedMs, 0);
  assert.equal(fresh.index, climbed.index, 'keeping the reader in their place');
});

test('THE PACE COMES DOWN FROM INSIDE THE MODE, AND STAYS DOWN', () => {
  /*
   * The old mode could only be slowed by quitting and re-entering, which
   * restarts the ramp. A decision the player has no way to express is not a
   * decision he made -- docs/design/02-rail.md#coming-back-down.
   */
  const climbed = run(Math.round((MINUTE_MS * 5) / FRAME_MS)); // tuning-exempt: five minutes of ramp
  assert.ok(climbed.wpm > START + RAMP, 'the fixture never climbed');

  const eased = easePace(climbed, tuning);
  assert.equal(eased.wpm, climbed.wpm - STEP, 'one press is one step');
  assert.equal(eased.index, climbed.index, 'and it does not lose his place');
  assert.equal(eased.elapsedMs, climbed.elapsedMs, 'nor leave the sitting');

  // It moved the ramp clock rather than sitting on top of it, so the ramp does
  // not quietly walk back over the decision a few seconds later.
  assert.equal(eased.sustainedMs, msForPace(eased.wpm, tuning));
  let after = eased;
  // A few frames, to see whether the ramp quietly walks over the decision.
  for (let i = 0; i < 10; i += 1) after = stepLectio(after, FRAME_MS, CHAPTER.words, true, tuning); // tuning-exempt: a few frames
  assert.ok(after.wpm < climbed.wpm, 'the ramp overrode the player');

  // Repeated presses walk it down, and it stops at the opening pace: there is
  // no way to press this until the page stops turning.
  let down = climbed;
  for (let i = 0; i < 100; i += 1) down = easePace(down, tuning); // tuning-exempt: far more presses than the range holds
  assert.equal(down.wpm, START, 'the floor is the opening pace');
  assert.equal(easePace(down, tuning).wpm, START);

  // And back up, bounded by the same ceiling the ramp is.
  let up = createLectio(tuning);
  assert.equal(quickenPace(up, tuning).wpm, START + STEP);
  for (let i = 0; i < 1000; i += 1) up = quickenPace(up, tuning); // tuning-exempt: as above
  assert.equal(up.wpm, MAX, 'the ceiling is the ramp’s ceiling');

  // The pace is one number: rewinding to it and reading up to it agree.
  for (const wpm of [START, START + STEP, MAX, MAX + MAX, -1]) {
    const set = setPace(createLectio(tuning), wpm, tuning);
    assert.equal(set.wpm, paceWpm(msForPace(wpm, tuning), tuning));
    assert.ok(set.wpm >= START && set.wpm <= MAX);
  }
});

test('THE SAME dtMs SEQUENCE ALWAYS PRODUCES THE SAME STATE', () => {
  const trace = [FRAME_MS, FRAME_MS + FRAME_MS, 0, FRAME_MS, MINUTE_MS, FRAME_MS];
  const replay = (): LectioState => {
    let state = createLectio(tuning);
    for (const [index, dt] of trace.entries()) {
      state = stepLectio(state, dt, CHAPTER.words, index % 2 === 0, tuning);
    }
    return state;
  };
  assert.deepEqual(replay(), replay());
  assert.deepEqual(run(Math.round(MINUTE_MS / FRAME_MS)), run(Math.round(MINUTE_MS / FRAME_MS)));
  assert.equal(
    stepLectio(createLectio(tuning), -1, CHAPTER.words, true, tuning).index, 0,
    'time never runs backwards',
  );
});

test('a long frame passes the words it passed, and never spins', () => {
  // A backgrounded tab, or the ceiling on a short word: more than one word can
  // fall inside one frame, and the loop has to be a loop.
  const jumped = stepLectio(createLectio(tuning), MINUTE_MS, CHAPTER.words, true, tuning);
  assert.ok(jumped.index > 1, `${String(jumped.index)} words in a minute-long frame`);
  const past = stepLectio(createLectio(tuning), MINUTE_MS * MINUTE_MS, CHAPTER.words, true, tuning);
  assert.equal(past.index, CHAPTER.words.length, 'and it stops at the end of the passage');
  assert.equal(lectioFinished(past, CHAPTER.words), true);
});

test('progress and the end of the passage', () => {
  const fresh = createLectio(tuning);
  assert.equal(lectioProgress(fresh, CHAPTER.words), 0);
  assert.equal(lectioFinished(fresh, CHAPTER.words), false);
  assert.equal(lectioProgress(fresh, []), 1, 'an empty passage is already read');
  assert.equal(lectioFinished(fresh, []), true);

  let state = fresh;
  while (!lectioFinished(state, CHAPTER.words)) {
    state = stepLectio(state, FRAME_MS, CHAPTER.words, true, tuning);
  }
  assert.equal(lectioProgress(state, CHAPTER.words), 1);
  assert.equal(lectioWord(state, CHAPTER.words), null);
  assert.ok(state.wpm > START, 'and the reader picked up pace on the way');
});
