/**
 * Hearts, the smudge meter, and the candles you come back to.
 *
 * @doc docs/design/03-pacing.md#damage-is-metered
 *
 * The one rule this module exists to enforce: **a typo never costs a heart.**
 * Errors add to a meter, correct keystrokes wipe it back down, and only a *full*
 * meter costs a heart -- once, with the meter reset. The arithmetic is the
 * argument: a beginner errs on roughly one keystroke in ten, so a heart per typo
 * would kill him four or five times a verse, in exactly the fortnight he is most
 * likely to give up. See docs/decisions/0005-smudge-meter-over-per-typo-damage.md.
 *
 * At stage 0 the numbers make that concrete. Ten keystrokes at 90% accuracy is
 * one error (+12) and nine clean keys (-18): a net *fall* of six. The beginner's
 * meter drains faster than he can fill it, and it takes a genuinely bad patch --
 * errors bunched several in a row -- to threaten a heart at all. The tolerance
 * narrows by stage, so the same mechanic still means something at 95% accuracy
 * later without the rule ever changing.
 *
 * Checkpoints are the other half of the promise. `core/corpus.ts` already cuts a
 * chapter into `candle_interval` chunks; a candle stands at the first verse of
 * each chunk, and this module uses *that* notion rather than inventing a second
 * one. Death costs a verse or two, never the twenty-plus minutes a chapter takes
 * a beginner -- which is a session, and possibly the habit.
 */

import { chunkIndexFor, chunksFor } from './corpus.js';
import { tuningValue } from './tuning.js';
import type { Checkpoint, DamageState, Tuning } from './types.js';

// --- the meter --------------------------------------------------------------

/** Full hearts, an empty meter, no combo. */
export function createDamage(tuning: Tuning, hearts?: number): DamageState {
  return {
    hearts: hearts ?? tuningValue(tuning, 'hearts_start'),
    smudge: 0,
    combo: 0,
  };
}

/**
 * The most hearts this player can hold: the starting three, plus one for each
 * quill nib spent on health, capped by `hearts_max`. The cap is documented as
 * including upgrades, so the nib stops mattering rather than the cap moving.
 */
export function maxHearts(tuning: Tuning, heartNibs = 0): number {
  return Math.min(tuningValue(tuning, 'hearts_max'), tuningValue(tuning, 'hearts_start') + heartNibs);
}

/**
 * Smudge one mistyped key costs at this stage.
 *
 * `smudge_per_error_base + stage * smudge_per_error_step`, less one step per
 * quill nib spent on tolerance -- the nib buys back exactly one stage of
 * narrowing, which is what "wider smudge tolerance" means in a game where
 * tolerance is only ever measured in stages.
 */
export function smudgePerError(stage: number, tuning: Tuning, smudgeNibs = 0): number {
  const base = tuningValue(tuning, 'smudge_per_error_base');
  const step = tuningValue(tuning, 'smudge_per_error_step');
  return Math.max(0, base + (stage - smudgeNibs) * step);
}

/** What a step did to the player, so the caller can play a sound or flash. */
export interface DamageResult {
  readonly damage: DamageState;
  /** Hearts lost this step. Zero on all but the one keystroke that fills the meter. */
  readonly heartsLost: number;
}

/**
 * Add smudge, spilling into hearts.
 *
 * A full meter costs exactly one heart and resets to empty. The overflow is
 * forgiven rather than carried: carrying it would start the next meter part
 * full, so the keystroke after a heart loss would be worth more than any other
 * keystroke in the game, which is the death spiral this design exists to avoid.
 *
 * The loop is a loop only for completeness -- no single event in the game deals
 * `smudge_max` -- but a state that could silently hold a meter and a half is a
 * bug waiting for a set piece to find it.
 */
export function addSmudge(damage: DamageState, amount: number, tuning: Tuning): DamageResult {
  const max = tuningValue(tuning, 'smudge_max');
  let smudge = damage.smudge + Math.max(0, amount);
  let heartsLost = 0;
  while (smudge >= max && max > 0) {
    smudge -= max;
    heartsLost += 1;
  }
  // Forgive the overflow: see above.
  if (heartsLost > 0) smudge = 0;
  return {
    damage: { ...damage, smudge, hearts: Math.max(0, damage.hearts - heartsLost) },
    heartsLost,
  };
}

/**
 * One mistyped key. Adds this stage's smudge and breaks the combo.
 *
 * The cursor does not advance on a wrong key -- that is `core/typing.ts`'s job
 * and it is non-negotiable for habit formation -- so this is the *whole* cost of
 * an error, and it is a cost that clean typing undoes.
 */
export function applyError(
  damage: DamageState,
  stage: number,
  tuning: Tuning,
  smudgeNibs = 0,
): DamageResult {
  const result = addSmudge(damage, smudgePerError(stage, tuning, smudgeNibs), tuning);
  return { ...result, damage: { ...result.damage, combo: 0 } };
}

/**
 * One correct key. Wipes `smudge_decay_per_key` off the meter and extends the
 * combo. Clean typing cleans the page: the recovery arc is the lesson.
 */
export function applyCorrect(damage: DamageState, tuning: Tuning): DamageState {
  const decay = tuningValue(tuning, 'smudge_decay_per_key');
  return {
    ...damage,
    smudge: Math.max(0, damage.smudge - decay),
    combo: damage.combo + 1,
  };
}

/**
 * The blot-cloud's drip. The same meter, so a strike and a bad patch of typing
 * compound instead of being two separate healths to track.
 */
export function applyCloudStrike(damage: DamageState, smudge: number, tuning: Tuning): DamageResult {
  return addSmudge(damage, smudge, tuning);
}

/** An ink pot: one heart back, never past the cap. */
export function restoreHeart(damage: DamageState, tuning: Tuning, heartNibs = 0): DamageState {
  return { ...damage, hearts: Math.min(maxHearts(tuning, heartNibs), damage.hearts + 1) };
}

export function isDead(damage: DamageState): boolean {
  return damage.hearts <= 0;
}

/** The meter as a 0..1 fraction, for drawing it. */
export function smudgeFraction(damage: DamageState, tuning: Tuning): number {
  const max = tuningValue(tuning, 'smudge_max');
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, damage.smudge / max));
}

// --- candles ----------------------------------------------------------------

/**
 * `Checkpoint` is declared in `core/types.ts` and re-exported here.
 *
 * It was written locally because the pass that needed it could not edit the
 * shared types. It belongs there: `GameState` has to be able to name where the
 * player respawns, and a type that only this module could see meant the save
 * record and the respawn point were describable in two different vocabularies.
 */
export type { Checkpoint } from './types.js';

/**
 * The verses a candle stands at: the first verse of every candle-spaced chunk.
 *
 * Derived from `core/corpus.ts` rather than recomputed, so there is exactly one
 * definition of "every third verse" in the codebase and the checkpoint can never
 * drift away from the save point.
 */
export function candleUnits(unitCount: number, tuning: Tuning): number[] {
  return chunksFor(unitCount, tuning).map((chunk) => chunk.first);
}

/** True when a candle stands at this verse. */
export function isCandleUnit(unit: number, unitCount: number, tuning: Tuning): boolean {
  return candleUnits(unitCount, tuning).includes(unit);
}

/** Light the candle the player has just reached. */
export function lightCandle(
  ref: string,
  unit: number,
  unitCount: number,
  damage: DamageState,
  tuning: Tuning,
): Checkpoint {
  const chunks = chunksFor(unitCount, tuning);
  const chunkIndex = chunkIndexFor(chunks, unit);
  const chunk = chunks[chunkIndex];
  return {
    ref,
    unit: chunk === undefined ? unit : chunk.first,
    chunkIndex,
    damage,
  };
}

/**
 * Death. Back to the last candle with a full set of hearts and a clean page.
 *
 * Hearts are restored rather than carried: respawning on one heart into the
 * passage that just took the other two is how a checkpoint becomes a wall. What
 * death costs is the verse, and that is enough.
 */
export function respawn(
  checkpoint: Checkpoint,
  tuning: Tuning,
  heartNibs = 0,
): { checkpoint: Checkpoint; damage: DamageState } {
  return {
    checkpoint,
    damage: createDamage(tuning, maxHearts(tuning, heartNibs)),
  };
}
