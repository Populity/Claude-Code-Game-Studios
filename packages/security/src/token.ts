import { b64url, fromB64url, fromUtf8, hmac, timingSafeEqual, utf8 } from "./crypto.ts";

/**
 * Compact signed token: `v1.<payload b64url>.<hmac b64url>`. The version and a
 * purpose string are bound into the MAC so a token for one purpose can never be
 * replayed as another (e.g. an OAuth state accepted as a battle ticket).
 * Supports key rotation: sign with `keys[0]`, verify against all.
 */
export interface Keyring { keys: readonly string[] }

const PREFIX = "v1";
const macInput = (purpose: string, body: string) => utf8(`${PREFIX}|${purpose}|${body}`);

export async function signToken(payload: unknown, purpose: string, ring: Keyring): Promise<string> {
  if (!ring.keys.length) throw new Error("empty keyring");
  const body = b64url(utf8(JSON.stringify(payload)));
  return `${PREFIX}.${body}.${b64url(await hmac(ring.keys[0], macInput(purpose, body)))}`;
}

export type TokenError = "malformed" | "bad_signature";

/** Verifies and decodes. Never parses JSON before the MAC is checked. */
export async function verifyToken<T>(token: string, purpose: string, ring: Keyring): Promise<{ ok: true; payload: T } | { ok: false; error: TokenError }> {
  if (typeof token !== "string" || token.length > 4096) return { ok: false, error: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, error: "malformed" };
  let mac: Uint8Array;
  try { mac = fromB64url(parts[2]); } catch { return { ok: false, error: "malformed" }; }
  let valid = false;
  for (const k of ring.keys) if (timingSafeEqual(await hmac(k, macInput(purpose, parts[1])), mac)) valid = true;
  if (!valid) return { ok: false, error: "bad_signature" };
  try { return { ok: true, payload: JSON.parse(fromUtf8(fromB64url(parts[1]))) as T }; }
  catch { return { ok: false, error: "malformed" }; }
}
