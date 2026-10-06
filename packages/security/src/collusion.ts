/**
 * Voting-ring detection over the (voter → winning owner) graph.
 * Finds pairs of accounts that mostly vote for each other (reciprocal rings)
 * and owners whose wins come from a tiny set of voters (boosting).
 */
export interface VoteEdge { voter: string; owner: string }

export interface RingReport {
  reciprocal: { a: string; b: string; aToB: number; bToA: number }[];
  boosted: { owner: string; wins: number; topVoterShare: number; distinctVoters: number }[];
}

export function detectRings(edges: readonly VoteEdge[], opts = { minPairVotes: 5, minWins: 10, boostShare: 0.6 }): RingReport {
  const pair = new Map<string, number>(), winsBy = new Map<string, Map<string, number>>();
  for (const e of edges) {
    if (e.voter === e.owner) continue;
    pair.set(`${e.voter}\u0000${e.owner}`, (pair.get(`${e.voter}\u0000${e.owner}`) ?? 0) + 1);
    const m = winsBy.get(e.owner) ?? new Map<string, number>(); m.set(e.voter, (m.get(e.voter) ?? 0) + 1); winsBy.set(e.owner, m);
  }
  const reciprocal: RingReport["reciprocal"] = [];
  for (const [k, ab] of pair) {
    const [a, b] = k.split("\u0000"); if (a > b) continue;
    const ba = pair.get(`${b}\u0000${a}`) ?? 0;
    if (ab >= opts.minPairVotes && ba >= opts.minPairVotes) reciprocal.push({ a, b, aToB: ab, bToA: ba });
  }
  const boosted: RingReport["boosted"] = [];
  for (const [owner, m] of winsBy) {
    const wins = [...m.values()].reduce((x, y) => x + y, 0); if (wins < opts.minWins) continue;
    const top = [...m.values()].sort((x, y) => y - x).slice(0, 2).reduce((x, y) => x + y, 0);
    if (top / wins >= opts.boostShare) boosted.push({ owner, wins, topVoterShare: top / wins, distinctVoters: m.size });
  }
  return { reciprocal, boosted };
}
