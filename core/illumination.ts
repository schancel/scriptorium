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

import type { Finger, Glyph, Key, KeyboardLayout, Thumb } from './types.js';
import { DEFAULT_SPACE_THUMB, fingerForKey, isBoardKey, needsShift, normaliseKey } from './keyboard.js';

/**
 * The space bar, live from stage 0: a thumb key and ~18% of all keystrokes.
 *
 * It classifies live like anything else, but it prints nothing, so `draw.ts`
 * has to mark it or a beginner cannot see that a keystroke is owed at all --
 * `docs/design/02-rail.md#the-space-affordance`. Which thumb it is credited to
 * is the player's preference, not a fact about the key.
 */
const SPACE: Key = '<space>';

/** Either shift. Capitals need it, which is why they stay greyed until stage 8. */
const SHIFT: Key = '<shift>';

/**
 * Every key a character needs, primary key last.
 *
 * A character the curriculum names outright (`:` at stage 8) needs only itself;
 * a capital or other shifted character needs shift plus its base key. `null`
 * means the character has no keyboard production we know of -- a curly quote,
 * an em dash -- and it can only ever be greyed.
 *
 * The physical board is `keyboard.ts`'s business, so the questions "which key
 * makes this character" and "does it take a shift" are asked of it rather than
 * answered again here. There used to be a second copy of both tables in this
 * file; they agreed by luck and one edit would have parted them.
 */
function requiredKeys(ch: string, keySet: ReadonlySet<Key>): readonly Key[] | null {
  if (ch === ' ') return [SPACE];
  if (keySet.has(ch)) return [ch];
  const base = normaliseKey(ch);
  if (!isBoardKey(base)) return null;
  return needsShift(ch) ? [SHIFT, base] : [base];
}

/**
 * The finger that should strike a key.
 *
 * A throwing wrapper over `keyboard.fingerForKey`, which holds the one finger
 * table in the codebase. Live glyphs are guaranteed to have a mapping, so a
 * missing one here is a programming error rather than anything a player can
 * cause -- hence a throw rather than a null the caller would have to carry.
 *
 * @param key    a curriculum key, or any character it can produce
 * @param layout the player's physical keyboard; affects nothing but the answer
 *               to this question
 * @param spaceThumb which thumb the player uses on the space bar
 * @throws if the key has no mapping
 */
export function fingerFor(
  key: Key,
  layout: KeyboardLayout,
  spaceThumb: Thumb = DEFAULT_SPACE_THUMB,
): Finger {
  const finger = fingerForKey(key, layout, spaceThumb);
  if (finger === null) throw new Error(`illumination: no finger mapping for key "${key}"`);
  return finger;
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
 * @param spaceThumb which thumb the player uses on the space bar; likewise only
 *                   ever changes the finger, never the classification
 */
export function classify(
  text: string,
  keySet: ReadonlySet<Key>,
  layout: KeyboardLayout,
  spaceThumb: Thumb = DEFAULT_SPACE_THUMB,
): Glyph[] {
  const glyphs: Glyph[] = [];
  for (const ch of text) {
    const required = requiredKeys(ch, keySet);
    const key = required === null ? undefined : required[required.length - 1];
    const live = required !== null && key !== undefined && required.every((k) => keySet.has(k));
    if (!live || key === undefined) {
      glyphs.push({ ch, live: false, key: null, finger: null });
    } else {
      glyphs.push({ ch, live: true, key, finger: fingerFor(key, layout, spaceThumb) });
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
