import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, voteStreak } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

let now = 1_800_000_000_000;
const dir = mkdtempSync(join(tmpdir(), "vsv-"));
const cfg = loadConfig({ DATA_DIR: dir, TRUST_PROXY: "1", MIN_WATCH_MS: "3000" } as NodeJS.ProcessEnv);
const app = createApp(cfg, () => now);
const srv = createServer((q, s) => void app.handle(q, s));
await new Promise<void>(r => srv.listen(0, r));
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
let ipN = 1;
async function call(method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}, ip = `198.51.100.${ipN}`) {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), "x-forwarded-for": ip, ...extra },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
  const text = await r.text(); return { status: r.status, body: text ? JSON.parse(text) : null };
}
let regN = 0;
const register = async (handle: string, device = `dev-${handle}`) =>
  (await call("POST", "/api/auth/register", { handle, device, lang: "ru", topics: ["humor", "pets", "music"] }, undefined, {}, `203.0.113.${++regN}`)).body.token as string;

test.after(() => srv.close());

test("health and unknown routes; API responses are locked down", async () => {
  assert.equal((await call("GET", "/api/healthz")).status, 200);
  const h = (await fetch(base + "/api/healthz", { headers: { "x-forwarded-for": "198.51.100.250" } })).headers;
  assert.match(h.get("content-security-policy") ?? "", /default-src 'none'.*sandbox/);
  assert.equal(h.get("x-frame-options"), "DENY");
  assert.equal((await call("GET", "/api/nope")).status, 404);
});

test("registration validates handle, rejects duplicates, requires auth elsewhere", async () => {
  assert.equal((await call("POST", "/api/auth/register", { handle: "<script>", device: "d1" })).status, 400);
  const tok = await register("andrey"); assert.match(tok, /^vsv_/);
  assert.equal((await call("POST", "/api/auth/register", { handle: "Andrey", device: "d2" })).status, 409);
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("GET", "/api/me", undefined, "vsv_forged")).status, 401);
  assert.equal((await call("GET", "/api/me", undefined, tok)).body.handle, "andrey");
});

test("full vote flow: too fast rejected, valid vote applied once, replay and foreign ticket rejected", async () => {
  const tok = await register("voter1"), other = await register("voter2");
  const b = (await call("GET", "/api/battle?topic=humor", undefined, tok)).body;
  assert.ok(b.bid && b.ticket && b.a.id !== b.b.id && b.a.topic === "humor");
  const vote = { bid: b.bid, ticket: b.ticket, choice: b.a.id };
  assert.equal((await call("POST", "/api/vote", vote, tok)).status, 425, "instant vote");
  now += 5000;
  assert.equal((await call("POST", "/api/vote", vote, other)).status, 403, "someone else's ticket");
  assert.equal((await call("POST", "/api/vote", { ...vote, choice: "d-food-0" }, tok)).status, 403, "clip outside the pair");
  const ok = await call("POST", "/api/vote", vote, tok);
  assert.equal(ok.status, 200); assert.ok(ok.body.delta >= 1);
  assert.equal(ok.body.winner.wins, b.a.wins + 1);
  assert.deepEqual(ok.body.winner.hist, [...b.a.hist, 1], "winner hist includes this vote");
  assert.deepEqual(ok.body.loser.hist, [...b.b.hist, 0], "loser hist includes this vote");
  assert.equal((await call("POST", "/api/vote", vote, tok)).status, 403, "replay");
});

test("links: bad link, duplicate in another URL form", async () => {
  const tok = await register("linker");
  assert.equal((await call("POST", "/api/clips/link", { url: "https://evil.com/x", topic: "humor" }, tok)).status, 400);
  const r = await call("POST", "/api/clips/link", { url: "https://www.instagram.com/reel/ABCdef123/", topic: "humor", caption: "кот‮" }, tok);
  assert.equal(r.status, 201); assert.equal(r.body.caption, "кот"); assert.equal(r.body.status, "qual");
  const d = await call("POST", "/api/clips/link", { url: "instagram.com/reels/ABCdef123?igsh=1", topic: "pets" }, await register("copycat"));
  assert.equal(d.status, 409); assert.equal(d.body.handle, "linker");
});

test("uploads: rights required, disguised file rejected, real mp4 stored, same bytes are a duplicate, range streaming", async () => {
  const tok = await register("uploader");
  const mp4 = new Uint8Array(20_000); mp4.set([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom")]);
  assert.equal((await call("POST", "/api/clips/upload?topic=music", mp4, tok, { "content-type": "video/mp4" })).status, 400, "no rights");
  const php = new TextEncoder().encode("<?php system($_GET['c']); ?>".padEnd(20_000, " "));
  assert.equal((await call("POST", "/api/clips/upload?topic=music", php, tok, { "content-type": "video/mp4", "x-rights-confirmed": "1" })).body.error, "unknown_format");
  const up = await call("POST", "/api/clips/upload?topic=music&caption=hi", mp4, tok, { "content-type": "video/mp4", "x-rights-confirmed": "1" });
  assert.equal(up.status, 201); assert.match(up.body.video, /\/video$/);
  const dup = await call("POST", "/api/clips/upload?topic=music", mp4, await register("thief"), { "content-type": "video/mp4", "x-rights-confirmed": "1" });
  assert.equal(dup.status, 409);
  const v = await fetch(base + up.body.video, { headers: { range: "bytes=0-99", "x-forwarded-for": "198.51.100.9" } });
  assert.equal(v.status, 206); assert.equal(v.headers.get("content-range"), "bytes 0-99/20000"); assert.equal((await v.arrayBuffer()).byteLength, 100);
});

test("own clips are never served to their owner; report hides and copyright report removes", async () => {
  const tok = await register("owner1");
  const mine = (await call("POST", "/api/clips/link", { url: "https://instagram.com/reel/OWNclip01", topic: "cars" }, tok)).body;
  for (let i = 0; i < 10; i++) { const b = (await call("GET", "/api/battle?topic=cars", undefined, tok)).body; assert.ok(b.a.id !== mine.id && b.b.id !== mine.id); }
  const ranked = async () => ((await call("GET", "/api/ranking?topic=cars")).body as { id: string }[]).some(c => c.id === mine.id);
  const veteran = await register("veteran");
  // A batch of brand-new accounts from different networks: each hides the clip for itself only.
  for (let i = 0; i < 6; i++) {
    const sybil = await register(`sybil${i}`);
    assert.equal((await call("POST", "/api/reports", { clip: mine.id, reason: i ? "rSpam" : "rCopy" }, sybil, {}, `192.0.${i}.7`)).status, 201);
  }
  assert.ok(await ranked(), "fresh-account reports do not take a clip down");
  now += 25 * 3_600_000;
  assert.equal((await call("POST", "/api/reports", { clip: mine.id, reason: "rCopy" }, veteran)).status, 201);
  assert.ok(!(await ranked()), "an established account's copyright report pauses it");
});

test("logout revokes only this session", async () => {
  ipN = 40; const tok = await register("leaver");
  assert.equal((await call("POST", "/api/auth/logout", undefined, tok)).status, 200);
  assert.equal((await call("GET", "/api/me", undefined, tok)).status, 401);
  assert.equal((await call("POST", "/api/auth/logout", undefined, tok)).status, 401);
});

test("voteStreak: consecutive days, gap breaks it, current run may end yesterday", () => {
  assert.deepEqual(voteStreak([], 100), { streak: 0, bestStreak: 0 });
  assert.deepEqual(voteStreak([100, 99, 98, 95, 94, 93, 92], 100), { streak: 3, bestStreak: 4 });
  assert.deepEqual(voteStreak([99, 98], 100), { streak: 2, bestStreak: 2 }, "yesterday still counts");
  assert.deepEqual(voteStreak([98, 97], 100), { streak: 0, bestStreak: 2 }, "two days ago breaks it");
  assert.deepEqual(voteStreak([100, 100, 99], 100), { streak: 2, bestStreak: 2 }, "duplicates ignored");
});

test("/api/me stats: votes and day streak", async () => {
  ipN = 41; const tok = await register("streaker");
  for (let day = 0; day < 2; day++) {
    const b = (await call("GET", "/api/battle?topic=food", undefined, tok)).body; now += 5000;
    assert.equal((await call("POST", "/api/vote", { bid: b.bid, ticket: b.ticket, choice: b.b.id }, tok)).status, 200);
    if (day === 0) now += 86_400_000;
  }
  const me = (await call("GET", "/api/me", undefined, tok)).body;
  assert.deepEqual(me.stats, { clips: 0, wins: 0, kings: 0, votes: 2, streak: 2, bestStreak: 2 });
});

test("expired battle ticket is 410 ticket_expired", async () => {
  ipN = 42; const tok = await register("sleeper");
  const b = (await call("GET", "/api/battle?topic=travel", undefined, tok)).body; now += 16 * 60_000;
  const r = await call("POST", "/api/vote", { bid: b.bid, ticket: b.ticket, choice: b.a.id }, tok);
  assert.equal(r.status, 410); assert.equal(r.body.error, "ticket_expired");
});

test("posters: owner only, magic bytes checked, size capped, served as image", async () => {
  ipN = 43; const tok = await register("poster1"), other = await register("poster2");
  const mp4 = new Uint8Array(20_000); mp4.set([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom"), 7, 7]);
  const clip = (await call("POST", "/api/clips/upload?topic=art", mp4, tok, { "content-type": "video/mp4", "x-rights-confirmed": "1" })).body;
  assert.equal(clip.poster, null);
  const png = new Uint8Array(500); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const path = `/api/clips/${clip.id}/poster`;
  assert.equal((await call("PUT", path, png, other, { "content-type": "image/png" })).status, 403, "not the owner");
  assert.equal((await call("PUT", path, new TextEncoder().encode("<svg onload=alert(1)>"), tok, { "content-type": "image/png" })).body.error, "bad_image");
  assert.equal((await call("PUT", path, new Uint8Array(300 * 1024 + 1), tok, { "content-type": "image/jpeg" })).status, 413);
  assert.equal((await call("PUT", path, png, tok, { "content-type": "image/jpeg" })).status, 200);
  const mine = (await call("GET", "/api/my/clips", undefined, tok)).body as { id: string; poster: string }[];
  assert.equal(mine.find(c => c.id === clip.id)!.poster, path);
  const img = await fetch(base + path, { headers: { "x-forwarded-for": "198.51.100.43" } });
  assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png", "type from bytes, not the header");
});

test("delete own clip: owner only, files gone, same video can be uploaded again", async () => {
  ipN = 44; const tok = await register("deleter"), other = await register("nosy");
  const mp4 = new Uint8Array(20_000); mp4.set([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom"), 9, 9]);
  const up = () => call("POST", "/api/clips/upload?topic=tech", mp4, tok, { "content-type": "video/mp4", "x-rights-confirmed": "1" });
  const clip = (await up()).body;
  assert.equal((await call("DELETE", `/api/clips/${clip.id}`, undefined, other)).status, 403);
  assert.equal((await call("DELETE", `/api/clips/${clip.id}`, undefined, tok)).status, 200);
  assert.equal((await call("DELETE", `/api/clips/${clip.id}`, undefined, tok)).status, 404);
  assert.equal((await fetch(base + clip.video, { headers: { "x-forwarded-for": "198.51.100.44" } })).status, 404);
  assert.equal((await up()).status, 201, "not a duplicate any more");
  ipN = 2;
});

test("rate limit: a flood from one IP gets 429", async () => {
  ipN = 77; let got429 = false;
  for (let i = 0; i < 40; i++) if ((await call("GET", "/api/healthz")).status === 429) got429 = true;
  assert.ok(got429); ipN = 2;
});

test("device farm: votes from the 4th+ account on one device are shadowed (accepted, not counted)", async () => {
  let last = 0, bid = "", before = 0, winner = "";
  for (let i = 0; i < 6; i++) {
    const tok = await register(`farm${i}`, "same-device"); ipN = 100 + i;
    const b = (await call("GET", "/api/battle?topic=pets", undefined, tok)).body; now += 4000;
    bid = b.bid; winner = b.a.id; before = b.a.wins;
    last = (await call("POST", "/api/vote", { bid: b.bid, ticket: b.ticket, choice: b.a.id }, tok)).status;
  }
  assert.equal(last, 200, "attacker sees a normal response");
  assert.equal((app.db.prepare("SELECT shadow FROM votes WHERE battle = ?").get(bid) as { shadow: number }).shadow, 1);
  assert.equal((app.db.prepare("SELECT wins FROM clips WHERE id = ?").get(winner) as { wins: number }).wins, before, "rating untouched");
  ipN = 2;
});

test("battle fetching is rate limited per account", async () => {
  const tok = await register("hoarder"); let got429 = false;
  for (let i = 0; i < 45; i++) if ((await call("GET", "/api/battle?topic=sport", undefined, tok, {}, `198.18.1.${i}`)).status === 429) got429 = true;
  assert.ok(got429);
});

test("account deletion erases device, IP, vote and report rows", async () => {
  ipN = 120; const tok = await register("gdpr_user");
  const id = (await call("GET", "/api/me", undefined, tok)).body.id as string;
  const b = (await call("GET", "/api/battle?topic=dance", undefined, tok)).body; now += 5000;
  assert.equal((await call("POST", "/api/vote", { bid: b.bid, ticket: b.ticket, choice: b.a.id }, tok)).status, 200);
  assert.equal((await call("POST", "/api/reports", { clip: b.b.id, reason: "rSpam" }, tok)).status, 201);
  assert.equal((await call("DELETE", "/api/me", undefined, tok)).status, 200);
  for (const [t, col] of [["devices", "user_id"], ["ip_accounts", "user_id"], ["votes", "voter"], ["battles", "viewer"], ["reports", "reporter"], ["hidden", "user_id"], ["sessions", "user_id"]])
    assert.equal(Number((app.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} = ?`).get(id) as { n: number }).n), 0, t);
  ipN = 2;
});

test("storage: per-account quota and a free-disk floor stop uploads before the disk fills", async () => {
  const boot = async (env: Record<string, string>) => {
    const a = createApp(loadConfig({ DATA_DIR: mkdtempSync(join(tmpdir(), "vsv-q-")), DEMO_SEED: "0", ...env } as NodeJS.ProcessEnv), () => now);
    const s = createServer((q, r) => void a.handle(q, r)); await new Promise<void>(r => s.listen(0, r));
    const url = `http://127.0.0.1:${(s.address() as { port: number }).port}`;
    const tok = (await (await fetch(url + "/api/auth/register", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.200" }, body: JSON.stringify({ handle: "filler", device: "dev-filler" }) })).json()).token as string;
    const up = async (seed: number) => {
      const mp4 = new Uint8Array(20_000); mp4.set([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom"), seed]);
      const r = await fetch(url + "/api/clips/upload?topic=music", { method: "POST", body: mp4, headers: { authorization: `Bearer ${tok}`, "content-type": "video/mp4", "x-rights-confirmed": "1", "x-forwarded-for": `203.0.113.${seed}` } });
      return { status: r.status, error: (await r.json()).error };
    };
    return { up, close: () => s.close() };
  };
  const q = await boot({ USER_QUOTA_BYTES: "30000" });
  assert.equal((await q.up(1)).status, 201);
  assert.deepEqual(await q.up(2), { status: 413, error: "quota_exceeded" });
  q.close();
  const full = await boot({ MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) });
  assert.deepEqual(await full.up(3), { status: 507, error: "storage_full" });
  full.close();
});

test("config: empty SECRET_KEYS falls back to the persisted key file", () => {
  const d = mkdtempSync(join(tmpdir(), "vsv-k-"));
  const a = loadConfig({ DATA_DIR: d } as NodeJS.ProcessEnv), b = loadConfig({ DATA_DIR: d, SECRET_KEYS: "" } as NodeJS.ProcessEnv);
  assert.equal(a.keys.length, 1); assert.deepEqual(b.keys, a.keys, "same key across restarts");
  assert.throws(() => loadConfig({ DATA_DIR: d, SECRET_KEYS: "short" } as NodeJS.ProcessEnv));
});

test("audit chain is intact after all of the above", async () => {
  await app.flushAudit();
  const { verifyAudit } = await import("../../../packages/security/src/index.ts");
  const rows = app.db.prepare("SELECT * FROM audit ORDER BY seq").all() as unknown as { seq: number; ts: number; actor: string; action: string; data: string; prev: string; hash: string }[];
  assert.ok(rows.length > 10);
  assert.equal(await verifyAudit(rows.map(r => ({ ...r, data: JSON.parse(r.data) }))), -1);
});
