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
 *
 * This module is also the *single* authority on which finger strikes which key.
 * `illumination.ts` used to carry a second, independent table; the two agreed by
 * luck and would have drifted the first time either was edited, and a wrong
 * finger taught for a year is not a bug that shows up as a failing test. There is
 * one table, here, beside the geometry that has to know the physical board
 * anyway, and `illumination.fingerFor` is a thin throwing wrapper over it.
 */

import type { Finger, Key, KeyboardLayout, Thumb } from './types.js';

/** One drawn key. Coordinates and sizes are in key units. */
export interface OverlayKey {
  readonly key: Key;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly finger: Finger;
}

export const FINGER_LABELS: Readonly<Record<Finger, string>> = {
  lp: 'L pinky', lr: 'L ring', lm: 'L mid', li: 'L index', lt: 'L thumb',
  rt: 'R thumb', ri: 'R index', rm: 'R mid', rr: 'R ring', rp: 'R pinky',
};

/**
 * Which thumb strikes the space bar, when the player has not said.
 *
 * Right, because a right-handed typist's right thumb is the one already resting
 * over the bar's centre, and because that is what the majority of touch-typing
 * courses teach. It is a default and not a fact: `Thumb` in `types.js` explains
 * why it has to be a preference at all.
 */
export const DEFAULT_SPACE_THUMB: Thumb = 'rt';

/**
 * Report-card column order: left hand outside-in, the thumb in the middle where
 * it physically sits, then right hand inside-out -- so the table reads the way
 * the hands sit on the board.
 *
 * Nine columns, not ten. Only one thumb is on the space bar, and rendering the
 * other would print a row of zeroes about a finger this game never asks for.
 * See docs/design/08-stats.md#the-report-card.
 */
export function reportFingers(spaceThumb: Thumb): readonly Finger[] {
  return ['lp', 'lr', 'lm', 'li', spaceThumb, 'ri', 'rm', 'rr', 'rp'];
}

/** The space bar. Its finger is the player's preference, not a table entry. */
const SPACE: Key = '<space>';

/**
 * The two shift keys.
 *
 * The curriculum names one, `<shift>`, because it teaches one skill; the board
 * has two, and which of them a capital is struck on is the whole content of
 * that skill. `<shift>` is therefore the *curriculum* key throughout core, and
 * `boardKeyFor` is the only place it becomes a left or a right one -- at the
 * point of drawing it.
 */
const SHIFT: Key = '<shift>';
const RIGHT_SHIFT: Key = '<rshift>';

function isLeftHand(finger: Finger): boolean {
  return finger.startsWith('l');
}

/**
 * Touch-typing finger assignment for the unshifted US ANSI main block, plus the
 * modifier tokens the curriculum and the overlay name. Standard home-row
 * discipline: index fingers take the two columns they stretch to, the pinkies
 * take everything outboard. This is anatomy, not tuning, so it lives in code.
 *
 * `<space>` is deliberately absent: see `DEFAULT_SPACE_THUMB`.
 */
const FINGER_BY_KEY: Readonly<Record<string, Finger>> = {
  '`': 'lp', '1': 'lp', 'q': 'lp', 'a': 'lp', 'z': 'lp',
  '<tab>': 'lp', '<caps>': 'lp', '<shift>': 'lp',
  '2': 'lr', 'w': 'lr', 's': 'lr', 'x': 'lr',
  '3': 'lm', 'e': 'lm', 'd': 'lm', 'c': 'lm',
  '4': 'li', '5': 'li', 'r': 'li', 't': 'li', 'f': 'li', 'g': 'li', 'v': 'li', 'b': 'li',
  '6': 'ri', '7': 'ri', 'y': 'ri', 'u': 'ri', 'h': 'ri', 'j': 'ri', 'n': 'ri', 'm': 'ri',
  '8': 'rm', 'i': 'rm', 'k': 'rm', ',': 'rm',
  '9': 'rr', 'o': 'rr', 'l': 'rr', '.': 'rr',
  '0': 'rp', '-': 'rp', '=': 'rp', 'p': 'rp', '[': 'rp', ']': 'rp',
  ';': 'rp', "'": 'rp', '/': 'rp', '#': 'rp', '\\': 'rp',
  '<backspace>': 'rp', '<enter>': 'rp', '<rshift>': 'rp',
};

/**
 * Which unshifted key produces each shifted character, on US ANSI.
 *
 * Deliberately the ANSI table for *every* layout, because
 * `docs/design/06-curriculum.md#keyboard-layout` is explicit that layout affects
 * the overlay and the finger mapping only, never which characters a stage
 * unlocks. A UK player must not reach stage 8 with a different set of live
 * characters than a US one. Where ISO genuinely moves a character to another
 * hand, `FINGER_OVERRIDES` corrects the finger without touching the key set.
 */
const SHIFTED_BASE: Readonly<Record<string, string>> = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-',
  '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
  '<': ',', '>': '.', '?': '/',
};

/**
 * Where the layouts disagree about fingers. On ANSI `\` sits above Enter and is
 * a right-pinky reach; on ISO it moves to the left of `z` and becomes a left-pinky
 * key. ISO also gives `#` its own key beside the apostrophe and swaps which keys
 * carry `@` and `"`. Same characters, different hands -- which is exactly the
 * kind of thing an overlay that ignored layout would teach wrongly and
 * permanently.
 */
const FINGER_OVERRIDES: Readonly<Record<KeyboardLayout, Readonly<Record<string, Finger>>>> = {
  ansi: {},
  iso: { '\\': 'lp', '|': 'lp', '#': 'rp', '~': 'rp', '@': 'rp', '"': 'lr' },
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
 * The physical key a character is struck on.
 *
 * Space has no printable form; a capital lives on its letter key; and a shifted
 * character lives on the unshifted key beneath it, so `:` is struck on `;`. The
 * shift itself is a separate keystroke on a separate key, so it is not part of
 * the answer -- this names the key the overlay should light, and nothing else.
 *
 * An angle-bracketed curriculum token (`<space>`, `<shift>`) is already a key
 * name and is returned unchanged.
 */
export function normaliseKey(ch: string): Key {
  if (ch === ' ') return SPACE;
  if (ch.length > 1) return ch;
  const lower = ch.toLowerCase();
  if (lower !== ch) return lower;
  return SHIFTED_BASE[ch] ?? ch;
}

/** True when producing this character also requires holding a shift. */
export function needsShift(ch: string): boolean {
  if (ch.length > 1) return false;
  return ch.toLowerCase() !== ch || SHIFTED_BASE[ch] !== undefined;
}

/**
 * True when a key exists on the physical board at all.
 *
 * Layout-independent on purpose: it answers "can this character be typed?",
 * which the curriculum forbids varying by layout. A curly quote or an em dash
 * answers false and can therefore only ever be greyed.
 */
export function isBoardKey(key: Key): boolean {
  return key === SPACE || FINGER_BY_KEY[key] !== undefined;
}

/**
 * The finger that should strike a key, or null if it is not on this board.
 *
 * The one authoritative answer in the codebase; everything else that needs a
 * finger calls through here. Accepts either a curriculum key or any character
 * that key produces, so `':'`, `'A'` and `'<shift>'` all resolve.
 *
 * @param spaceThumb which thumb the player uses on the space bar
 */
export function fingerForKey(
  key: Key,
  layout: KeyboardLayout,
  spaceThumb: Thumb = DEFAULT_SPACE_THUMB,
): Finger | null {
  if (key === ' ' || key === SPACE) return spaceThumb;
  const override = FINGER_OVERRIDES[layout][key];
  if (override !== undefined) return override;
  return FINGER_BY_KEY[key] ?? FINGER_BY_KEY[normaliseKey(key)] ?? null;
}

/**
 * The pinky that should hold shift while `finger` strikes the letter.
 *
 * Always the opposite hand, and this is the entire lesson of stage 8. A
 * two-finger typist shifts with the same hand, rolling the wrist off home
 * position for every capital; correct technique holds the far shift so the
 * striking hand never leaves its row. `docs/design/06-curriculum.md#stages`
 * calls it out as a skill that is taught rather than assumed, and a model that
 * could only name one key per character could not express it at all.
 *
 * Thumbs never take a shifted character -- space is the only thumb key -- so
 * the answer is a pinky either way.
 */
export function shiftFingerFor(finger: Finger): Finger {
  return isLeftHand(finger) ? 'rp' : 'lp';
}

/**
 * The physical key a stroke lands on, for the overlay to light.
 *
 * Two translations, both of which the drawn board needs and the curriculum does
 * not: a shifted character lives on the unshifted key beneath it (`:` on `;`),
 * and the one `<shift>` the curriculum teaches is whichever of the board's two
 * shift keys the stroke's finger belongs to. Lighting the near shift for a
 * left-hand capital would teach precisely the habit stage 8 exists to break.
 */
export function boardKeyFor(key: Key, finger: Finger): Key {
  if (key === SHIFT || key === RIGHT_SHIFT) return isLeftHand(finger) ? SHIFT : RIGHT_SHIFT;
  return normaliseKey(key);
}

/**
 * The curriculum key a drawn key belongs to: the inverse of `boardKeyFor`, and
 * only the right-hand shift is any different. The board draws two shift keys
 * and the curriculum teaches one, so dimming `<rshift>` until some `<rshift>`
 * is taught would grey out, for ever, half of what stage 8 unlocks.
 */
export function curriculumKeyFor(key: Key): Key {
  return key === RIGHT_SHIFT ? SHIFT : key;
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
export function overlayLayout(
  layout: KeyboardLayout,
  spaceThumb: Thumb = DEFAULT_SPACE_THUMB,
): OverlayKey[] {
  const out: OverlayKey[] = [];
  const rows = rowsFor(layout);
  for (let y = 0; y < rows.length; y++) {
    let x = 0;
    for (const token of (rows[y] ?? '').split(' ')) {
      const [name, wRaw, hRaw] = token.split('|');
      const w = wRaw === undefined ? 1 : Number.parseFloat(wRaw);
      const h = hRaw === undefined ? 1 : Number.parseFloat(hRaw);
      const key = name ?? SPACER;
      const finger = key === SPACER ? null : fingerForKey(key, layout, spaceThumb);
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
