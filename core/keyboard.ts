/**
 * The on-screen keyboard: physical key geometry, and which finger strikes what.
 *
 * @doc docs/design/06-curriculum.md#keyboard-layout
 *
 * The overlay is the first of the three crutches that break the looking-down
 * habit, so it has to be *right*: an overlay that disagrees with the keyboard
 * under his hands teaches the wrong finger for `'`, `#` and `\`, which is worse
 * than no overlay at all. Hence two layouts rather than one, and hence the finger
 * table living here beside the geometry that draws it.
 *
 * Geometry is returned in **key units** -- 1.0 is the width of a letter key --
 * with the origin at the top-left of the block. `draw.ts` scales and centres it.
 * Units rather than pixels because the two layouts must be interchangeable at any
 * size, and because the row-width arithmetic (every row sums to 15u on both
 * layouts) is checkable by eye in units and invisible in pixels.
 *
 * The rows are a data table, deliberately: a nested structure of literals would
 * be a page of numbers to misread, and the widths are keyboard facts, not tuning.
 */

import type { Finger, Key, KeyboardLayout } from './types.js';

/** One drawn key. Coordinates and sizes are in key units. */
export interface OverlayKey {
  readonly key: Key;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly finger: Finger;
}

/**
 * Report-card column order: left hand outside-in, then right hand inside-out, so
 * the table reads the way the hands sit on the board.
 */
export const FINGERS: readonly Finger[] = ['lp', 'lr', 'lm', 'li', 'lt', 'rt', 'ri', 'rm', 'rr', 'rp'];

export const FINGER_LABELS: Readonly<Record<Finger, string>> = {
  lp: 'L pinky', lr: 'L ring', lm: 'L mid', li: 'L index', lt: 'L thumb',
  rt: 'R thumb', ri: 'R index', rm: 'R mid', rr: 'R ring', rp: 'R pinky',
};

/**
 * Touch-typing finger assignment. Standard home-row discipline: index fingers
 * take the two columns they stretch to, the pinkies take everything outboard.
 *
 * Space is the right thumb. Both thumbs rest on it and either will do, but the
 * report card groups by finger and splitting 18% of all keystrokes across two
 * columns on a whim would make both columns lie.
 */
const FINGER_BY_KEY: Readonly<Record<string, Finger>> = {
  '`': 'lp', '1': 'lp', 'q': 'lp', 'a': 'lp', 'z': 'lp',
  '<tab>': 'lp', '<caps>': 'lp', '<shift>': 'lp',
  '2': 'lr', 'w': 'lr', 's': 'lr', 'x': 'lr',
  '3': 'lm', 'e': 'lm', 'd': 'lm', 'c': 'lm',
  '4': 'li', '5': 'li', 'r': 'li', 't': 'li', 'f': 'li', 'g': 'li', 'v': 'li', 'b': 'li',
  '<space>': 'rt',
  '6': 'ri', '7': 'ri', 'y': 'ri', 'u': 'ri', 'h': 'ri', 'j': 'ri', 'n': 'ri', 'm': 'ri',
  '8': 'rm', 'i': 'rm', 'k': 'rm', ',': 'rm',
  '9': 'rr', 'o': 'rr', 'l': 'rr', '.': 'rr',
  '0': 'rp', '-': 'rp', '=': 'rp', 'p': 'rp', '[': 'rp', ']': 'rp',
  ';': 'rp', "'": 'rp', '/': 'rp', '#': 'rp', '\\': 'rp',
  '<backspace>': 'rp', '<enter>': 'rp', '<rshift>': 'rp',
};

/**
 * Where the layouts disagree about fingers. On ANSI `\` sits above Enter and is
 * a right-pinky reach; on ISO it moves to the left of `z` and becomes a left-pinky
 * key. Same character, different hand -- which is exactly the kind of thing an
 * overlay that ignored layout would teach wrongly and permanently.
 */
const FINGER_OVERRIDES: Readonly<Record<KeyboardLayout, Readonly<Record<string, Finger>>>> = {
  ansi: {},
  iso: { '\\': 'lp' },
};

/**
 * Rows, top to bottom. A token is `key`, `key|width` or `key|width|height`;
 * width defaults to one unit. `_` is a spacer: it advances x and draws nothing.
 *
 * Every row sums to 15 units on both layouts, which is what keeps the block
 * rectangular without a second table of row offsets.
 */
const ANSI_ROWS: readonly string[] = [
  '` 1 2 3 4 5 6 7 8 9 0 - = <backspace>|2',
  '<tab>|1.5 q w e r t y u i o p [ ] \\|1.5',
  "<caps>|1.75 a s d f g h j k l ; ' <enter>|2.25",
  '<shift>|2.25 z x c v b n m , . / <rshift>|2.75',
  '_|3.75 <space>|6.25 _|5',
];

/**
 * ISO: a tall two-row Enter, `#` beside the apostrophe, and the extra `\` key
 * left of `z` that shrinks the left Shift. Those three differences are the whole
 * reason the layout is selectable -- an ANSI overlay teaches a UK typist to reach
 * for `#` with the wrong finger and to hit `\` with the left pinky's home key.
 */
const ISO_ROWS: readonly string[] = [
  '` 1 2 3 4 5 6 7 8 9 0 - = <backspace>|2',
  '<tab>|1.5 q w e r t y u i o p [ ] _|0.25 <enter>|1.25|2',
  "<caps>|1.75 a s d f g h j k l ; ' #",
  '<shift>|1.25 \\ z x c v b n m , . / <rshift>|2.75',
  '_|3.75 <space>|6.25 _|5',
];

const SPACER = '_';

/** Human-readable face legends for the bracketed key tokens. */
const LABELS: Readonly<Record<string, string>> = {
  '<tab>': 'tab', '<caps>': 'caps', '<shift>': 'shift', '<rshift>': 'shift',
  '<enter>': 'enter', '<backspace>': 'bksp', '<space>': 'space',
};

/** What to print on a key's face. */
export function keyLabel(key: Key): string {
  return LABELS[key] ?? key;
}

/**
 * The overlay key a character is struck on. Capitals live on the letter key (the
 * shift is a separate keystroke and a separate stage), and the space bar has no
 * printable form, so both need translating before anything can be highlighted.
 */
export function normaliseKey(ch: string): Key {
  if (ch === ' ') return '<space>';
  return ch.toLowerCase();
}

/** The finger that should strike a key, or null if it is not on this board. */
export function fingerForKey(key: Key, layout: KeyboardLayout): Finger | null {
  const k = normaliseKey(key);
  return FINGER_OVERRIDES[layout][k] ?? FINGER_BY_KEY[k] ?? null;
}

function rowsFor(layout: KeyboardLayout): readonly string[] {
  return layout === 'iso' ? ISO_ROWS : ANSI_ROWS;
}

/**
 * Every drawn key, in paint order, in key units.
 *
 * Keys with no finger assignment are dropped rather than defaulted: a key drawn
 * in some arbitrary finger's colour is a lie the player would learn.
 */
export function overlayLayout(layout: KeyboardLayout): OverlayKey[] {
  const out: OverlayKey[] = [];
  const rows = rowsFor(layout);
  for (let y = 0; y < rows.length; y++) {
    let x = 0;
    for (const token of (rows[y] ?? '').split(' ')) {
      const [name, wRaw, hRaw] = token.split('|');
      const w = wRaw === undefined ? 1 : Number.parseFloat(wRaw);
      const h = hRaw === undefined ? 1 : Number.parseFloat(hRaw);
      const key = name ?? SPACER;
      const finger = key === SPACER ? null : fingerForKey(key, layout);
      if (finger !== null) out.push({ key, x, y, w, h, finger });
      x += w;
    }
  }
  return out;
}

/** Bounding size of the whole block, in key units, so the caller can centre it. */
export function overlayExtent(layout: KeyboardLayout): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const k of overlayLayout(layout)) {
    w = Math.max(w, k.x + k.w);
    h = Math.max(h, k.y + k.h);
  }
  return { w, h };
}
