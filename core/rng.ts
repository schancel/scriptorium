/**
 * The one random number generator the whole core shares.
 *
 * @doc docs/architecture/core-purity.md#the-injected-seams
 *
 * `Math.random` is forbidden in `core/` and the reason is determinism, not
 * purity for its own sake: a run is reproducible only if every draw in it came
 * from a state the caller held. So randomness here is a *function* -- state in,
 * value and next state out -- rather than an object with a hidden cursor. A
 * caller replays a run by replaying its states, and a test hands in a fixed
 * sequence instead of a generator.
 *
 * It lives in its own module so that every consumer draws from the same
 * generator. It was written inside `core/items.ts` because the pass that needed
 * it was not allowed to add a file; a second copy appearing next to it in
 * `sim.ts` or in a scene placer would be two different streams from one seed,
 * which is exactly the bug the injected seam exists to prevent.
 */

/** One draw: a value in [0, 1) and the state to draw from next. */
export interface RngDraw {
  readonly value: number;
  readonly state: number;
}

/**
 * A pure PRNG: state in, value and next state out.
 *
 * A function rather than an object with a cursor, so a caller can replay a run
 * by replaying its states, and a test can hand in a fixed sequence instead of a
 * generator.
 */
export type Random = (state: number) => RngDraw;

/**
 * splitmix32. Deterministic, seedable, and fast enough that nothing in the game
 * will ever notice it.
 *
 * The constants are the published ones. They are `tuning-exempt` because they
 * are the algorithm rather than a setting: changing one does not tune anything,
 * it produces a different -- and unvetted -- generator.
 */
export const splitmix32: Random = (state: number): RngDraw => {
  const next = (state + 0x9e3779b9) | 0;             // tuning-exempt: PRNG constant
  let z = next;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);         // tuning-exempt: PRNG constant
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);         // tuning-exempt: PRNG constant
  const bits = (z ^ (z >>> 15)) >>> 0;               // tuning-exempt: PRNG constant
  return { value: bits / 0x100000000, state: next };
};

/**
 * A seed from a string, so a chapter reference can decide a level's decoration
 * without anybody having to author a number for every passage in the Bible.
 *
 * FNV-1a, 32-bit. The same reference always yields the same seed, which is what
 * makes "the bats stand where they stood last time" true across a reload
 * without a single byte being stored.
 */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;                             // tuning-exempt: FNV-1a offset basis
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);              // tuning-exempt: FNV-1a prime
  }
  return hash | 0;
}

/**
 * `count` draws from one seed, as a plain array.
 *
 * The convenience the placement code actually wants: it needs n numbers and has
 * no interest in threading the state, and threading it by hand at every call
 * site is how a stream gets accidentally reused.
 */
export function draws(state: number, count: number, random: Random = splitmix32): number[] {
  const out: number[] = [];
  let s = state;
  for (let i = 0; i < count; i += 1) {
    const draw = random(s);
    out.push(draw.value);
    s = draw.state;
  }
  return out;
}
