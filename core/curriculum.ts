/**
 * The curriculum: which keys a stage teaches, and when a stage is passed.
 *
 * @doc docs/design/06-curriculum.md#stages
 *
 * The stage table is compiled from the design doc into `data/curriculum.json`
 * by `make build`; the platform parses that file and hands the object here.
 * Nothing in this module invents a stage boundary.
 */

import type { GateResult, Key, KeyStat, Stage, Tuning } from './types.js';
import { tuningValue } from './tuning.js';
import { median } from './typing.js';

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`curriculum: ${what} is not an object`);
  }
  return value as Record<string, unknown>;
}

function asKeyList(value: unknown, what: string): Key[] {
  if (!Array.isArray(value)) throw new Error(`curriculum: ${what} is not an array`);
  return value.map((k, i) => {
    if (typeof k !== 'string' || k.length === 0) {
      throw new Error(`curriculum: ${what}[${i}] is not a key`);
    }
    return k;
  });
}

function asNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`curriculum: ${what} is not a finite number`);
  }
  return value;
}

/**
 * Parse `data/curriculum.json` into stages.
 *
 * Each stage's `keySet` is *derived* here as the union of its own keys and
 * every stage above it, and then checked against the one the file declares. A
 * hand-edit of the generated file that breaks cumulativeness is a load error
 * rather than a silently wrong key set -- the illumination invariant is only as
 * trustworthy as the set it is checked against.
 *
 * @throws if the object is not a curriculum, or its key sets are not cumulative
 */
export function loadStages(curriculumJson: unknown): Stage[] {
  const doc = asRecord(curriculumJson, 'parsed file');
  const rows = doc['stages'];
  if (!Array.isArray(rows)) throw new Error('curriculum: parsed file has no "stages" array');

  const stages: Stage[] = [];
  const cumulative = new Set<Key>();
  let previous: number | null = null;

  for (const [index, rawRow] of rows.entries()) {
    const row = asRecord(rawRow, `stages[${index}]`);
    const stage = asNumber(row['stage'], `stages[${index}].stage`);
    if (previous !== null && stage <= previous) {
      throw new Error(`curriculum: stage ${stage} is not after stage ${previous}`);
    }
    previous = stage;

    const keys = asKeyList(row['keys'], `stages[${index}].keys`);
    const declared = asKeyList(row['keySet'], `stages[${index}].keySet`);
    const predictedCoverage = asNumber(
      row['predictedCoverage'],
      `stages[${index}].predictedCoverage`,
    );
    const description = row['description'];
    if (typeof description !== 'string') {
      throw new Error(`curriculum: stages[${index}].description is not a string`);
    }

    for (const key of keys) cumulative.add(key);
    const declaredSet = new Set(declared);
    if (declaredSet.size !== cumulative.size) {
      throw new Error(`curriculum: stage ${stage} keySet is not the cumulative union`);
    }
    for (const key of cumulative) {
      if (!declaredSet.has(key)) {
        throw new Error(`curriculum: stage ${stage} keySet is missing "${key}"`);
      }
    }

    stages.push({ stage, keys, keySet: [...cumulative], predictedCoverage, description });
  }

  if (stages.length === 0) throw new Error('curriculum: no stages');
  return stages;
}

/**
 * The stage numbered `n`, clamped into range.
 *
 * A player who has finished the last stage keeps playing at the last stage
 * rather than crashing the run, and a negative stage reads as the first.
 */
export function stageAt(stages: readonly Stage[], n: number): Stage {
  if (stages.length === 0) throw new Error('curriculum: no stages loaded');
  const exact = stages.find((s) => s.stage === n);
  if (exact !== undefined) return exact;
  const index = Math.max(0, Math.min(Math.trunc(n), stages.length - 1));
  const clamped = stages[index];
  if (clamped === undefined) throw new Error(`curriculum: no stage near ${n}`);
  return clamped;
}

/** Everything typable at stage `n`: cumulative through that stage. */
export function keySetFor(stages: readonly Stage[], n: number): Set<Key> {
  return new Set(stageAt(stages, n).keySet);
}

/**
 * The mastery gate, measured on the stage's *new* keys only.
 *
 * Both conditions are required and the latency one is the point: accuracy alone
 * is satisfied by typing slowly and looking down, which is the habit being
 * replaced. Slow-but-accurate is the hunt-and-peck signature and does not pass.
 *
 * The latency allowance tightens by `gate_latency_step_ms` per stage and never
 * drops below `gate_latency_floor_ms`. `gate_window` is enforced as the number
 * of keystrokes that must have landed on the new keys before the gate can open
 * at all -- a `KeyStat` keeps no chronological ordering across keys, so a
 * trailing window is realised as a minimum sample count.
 */
export function evaluateGate(
  stage: Stage,
  keyStats: Readonly<Record<Key, KeyStat>>,
  tuning: Tuning,
): GateResult {
  const requiredAccuracy = tuningValue(tuning, 'gate_accuracy');
  const requiredSamples = tuningValue(tuning, 'gate_window');
  const base = tuningValue(tuning, 'gate_latency_base_ms');
  const step = tuningValue(tuning, 'gate_latency_step_ms');
  const floor = tuningValue(tuning, 'gate_latency_floor_ms');
  const allowedLatencyMs = Math.max(floor, base - stage.stage * step);

  let hits = 0;
  let errors = 0;
  const latencies: number[] = [];
  for (const key of stage.keys) {
    const stat = keyStats[key];
    if (stat === undefined) continue;
    hits += stat.hits;
    errors += stat.errors;
    for (const ms of stat.latencies) latencies.push(ms);
  }

  const samples = hits + errors;
  const accuracyMet = samples > 0 && hits / samples >= requiredAccuracy;
  const latencyMet = latencies.length > 0 && median(latencies) <= allowedLatencyMs;
  return {
    passed: accuracyMet && latencyMet && samples >= requiredSamples,
    accuracyMet,
    latencyMet,
    samples,
  };
}
