import { fromB64url, fromUtf8, hmac, timingSafeEqual, utf8 } from "./crypto.ts";

/**
 * Verifies Meta's `signed_request` (data-deletion and deauthorize callbacks):
 * `<base64url HMAC-SHA256(payload, app_secret)>.<base64url JSON payload>`.
 */
export async function verifyMetaSignedRequest<T = { user_id: string; algorithm: string; issued_at: number }>(signedRequest: string, appSecret: string, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 3600):
  Promise<{ ok: true; payload: T } | { ok: false; reason: "malformed" | "bad_signature" | "bad_algorithm" | "stale" }> {
  const parts = typeof signedRequest === "string" ? signedRequest.split(".") : [];
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  let sig: Uint8Array;
  try { sig = fromB64url(parts[0]); } catch { return { ok: false, reason: "malformed" }; }
  if (!timingSafeEqual(await hmac(appSecret, utf8(parts[1])), sig)) return { ok: false, reason: "bad_signature" };
  let payload: { algorithm?: string; issued_at?: number };
  try { payload = JSON.parse(fromUtf8(fromB64url(parts[1]))); } catch { return { ok: false, reason: "malformed" }; }
  if (payload.algorithm?.toUpperCase() !== "HMAC-SHA256") return { ok: false, reason: "bad_algorithm" };
  if (typeof payload.issued_at === "number" && nowSec - payload.issued_at > maxAgeSec) return { ok: false, reason: "stale" };
  return { ok: true, payload: payload as T };
}
