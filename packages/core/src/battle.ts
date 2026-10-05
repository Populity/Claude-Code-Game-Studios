import { DEFAULT_RULES, type BattleRules } from "./rules.ts";

export type ClipStatus = "qual" | "active" | "king" | "out";

/** Battle record of one clip. */
export interface ClipRecord {
  id: string;
  topic: string;
  owner: string;
  wins: number;
  losses: number;
  rating: number;
  status: ClipStatus;
}

/**
 * Status after the clip's current record.
 * - `out` is permanent: a clip eliminated in qualification never returns.
 * - During the first `qualBattles` battles, `maxQualLosses` losses eliminate it.
 * - After qualification, a win rate strictly above `kingWinRate` makes it king,
 *   otherwise it stays `active`. Kings can fall back to `active`.
 */
export function statusOf(r: Pick<ClipRecord, "wins" | "losses" | "status">, rules: BattleRules = DEFAULT_RULES): ClipStatus {
  if (r.status === "out") return "out";
  const played = r.wins + r.losses;
  if (played <= rules.qualBattles && r.losses >= rules.maxQualLosses) return "out";
  if (played < rules.qualBattles) return "qual";
  return r.wins / played > rules.kingWinRate ? "king" : "active";
}

/** Elo expected score of `a` against `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

export interface VoteOutcome {
  winner: ClipRecord;
  loser: ClipRecord;
  /** Rating points moved from loser to winner (always ≥ 1). */
  delta: number;
  /** Clips whose status changed to `king` or `out` in this vote. */
  milestones: ClipRecord[];
}

/** Applies one vote. Pure: returns updated copies, inputs are untouched. */
export function applyVote(winner: ClipRecord, loser: ClipRecord, rules: BattleRules = DEFAULT_RULES): VoteOutcome {
  if (winner.id === loser.id) throw new Error("A clip cannot battle itself");
  if (winner.status === "out" || loser.status === "out") throw new Error("Eliminated clips cannot battle");
  const delta = Math.max(1, Math.round(rules.eloK * (1 - expectedScore(winner.rating, loser.rating))));
  const w = { ...winner, wins: winner.wins + 1, rating: winner.rating + delta };
  const l = { ...loser, losses: loser.losses + 1, rating: loser.rating - delta };
  const milestones: ClipRecord[] = [];
  for (const c of [w, l]) {
    const next = statusOf(c, rules);
    if (next !== c.status && (next === "king" || next === "out")) milestones.push(c);
    c.status = next;
  }
  return { winner: w, loser: l, delta, milestones };
}

/** Creates a fresh clip record entering qualification. */
export function newClip(id: string, topic: string, owner: string, rules: BattleRules = DEFAULT_RULES): ClipRecord {
  return { id, topic, owner, wins: 0, losses: 0, rating: rules.startRating, status: "qual" };
}
