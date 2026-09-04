/**
 * Boot, wiring, and the animation-frame loop.
 *
 * The only file that knows both halves of the program. It fetches the data the
 * core is forbidden to reach for, turns a passage into classified glyphs, feeds
 * keystrokes in and display lists out, and holds nothing that decides anything --
 * every rule lives in core/.
 */

import { createRenderer, type Renderer } from './canvas_renderer.js';
import { attachKeyboard } from './keyboard_input.js';
import { loadTuning } from '../../core/tuning.js';
import { keySetFor, loadStages } from '../../core/curriculum.js';
import { classify } from '../../core/illumination.js';
import { applyKey, atEnd, createTypingState, score, tick } from '../../core/typing.js';
import { createRail, layoutRail, stepRail } from '../../core/rail.js';
import { VIRTUAL_W, drawFrame, type FrameState } from '../../core/draw.js';
import { loadProgress, recordSession, saveProgress } from './local_storage.js';
import type { Glyph, Key, KeyboardLayout, RailState, Tuning, TypingState } from '../../core/types.js';

// --- the passage ------------------------------------------------------------

interface Section {
  readonly name: string;
  readonly units: readonly string[];
}

interface BookFile {
  readonly title: string;
  readonly edition: string;
  readonly sections: readonly Section[];
}

/**
 * Genesis 1:1-5, World English Bible, public domain.
 *
 * Hardcoded so the game is playable with nothing else present: `data/texts/` is
 * fetched, and `fetch` is blocked outright on `file://`. A tutor that cannot open
 * without a web server is a tutor the player cannot open.
 */
const FALLBACK_BOOK: BookFile = {
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

/** Candidate locations for the fetched corpus; the first that answers wins. */
const TEXT_PATHS: readonly string[] = [
  'data/texts/web/genesis.json',
  'data/texts/WEB/genesis.json',
  'data/texts/genesis.json',
];

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

async function fetchBook(): Promise<BookFile> {
  for (const path of TEXT_PATHS) {
    try {
      const parsed = await fetchJson(path);
      const book = parsed as BookFile;
      if (Array.isArray(book.sections) && book.sections.length > 0) return book;
    } catch {
      // Try the next candidate; the hardcoded chapter is the last resort.
    }
  }
  return FALLBACK_BOOK;
}

// --- the ribbon -------------------------------------------------------------

/**
 * One chapter as a single unbroken ribbon, with a verse number per glyph.
 *
 * Verses are joined by a space rather than wrapped into lines: the rail has no
 * lines, and the HUD reads the verse off the glyph under the cursor.
 */
function buildRibbon(section: Section, keySet: ReadonlySet<Key>, layout: KeyboardLayout): {
  glyphs: Glyph[];
  verseAt: number[];
} {
  const glyphs: Glyph[] = [];
  const verseAt: number[] = [];
  section.units.forEach((unit, index) => {
    const text = index === 0 ? unit : ` ${unit}`;
    for (const glyph of classify(text, keySet, layout)) {
      glyphs.push(glyph);
      verseAt.push(index + 1);
    }
  });
  return { glyphs, verseAt };
}

// --- the session ------------------------------------------------------------

interface Session {
  readonly title: string;
  readonly chapter: string;
  readonly glyphs: Glyph[];
  readonly verseAt: number[];
  readonly keySet: readonly Key[];
  readonly stage: number;
  readonly layout: KeyboardLayout;
  typing: TypingState;
  rail: RailState;
  reporting: boolean;
  /** The clock only runs once the player has actually started. */
  started: boolean;
}

function frameFor(session: Session, tuning: Tuning): FrameState {
  const verse = session.verseAt[Math.min(session.typing.cursor, session.verseAt.length - 1)] ?? 1;
  return {
    mode: session.reporting ? 'report' : 'level',
    ref: `${session.title} ${session.chapter} · v${String(verse)}`,
    stage: session.stage,
    glyphs: session.glyphs,
    cursor: session.typing.cursor,
    blocked: session.typing.blocked,
    score: score(session.typing, tuning),
    keyStats: session.typing.keyStats,
    layout: session.layout,
    keySet: session.keySet,
  };
}

function finish(session: Session, tuning: Tuning): void {
  if (session.reporting) return;
  session.reporting = true;
  const final = score(session.typing, tuning);
  saveProgress(
    recordSession(loadProgress(), {
      stage: session.stage,
      ref: `${session.title} ${session.chapter}`,
      wpm: final.wpm,
      accuracy: final.accuracy,
      keyStats: session.typing.keyStats,
    }),
  );
}

// --- boot -------------------------------------------------------------------

const MAX_FRAME_MS = 100;

async function boot(): Promise<void> {
  const surface = document.getElementById('stage');
  if (!(surface instanceof HTMLCanvasElement)) throw new Error('main: no #stage canvas');
  const renderer: Renderer = createRenderer(surface);

  const tuning = loadTuning(await fetchJsonOr('data/tuning.json', FALLBACK_TUNING));
  const progress = loadProgress();
  const layout: KeyboardLayout = progress.layout;

  const stage = progress.stage;
  let keySet: ReadonlySet<Key> = new Set(FALLBACK_KEY_SET);
  try {
    keySet = keySetFor(loadStages(await fetchJson('data/curriculum.json')), stage);
  } catch {
    // No curriculum file reachable: fall back to home row, which is stage 1 and
    // where a beginner starts anyway. Never guess a *larger* set than that --
    // the illumination invariant is the one thing that must not be approximated.
  }

  const book = await fetchBook();
  const section = book.sections[0];
  if (section === undefined) throw new Error('main: book has no sections');
  const { glyphs, verseAt } = buildRibbon(section, keySet, layout);

  const typing = createTypingState(glyphs);
  const session: Session = {
    title: book.title,
    chapter: section.name,
    glyphs,
    verseAt,
    keySet: [...keySet],
    stage,
    layout,
    typing,
    rail: createRail(layoutRail(glyphs, typing.cursor, VIRTUAL_W, tuning).offset),
    reporting: false,
    started: false,
  };

  attachKeyboard(window, (event) => {
    if (session.reporting) {
      if (event.type === 'command' && event.value === 'enter') {
        session.typing = createTypingState(session.glyphs);
        session.reporting = false;
        session.started = false;
      }
      return;
    }
    if (event.type === 'command') {
      if (event.value === 'escape') finish(session, tuning);
      return;
    }
    session.started = true;
    session.typing = applyKey(session.typing, event.value, tuning);
    if (atEnd(session.typing)) finish(session, tuning);
  });

  window.addEventListener('resize', () => renderer.resize());

  let previous = performance.now();
  const loop = (now: number): void => {
    const dtMs = Math.min(MAX_FRAME_MS, now - previous);
    previous = now;

    if (!session.reporting && session.started) session.typing = tick(session.typing, dtMs);
    const target = layoutRail(session.glyphs, session.typing.cursor, VIRTUAL_W, tuning).offset;
    session.rail = stepRail(session.rail, target, tuning);
    renderer.render(drawFrame(frameFor(session, tuning), session.rail, tuning));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.body.classList.add('ready');
}

void boot().catch((error: unknown) => {
  const banner = document.getElementById('boot');
  if (banner !== null) banner.textContent = `could not start: ${String(error)}`;
});
