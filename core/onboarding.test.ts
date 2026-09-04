/**
 * The first run: it happens once, it says the right things, and it cannot touch
 * the game.
 *
 * @doc docs/design/10-first-run.md#once-only-and-gone
 *
 * Three claims are asserted here, and all three are the kind that would be
 * broken by a plausible edit and noticed by nobody:
 *
 *  - **Once.** Each note fires on its occasion and never again, in the same
 *    session and across a reload. A tip that comes back after you have
 *    understood it is an insult, and it is exactly what an off-by-one in the
 *    seen-set produces.
 *  - **Nothing is charged for it.** The coach is handed a typing state and
 *    returns none, so a first run through a verse and a second run through the
 *    same verse must produce byte-identical cursors, key statistics and scores.
 *  - **Tone.** No exclamation marks, no praise, no mention of speed, and not one
 *    word about stages, the mastery gate, gilding, combos, score, the map,
 *    hearts, the smudge meter or the blot-cloud. That is the feature, so it is
 *    a test rather than a comment somebody can talk themselves out of.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NOTES,
  NOTE_ORDER,
  OPENING,
  type CoachState,
  type NoteId,
  type Occasion,
  createCoach,
  crossedGreyed,
  noteText,
  onOwedSpace,
  stepCoach,
} from './onboarding.js';
import { classify } from './illumination.js';
import { applyKey, createTypingState, score } from './typing.js';
import { loadTuning, tuningValue } from './tuning.js';
import type { Glyph, Key, Tuning, TypingState } from './types.js';

function loadDataFile(name: string): unknown {
  for (const rel of ['../../data/', '../data/']) {
    try {
      return JSON.parse(readFileSync(new URL(rel + name, import.meta.url), 'utf8')) as unknown;
    } catch {
      continue;
    }
  }
  throw new Error(`test: cannot locate data/${name}`);
}

const tuning: Tuning = loadTuning(loadDataFile('tuning.json'));
const HOLD = tuningValue(tuning, 'first_run_note_keys');

/** Stage 1: home row plus the anchors and space. */
const KEYS: readonly Key[] = ['f', 'j', '<space>', 'a', 's', 'd', 'g', 'h', 'k', 'l', ';'];
const KEY_SET: ReadonlySet<Key> = new Set(KEYS);

const NONE: Occasion = { greyed: false, wrong: false, space: false };

function only(id: NoteId): Occasion {
  return { greyed: id === 'greyed', wrong: id === 'wrong', space: id === 'space' };
}

/** Type through a note's dwell so the coach is quiet again. */
function typeOn(state: CoachState, keystrokes: number): CoachState {
  let out = state;
  for (let i = 0; i < keystrokes; i += 1) out = stepCoach(out, NONE, true, tuning);
  return out;
}

// --- once, and then never ----------------------------------------------------

test('each note fires exactly once, and never again however often its occasion recurs', () => {
  let coach = createCoach([]);
  for (const id of NOTE_ORDER) {
    coach = stepCoach(coach, only(id), false, tuning);
    assert.equal(coach.showing, id, `${id} did not fire on its own occasion`);
    assert.equal(noteText(coach), NOTES[id]);
    coach = typeOn(coach, HOLD);
    assert.equal(coach.showing, null, `${id} outstayed ${String(HOLD)} keystrokes`);

    // The occasion comes round again -- a hundred more dim letters, a hundred
    // more spaces -- and the game stays quiet about it.
    const hundred = 100; // tuning-exempt: the length of the simulated trace
    for (let i = 0; i < hundred; i += 1) coach = stepCoach(coach, only(id), true, tuning);
    assert.equal(coach.showing, null, `${id} came back`);
  }
  assert.deepEqual([...coach.seen], [...NOTE_ORDER]);
});

test('a note is spent when it is shown, so a reload cannot bring it back', () => {
  const shown = stepCoach(createCoach([]), only('greyed'), false, tuning);
  assert.equal(shown.showing, 'greyed');
  assert.deepEqual([...shown.seen], ['greyed']);

  // The tab closes here: the note was on the screen and never dismissed. What
  // the record kept is `seen`, and the next session starts from it.
  const reloaded = createCoach(shown.seen);
  assert.equal(reloaded.showing, null);
  assert.equal(stepCoach(reloaded, only('greyed'), false, tuning).showing, null);
});

test('a note is dismissed by continuing to type, and by nothing else', () => {
  let coach = stepCoach(createCoach([]), only('wrong'), false, tuning);
  // Wrong keys are not progress. The note that says so does not leave while the
  // player is still making them.
  const flailing = 20; // tuning-exempt: the length of the simulated trace
  for (let i = 0; i < flailing; i += 1) coach = stepCoach(coach, only('wrong'), false, tuning);
  assert.equal(coach.showing, 'wrong', 'the note left while the player was still stuck');

  coach = typeOn(coach, HOLD - 1);
  assert.equal(coach.showing, 'wrong', 'the note left early');
  coach = typeOn(coach, 1);
  assert.equal(coach.showing, null);
});

test('only one note is ever on screen, and the loser fires on its next occasion', () => {
  // Every occasion at once, which is what the first keystroke of Genesis 1
  // actually looks like: a dim run skipped and a space landed on.
  const all: Occasion = { greyed: true, wrong: true, space: true };
  let coach = stepCoach(createCoach([]), all, false, tuning);
  assert.equal(coach.showing, 'greyed', 'the doc table decides who goes first');
  assert.deepEqual([...coach.seen], ['greyed'], 'a note nobody read was marked seen');

  coach = typeOn(coach, HOLD);
  coach = stepCoach(coach, only('space'), false, tuning);
  assert.equal(coach.showing, 'space', 'the deferred note never came back');
});

test('a coach built from a record with every note spent says nothing at all', () => {
  let coach = createCoach([...NOTE_ORDER]);
  const all: Occasion = { greyed: true, wrong: true, space: true };
  const session = 500; // tuning-exempt: the length of the simulated trace
  for (let i = 0; i < session; i += 1) coach = stepCoach(coach, all, i % 2 === 0, tuning);
  assert.equal(coach.showing, null);
  assert.deepEqual([...coach.seen], [...NOTE_ORDER]);
});

test('a hand-edited record cannot invent a note or resurrect one', () => {
  assert.deepEqual([...createCoach(['nonsense', 'space']).seen], ['space']);
  assert.deepEqual([...createCoach(['space', 'greyed']).seen], ['greyed', 'space']);
});

// --- reading the rail --------------------------------------------------------

test('the occasions are read off the real ribbon, not guessed', () => {
  const text = 'In the beginning, God created the heavens and the earth.';
  const glyphs: Glyph[] = [...classify(text, KEY_SET, 'ansi', 'rt')];

  // "In" is untaught at stage 1 -- `n` arrives at stage 5 and the capital needs
  // shift -- but space is live from stage 0, so the very first thing this
  // passage asks a beginner for is the space bar. Which is exactly why one of
  // the three notes is about the space bar.
  const opened = createTypingState(glyphs, false);
  assert.equal(glyphs[opened.cursor]?.ch, ' ');
  assert.ok(onOwedSpace(glyphs, opened.cursor), 'the cursor is on a space and nobody said so');

  // Pressing it carries the cursor over the greyed `t` and onto the `h`.
  const afterSpace = applyKey(opened, ' ', tuning);
  assert.ok(crossedGreyed(glyphs, opened.cursor, afterSpace.cursor), 'the dim run went unnoticed');
  assert.equal(glyphs[afterSpace.cursor]?.ch, 'h');
  assert.equal(onOwedSpace(glyphs, afterSpace.cursor), false, 'a letter is not a space');

  // And `h` carries it over the greyed `e` onto the next space.
  const afterH = applyKey(afterSpace, 'h', tuning);
  assert.ok(crossedGreyed(glyphs, afterSpace.cursor, afterH.cursor));
  assert.ok(onOwedSpace(glyphs, afterH.cursor));

  // A wrong key moves nothing, so it crosses nothing.
  const held = applyKey(opened, 'x', tuning);
  assert.equal(held.cursor, opened.cursor);
  assert.equal(crossedGreyed(glyphs, opened.cursor, held.cursor), false);
  assert.equal(held.blocked, true);
});

/**
 * A deterministic beginner's trace through a passage: mostly right, with a
 * wrong key every so often. Fixed rather than random, so the two runs below are
 * being compared on identical input rather than on similar input.
 */
function traceFor(glyphs: readonly Glyph[]): string[] {
  const every = 7; // tuning-exempt: a fixed error cadence, near a beginner's one in ten
  const out: string[] = [];
  let typing = createTypingState(glyphs, false);
  let n = 0;
  while (typing.cursor < glyphs.length) {
    const target = glyphs[typing.cursor];
    if (target === undefined) break;
    n += 1;
    // `q` is untaught at stage 1 and is not in this passage, so it is always
    // wrong and never accidentally right.
    const ch = n % every === 0 ? 'q' : target.ch;
    out.push(ch);
    typing = applyKey(typing, ch, tuning);
  }
  return out;
}

test('NOTHING IN THE FIRST-RUN PATH CAN ADVANCE THE CURSOR OR TOUCH A KEY STATISTIC', () => {
  const text = 'In the beginning, God created the heavens and the earth.';
  const glyphs: Glyph[] = [...classify(text, KEY_SET, 'ansi', 'rt')];
  const trace = traceFor(glyphs);

  /**
   * The same trace typed twice: once by a brand new record with the coach
   * running exactly as `platform/web/main.ts` runs it, once by a player three
   * weeks in whose notes are all spent.
   */
  function play(seen: readonly NoteId[]): { typing: TypingState; coach: CoachState } {
    let typing = createTypingState(glyphs, false);
    let coach = createCoach([...seen]);
    for (const ch of trace) {
      const before = typing;
      typing = applyKey(typing, ch, tuning);
      coach = stepCoach(
        coach,
        {
          greyed: crossedGreyed(glyphs, before.cursor, typing.cursor),
          wrong: typing.blocked,
          space: onOwedSpace(glyphs, typing.cursor),
        },
        typing.correct > before.correct,
        tuning,
      );
    }
    return { typing, coach };
  }

  const first = play([]);
  const returning = play(NOTE_ORDER);

  // The first run met all three notes. They arrive in whatever order the
  // passage and the player's fumbles produce them in -- the table in the design
  // doc is a priority for a tie on one keystroke, not a script.
  assert.deepEqual([...first.coach.seen].sort(), [...NOTE_ORDER].sort(), 'a note never fired');
  assert.equal(first.coach.seen[0], 'greyed', 'the dim letters went unexplained the longest');
  // ...and the returning player met none of them.
  assert.equal(returning.coach.showing, null);

  // And the two runs are indistinguishable in every number the game keeps.
  assert.equal(first.typing.cursor, returning.typing.cursor);
  assert.equal(first.typing.correct, returning.typing.correct);
  assert.equal(first.typing.keystrokes, returning.typing.keystrokes);
  assert.equal(first.typing.gilded, returning.typing.gilded);
  assert.deepEqual(first.typing.keyStats, returning.typing.keyStats);
  assert.deepEqual(score(first.typing, tuning), score(returning.typing, tuning));

  // The coach carries nothing a player could win or lose by: no cursor, no
  // statistics, no score. There is no shape of `stepCoach` that could charge
  // for a first run, and this is what says so.
  assert.deepEqual(Object.keys(first.coach).sort(), ['held', 'seen', 'showing']);
});

// --- tone --------------------------------------------------------------------

/** Every word the game says before the player has finished his first passage. */
const COPY: readonly string[] = [
  ...Object.values(NOTES),
  OPENING.title, OPENING.lead, OPENING.bumps, OPENING.body,
  OPENING.rest, OPENING.homeRow, OPENING.button,
];

test('TONE: no exclamation marks and no praise for typing a letter', () => {
  for (const line of COPY) {
    assert.ok(!line.includes('!'), `an exclamation mark in: ${line}`);
  }
  const praise = ['great', 'well done', 'nice work', 'awesome', 'perfect', 'excellent', 'good job'];
  const all = COPY.join(' ').toLowerCase();
  for (const word of praise) {
    assert.ok(!all.includes(word), `overpraise: "${word}" is how software for children reads`);
  }
});

test('TONE: speed is never mentioned, because he already knows he is slow', () => {
  const all = COPY.join(' ').toLowerCase();
  for (const word of ['wpm', 'speed', 'faster', 'quickly', 'slow', 'words per minute']) {
    assert.ok(!all.includes(word), `the first run mentioned ${word}`);
  }
});

test('TONE: nothing the first run says names a mechanic he has not met', () => {
  // docs/design/10-first-run.md#3-what-is-deliberately-not-said. The blot-cloud
  // is the one that matters most: it explains itself when it drifts in, and a
  // warning beforehand reads as a threat to someone already braced for one.
  const unsaid = [
    'stage', 'mastery', 'gate', 'gild', 'combo', 'score', 'point',
    'map', 'heart', 'smudge', 'cloud', 'blot', 'candle', 'monster', 'level',
  ];
  const all = COPY.join(' ').toLowerCase();
  for (const word of unsaid) {
    assert.ok(!all.includes(word), `the first run mentioned the ${word}`);
  }
});

test('the opening screen is one screen with one button, and the notes one sentence each', () => {
  assert.equal(OPENING.button.length > 0, true);

  // One idea: the bumps, and where the hands rest. Everything on that screen is
  // read before a single key is pressed, so it gets a budget -- anything longer
  // is the tutorial wall this design exists to avoid.
  const opening = [
    OPENING.title, OPENING.lead, OPENING.bumps, OPENING.body,
    OPENING.rest, OPENING.homeRow, OPENING.button,
  ].join(' ').split(/\s+/).length;
  const ceiling = 70; // tuning-exempt: a budget on the words said before he types
  assert.ok(opening < ceiling, `the opening screen is ${String(opening)} words long`);

  for (const id of NOTE_ORDER) {
    const note = NOTES[id];
    const sentences = note.split(/(?<=[.?])\s+/).length;
    const most = 2; // tuning-exempt: "one sentence" plus the clause after a semicolon
    assert.ok(sentences <= most, `the ${id} note is a paragraph: ${note}`);
  }

  // The bumps are the whole idea, and they are named.
  assert.ok(OPENING.lead.includes('F') && OPENING.lead.includes('J'));
  assert.ok(OPENING.homeRow.includes('A S D F'));
});
