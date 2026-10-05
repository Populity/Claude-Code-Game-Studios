import { b64url, randomId, sha256, utf8, type Clock, systemClock } from "./crypto.ts";
import { signToken, verifyToken, type Keyring } from "./token.ts";

/** PKCE (RFC 7636, S256) for the Instagram login flow. */
export function pkceVerifier(): string { return randomId(48); } // 64 chars, within 43..128
export async function pkceChallenge(verifier: string): Promise<string> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) throw new Error("invalid PKCE verifier");
  return b64url(await sha256(utf8(verifier)));
}

/** Signed OAuth `state`, bound to the device and expiring in 10 minutes (CSRF + login-fixation defence). */
const PURPOSE = "oauth-state";
export async function issueState(device: string, redirect: string, ring: Keyring, clock: Clock = systemClock) {
  return signToken({ d: device, r: redirect, n: randomId(12), exp: clock() + 600_000 }, PURPOSE, ring);
}
export async function checkState(state: string, device: string, allowedRedirects: readonly string[], ring: Keyring, clock: Clock = systemClock) {
  const v = await verifyToken<{ d: string; r: string; exp: number }>(state, PURPOSE, ring);
  if (!v.ok) return { ok: false as const, reason: v.error };
  if (clock() > v.payload.exp) return { ok: false as const, reason: "expired" as const };
  if (v.payload.d !== device) return { ok: false as const, reason: "wrong_device" as const };
  if (!allowedRedirects.includes(v.payload.r)) return { ok: false as const, reason: "bad_redirect" as const };
  return { ok: true as const, redirect: v.payload.r };
}
