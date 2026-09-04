/**
 * Boot, wiring, and the animation-frame loop.
 *
 * The only file that knows both halves of the program. It fetches the data the
 * core is forbidden to reach for, turns a chunk of a chapter into classified
 * glyphs, feeds keystrokes in and display lists out, and holds nothing that
 * decides anything -- every rule lives in core/.
 *
 * Three things it is responsible for that are easy to miss:
 *
 * **The bookmark.** Where the player is -- translation, book, chapter, verse --
 * is written to the record as they cross each verse, and the game reopens
 * there. Before that, every reload dropped the player back at Genesis 1:1.
 *
 * **The gate.** `evaluateGate` decides promotions and nothing was calling it,
 * so the player was pinned at stage 1 for ever. It is asked at every candle,
 * and a promotion is *announced*, because it is the only reward the tutor has.
 *
 * **Candles.** A chapter is cut into `candle_interval` chunks, so a sitting is
 * a few verses rather than 20+ minutes and quitting costs a verse.
 *
 * ## The world is driven by words, never by a clock
 *
 * The camera advances `WORLD_STRIDE` virtual pixels per word the player
 * completes, and everything that appears to move -- parallax, monsters sliding
 * past, the candle coming up -- is a function of that one number. Nothing here
 * advances the world on a timer, and nothing may be added that does. The only
 * pressure in the game is the blot-cloud, which watches silence rather than
 * speed. See docs/decisions/0004-idle-threat-not-speed-timer.md.
 */

import { createRenderer, type Renderer } from './canvas_renderer.js';
import { attachKeyboard } from './keyboard_input.js';
import {
  createOverlay,
  type HandsView,
  type MenuView,
  type Overlay,
  type RouteView,
} from './overlay.js';
import { loadTuning, tuningValue } from '../../core/tuning.js';
import { keySetFor, loadStages, stageAt } from '../../core/curriculum.js';
import { classify } from '../../core/illumination.js';
import { applyKey, atEnd, createTypingState, gildScore, score, tick } from '../../core/typing.js';
import { CELL_W, createRail, layoutRail, stepRail } from '../../core/rail.js';
import {
  VIRTUAL_W, drawFrame, reportAdvice, reportCard, reportNote, reportTrend, sceneLayout,
  type FrameState, type ReportMemory, type SceneCandle, type SceneState, type WarpView,
} from '../../core/draw.js';
import {
  loadScenes, sceneAtVerse, sceneFor as sceneAt,
  type Scene, type SceneAt, type SceneMap,
} from '../../core/scenes.js';
import { setpieceState, type SetpieceState } from '../../core/setpieces.js';
import {
  arrivalLine, followerLine, loadFollowers, party as gatheredParty,
  type Follower, type FollowerLine, type Roster,
} from '../../core/followers.js';
import {
  arriveAt, completePassage, createMap, discoverSecret, flashbacksFrom,
  loadRoute, mapThreads, mapView, nodeRefs, requiredRefs, routeComplete, standingOffRoute,
  type MapState, type Route, type RouteEdge,
} from '../../core/route.js';
import {
  beginWarp, echoFor, enterFlashback, heldSpan, insideFlashback, leaveFlashback, locateEcho,
  planWarp, skipFlashback, stepWarp, warpComplete,
  type FlashbackFrame, type WarpPlan, type WarpState,
} from '../../core/warp.js';
import {
  createLectio, lectioCursor, lectioFinished, lectioOffset, pauseLectio, stepLectio,
  type LectioState,
} from '../../core/lectio.js';
import { SPRITE_SIZE } from '../../core/sprites.js';
import {
  beginStrike, createCloud, createEntity, monstersAt, stepCloud, stepEntities, stepMonsters,
  stepStrikes, strikeReachPx, strikeWord, type Entity, type Strike,
} from '../../core/entities.js';
import {
  applyItem, createPlayer, dropsInkPot, type PickupSite, type PlayerState,
} from '../../core/items.js';
import {
  createCoach, crossedGreyed, noteText, onOwedSpace, stepCoach, type CoachState,
} from '../../core/onboarding.js';
import {
  applyCloudStrike, applyCorrect, applyError, createDamage, isDead, maxHearts,
} from '../../core/damage.js';
import { draws, seedFrom } from '../../core/rng.js';
import {
  createAudio, setAudioOn, stepSound, type AudioState, type Cue, type Songbook,
} from '../../core/sound.js';
import { createLibrary, loadThemeTunes, loadTune, type Tune } from '../../core/tunes.js';
import { createWebAudio, type WebAudio } from './web_audio.js';
import {
  type Book,
  type Chunk,
  bookFileName,
  canonicalBook,
  chunkIndexFor,
  chunkRef,
  chunksFor,
  formatReference,
  loadBook,
  parseReference,
  sectionFor,
} from '../../core/corpus.js';
import {
  DEFAULT_PROGRESS,
  type Position,
  type Progress,
  evaluatePromotion,
  gateProgress,
  promote,
  recordSession,
  replayFirstRun,
  setCloudEnabled,
  setGilding,
  setStage,
  shouldOfferGilding,
  withGildOffered,
  withDiscovered,
  withNotesSeen,
  withOpeningSeen,
  withPosition,
} from '../../core/progress.js';
import {
  clearProgress,
  exportProgress,
  importProgress,
  loadProgress,
  saveProgress,
  today,
} from './local_storage.js';
import type {
  BlotCloud, DamageState, Glyph, Key, KeyboardLayout, Mode, RailState, Score, Stage, Thumb,
  Tuning, TypingState,
} from '../../core/types.js';

// --- fallbacks --------------------------------------------------------------

/**
 * Genesis 1:1-5, World English Bible, public domain.
 *
 * Hardcoded so the game is playable with nothing else present: `data/texts/` is
 * fetched, and `fetch` is blocked outright on `file://`. A tutor that cannot open
 * without a web server is a tutor the player cannot open.
 */
const FALLBACK_BOOK: Book = {
  title: 'Genesis',
  edition: 'WEB',
  sections: [
    {
      name: '1',
      units: [
        'In the beginning, God created the heavens and the earth.',
        "The earth was formless and empty. Darkness was on the surface of the deep and God's Spirit was hovering over the surface of the waters.",
        'God said, "Let there be light," and there was light.',
        'God saw the light, and saw that it was good. God divided the light from the darkness.',
        'God called the light "day", and the darkness he called "night". There was evening and there was morning, the first day.',
      ],
    },
  ],
};

/**
 * Home row plus the anchors, i.e. stage 1. Used only when `data/curriculum.json`
 * cannot be fetched; the real set is always preferred, because the illumination
 * invariant is checked against the generated file and not against this line.
 */
const FALLBACK_KEY_SET: readonly Key[] = ['f', 'j', '<space>', 'a', 's', 'd', 'g', 'h', 'k', 'l', ';'];

const FALLBACK_TUNING = {
  values: {
    grey_snap_ms: 0, min_stage1_coverage: 0.3, gate_accuracy: 0.95, gate_window: 200,
    mastery_min_samples: 20,
    gate_latency_base_ms: 600, gate_latency_step_ms: 25, gate_latency_floor_ms: 250,
    idle_base_ms: 8000, idle_step_ms: 400, idle_floor_ms: 3000, cloud_approach_ms: 2500,
    cloud_smudge: 25, smudge_max: 100, smudge_per_error_base: 12, smudge_per_error_step: 2,
    smudge_decay_per_key: 2, hearts_start: 3, hearts_max: 5, combo_tempo_max: 1.25,
    rail_cursor_x: 0.5, rail_scroll_lerp: 0.25, focal_guide_width: 40, warp_phase_ms: 1400,
    warp_echo_hold_ms: 900, lectio_start_wpm: 180, lectio_ramp_wpm: 20, lectio_max_wpm: 700,
    candle_interval: 3, bonus_word_chance: 0.15, master_volume: 0.35, audio_default_on: 1,
    monster_burst_ms: 320, strike_reach: 36, stomp_ms: 460, ink_ms: 420,
    strike_hop_px: 12, strike_contact_px: 7, strike_bounce_ratio: 0.6,
    strike_nib_arc_px: 14, strike_rise_travel: 0.7,
    monster_drop_chance: 0.2, combo_drop_bonus: 0.2,
    gild_score_per_char: 2, gild_page_bonus: 50, gild_offer_wpm: 60, gild_offer_sessions: 3,
    wpm_chars_per_word: 5, history_max_sessions: 500, first_run_note_keys: 8,
  },
};

// --- saying so when a fallback is in use -------------------------------------

/**
 * Which data this session is faking, in the order it was discovered.
 *
 * Every loader above and below falls back rather than refusing to start, and
 * that is right: a beginner opening a half-deployed page should still be able to
 * type. What is *not* right is being quiet about it. A 404 on `data/texts/`
 * yields five hardcoded verses of Genesis; a 404 on `data/themes.json` yields an
 * empty songbook. Both look exactly like working software, and that is how a
 * deploy bug survived hours of play -- the owner typed a stub, enjoyed it, and
 * reported only that the sound seemed to be missing.
 *
 * So every fallback is recorded here and the recording is drawn on the screen
 * for as long as it holds. Degraded play still beats a blank page; silent
 * degraded play does not beat anything.
 */
const fallbacks: string[] = [];

function usingFallback(what: string): void {
  if (fallbacks.includes(what)) return;
  fallbacks.push(what);
  // The banner is the promise; this is for whoever is looking at a console
  // because a deploy went wrong, and wants the detail rather than the headline.
  console.warn(`scriptorium: falling back for ${what} -- this is not the real data`);
}

/**
 * The banner `core/draw.ts` paints over everything else, or nothing at all.
 *
 * Two lines: what is missing, and that what is on screen is a substitute for it.
 * Both short enough to fit the virtual width even when every loader has failed at
 * once.
 *
 * Neither line prescribes a fix. It used to name `make build` and `make fetch`,
 * which is useless to the reader it almost always has -- someone holding a URL
 * and no checkout -- and reads as an accusation about his installation when the
 * commoner cause is ours. The console warning beside it carries the detail, and
 * `README.md` carries the commands. See
 * docs/decisions/0009-fallbacks-must-announce-themselves.md.
 */
function noticeLines(): readonly string[] {
  if (fallbacks.length === 0) return [];
  return [
    `NOT THE REAL DATA \u2014 using built-in fallbacks for: ${fallbacks.join(', ')}`,
    'these are built-in substitutes; what is on screen is not the real thing',
  ];
}

/**
 * The names the banner uses. Bare nouns, so that the worst case -- every loader
 * failing at once, which is what a wrong base path looks like -- still fits
 * across the virtual width instead of running off both ends of it.
 */
const DATA_NAMES = {
  tuning: 'tuning',
  curriculum: 'curriculum',
  scenery: 'scenery',
  route: 'the route',
  themes: 'themes',
  tunes: 'tunes',
  text: 'the text',
  followers: 'the company',
} as const;

/**
 * What the map says when the route file is unreachable.
 *
 * A blank graph and a broken one look identical, and only one of them is the
 * player's own progress -- so the panel says which, in the same spirit as
 * docs/decisions/0009-fallbacks-must-announce-themselves.md.
 */
const ROUTE_MISSING = 'The route did not load, so this map is empty rather than new.';

/**
 * The player's name for a translation.
 *
 * `WEB` and `KJV` are what the files are called. The menu's own control spells
 * both out -- it has to, because the choice is a difficulty step and a pair of
 * bare proper nouns presents it as a preference about wording -- and every
 * other surface that names one agrees with that control rather than printing
 * the abbreviation the loader happens to use.
 */
const EDITION_NAMES: Readonly<Record<string, string>> = {
  WEB: 'World English Bible',
  KJV: 'King James Version',
};

function editionName(edition: string): string {
  return EDITION_NAMES[edition] ?? edition;
}

// --- loading ----------------------------------------------------------------

/** Resolve a repo-relative path from this module's own URL, not the page's. */
function repoUrl(path: string): string {
  return new URL(`../../../${path}`, import.meta.url).href;
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(repoUrl(path));
  if (!response.ok) throw new Error(`${path}: ${String(response.status)}`);
  return (await response.json()) as unknown;
}

/**
 * Fetch, or fall back *and say so*. `what` is the name the banner uses.
 *
 * Every call site names itself rather than sharing one generic "data" label,
 * because "themes did not load" and "the corpus did not load" send whoever reads
 * the banner to two completely different places.
 */
async function fetchJsonOr(path: string, fallback: unknown, what: string): Promise<unknown> {
  try {
    return await fetchJson(path);
  } catch {
    usingFallback(what);
    return fallback;
  }
}

/**
 * Where a book might live, in order of preference.
 *
 * `core/corpus.ts` resolves the citation to the filename, which is the whole
 * point of having a resolver: `Psalm 22` and `Psalms 22` are the same file, and
 * neither the route table nor the player has to know which spelling won.
 */
function textPaths(translation: string, book: string): string[] {
  const file = bookFileName(book);
  return [
    `data/texts/${translation.toLowerCase()}/${file}`,
    `data/texts/${translation}/${file}`,
    `data/texts/${file}`,
  ];
}

async function fetchBook(translation: string, book: string): Promise<Book> {
  for (const path of textPaths(translation, book)) {
    try {
      return loadBook(await fetchJson(path));
    } catch {
      // Try the next candidate; the hardcoded chapter is the last resort.
    }
  }
  if (canonicalBook(book) === FALLBACK_BOOK.title) {
    // The five hardcoded verses. This is the fallback the owner played for hours
    // without being told, so it is the one that must announce itself loudest.
    usingFallback(DATA_NAMES.text);
    return FALLBACK_BOOK;
  }
  throw new Error(
    `The ${editionName(translation)} text for ${book} did not load. `
    + 'It may not have finished downloading.',
  );
}

// --- the world --------------------------------------------------------------

/**
 * Virtual pixels the world travels for one completed word.
 *
 * This is the whole movement model. A word finished is a step taken; nothing
 * else moves the scribe, and in particular no amount of elapsed time does.
 */
const WORLD_STRIDE = 24;

/**
 * How much of the remaining distance the camera closes each frame.
 *
 * Easing, not a clock: the target is a pure function of how many words are
 * behind the cursor, and this only decides how abruptly the world catches up
 * with it. Set it to 1 and the picture jumps a stride per word; it would still
 * be the same game.
 */
const CAMERA_LERP = 0.18;

/** Roughly how far apart the idling monsters stand, in virtual px. */
const MONSTER_SPACING = 220;

/** How high above the ground a bat hangs. */
const BAT_LIFT = 34;

/** Spread of the animation-clock stagger, so a row of bats does not beat as one. */
const PHASE_SPREAD_MS = 1200;

/** Draws per monster: position jitter, kind, phase. */
const DRAWS_PER_MONSTER = 3;

/**
 * How far short of a candle the player counts as having reached it.
 *
 * One stride, so the checkpoint at the end of a part lights on the last word
 * rather than under the report card that replaces the screen a moment later.
 */
const CANDLE_REACH = WORLD_STRIDE;

/**
 * Where the ribbon breaks into words.
 *
 * A space is a word boundary whether the stage has taught it or not: the
 * scribe's stride is about the text, not about the curriculum.
 */
function wordBreaks(glyphs: readonly Glyph[]): number[] {
  const out: number[] = [];
  glyphs.forEach((glyph, index) => {
    if (glyph.ch === ' ' || glyph.ch === '\n') out.push(index);
  });
  return out;
}

/**
 * How many words are wholly behind the cursor.
 *
 * The single definition of "finished a word" in the program. The camera reads
 * it, and so does combat: a monster is felled when this number passes its
 * anchor, on the same keystroke that moves the world. Two counts that disagreed
 * would put the blow a word away from the thing it lands on.
 */
function wordsDone(breaks: readonly number[], cursor: number): number {
  let done = 0;
  for (const at of breaks) {
    if (at >= cursor) break;
    done += 1;
  }
  return done;
}

/**
 * Progress through the ribbon, in words, including the fraction of the word
 * currently under the cursor.
 *
 * The fraction is what makes the world move while a word is being typed rather
 * than lurching a whole stride when it ends. It is still word-driven -- a word
 * is worth exactly one stride however many letters it has.
 */
function wordProgress(breaks: readonly number[], cursor: number, count: number): number {
  const done = wordsDone(breaks, cursor);
  const start = done === 0 ? 0 : (breaks[done - 1] ?? -1) + 1;
  const end = breaks[done] ?? count;
  const span = end - start;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (cursor - start) / span)) : 0;
  return done + fraction;
}

/** Words between one monster and the next: the spacing above, in strides. */
const WORDS_PER_MONSTER = Math.max(1, Math.round(MONSTER_SPACING / WORLD_STRIDE));

/**
 * The idling monsters standing in one stretch of world, each anchored to the
 * word that fells it.
 *
 * Their anchors and kinds come from the seeded generator in `core/rng.ts`, keyed
 * on the passage, so the same part is decorated the same way on every reload
 * without a byte being stored -- and never from `Math.random`, which would make
 * a replay of a recorded run a different level.
 *
 * A monster's world x is *derived* from its word rather than chosen: it stands
 * at the position the camera will have reached when that word is finished, plus
 * the scribe's own screen x, so it is directly in front of him at the moment the
 * blow lands. Position and anchor are therefore the same fact, and a monster
 * cannot end up being struck from across the room.
 *
 * Plus `strike_reach`, which is the whole of the owner's first complaint about
 * combat: without it "the position the camera will have reached" is *exactly*
 * where the scribe is standing, so he fells the monster by occupying it and the
 * blow has no distance to cross. The reach is the gap something can happen in.
 * See docs/design/03-pacing.md#defeating-a-monster-must-read-as-an-action.
 *
 * They face left, toward the oncoming scribe, and they never move. The scribe
 * arrives at them because he typed; they never arrive at him.
 */
function placeMonsters(
  seed: number,
  wordCount: number,
  groundY: number,
  scribeX: number,
  reach: number,
): Entity[] {
  const count = wordCount === 0 ? 0 : Math.max(1, Math.floor(wordCount / WORDS_PER_MONSTER));
  const rolls = draws(seed, Math.max(1, count) * DRAWS_PER_MONSTER);
  const out: Entity[] = [];
  for (let i = 0; i < count; i += 1) {
    const jitter = rolls[i * DRAWS_PER_MONSTER] ?? 0;
    const kind = (rolls[i * DRAWS_PER_MONSTER + 1] ?? 0) < 0.5 ? 'bat' : 'skeleton';
    const phase = rolls[i * DRAWS_PER_MONSTER + 2] ?? 0;
    // Somewhere inside this monster's own block of words, never in the next
    // one's, so two monsters can never share an anchor.
    const word = Math.min(
      wordCount - 1,
      i * WORDS_PER_MONSTER + Math.floor(jitter * WORDS_PER_MONSTER),
    );
    const x = Math.round((word + 1) * WORLD_STRIDE + scribeX + reach);
    const y = groundY - SPRITE_SIZE - (kind === 'bat' ? BAT_LIFT : 0);
    out.push(createEntity(`${kind}-${String(i)}`, kind, x, y, phase * PHASE_SPREAD_MS, -1, word));
  }
  return out;
}

// --- which world a passage is set in ----------------------------------------
//
// There used to be a thirty-line scene reader here: a range regex, a row type
// and a `themeFor` lookup, written before `core/scenes.ts` existed. It has gone
// where it belonged. The rule -- a hand-authored range table, an abbey for any
// passage with no row, and nothing inferred from a single character of the
// prose -- is docs/design/05-scenery-warps.md, and a rule in the platform is a
// rule no test in `core/` can reach. This file now asks one question and draws
// the answer.

// --- the ribbon -------------------------------------------------------------

/**
 * One candle-to-candle chunk as a single unbroken ribbon, with a verse number
 * per glyph.
 *
 * Verses are joined by a space rather than wrapped into lines: the rail has no
 * lines, and the HUD reads the verse off the glyph under the cursor.
 */
function buildRibbon(
  units: readonly string[],
  firstUnit: number,
  keySet: ReadonlySet<Key>,
  layout: KeyboardLayout,
  spaceThumb: Thumb,
): { glyphs: Glyph[]; verseAt: number[] } {
  const glyphs: Glyph[] = [];
  const verseAt: number[] = [];
  units.forEach((unit, index) => {
    const text = index === 0 ? unit : ` ${unit}`;
    for (const glyph of classify(text, keySet, layout, spaceThumb)) {
      glyphs.push(glyph);
      verseAt.push(firstUnit + index);
    }
  });
  return { glyphs, verseAt };
}

/**
 * First glyph the player owes at or after `from`; `glyphs.length` when there is
 * none.
 *
 * In gilding mode that is the first *producible* glyph rather than the first
 * live one, or resuming mid-part would drop the cursor past the untaught
 * characters the mode exists to ask for.
 */
function firstOwedAt(glyphs: readonly Glyph[], from: number, gilding: boolean): number {
  for (let i = Math.max(0, from); i < glyphs.length; i += 1) {
    const g = glyphs[i];
    if (g !== undefined && (gilding ? g.producible : g.live)) return i;
  }
  return glyphs.length;
}

/** Where in the ribbon a verse begins. */
function offsetOfUnit(verseAt: readonly number[], unit: number): number {
  const found = verseAt.indexOf(unit);
  return found < 0 ? 0 : found;
}

// --- the level --------------------------------------------------------------

/**
 * An optional doorway standing in a part: a flashback edge, and the stretch of
 * ribbon it is open across.
 *
 * It opens on the echoed phrase, because that is the only place in the passage
 * where stepping backwards means anything, and it stays open to the end of that
 * verse so the player has a sentence rather than a keystroke to notice it in.
 * Walking past it is typing on, and costs nothing at all.
 */
interface Doorway {
  readonly edge: RouteEdge;
  /** Glyph index in this part's ribbon where the doorway opens. */
  readonly at: number;
  /** The last glyph it is still open at: the end of the verse holding the echo. */
  readonly until: number;
}

/** How a part may be opened differently from the way the bookmark would open it. */
interface LevelOptions {
  /**
   * The exact glyph to resume on, rather than the first one owed. Used by the
   * return from a flashback, which must land on the cursor the player left and
   * not merely in the right verse.
   */
  readonly cursor?: number;
  /**
   * The ribbon offset the part opens at. A warp arrives with the destination's
   * copy of the held phrase already on `echoX`, and "the rail eases away from it
   * once the crossing is over" -- so the part opens on the crossing's offset and
   * glides to its own, rather than cutting.
   */
  readonly railOffset?: number;
  /** The frame to come back to, when this part is a secret room. */
  readonly flashback?: FlashbackFrame;
  /** The doorway it was entered by, so the return can retrace the same thread. */
  readonly doorway?: RouteEdge;
}

interface Level {
  readonly book: Book;
  readonly bookTitle: string;
  readonly chapter: number;
  readonly chunks: readonly Chunk[];
  readonly chunkIndex: number;
  readonly chunk: Chunk;
  readonly glyphs: Glyph[];
  readonly verseAt: number[];
  readonly keySet: readonly Key[];
  readonly stage: number;
  /** Whether this part was built in gilding mode; fixed for its lifetime. */
  readonly gilding: boolean;
  readonly layout: KeyboardLayout;
  readonly spaceThumb: Thumb;
  typing: TypingState;
  rail: RailState;
  reporting: boolean;
  /** The clock only runs once the player has actually started. */
  started: boolean;
  /** The verse under the cursor; what gets written to the bookmark. */
  bookmark: number;

  // --- the world this part is set in ---------------------------------------
  /**
   * The authored scene: a theme, and a set piece for the handful of passages
   * that have one. Resolved by `core/scenes.ts` from the range table, never
   * inferred from a character of the prose.
   */
  readonly scene: Scene;
  /**
   * The authored map the scenery is resolved against, per frame.
   *
   * Carried on the level rather than reached for, because `core/scenes.ts` now
   * answers a question about *where in the chapter* the player is -- Genesis 1 is
   * seven scenes -- and that has to be asked every frame, from the frame
   * builders, which are module-level functions with no view of the boot scope.
   * Null is the documented fallback and every passage is an abbey.
   */
  readonly sceneMap: SceneMap | null;
  /** The chapter, canonically cited: `Psalms 23`. What the route graph is keyed on. */
  readonly ref: string;
  /**
   * The optional doorways standing in this part, and the glyph each opens at.
   *
   * Every one of them may be walked straight past. That is not a promise made
   * here: `core/route.ts` guarantees it, because `requiredRefs` is built from
   * the *stops* and a flashback destination is by construction a secret. This
   * list is filtered through that guarantee rather than through a rule restated
   * in the platform -- see `doorwaysIn`.
   */
  readonly doorways: readonly Doorway[];
  /**
   * The frame to come back to, when this level *is* a secret room.
   *
   * Null in every ordinary part. Non-null, it is the verse, cursor, hearts,
   * smudge and combo the player left behind, held for the return trip and
   * handed back untouched -- damage taken inside a secret room is forgiven, by
   * design. See docs/design/05-scenery-warps.md#warps.
   */
  readonly flashback: FlashbackFrame | null;
  /**
   * The doorway this room was entered by, for the trip back out.
   *
   * Held on the level rather than in a second stack beside the return frames,
   * because nesting one room inside another would then be two stacks that have
   * to agree -- and `core/warp.ts` already owns the one that matters.
   */
  readonly doorwayHome: RouteEdge | null;
  /** Word-boundary indices into `glyphs`, so progress can be counted in strides. */
  readonly breaks: readonly number[];
  /** Virtual px from the candle at the start of this part to the one at its end. */
  readonly span: number;
  /** The two checkpoints bounding this part, in world x. */
  readonly candleXs: readonly number[];
  /**
   * The monsters in this part. Placed once, never moved, and removed only by
   * being defeated -- see `resolveDefeats`.
   */
  monsters: Entity[];
  scribe: Entity;
  /**
   * The blows still playing.
   *
   * A list and not a slot. One is appended by a completed word and by nothing
   * else; the loop runs each of them out so the animation ends, and nothing
   * depends on any of them having ended. At 140 WPM a word lands every ~430 ms
   * while a stomp runs longer, so the second blow starts on top of the first --
   * a single slot would cut the hop off mid-air, and only ever at the speed
   * where somebody would notice.
   */
  strikes: Strike[];
  /**
   * The PRNG state the drop rolls draw from.
   *
   * Its own stream, seeded from the passage, so which monsters leave an ink pot
   * is fixed by the seed and the order the words were finished in -- and so that
   * adding or removing a draw here can never shift the monster *placement*
   * stream and redecorate the level.
   */
  dropRng: number;
  /** Where the world has got to. A pure function of words completed, eased. */
  cameraX: number;
  /** Accumulated animation time, for art that flickers rather than moves. */
  animMs: number;
}

function verseUnder(level: Level): number {
  const index = Math.min(level.typing.cursor, level.verseAt.length - 1);
  return level.verseAt[Math.max(0, index)] ?? level.chunk.first;
}

/**
 * Where the cursor stands in the chapter, as a fractional verse number.
 *
 * 4.5 is halfway through verse 4. This is the only thing the scenery's
 * transition is a function of, which is what makes
 * docs/decisions/0004-idle-threat-not-speed-timer.md hold for the world as well
 * as for the monsters: it moves when a key is struck and at no other time.
 *
 * Measured off `verseAt` -- the glyph-to-verse map the ribbon was built with --
 * rather than off a character count, because a verse's length in glyphs is the
 * only honest measure of how far through it the player has typed.
 */
function versePosition(level: Level): number {
  const verse = verseUnder(level);
  const total = level.verseAt.length;
  if (total === 0) return verse;
  const cursor = Math.min(Math.max(0, level.typing.cursor), total - 1);
  let first = cursor;
  while (first > 0 && level.verseAt[first - 1] === verse) first -= 1;
  let last = cursor;
  while (last + 1 < total && level.verseAt[last + 1] === verse) last += 1;
  const span = last - first + 1;
  // The cursor is clamped into the verse before the fraction is taken, so the
  // position can never reach the *next* verse's number. At the end of the last
  // verse of a chapter the cursor sits one past the final glyph, and without
  // this the world resolved for a verse 32 that does not exist -- which fell
  // through to the chapter's default row and repainted Eden as the daybreak
  // on the last keystroke of Genesis 1.
  return verse + (Math.min(level.typing.cursor, last) - first) / span;
}

/** Where the camera wants to be: one stride per word behind the cursor. */
function cameraTarget(level: Level): number {
  return wordProgress(level.breaks, level.typing.cursor, level.glyphs.length) * WORLD_STRIDE;
}

function candlesOf(level: Level): SceneCandle[] {
  return level.candleXs.map((x) => ({ x, lit: level.cameraX >= x - CANDLE_REACH }));
}

/**
 * How far through the *chapter* the player has typed, 0..1.
 *
 * A set piece is a function of this and never of a clock: "the flood rises
 * because verses are being written", which is
 * docs/decisions/0004-idle-threat-not-speed-timer.md applied to the scenery. It
 * is measured over the chapter rather than the part, or the flood would drain
 * and rise again at every candle.
 */
function passageProgress(level: Level): number {
  const total = level.chunks[level.chunks.length - 1]?.last ?? 0;
  if (total <= 0) return 0;
  const span = level.chunk.last - level.chunk.first + 1;
  const within = level.glyphs.length === 0 ? 0 : level.typing.cursor / level.glyphs.length;
  return Math.min(1, Math.max(0, (level.chunk.first - 1 + within * span) / total));
}

/**
 * The passage's scripted flourish for this frame, or nothing.
 *
 * Most passages have none, which is the point of the mechanism: `sceneFor`
 * returns a null set piece for every row of the table that does not name one,
 * and for every passage with no row at all. `setpieceState` throws on an id it
 * does not implement, and that is left to throw -- a scene table that had run
 * ahead of the code would otherwise stay documented and imaginary for as long
 * as nobody happened to play that passage.
 */
function setpieceFor(level: Level, scene: SceneAt): SetpieceState | null {
  const id = scene.setpiece;
  if (id === null) return null;
  // Progress through the thing the flourish decorates. A verse row knows its own
  // span and says so; a chapter row does not, and the chapter is what it means.
  const progress = scene.sceneProgress ?? passageProgress(level);
  return setpieceState(id, { elapsedMs: level.animMs, progress });
}

/**
 * The scene under the cursor *right now*, not the one the chapter opened in.
 *
 * `level.scene` is the chapter's row and stays fixed for the level's life --
 * the tune is keyed on it, and a hymn restarted every five verses would be the
 * scenery competing with the rail. The picture is resolved per verse instead,
 * which is what makes Genesis 1 seven places rather than one.
 */
function sceneNow(level: Level, tuning: Tuning): SceneAt {
  return sceneAtVerse(level.sceneMap, level.ref, versePosition(level), tuning);
}

function sceneStateFor(
  level: Level,
  damage: DamageState,
  cloud: BlotCloud,
  tuning: Tuning,
): SceneState {
  const scene = sceneNow(level, tuning);
  const piece = setpieceFor(level, scene);
  return {
    theme: scene.theme,
    ...(scene.blendTheme === null || scene.blendMix <= 0
      ? {}
      : { blend: { theme: scene.blendTheme, mix: scene.blendMix } }),
    cameraX: level.cameraX,
    // The scribe walks exactly while the world is still moving under him, which
    // is exactly while there are words behind the cursor he has not been carried
    // past yet. Stop typing and he stops walking; there is no other input.
    walking: Math.abs(cameraTarget(level) - level.cameraX) >= 1,
    animMs: level.animMs,
    scribe: level.scribe,
    entities: level.monsters,
    cloud,
    damage,
    heartsMax: maxHearts(tuning),
    candles: candlesOf(level),
    strikes: level.strikes,
    // Spread rather than set to null: absent is not the same as empty, and
    // `exactOptionalPropertyTypes` is what keeps the two apart.
    ...(piece === null ? {} : { setpiece: piece }),
  };
}

function frameFor(
  level: Level,
  damage: DamageState,
  cloud: BlotCloud,
  tuning: Tuning,
  points: number,
  note: string | null,
  arrival: string | null,
  doorway: string | null,
  report: ReportMemory,
  followers: FollowerLine,
): FrameState {
  return {
    mode: level.reporting ? 'report' : 'level',
    // The verses themselves, and no invented unit beside them. This read
    // `Genesis 1:12  part 4/9` until the owner asked "why not verses and
    // chapters or something?" -- `part 4/9` is a number about our chunking that
    // he has no way to check against the page, and the citation of the stretch
    // he is actually typing is shorter and true. See
    // docs/design/03-pacing.md#the-game-says-verses-and-chapters-and-invents-nothing.
    ref: chunkRef(level.bookTitle, level.chapter, level.chunk),
    stage: level.stage,
    glyphs: level.glyphs,
    cursor: level.typing.cursor,
    blocked: level.typing.blocked,
    score: score(level.typing, tuning),
    keyStats: level.typing.keyStats,
    layout: level.layout,
    spaceThumb: level.spaceThumb,
    keySet: level.keySet,
    gilding: level.gilding,
    points,
    // The record's memory, not the part's. The card reads the hands over every
    // part the player has typed -- a hundred and fifty keystrokes spread over
    // nine fingers is noise, and nine means built from it would be a diagnosis
    // made of noise. See docs/design/08-stats.md#the-report-card.
    report,
    scene: sceneStateFor(level, damage, cloud, tuning),
    // Everyone he has picked up on the way. Handed in rather than reached for,
    // because this function is a projection and the party is derived from the
    // record -- see docs/design/11-followers.md#derived-never-stored.
    followers,
    // Drawn over everything, every frame, for as long as a fallback is in use.
    notice: noticeLines(),
    // Absent on all but a handful of frames in a player's life -- and absent is
    // not the same as empty here, so it is spread in rather than set to null.
    ...(note === null ? {} : { note }),
    ...(arrival === null ? {} : { arrival }),
    ...(doorway === null ? {} : { doorway }),
  };
}

// --- boot -------------------------------------------------------------------

/**
 * The score: every tune a theme asks for, plus the theme -> tune column.
 *
 * A tune that will not load leaves its theme silent rather than stopping the
 * game -- `tuneForTheme` already returns null for a theme with no tune, and a
 * missing hymn is not a reason a beginner cannot type today. A malformed one
 * still throws inside `loadTune`, which is where a wrong note is meant to be
 * found; it is caught here per tune, so one bad file costs one theme.
 */
async function loadSongbook(): Promise<Songbook> {
  const parsed = await fetchJsonOr('data/themes.json', { themes: [] }, DATA_NAMES.themes);
  let themes;
  try {
    themes = loadThemeTunes(parsed);
  } catch {
    usingFallback(DATA_NAMES.themes);
    return { library: createLibrary([]), themes: new Map<string, string>() };
  }
  const ids = [...new Set(themes.values())];
  const loaded = await Promise.all(
    ids.map(async (id): Promise<Tune | null> => {
      try {
        return loadTune(await fetchJson(`data/tunes/${id}.json`));
      } catch {
        usingFallback(DATA_NAMES.tunes);
        return null;
      }
    }),
  );
  const tunes = loaded.filter((tune): tune is Tune => tune !== null);
  return { library: createLibrary(tunes), themes };
}

const MAX_FRAME_MS = 100;

async function boot(): Promise<void> {
  const surface = document.getElementById('stage');
  if (!(surface instanceof HTMLCanvasElement)) throw new Error('main: no #stage canvas');
  const renderer: Renderer = createRenderer(surface);

  const tuning = loadTuning(await fetchJsonOr('data/tuning.json', FALLBACK_TUNING, DATA_NAMES.tuning));

  let stages: Stage[] = [];
  try {
    stages = loadStages(await fetchJson('data/curriculum.json'));
  } catch {
    // No curriculum file reachable: fall back to home row, which is stage 1 and
    // where a beginner starts anyway. Never guess a *larger* set than that --
    // the illumination invariant is the one thing that must not be approximated.
    usingFallback(DATA_NAMES.curriculum);
  }

  /**
   * The authored scene map, parsed by `core/scenes.ts`.
   *
   * Unreachable or malformed, it is `null` and every passage wears the abbey --
   * which is the documented fallback and not a degraded mode, since that is
   * exactly what an imported Gutenberg book gets. It still announces itself:
   * a silent fallback is indistinguishable from working software, and this one
   * would cost the game every theme and therefore every tune.
   */
  let scenes: SceneMap | null = null;
  try {
    scenes = loadScenes(await fetchJson('data/scenes/bible.json'));
  } catch {
    usingFallback(DATA_NAMES.scenery);
  }

  /**
   * The route graph: which passages are joined to which, and by what echo.
   *
   * Null when the file cannot be read, in which case the map screen says so
   * rather than drawing an empty graph -- there is a real difference between
   * "you have not reached anything yet" and "the route did not load", and only
   * one of them is the player's fault.
   */
  let route: Route | null = null;
  try {
    route = loadRoute(await fetchJson('data/routes/pilgrimage.json'));
  } catch {
    usingFallback(DATA_NAMES.route);
  }

  /**
   * Who joins after what.
   *
   * Null when the file cannot be read, in which case nobody walks behind him and
   * the map says nothing about company. That is the right failure: a follower is
   * a record of somewhere he has been and inventing one from a fallback would be
   * the game telling him he had been somewhere he had not.
   */
  let roster: Roster | null = null;
  try {
    roster = loadFollowers(await fetchJson('data/followers.json'));
  } catch {
    usingFallback(DATA_NAMES.followers);
  }

  const songbook = await loadSongbook();
  const webAudio: WebAudio = createWebAudio(tuning);
  let audio: AudioState = createAudio(tuning);
  /** Cues raised since the last frame of sound. Drained by the loop. */
  let cues: Cue[] = [];

  // Hearts and the meter live above the level, because they are the player's and
  // not the passage's: finishing a part must not quietly hand back a heart.
  let damage: DamageState = createDamage(tuning);
  let cloud: BlotCloud = createCloud();
  // Whether the blot-cloud is armed is `progress.cloudEnabled` and is read
  // straight off the record wherever it is needed. It was a session variable
  // here, which meant the switch ADR 0004 requires came back on at every reload
  // -- so the player who most needed it turned off had to find it again every
  // evening, and the game quietly overruled him in between.

  // --- the level's score ----------------------------------------------------
  //
  // The points belong to the level rather than to the part: gold leaf multiplies
  // "for the rest of the level", so the running total and the multiplier both
  // reset when a new chapter is opened and at no other time.
  //
  // `gildBanked` holds the gilding earned by the parts already finished. The
  // part in progress is added at draw time, so the number moves as the player
  // gilds -- except while the report card is up, when it has already been banked
  // and adding it again would count it twice.
  let gildBanked = 0;
  /**
   * The player, as this level has him: the gold leaf he is carrying and what the
   * items he has picked up were worth.
   *
   * A whole `PlayerState` deliberately, and it is grown rather than duplicated:
   * `applyItem` is the one implementation of what an item *does*, so a copy of
   * "add one to the multiplier" or "a pot on full hearts is worth points" here
   * would be a rule living in the platform. `damage` is the player's and outlives
   * any one level, so it is held separately and handed to `applyItem` on the way
   * in; only `scoreMultiplier` and `score` are read back off this.
   */
  let leaf: PlayerState = createPlayer(damage);

  /**
   * Where a pickup happened.
   *
   * Only a candle and a wax seal read any of it, and neither is dropped by a
   * monster -- but `applyItem` takes one for every item, and one definition here
   * is what stops the platform being the place an item quietly works differently
   * depending on which call site found it.
   */
  function pickupSite(): PickupSite {
    return {
      ref: `${level.bookTitle} ${String(level.chapter)}`,
      unit: level.chunk.first,
      unitCount: level.chunks.length,
    };
  }

  /** Points this level has earned, including the part still being typed. */
  function levelScore(): number {
    const inProgress = level.reporting ? 0 : gildScore(level.typing, tuning).points;
    return gildBanked + inProgress * leaf.scoreMultiplier + leaf.score;
  }

  function keySetAt(stage: number): ReadonlySet<Key> {
    return stages.length === 0 ? new Set(FALLBACK_KEY_SET) : keySetFor(stages, stage);
  }

  function stageKeysAt(stage: number): readonly Key[] {
    return stages.length === 0 ? [] : stageAt(stages, stage).keys;
  }

  /**
   * What the report card is a reading of: the record, not the part.
   *
   * Three things the display list cannot reach on its own -- the lifetime key
   * table, every finished part, and how far the stage is from opening -- handed
   * over as data. `core/draw.ts` decides what to say about them; nothing is
   * judged here.
   *
   * The gate is omitted rather than faked when the curriculum failed to load: a
   * card with no "what is still missing" block is a smaller lie than one quoting
   * a standard nothing is measuring.
   */
  function reportMemory(): ReportMemory {
    const memory = { keyStats: progress.keyStats, history: progress.history };
    if (stages.length === 0) return memory;
    const standing = gateProgress(progress, stages, tuning);
    return {
      ...memory,
      gate: {
        stage: standing.stage.stage,
        newKeys: standing.stage.keys,
        passed: standing.gate.passed,
        accuracyMet: standing.gate.accuracyMet,
        latencyMet: standing.gate.latencyMet,
        samples: standing.gate.samples,
        accuracy: standing.accuracy,
        medianMs: standing.medianMs,
        requiredAccuracy: standing.requiredAccuracy,
        allowedLatencyMs: standing.allowedLatencyMs,
        requiredSamples: standing.requiredSamples,
      },
    };
  }

  /**
   * The same card, opened from the menu rather than reached by finishing a part.
   *
   * docs/design/08-stats.md#the-report-card: it is a history of his hands, and a
   * history he can only see by finishing something is one he cannot consult when
   * he wants it. Every judgement on it is the same core function the end-of-part
   * card calls, so the two cannot drift into disagreeing about the same record.
   */
  function handsView(): HandsView {
    const memory = reportMemory();
    const card = reportCard(
      {
        keyStats: memory.keyStats,
        layout: progress.layout,
        spaceThumb: progress.spaceThumb,
        keySet: [...keySetAt(progress.stage)],
      },
      tuning,
    );
    const trend = reportTrend(memory.history, tuning);
    return {
      scope: progress.gilding
        ? 'Over everything you have typed, not just the last few verses — counting the keys '
          + 'your stage teaches, which with gilding on is not everything you typed.'
        : 'Over everything you have typed, not just the last few verses.',
      fingers: card.fingers,
      worst: card.worst,
      quickest: card.quickest?.finger ?? null,
      note: reportNote(card, trend),
      advice: reportAdvice(card, memory.gate, tuning),
      gate: memory.gate ?? null,
      trend,
    };
  }

  let progress: Progress = loadProgress();

  /**
   * The first-run coach: which of the three notes have been spent, and which
   * one -- if any -- is under the rail right now.
   *
   * Seeded from the record, so a note dismissed last week does not come back
   * today, and written back the instant one is shown rather than when it is
   * dismissed. It holds nothing the player could win or lose by; see
   * `coachKeystroke` below.
   */
  let coach: CoachState = createCoach(progress.notesSeen);

  /**
   * Open a chunk. `at` overrides the bookmark -- used by "type it again" and by
   * the menu's jump -- and defaults to wherever the record says the player is.
   *
   * @throws if the book cannot be loaded, so the menu can say so rather than
   *         silently landing the player somewhere they did not ask for
   */
  async function buildLevel(at: Position, options: LevelOptions = {}): Promise<Level> {
    const book = await fetchBook(progress.translation, at.book);
    // A chapter the book does not have -- a bookmark carried across a jump, or
    // a hand-typed number -- lands on the first chapter rather than on nothing.
    const asked = sectionFor(book, at.chapter);
    const section = asked ?? book.sections[0];
    if (section === undefined) throw new Error('main: book has no sections');
    const chapter = asked === null ? Number(section.name) : at.chapter;

    const chunks = chunksFor(section.units.length, tuning);
    const chunkIndex = chunkIndexFor(chunks, at.unit);
    const chunk = chunks[chunkIndex] ?? { first: 1, last: section.units.length };
    const units = section.units.slice(chunk.first - 1, chunk.last);

    const keySet = keySetAt(progress.stage);
    const { glyphs, verseAt } = buildRibbon(
      units, chunk.first, keySet, progress.layout, progress.spaceThumb,
    );

    // Resume on the verse the player left, not at the top of the chunk: the
    // chunk is the checkpoint, but there is no reason to make them retype the
    // verses they already finished inside it.
    const resumeAt = firstOwedAt(
      glyphs, offsetOfUnit(verseAt, Math.max(chunk.first, at.unit)), progress.gilding,
    );
    const base = createTypingState(glyphs, progress.gilding);
    const opened = resumeAt <= base.cursor ? base : { ...base, cursor: resumeAt };
    // A flashback return names the cursor outright. It is clamped rather than
    // trusted: the frame is the player's, but the ribbon is rebuilt, and a
    // stage change while they were inside the room would shorten it.
    const exact = options.cursor;
    const typing = exact === undefined
      ? opened
      : { ...base, cursor: Math.min(Math.max(0, exact), glyphs.length) };

    const railTarget = layoutRail(glyphs, typing.cursor, VIRTUAL_W, tuning).offset;
    const ref = formatReference(book.title, chapter);
    const scene = sceneAt(scenes, ref);
    const layout = sceneLayout(scene.theme, tuning);
    const breaks = wordBreaks(glyphs);
    // One stride per word, and the part's far candle stands at the end of them.
    const span = (breaks.length + 1) * WORLD_STRIDE;
    const where = `${book.title} ${String(chapter)} ${String(chunkIndex)}`;
    const seed = seedFrom(where);

    return {
      book,
      bookTitle: book.title,
      chapter,
      chunks,
      chunkIndex,
      chunk,
      glyphs,
      verseAt,
      keySet: [...keySet],
      stage: progress.stage,
      gilding: progress.gilding,
      layout: progress.layout,
      spaceThumb: progress.spaceThumb,
      typing,
      // Settled on its target, unless a crossing has just handed the ribbon over
      // at the offset that held the phrase -- in which case the rail opens there
      // and eases away from it, which is what `arrivalOffset` is for.
      rail: options.railOffset === undefined
        ? createRail(railTarget)
        : { offset: options.railOffset, targetOffset: railTarget },
      reporting: false,
      started: false,
      bookmark: verseAt[typing.cursor] ?? chunk.first,
      scene,
      sceneMap: scenes,
      ref,
      doorways: doorwaysIn(ref, glyphs, verseAt),
      flashback: options.flashback ?? null,
      doorwayHome: options.doorway ?? null,
      breaks,
      span,
      // The candle behind him is the checkpoint he is standing on; the one ahead
      // is the next, and it lights as he reaches it.
      candleXs: [0, span],
      // Resuming mid-part, the monsters whose words are already behind the
      // cursor are gone: he beat them before he closed the tab, and re-fighting
      // them would make a checkpoint cost something it is not supposed to cost.
      monsters: placeMonsters(
        seed, breaks.length, layout.groundY, layout.scribeX, strikeReachPx(tuning),
      ).filter((m) => m.word === null || m.word >= wordsDone(breaks, typing.cursor)),
      scribe: createEntity('scribe', 'scribe', layout.scribeX, layout.groundY - SPRITE_SIZE),
      strikes: [],
      dropRng: seedFrom(`${where} drops`),
      // The camera opens where the cursor already is, so resuming mid-part does
      // not scroll the whole passage past the player before it settles.
      cameraX: wordProgress(breaks, typing.cursor, glyphs.length) * WORLD_STRIDE,
      animMs: 0,
    };
  }

  let level: Level = await buildLevel(progress.position).catch(async () => {
    // The bookmark points somewhere unreachable -- a book that was never
    // fetched, say. Fall back to the beginning rather than refusing to start.
    progress = withPosition(progress, DEFAULT_PROGRESS.position);
    return buildLevel(progress.position);
  });

  // Write the record back once, at boot. A record migrated from an older schema
  // -- or read out of a slot an earlier build wrote -- is not really migrated
  // until it has been stored in the current shape, and waiting for the first
  // keystroke to do it leaves a player who opens the tab and closes it again
  // exactly where they were before the migration.
  saveProgress(progress);

  // --- keyboard, attached only while the player is typing -------------------

  let detach: (() => void) | null = null;

  function detachTyping(): void {
    if (detach !== null) detach();
    detach = null;
  }

  function attachTyping(): void {
    if (detach !== null) return;
    detach = attachKeyboard(window, onInput);
  }

  // --- the bookmark ---------------------------------------------------------

  function bookmark(): void {
    // A secret room is not a place to come back to. Writing the bookmark inside
    // one would make closing the tab mid-flashback reopen the game in a room
    // with nothing on the stack to leave it by.
    if (level.flashback !== null) return;
    const unit = verseUnder(level);
    if (unit === level.bookmark && progress.position.chapter === level.chapter) return;
    level.bookmark = unit;
    progress = withPosition(progress, {
      book: level.bookTitle,
      chapter: level.chapter,
      unit,
    });
    saveProgress(progress);
  }

  /** Where the player goes once this chunk is behind them. */
  function positionAfter(): Position {
    const next = level.chunks[level.chunkIndex + 1];
    if (next !== undefined) {
      return { book: level.bookTitle, chapter: level.chapter, unit: next.first };
    }
    const nextChapter = level.chapter + 1;
    if (sectionFor(level.book, nextChapter) !== null) {
      return { book: level.bookTitle, chapter: nextChapter, unit: 1 };
    }
    // End of the book. Stay put; the menu is how you go somewhere else.
    return { book: level.bookTitle, chapter: level.chapter, unit: level.chunk.first };
  }

  // --- the candle -----------------------------------------------------------

  /**
   * A chunk is finished: record it, save it, and ask the gate.
   *
   * The gate is asked *after* the session is folded in, because the trailing
   * window it reads has to include the keystrokes that might have opened it.
   */
  function finishChunk(): void {
    if (level.reporting) return;
    level.reporting = true;
    const final = score(level.typing, tuning);
    const lastChunk = level.chunkIndex === level.chunks.length - 1;

    // Bank what this part gilded, then take the gold leaf a fully gilded page
    // earns -- in that order, so the leaf multiplies the *rest* of the level
    // rather than the page that won it.
    const gild = gildScore(level.typing, tuning);
    gildBanked += gild.points * leaf.scoreMultiplier;
    if (gild.complete) {
      leaf = applyItem(leaf, 'gold_leaf', pickupSite(), tuning).player;
    }

    progress = recordSession(
      progress,
      {
        date: today(),
        stage: level.stage,
        ref: chunkRef(level.bookTitle, level.chapter, level.chunk),
        wpm: final.wpm,
        accuracy: final.accuracy,
        keyStats: level.typing.keyStats,
        position: positionAfter(),
        completed: lastChunk ? `${level.bookTitle} ${String(level.chapter)}` : null,
        stageKeys: stageKeysAt(level.stage),
        promoted: false,
      },
      tuning,
    );

    const promotion = stages.length === 0 ? null : evaluatePromotion(progress, stages, tuning);
    if (promotion !== null) {
      progress = promote(progress, promotion.to);
    }
    // Asked after the session is folded in, and never acted on here: this only
    // decides whether to *ask*. The mode is turned on by `answerGildOffer`,
    // which is the player's answer and nothing else. See
    // docs/decisions/0008-gilding-permissive-input.md.
    const offering = shouldOfferGilding(progress, tuning);
    saveProgress(progress);
    // A finished passage hands over its figure. The report card is about to go
    // up over the top of this, so the line waits under the rail for the next
    // stretch of verses, which is where the player will be when he reads it.
    greetNewcomers();

    if (promotion !== null) {
      detachTyping();
      // The report card is already on the canvas behind this; dismissing the
      // notice hands the keyboard back and reveals it. A gilding offer waiting
      // behind it takes its turn rather than being dropped -- or being stacked
      // on top of the promotion, which would be two panels at once.
      overlay.showPromotion(promotion, offering ? offerGilding : attachTyping);
      return;
    }
    if (offering) {
      detachTyping();
      offerGilding();
    }
  }

  /**
   * Offer the mode. Never turn it on.
   *
   * Both answers are remembered, so the question is asked once. "Not now" is a
   * real answer -- the menu still has the switch -- and the alternative, asking
   * again after every good session, is imposition wearing an offer's clothes.
   */
  function offerGilding(): void {
    overlay.showGildOffer((accept) => {
      progress = withGildOffered(setGilding(progress, accept));
      saveProgress(progress);
      attachTyping();
    });
  }

  // --- navigation -----------------------------------------------------------

  let loading = false;

  /**
   * Open somewhere else. `resume` is false only for a change that leaves the
   * menu up -- handing the keyboard back while a panel is open would send the
   * player's next keystroke into the rail behind it.
   */
  function goTo(
    at: Position,
    onError: (message: string) => void,
    resume = true,
    options: LevelOptions = {},
  ): void {
    if (loading) return;
    loading = true;
    void buildLevel(at, options)
      .then((next) => {
        // Gold leaf lasts "for the rest of the level", and a level is a chapter.
        // Crossing into another one resets both the multiplier and the running
        // gild total; moving between parts of the same chapter does not.
        if (next.bookTitle !== level.bookTitle || next.chapter !== level.chapter) {
          gildBanked = 0;
          leaf = createPlayer(damage);
        }
        level = next;
        progress = withPosition(progress, {
          book: next.bookTitle,
          chapter: next.chapter,
          unit: next.bookmark,
        });
        saveProgress(progress);
        if (resume) {
          overlay.close();
          attachTyping();
        }
      })
      .catch((error: unknown) => {
        onError(String(error instanceof Error ? error.message : error));
      })
      .finally(() => {
        loading = false;
      });
  }

  // --- the route --------------------------------------------------------------
  //
  // The graph in `core/route.ts`, joined to the record. Everything the map shows
  // is derived here and decided there: which nodes exist, which are unlocked,
  // which are secret, and the note on every thread.

  /**
   * A citation in the one spelling everything else can be compared against.
   *
   * The route table says `Psalm 23` and a fetched book is titled `Psalms`, which
   * is the whole reason `core/corpus.ts` has a canon table. Comparing the record
   * against the graph without going through it would leave a completed psalm
   * failing to unlock the passage it leads to, silently.
   */
  function canonRef(citation: string): string {
    try {
      const parsed = parseReference(citation);
      return formatReference(parsed.book, parsed.chapter);
    } catch {
      return citation;
    }
  }

  /** The route's own spelling of a citation, or null when it names no node. */
  function routeRefFor(citation: string): string | null {
    if (route === null) return null;
    const want = canonRef(citation);
    return nodeRefs(route).find((ref) => canonRef(ref) === want) ?? null;
  }

  /**
   * Where the player stands on the graph, built from the record.
   *
   * Assembled with the module's own reducers rather than by writing the record
   * out by hand, so the rules about what completing and discovering *mean* stay
   * in one place. `completed` comes from `progress.completed`, which the candle
   * has always written; `discovered` comes from the field added for it, because
   * a secret is revealed by being found and a reload must not lose that.
   */
  function mapState(): MapState {
    if (route === null) return { routeId: '', current: '', completed: [], discovered: [] };
    const done = new Set(progress.completed.map(canonRef));
    const found = new Set(progress.discovered.map(canonRef));
    let state = createMap(route);
    for (const ref of nodeRefs(route)) {
      if (done.has(canonRef(ref))) state = completePassage(state, ref);
      if (found.has(canonRef(ref))) state = discoverSecret(state, ref);
    }
    // The route's own spelling when it names this passage, and the passage
    // itself when it does not. Standing off the route is a normal thing to do
    // -- the menu jumps anywhere and reading on from Genesis 1 reaches Genesis
    // 2 -- and the map answers it by marking nothing and saying where he is,
    // rather than by marking the route's first entry and being wrong. See
    // docs/design/04-route.md#standing-off-the-route.
    const here = routeRefFor(level.ref)
      ?? formatReference(level.bookTitle, level.chapter);
    return arriveAt(state, here);
  }

  /**
   * The company, derived from the same map state the panel is drawn from.
   *
   * Nothing is stored: `completed` and `discovered` are already on the record
   * and the party is the union of them, intersected with the passages the route
   * names. There is no third list to fall out of step with the other two.
   * See docs/design/11-followers.md#derived-never-stored.
   */
  function company(): readonly Follower[] {
    if (route === null || roster === null) return [];
    return gatheredParty(roster, route, mapState());
  }

  /** The company as the screen draws it: capped, nearest first, plus a count. */
  function partyLine(): FollowerLine {
    return followerLine(company(), tuning);
  }

  // --- an arrival, said once ------------------------------------------------

  /**
   * A follower who has just joined, and how much typing is left before the line
   * goes.
   *
   * Finishing Moriah used to put Abraham behind the scribe and say nothing at
   * all: the figure appeared in the scenery band, which is not where the player
   * is looking, and an arrival nobody notices is an arrival that did not happen.
   * So it says one sentence in the strip under the rail, in the same manner as a
   * first-run note -- shown once, dismissed by typing on, never repeated.
   * See docs/design/11-followers.md#arriving-with-a-line.
   */
  interface Arrival {
    readonly line: string;
    /** Correct keystrokes still owed before it leaves. */
    left: number;
  }

  let arrival: Arrival | null = null;

  /**
   * Everyone already met, so that only a *new* figure speaks.
   *
   * Seeded from the record at boot rather than left empty, or a player nineteen
   * chapters in would be greeted by his whole company on the first keystroke of
   * the evening. The party is derived from `completed` and `discovered`
   * (docs/design/11-followers.md#derived-never-stored), so this is the only
   * place a "have I said this yet" fact is kept -- and it is session state on
   * purpose: it is about this sitting, not about the player.
   */
  const metAlready = new Set<string>(company().map((f) => f.ref));

  /**
   * Compare the party against who has already been greeted, and take a line if
   * it has grown.
   *
   * Called after the two things that can grow it -- finishing a passage, and
   * finding a room -- and after nothing else. If two figures arrive on one
   * keystroke, which no route currently allows, the first in route order
   * speaks and the second joins silently: two sentences under the rail at once
   * is the tutorial wall this whole strip exists to avoid.
   */
  function greetNewcomers(): void {
    for (const figure of company()) {
      if (metAlready.has(figure.ref)) continue;
      metAlready.add(figure.ref);
      if (arrival === null) {
        arrival = { line: arrivalLine(figure.who), left: noteHoldKeys() };
      }
    }
  }

  /** How many correct keystrokes a line under the rail stays for. */
  function noteHoldKeys(): number {
    return Math.max(1, Math.trunc(tuningValue(tuning, 'first_run_note_keys')));
  }

  /** The sentence in the strip, or null. */
  function arrivalText(): string | null {
    return arrival === null ? null : arrival.line;
  }

  /**
   * One keystroke, as the arrival sees it: the same rule as a first-run note.
   *
   * Dismissed by *continuing to type*, and by nothing else. A clock would take
   * the sentence away from the one player who stopped to read it, and a button
   * would make a remark into a thing to deal with.
   */
  function stepArrival(before: TypingState): void {
    if (arrival === null) return;
    if (level.typing.correct <= before.correct) return;
    arrival.left -= 1;
    if (arrival.left <= 0) arrival = null;
  }

  function routeView(): RouteView {
    if (route === null) {
      return {
        routeId: '', complete: false, finished: 0, stops: 0,
        nodes: [], threads: [], standing: null, party: [], error: ROUTE_MISSING,
      };
    }
    const state = mapState();
    return {
      routeId: route.id,
      complete: routeComplete(route, state),
      // Null while he is on a node; the chapter itself while he is not, which
      // is what the map says in place of marking anything.
      standing: standingOffRoute(route, state),
      // The company, from the same state everything else on this panel is drawn
      // from, so the two lists cannot disagree. `walking` marks the ones the
      // capped line on screen is currently showing.
      party: (() => {
        const gathered = company();
        const shown = new Set(followerLine(gathered, tuning).walking.map((f) => f.ref));
        return gathered.map((f) => ({ ref: f.ref, who: f.who, walking: shown.has(f.ref) }));
      })(),
      finished: mapView(route, state).filter((n) => n.kind === 'stop' && n.completed).length,
      stops: requiredRefs(route).length,
      nodes: mapView(route, state)
        .filter((node) => node.visible)
        .map((node) => ({
          ref: node.ref,
          kind: node.kind,
          unlocked: node.unlocked,
          completed: node.completed,
          current: node.current,
        })),
      threads: mapThreads(route, state)
        .filter((thread) => thread.visible)
        .map((thread) => ({
          from: thread.edge.from,
          to: thread.edge.to,
          kind: thread.edge.kind,
          echo: echoFor(thread.edge, progress.translation),
          note: thread.edge.note,
          travelled: thread.travelled,
        })),
      error: null,
    };
  }

  /** The position a citation names: the top of that chapter. */
  function positionOf(citation: string): Position {
    const parsed = parseReference(citation);
    return { book: parsed.book, chapter: parsed.chapter, unit: 1 };
  }

  // --- crossings --------------------------------------------------------------

  /** A chapter, as both the text a warp is planned against and the ribbon drawn. */
  interface ChapterText {
    readonly units: readonly string[];
    /** The whole chapter as one ribbon, joined exactly as `buildRibbon` joins it. */
    readonly text: string;
  }

  async function chapterText(citation: string): Promise<ChapterText> {
    const parsed = parseReference(citation);
    const book = await fetchBook(progress.translation, parsed.book);
    const section = sectionFor(book, parsed.chapter) ?? book.sections[0];
    if (section === undefined) throw new Error(`main: no chapter for ${citation}`);
    return { units: section.units, text: section.units.join(' ') };
  }

  /** The whole chapter, classified for the stage the player is on. */
  function chapterRibbon(units: readonly string[]): readonly Glyph[] {
    return buildRibbon(
      units, 1, keySetAt(progress.stage), progress.layout, progress.spaceThumb,
    ).glyphs;
  }

  /** Where a chunk starts in its chapter's ribbon. Verses are joined by one space. */
  function chapterOffsetOfUnit(units: readonly string[], firstUnit: number): number {
    if (firstUnit <= 1) return 0;
    return units.slice(0, firstUnit - 1).join(' ').length + 1;
  }

  /**
   * A crossing in flight.
   *
   * `plan` is computed once, at the doorway, and nothing here recomputes any of
   * it -- `echoX` least of all. The two ribbons are the chapter being left and
   * the chapter arriving, each at the offset that puts *its* copy of the phrase
   * on that same column, which is why the swap between them at the hold boundary
   * is invisible.
   */
  interface ActiveWarp {
    readonly plan: WarpPlan;
    state: WarpState;
    readonly originGlyphs: readonly Glyph[];
    /** The offset that lands the origin's copy of the phrase on `plan.echoX`. */
    readonly originOffset: number;
    readonly destGlyphs: readonly Glyph[];
    /** The scenery being left, frozen: it is the thing the destination dissolves over. */
    readonly fromScene: SceneState;
    readonly toTheme: string;
    readonly cameraX: number;
    /** Run once, on the frame the crossing ends. Synchronous by construction. */
    readonly arrive: () => void;
  }

  let warp: ActiveWarp | null = null;

  /**
   * Travel an echo edge.
   *
   * The destination level is built *before* the crossing starts, so nothing in
   * the 1.4 seconds of the phase is waiting on a fetch: a crossing that stalled
   * mid-dissolve would move the one thing on screen that must not move, by
   * dropping frames around it.
   *
   * `reverse` is the way back out of a secret room. The edge is mirrored rather
   * than the arithmetic, so `planWarp` still names the right side of it when a
   * phrase is missing.
   */
  async function crossEdge(
    edge: RouteEdge,
    reverse: boolean,
    destination: Position,
    options: LevelOptions,
  ): Promise<void> {
    const crossing: RouteEdge = reverse ? { ...edge, from: edge.to, to: edge.from } : edge;
    const origin = await chapterText(crossing.from);
    const dest = await chapterText(crossing.to);

    // Entered from where the player is standing when the passage is the origin,
    // and from the phrase itself otherwise -- which is where the map travels
    // from, and puts the echo on the focal guide for the whole crossing.
    const standingHere = canonRef(level.ref) === canonRef(crossing.from);
    const originCursor = standingHere
      ? chapterOffsetOfUnit(origin.units, level.chunk.first) + level.typing.cursor
      : locateEcho(origin.text, echoFor(crossing, progress.translation));

    const plan = planWarp({
      edge: crossing,
      translation: progress.translation,
      originText: origin.text,
      originCursor: Math.max(0, originCursor),
      destText: dest.text,
      viewportW: VIRTUAL_W,
      tuning,
    });

    // The destination opens on the crossing's own offset and eases away from it,
    // which is what the plan's `arrivalOffset` is for -- unless it is opening on
    // an exact cursor, where the ribbon is a chunk from the middle of the
    // chapter and shares no indices with the one the crossing drew.
    const next = await buildLevel(
      destination,
      options.cursor === undefined
        ? { ...options, railOffset: plan.arrivalOffset }
        : options,
    );

    detachTyping();
    warp = {
      plan,
      state: beginWarp(plan, tuning),
      originGlyphs: chapterRibbon(origin.units),
      // Carried through from the plan, never recomputed: the origin's phrase
      // sits on `echoX`, so the ribbon holding it starts exactly this far left.
      originOffset: plan.echoX - plan.originSpan.first * CELL_W,
      destGlyphs: chapterRibbon(dest.units),
      fromScene: sceneStateFor(level, damage, cloud, tuning),
      toTheme: sceneAt(scenes, canonRef(crossing.to)).theme,
      cameraX: level.cameraX,
      arrive: () => {
        if (next.bookTitle !== level.bookTitle || next.chapter !== level.chapter) {
          gildBanked = 0;
          leaf = createPlayer(damage);
        }
        level = next;
        // A secret room is not a place to come back to. Writing the bookmark on
        // the way in would make closing the tab mid-flashback reopen the game
        // inside the room, with nothing on the stack to leave it by -- which is
        // exactly the trap docs/design/04-route.md says a flashback must not be.
        if (next.flashback === null) {
          progress = withPosition(progress, {
            book: next.bookTitle,
            chapter: next.chapter,
            unit: next.bookmark,
          });
          saveProgress(progress);
        }
        attachTyping();
      },
    };
  }

  /** The frame a crossing draws. Nothing else in the program draws one. */
  function warpFrame(w: ActiveWarp): { frame: FrameState; rail: RailState } {
    const holding = w.state.phase === 'holding';
    const glyphs = holding ? w.originGlyphs : w.destGlyphs;
    const offset = holding ? w.originOffset : w.plan.arrivalOffset;
    const view: WarpView = {
      phrase: w.plan.phrase,
      // Straight off the state, which carries it straight off the plan. There is
      // no arithmetic between `planWarp` and the screen column.
      echoX: w.state.echoX,
      echoAlpha: w.state.echoAlpha,
      worldMix: w.state.worldMix,
      toTheme: w.toTheme,
      cameraX: w.cameraX,
    };
    return {
      frame: {
        mode: 'level' as Mode,
        ref: `${w.plan.from}  \u2192  ${w.plan.to}`,
        stage: level.stage,
        glyphs,
        // `heldSpan` decides which copy of the phrase is the live one this
        // frame. Both sit on the same column, which is why the renderer may
        // make the swap whenever it likes -- and why this is asked rather than
        // worked out a second time here.
        cursor: heldSpan(w.state).first,
        blocked: false,
        score: score(level.typing, tuning),
        keyStats: level.typing.keyStats,
        layout: level.layout,
        spaceThumb: level.spaceThumb,
        keySet: level.keySet,
        gilding: level.gilding,
        points: levelScore(),
        scene: w.fromScene,
        followers: partyLine(),
        notice: noticeLines(),
        warp: view,
      },
      rail: { offset, targetOffset: offset },
    };
  }

  // --- secret rooms -----------------------------------------------------------

  /**
   * The return stack.
   *
   * `core/warp.ts` owns what pushing and popping one *mean*; this only holds it.
   * In particular `skipFlashback` is the identity on it, which is why walking
   * past a doorway is written below as a call rather than as a comment.
   */
  let returnStack: readonly FlashbackFrame[] = [];

  /**
   * The doorways in a part, and where each opens.
   *
   * The guarantee is consumed rather than restated: a destination the route
   * *requires* is filtered out here, so a table edited into asking for a secret
   * room would lose its doorway rather than quietly gate a level behind one.
   * In a well-formed route the filter removes nothing, which is the point --
   * `requiredRefs` is built from the stops and a flashback destination is a
   * secret by construction.
   */
  function doorwaysIn(
    ref: string,
    glyphs: readonly Glyph[],
    verseAt: readonly number[],
  ): Doorway[] {
    const here = routeRefFor(ref);
    if (route === null || here === null) return [];
    const required = new Set(requiredRefs(route).map(canonRef));
    const text = glyphs.map((g) => g.ch).join('');
    const out: Doorway[] = [];
    for (const edge of flashbacksFrom(route, here)) {
      if (required.has(canonRef(edge.to))) continue;
      const at = locateEcho(text, echoFor(edge, progress.translation));
      if (at < 0) continue;
      const verse = verseAt[at];
      let until = at;
      while (until + 1 < verseAt.length && verseAt[until + 1] === verse) until += 1;
      out.push({ edge, at, until });
    }
    return out;
  }

  /** The doorway standing open under the cursor right now, or none. */
  function openDoorway(): Doorway | null {
    if (warp !== null || reading !== null || level.reporting || level.flashback !== null) {
      return null;
    }
    return level.doorways.find(
      (d) => level.typing.cursor >= d.at && level.typing.cursor <= d.until,
    ) ?? null;
  }

  /** The sentence in the strip under the rail, when something is standing open. */
  function doorwayPrompt(): string | null {
    if (level.flashback !== null) return 'tab: back to where you were';
    const open = openDoorway();
    if (open === null) return null;
    // The key first, so the two prompts read as the same control; then the
    // passage it opens onto, because "a doorway" alone says only that something
    // is there; then the route's own note -- verbatim, because the note is the
    // reason the room is worth stepping into and lower-casing it mangles a
    // citation. docs/design/04-route.md#how-it-is-played.
    return `tab: a doorway into ${open.edge.to} \u00b7 ${open.edge.note}`;
  }

  /**
   * Step through a doorway.
   *
   * The frame is pushed by `core/warp.ts`, which refuses a progression edge
   * outright, and the room is remembered as *found* the moment it is entered --
   * a player who steps in, turns round and walks straight back out has found it,
   * and losing it off the map again would be the same as never having found it.
   */
  function enterDoorway(): void {
    const open = openDoorway();
    if (open === null || loading) return;
    const here: FlashbackFrame = {
      ref: level.ref,
      unit: verseUnder(level),
      cursor: level.typing.cursor,
      damage,
    };
    const stepped = enterFlashback(open.edge, here, returnStack);
    returnStack = stepped.stack;
    progress = withDiscovered(progress, stepped.destination);
    saveProgress(progress);
    // Finding the room is the achievement, so the figure joins here rather than
    // on the way back out -- and says so, in the room, on the next keystroke.
    greetNewcomers();
    loading = true;
    // Taken away now rather than when the crossing starts: the room is fetched
    // first, and a keystroke landing on the rail in between would be typed into
    // a passage the player has already stepped out of.
    detachTyping();
    void crossEdge(
      open.edge, false, positionOf(stepped.destination), { flashback: here, doorway: open.edge },
    )
      .catch((error: unknown) => {
        // The room would not open. Nothing has been spent: unwind the stack and
        // leave the player exactly where they were, still typing.
        returnStack = skipFlashback(returnStack.slice(0, -1));
        overlay.showError(String(error instanceof Error ? error.message : error));
        attachTyping();
      })
      .finally(() => {
        loading = false;
      });
  }

  /**
   * Phase forward again, to the exact verse left.
   *
   * The frame comes back untouched, hearts and smudge included: damage taken
   * inside a secret room is forgiven, because the alternative is a secret that
   * costs the player the level it interrupted.
   */
  function leaveDoorway(): void {
    const inside = level.flashback;
    if (inside === null || loading || !insideFlashback(returnStack)) return;
    const left = leaveFlashback(returnStack);
    returnStack = left.stack;
    const frame = left.frame;
    const edge = level.doorwayHome;
    loading = true;
    detachTyping();
    const back = { book: parseReference(frame.ref).book, chapter: parseReference(frame.ref).chapter, unit: frame.unit };
    const restore = (): void => {
      damage = frame.damage;
    };
    const done = edge === null
      ? buildLevel(back, { cursor: frame.cursor }).then((next) => {
          level = next;
          restore();
          attachTyping();
        })
      : crossEdge(edge, true, back, { cursor: frame.cursor }).then(() => {
          const w = warp;
          if (w === null) return;
          const arrive = w.arrive;
          warp = { ...w, arrive: () => { arrive(); restore(); } };
        });
    void done
      .catch((error: unknown) => {
        overlay.showError(String(error instanceof Error ? error.message : error));
        attachTyping();
      })
      .finally(() => {
        loading = false;
      });
  }

  // --- reading ----------------------------------------------------------------

  /** A lectio sitting: the ribbon, and where the ramp has got to. */
  interface Reading {
    state: LectioState;
    readonly glyphs: readonly Glyph[];
    readonly ref: string;
  }

  let reading: Reading | null = null;

  /**
   * Read without typing.
   *
   * Same ribbon, same rail, same focal guide, and the pace ramps for as long as
   * the reader sustains it. The ribbon is classified against the *whole* board
   * rather than the current stage: reading mode asks for no keys, and half a
   * page greyed would be the curriculum answering a question this mode never
   * puts. See docs/design/02-rail.md#reading-mode.
   */
  function startReading(): void {
    const section = sectionFor(level.book, level.chapter);
    if (section === null) return;
    const last = stages[stages.length - 1];
    const keys = last === undefined ? new Set(FALLBACK_KEY_SET) : keySetFor(stages, last.stage);
    reading = {
      state: createLectio(tuning),
      glyphs: buildRibbon(
        section.units, 1, keys, progress.layout, progress.spaceThumb,
      ).glyphs,
      ref: level.ref,
    };
    overlay.close();
    // The keyboard stays attached, and it is listened to for exactly one key:
    // Escape. A mode that is easy to enter and hard to leave is worse than one
    // that is hard to enter.
    attachTyping();
  }

  function stopReading(): void {
    if (reading === null) return;
    reading = null;
    attachTyping();
  }

  function readingFrame(r: Reading): { frame: FrameState; rail: RailState } {
    const offset = lectioOffset(r.state, VIRTUAL_W, tuning);
    // The pace, in the slot the WPM counter takes. Not a score and not a target:
    // there is no failure in this mode and nothing here may add one.
    const pace: Score = { wpm: r.state.wpm, accuracy: 1, medianLatencyMs: 0 };
    return {
      frame: {
        mode: 'lectio' as Mode,
        ref: r.ref,
        stage: level.stage,
        glyphs: r.glyphs,
        cursor: Math.min(lectioCursor(r.state), r.glyphs.length),
        blocked: false,
        score: pace,
        keyStats: {},
        layout: level.layout,
        spaceThumb: level.spaceThumb,
        keySet: level.keySet,
        scene: sceneStateFor(level, damage, cloud, tuning),
        followers: partyLine(),
        notice: noticeLines(),
      },
      rail: { offset, targetOffset: offset },
    };
  }

  /**
   * Travel to a passage from the map.
   *
   * Along a thread where there is one whose origin the player has finished --
   * which is a warp, and the phrase survives the cut -- and by opening the
   * chapter where there is not.
   */
  function travelTo(ref: string): void {
    if (loading) return;
    const target = routeRefFor(ref) ?? ref;
    const done = new Set(progress.completed.map(canonRef));
    const edge = route === null
      ? null
      : route.edges.find(
          (e) => e.kind === 'progression' && e.to === target && done.has(canonRef(e.from)),
        ) ?? null;
    if (edge === null) {
      goTo(positionOf(target), (message) => {
        overlay.showError(message);
      });
      return;
    }
    overlay.close();
    loading = true;
    void crossEdge(edge, false, positionOf(target), {})
      .catch((error: unknown) => {
        overlay.showError(String(error instanceof Error ? error.message : error));
        attachTyping();
      })
      .finally(() => {
        loading = false;
      });
  }

  /**
   * The room the player is standing in, for a rebuild *in place*.
   *
   * Death, "back to the start of this part", a stage change and a keyboard
   * change all reopen the part the player is already in. Inside a secret room
   * that has to reopen the *room*: rebuilding it as an ordinary passage would
   * drop the return frame on the floor and strand the player in Genesis 22 with
   * a stack nothing will ever unwind. A room that eats the level it interrupted
   * is worse than no room.
   */
  function hereOptions(): LevelOptions {
    const frame = level.flashback;
    if (frame === null) return {};
    const home = level.doorwayHome;
    return home === null ? { flashback: frame } : { flashback: frame, doorway: home };
  }

  function menuView(): MenuView {
    const stage = stages.length === 0 ? null : stageAt(stages, progress.stage);
    const last = stages[stages.length - 1];
    return {
      stage: progress.stage,
      stages: stages.map((s) => ({ stage: s.stage, description: s.description })),
      gilding: progress.gilding,
      where:
        `${chunkRef(level.bookTitle, level.chapter, level.chunk)} · ` +
        `${editionName(progress.translation)}`,
      stageLine:
        stage === null
          ? `Stage ${String(progress.stage)}`
          : `Stage ${String(stage.stage)} — ${stage.description}`,
      edition: progress.translation,
      book: level.bookTitle,
      chapter: level.chapter,
      layout: progress.layout,
      spaceThumb: progress.spaceThumb,
      cloudEnabled: progress.cloudEnabled,
      // The last stage the curriculum has, if it loaded. Said, never enforced:
      // the second translation is offered from the first evening, and locking it
      // behind this would make it invisible again.
      curriculumFinished: last !== undefined && progress.stage >= last.stage,
      history: progress.history,
    };
  }

  /**
   * The opening screen: the bumps on F and J, and one button.
   *
   * Typing is detached while it is up and handed back when it goes, which is
   * the same treatment every other panel gets -- the player cannot type into
   * the rail behind a dialogue he is reading.
   *
   * Reached from exactly two places: a record whose `firstRun` is still set,
   * and the menu. Nothing in the game raises it by itself.
   */
  function showOpening(): void {
    detachTyping();
    overlay.showOpening(() => {
      progress = withOpeningSeen(progress);
      saveProgress(progress);
      attachTyping();
    });
  }

  function openMenu(): void {
    // Reading stops when the menu opens. It is a sitting, not a setting, and one
    // that carried on silently behind a panel would come back at a pace the
    // player did not choose.
    stopReading();
    bookmark();
    overlay.openMenu(menuView());
    // After opening it, not before. Walking off an undismissed opening screen
    // into the menu counts that screen as read, and the way the overlay says so
    // is by running its completion -- which hands the keyboard back. The menu
    // needs it again, so this has the last word.
    detachTyping();
  }

  const overlay: Overlay = createOverlay({
    requestMenu: openMenu,
    /**
     * The card, on an evening he simply wants to look at his hands.
     *
     * Same treatment as the map: raised first, then the keyboard taken away,
     * because dismissing a panel hands it back and this one needs it withheld.
     */
    requestHands: () => {
      bookmark();
      overlay.showHands(handsView());
      detachTyping();
    },
    requestMap: () => {
      bookmark();
      overlay.showMap(routeView());
      // After raising it, for the same reason `openMenu` does: dismissing a
      // panel hands the keyboard back, and the map needs it withheld.
      detachTyping();
    },
    travel: (ref) => {
      // Same as the menu's jump: travelling the map is leaving the room.
      returnStack = [];
      travelTo(ref);
    },
    startReading,
    resume: () => {
      // Resuming out of a panel is resuming the game, not the reading. A player
      // who opened the menu mid-sitting and pressed Resume meant the rail.
      stopReading();
      attachTyping();
    },
    restart: () => {
      goTo(
        { book: level.bookTitle, chapter: level.chapter, unit: level.chunk.first },
        (message) => {
          overlay.showError(message);
        },
        true,
        hereOptions(),
      );
    },
    jump: (book, chapter) => {
      // Going somewhere else on purpose is leaving the room, not stepping out of
      // it: the level it interrupted is being abandoned too. Keeping the frame
      // would owe the player a journey back that nothing will ever make.
      returnStack = [];
      goTo({ book, chapter, unit: 1 }, (message) => {
        overlay.openMenu(menuView());
        overlay.showError(message);
      });
    },
    /**
     * The player chose which translation to type.
     *
     * A difficulty step said out loud, not a preference about wording -- see
     * docs/design/04-route.md#two-texts-and-the-second-act. It rebuilds the part
     * in place, keeping the verse, because the two texts are versified alike and
     * being thrown back to the top of the chapter for changing the prose would
     * be a cost the choice does not carry.
     *
     * Nothing about it touches the stage, the trailing window or the gate. The
     * same keys are lit in either text and the same accuracy is demanded of them;
     * a translation that could open a gate would be a way to be promoted for
     * typing different words rather than for typing the same ones better.
     */
    setEdition: (edition) => {
      if (edition === progress.translation) return;
      const previous = progress.translation;
      progress = { ...progress, translation: edition };
      goTo(
        { book: level.bookTitle, chapter: level.chapter, unit: verseUnder(level) },
        (message) => {
          // The other text has no file for this book. Put the record back rather
          // than leaving the menu claiming an edition the game is not typing.
          progress = { ...progress, translation: previous };
          saveProgress(progress);
          overlay.openMenu(menuView());
          overlay.showError(message);
        },
        false,
        hereOptions(),
      );
      overlay.openMenu(menuView());
    },
    setKeyboard: (layout, spaceThumb) => {
      progress = { ...progress, layout, spaceThumb };
      saveProgress(progress);
      // The ribbon carries a finger per glyph, so it has to be rebuilt; the
      // player keeps their place.
      goTo(
        { book: level.bookTitle, chapter: level.chapter, unit: verseUnder(level) },
        (message) => {
          overlay.showError(message);
        },
        false,
        hereOptions(),
      );
      overlay.openMenu(menuView());
    },
    /**
     * The player set their stage by hand.
     *
     * The honest route for someone who already types, and the reason gilding is
     * allowed to leave the mastery gate alone: skipping ahead is one control
     * the player operates, not a hidden consequence of a difficulty mode.
     * See docs/decisions/0008-gilding-permissive-input.md.
     */
    setStage: (stage) => {
      if (stages.length === 0) return;
      progress = setStage(progress, stage, stages);
      saveProgress(progress);
      // A stage change relights the page, so the ribbon has to be reclassified.
      // The player keeps their verse.
      goTo(
        { book: level.bookTitle, chapter: level.chapter, unit: verseUnder(level) },
        (message) => {
          overlay.showError(message);
        },
        false,
        hereOptions(),
      );
      overlay.openMenu(menuView());
    },
    /**
     * The player asked for gilding on or off. The only other caller is their
     * answer to the offer; nothing in the game turns it on by itself.
     */
    setGilding: (on) => {
      progress = setGilding(progress, on);
      saveProgress(progress);
      // The typing state carries the mode, so the part has to be rebuilt for it
      // to take effect. Same treatment as a keyboard change: keep the verse.
      goTo(
        { book: level.bookTitle, chapter: level.chapter, unit: verseUnder(level) },
        (message) => {
          overlay.showError(message);
        },
        false,
        hereOptions(),
      );
      overlay.openMenu(menuView());
    },
    setCloud: (enabled) => {
      progress = setCloudEnabled(progress, enabled);
      saveProgress(progress);
      // Disarmed mid-telegraph, it goes away at once rather than finishing the
      // approach it was already making. A switch that let one last strike
      // through would read as not having worked.
      if (!enabled) cloud = createCloud();
    },
    /**
     * The player asked to see the opening again.
     *
     * It re-arms the three notes as well as the screen, because the two most
     * likely people to ask for this are someone who clicked past it without
     * reading and someone who has just handed the keyboard to a friend -- and
     * the friend has not met a dim letter either.
     */
    replayFirstRun: () => {
      progress = replayFirstRun(progress);
      coach = createCoach(progress.notesSeen);
      saveProgress(progress);
      showOpening();
    },
    startOver: () => {
      clearProgress();
      returnStack = [];
      progress = DEFAULT_PROGRESS;
      coach = createCoach(progress.notesSeen);
      saveProgress(progress);
      // `resume` is false because the opening screen is going up over the top
      // of this: a fresh record is a first run, and handing the keyboard back
      // while that panel is open would send the next keystroke into the rail.
      goTo(
        progress.position,
        (message) => {
          overlay.showError(message);
        },
        false,
      );
      showOpening();
    },
    exportFile: () => {
      const url = URL.createObjectURL(exportProgress(progress));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'scriptorium-progress.json';
      link.click();
      URL.revokeObjectURL(url);
    },
    toggleAudio: () => {
      const on = !audio.on;
      // Synchronous, inside the click: `start()` constructs the AudioContext
      // before this handler returns, which is the only moment a browser will
      // allow it. The promise it hands back is only the resume.
      if (on) {
        audioOpened = true;
        void webAudio.start().catch(() => {
          /* The browser refused the context. The label still says what we asked
             for, and the next gesture will try again. */
          audioOpened = false;
        });
      }
      audio = setAudioOn(audio, on);
      overlay.showAudio(on);
    },
    importFile: (file) => {
      void importProgress(file)
        .then((imported) => {
          returnStack = [];
          progress = imported;
          saveProgress(progress);
          goTo(progress.position, (message) => {
            overlay.showError(message);
          });
        })
        .catch(() => {
          overlay.showError('That file is not a Scriptorium progress export.');
        });
    },
  });

  // --- input ----------------------------------------------------------------

  /**
   * Whether the browser has been asked for an audio device yet.
   *
   * Nothing is constructed before the player's first keystroke: a page sitting
   * untouched holds no `AudioContext` and makes no sound.
   */
  let audioOpened = false;

  /**
   * Open the audio device on a user gesture, which is the only moment a browser
   * will allow it.
   *
   * Audio ships **on** (`audio_default_on`), because it shipped off behind a
   * small toggle nobody found and the owner played for hours without hearing
   * one of the ten tunes: *"Music should be on, I haven't yet heard anything."*
   * The old default was avoiding the autoplay block, and a keystroke answers
   * that outright -- a keystroke *is* a user gesture, and in a typing game the
   * player's first act is always one. He cannot be startled by music he did not
   * just ask for by typing.
   *
   * Synchronous, inside the input handler, exactly as the toggle is inside its
   * click. The promise `start()` returns is only the resume; the context itself
   * is constructed before this function returns.
   * See docs/design/09-music.md#audio-is-on-and-starts-on-the-first-keystroke.
   */
  function openAudioDevice(): void {
    if (audioOpened || !audio.on) return;
    audioOpened = true;
    void webAudio.start().catch(() => {
      /* The browser refused. The next gesture will try again -- and it will,
         because the next gesture is the next key he presses. */
      audioOpened = false;
    });
  }

  function onInput(event: { type: string; value: string }): void {
    // Sound is on by default, and this is the gesture that lets it be heard.
    // Before anything else in the handler, so a keystroke swallowed by a warp
    // or a report card still counts as the permission it is.
    openAudioDevice();
    // Nothing reaches the rail mid-crossing. The phrase is the only thing on
    // screen and there is nothing to type on either side of it.
    if (warp !== null) return;
    if (reading !== null) {
      // Reading asks for nothing, so it listens for one key: the way out. Escape
      // backs out of the mode, which is what Escape means everywhere else too.
      if (event.type === 'command' && event.value === 'escape') stopReading();
      return;
    }
    if (level.reporting) {
      // Enter is the forward action and Escape backs out, everywhere. The
      // report card had them the other way round, and Escape additionally
      // meant "menu" in every other screen -- so the same key did two
      // different things depending on where you were.
      if (event.type === 'command') {
        if (event.value === 'enter') {
          // Forward from the checkpoint just reached, not back to the passage
          // just typed.
          goTo(progress.position, () => {
            /* the next chunk is definitionally reachable */
          });
        } else if (event.value === 'escape') {
          openMenu();
        }
        return;
      }
      if (event.value.toLowerCase() === 'r') {
        goTo({ book: level.bookTitle, chapter: level.chapter, unit: level.chunk.first }, () => {
          /* the chunk we just typed is definitionally reachable */
        });
      }
      return;
    }
    if (event.type === 'command') {
      if (event.value === 'escape') openMenu();
      // The doorway. Tab steps through one standing open, and steps back out of
      // a room already entered. Walking past it is typing on, which costs
      // nothing at all -- see `skipFlashback`.
      if (event.value === 'tab') {
        if (level.flashback === null) enterDoorway();
        else leaveDoorway();
      }
      return;
    }
    level.started = true;
    const before = level.typing;
    level.typing = applyKey(level.typing, event.value, tuning);
    coachKeystroke(before);
    stepArrival(before);
    scoreKeystroke(before, level.typing);
    resolveDefeats(before.cursor);
    bookmark();
    if (!atEnd(level.typing)) return;
    // The end of a secret room is the way out of it, not a report card: a room
    // that recorded a session would fold the passage the player never chose
    // into their history, and one that offered "next part" would carry them
    // deeper into the flashback instead of back to the level it interrupted.
    if (level.flashback === null) finishChunk();
    else leaveDoorway();
  }

  /**
   * One keystroke, as the first-run coach sees it.
   *
   * It reads the typing state and writes nothing back to it. Nothing in this
   * function can advance the cursor, charge a key, change what the passage asks
   * for or touch the score -- the only thing it can do is put one sentence
   * under the rail and remember that it has been said. A first run and a second
   * run through the same verse therefore produce identical statistics, which is
   * asserted in `core/onboarding.test.ts` rather than merely intended.
   *
   * The record is saved the moment a note is *shown*. A player who reads it and
   * closes the tab has been told; telling him again tomorrow would say the game
   * had not noticed.
   */
  function coachKeystroke(before: TypingState): void {
    const next = stepCoach(
      coach,
      {
        greyed: crossedGreyed(level.glyphs, before.cursor, level.typing.cursor),
        wrong: level.typing.blocked,
        space: onOwedSpace(level.glyphs, level.typing.cursor),
      },
      level.typing.correct > before.correct,
      tuning,
    );
    const spent = next.seen.length !== coach.seen.length;
    coach = next;
    if (!spent) return;
    progress = withNotesSeen(progress, coach.seen);
    saveProgress(progress);
  }

  /**
   * The words finished by the keystroke just applied, and what they fell.
   *
   * Called from `onInput` and from nowhere else, which is the whole design: a
   * monster can only ever be defeated by a keystroke, on the exact frame the
   * keystroke arrives rather than a frame later when the loop notices. Nothing
   * here can hurt the player and there is no branch in which a monster wins --
   * a monster is either felled or still standing, and standing costs nothing.
   * See docs/design/03-pacing.md#a-monster-is-a-word.
   *
   * More than one word can land on a keystroke: a greyed run auto-advances the
   * cursor past whatever it covers, spaces included, so the loop walks every
   * word crossed rather than assuming one.
   */
  function resolveDefeats(cursorBefore: number): void {
    const from = wordsDone(level.breaks, cursorBefore);
    const to = wordsDone(level.breaks, level.typing.cursor);
    for (let word = from; word < to; word += 1) {
      const standing = monstersAt(level.monsters, word);
      if (standing.length === 0) continue;
      const drops = new Set<string>();
      for (const monster of standing) {
        // From the level's own seeded stream, never `Math.random`: the same
        // passage typed again drops the same pots.
        const roll = dropsInkPot(level.dropRng, damage.combo, tuning);
        level.dropRng = roll.state;
        if (!roll.dropped) continue;
        drops.add(monster.id);
        // Granted as it is dropped rather than left lying to be collected. A
        // pickup that could be walked past would be a way to lose something by
        // being slow, and that is the one thing this game does not have.
        //
        // Through `applyItem`, which is the one place that knows what a pot is
        // worth. It was `restoreHeart` called directly here, which is how a pot
        // taken on full hearts came to do nothing at all: the cap swallowed it
        // and the platform had no idea. The pot is worth points instead now,
        // and the rule lives in core where the doc can reach it.
        const pot = applyItem({ ...leaf, damage }, 'ink_pot', pickupSite(), tuning);
        leaf = pot.player;
        damage = pot.player.damage;
      }
      const struck = strikeWord(level.monsters, word, drops);
      level.monsters = struck.entities;
      // One blow per monster felled, each with the verb its kind is felled by: a
      // skeleton is stomped and a bat is inked. Appended rather than replacing
      // whatever was already playing -- see the field's comment.
      //
      // And one cue per blow, named by that same verb. `StrikeVerb` and the two
      // strike cues in `core/sound.ts` are the same two words on purpose: the
      // verb is passed straight through rather than looked up, so the noise the
      // player hears cannot come to disagree with the blow he is watching. Both
      // rang a single `defeat` cue until now, which told the ear the stomp and
      // the throw were the same event when the whole point of the pair is that
      // they are not.
      for (const felled of struck.defeated) {
        const strike = beginStrike(felled);
        level.strikes.push(strike);
        cues.push(strike.verb);
      }
    }
  }

  /**
   * What one keystroke did to the page.
   *
   * A correct key wipes `smudge_decay_per_key` off the meter and extends the
   * combo; a wrong one adds this stage's smudge and breaks it. Only a *full*
   * meter costs a heart, which is the whole of
   * docs/decisions/0005-smudge-meter-over-per-typo-damage.md and the reason a
   * beginner erring on one key in ten is not killed four times a verse.
   */
  function scoreKeystroke(before: TypingState, after: TypingState): void {
    if (after.correct > before.correct) {
      damage = applyCorrect(damage, tuning);
      correctThisFrame = true;
      return;
    }
    if (after.keystrokes === before.keystrokes) return;
    const result = applyError(damage, level.stage, tuning);
    damage = result.damage;
    cues.push('error');
    if (result.heartsLost > 0) cues.push('smudge_full', 'heart_lost');
    if (isDead(damage)) die();
  }

  /**
   * Out of hearts.
   *
   * Back to the candle at the start of this part with a full set, exactly as
   * `damage.respawn` specifies: what death costs is the verse or two since the
   * checkpoint, and hearts are restored rather than carried, because respawning
   * on one heart into the passage that took the other two is how a checkpoint
   * becomes a wall.
   */
  function die(): void {
    damage = createDamage(tuning, maxHearts(tuning));
    cloud = createCloud();
    goTo(
      { book: level.bookTitle, chapter: level.chapter, unit: level.chunk.first },
      () => {
        /* the part we are standing in is definitionally reachable */
      },
      true,
      hereOptions(),
    );
  }

  // --- the only threat in the game -----------------------------------------

  /** Set by `scoreKeystroke`, read and cleared by `stepThreat`. */
  let correctThisFrame = false;

  /**
   * Advance the blot-cloud.
   *
   * It watches one number: how long since the last *correct* keystroke. A wrong
   * key does not drive it back -- mashing while hunting for a key is the
   * behaviour it exists to punish. There is no other time-based failure anywhere
   * in this program, and none may be added.
   * See docs/decisions/0004-idle-threat-not-speed-timer.md.
   */
  function stepThreat(dtMs: number): void {
    const wasStriking = cloud.strikes;
    const telegraphing = cloud.phase !== 'absent';
    const step = stepCloud(
      cloud,
      { stage: level.stage, correctKey: correctThisFrame, enabled: progress.cloudEnabled },
      dtMs,
      tuning,
    );
    correctThisFrame = false;
    cloud = step.cloud;
    if (!telegraphing && cloud.phase === 'approaching') cues.push('cloud');
    if (step.smudge > 0) {
      const hit = applyCloudStrike(damage, step.smudge, tuning);
      damage = hit.damage;
      if (cloud.strikes > wasStriking) cues.push('cloud');
      if (hit.heartsLost > 0) cues.push('smudge_full', 'heart_lost');
      if (isDead(damage)) die();
    }
  }

  // --- sound ---------------------------------------------------------------

  /**
   * One frame of sound.
   *
   * `stepSound` is asked on every frame whether the sound is on or not, because
   * it is the thing that holds the needle: skipping it while muted would leave
   * the sequencer at whatever tick it was stopped at and restart the hymn
   * mid-phrase. Muted, it simply returns no events.
   */
  function stepAudio(dtMs: number): void {
    const step = stepSound(
      audio,
      songbook,
      { theme: level.scene.theme, combo: damage.combo, cues },
      dtMs,
      tuning,
    );
    audio = step.state;
    cues = [];
    webAudio.play(step.events);
  }

  // A record still owing its opening screen does not get the keyboard yet; the
  // screen goes up below, once the canvas behind it is drawn and #boot is out
  // of the way, and hands the keyboard over when it is dismissed.
  if (!progress.firstRun) attachTyping();
  overlay.showAudio(audio.on);
  window.addEventListener('resize', () => {
    renderer.resize();
  });

  let previous = performance.now();
  const loop = (now: number): void => {
    const dtMs = Math.min(MAX_FRAME_MS, now - previous);
    previous = now;

    // Nothing in the world runs while a panel is up or the report card is
    // showing. In particular the cloud does not: opening the menu must never
    // cost the player a heart. A crossing and a reading sitting are their own
    // modes and run on their own clocks below.
    const paused = overlay.isOpen();
    const live = !level.reporting && level.started && !paused
      && warp === null && reading === null;
    if (live) {
      level.typing = tick(level.typing, dtMs);
      level.animMs += dtMs;
      // Bobbing, and running out the bursts a keystroke already started; a
      // finished burst is swept here. No monster is placed, moved or defeated
      // by this call -- only `resolveDefeats` can do any of that.
      level.monsters = stepMonsters(level.monsters, dtMs, tuning);
      level.scribe = stepEntities([level.scribe], dtMs)[0] ?? level.scribe;
      // Runs out the blows a keystroke already began, and drops each when its
      // verb's duration is spent. It can start one no more than it can end a
      // monster: only `resolveDefeats` does either.
      level.strikes = stepStrikes(level.strikes, dtMs, tuning);
      stepThreat(dtMs);
      // Word-driven, and only word-driven: the target is a function of how many
      // words are behind the cursor, and this only eases toward it.
      const camera = cameraTarget(level);
      const delta = camera - level.cameraX;
      level.cameraX = Math.abs(delta) < 1 ? camera : level.cameraX + delta * CAMERA_LERP;
    }

    // A crossing. Time is injected here and nowhere else in it: the whole state
    // is a function of the clock, `echoX` is carried through from the plan, and
    // nothing in the phase can move the held phrase.
    if (warp !== null && !paused) {
      warp.state = stepWarp(warp.state, dtMs, tuning);
      if (warpComplete(warp.state)) {
        const finished = warp;
        warp = null;
        finished.arrive();
      }
    }

    // A reading sitting. The ramp climbs while it is sustained and *holds* when
    // it is not -- it never falls back, because the one mode in the game that
    // exists for a day without pressure must not punish a reader for blinking.
    if (reading !== null) {
      reading.state = paused
        ? pauseLectio(reading.state, dtMs)
        : stepLectio(reading.state, dtMs, true, tuning);
      if (lectioFinished(reading.state, reading.glyphs.length)) stopReading();
    }

    const drawn = warp !== null
      ? warpFrame(warp)
      : reading !== null
        ? readingFrame(reading)
        : null;
    if (drawn === null) {
      const target = layoutRail(level.glyphs, level.typing.cursor, VIRTUAL_W, tuning).offset;
      level.rail = stepRail(level.rail, target, tuning);
      renderer.render(
        drawFrame(
          frameFor(
            level, damage, cloud, tuning, levelScore(), noteText(coach), arrivalText(),
            doorwayPrompt(), reportMemory(), partyLine(),
          ),
          level.rail,
          tuning,
        ),
      );
    } else {
      renderer.render(drawFrame(drawn.frame, drawn.rail, tuning));
    }
    stepAudio(live ? dtMs : 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.body.classList.add('ready');
  // Last, and only now: #boot covers the whole window until `ready` lands, so
  // an opening screen raised any earlier would be behind it. He should see the
  // page he is about to type on underneath the one thing he is being told.
  if (progress.firstRun) showOpening();
}

void boot().catch((error: unknown) => {
  const banner = document.getElementById('boot');
  if (banner !== null) banner.textContent = `could not start: ${String(error)}`;
});
