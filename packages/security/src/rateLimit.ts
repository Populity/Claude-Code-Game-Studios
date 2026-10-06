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
/** Accounts are cheap, so uploads are also capped per IP (bucketed with `ipBucket`). */
export const UPLOAD_IP_RULES: RateRule[] = [{ name: "upload-ip/hour", limit: 20, windowMs: 3_600_000 }, { name: "upload-ip/day", limit: 60, windowMs: 86_400_000 }];
/** Each battle is a stored row and a signed ticket; a human needs well under one every 2 s. */
export const BATTLE_RULES: RateRule[] = [{ name: "battle/min", limit: 40, windowMs: 60_000 }, { name: "battle/hour", limit: 1_200, windowMs: 3_600_000 }];

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

/** Expands an IPv6 address (with `::` and optional zone) to 8 hextets, or null if it is not one. */
function hextets(ip: string): string[] | null {
  const s = ip.split("%")[0].toLowerCase();
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  return all.every(h => /^[0-9a-f]{1,4}$/.test(h)) ? all.map(h => h.replace(/^0+(?=.)/, "")) : null;
}
const mappedV4 = (ip: string) => /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];

/**
 * Key for per-IP limits. IPv6 is bucketed to its /64 — one subscriber usually owns a
 * whole /64, so keying on the full address lets an attacker rotate through 2^64 "IPs".
 */
export function ipBucket(ip: string): string {
  const v4 = mappedV4(ip); if (v4) return v4;
  if (!ip.includes(":")) return ip;
  const h = hextets(ip); return h ? `${h.slice(0, 4).join(":")}::/64` : ip;
}

/** IPv4 /24 or IPv6 /48 bucket used for the subnet rule. */
export function subnetOf(ip: string): string {
  const v4 = mappedV4(ip) ?? ip;
  if (v4.includes(":")) { const h = hextets(v4); return h ? `${h.slice(0, 3).join(":")}::/48` : v4; }
  const p = v4.split("."); return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0/24` : v4;
}
