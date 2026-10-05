/**
 * Vote-fraud scoring. Emits observations with weights; the caller maps the total
 * to a decision. "shadow" = accept the request (the attacker learns nothing) but
 * do not apply it to ratings.
 */
export interface VoteContext {
  accountAgeMs: number;
  /** Distinct accounts seen on this device in the last 30 days (including this one). */
  accountsOnDevice: number;
  /** Distinct accounts seen from this IP/subnet in the last hour. */
  accountsOnSubnet: number;
  /** Votes by this account in the last 10 minutes. */
  recentVotes: number;
  /** Time from ticket issue to vote. */
  watchMs: number;
  /** Fraction of this account's last N votes that picked side A (position bias). */
  sideABias: number; sampleSize: number;
  /** Fraction of this account's recent winning votes that went to one single owner. */
  topOwnerShare: number;
  /** IP belongs to a hosting/datacenter range or known proxy/VPN. */
  datacenterIp: boolean;
  /** Client failed or skipped device attestation (Play Integrity / App Attest) — optional signal. */
  attestationFailed?: boolean;
  /** Voter and the winning clip's owner are linked (same device / mutual heavy voting). */
  linkedToWinnerOwner: boolean;
}
export interface Signal { code: string; weight: number }
export type FraudDecision = "allow" | "shadow" | "deny";
export interface FraudVerdict { score: number; decision: FraudDecision; signals: Signal[] }
export interface FraudPolicy { shadowAt: number; denyAt: number }
export const DEFAULT_FRAUD_POLICY: FraudPolicy = { shadowAt: 50, denyAt: 90 };

const DAY = 86_400_000;
export function scoreVote(c: VoteContext, policy: FraudPolicy = DEFAULT_FRAUD_POLICY): FraudVerdict {
  const s: Signal[] = [];
  const add = (code: string, weight: number, when: boolean) => { if (when) s.push({ code, weight }); };
  add("new_account_1h", 25, c.accountAgeMs < DAY / 24);
  add("new_account_1d", 10, c.accountAgeMs >= DAY / 24 && c.accountAgeMs < DAY);
  add("device_farm", 35, c.accountsOnDevice >= 4);
  add("shared_device", 12, c.accountsOnDevice === 2 || c.accountsOnDevice === 3);
  add("subnet_crowd", 20, c.accountsOnSubnet >= 20);
  add("burst_voting", 20, c.recentVotes >= 40);
  add("instant_vote", 20, c.watchMs < 4_000);
  add("position_bias", 15, c.sampleSize >= 30 && (c.sideABias > 0.9 || c.sideABias < 0.1));
  add("owner_fixation", 30, c.sampleSize >= 20 && c.topOwnerShare > 0.5);
  add("datacenter_ip", 25, c.datacenterIp);
  add("attestation_failed", 30, !!c.attestationFailed);
  add("linked_to_owner", 45, c.linkedToWinnerOwner);
  const score = Math.min(100, s.reduce((n, x) => n + x.weight, 0));
  const decision: FraudDecision = score >= policy.denyAt ? "deny" : score >= policy.shadowAt ? "shadow" : "allow";
  return { score, decision, signals: s };
}
