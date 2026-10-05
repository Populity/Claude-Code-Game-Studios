import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
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

test("health and unknown routes", async () => {
  assert.equal((await call("GET", "/api/healthz")).status, 200);
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
  const rep = await register("reporter");
  assert.equal((await call("POST", "/api/reports", { clip: mine.id, reason: "rCopy" }, rep)).status, 201);
  const rank = (await call("GET", "/api/ranking?topic=cars")).body as { id: string }[];
  assert.ok(!rank.some(c => c.id === mine.id));
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

test("audit chain is intact after all of the above", async () => {
  await app.flushAudit();
  const { verifyAudit } = await import("../../../packages/security/src/index.ts");
  const rows = app.db.prepare("SELECT * FROM audit ORDER BY seq").all() as unknown as { seq: number; ts: number; actor: string; action: string; data: string; prev: string; hash: string }[];
  assert.ok(rows.length > 10);
  assert.equal(await verifyAudit(rows.map(r => ({ ...r, data: JSON.parse(r.data) }))), -1);
});
