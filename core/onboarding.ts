/**
 * The first run: one screen about the two bumps, then three notes that fire
 * once each and never again.
 *
 * @doc docs/design/10-first-run.md#the-shape-coach-inline-do-not-lecture
 *
 * Pure, and deliberately small. Everything the player is ever told before he
 * has typed anything is the `OPENING` block below; everything he is told while
 * typing is one of the three sentences in `NOTES`. Both live here rather than
 * in `platform/web/`, because the wording *is* the feature and a string spelled
 * in a DOM file is a string nothing tests.
 *
 * ## Why the notes are events and not a tutorial
 *
 * Four modal screens before typing is how you lose an adult who already knows
 * he types badly. So the game explains one thing -- where the hands go -- and
 * then explains nothing until the player has actually met the thing being
 * explained: the first dim letter, the first wrong key, the first space. A
 * sentence at that moment costs him no reading, because he has just watched the
 * behaviour it names.
 *
 * ## Why the coach cannot touch the typing state
 *
 * `stepCoach` takes an `Occasion` -- three booleans read off the rail -- and
 * returns a `CoachState`. It is handed no cursor and no key statistics and it
 * returns none, so there is no shape of this function that could advance the
 * player, charge him for a key, or make a first run score differently from a
 * second one. That property is asserted in `core/onboarding.test.ts` rather
 * than merely arranged for.
 *
 * ## Seen means gone
 *
 * A note is added to `seen` at the moment it is *shown*, not when it is
 * dismissed, and the platform writes that to the progress record immediately.
 * A tip that comes back after you have understood it is an insult, and a
 * closed tab is not a reason to be told twice.
 */

import { tuningValue } from './tuning.js';
import type { Glyph, Tuning } from './types.js';

// --- the words --------------------------------------------------------------

/**
 * The opening screen: one idea, one button.
 *
 * The bumps are the single most useful thing nobody tells a self-taught typist.
 * They are true of every keyboard he will ever touch, and finding them takes
 * five seconds and no reading. That is the whole reason this is the one thing
 * said before he types, and the reason there is no second screen: no progress
 * dots, no "step 1 of 4", nothing to get through.
 */
export const OPENING = {
  title: 'Find home row by feel',
  lead: 'Your keyboard has two small bumps, on F and J.',
  bumps: 'F      J',
  body:
    'Find them without looking. That is how your hands know where they are — ' +
    'every other key is counted from those two.',
  rest: 'Rest your left fingers on A S D F and your right on J K L ;',
  homeRow: 'A S D F      J K L ;',
  button: "I've found them",
} as const;

/** The three things worth saying, and nothing else is ever said. */
export type NoteId = 'greyed' | 'wrong' | 'space';

/**
 * Firing order when more than one occasion is true on the same keystroke.
 *
 * It is the order of the table in docs/design/10-first-run.md, and it also
 * happens to be the order of usefulness: a dim letter skipping itself is the
 * thing a beginner cannot explain to himself at all, a held cursor is at least
 * visible, and the space bar he will find on his own eventually.
 *
 * Only one note is ever on screen. The others are not queued behind it -- they
 * fire the next time their own occasion comes round, which for all three is
 * within a line or two. Queueing them would be the tutorial wall arriving late.
 */
export const NOTE_ORDER: readonly NoteId[] = ['greyed', 'wrong', 'space'];

/**
 * One sentence each. Plain, adult, and specific.
 *
 * No exclamation mark, no praise for typing a letter, and no mention of speed:
 * he is slow, he knows he is slow, and the argument this whole game is making
 * is that slow is fine for now. None of them names a stage, the mastery gate,
 * gilding, a combo, a score, the map, hearts, the smudge meter or the
 * blot-cloud, because none of that matters in the first two minutes and the
 * cloud in particular explains itself when it arrives -- warning him about it
 * beforehand would read as a threat to someone already braced for one.
 */
export const NOTES: Readonly<Record<NoteId, string>> = {
  greyed: "These dim letters aren't yours yet. The game types them for you — just keep going.",
  wrong: "A wrong key doesn't move you along. Try again; nothing is lost.",
  space: 'The bar means a space. Either thumb.',
};

// --- what just happened -----------------------------------------------------

/**
 * The three occasions, read off the rail after a keystroke has been applied.
 *
 * They are facts about the passage and the cursor, not about the player's
 * history: whether a note *fires* on them is `stepCoach`'s business and depends
 * only on what has already been seen.
 */
export interface Occasion {
  /** The cursor was carried across at least one dim character. */
  readonly greyed: boolean;
  /** The keystroke was wrong, so the cursor is being held. */
  readonly wrong: boolean;
  /** The cursor is resting on a space that is still owed. */
  readonly space: boolean;
}

/**
 * Did this keystroke carry the cursor over a dim character?
 *
 * Scans strictly *between* the two positions: the glyph at `from` is the one
 * the player typed, and the run behind it is what the game typed for him. In
 * gilding mode nothing auto-advances, so this is false throughout -- which is
 * correct rather than lucky, because "the game types them for you" is not true
 * in a mode where it does not.
 */
export function crossedGreyed(glyphs: readonly Glyph[], from: number, to: number): boolean {
  for (let i = from + 1; i < to; i += 1) {
    const glyph = glyphs[i];
    if (glyph !== undefined && !glyph.live) return true;
  }
  return false;
}

/**
 * Is the cursor sitting on a space the player still owes?
 *
 * A space prints nothing, so this is the one keystroke in the game where the
 * player can be looking straight at what is being asked for and see a gap. The
 * rail draws a bar for it (docs/design/02-rail.md#the-space-affordance); the
 * note says what the bar means, once.
 */
export function onOwedSpace(glyphs: readonly Glyph[], cursor: number): boolean {
  const glyph = glyphs[cursor];
  return glyph !== undefined && glyph.live && glyph.ch === ' ';
}

// --- the coach --------------------------------------------------------------

export interface CoachState {
  /** The note under the rail, or null when there is nothing to say. */
  readonly showing: NoteId | null;
  /** Correct keystrokes since it appeared; it leaves on its own after enough. */
  readonly held: number;
  /** Every note already spent. Written to the record the moment it grows. */
  readonly seen: readonly NoteId[];
}

/**
 * Start the coach from what the record remembers.
 *
 * Unknown ids in the stored list are dropped and the order is canonical, so a
 * hand-edited record cannot resurrect a note or invent one.
 */
export function createCoach(seen: readonly string[]): CoachState {
  return { showing: null, held: 0, seen: NOTE_ORDER.filter((id) => seen.includes(id)) };
}

/** The sentence to draw under the rail, or null. */
export function noteText(state: CoachState): string | null {
  return state.showing === null ? null : NOTES[state.showing];
}

function occurs(occasion: Occasion, id: NoteId): boolean {
  if (id === 'greyed') return occasion.greyed;
  if (id === 'wrong') return occasion.wrong;
  return occasion.space;
}

/**
 * One keystroke's worth of coaching.
 *
 * Two rules, and they are the whole module:
 *
 * **A note is dismissed by continuing to type.** Not by a button, and not by a
 * clock -- `first_run_note_keys` correct keystrokes and it goes. A button would
 * make the note a thing to deal with; a clock would take it away from someone
 * who stopped to read it, which is exactly the person it was written for.
 *
 * **Nothing fires while something is showing.** Two sentences under the rail at
 * once is the lecture this design exists to avoid, and a note that appears
 * while the player is still reading the last one is worse than one that waits
 * for its occasion to come round again.
 */
export function stepCoach(
  state: CoachState,
  occasion: Occasion,
  advanced: boolean,
  tuning: Tuning,
): CoachState {
  if (state.showing !== null) {
    if (!advanced) return state;
    const held = state.held + 1;
    const hold = Math.max(1, Math.trunc(tuningValue(tuning, 'first_run_note_keys')));
    return held >= hold ? { ...state, showing: null, held: 0 } : { ...state, held };
  }
  for (const id of NOTE_ORDER) {
    if (state.seen.includes(id)) continue;
    if (!occurs(occasion, id)) continue;
    // Spent the instant it is shown, never when it is dismissed: a reload
    // between the two must not hand the player the same sentence twice.
    return { showing: id, held: 0, seen: [...state.seen, id] };
  }
  return state;
}
