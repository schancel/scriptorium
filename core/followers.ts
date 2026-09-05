/**
 * The company gathered on the way.
 *
 * @doc docs/design/11-followers.md#what-they-are
 *
 * Finish a passage the route names and its figure joins a line walking behind
 * the scribe; find a flashback room and its figure joins too. They walk when he
 * walks, idle when he idles, and do nothing else whatsoever.
 *
 * ## They have no abilities, and this file is how that is guaranteed
 *
 * docs/design/11-followers.md#they-have-no-abilities-deliberately says why: every
 * mechanic here that touches difficulty is balanced against a beginner's error
 * rate, and an ability would also point the reward backwards -- easier the
 * further you get, so the player who needs help least receives it. Saying so is
 * not enough, so the arrangement says it instead:
 *
 *  - **This module cannot reach a mechanic.** Its imports are the route graph,
 *    the sprite sheet, the tuning lookup and one animation helper. `damage`,
 *    `items`, `progress` and `typing` are not among them, and
 *    `core/followers.test.ts` reads this file's own import list back and fails
 *    if they ever are.
 *  - **Everything here is a projection.** `party` reads a `MapState` and returns
 *    names and sprite ids; `followerPoses` reads geometry and returns positions.
 *    Neither returns a number anything else in the game consumes, and there is
 *    no function in this file that takes a `DamageState`, a `Score` or a heart.
 *  - **A pose has five fields** -- a body, a mark (or nothing), an x, a y and a
 *    frame -- and deliberately no sixth in which a bonus or a shield could be
 *    written. Same argument as `Strike` in `core/entities.ts`.
 *
 * ## Derived, never stored
 *
 * The party is `completed` and `discovered` from the progress record, plus
 * *where the player is standing right now*, and nothing else -- so there is no
 * new field, no schema bump and no migration. A derived party cannot drift out
 * of step with the map; a stored one eventually would. The price is that the
 * line walks in the *route's* order rather than the order the passages were
 * actually finished, because two independently appended lists cannot be
 * interleaved back into one sequence -- see
 * docs/design/11-followers.md#derived-never-stored.
 *
 * The standing is what makes a **verse-precise** join possible without storing
 * anything. A row may name the verse its figure arrives on -- Adam at Genesis
 * 2:7, where he is formed -- and that row joins when the passage is finished or
 * when the player is standing in it at or past that verse. Both halves are read
 * off things the game already knows, which is why the record is untouched.
 * docs/design/11-followers.md#they-join-at-a-verse-not-at-the-end-of-a-chapter
 */

import { frameAt } from './entities.js';
import { nodeCovers, refKey, routeNodes, type MapState, type Route } from './route.js';
import {
  FOLLOWER_BODIES, FOLLOWER_CLOTHS, FOLLOWER_IDLE_FIRST, FOLLOWER_IDLE_FRAMES,
  FOLLOWER_MARKS, FOLLOWER_WALK_FRAMES, SPRITE_SIZE, followerBodyId, followerMarkId,
} from './sprites.js';
import { tuningValue } from './tuning.js';
import type { Tuning } from './types.js';

/**
 * How long a follower holds one frame of the settled idle.
 *
 * `tuning-exempt` on the same grounds as the cadences in `core/entities.ts`:
 * how slowly a standing figure breathes is a drawing decision with no effect on
 * what the player has to do. It is the scribe's own idle cadence, because they
 * are standing with him.
 */
const IDLE_MS = 520; // tuning-exempt: animation cadence, art not difficulty

// --- the roster -------------------------------------------------------------

/**
 * One row of the table in docs/design/11-followers.md#who-joins-after-what.
 *
 * `body`, `cloth` and `mark` name art in `core/sprites.ts` and none of the three
 * is unique to a row -- three silhouettes, three cloths and one mark apiece is
 * the whole of the art budget. See that file's follower section.
 */
export interface FollowerRow {
  /** Citation, spelled as the route table spells it. */
  readonly ref: string;
  /**
   * The verse the figure arrives on, or null for the end of the passage.
   *
   * Null is the ordinary case and the right default: Abraham is not *made*
   * anywhere in Genesis 22, and Moriah is about the whole chapter rather than
   * one line of it. A number is for a passage that names a moment -- Genesis 2
   * forms the man in 2:7 and makes the woman a wife in 2:24 -- where waiting
   * for the chapter to end would arrive four hundred keystrokes after the thing
   * the figure is about.
   */
  readonly verse: number | null;
  /** The person, for the map. Never drawn in the world. */
  readonly who: string;
  readonly body: string;
  readonly cloth: string;
  /**
   * The one thing the figure carries, or null for a figure carrying nothing.
   *
   * Null is authored, not missing. Mary Magdalene is empty-handed in every verse
   * of John 20 -- the jar of spices is Luke's and Mark's, and in John the spices
   * are Nicodemus's the evening before -- so drawing her with one would be the
   * art asserting what the passage does not. See
   * docs/design/11-followers.md#a-figure-may-carry-nothing.
   */
  readonly mark: string | null;
}

export interface Roster {
  readonly rows: readonly FollowerRow[];
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`followers: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`followers: ${what} is not a string`);
  return value;
}

function asOneOf(value: unknown, allowed: readonly string[], what: string): string {
  const found = asString(value, what);
  if (!allowed.includes(found)) {
    throw new Error(`followers: ${what} is "${found}", which is not art this game holds`);
  }
  return found;
}

/**
 * The same, but a blank cell is a figure carrying nothing rather than an error.
 *
 * Only `mark` may be blank, and only *blank*: a string that names no art is
 * still a mistyped row and still throws, because a silhouette that quietly lost
 * its staff reads to the player as the game forgetting who he met.
 */
function asOneOfOrNothing(value: unknown, allowed: readonly string[], what: string): string | null {
  if (value === null || value === undefined) return null;
  return asOneOf(value, allowed, what);
}

/**
 * The join verse: a whole verse number, or null for the end of the passage.
 *
 * Strict about the number for the reason the art ids are strict: a verse that
 * silently became zero would put Adam on the first keystroke of Genesis 2,
 * which reads to the player as the game having got the story wrong rather than
 * as a bad cell in a table.
 */
function asVerseOrNothing(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`followers: ${what} is not a verse number`);
  }
  return value;
}

/**
 * Parse the roster file.
 *
 * Strict about the art ids for the same reason `core/route.ts` is strict about a
 * citation: a mistyped mark would surface as a figure walking along carrying
 * nothing, which reads to the player as the game having forgotten who he met
 * rather than as a bad row in a table.
 *
 * @throws if the object is not shaped like a roster file
 */
export function loadFollowers(parsed: unknown): Roster {
  const doc = asRecord(parsed, 'parsed file');
  const raw = doc['followers'];
  if (!Array.isArray(raw)) throw new Error('followers: parsed file has no "followers" array');
  /*
   * At most one figure per *arrival*, which is what the uniqueness key spells.
   * Genesis 2 forms two people and names the verse of each, so it holds two
   * rows; what may not happen is two figures arriving at the same instant,
   * because there is one strip under the rail and one sentence fits in it. A
   * blank verse claims the whole passage, so it collides with every row in it.
   * docs/design/11-followers.md#who-joins-after-what
   */
  const seen = new Set<string>();
  const whole = new Set<string>();
  const parts = new Set<string>();
  const rows: FollowerRow[] = raw.map((entry, index) => {
    const row = asRecord(entry, `followers[${String(index)}]`);
    const ref = asString(row['passage'], `followers[${String(index)}].passage`);
    const verse = asVerseOrNothing(row['verse'], `"${ref}".verse`);
    const cite = verse === null ? ref : `${ref}:${String(verse)}`;
    if (seen.has(cite)) throw new Error(`followers: two figures claim "${cite}"`);
    if (verse === null ? parts.has(ref) : whole.has(ref)) {
      throw new Error(`followers: two figures claim "${ref}", one of them at a verse`);
    }
    seen.add(cite);
    (verse === null ? whole : parts).add(ref);
    return {
      ref,
      verse,
      who: asString(row['who'], `"${ref}".who`),
      body: asOneOf(row['body'], FOLLOWER_BODIES, `"${ref}".body`),
      cloth: asOneOf(row['cloth'], FOLLOWER_CLOTHS, `"${ref}".cloth`),
      mark: asOneOfOrNothing(row['mark'], FOLLOWER_MARKS, `"${ref}".mark`),
    };
  });
  if (rows.length === 0) throw new Error('followers: no figures');
  return { rows };
}

// --- the party --------------------------------------------------------------

/** One figure, ready to be named on the map or drawn in the world. */
export interface Follower {
  readonly ref: string;
  /** The verse joined at, or null for a figure who joins when the passage ends. */
  readonly verse: number | null;
  readonly who: string;
  readonly bodyId: string;
  /** Null for a figure carrying nothing; see `FollowerRow.mark`. */
  readonly markId: string | null;
}

function figureFor(row: FollowerRow): Follower {
  return {
    ref: row.ref,
    verse: row.verse,
    who: row.who,
    bodyId: followerBodyId(row.body, row.cloth),
    markId: row.mark === null ? null : followerMarkId(row.mark),
  };
}

/**
 * Where this figure joined, as the route screen names it: `Genesis 2:7`.
 *
 * It is also the figure's identity, and it has to be, because a passage may
 * hand over more than one person and the passage alone stopped being unique the
 * day Adam and Eve both came out of Genesis 2. Spelled here rather than in the
 * platform so that the screen and the "have I greeted this one" set cannot
 * disagree about what counts as the same figure.
 */
export function followerCitation(follower: Follower): string {
  return follower.verse === null ? follower.ref : `${follower.ref}:${String(follower.verse)}`;
}

/**
 * Who is walking with the scribe, in the route's order, and inside a passage in
 * the order its verses form them.
 *
 * A stop joins when it is finished and a secret joins when it is found, which is
 * the union of the record's two lists -- a room the player stepped into, turned
 * round and walked out of has still been found, and `core/route.ts` has held
 * that line since `discovered` existed.
 *
 * `verseReached` is the verse the cursor is standing in, in the passage
 * `state.current` names, and it is the whole of what makes a join verse-precise
 * without anything being stored. A row that names a verse joins as soon as the
 * player is standing at or past it -- Adam at Genesis 2:7, with the report card
 * nowhere in sight -- and stays joined for good once the passage is finished.
 * Zero is "nowhere in particular", which is what a fresh map and every screen
 * that is not the rail pass in.
 *
 * The honest consequence is written down rather than worked around: leaving a
 * passage before finishing it takes its verse-joined figures back out of the
 * line, exactly as it leaves the passage unfinished on the route screen. The
 * party says what the map says.
 * docs/design/11-followers.md#derived-never-stored
 *
 * A passage the roster has no row for contributes nobody rather than throwing:
 * `make check` is where a missing row is caught, and a player mid-passage is not
 * the person who should hear about it.
 */
export function party(
  roster: Roster,
  route: Route,
  state: MapState,
  verseReached = 0,
): readonly Follower[] {
  /*
   * Walked over the *roster* rather than over the route's nodes, which is a
   * change the span made necessary and an improvement anyway. Canonical names
   * `Genesis 1-50` and the roster names `Genesis 2`, so a lookup keyed on the
   * node's own spelling would hand back nobody on three of the four routes --
   * and Adam is formed in Genesis 2 whichever reading of the book took the
   * player there. Twenty rows is also a fixed cost, where the nodes are 66 on
   * one route and this runs every frame.
   */
  const joined = new Set<string>([...state.completed, ...state.discovered]);
  const isJoined = (ref: string): boolean => joined.has(ref) || joined.has(refKey(ref));
  // The graph is walked once, not once per row: this runs every frame, and
  // `routeNodes` sorts the whole route each time it is asked.
  const nodes = [...routeNodes(route).values()];
  const standing = state.current === '' ? null : refKey(state.current);
  const found: { row: FollowerRow; at: number }[] = [];
  for (const row of roster.rows) {
    const at = nodes.findIndex((node) => nodeCovers(node, row.ref));
    if (at < 0) continue;
    const here = row.verse !== null
      && standing === refKey(row.ref)
      && verseReached >= row.verse;
    if (!isJoined(row.ref) && !here) continue;
    found.push({ row, at });
  }
  // The route's order, then the chapter, then the verse -- so Adam is formed
  // before Eve is built whichever order the table happened to be written in,
  // and a span holding forty chapters still hands them over in reading order.
  found.sort((a, b) =>
    a.at - b.at
    || parseVerseOrder(a.row) - parseVerseOrder(b.row));
  return found.map((entry) => figureFor(entry.row));
}

/**
 * Sort key inside one node: the chapter, then the verse.
 *
 * Two rows under one span node have to be told apart by more than their verse
 * -- `Genesis 1-50` holds both Adam and Eve and would hold anybody else Genesis
 * handed over. The chapter dominates because a chapter is always ordered before
 * a verse in it.
 */
function parseVerseOrder(row: FollowerRow): number {
  const chapter = Number(refKey(row.ref).split(' ').pop() ?? 0);
  return chapter * VERSES_PER_CHAPTER_CEILING + (row.verse ?? 0);
}

/**
 * Larger than any chapter's verse count, so a chapter never bleeds into the
 * next one's ordering. Psalm 119 has 176 verses and is the longest in either
 * shipped translation.
 */
const VERSES_PER_CHAPTER_CEILING = 1000; // tuning-exempt: a sort radix, not a tunable

// --- arriving ---------------------------------------------------------------

/**
 * The one line a follower arrives with, and the only place it is written.
 *
 * A figure used to appear behind the scribe unremarked, on a screen the player
 * was not looking at -- he was looking at the rail, which is where every other
 * decision in this game has spent itself keeping him. So an arrival says one
 * sentence in the strip under the rail, once, and is gone as he types on. See
 * docs/design/11-followers.md#arriving-with-a-line.
 *
 * Deadpan and formed from the roster, so nineteen of the twenty need no
 * authoring at all: the row's `who` with its first letter raised, and "walks
 * with you". `the shepherd` becomes "The shepherd walks with you."
 *
 * The wording lives here rather than in `platform/web/`, for the reason
 * `core/onboarding.ts` gives about the first run's three notes: a string spelled
 * in a DOM file is a string nothing tests.
 */
const ARRIVAL_JOKES: Readonly<Record<string, string>> = {
  /*
   * The owner asked for this twice and finds it funny, and it is his game.
   *
   * It is also the right joke, and the reason it is the *only* one: it lands
   * because the other nineteen lines are flat, and one gag among twenty
   * deadpan arrivals is funnier than a gag every time. Adding a second entry to
   * this table would spend the first one.
   *
   * It is why the exclamation ban narrowed. An arrival is the world doing
   * something rather than a verdict on the player, so it is copy about the world
   * and may use ordinary punctuation -- and nothing on the report card moved.
   * docs/design/10-first-run.md#the-exclamation-ban-is-about-praise-and-only-covers-copy-that-judges-him
   */
  Eve: 'Wife acquired!',
};

/** What the strip says when this figure joins. */
export function arrivalLine(who: string): string {
  const joke = ARRIVAL_JOKES[who];
  if (joke !== undefined) return joke;
  return `${who.slice(0, 1).toUpperCase()}${who.slice(1)} walks with you.`;
}

/** Every line an arrival can produce, for the tests that read the copy back. */
export function arrivalLines(roster: Roster): readonly string[] {
  return roster.rows.map((row) => arrivalLine(row.who));
}

/**
 * The line as it is actually drawn: the figures on screen, nearest first, and
 * how many are not.
 *
 * Past `follower_line_max` the earliest on the route walk on ahead and out of
 * shot. That is not a detail: "a screen filling with figures is scenery
 * competing with text", and the rail is what the game is for.
 */
export interface FollowerLine {
  /** Nearest the scribe first. Never longer than `follower_line_max`. */
  readonly walking: readonly Follower[];
  /** Figures the line is not showing. Zero on every line under the cap. */
  readonly unseen: number;
}

export const EMPTY_LINE: FollowerLine = { walking: [], unseen: 0 };

export function followerLine(company: readonly Follower[], tuning: Tuning): FollowerLine {
  const cap = Math.max(0, Math.trunc(tuningValue(tuning, 'follower_line_max')));
  const kept = company.slice(Math.max(0, company.length - cap));
  return { walking: [...kept].reverse(), unseen: company.length - kept.length };
}

// --- where they walk --------------------------------------------------------

/**
 * The composition the line is laid out in.
 *
 * Every field is geometry or animation. There is nothing here a follower could
 * read about the player's hearts, his accuracy or his stage, because there is
 * nothing here that knows about them.
 */
export interface FollowerGeometry {
  /** The scribe's screen x. Followers are placed to the left of it, always. */
  readonly scribeX: number;
  /** The ground's surface. Feet are put here and never anywhere else. */
  readonly groundY: number;
  /** True while the world is still moving, exactly as the scribe reads it. */
  readonly walking: boolean;
  readonly animMs: number;
}

/**
 * What to draw for one follower. Two sprite ids, a position and a frame.
 *
 * Five fields, and no sixth. A `FollowerPose` is the entire surface this module
 * offers the rest of the game, so an ability would have nowhere to be written
 * even if somebody wanted one.
 */
export interface FollowerPose {
  readonly bodyId: string;
  /** Null for a figure carrying nothing: one fewer draw command, no placeholder. */
  readonly markId: string | null;
  readonly x: number;
  readonly y: number;
  readonly frame: number;
}

/**
 * Place the line behind the scribe.
 *
 * Two properties hold for every pose this returns, at every animation time and
 * on every theme, and `core/followers.test.ts` asserts both:
 *
 *  - **`x` is always less than `scribeX`.** They walk behind him. The first
 *    figure is a whole `follower_spacing_px` back, and the spacing is wider than
 *    a sprite, so nobody can be drawn over him or in front of him.
 *  - **`y` is always `groundY - SPRITE_SIZE`.** Their feet are on the ground
 *    line and they never leave it. The settle is drawn *inside* the art -- the
 *    idle frames put the same feet on the same row -- rather than by moving the
 *    sprite, precisely so that this can be a constant rather than a range.
 */
export function followerPoses(
  line: FollowerLine,
  geometry: FollowerGeometry,
  tuning: Tuning,
): readonly FollowerPose[] {
  const spacing = tuningValue(tuning, 'follower_spacing_px');
  const walkMs = tuningValue(tuning, 'follower_walk_ms');
  const y = geometry.groundY - SPRITE_SIZE;
  return line.walking.map((follower, index) => {
    // One frame of stagger per figure, so the line does not march in lockstep.
    const phase = geometry.animMs + index * walkMs;
    return {
      bodyId: follower.bodyId,
      markId: follower.markId,
      x: geometry.scribeX - (index + 1) * spacing,
      y,
      frame: geometry.walking
        ? frameAt(phase, walkMs, FOLLOWER_WALK_FRAMES)
        : FOLLOWER_IDLE_FIRST + frameAt(phase, IDLE_MS, FOLLOWER_IDLE_FRAMES),
    };
  });
}

/**
 * Where the count of the figures that walked on ahead stands: the next place in
 * the line, so it reads as their absence rather than as a label on anybody.
 */
export function followerCountX(line: FollowerLine, geometry: FollowerGeometry, tuning: Tuning): number {
  const spacing = tuningValue(tuning, 'follower_spacing_px');
  return geometry.scribeX - (line.walking.length + 1) * spacing;
}
