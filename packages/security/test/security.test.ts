import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/index.ts";

const K1 = "k1-0123456789abcdef0123456789abcdef", K2 = "k2-fedcba9876543210fedcba9876543210";
const ring = { keys: [K1] };
const at = (t: number) => () => t;

// ---------- tokens ----------
test("token roundtrip, purpose binding and key rotation", async () => {
  const tok = await S.signToken({ a: 1 }, "p1", ring);
  assert.deepEqual(await S.verifyToken(tok, "p1", ring), { ok: true, payload: { a: 1 } });
  assert.equal((await S.verifyToken(tok, "p2", ring)).ok, false, "token for p1 must not verify as p2");
  assert.equal((await S.verifyToken(tok, "p1", { keys: [K2, K1] })).ok, true, "old key still accepted after rotation");
  assert.equal((await S.verifyToken(tok, "p1", { keys: [K2] })).ok, false, "removed key rejected");
});
test("tampered payload or signature is rejected; garbage is malformed", async () => {
  const tok = await S.signToken({ role: "user" }, "p", ring);
  const [v, , sig] = tok.split(".");
  const forged = `${v}.${S.b64url(S.utf8(JSON.stringify({ role: "admin" })))}.${sig}`;
  assert.deepEqual(await S.verifyToken(forged, "p", ring), { ok: false, error: "bad_signature" });
  for (const g of ["", "a.b", "v1.x.!!", "v2.a.b", "x".repeat(5000)]) assert.equal((await S.verifyToken(g, "p", ring)).ok, false);
});
test("short HMAC secrets are refused", async () => { await assert.rejects(() => S.signToken({}, "p", { keys: ["short"] })); });

// ---------- battle tickets ----------
const base = { bid: "b1", a: "c1", b: "c2", viewer: "u1", device: "d1" };
async function ticket(t0 = 1_000_000) { return S.issueTicket(base, ring, S.DEFAULT_TICKET_POLICY, at(t0)); }
const claim = (token: string, o: Partial<S.VoteClaim> = {}) => ({ token, bid: "b1", choice: "c1", viewer: "u1", device: "d1", ...o });

test("valid vote after minimum watch time is accepted once, replay rejected", async () => {
  const { token } = await ticket(); const nonces = new S.MemoryNonceStore();
  assert.equal((await S.redeemTicket(claim(token), ring, nonces, at(1_005_000))).ok, true);
  assert.deepEqual(await S.redeemTicket(claim(token), ring, nonces, at(1_006_000)), { ok: false, reason: "replayed" });
});
test("ticket checks: too fast, expired, wrong viewer/device/battle/choice", async () => {
  const { token } = await ticket(); const n = () => new S.MemoryNonceStore();
  const r = async (o: Partial<S.VoteClaim>, t: number) => (await S.redeemTicket(claim(token, o), ring, n(), at(t))) as { ok: false; reason: string };
  assert.equal((await r({}, 1_001_000)).reason, "too_fast");
  assert.equal((await r({}, 1_000_000 + 16 * 60_000)).reason, "expired");
  assert.equal((await r({ viewer: "u2" }, 1_005_000)).reason, "wrong_viewer");
  assert.equal((await r({ device: "d2" }, 1_005_000)).reason, "wrong_device");
  assert.equal((await r({ bid: "b2" }, 1_005_000)).reason, "wrong_battle");
  assert.equal((await r({ choice: "c9" }, 1_005_000)).reason, "invalid_choice");
});
test("rejected attempts do not burn the nonce", async () => {
  const { token } = await ticket(); const nonces = new S.MemoryNonceStore();
  await S.redeemTicket(claim(token, { choice: "evil" }), ring, nonces, at(1_005_000));
  assert.equal((await S.redeemTicket(claim(token), ring, nonces, at(1_005_000))).ok, true);
});
test("a ticket for one purpose cannot be used as OAuth state and vice versa", async () => {
  const { token } = await ticket();
  assert.equal((await S.checkState(token, "d1", ["vsv://auth"], ring)).ok, false);
});

// ---------- rate limits ----------
test("sliding window blocks over the limit and recovers after the window", async () => {
  const st = new S.MemoryWindowStore(); const rules = [{ name: "r", limit: 3, windowMs: 1000 }];
  for (let i = 0; i < 3; i++) assert.equal((await S.checkRate(st, "u", rules, 100 + i)).allowed, true);
  const d = await S.checkRate(st, "u", rules, 200);
  assert.equal(d.allowed, false); assert.deepEqual(d.violated, ["r"]); assert.ok(d.retryAfterMs > 0 && d.retryAfterMs <= 1000);
  assert.equal((await S.checkRate(st, "u", rules, 1101)).allowed, true);
});
test("rejected requests do not extend the lockout; keys are independent", async () => {
  const st = new S.MemoryWindowStore(); const rules = [{ name: "r", limit: 1, windowMs: 1000 }];
  await S.checkRate(st, "u", rules, 0);
  for (let t = 10; t < 900; t += 100) await S.checkRate(st, "u", rules, t);
  assert.equal((await S.checkRate(st, "u", rules, 1001)).allowed, true);
  assert.equal((await S.checkRate(st, "other", rules, 5)).allowed, true);
});
test("subnet buckets", () => {
  assert.equal(S.subnetOf("203.0.113.77"), "203.0.113.0/24");
  assert.equal(S.subnetOf("2001:db8:abcd:12::1"), "2001:db8:abcd::/48");
  assert.equal(S.subnetOf("2001:db8::1"), "2001:db8:0::/48", "compressed address expanded, not split naively");
  assert.equal(S.subnetOf("::ffff:203.0.113.77"), "203.0.113.0/24", "IPv4-mapped treated as IPv4");
});
test("per-IP limits bucket IPv6 to /64 so address rotation does not evade them", () => {
  assert.equal(S.ipBucket("203.0.113.77"), "203.0.113.77");
  assert.equal(S.ipBucket("::ffff:203.0.113.77"), "203.0.113.77");
  assert.equal(S.ipBucket("2001:db8:1:2:aaaa::1"), S.ipBucket("2001:0db8:1:2:ffff:ffff:ffff:ffff"));
  assert.notEqual(S.ipBucket("2001:db8:1:2::1"), S.ipBucket("2001:db8:1:3::1"));
  assert.equal(S.ipBucket("not-an-ip"), "not-an-ip");
});

// ---------- fraud ----------
const clean: S.VoteContext = { accountAgeMs: 30 * 86_400_000, accountsOnDevice: 1, accountsOnSubnet: 2, recentVotes: 5, watchMs: 12_000, sideABias: 0.5, sampleSize: 50, topOwnerShare: 0.1, datacenterIp: false, linkedToWinnerOwner: false };
test("ordinary voter is allowed with no signals", () => { assert.deepEqual(S.scoreVote(clean), { score: 0, decision: "allow", signals: [] }); });
test("bot farm on fresh accounts from a datacenter is denied", () => {
  const v = S.scoreVote({ ...clean, accountAgeMs: 60_000, accountsOnDevice: 8, datacenterIp: true, watchMs: 500 });
  assert.equal(v.decision, "deny"); assert.ok(v.signals.some(s => s.code === "device_farm"));
});
test("friend boosting their own owner is shadowed, not denied", () => {
  assert.equal(S.scoreVote({ ...clean, linkedToWinnerOwner: true, recentVotes: 45 }).decision, "shadow");
});

// ---------- collusion ----------
test("reciprocal voting ring and boosted owner are detected", () => {
  const e: S.VoteEdge[] = [];
  for (let i = 0; i < 6; i++) e.push({ voter: "a", owner: "b" }, { voter: "b", owner: "a" });
  for (let i = 0; i < 12; i++) e.push({ voter: i < 9 ? "x" : `v${i}`, owner: "star" });
  for (let i = 0; i < 12; i++) e.push({ voter: `fan${i}`, owner: "honest" });
  const r = S.detectRings(e);
  assert.deepEqual(r.reciprocal.map(p => [p.a, p.b]), [["a", "b"]]);
  assert.deepEqual(r.boosted.map(b => b.owner), ["star"]);
});

// ---------- uploads ----------
const mp4 = new Uint8Array([0, 0, 0, 0x20, ...S.utf8("ftypisom"), 0, 0, 0, 0]);
const mov = new Uint8Array([0, 0, 0, 0x14, ...S.utf8("ftypqt  "), 0, 0, 0, 0]);
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...S.utf8("....B\x82\x84webm")]);
test("containers are detected from magic bytes, not names", () => {
  assert.equal(S.sniffContainer(mp4), "mp4"); assert.equal(S.sniffContainer(mov), "mov"); assert.equal(S.sniffContainer(webm), "webm");
  assert.equal(S.sniffContainer(S.utf8("<?php system($_GET[c]); ?>")), null);
  assert.equal(S.sniffContainer(S.utf8("\x89PNG\r\n\x1a\n........")), null);
});
test("size limits and format allowlist", () => {
  assert.deepEqual(S.validateUpload(mp4, 5_000_000), { ok: true, container: "mp4" });
  assert.deepEqual(S.validateUpload(mp4, 100), { ok: false, reason: "too_small" });
  assert.deepEqual(S.validateUpload(mp4, 300 * 1024 * 1024), { ok: false, reason: "too_large" });
  assert.deepEqual(S.validateUpload(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...S.utf8("matroska")]), 5_000_000), { ok: false, reason: "format_not_allowed" });
  assert.deepEqual(S.validateUpload(S.utf8("GIF89a.........."), 5_000_000), { ok: false, reason: "unknown_format" });
});

// ---------- sanitize ----------
test("captions lose bidi overrides, zero-width and control chars, and are capped", () => {
  assert.equal(S.cleanText("hi‮gnp.exe​\u0007  there"), "higIp.exe there".replace("gIp", "gnp"));
  assert.equal(S.cleanText("ｆｕｌｌｗｉｄｔｈ"), "fullwidth");
  assert.equal(Array.from(S.cleanText("😀".repeat(500))).length, 220);
  assert.equal(S.cleanText(42 as unknown), "");
});
test("handles are normalised and validated", () => {
  assert.equal(S.cleanHandle("@Andrey.Reels"), "andrey.reels");
  for (const bad of ["a", ".lead", "trail.", "two..dots", "space here", "admin", "x".repeat(31), "<script>"]) assert.equal(S.cleanHandle(bad), null, bad);
  assert.equal(S.isSafeId("humor"), true); assert.equal(S.isSafeId("../etc"), false);
});

// ---------- audit ----------
test("audit chain verifies and detects edits, deletions and reordering", async () => {
  const chain: S.AuditEntry[] = []; let prev: S.AuditEntry | null = null;
  for (let i = 0; i < 5; i++) { prev = await S.appendAudit(prev, "u1", "vote", { i }, 1000 + i); chain.push(prev); }
  assert.equal(await S.verifyAudit(chain), -1);
  assert.equal(await S.verifyAudit(chain.map((e, i) => (i === 2 ? { ...e, data: { i: 99 } } : e))), 2);
  assert.equal(await S.verifyAudit([chain[0], chain[1], chain[3], chain[4]]), 2);
  assert.equal(await S.verifyAudit([chain[1], chain[0]]), 0);
});

// ---------- Meta signed_request ----------
async function signed(payload: object, secret: string) {
  const p = S.b64url(S.utf8(JSON.stringify(payload)));
  return `${S.b64url(await S.hmac(secret, S.utf8(p)))}.${p}`;
}
test("Meta data-deletion signed_request is verified", async () => {
  const sec = "meta-app-secret-0123456789abcdef0123";
  const ok = await signed({ algorithm: "HMAC-SHA256", user_id: "42", issued_at: 1000 }, sec);
  assert.equal((await S.verifyMetaSignedRequest(ok, sec, 1100)).ok, true);
  assert.deepEqual(await S.verifyMetaSignedRequest(ok, "another-secret-0123456789abcdef01234", 1100), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await S.verifyMetaSignedRequest(ok, sec, 99999), { ok: false, reason: "stale" });
  assert.deepEqual(await S.verifyMetaSignedRequest(await signed({ algorithm: "none", user_id: "1" }, sec), sec), { ok: false, reason: "bad_algorithm" });
  const undated = await signed({ algorithm: "HMAC-SHA256", user_id: "42" }, sec);
  assert.deepEqual(await S.verifyMetaSignedRequest(undated, sec, 1100), { ok: false, reason: "stale" }, "no issued_at = replayable, rejected");
});

// ---------- OAuth ----------
test("PKCE S256 matches RFC 7636 test vector", async () => {
  assert.equal(await S.pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.ok(S.pkceVerifier().length >= 43);
  await assert.rejects(() => S.pkceChallenge("short"));
});
test("OAuth state is bound to device, redirect allowlist and expiry", async () => {
  const st = await S.issueState("d1", "vsv://auth", ring, at(0));
  assert.equal((await S.checkState(st, "d1", ["vsv://auth"], ring, at(1000))).ok, true);
  assert.equal((await S.checkState(st, "d2", ["vsv://auth"], ring, at(1000))).ok, false);
  assert.equal((await S.checkState(st, "d1", ["https://evil"], ring, at(1000))).ok, false);
  assert.equal((await S.checkState(st, "d1", ["vsv://auth"], ring, at(11 * 60_000))).ok, false);
});

// ---------- sessions ----------
test("session tokens are random, only hashes are stored, malformed tokens never match", async () => {
  const a = await S.newSession(), b = await S.newSession();
  assert.notEqual(a.token, b.token); assert.equal(await S.hashSession(a.token), a.hash);
  assert.equal(a.hash.length, 64); assert.equal(await S.hashSession("vsv_' OR 1=1 --"), "invalid");
});
