/**
 * The voice, over every surface rather than only the first one.
 *
 * @doc docs/design/10-first-run.md#tone
 *
 * `core/onboarding.test.ts` already holds the first run to a tone: plain,
 * adult, specific, no exclamation marks, no praise for trivia, and not one word
 * about a mechanic the player has not met. That rule was never meant to stop at
 * the opening screen -- docs/design/08-stats.md#tone-and-leaving says so of the
 * report card in as many words -- and the game grew a great many surfaces over
 * one long night, written hours apart, which is exactly how a voice drifts.
 *
 * So this reads the copy back and holds the whole of it to the same rule. Three
 * sources, chosen because between them they are everything the player reads:
 *
 *  - **The opening screen and the three notes**, from `core/onboarding.ts`.
 *  - **Every sentence the report card can produce**, by running `reportNote`
 *    and `reportAdvice` down all of their branches. These are the two lines the
 *    card is *for*, and they are generated rather than written, so a deny-list
 *    over the source file would never see them.
 *  - **The panels**, by stripping `index.html` to its visible prose. The menu,
 *    the map, the report card in the menu, the promotion and the gilding offer
 *    are markup, and markup is where a string with nothing behind it hides.
 *  - **The stage descriptions**, from `data/curriculum.json`, because they are
 *    not notes to ourselves: they are the promotion panel's lead sentence and
 *    the label beside every entry in the menu's stage picker.
 *
 * ## What is deliberately *not* asserted
 *
 * Not a word count, not a reading level, not a vocabulary. A test that pinned
 * the wording would make every future edit a test edit, and the point is to
 * keep the voice, not to freeze the sentences. What is pinned is the short list
 * of things that were actually going wrong: shouting, praise for trivia, and
 * private vocabulary leaking out of the source and onto the screen -- which is
 * how `candle` reached the HUD before a player had ever seen one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  nameKeys,
  reportAdvice,
  reportCard,
  reportNote,
  reportTrend,
  type GateView,
  type TrendPoint,
} from './draw.js';
import { loadStages } from './curriculum.js';
import { NOTES, OPENING } from './onboarding.js';
import { loadTuning } from './tuning.js';
import type { Key, KeyStat, Tuning } from './types.js';

function readRepoFile(rel: string): string {
  for (const base of ['../../', '../']) {
    try {
      return readFileSync(new URL(base + rel, import.meta.url), 'utf8');
    } catch {
      continue;
    }
  }
  throw new Error(`test: cannot locate ${rel}`);
}

const tuning: Tuning = loadTuning(JSON.parse(readRepoFile('data/tuning.json')) as unknown);
const stages = loadStages(JSON.parse(readRepoFile('data/curriculum.json')) as unknown);
const STAGE_1 = stages[1]?.keySet ?? [];

// --- gathering the copy ------------------------------------------------------

function stat(over: Partial<KeyStat>): KeyStat {
  return { hits: 0, errors: 0, totalMs: 0, latencies: [], confusions: {}, ...over };
}

function part(wpm: number, promoted = false): TrendPoint {
  return { wpm, accuracy: 0.9, promoted }; // tuning-exempt: test fixture
}

/**
 * Hands shaped to reach each branch of the two sentences in turn.
 *
 * Nothing here is a claim about a real player; they exist so that every string
 * the card can print gets printed once, where it can be read.
 */
const HANDS: Readonly<Record<string, Readonly<Record<Key, KeyStat>>>> = {
  // Two fingers doing everything, one of them missing a key badly.
  twoFinger: {
    f: stat({ hits: 9, errors: 1, totalMs: 900, confusions: { d: 1 } }), // tuning-exempt: test fixture
    j: stat({ hits: 4, errors: 4, totalMs: 800, confusions: { k: 3, h: 1 } }), // tuning-exempt: test fixture
  },
  // A hand where one finger is plainly being travelled to.
  reaching: Object.fromEntries(
    ['a', 's', 'd', 'f', 'j', 'k', 'l', ';'].map((key) => [
      key,
      stat({ hits: 40, totalMs: key === 'a' ? 40 * 700 : 40 * 200 }), // tuning-exempt: test fixture
    ]),
  ),
  // A hand that has struck almost nothing at all.
  barelyStarted: { f: stat({ hits: 1, totalMs: 300 }) }, // tuning-exempt: test fixture
  // Every stage-1 key, evenly, so no finger stands out and no key is missed.
  even: Object.fromEntries(
    STAGE_1.map((key) => [key, stat({ hits: 40, totalMs: 40 * 200 })]), // tuning-exempt: test fixture
  ),
};

const TRENDS: readonly TrendPoint[][] = [
  [],
  [part(20)], // tuning-exempt: test fixture
  [part(20), part(24), part(26, true)], // tuning-exempt: test fixture
];

/**
 * A gate standing, as `core/progress.ts` hands one to the card.
 *
 * The figures are a fixture and not a reading of the tuning table: what is
 * under test is the sentence the card writes about them, and it has to be the
 * same sentence whatever the thresholds are set to.
 */
function gate(over: Partial<GateView>): GateView {
  return {
    stage: 2,                 // tuning-exempt: test fixture
    newKeys: ['e', 'i'],
    passed: false,
    accuracyMet: false,
    latencyMet: false,
    samples: 0,               // tuning-exempt: test fixture
    accuracy: 0,              // tuning-exempt: test fixture
    medianMs: 0,              // tuning-exempt: test fixture
    requiredAccuracy: 0.95,   // tuning-exempt: test fixture
    allowedLatencyMs: 400,    // tuning-exempt: test fixture
    requiredSamples: 60,      // tuning-exempt: test fixture
    ...over,
  };
}

/** Every interesting standing: unmeasured, short, failing either half, passed. */
const GATES: readonly (GateView | undefined)[] = [
  undefined,
  gate({}),
  gate({ samples: 80, accuracy: 0.91, medianMs: 320, latencyMet: true }), // tuning-exempt: test fixture
  gate({ samples: 80, accuracy: 0.97, medianMs: 520, accuracyMet: true }), // tuning-exempt: test fixture
  gate({ samples: 20, accuracy: 0.97, medianMs: 320, accuracyMet: true, latencyMet: true }), // tuning-exempt: test fixture
  gate({ samples: 80, accuracy: 0.97, medianMs: 320, accuracyMet: true, latencyMet: true, passed: true }), // tuning-exempt: test fixture
];

/** Every sentence the report card is able to say. */
function cardSentences(): readonly string[] {
  const out: string[] = [];
  for (const keyStats of Object.values(HANDS)) {
    const cards = [
      reportCard({ keyStats, layout: 'ansi' }, tuning),
      reportCard({ keyStats, layout: 'ansi', keySet: stages[0]?.keySet ?? [] }, tuning),
      reportCard({ keyStats, layout: 'ansi', keySet: STAGE_1 }, tuning),
    ];
    for (const card of cards) {
      for (const history of TRENDS) out.push(reportNote(card, reportTrend(history, tuning)));
      for (const gate of GATES) out.push(reportAdvice(card, gate, tuning));
    }
  }
  out.push(nameKeys(['e', 'i']), nameKeys(['c', 'm', 'w', 'v', 'b', 'p']));
  return out;
}

/**
 * `index.html` reduced to what a player actually reads.
 *
 * Style block, comments and tags out; entities to spaces, since the two that
 * matter (`&mdash;`, `&#8617;`) are punctuation rather than words.
 */
function panelProse(): string {
  return readRepoFile('index.html')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COPY: readonly string[] = [
  ...Object.values(NOTES),
  OPENING.title, OPENING.lead, OPENING.body, OPENING.rest, OPENING.button,
  ...cardSentences(),
  ...stages.map((s) => s.description),
  panelProse(),
];

// --- the rules ---------------------------------------------------------------

/** Characters of the offending sentence to print either side of a failure. */
const CONTEXT = 70; // tuning-exempt: how much of a line a failure message quotes

test('the copy really was gathered, or these rules are asserting nothing', () => {
  // A test that reads an empty corpus passes every rule below and protects
  // nothing, which is the failure mode a deny-list over generated strings has.
  assert.ok(COPY.length > 40, `${String(COPY.length)} strings gathered`); // tuning-exempt: a floor, not a tunable
  assert.ok(panelProse().includes('Gilding'), 'the panels were stripped to nothing');
  assert.ok(
    cardSentences().some((s) => s.startsWith('Next:')),
    'the report card produced no advice',
  );
});

test('TONE: nothing anywhere is exclaimed', () => {
  for (const line of COPY) {
    const at = line.indexOf('!');
    assert.equal(at, -1, `an exclamation mark in: ${line.slice(Math.max(0, at - 60), at + 20)}`);
  }
});

test('TONE: no praise for trivia, on any surface', () => {
  // docs/design/10-first-run.md#tone. Overpraise is what makes educational
  // software feel like it is for children, and he will notice immediately.
  const praise = [
    'great', 'well done', 'nice work', 'awesome', 'perfect', 'excellent',
    'good job', 'congratulations', 'brilliant', 'amazing', 'fantastic',
    'keep it up', 'you rock',
  ];
  const all = COPY.join(' \n ').toLowerCase();
  for (const word of praise) {
    assert.ok(!all.includes(word), `overpraise: "${word}"`);
  }
});

test('TONE: nothing scolds, where a fact would do', () => {
  // "You miss it 34% of the time" is something he can work with. "You are
  // struggling with ;" is a verdict, and this card's whole authority is that
  // its numbers are his. docs/design/08-stats.md#tone-and-leaving.
  const verdicts = ['struggling', 'you failed', 'too slow', 'bad habit', 'sloppy', 'careless'];
  const all = COPY.join(' \n ').toLowerCase();
  for (const word of verdicts) {
    assert.ok(!all.includes(word), `a verdict where a fact would do: "${word}"`);
  }
});

test('THE INTERFACE SPEAKS THE PLAYER’S LANGUAGE, NOT THE SOURCE TREE’S', () => {
  /*
   * Words that name something in our source and nothing he has been shown.
   * `candle` is the precedent and the reason this test exists: it named the
   * checkpoint, the chunk boundary and the item at once, it was excellent
   * internal vocabulary, and it appeared in the HUD as `candle 1/11` to a
   * player who had never been told what a candle was -- "I don't know what
   * candles are?". docs/design/03-pacing.md#say-part-not-candle.
   *
   * A term comes off this list when the interface has *introduced* it, not
   * when it becomes convenient: gilding is on no list because the offer and
   * the menu both define it before using it. Adding a word here is cheap;
   * taking one off should cost a paragraph on screen.
   */
  const ours: readonly (readonly [RegExp, string])[] = [
    [/\bcandles?\b/i, 'the part is a "part"; the candle is ours'],
    [/\blectio\b/i, 'the mode is "read without typing"'],
    [/\bchunks?\b/i, 'a chunk is a part'],
    [/\bglyphs?\b/i, 'a glyph is a letter'],
    [/\bribbon\b/i, 'the ribbon is the page'],
    [/\brail\b/i, 'the rail is not named on screen; it is just where the words are'],
    [/\bblot\b/i, 'the blot-cloud is "the ink cloud", which is what is drawn'],
    [/\billuminat(e|ed|ion|ing)\b/i, 'the metaphor the game is named for is never explained'],
    [/\bgreyed\b/i, 'a letter he has not been taught is dim'],
    [/\blive\b/i, 'a character the stage has taught is lit'],
    [/\bmastery gate\b/i, 'a stage "opens"; the gate is ours'],
    [/\bkey ?set\b/i, 'the keys a stage teaches'],
    [/\bcorpus\b/i, 'the text, or the Bible'],
  ];
  for (const line of COPY) {
    for (const [pattern, instead] of ours) {
      const found = pattern.exec(line);
      // `ok` rather than `equal`: a failure here should print the sentence at
      // fault, not the whole of index.html as a diff.
      assert.ok(
        found === null,
        `"${found?.[0] ?? ''}" is our word, not his — ${instead}\n    in: ...`
          + line.slice(Math.max(0, (found?.index ?? 0) - CONTEXT), (found?.index ?? 0) + CONTEXT)
          + '...',
      );
    }
  }
});

test('THE SWITCH FOR THE DIM LETTERS LIVES UNDER A HEADING ABOUT THE DIM LETTERS', () => {
  /*
   * It lived under "Your stage", beside the stage picker, and the one player it
   * was built for could not find it: "I can't type the grey'd words?" A menu is
   * read by its headings, and gilding is not a property of his stage -- the
   * stage decides which letters are lit, the mode decides who types the ones
   * that are not. docs/design/01-illumination.md#finding-the-mode.
   *
   * So: the heading immediately above the control names the thing on screen he
   * is asking about, and the section says what a dim letter is before it asks
   * him anything.
   */
  const html = readRepoFile('index.html');
  const at = html.indexOf('id="menu-gilding"');
  assert.ok(at > 0, 'the gilding control is gone from the menu');
  const headings = [...html.slice(0, at).matchAll(/<h3>([\s\S]*?)<\/h3>/g)];
  const heading = headings[headings.length - 1]?.[1]?.trim() ?? '';
  assert.match(heading, /dim letters/i, `the control sits under "${heading}"`);

  // And the stage picker is not under it: two controls under one heading is how
  // the second one became invisible in the first place.
  const stageAt = html.indexOf('id="menu-stage-select"');
  assert.ok(stageAt > 0 && stageAt < (headings[headings.length - 1]?.index ?? 0));
});

test('the report card says one thing, and says it as a fact about his hands', () => {
  // One finding, never a list: "a card that says four things says none of them,
  // and he has a part to get back to." docs/design/08-stats.md#what-to-work-on-next.
  for (const line of cardSentences()) {
    if (!line.startsWith('Next:')) continue;
    assert.equal(line.split('Next:').length - 1, 1, `two instructions in one line: ${line}`);
  }
});

test('every number the card quotes is quoted against the standard it is measured by', () => {
  // "Not yet" is not something a player can act on. Wherever the card names the
  // gate's accuracy or speed, the figure that opens the stage is on the same
  // line. docs/design/08-stats.md#what-to-work-on-next.
  const card = reportCard({ keyStats: HANDS['even'] ?? {}, layout: 'ansi', keySet: STAGE_1 }, tuning);
  for (const gate of GATES) {
    if (gate === undefined || gate.samples === 0) continue;
    const line = reportAdvice(card, gate, tuning);
    if (/accuracy on/.test(line)) assert.match(line, /the stage opens at \d+%/);
    if (/speed on/.test(line)) assert.match(line, /the stage opens at \d+ ms/);
  }
});
