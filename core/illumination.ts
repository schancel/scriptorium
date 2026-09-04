/**
 * Illumination: classifying real text against the current stage's key set.
 *
 * @doc docs/design/01-illumination.md#classification
 *
 * The whole verse is always shown. Each character is either *live* -- every key
 * it needs has been taught, so the player must strike it -- or *greyed*, in
 * which case it is dimmed and the cursor snaps past it.
 *
 * The invariant this file exists to hold: no glyph marked live may require a
 * key outside the stage's key set. One leaked `z` at stage 2 and the player is
 * hunting for it, which is the exact habit the game is built to remove.
 */

import type { Finger, Glyph, Key, KeyboardLayout } from './types.js';

/** The space bar, live from stage 0: a thumb key and ~18% of all keystrokes. */
const SPACE: Key = '<space>';

/** Either shift. Capitals need it, which is why they stay greyed until stage 8. */
const SHIFT: Key = '<shift>';

/**
 * Both thumbs rest on the space bar and either may strike it, so no mapping
 * from `(key, layout)` alone can name the right one. The report card needs a
 * single column, so space is attributed to the right thumb by convention.
 */
const SPACE_FINGER: Finger = 'rt';

/**
 * Likewise for shift: correct two-handed shifting uses the pinky *opposite* the
 * letter's hand, which depends on the letter and not on the key. Reported as a
 * pinky; `docs/design/06-curriculum.md#stages` covers the skill itself.
 */
const SHIFT_FINGER: Finger = 'lp';

/**
 * Standard touch-typing assignment for the unshifted US ANSI main block. This
 * is anatomy, not a tunable, so it lives in code rather than the tuning table.
 */
const BASE_KEY_FINGER: Readonly<Record<string, Finger>> = {
  '`': 'lp', '1': 'lp', 'q': 'lp', 'a': 'lp', 'z': 'lp',
  '2': 'lr', 'w': 'lr', 's': 'lr', 'x': 'lr',
  '3': 'lm', 'e': 'lm', 'd': 'lm', 'c': 'lm',
  '4': 'li', 'r': 'li', 'f': 'li', 'v': 'li',
  '5': 'li', 't': 'li', 'g': 'li', 'b': 'li',
  '6': 'ri', 'y': 'ri', 'h': 'ri', 'n': 'ri',
  '7': 'ri', 'u': 'ri', 'j': 'ri', 'm': 'ri',
  '8': 'rm', 'i': 'rm', 'k': 'rm', ',': 'rm',
  '9': 'rr', 'o': 'rr', 'l': 'rr', '.': 'rr',
  '0': 'rp', 'p': 'rp', ';': 'rp', '/': 'rp',
  '-': 'rp', '=': 'rp', '[': 'rp', ']': 'rp', '\\': 'rp', "'": 'rp',
};

/**
 * Which unshifted key produces each shifted character. Deliberately the US ANSI
 * table for *every* layout: the curriculum doc is explicit that layout affects
 * the overlay and finger mapping only, never the illumination sets. A UK player
 * must not unlock a different set of characters at stage 8 than a US one.
 */
const SHIFTED_BASE: Readonly<Record<string, string>> = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5',
  '^': '6', '&': '7', '*': '8', '(': '9', ')': '0', '_': '-',
  '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'",
  '<': ',', '>': '.', '?': '/',
};

/**
 * Where ISO differs from ANSI for the report card's per-finger columns. ISO
 * moves the backslash key beside the left shift, gives `#` its own key by the
 * apostrophe, and swaps which keys carry `@` and `"`.
 */
const ISO_FINGER_OVERRIDES: Readonly<Record<string, Finger>> = {
  '\\': 'lp',
  '|': 'lp',
  '#': 'rp',
  '~': 'rp',
  '@': 'rp',
  '"': 'lr',
};

/**
 * Every key a character needs, primary key last.
 *
 * A character the curriculum names outright (`:` at stage 8) needs only itself;
 * a capital or other shifted character needs shift plus its base key. `null`
 * means the character has no keyboard production we know of -- a curly quote,
 * an em dash -- and it can only ever be greyed.
 */
function requiredKeys(ch: string, keySet: ReadonlySet<Key>): readonly Key[] | null {
  if (ch === ' ') return [SPACE];
  if (keySet.has(ch)) return [ch];
  if (BASE_KEY_FINGER[ch] !== undefined) return [ch];
  const lower = ch.toLowerCase();
  if (lower !== ch && BASE_KEY_FINGER[lower] !== undefined) return [SHIFT, lower];
  const base = SHIFTED_BASE[ch];
  if (base !== undefined) return [SHIFT, base];
  return null;
}

/**
 * The finger that should strike a key.
 *
 * @param key   a curriculum key, or any character it can produce
 * @param layout the player's physical keyboard; affects nothing but the answer
 *               to this question
 * @throws if the key has no mapping, which is a programming error rather than
 *         something a player can cause
 */
export function fingerFor(key: Key, layout: KeyboardLayout): Finger {
  if (key === SPACE) return SPACE_FINGER;
  if (key === SHIFT) return SHIFT_FINGER;
  if (layout === 'iso') {
    const override = ISO_FINGER_OVERRIDES[key];
    if (override !== undefined) return override;
  }
  const direct = BASE_KEY_FINGER[key];
  if (direct !== undefined) return direct;
  const lower = key.toLowerCase();
  if (lower !== key) {
    const asLetter = BASE_KEY_FINGER[lower];
    if (asLetter !== undefined) return asLetter;
  }
  const base = SHIFTED_BASE[key];
  if (base !== undefined) {
    const viaShift = BASE_KEY_FINGER[base];
    if (viaShift !== undefined) return viaShift;
  }
  throw new Error(`illumination: no finger mapping for key "${key}"`);
}

/**
 * Classify a run of text against a stage's key set.
 *
 * The text is never filtered or rewritten -- see
 * `docs/decisions/0003-illumination-over-corpus-filtering.md`. Every character
 * comes back, in order, marked live or greyed.
 *
 * @param text   the passage exactly as printed
 * @param keySet everything typable at the current stage, from `keySetFor`
 * @param layout used only to name the finger on live glyphs
 */
export function classify(text: string, keySet: ReadonlySet<Key>, layout: KeyboardLayout): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const ch of text) {
    const required = requiredKeys(ch, keySet);
    const key = required === null ? undefined : required[required.length - 1];
    const live = required !== null && key !== undefined && required.every((k) => keySet.has(k));
    if (!live || key === undefined) {
      glyphs.push({ ch, live: false, key: null, finger: null });
    } else {
      glyphs.push({ ch, live: true, key, finger: fingerFor(key, layout) });
    }
  }
  return glyphs;
}

/**
 * The fraction of a classified passage the player actually has to type.
 *
 * This is the density number the curriculum's stage boundaries are judged
 * against -- see `docs/design/01-illumination.md#density`. Empty text is 0.
 */
export function coverage(glyphs: readonly Glyph[]): number {
  if (glyphs.length === 0) return 0;
  let live = 0;
  for (const g of glyphs) if (g.live) live += 1;
  return live / glyphs.length;
}
