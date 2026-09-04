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
 */

import { createRenderer, type Renderer } from './canvas_renderer.js';
import { attachKeyboard } from './keyboard_input.js';
import { createOverlay, type MenuView, type Overlay } from './overlay.js';
import { loadTuning } from '../../core/tuning.js';
import { keySetFor, loadStages, stageAt } from '../../core/curriculum.js';
import { classify } from '../../core/illumination.js';
import { applyKey, atEnd, createTypingState, score, tick } from '../../core/typing.js';
import { createRail, layoutRail, stepRail } from '../../core/rail.js';
import { VIRTUAL_W, drawFrame, type FrameState } from '../../core/draw.js';
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
  Glyph, Key, KeyboardLayout, RailState, Stage, Thumb, Tuning, TypingState,
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
}

function verseUnder(level: Level): number {
  const index = Math.min(level.typing.cursor, level.verseAt.length - 1);
  return level.verseAt[Math.max(0, index)] ?? level.chunk.first;
}

function frameFor(level: Level, tuning: Tuning): FrameState {
  const candle = `${String(level.chunkIndex + 1)}/${String(level.chunks.length)}`;
  return {
    mode: level.reporting ? 'report' : 'level',
    ref: `${level.bookTitle} ${String(level.chapter)}:${String(verseUnder(level))}  candle ${candle}`,
    stage: level.stage,
    glyphs: level.glyphs,
    cursor: level.typing.cursor,
    blocked: level.typing.blocked,
    score: score(level.typing, tuning),
    keyStats: level.typing.keyStats,
    layout: level.layout,
    spaceThumb: level.spaceThumb,
    keySet: level.keySet,
  };
}

// --- boot -------------------------------------------------------------------

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
        `${String(level.chunk.last)} · ${progress.translation} · candle ` +
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
        // "on to the next candle", exactly as the report card's footer says:
        // forward from the candle just lit, not back to the one just typed.
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
    level.typing = applyKey(level.typing, event.value, tuning);
    bookmark();
    if (atEnd(level.typing)) finishChunk();
  }

  attachTyping();
  window.addEventListener('resize', () => {
    renderer.resize();
  });

  let previous = performance.now();
  const loop = (now: number): void => {
    const dtMs = Math.min(MAX_FRAME_MS, now - previous);
    previous = now;

    if (!level.reporting && level.started && !overlay.isOpen()) {
      level.typing = tick(level.typing, dtMs);
    }
    const target = layoutRail(level.glyphs, level.typing.cursor, VIRTUAL_W, tuning).offset;
    level.rail = stepRail(level.rail, target, tuning);
    renderer.render(drawFrame(frameFor(level, tuning), level.rail, tuning));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.body.classList.add('ready');
}

void boot().catch((error: unknown) => {
  const banner = document.getElementById('boot');
  if (banner !== null) banner.textContent = `could not start: ${String(error)}`;
});
