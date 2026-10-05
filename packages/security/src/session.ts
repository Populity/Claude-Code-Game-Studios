import { hex, randomId, sha256 } from "./crypto.ts";

/**
 * Opaque session tokens: 256-bit random, only the SHA-256 is stored server-side,
 * so a database leak does not leak usable sessions.
 */
export async function newSession(): Promise<{ token: string; hash: string }> {
  const token = `vsv_${randomId(32)}`;
  return { token, hash: await hashSession(token) };
}
export async function hashSession(token: string): Promise<string> {
  if (typeof token !== "string" || !/^vsv_[A-Za-z0-9_-]{43}$/.test(token)) return "invalid";
  return hex(await sha256(token));
}
