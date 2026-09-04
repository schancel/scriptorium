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
import { createOverlay, type MenuView, type Overlay } from './overlay.js';
import { loadTuning } from '../../core/tuning.js';
import { keySetFor, loadStages, stageAt } from '../../core/curriculum.js';
import { classify } from '../../core/illumination.js';
import { applyKey, atEnd, createTypingState, score, tick } from '../../core/typing.js';
import { createRail, layoutRail, stepRail } from '../../core/rail.js';
import {
  VIRTUAL_W, drawFrame, sceneLayout, type FrameState, type SceneCandle, type SceneState,
} from '../../core/draw.js';
import { SPRITE_SIZE } from '../../core/sprites.js';
import {
  createCloud, createEntity, stepCloud, stepEntities, type Entity,
} from '../../core/entities.js';
import {
  applyCloudStrike, applyCorrect, applyError, createDamage, isDead, maxHearts,
} from '../../core/damage.js';
import { draws, seedFrom } from '../../core/rng.js';
import { DEFAULT_THEME } from '../../core/worlds.js';
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
  loadBook,
  sectionFor,
} from '../../core/corpus.js';
import {
  DEFAULT_PROGRESS,
  type Position,
  type Progress,
  evaluatePromotion,
  promote,
  recordSession,
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
  BlotCloud, DamageState, Glyph, Key, KeyboardLayout, RailState, Stage, Thumb,
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
    candle_interval: 3, bonus_word_chance: 0.15, master_volume: 0.35, audio_default_on: 0,
    wpm_chars_per_word: 5, history_max_sessions: 500,
  },
};

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

async function fetchJsonOr(path: string, fallback: unknown): Promise<unknown> {
  try {
    return await fetchJson(path);
  } catch {
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
  if (canonicalBook(book) === FALLBACK_BOOK.title) return FALLBACK_BOOK;
  throw new Error(`no text for ${book} (${translation}) -- run \`make fetch\``);
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
 * Progress through the ribbon, in words, including the fraction of the word
 * currently under the cursor.
 *
 * The fraction is what makes the world move while a word is being typed rather
 * than lurching a whole stride when it ends. It is still word-driven -- a word
 * is worth exactly one stride however many letters it has.
 */
function wordProgress(breaks: readonly number[], cursor: number, count: number): number {
  let done = 0;
  let start = 0;
  let end = count;
  for (const at of breaks) {
    if (at < cursor) {
      done += 1;
      start = at + 1;
    } else {
      end = at;
      break;
    }
  }
  const span = end - start;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (cursor - start) / span)) : 0;
  return done + fraction;
}

/**
 * The idling monsters standing in one stretch of world.
 *
 * Their positions come from the seeded generator in `core/rng.ts`, keyed on the
 * passage, so the same part is decorated the same way on every reload without a
 * byte being stored -- and never from `Math.random`, which would make a replay
 * of a recorded run a different level.
 *
 * They face left, toward the oncoming scribe, and they never move. The scribe
 * arrives at them because he typed; they never arrive at him.
 */
function placeMonsters(seed: number, span: number, groundY: number): Entity[] {
  const count = Math.max(1, Math.round(span / MONSTER_SPACING));
  const rolls = draws(seed, count * DRAWS_PER_MONSTER);
  const out: Entity[] = [];
  for (let i = 0; i < count; i += 1) {
    const jitter = rolls[i * DRAWS_PER_MONSTER] ?? 0;
    const kind = (rolls[i * DRAWS_PER_MONSTER + 1] ?? 0) < 0.5 ? 'bat' : 'skeleton';
    const phase = rolls[i * DRAWS_PER_MONSTER + 2] ?? 0;
    const x = Math.round((i + 0.4 + jitter * 0.4) * MONSTER_SPACING);
    const y = groundY - SPRITE_SIZE - (kind === 'bat' ? BAT_LIFT : 0);
    out.push(createEntity(`${kind}-${String(i)}`, kind, x, y, phase * PHASE_SPREAD_MS, -1));
  }
  return out;
}

// --- which world a passage is set in ----------------------------------------

/**
 * One row of `data/scenes/bible.json`: a chapter range and the theme it wears.
 *
 * `core/scenes.ts` is specced in docs/design/05-scenery-warps.md and not yet
 * written; when it lands, this reader and `themeFor` move into it wholesale and
 * this file goes back to asking one question. Until then the scenery is still
 * *authored* rather than inferred, which is the part of that doc that matters:
 * a passage with no row gets the abbey, and nothing here guesses a theme from
 * the text.
 */
interface SceneRow {
  readonly book: string;
  readonly first: number;
  readonly last: number;
  readonly theme: string;
}

const RANGE = /^(.+?)\s+(\d+)(?:-(\d+))?$/;

function loadScenes(parsed: unknown): SceneRow[] {
  if (typeof parsed !== 'object' || parsed === null) return [];
  const rows: unknown = (parsed as { scenes?: unknown }).scenes;
  if (!Array.isArray(rows)) return [];
  const out: SceneRow[] = [];
  for (const raw of rows as readonly unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as { range?: unknown; theme?: unknown };
    if (typeof row.range !== 'string' || typeof row.theme !== 'string') continue;
    const match = RANGE.exec(row.range.trim());
    if (match === null) continue;
    const book = canonicalBook(match[1] ?? '');
    const first = Number(match[2]);
    const last = Number(match[3] ?? match[2]);
    if (book === null || !Number.isFinite(first) || !Number.isFinite(last)) continue;
    out.push({ book, first, last, theme: row.theme });
  }
  return out;
}

/** The documented fallback: any passage with no row is the abbey. */
function themeFor(scenes: readonly SceneRow[], book: string, chapter: number): string {
  const canonical = canonicalBook(book) ?? book;
  for (const row of scenes) {
    if (row.book === canonical && chapter >= row.first && chapter <= row.last) return row.theme;
  }
  return DEFAULT_THEME;
}

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

/** First live glyph at or after `from`; `glyphs.length` when there is none. */
function firstLiveAt(glyphs: readonly Glyph[], from: number): number {
  for (let i = Math.max(0, from); i < glyphs.length; i += 1) {
    if (glyphs[i]?.live === true) return i;
  }
  return glyphs.length;
}

/** Where in the ribbon a verse begins. */
function offsetOfUnit(verseAt: readonly number[], unit: number): number {
  const found = verseAt.indexOf(unit);
  return found < 0 ? 0 : found;
}

// --- the level --------------------------------------------------------------

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
  /** A theme id in `core/worlds.ts`, from the authored scene map. */
  readonly theme: string;
  /** Word-boundary indices into `glyphs`, so progress can be counted in strides. */
  readonly breaks: readonly number[];
  /** Virtual px from the candle at the start of this part to the one at its end. */
  readonly span: number;
  /** The two checkpoints bounding this part, in world x. */
  readonly candleXs: readonly number[];
  /** Standing scenery. Placed once, and never moved. */
  monsters: Entity[];
  scribe: Entity;
  /** Where the world has got to. A pure function of words completed, eased. */
  cameraX: number;
  /** Accumulated animation time, for art that flickers rather than moves. */
  animMs: number;
}

function verseUnder(level: Level): number {
  const index = Math.min(level.typing.cursor, level.verseAt.length - 1);
  return level.verseAt[Math.max(0, index)] ?? level.chunk.first;
}

/** Where the camera wants to be: one stride per word behind the cursor. */
function cameraTarget(level: Level): number {
  return wordProgress(level.breaks, level.typing.cursor, level.glyphs.length) * WORLD_STRIDE;
}

function candlesOf(level: Level): SceneCandle[] {
  return level.candleXs.map((x) => ({ x, lit: level.cameraX >= x - CANDLE_REACH }));
}

function sceneFor(
  level: Level,
  damage: DamageState,
  cloud: BlotCloud,
  tuning: Tuning,
): SceneState {
  return {
    theme: level.theme,
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
  };
}

function frameFor(
  level: Level,
  damage: DamageState,
  cloud: BlotCloud,
  tuning: Tuning,
): FrameState {
  const candle = `${String(level.chunkIndex + 1)}/${String(level.chunks.length)}`;
  return {
    mode: level.reporting ? 'report' : 'level',
    ref: `${level.bookTitle} ${String(level.chapter)}:${String(verseUnder(level))}  part ${candle}`,
    stage: level.stage,
    glyphs: level.glyphs,
    cursor: level.typing.cursor,
    blocked: level.typing.blocked,
    score: score(level.typing, tuning),
    keyStats: level.typing.keyStats,
    layout: level.layout,
    spaceThumb: level.spaceThumb,
    keySet: level.keySet,
    scene: sceneFor(level, damage, cloud, tuning),
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
  const parsed = await fetchJsonOr('data/themes.json', { themes: [] });
  let themes;
  try {
    themes = loadThemeTunes(parsed);
  } catch {
    return { library: createLibrary([]), themes: new Map<string, string>() };
  }
  const ids = [...new Set(themes.values())];
  const loaded = await Promise.all(
    ids.map(async (id): Promise<Tune | null> => {
      try {
        return loadTune(await fetchJson(`data/tunes/${id}.json`));
      } catch {
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

  const tuning = loadTuning(await fetchJsonOr('data/tuning.json', FALLBACK_TUNING));

  let stages: Stage[] = [];
  try {
    stages = loadStages(await fetchJson('data/curriculum.json'));
  } catch {
    // No curriculum file reachable: fall back to home row, which is stage 1 and
    // where a beginner starts anyway. Never guess a *larger* set than that --
    // the illumination invariant is the one thing that must not be approximated.
  }

  // The authored scene map. Unreachable, it is an empty list and every passage
  // wears the abbey -- which is the documented fallback, not a degraded mode.
  const scenes: SceneRow[] = loadScenes(await fetchJsonOr('data/scenes/bible.json', null));

  const songbook = await loadSongbook();
  const webAudio: WebAudio = createWebAudio(tuning);
  let audio: AudioState = createAudio(tuning);
  /** Cues raised since the last frame of sound. Drained by the loop. */
  let cues: Cue[] = [];

  // Hearts and the meter live above the level, because they are the player's and
  // not the passage's: finishing a part must not quietly hand back a heart.
  let damage: DamageState = createDamage(tuning);
  let cloud: BlotCloud = createCloud();

  function keySetAt(stage: number): ReadonlySet<Key> {
    return stages.length === 0 ? new Set(FALLBACK_KEY_SET) : keySetFor(stages, stage);
  }

  function stageKeysAt(stage: number): readonly Key[] {
    return stages.length === 0 ? [] : stageAt(stages, stage).keys;
  }

  let progress: Progress = loadProgress();

  /**
   * Open a chunk. `at` overrides the bookmark -- used by "type it again" and by
   * the menu's jump -- and defaults to wherever the record says the player is.
   *
   * @throws if the book cannot be loaded, so the menu can say so rather than
   *         silently landing the player somewhere they did not ask for
   */
  async function buildLevel(at: Position): Promise<Level> {
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
    const resumeAt = firstLiveAt(glyphs, offsetOfUnit(verseAt, Math.max(chunk.first, at.unit)));
    const base = createTypingState(glyphs);
    const typing = resumeAt <= base.cursor ? base : { ...base, cursor: resumeAt };

    const theme = themeFor(scenes, book.title, chapter);
    const layout = sceneLayout(theme, tuning);
    const breaks = wordBreaks(glyphs);
    // One stride per word, and the part's far candle stands at the end of them.
    const span = (breaks.length + 1) * WORLD_STRIDE;
    const seed = seedFrom(`${book.title} ${String(chapter)} ${String(chunkIndex)}`);

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
      layout: progress.layout,
      spaceThumb: progress.spaceThumb,
      typing,
      rail: createRail(layoutRail(glyphs, typing.cursor, VIRTUAL_W, tuning).offset),
      reporting: false,
      started: false,
      bookmark: verseAt[typing.cursor] ?? chunk.first,
      theme,
      breaks,
      span,
      // The candle behind him is the checkpoint he is standing on; the one ahead
      // is the next, and it lights as he reaches it.
      candleXs: [0, span],
      monsters: placeMonsters(seed, span, layout.groundY),
      scribe: createEntity('scribe', 'scribe', layout.scribeX, layout.groundY - SPRITE_SIZE),
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
      saveProgress(progress);
      detachTyping();
      // The report card is already on the canvas behind this; dismissing the
      // notice hands the keyboard back and reveals it.
      overlay.showPromotion(promotion, attachTyping);
      return;
    }
    saveProgress(progress);
  }

  // --- navigation -----------------------------------------------------------

  let loading = false;

  /**
   * Open somewhere else. `resume` is false only for a change that leaves the
   * menu up -- handing the keyboard back while a panel is open would send the
   * player's next keystroke into the rail behind it.
   */
  function goTo(at: Position, onError: (message: string) => void, resume = true): void {
    if (loading) return;
    loading = true;
    void buildLevel(at)
      .then((next) => {
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

  function menuView(): MenuView {
    const stage = stages.length === 0 ? null : stageAt(stages, progress.stage);
    return {
      where:
        `${level.bookTitle} ${String(level.chapter)}:${String(level.chunk.first)}-` +
        `${String(level.chunk.last)} · ${progress.translation} · part ` +
        `${String(level.chunkIndex + 1)} of ${String(level.chunks.length)}`,
      stageLine:
        stage === null
          ? `Stage ${String(progress.stage)}`
          : `Stage ${String(stage.stage)} — ${stage.description}`,
      edition: progress.translation,
      book: level.bookTitle,
      chapter: level.chapter,
      layout: progress.layout,
      spaceThumb: progress.spaceThumb,
      history: progress.history,
    };
  }

  function openMenu(): void {
    bookmark();
    detachTyping();
    overlay.openMenu(menuView());
  }

  const overlay: Overlay = createOverlay({
    requestMenu: openMenu,
    resume: attachTyping,
    restart: () => {
      goTo(
        { book: level.bookTitle, chapter: level.chapter, unit: level.chunk.first },
        (message) => {
          overlay.showError(message);
        },
      );
    },
    jump: (edition, book, chapter) => {
      const previous = progress.translation;
      progress = { ...progress, translation: edition };
      goTo({ book, chapter, unit: 1 }, (message) => {
        progress = { ...progress, translation: previous };
        overlay.openMenu(menuView());
        overlay.showError(message);
      });
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
      );
      overlay.openMenu(menuView());
    },
    startOver: () => {
      clearProgress();
      progress = DEFAULT_PROGRESS;
      saveProgress(progress);
      goTo(progress.position, (message) => {
        overlay.showError(message);
      });
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
        void webAudio.start().catch(() => {
          /* The browser refused the context. The label still says what we asked
             for, and the next gesture will try again. */
        });
      }
      audio = setAudioOn(audio, on);
      overlay.showAudio(on);
    },
    importFile: (file) => {
      void importProgress(file)
        .then((imported) => {
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

  function onInput(event: { type: string; value: string }): void {
    if (level.reporting) {
      if (event.type !== 'command') return;
      if (event.value === 'enter') {
        // "type it again", exactly as the report card's footer offers.
        goTo({ book: level.bookTitle, chapter: level.chapter, unit: level.chunk.first }, () => {
          /* the chunk we just typed is definitionally reachable */
        });
      } else if (event.value === 'escape') {
        // "next part", exactly as the report card's footer says: forward from
        // the checkpoint just reached, not back to the passage just typed.
        goTo(progress.position, () => {
          /* likewise */
        });
      }
      return;
    }
    if (event.type === 'command') {
      if (event.value === 'escape') openMenu();
      return;
    }
    level.started = true;
    const before = level.typing;
    level.typing = applyKey(level.typing, event.value, tuning);
    scoreKeystroke(before, level.typing);
    bookmark();
    if (atEnd(level.typing)) finishChunk();
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
    goTo({ book: level.bookTitle, chapter: level.chapter, unit: level.chunk.first }, () => {
      /* the part we are standing in is definitionally reachable */
    });
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
      { stage: level.stage, correctKey: correctThisFrame, enabled: true },
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
      { theme: level.theme, combo: damage.combo, cues },
      dtMs,
      tuning,
    );
    audio = step.state;
    cues = [];
    webAudio.play(step.events);
  }

  attachTyping();
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
    // cost the player a heart.
    const live = !level.reporting && level.started && !overlay.isOpen();
    if (live) {
      level.typing = tick(level.typing, dtMs);
      level.animMs += dtMs;
      level.monsters = stepEntities(level.monsters, dtMs);
      level.scribe = stepEntities([level.scribe], dtMs)[0] ?? level.scribe;
      stepThreat(dtMs);
      // Word-driven, and only word-driven: the target is a function of how many
      // words are behind the cursor, and this only eases toward it.
      const camera = cameraTarget(level);
      const delta = camera - level.cameraX;
      level.cameraX = Math.abs(delta) < 1 ? camera : level.cameraX + delta * CAMERA_LERP;
    }

    const target = layoutRail(level.glyphs, level.typing.cursor, VIRTUAL_W, tuning).offset;
    level.rail = stepRail(level.rail, target, tuning);
    renderer.render(drawFrame(frameFor(level, damage, cloud, tuning), level.rail, tuning));
    stepAudio(live ? dtMs : 0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.body.classList.add('ready');
}

void boot().catch((error: unknown) => {
  const banner = document.getElementById('boot');
  if (banner !== null) banner.textContent = `could not start: ${String(error)}`;
});
