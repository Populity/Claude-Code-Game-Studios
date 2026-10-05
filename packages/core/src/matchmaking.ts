import { DEFAULT_RULES, type BattleRules } from "./rules.ts";
import type { ClipRecord } from "./battle.ts";

/** Random source in [0, 1). Injected so matchmaking is deterministic in tests. */
export type Rng = () => number;

export interface PairOptions {
  /** Clip ids the viewer saw recently — picked less often. */
  recent?: ReadonlySet<string>;
  /** Clip ids hidden/reported by the viewer — never picked. */
  hidden?: ReadonlySet<string>;
  /** Owners the viewer blocked — never picked. */
  blockedOwners?: ReadonlySet<string>;
  /** The viewer's own clips are never shown to them for voting. */
  viewer?: string;
}

/** Matchmaking weight of one clip. */
export function weightOf(c: ClipRecord, opts: PairOptions = {}, rules: BattleRules = DEFAULT_RULES): number {
  const base = c.status === "king" ? rules.kingWeight : c.status === "qual" ? rules.qualWeight : 1;
  return base * (opts.recent?.has(c.id) ? rules.recentPenalty : 1);
}

/** Clips allowed to appear in a battle for this viewer and topic. */
export function eligible(clips: readonly ClipRecord[], topic: string, opts: PairOptions = {}): ClipRecord[] {
  return clips.filter(c =>
    c.topic === topic &&
    c.status !== "out" &&
    !opts.hidden?.has(c.id) &&
    !opts.blockedOwners?.has(c.owner) &&
    c.owner !== opts.viewer);
}

function weightedPick(list: readonly ClipRecord[], weight: (c: ClipRecord) => number, rng: Rng): ClipRecord {
  const total = list.reduce((s, c) => s + weight(c), 0);
  let r = rng() * total;
  for (const c of list) { r -= weight(c); if (r < 0) return c; }
  return list[list.length - 1];
}

/**
 * Picks two different clips of the same topic, or `null` if fewer than two are eligible.
 * Clips of the same owner are not paired against each other when avoidable.
 */
export function pickPair(clips: readonly ClipRecord[], topic: string, rng: Rng, opts: PairOptions = {}, rules: BattleRules = DEFAULT_RULES): [ClipRecord, ClipRecord] | null {
  const pool = eligible(clips, topic, opts);
  if (pool.length < 2) return null;
  const w = (c: ClipRecord) => weightOf(c, opts, rules);
  const a = weightedPick(pool, w, rng);
  const rest = pool.filter(c => c.id !== a.id);
  const others = rest.filter(c => c.owner !== a.owner);
  const b = weightedPick(others.length ? others : rest, w, rng);
  return rng() < 0.5 ? [a, b] : [b, a];
}
