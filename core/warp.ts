/**
 * Warps: the crossing between two passages that share a phrase.
 *
 * @doc docs/design/05-scenery-warps.md#warps
 *
 * "The detail that makes them worth building: **during the phase, the echoed
 * words are the only thing on screen that does not change.** Genesis 1's void
 * dissolves into John 1's starfield while `In the beginning` stays lit exactly
 * where it sits on the rail."
 *
 * That sentence is the whole module. Everything else -- the world mix, the
 * arrival offset, the phase clock -- exists so that one property can hold, and
 * it is stated here as `WarpState.echoX`, a number `stepWarp` never changes:
 * the phrase is pinned to the screen column it already occupied, and the
 * destination ribbon is placed so *its* copy of the phrase lands on the same
 * column. The connection is the transition, because the phrase is what survives
 * the cut.
 *
 * ## The phrase is authored
 *
 * Echo phrases live in the route table and are verified against the text by
 * `make check`; they are never string-matched at runtime. `locateEcho` finds
 * where an already-authored phrase *sits* so the rail can hold it still. That
 * is a lookup, not a discovery, and the difference matters: nothing here ever
 * proposes an echo, and a phrase that stopped occurring in the text is a check
 * failure rather than a warp that quietly holds the wrong words.
 *
 * `echo_kjv` overrides `echo` under the King James text. WEB reads "your son"
 * where KJV reads "thy son", and the possessive pronoun is exactly what the two
 * disagree about, so a translation switch can silently break an echo unless the
 * phrase is chosen per translation. `echoFor` is where that choice is made, and
 * it is made once.
 *
 * ## Flashbacks and the return stack
 *
 * "Entering and leaving one must restore the exact verse, cursor position,
 * hearts, smudge level and combo -- and skipping a flashback entirely must
 * leave the level completable. A secret room that eats progress or gates the
 * exit is worse than no secret room."
 *
 * So `leaveFlashback` hands back the frame verbatim rather than reconciling
 * anything: damage taken inside a secret room is forgiven on the way out, by
 * design. What the frame does *not* hold is as deliberate -- items, quill nibs
 * and seals live in `PlayerState` and are untouched by the round trip, which is
 * the entire reward for finding the room. And `skipFlashback` is the identity
 * function on purpose: the cost of walking past a doorway must be provably
 * nothing, not merely believed to be nothing.
 */

import { CELL_W, focalX } from './rail.js';
import { tuningValue } from './tuning.js';
import type { RouteEdge } from './route.js';
import type { ReturnFrame, Tuning } from './types.js';

// --- the echo phrase --------------------------------------------------------

/** The King James text, as `Progress.translation` spells it. */
const KJV = 'kjv';

/**
 * The phrase this edge holds lit, for this translation.
 *
 * `echo_kjv` where the King James wording differs, `echo` otherwise. A route
 * table with no override for an edge means the two translations agree, not that
 * the KJV has no echo.
 */
export function echoFor(edge: RouteEdge, translation: string): string {
  if (translation.toLowerCase() === KJV && edge.echoKjv !== null) return edge.echoKjv;
  return edge.echo;
}

/**
 * Where an authored phrase sits in a passage: the index of its first character,
 * or -1.
 *
 * Case-insensitive, because the same authored phrase is `I AM` at the burning
 * bush and `I am` in the temple -- the echo is the words, not their casing, and
 * `tools/validate_data.py` compares them the same way.
 */
export function locateEcho(text: string, phrase: string): number {
  return text.toLowerCase().indexOf(phrase.toLowerCase());
}

// --- planning a crossing ----------------------------------------------------

/** Half-open would be a trap here; both bounds are glyph indices, inclusive. */
export interface EchoSpan {
  readonly first: number;
  readonly last: number;
}

/**
 * Everything about a crossing that does not change while it runs.
 *
 * Computed once, at the doorway. `echoX` in particular is computed once because
 * a value recomputed per frame is a value that can drift, and drift in this one
 * is the difference between a phrase that stays lit and a phrase that slides.
 */
export interface WarpPlan {
  readonly edgeId: string;
  readonly kind: RouteEdge['kind'];
  readonly from: string;
  readonly to: string;
  /** The authored phrase, for this translation. */
  readonly phrase: string;
  /** Where the phrase sits in each ribbon. */
  readonly originSpan: EchoSpan;
  readonly destSpan: EchoSpan;
  /** The screen column the phrase occupies, for the whole phase. */
  readonly echoX: number;
  /**
   * The ribbon offset the destination starts at, so its copy of the phrase
   * lands on `echoX`. The rail eases away from it once the crossing is over.
   */
  readonly arrivalOffset: number;
}

export interface WarpRequest {
  readonly edge: RouteEdge;
  /** `WEB` or `KJV`; anything else takes the default phrase. */
  readonly translation: string;
  /** The origin passage's ribbon, as one string. */
  readonly originText: string;
  /** Glyph index of the cursor when the doorway was entered. */
  readonly originCursor: number;
  readonly destText: string;
  readonly viewportW: number;
  readonly tuning: Tuning;
}

/**
 * Work out the crossing.
 *
 * @throws if the authored phrase is absent from either passage. That is a
 *         broken row in the route table, not a runtime condition to paper over:
 *         a warp that held nothing would present two unrelated passages as
 *         though the text joined them, which is the one thing the mechanic
 *         must never do.
 */
export function planWarp(request: WarpRequest): WarpPlan {
  const { edge, originText, destText } = request;
  const phrase = echoFor(edge, request.translation);
  const originFirst = locateEcho(originText, phrase);
  if (originFirst < 0) {
    throw new Error(`warp: edge "${edge.id}" echo "${phrase}" is absent from ${edge.from}`);
  }
  const destFirst = locateEcho(destText, phrase);
  if (destFirst < 0) {
    throw new Error(`warp: edge "${edge.id}" echo "${phrase}" is absent from ${edge.to}`);
  }
  const span = phrase.length;
  const originOffset = focalX(request.viewportW, request.tuning) - request.originCursor * CELL_W;
  const echoX = originOffset + originFirst * CELL_W;
  return {
    edgeId: edge.id,
    kind: edge.kind,
    from: edge.from,
    to: edge.to,
    phrase,
    originSpan: { first: originFirst, last: originFirst + span - 1 },
    destSpan: { first: destFirst, last: destFirst + span - 1 },
    echoX,
    arrivalOffset: echoX - destFirst * CELL_W,
  };
}

// --- running one ------------------------------------------------------------

/**
 * `holding` is the window the phrase is fully lit through, `releasing` is the
 * rest of the crossfade, `done` is arrival. Three names rather than a fraction
 * because the sound and the renderer both want to act on the boundary, and a
 * boundary derived twice is a boundary that eventually differs.
 */
export type WarpPhase = 'holding' | 'releasing' | 'done';

export interface WarpState {
  readonly plan: WarpPlan;
  readonly elapsedMs: number;
  readonly phase: WarpPhase;
  /** 0 is the origin's scenery, 1 the destination's. */
  readonly worldMix: number;
  /** 1 while the phrase is held, then down to 0 by arrival. */
  readonly echoAlpha: number;
  /** The screen column the phrase sits on. Never changes. */
  readonly echoX: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function phaseMs(tuning: Tuning): number {
  return Math.max(1, tuningValue(tuning, 'warp_phase_ms'));
}

function holdMs(tuning: Tuning): number {
  return Math.min(phaseMs(tuning), Math.max(0, tuningValue(tuning, 'warp_echo_hold_ms')));
}

function stateAt(plan: WarpPlan, elapsedMs: number, tuning: Tuning): WarpState {
  const total = phaseMs(tuning);
  const hold = holdMs(tuning);
  const clock = Math.max(0, elapsedMs);
  const release = Math.max(1, total - hold);
  const echoAlpha = clock <= hold ? 1 : clamp01(1 - (clock - hold) / release);
  const phase: WarpPhase = clock >= total ? 'done' : clock <= hold ? 'holding' : 'releasing';
  return {
    plan,
    elapsedMs: clock,
    phase,
    worldMix: clamp01(clock / total),
    echoAlpha,
    echoX: plan.echoX,
  };
}

/** A crossing at its first frame: origin scenery, phrase fully lit. */
export function beginWarp(plan: WarpPlan, tuning: Tuning): WarpState {
  return stateAt(plan, 0, tuning);
}

/**
 * Advance a crossing by one frame.
 *
 * Time is injected, never sampled. Because the whole state is a function of the
 * clock, a replayed `dtMs` trace replays the crossing exactly -- and `echoX` is
 * carried through from the plan rather than recomputed, so no arithmetic here
 * can move the held phrase.
 */
export function stepWarp(state: WarpState, dtMs: number, tuning: Tuning): WarpState {
  return stateAt(state.plan, state.elapsedMs + Math.max(0, dtMs), tuning);
}

export function warpComplete(state: WarpState): boolean {
  return state.phase === 'done';
}

/**
 * The glyphs that must not change this frame: the destination's copy of the
 * phrase once the world has begun to arrive, the origin's before that.
 *
 * Both spans hold the same characters at the same screen column, which is why
 * the swap is invisible and why the renderer may make it whenever it likes.
 */
export function heldSpan(state: WarpState): EchoSpan {
  return state.phase === 'holding' ? state.plan.originSpan : state.plan.destSpan;
}

// --- flashbacks -------------------------------------------------------------

/**
 * A saved position to come back to: the shared `ReturnFrame`.
 *
 * This was a second, local interface for a while, because `core/types.ts` had a
 * `ReturnFrame` with `ref`, `cursor` and `damage` -- three of the five things
 * docs/design/05-scenery-warps.md#warps requires a round trip to restore. It
 * had no verse, and a chapter reference plus a glyph cursor cannot say which
 * verse the player was on: the cursor indexes one chunk's ribbon, not the
 * chapter. A flashback taken at Genesis 22 and returned from would have landed
 * the scribe in the right chapter at the wrong place.
 *
 * Two types for one thing is how the two drift, so the field went where it
 * belonged and the local copy became this alias. Callers that already speak
 * `ReturnFrame` -- `GameState.returnStack` among them -- need no conversion.
 */
export type FlashbackFrame = ReturnFrame;

/** True while the player is inside a secret room. */
export function insideFlashback(stack: readonly FlashbackFrame[]): boolean {
  return stack.length > 0;
}

export function pushReturn(
  stack: readonly FlashbackFrame[],
  frame: FlashbackFrame,
): readonly FlashbackFrame[] {
  return [...stack, frame];
}

export function popReturn(
  stack: readonly FlashbackFrame[],
): { frame: FlashbackFrame | null; stack: readonly FlashbackFrame[] } {
  if (stack.length === 0) return { frame: null, stack };
  return { frame: stack[stack.length - 1] ?? null, stack: stack.slice(0, -1) };
}

/**
 * Step through a doorway: push the frame and name the passage to phase into.
 *
 * @throws if the edge is a progression edge. Progression is travel and stay --
 *         pushing a return frame for one would leave the player owed a journey
 *         back that nothing will ever make.
 */
export function enterFlashback(
  edge: RouteEdge,
  here: FlashbackFrame,
  stack: readonly FlashbackFrame[],
): { stack: readonly FlashbackFrame[]; destination: string } {
  if (edge.kind !== 'flashback') {
    throw new Error(`warp: edge "${edge.id}" is a progression edge, not a doorway`);
  }
  return { stack: pushReturn(stack, here), destination: edge.to };
}

/**
 * Phase forward again, to the exact verse the player left.
 *
 * The frame comes back untouched. Hearts spent and smudge collected inside the
 * room are forgiven, because the alternative is a secret that costs the player
 * the level it interrupted -- worse than no secret room.
 *
 * @throws if nothing was pushed. Leaving a room nobody entered is a bug in the
 *         caller, and swallowing it would strand the player in the flashback.
 */
export function leaveFlashback(
  stack: readonly FlashbackFrame[],
): { frame: FlashbackFrame; stack: readonly FlashbackFrame[] } {
  const popped = popReturn(stack);
  if (popped.frame === null) throw new Error('warp: no flashback to leave');
  return { frame: popped.frame, stack: popped.stack };
}

/**
 * Walk straight past the altar.
 *
 * The identity function on the return stack, and that is the point: it is
 * stated as a function so a test can assert that declining a doorway changes
 * nothing at all -- not the stack, not the verse, not a heart.
 */
export function skipFlashback(stack: readonly FlashbackFrame[]): readonly FlashbackFrame[] {
  return stack;
}
