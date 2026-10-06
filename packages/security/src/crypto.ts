/** WebCrypto primitives shared by every security module. No Node-only APIs. */
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export function b64url(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("invalid base64url");
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const utf8 = (s: string) => enc.encode(s);
export const fromUtf8 = (b: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(b);

/** Constant-time comparison; length leak only. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
/** HMAC-SHA256 key. Secrets shorter than 32 bytes are rejected. */
export function hmacKey(secret: string | Uint8Array): Promise<CryptoKey> {
  const raw = typeof secret === "string" ? utf8(secret) : secret;
  if (raw.length < 32) throw new Error("HMAC secret must be at least 32 bytes");
  const id = b64url(raw);
  let k = keyCache.get(id);
  if (!k) { k = subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); keyCache.set(id, k); }
  return k;
}
export async function hmac(secret: string | Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.sign("HMAC", await hmacKey(secret), data));
}
export async function hmacVerify(secret: string | Uint8Array, data: Uint8Array, mac: Uint8Array): Promise<boolean> {
  return timingSafeEqual(await hmac(secret, data), mac);
}
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", typeof data === "string" ? utf8(data) : data));
}
export const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
export function randomBytes(n: number): Uint8Array { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }
export const randomId = (bytes = 16) => b64url(randomBytes(bytes));

/** Injectable clock (ms). */
export type Clock = () => number;
export const systemClock: Clock = () => Date.now();
