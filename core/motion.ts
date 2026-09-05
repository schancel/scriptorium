/**
 * What moves, and how much.
 *
 * @doc docs/design/12-motion-and-comfort.md#what-reduced-motion-changes
 *
 * Two questions land in this module, and they are the same question asked from
 * opposite ends:
 *
 *  - **Reduced motion.** The player, or his operating system, has asked the game
 *    to stop sliding things past a fixed gaze point. The rail is close to a
 *    laboratory stimulus for motion adaptation -- a held fixation, continuous
 *    unidirectional scroll, three parallax layers at differing rates, sustained
 *    for as long as anyone will practise -- and the owner reported the
 *    aftereffect that produces. See docs/decisions/0011-respect-reduced-motion.md.
 *  - **Held scenes.** The *passage* has asked for the same thing, because
 *    nothing in it travels. The serpent and the woman are talking; sliding a
 *    landscape past that is the game insisting on movement the text does not
 *    have. See
 *    docs/design/05-scenery-warps.md#held-scenes-not-every-passage-is-a-journey.
 *
 * One is a preference and the other is authored in a table, and they end in the
 * same arithmetic, so they live together.
 *
 * ## Nothing here decides anything on a clock
 *
 * `travelledWords` is a function of the cursor and of the scene table, and the
 * scales below are functions of a setting. No elapsed time reaches this file,
 * which is what keeps docs/decisions/0004-idle-threat-not-speed-timer.md true of
 * the camera as well as of the monsters.
 *
 * ## Why the platform is not asked
 *
 * `prefers-reduced-motion` is a browser question, and `core/` never asks a
 * platform anything (docs/architecture/core-purity.md). `platform/web/main.ts`
 * puts the answer in and `reducedMotion` combines it with what the player
 * chose; a Dart port asks its own platform the same question and every rule
 * below is unchanged.
 */

import { tuningValue } from './tuning.js';
import type { Tuning } from './types.js';

// --- which presentation ------------------------------------------------------

/**
 * The three states of the motion setting.
 *
 * `auto` is the default and is the whole of the accessibility claim: the game
 * honours what the operating system was already told, without anybody having to
 * find a menu. The other two exist because the system setting is not the only
 * reason to want this -- somebody may want it on one machine and not another,
 * and the aftereffect can reach a player who has never had cause to turn the
 * system setting on. The owner had not.
 */
export type MotionSetting = 'auto' | 'full' | 'reduced';

/** Every setting, in the order the menu offers them. */
export const MOTION_SETTINGS: readonly MotionSetting[] = ['auto', 'full', 'reduced'];

/** True for a string that names a setting, so a stored record can be read. */
export function isMotionSetting(value: string): value is MotionSetting {
  return (MOTION_SETTINGS as readonly string[]).includes(value);
}

/**
 * Whether this frame is drawn reduced.
 *
 * The player's choice wins where he has made one, and `auto` -- the default --
 * defers to the system. There is deliberately no fourth state and no
 * "reduced unless the system says otherwise": a setting that could disagree with
 * itself is one the player cannot predict.
 */
export function reducedMotion(setting: MotionSetting, systemReduced: boolean): boolean {
  if (setting === 'reduced') return true;
  if (setting === 'full') return false;
  return systemReduced;
}

// --- how much of the motion survives ----------------------------------------

/**
 * What the parallax layers' authored depths are multiplied by.
 *
 * `reduced_parallax` is 0, so in reduced motion the layers do not shift at all.
 * They are the strongest half of the stimulus -- several fields moving at
 * different rates is a stronger adaptor than one -- and the least load-bearing
 * part of the picture: a garden with a still horizon is still a garden.
 */
export function parallaxScale(tuning: Tuning, reduced: boolean): number {
  return reduced ? tuningValue(tuning, 'reduced_parallax') : 1;
}

/**
 * What a set piece's own clock is multiplied by.
 *
 * Eased down rather than switched off, which is the difference between a quiet
 * flourish and a broken one: a flame that has stopped flickering is not a flame.
 * Set pieces and crossings are brief, and neither is what anyone adapted to.
 */
export function animScale(tuning: Tuning, reduced: boolean): number {
  return reduced ? tuningValue(tuning, 'reduced_anim_scale') : 1;
}

/**
 * How much of the remaining distance the world closes each frame.
 *
 * `full` is the caller's own easing, because the camera's smooth constant is a
 * fact about the platform's frame loop rather than a tunable. Reduced, it is
 * `reduced_camera_lerp` -- high enough that a stride reads as a step rather
 * than a slide, and short of 1 so the scribe is still visibly walking when he
 * takes it. A world that teleported would have him standing still for ever.
 */
export function cameraLerp(tuning: Tuning, reduced: boolean, full: number): number {
  return reduced ? tuningValue(tuning, 'reduced_camera_lerp') : full;
}

// --- held scenes -------------------------------------------------------------

/**
 * How far the world has actually travelled, in words.
 *
 * `progress` is the caller's word progress -- whole words behind the cursor plus
 * the fraction of the one under it -- and `held[i]` says whether word `i` sits in
 * a scene that does not translate. A held word is worth no travel; every other
 * word is worth exactly one stride, as it always was.
 *
 * The subtraction is what stops the world lurching. If the camera were simply
 * frozen while a scene was held and released afterwards, it would jump forward
 * by every word typed during the hold the moment the hold ended -- a whole
 * conversation's worth of landscape in one frame. Counting travelled words
 * instead makes the resumption continuous: the scribe carries on from the place
 * he was standing.
 *
 * The fraction of the word under the cursor is dropped while that word is held,
 * so the world does not creep forward inside a held word and snap back at its
 * end.
 */
export function travelledWords(held: readonly boolean[], progress: number): number {
  const at = Math.max(0, progress);
  const done = Math.floor(at);
  let travelled = 0;
  for (let i = 0; i < done && i < held.length; i += 1) {
    if (held[i] !== true) travelled += 1;
  }
  return held[done] === true ? travelled : travelled + (at - done);
}

/** Whether the word at this index sits in a held scene. Out of range is not. */
export function isHeldWord(held: readonly boolean[], word: number): boolean {
  return held[word] === true;
}

/**
 * The travelled distance of the whole span, in words.
 *
 * What the far checkpoint of a stretch stands at, so a stretch that is half
 * conversation does not leave its second candle beyond the end of the world.
 */
export function travelledTotal(held: readonly boolean[]): number {
  return travelledWords(held, held.length);
}
