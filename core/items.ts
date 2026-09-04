/**
 * Ink pots, candles, gold leaf, quill nibs and wax seals.
 *
 * @doc docs/design/03-pacing.md#items
 *
 * The table in the pacing doc is compiled into `data/items.json`; this module is
 * the other half of it. Every row there has a function here, and
 * `items.test.ts` fails if the file ever grows a row this module cannot apply --
 * which is the only way a documented item can stay documented and imaginary.
 *
 * Two of the five are worth reading the reasoning for.
 *
 * **The candle is the important one.** It is a respawn point *and* the point at
 * which progress is written, so dying and closing the tab cost the same verse or
 * two. A beginner needs twenty minutes for a chapter; if either of those cost
 * him the chapter, the session ends and the habit may go with it.
 *
 * **The quill nib is expressed in stages, not in numbers of its own.** "Slower
 * cloud" is one `idle_step_ms` -- one stage's worth of tightening, given back.
 * "Wider tolerance" is one `smudge_per_error_step`. A permanent upgrade that
 * introduced its own constants would be a second difficulty curve running
 * alongside the documented one, tunable from nowhere.
 *
 * Randomness is injected, never ambient: every function that needs a draw takes
 * a `Random` and a state, and returns the advanced state. Same seed, same run,
 * per docs/architecture/core-purity.md.
 */

import { maxHearts, restoreHeart, lightCandle } from './damage.js';
import { comboForFullTempo } from './sequencer.js';
import { splitmix32 } from './rng.js';
import type { Random, RngDraw } from './rng.js';
import type { DamageState, PlayerState, Tuning, Upgrades } from './types.js';
import { tuningValue } from './tuning.js';

// --- the seeded PRNG --------------------------------------------------------

/**
 * The generator now lives in `core/rng.ts`, so that every core module draws
 * from the same stream. It is re-exported here because this module's callers
 * and tests have always got it from this file, and because an item roll and a
 * scene placement drawing from two different generators would be the exact bug
 * a single injected seam exists to prevent.
 */
export { splitmix32 } from './rng.js';
export type { Random, RngDraw } from './rng.js';

// --- the items --------------------------------------------------------------

export type ItemId = 'ink_pot' | 'candle' | 'gold_leaf' | 'quill_nib' | 'wax_seal';

/** Every item the game implements, in the order the pacing table lists them. */
export const ITEM_IDS: readonly ItemId[] = ['ink_pot', 'candle', 'gold_leaf', 'quill_nib', 'wax_seal'];

const IMPLEMENTED: ReadonlySet<string> = new Set<string>(ITEM_IDS);

/** True when `applyItem` knows what to do with this id. */
export function isItemId(id: string): id is ItemId {
  return IMPLEMENTED.has(id);
}

/** One row of `data/items.json`. */
export interface ItemDoc {
  readonly id: string;
  readonly name: string;
  readonly effect: string;
  readonly source: string;
}

/**
 * Parse `data/items.json`, which the platform loads.
 *
 * It throws on an item with no implementation rather than ignoring it. A
 * documented item that does nothing is worse than a missing one: the doc is
 * canonical here, so the code is what is wrong, and it should say so loudly.
 *
 * @throws if the file is malformed or names an item this module cannot apply
 */
export function loadItems(parsed: unknown): ItemDoc[] {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('items: expected the parsed items file, got a non-object');
  }
  const rows: unknown = (parsed as { items?: unknown }).items;
  if (!Array.isArray(rows)) throw new Error('items: parsed file has no "items" array');
  return rows.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) throw new Error(`items: items[${String(index)}] is not an object`);
    const row = raw as Record<string, unknown>;
    for (const field of ['id', 'name', 'effect', 'source']) {
      if (typeof row[field] !== 'string') {
        throw new Error(`items: items[${String(index)}].${field} is not a string`);
      }
    }
    const doc = row as unknown as ItemDoc;
    if (!isItemId(doc.id)) throw new Error(`items: "${doc.id}" is documented but not implemented`);
    return doc;
  });
}

// --- the player's belongings ------------------------------------------------

/** Which permanent upgrade a quill nib bought. */
export type QuillUpgrade = 'heart' | 'cloud' | 'smudge';

export const QUILL_UPGRADES: readonly QuillUpgrade[] = ['heart', 'cloud', 'smudge'];

/**
 * `Upgrades` and `PlayerState` are now declared in `core/types.ts` and
 * re-exported here.
 *
 * They were written locally because the pass that needed them could not edit
 * the shared types, and `GameState` carried `inventory: string[]` instead --
 * a list that can name a quill nib but cannot say that the nib bought a stage
 * of cloud patience, that gold leaf is a multiplier, or that a wax seal is a
 * chapter reference. `GameState` now holds a `PlayerState`, and this is the
 * same type it holds.
 */
export type { PlayerState, Upgrades } from './types.js';

export const NO_UPGRADES: Upgrades = Object.freeze({ heart: 0, cloud: 0, smudge: 0 });

/** A fresh player, holding nothing. */
export function createPlayer(damage: DamageState, rngState = 0): PlayerState {
  return {
    damage,
    upgrades: NO_UPGRADES,
    scoreMultiplier: 1,
    seals: [],
    checkpoint: null,
    rngState,
  };
}

/** Where an item was picked up, which is all a candle or a seal needs to know. */
export interface PickupSite {
  /** The chapter, e.g. "Genesis 1". */
  readonly ref: string;
  /** 1-based verse. */
  readonly unit: number;
  /** Verses in the chapter, so the candle lands on a real chunk boundary. */
  readonly unitCount: number;
}

/** What a pickup did, for the sound, the HUD and the tests. */
export interface PickupResult {
  readonly player: PlayerState;
  /** The upgrade a quill nib rolled, or null for every other item. */
  readonly upgrade: QuillUpgrade | null;
}

/**
 * Pick one up.
 *
 * Gold leaf adds a multiple rather than doubling: two leaves in a level is
 * triple score, not quadruple, so a lucky level cannot make every other level's
 * score meaningless.
 *
 * The quill nib's upgrade is drawn from the injected PRNG, so which one a
 * flashback room yields is fixed by the seed and replayable -- a nib that rolled
 * differently on a replay would make a recorded run unreproducible for the sake
 * of a surprise nobody asked for.
 */
export function applyItem(
  player: PlayerState,
  id: ItemId,
  at: PickupSite,
  tuning: Tuning,
  random: Random = splitmix32,
): PickupResult {
  if (id === 'ink_pot') {
    return {
      player: { ...player, damage: restoreHeart(player.damage, tuning, player.upgrades.heart) },
      upgrade: null,
    };
  }

  if (id === 'candle') {
    const checkpoint = lightCandle(at.ref, at.unit, at.unitCount, player.damage, tuning);
    return { player: { ...player, checkpoint }, upgrade: null };
  }

  if (id === 'gold_leaf') {
    return { player: { ...player, scoreMultiplier: player.scoreMultiplier + 1 }, upgrade: null };
  }

  if (id === 'quill_nib') {
    const draw = random(player.rngState);
    const upgrade = QUILL_UPGRADES[Math.floor(draw.value * QUILL_UPGRADES.length)] ?? 'heart';
    const upgrades: Upgrades = { ...player.upgrades, [upgrade]: player.upgrades[upgrade] + 1 };
    // An extra heart is worth nothing until it is filled, and the nib is a
    // reward: granting the heart with the capacity is what makes the pickup felt.
    const damage = upgrade === 'heart'
      ? { ...player.damage, hearts: Math.min(maxHearts(tuning, upgrades.heart), player.damage.hearts + 1) }
      : player.damage;
    return { player: { ...player, upgrades, damage, rngState: draw.state }, upgrade };
  }

  const seals = player.seals.includes(at.ref) ? player.seals : [...player.seals, at.ref];
  return { player: { ...player, seals }, upgrade: null };
}

// --- where items come from --------------------------------------------------

/**
 * A clean run from one candle to the next drops an ink pot.
 *
 * The streak is `candle_interval` verses, reusing the checkpoint spacing rather
 * than inventing a second rhythm: the reward arrives exactly where the player
 * has already been taught to expect something to happen.
 */
export function awardsInkPot(cleanVerseStreak: number, tuning: Tuning): boolean {
  const interval = Math.max(1, Math.trunc(tuningValue(tuning, 'candle_interval')));
  return cleanVerseStreak > 0 && cleanVerseStreak % interval === 0;
}

/**
 * The chance a felled monster leaves an ink pot, at this combo.
 *
 * `monster_drop_chance` at no combo, rising linearly to that plus
 * `combo_drop_bonus` at `comboForFullTempo` -- the same milestone the music
 * accelerates to, reused rather than reinvented so "a full combo" means one
 * thing in this game and not two.
 *
 * The combo only ever *adds*. Breaking it returns the chance to its base and
 * takes nothing away, which is the whole of why a combo is allowed to matter
 * here at all: a bonus that could be lost is a punishment wearing a reward's
 * clothes, and this game has exactly one pressure and it is not this one.
 * See docs/design/03-pacing.md#a-monster-is-a-word.
 */
export function inkPotChance(combo: number, tuning: Tuning): number {
  const base = tuningValue(tuning, 'monster_drop_chance');
  const bonus = tuningValue(tuning, 'combo_drop_bonus');
  const full = comboForFullTempo(tuning);
  const fraction = full > 0 ? Math.min(1, Math.max(0, combo / full)) : 1;
  return Math.min(1, Math.max(0, base + fraction * bonus));
}

/**
 * Roll one felled monster's drop.
 *
 * From the injected PRNG and the caller's state, never from an ambient
 * generator: a passage replayed from the same seed with the same words typed in
 * the same order must drop the same pots, or a recorded run is not a recording.
 * See docs/architecture/core-purity.md.
 */
export function dropsInkPot(
  rngState: number,
  combo: number,
  tuning: Tuning,
  random: Random = splitmix32,
): RngDraw & { dropped: boolean } {
  const draw = random(rngState);
  return { ...draw, dropped: draw.value < inkPotChance(combo, tuning) };
}

/**
 * Whether this verse offers a side-platform bonus word -- the way hidden gold
 * leaf and quill nibs are reached.
 *
 * The detour is itself practice, which is the only reason optional content is
 * allowed in a game whose player has limited patience for detours.
 */
export function offersBonusWord(rngState: number, tuning: Tuning, random: Random = splitmix32): RngDraw & { offered: boolean } {
  const draw = random(rngState);
  return { ...draw, offered: draw.value < tuningValue(tuning, 'bonus_word_chance') };
}

/** A perfect chapter: no heart lost and not one mistyped key. */
export function awardsWaxSeal(heartsLost: number, errors: number): boolean {
  return heartsLost === 0 && errors === 0;
}
