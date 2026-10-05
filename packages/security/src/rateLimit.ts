import type { WindowStore } from "./store.ts";

/** One sliding-window rule, e.g. 120 votes per hour per account. */
export interface RateRule { name: string; limit: number; windowMs: number }

/** Layered limits per dimension — a bot farm must evade all of them at once. */
export const VOTE_RULES: Record<"account" | "device" | "ip" | "subnet", RateRule[]> = {
  account: [{ name: "acct/min", limit: 20, windowMs: 60_000 }, { name: "acct/hour", limit: 300, windowMs: 3_600_000 }, { name: "acct/day", limit: 2_000, windowMs: 86_400_000 }],
  device:  [{ name: "dev/min", limit: 25, windowMs: 60_000 }, { name: "dev/day", limit: 2_500, windowMs: 86_400_000 }],
  ip:      [{ name: "ip/min", limit: 60, windowMs: 60_000 }, { name: "ip/hour", limit: 1_500, windowMs: 3_600_000 }],
  subnet:  [{ name: "net/min", limit: 300, windowMs: 60_000 }],
};
export const UPLOAD_RULES: RateRule[] = [{ name: "upload/hour", limit: 10, windowMs: 3_600_000 }, { name: "upload/day", limit: 30, windowMs: 86_400_000 }];
export const REPORT_RULES: RateRule[] = [{ name: "report/hour", limit: 30, windowMs: 3_600_000 }];
export const LOGIN_RULES: RateRule[] = [{ name: "login/10min", limit: 10, windowMs: 600_000 }];

export interface RateDecision { allowed: boolean; violated: string[]; retryAfterMs: number }

/**
 * Checks all rules first (peek) and records the hit only if every rule passes,
 * so rejected requests do not extend the lockout.
 */
export async function checkRate(store: WindowStore, key: string, rules: readonly RateRule[], now: number): Promise<RateDecision> {
  const violated: string[] = []; let retry = 0;
  for (const r of rules) {
    const hits = await store.peek(`${r.name}:${key}`, now, r.windowMs);
    if (hits.length >= r.limit) { violated.push(r.name); retry = Math.max(retry, hits[hits.length - r.limit] + r.windowMs - now); }
  }
  if (violated.length) return { allowed: false, violated, retryAfterMs: Math.max(1, retry) };
  for (const r of rules) await store.hit(`${r.name}:${key}`, now, r.windowMs);
  return { allowed: true, violated: [], retryAfterMs: 0 };
}

/** IPv4 /24 or IPv6 /48 bucket used for the subnet rule. */
export function subnetOf(ip: string): string {
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::/48";
  const p = ip.split("."); return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : ip;
}
