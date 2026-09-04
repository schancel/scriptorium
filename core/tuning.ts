/**
 * The tuning lookup.
 *
 * @doc docs/design/07-tuning.md#tuning
 *
 * Takes the parsed `data/tuning.json` -- which the platform loads, because
 * `core/` never reaches out -- and flattens it into the `Tuning` map every
 * other core module reads its numbers from.
 *
 * The returned map throws on a key it does not hold, rather than handing back
 * `undefined` and letting a mistyped tunable silently become `NaN` three
 * modules downstream. A threshold that quietly evaluates to nothing is exactly
 * the invisible drift the tuning table exists to prevent.
 */

import type { Tuning } from './types.js';

/** The shape of `data/tuning.json`; only `values` is load-bearing. */
export interface TuningDocument {
  readonly values: Readonly<Record<string, number>>;
}

/**
 * Keys in the tuning table are lowercase snake_case. Anything else reaching the
 * proxy is host machinery (`toJSON`, `Symbol.iterator`, `toString`) rather than
 * a tunable, and must be answered normally instead of throwing.
 */
const TUNING_KEY = /^[a-z][a-z0-9_]*$/;

/**
 * Flatten a parsed tuning file into a lookup that throws on a missing key.
 *
 * @param parsed the object parsed from `data/tuning.json`
 * @throws if the object is not shaped like a tuning file, or holds a value
 *         that is not a finite number
 */
export function loadTuning(parsed: unknown): Tuning {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('tuning: expected the parsed tuning file, got a non-object');
  }
  const values: unknown = (parsed as { values?: unknown }).values;
  if (typeof values !== 'object' || values === null) {
    throw new Error('tuning: parsed file has no "values" table');
  }
  const flat: Record<string, number> = {};
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`tuning: "${key}" is not a finite number`);
    }
    flat[key] = value;
  }
  const frozen = Object.freeze(flat);
  return new Proxy(frozen, {
    get(target, prop, receiver): unknown {
      if (typeof prop === 'string' && !(prop in target) && TUNING_KEY.test(prop)) {
        throw new Error(`tuning: no such key "${prop}"`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Read one tunable. Equivalent to `tuning[key]` on a map from `loadTuning`, but
 * it also throws for a plain object built in a test, and it narrows the
 * `number | undefined` that `noUncheckedIndexedAccess` produces.
 *
 * @throws if the key is absent
 */
export function tuningValue(tuning: Tuning, key: string): number {
  const value = tuning[key];
  if (value === undefined) throw new Error(`tuning: no such key "${key}"`);
  return value;
}
