import { randomId, type Clock, systemClock } from "./crypto.ts";
import { signToken, verifyToken, type Keyring } from "./token.ts";
import type { NonceStore } from "./store.ts";

/**
 * Battle ticket: issued by the server together with a battle, required to vote.
 * Binds viewer, battle, both clips and timing, so a client cannot:
 *  - vote on a battle it was never shown, or for a clip outside the pair;
 *  - reuse someone else's ticket (viewer + device binding);
 *  - vote instantly without watching (minimum watch time);
 *  - replay the same ticket (single-use nonce);
 *  - keep tickets forever (expiry).
 */
export interface BattleTicket {
  bid: string; a: string; b: string;
  viewer: string; device: string;
  iat: number; exp: number; minWatchMs: number;
  nonce: string;
}
export const TICKET_PURPOSE = "battle-ticket";

export interface TicketPolicy { ttlMs: number; minWatchMs: number }
export const DEFAULT_TICKET_POLICY: TicketPolicy = { ttlMs: 15 * 60_000, minWatchMs: 3_000 };

export async function issueTicket(
  input: { bid: string; a: string; b: string; viewer: string; device: string },
  ring: Keyring, policy: TicketPolicy = DEFAULT_TICKET_POLICY, clock: Clock = systemClock,
): Promise<{ token: string; ticket: BattleTicket }> {
  if (input.a === input.b) throw new Error("a battle needs two different clips");
  const now = clock();
  const ticket: BattleTicket = { ...input, iat: now, exp: now + policy.ttlMs, minWatchMs: policy.minWatchMs, nonce: randomId(18) };
  return { token: await signToken(ticket, TICKET_PURPOSE, ring), ticket };
}

export type TicketRejection =
  | "malformed" | "bad_signature" | "expired" | "not_yet_valid" | "too_fast"
  | "wrong_viewer" | "wrong_device" | "wrong_battle" | "invalid_choice" | "replayed";

export interface VoteClaim { token: string; bid: string; choice: string; viewer: string; device: string }

/** Full ticket check. The nonce is consumed only after every other check passes. */
export async function redeemTicket(claim: VoteClaim, ring: Keyring, nonces: NonceStore, clock: Clock = systemClock, skewMs = 5_000):
  Promise<{ ok: true; ticket: BattleTicket } | { ok: false; reason: TicketRejection }> {
  const v = await verifyToken<BattleTicket>(claim.token, TICKET_PURPOSE, ring);
  if (!v.ok) return { ok: false, reason: v.error };
  const t = v.payload, now = clock();
  if (typeof t?.exp !== "number" || typeof t.iat !== "number" || typeof t.nonce !== "string") return { ok: false, reason: "malformed" };
  if (now > t.exp) return { ok: false, reason: "expired" };
  if (t.iat > now + skewMs) return { ok: false, reason: "not_yet_valid" };
  if (now < t.iat + t.minWatchMs) return { ok: false, reason: "too_fast" };
  if (t.viewer !== claim.viewer) return { ok: false, reason: "wrong_viewer" };
  if (t.device !== claim.device) return { ok: false, reason: "wrong_device" };
  if (t.bid !== claim.bid) return { ok: false, reason: "wrong_battle" };
  if (claim.choice !== t.a && claim.choice !== t.b) return { ok: false, reason: "invalid_choice" };
  if (!(await nonces.consume(t.nonce, t.exp, now))) return { ok: false, reason: "replayed" };
  return { ok: true, ticket: t };
}
