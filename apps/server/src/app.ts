import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, renameSync, statSync, statfsSync, readdirSync, unlinkSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as Sec from "../../../packages/security/src/index.ts";
import { applyVote, newClip, pickPair, statusOf, instagramShortcode, type ClipRecord, type ClipStatus } from "../../../packages/core/src/index.ts";
import { openDb, tx, SqlNonceStore, SqlWindowStore, type Db } from "./db.ts";
import { API_LOCKDOWN, HttpError, clientIp, readJson, send } from "./http.ts";
import { isTopic, REPORT_REASONS, TOPIC_IDS } from "./topics.ts";
import type { Config } from "./config.ts";

interface ClipRow { id: string; owner: string; topic: string; caption: string; src: string; code: string | null; sha256: string | null; file: string | null; mime: string | null;
  wins: number; losses: number; rating: number; status: ClipStatus; hist: string; removed: number; created_at: number; poster: string | null; size: number; handle?: string }
interface User { id: string; handle: string; lang: string; topics: string; created_at: number }
const SESSION_TTL = 60 * 86_400_000;
const MIME: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp" };
const POSTER_MAX = 300 * 1024;
const DAY = 86_400_000;

/** Image type from magic bytes — the declared Content-Type is never trusted. */
function sniffImage(b: Buffer): "jpg" | "png" | "webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}
const IMAGE_MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** Current and best run of consecutive UTC days with a vote; the current run may end yesterday. */
export function voteStreak(days: number[], today: number): { streak: number; bestStreak: number } {
  const d = [...new Set(days)].sort((a, b) => b - a);
  let best = 0, run = 0;
  for (let i = 0; i < d.length; i++) { run = i > 0 && d[i - 1] - d[i] === 1 ? run + 1 : 1; best = Math.max(best, run); }
  let streak = d.length && today - d[0] <= 1 ? 1 : 0;
  while (streak && streak < d.length && d[streak - 1] - d[streak] === 1) streak++;
  return { streak, bestStreak: best };
}

export function createApp(cfg: Config, clock: () => number = Date.now) {
  const db: Db = openDb(join(cfg.dataDir, "vsv.db"));
  const ring = { keys: cfg.keys };
  const nonces = new SqlNonceStore(db), windows = new SqlWindowStore(db);
  const policy = { ttlMs: 15 * 60_000, minWatchMs: cfg.minWatchMs };
  let lastAudit = (db.prepare("SELECT * FROM audit ORDER BY seq DESC LIMIT 1").get() as (Sec.AuditEntry & { data: string }) | undefined);
  let lastAuditEntry: Sec.AuditEntry | null = lastAudit ? { ...lastAudit, data: JSON.parse(lastAudit.data) } : null;
  let auditQueue = Promise.resolve();
  const audit = (actor: string, action: string, data: unknown) => { auditQueue = auditQueue.then(async () => {
    const e = await Sec.appendAudit(lastAuditEntry, actor, action, data, clock());
    db.prepare("INSERT INTO audit (seq, ts, actor, action, data, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?)").run(e.seq, e.ts, e.actor, e.action, JSON.stringify(e.data), e.prev, e.hash);
    lastAuditEntry = e; }).catch(() => {}); };

  if (cfg.demoSeed && !db.prepare("SELECT 1 FROM users LIMIT 1").get()) seedDemo(db, clock());

  let reserved = 0; const inflight = new Map<string, number>();

  const toApi = (c: ClipRow) => ({ id: c.id, handle: c.handle ?? "", topic: c.topic, caption: c.caption, src: c.src, code: c.code,
    video: c.file ? `/api/clips/${c.id}/video` : null, poster: c.poster ? `/api/clips/${c.id}/poster` : null, wins: c.wins, losses: c.losses, rating: c.rating, status: c.status, hist: JSON.parse(c.hist) as number[], ts: c.created_at });
  const getClip = (id: string) => db.prepare("SELECT c.*, u.handle FROM clips c JOIN users u ON u.id = c.owner WHERE c.id = ?").get(id) as ClipRow | undefined;

  async function auth(req: IncomingMessage): Promise<{ user: User; device: string }> {
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const hash = await Sec.hashSession(token);
    const s = db.prepare("SELECT s.device, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?").get(hash) as (User & { device: string; expires_at: number }) | undefined;
    if (!s || s.expires_at < clock()) throw new HttpError(401, "unauthorized");
    return { user: s, device: s.device };
  }
  async function limit(key: string, rules: Sec.RateRule[]) {
    const d = await Sec.checkRate(windows, key, rules, clock());
    if (!d.allowed) throw new HttpError(429, "rate_limited");
  }

  const routes: [string, RegExp, (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, ip: string) => Promise<void>][] = [
    ["GET", /^\/api\/healthz$/, async (_q, res) => send(res, 200, { ok: true })],

    ["POST", /^\/api\/auth\/register$/, async (req, res, _m, ip) => {
      await limit(`ip:${Sec.ipBucket(ip)}`, Sec.LOGIN_RULES);
      const b = await readJson<{ handle?: string; device?: string; lang?: string; topics?: unknown }>(req);
      const handle = Sec.cleanHandle(b.handle);
      if (!handle) throw new HttpError(400, "bad_handle");
      if (!Sec.isSafeId(b.device, 80)) throw new HttpError(400, "bad_device");
      const topics = Array.isArray(b.topics) ? [...new Set(b.topics.filter(isTopic))] : [];
      const lang = b.lang === "en" ? "en" : "ru";
      const id = randomUUID(), now = clock();
      try { db.prepare("INSERT INTO users (id, handle, lang, topics, created_at) VALUES (?, ?, ?, ?, ?)").run(id, handle, lang, JSON.stringify(topics), now); }
      catch { throw new HttpError(409, "handle_taken"); }
      const { token, hash } = await Sec.newSession();
      db.prepare("INSERT INTO sessions (hash, user_id, device, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(hash, id, b.device, now, now + SESSION_TTL);
      db.prepare("INSERT OR IGNORE INTO devices (device, user_id, first_seen) VALUES (?, ?, ?)").run(b.device, id, now);
      audit(id, "register", { handle, ip });
      send(res, 201, { token, user: { id, handle, lang, topics } });
    }],

    ["POST", /^\/api\/auth\/logout$/, async (req, res) => {
      const { user } = await auth(req);
      db.prepare("DELETE FROM sessions WHERE hash = ?").run(await Sec.hashSession((req.headers.authorization ?? "").slice(7)));
      audit(user.id, "logout", {}); send(res, 200, { ok: true });
    }],

    ["GET", /^\/api\/me$/, async (req, res) => {
      const { user } = await auth(req);
      const c = db.prepare("SELECT COUNT(*) clips, COALESCE(SUM(wins), 0) wins, COALESCE(SUM(status = 'king'), 0) kings FROM clips WHERE owner = ? AND removed = 0").get(user.id) as { clips: number; wins: number; kings: number };
      const days = (db.prepare("SELECT DISTINCT CAST(created_at / 86400000 AS INTEGER) AS d FROM votes WHERE voter = ?").all(user.id) as { d: number }[]).map(r => Number(r.d));
      const stats = { clips: Number(c.clips), wins: Number(c.wins), kings: Number(c.kings), votes: Number((db.prepare("SELECT COUNT(*) n FROM votes WHERE voter = ?").get(user.id) as { n: number }).n),
        ...voteStreak(days, Math.floor(clock() / DAY)) };
      send(res, 200, { id: user.id, handle: user.handle, lang: user.lang, topics: JSON.parse(user.topics), stats });
    }],
    ["PUT", /^\/api\/me$/, async (req, res) => {
      const { user } = await auth(req); const b = await readJson<{ lang?: string; topics?: unknown }>(req);
      const topics = Array.isArray(b.topics) ? [...new Set(b.topics.filter(isTopic))] : JSON.parse(user.topics);
      if (topics.length < 3) throw new HttpError(400, "min_3_topics");
      db.prepare("UPDATE users SET lang = ?, topics = ? WHERE id = ?").run(b.lang === "en" ? "en" : b.lang === "ru" ? "ru" : user.lang, JSON.stringify(topics), user.id);
      send(res, 200, { ok: true });
    }],
    ["DELETE", /^\/api\/me$/, async (req, res) => {
      const { user } = await auth(req);
      for (const c of db.prepare("SELECT file, poster FROM clips WHERE owner = ?").all(user.id) as { file: string | null; poster: string | null }[]) removeFiles(c);
      // Erase everything keyed to the person (device ids, IPs, votes, reports), not just the users row.
      tx(db, () => { for (const t of ["devices WHERE user_id", "ip_accounts WHERE user_id", "votes WHERE voter", "battles WHERE viewer", "reports WHERE reporter", "blocks WHERE user_id", "hidden WHERE user_id", "users WHERE id"])
        db.prepare(`DELETE FROM ${t} = ?`).run(user.id); });
      audit(user.id, "delete_account", {});
      send(res, 200, { ok: true });
    }],

    ["GET", /^\/api\/battle$/, async (req, res) => {
      const { user, device } = await auth(req); await limit(`battle:${user.id}`, Sec.BATTLE_RULES);
      const url = new URL(req.url!, "http://x"); const want = url.searchParams.get("topic");
      const mine: string[] = JSON.parse(user.topics);
      const hidden = new Set((db.prepare("SELECT clip FROM hidden WHERE user_id = ?").all(user.id) as { clip: string }[]).map(r => r.clip));
      const blocked = new Set((db.prepare("SELECT owner FROM blocks WHERE user_id = ?").all(user.id) as { owner: string }[]).map(r => r.owner));
      const recent = new Set((db.prepare("SELECT a, b FROM battles WHERE viewer = ? ORDER BY created_at DESC LIMIT 6").all(user.id) as { a: string; b: string }[]).flatMap(r => [r.a, r.b]));
      for (let tries = 0; tries < 8; tries++) {
        const topic = isTopic(want) ? want : mine.length ? mine[Math.floor(Math.random() * mine.length)] : TOPIC_IDS[Math.floor(Math.random() * TOPIC_IDS.length)];
        const rows = db.prepare("SELECT * FROM clips WHERE topic = ? AND status != 'out' AND removed = 0").all(topic) as unknown as ClipRow[];
        const pool: ClipRecord[] = rows.map(r => ({ ...r }));
        const pair = pickPair(pool, topic, Math.random, { recent, hidden, blockedOwners: blocked, viewer: user.id });
        if (!pair) { if (isTopic(want)) break; continue; }
        const bid = randomUUID();
        db.prepare("INSERT INTO battles (id, a, b, viewer, created_at) VALUES (?, ?, ?, ?, ?)").run(bid, pair[0].id, pair[1].id, user.id, clock());
        const { token } = await Sec.issueTicket({ bid, a: pair[0].id, b: pair[1].id, viewer: user.id, device }, ring, policy, clock);
        return send(res, 200, { bid, ticket: token, topic, minWatchMs: policy.minWatchMs, a: toApi(getClip(pair[0].id)!), b: toApi(getClip(pair[1].id)!) });
      }
      send(res, 404, { error: "no_battle" });
    }],

    ["POST", /^\/api\/vote$/, async (req, res, _m, ip) => {
      const { user, device } = await auth(req);
      const subnet = Sec.subnetOf(ip);
      for (const [dim, key] of [["account", user.id], ["device", device], ["ip", Sec.ipBucket(ip)], ["subnet", subnet]] as const) await limit(`${dim}:${key}`, Sec.VOTE_RULES[dim]);
      const b = await readJson<{ bid?: string; ticket?: string; choice?: string }>(req);
      if (!Sec.isSafeId(b.bid, 64) || !Sec.isSafeId(b.choice, 64) || typeof b.ticket !== "string") throw new HttpError(400, "bad_vote");
      const r = await Sec.redeemTicket({ token: b.ticket, bid: b.bid, choice: b.choice, viewer: user.id, device }, ring, nonces, clock);
      if (!r.ok) {
        audit(user.id, "vote_rejected", { reason: r.reason, ip });
        if (r.reason === "expired") throw new HttpError(410, "ticket_expired");
        throw new HttpError(r.reason === "too_fast" ? 425 : 403, r.reason);
      }
      const t = r.ticket, loserId = b.choice === t.a ? t.b : t.a, now = clock();
      const w = getClip(b.choice), l = getClip(loserId);
      if (!w || !l || w.removed || l.removed || w.status === "out" || l.status === "out") throw new HttpError(409, "battle_closed");

      db.prepare("INSERT OR IGNORE INTO ip_accounts (subnet, user_id, ts) VALUES (?, ?, ?)").run(subnet, user.id, now);
      const last = db.prepare("SELECT side, winner_owner FROM votes WHERE voter = ? ORDER BY created_at DESC LIMIT 50").all(user.id) as { side: string; winner_owner: string }[];
      const ownerCounts = new Map<string, number>(); for (const v of last) ownerCounts.set(v.winner_owner, (ownerCounts.get(v.winner_owner) ?? 0) + 1);
      const ctx: Sec.VoteContext = {
        accountAgeMs: now - user.created_at,
        accountsOnDevice: Number((db.prepare("SELECT COUNT(DISTINCT user_id) n FROM devices WHERE device = ?").get(device) as { n: number }).n),
        accountsOnSubnet: Number((db.prepare("SELECT COUNT(*) n FROM ip_accounts WHERE subnet = ? AND ts > ?").get(subnet, now - 3_600_000) as { n: number }).n),
        recentVotes: Number((db.prepare("SELECT COUNT(*) n FROM votes WHERE voter = ? AND created_at > ?").get(user.id, now - 600_000) as { n: number }).n),
        watchMs: now - t.iat,
        sideABias: last.length ? last.filter(v => v.side === "a").length / last.length : 0.5, sampleSize: last.length,
        topOwnerShare: last.length ? Math.max(0, ...ownerCounts.values()) / last.length : 0,
        datacenterIp: false,
        linkedToWinnerOwner: !!db.prepare("SELECT 1 FROM devices d1 JOIN devices d2 ON d1.device = d2.device WHERE d1.user_id = ? AND d2.user_id = ?").get(user.id, w.owner),
      };
      const verdict = Sec.scoreVote(ctx);
      if (verdict.decision === "deny") { audit(user.id, "vote_denied", { bid: t.bid, score: verdict.score, signals: verdict.signals.map(s => s.code), ip }); throw new HttpError(403, "vote_rejected"); }
      const side = b.choice === t.a ? "a" : "b", shadow = verdict.decision === "shadow";
      const out = tx(db, () => {
        db.prepare("INSERT INTO votes (battle, voter, winner, loser, winner_owner, side, shadow, score, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(t.bid, user.id, w.id, l.id, w.owner, side, shadow ? 1 : 0, verdict.score, ip, now);
        const v = applyVote(w, l);
        if (!shadow) for (const [c, won] of [[v.winner, 1], [v.loser, 0]] as const) {
          const hist = JSON.parse((c.id === w.id ? w : l).hist) as number[]; hist.push(won);
          db.prepare("UPDATE clips SET wins = ?, losses = ?, rating = ?, status = ?, hist = ? WHERE id = ?").run(c.wins, c.losses, c.rating, c.status, JSON.stringify(hist), c.id);
        }
        return v;
      });
      audit(user.id, shadow ? "vote_shadow" : "vote", { bid: t.bid, winner: w.id, loser: l.id, delta: out.delta, score: verdict.score });
      // Shadowed votes get the same response as real ones, so abusers can't probe the detector.
      // hist is rebuilt here (not re-read) so shadowed votes still look applied.
      const after = (c: ClipRow, won: number) => ({ ...toApi(c), hist: [...(JSON.parse(c.hist) as number[]), won] });
      send(res, 200, { delta: out.delta, winner: { ...after(w, 1), ...pick(out.winner) }, loser: { ...after(l, 0), ...pick(out.loser) }, milestones: out.milestones.map(m => m.id) });
    }],

    ["POST", /^\/api\/clips\/link$/, async (req, res, _m, ip) => {
      const { user } = await auth(req); await limit(`upload:${user.id}`, Sec.UPLOAD_RULES);
      const b = await readJson<{ url?: string; topic?: string; caption?: string }>(req);
      const code = typeof b.url === "string" ? instagramShortcode(b.url) : null;
      if (!code) throw new HttpError(400, "bad_link");
      if (!isTopic(b.topic)) throw new HttpError(400, "bad_topic");
      const dup = db.prepare("SELECT c.id, u.handle FROM clips c JOIN users u ON u.id = c.owner WHERE c.code = ?").get(code) as { id: string; handle: string } | undefined;
      if (dup) return send(res, 409, { error: "duplicate", handle: dup.handle });
      const id = insertClip(db, user.id, b.topic, Sec.cleanText(b.caption), "link", { code }, clock());
      audit(user.id, "clip_link", { id, code, ip });
      send(res, 201, toApi(getClip(id)!));
    }],

    ["POST", /^\/api\/clips\/upload$/, async (req, res, _m, ip) => {
      const { user } = await auth(req); await limit(`upload:${user.id}`, Sec.UPLOAD_RULES); await limit(`upload-ip:${Sec.ipBucket(ip)}`, Sec.UPLOAD_IP_RULES);
      const url = new URL(req.url!, "http://x"); const topic = url.searchParams.get("topic");
      if (!isTopic(topic)) throw new HttpError(400, "bad_topic");
      if (req.headers["x-rights-confirmed"] !== "1") throw new HttpError(400, "rights_not_confirmed");
      const declared = Number(req.headers["content-length"]);
      const pre = Sec.validateUpload(new Uint8Array(), declared);
      if (!pre.ok && pre.reason !== "unknown_format") throw new HttpError(pre.reason === "too_large" ? 413 : 400, pre.reason);
      // Storage budget: per-account quota, and a free-space floor so a flood of uploads can't fill the disk
      // under SQLite. Bytes of uploads still in flight are reserved up front (the declared length is enforced below).
      const stored = Number((db.prepare("SELECT COALESCE(SUM(size), 0) n FROM clips WHERE owner = ?").get(user.id) as { n: number }).n);
      if (stored + (inflight.get(user.id) ?? 0) + declared > cfg.userQuotaBytes) throw new HttpError(413, "quota_exceeded");
      const disk = statfsSync(cfg.dataDir);
      if (disk.bavail * disk.bsize - reserved - declared < cfg.minFreeBytes) { console.error(new Date(clock()).toISOString(), "upload refused: free space below MIN_FREE_BYTES"); throw new HttpError(507, "storage_full"); }
      reserved += declared; inflight.set(user.id, (inflight.get(user.id) ?? 0) + declared);
      const tmp = join(cfg.dataDir, "videos", `tmp-${randomUUID()}`), hash = createHash("sha256"), out = createWriteStream(tmp, { mode: 0o600 });
      let head = Buffer.alloc(0), size = 0;
      try {
        for await (const chunk of req) {
          const c = chunk as Buffer; size += c.length;
          if (size > Sec.DEFAULT_UPLOAD_POLICY.maxBytes || size > declared) throw new HttpError(413, "too_large");
          if (head.length < 64) head = Buffer.concat([head, c.subarray(0, 64 - head.length)]);
          hash.update(c); if (!out.write(c)) await new Promise(r => out.once("drain", r));
        }
        await new Promise<void>((r, j) => out.end((e?: Error) => (e ? j(e) : r())));
        const v = Sec.validateUpload(new Uint8Array(head), size);
        if (!v.ok) throw new HttpError(400, v.reason);
        const sha = hash.digest("hex");
        const dup = db.prepare("SELECT u.handle FROM clips c JOIN users u ON u.id = c.owner WHERE c.sha256 = ?").get(sha) as { handle: string } | undefined;
        if (dup) { unlinkSync(tmp); return send(res, 409, { error: "duplicate", handle: dup.handle }); }
        const id = randomUUID(), file = `${id}.${v.container}`;
        renameSync(tmp, join(cfg.dataDir, "videos", file));
        insertClip(db, user.id, topic, Sec.cleanText(url.searchParams.get("caption") ?? ""), "file", { sha256: sha, file, mime: MIME[v.container], size }, clock(), id);
        audit(user.id, "clip_upload", { id, sha, size, ip });
        send(res, 201, toApi(getClip(id)!));
      } catch (e) { out.destroy(); if (existsSync(tmp)) unlinkSync(tmp); throw e; }
      finally { reserved -= declared; const left = (inflight.get(user.id) ?? 0) - declared; if (left > 0) inflight.set(user.id, left); else inflight.delete(user.id); }
    }],

    ["GET", /^\/api\/clips\/([\w-]{1,64})\/video$/, async (req, res, m) => {
      const c = getClip(m[1]); if (!c || !c.file || c.removed) throw new HttpError(404, "not_found");
      const path = join(cfg.dataDir, "videos", c.file), total = statSync(path).size;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      const headers = { ...API_LOCKDOWN, "Content-Type": c.mime ?? "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable", "Content-Disposition": "inline" };
      if (range && (range[1] || range[2])) {
        const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
        if (start > end || start >= total) { res.writeHead(416, { "Content-Range": `bytes */${total}` }); return void res.end(); }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": end - start + 1 });
        return void createReadStream(path, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, "Content-Length": total }); createReadStream(path).pipe(res);
    }],

    ["DELETE", /^\/api\/clips\/([\w-]{1,64})$/, async (req, res, m) => {
      const { user } = await auth(req);
      const c = getClip(m[1]); if (!c) throw new HttpError(404, "not_found");
      if (c.owner !== user.id) throw new HttpError(403, "not_owner");
      db.prepare("DELETE FROM clips WHERE id = ?").run(c.id); removeFiles(c);
      audit(user.id, "clip_delete", { id: c.id }); send(res, 200, { ok: true });
    }],

    ["PUT", /^\/api\/clips\/([\w-]{1,64})\/poster$/, async (req, res, m) => {
      const { user } = await auth(req); await limit(`poster:${user.id}`, Sec.UPLOAD_RULES);
      const c = getClip(m[1]); if (!c || c.removed) throw new HttpError(404, "not_found");
      if (c.owner !== user.id) throw new HttpError(403, "not_owner");
      if (Number(req.headers["content-length"]) > POSTER_MAX) throw new HttpError(413, "too_large");
      const parts: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += (chunk as Buffer).length; if (size > POSTER_MAX) throw new HttpError(413, "too_large"); parts.push(chunk as Buffer); }
      const body = Buffer.concat(parts), kind = sniffImage(body);
      if (!kind) throw new HttpError(400, "bad_image");
      const file = `${c.id}.poster.${kind}`;
      if (c.poster && c.poster !== file) removeFiles({ file: null, poster: c.poster });
      writeFileSync(join(cfg.dataDir, "videos", file), body, { mode: 0o600 });
      db.prepare("UPDATE clips SET poster = ? WHERE id = ?").run(file, c.id);
      send(res, 200, { poster: `/api/clips/${c.id}/poster` });
    }],

    ["GET", /^\/api\/clips\/([\w-]{1,64})\/poster$/, async (_q, res, m) => {
      const c = getClip(m[1]); if (!c || !c.poster || c.removed) throw new HttpError(404, "not_found");
      const kind = c.poster.slice(c.poster.lastIndexOf(".") + 1) as keyof typeof IMAGE_MIME;
      const body = readFileSync(join(cfg.dataDir, "videos", c.poster));
      res.writeHead(200, { ...API_LOCKDOWN, "Content-Type": IMAGE_MIME[kind], "Content-Length": body.length, "Cache-Control": "public, max-age=3600", "Content-Disposition": "inline" });
      res.end(body);
    }],

    ["GET", /^\/api\/ranking$/, async (req, res) => {
      const topic = new URL(req.url!, "http://x").searchParams.get("topic");
      const rows = (isTopic(topic) ? db.prepare("SELECT c.*, u.handle FROM clips c JOIN users u ON u.id = c.owner WHERE c.status != 'out' AND c.removed = 0 AND c.topic = ? ORDER BY c.rating DESC LIMIT 50").all(topic)
        : db.prepare("SELECT c.*, u.handle FROM clips c JOIN users u ON u.id = c.owner WHERE c.status != 'out' AND c.removed = 0 ORDER BY c.rating DESC LIMIT 50").all()) as unknown as ClipRow[];
      send(res, 200, rows.map(toApi));
    }],
    ["GET", /^\/api\/my\/clips$/, async (req, res) => {
      const { user } = await auth(req);
      send(res, 200, (db.prepare("SELECT c.*, u.handle FROM clips c JOIN users u ON u.id = c.owner WHERE c.owner = ? ORDER BY c.created_at DESC").all(user.id) as unknown as ClipRow[]).map(toApi));
    }],
    ["GET", /^\/api\/topics$/, async (_q, res) => {
      const rows = db.prepare("SELECT topic, COUNT(*) n FROM clips WHERE status != 'out' AND removed = 0 GROUP BY topic").all() as { topic: string; n: number }[];
      send(res, 200, Object.fromEntries(rows.map(r => [r.topic, Number(r.n)])));
    }],

    ["POST", /^\/api\/reports$/, async (req, res, _m, ip) => {
      const { user } = await auth(req); await limit(`report:${user.id}`, Sec.REPORT_RULES); await limit(`report-ip:${Sec.ipBucket(ip)}`, Sec.REPORT_RULES);
      const b = await readJson<{ clip?: string; reason?: string }>(req);
      if (!Sec.isSafeId(b.clip) || !(REPORT_REASONS as readonly string[]).includes(b.reason ?? "")) throw new HttpError(400, "bad_report");
      if (!getClip(b.clip)) throw new HttpError(404, "not_found");
      db.prepare("INSERT OR IGNORE INTO reports (clip, reporter, reason, created_at, subnet) VALUES (?, ?, ?, ?, ?)").run(b.clip, user.id, b.reason!, clock(), Sec.subnetOf(ip));
      db.prepare("INSERT OR IGNORE INTO hidden (user_id, clip) VALUES (?, ?)").run(user.id, b.clip);
      // Auto-remove after 5 established reporters from 3+ subnets (copyright: 1 established report pauses the clip
      // pending review). Fresh accounts only hide the clip for themselves, so a batch of sybils can't take clips down.
      const agedBefore = clock() - cfg.reporterMinAgeMs;
      const r = db.prepare("SELECT COUNT(*) n, COUNT(DISTINCT r.subnet) nets FROM reports r JOIN users u ON u.id = r.reporter WHERE r.clip = ? AND u.created_at <= ?").get(b.clip, agedBefore) as { n: number; nets: number };
      if ((Number(r.n) >= 5 && Number(r.nets) >= 3) || (b.reason === "rCopy" && user.created_at <= agedBefore)) db.prepare("UPDATE clips SET removed = 1 WHERE id = ?").run(b.clip);
      audit(user.id, "report", { clip: b.clip, reason: b.reason });
      send(res, 201, { ok: true });
    }],
    ["POST", /^\/api\/blocks$/, async (req, res) => {
      const { user } = await auth(req); const b = await readJson<{ clip?: string }>(req);
      const c = Sec.isSafeId(b.clip) ? getClip(b.clip) : undefined; if (!c) throw new HttpError(404, "not_found");
      db.prepare("INSERT OR IGNORE INTO blocks (user_id, owner) VALUES (?, ?)").run(user.id, c.owner);
      send(res, 201, { ok: true });
    }],

    ["POST", /^\/api\/meta\/data-deletion$/, async (req, res) => {
      if (!cfg.metaAppSecret) throw new HttpError(404, "not_configured");
      let body = ""; for await (const c of req) { body += c; if (body.length > 8192) throw new HttpError(413, "body_too_large"); }
      const sr = new URLSearchParams(body).get("signed_request") ?? "";
      const v = await Sec.verifyMetaSignedRequest(sr, cfg.metaAppSecret, Math.floor(clock() / 1000));
      if (!v.ok) throw new HttpError(400, v.reason);
      const code = randomUUID(); audit("meta", "data_deletion", { user_id: v.payload.user_id, code });
      send(res, 200, { url: `${cfg.publicUrl}/deletion?code=${code}`, confirmation_code: code });
    }],
  ];

  function removeFiles(c: { file: string | null; poster: string | null }) {
    for (const f of [c.file, c.poster]) if (f) try { unlinkSync(join(cfg.dataDir, "videos", f)); } catch {}
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const ip = clientIp(req, cfg.trustProxy);
    const path = (req.url ?? "/").split("?")[0];
    try {
      if ((req.url ?? "").length > 2048) throw new HttpError(414, "uri_too_long");
      await limit(`global-ip:${Sec.ipBucket(ip)}`, [{ name: "ip/sec", limit: 30, windowMs: 1000 }]);
      for (const [method, re, fn] of routes) { const m = path.match(re); if (m && req.method === method) return await fn(req, res, m, ip); }
      throw new HttpError(404, "not_found");
    } catch (e) {
      if (res.headersSent) return void res.destroy();
      if (e instanceof HttpError) return send(res, e.status, { error: e.code }, e.status === 429 ? { "Retry-After": "30" } : {});
      console.error(new Date(clock()).toISOString(), req.method, path, e);
      send(res, 500, { error: "internal" });
    }
  }
  const housekeeping = () => {
    windows.prune(clock()); db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(clock());
    db.prepare("DELETE FROM battles WHERE created_at < ?").run(clock() - DAY); // tickets live 15 min; only the last few are read
    const dir = join(cfg.dataDir, "videos"); // partial uploads orphaned by a crash or restart
    for (const f of readdirSync(dir)) if (f.startsWith("tmp-")) try { if (statSync(join(dir, f)).mtimeMs < Date.now() - 3 * 3_600_000) unlinkSync(join(dir, f)); } catch {}
  };
  return { handle, db, housekeeping, flushAudit: () => auditQueue };
}

const pick = (c: ClipRecord) => ({ wins: c.wins, losses: c.losses, rating: c.rating, status: c.status });

function insertClip(db: Db, owner: string, topic: string, caption: string, src: "link" | "file" | "demo", f: { code?: string; sha256?: string; file?: string; mime?: string; size?: number }, now: number, id = randomUUID()) {
  const base = newClip(id, topic, owner);
  db.prepare("INSERT INTO clips (id, owner, topic, caption, src, code, sha256, file, mime, size, wins, losses, rating, status, hist, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'qual', '[]', ?)")
    .run(id, owner, topic, caption, src, f.code ?? null, f.sha256 ?? null, f.file ?? null, f.mime ?? null, f.size ?? 0, base.rating, now);
  return id;
}

/** Demo opponents so a fresh server has battles in every topic. */
function seedDemo(db: Db, now: number) {
  const handles = ["mila.vibes", "dan_runs", "katya.cooks", "max.moves", "travel.with.lia", "artem.art", "nika_style", "the.lev", "sasha.beats", "pixel.pasha", "olya.fit", "gleb.drive", "tanya.learns", "vova.lol", "yana.pets", "kirill.tech"];
  const caps = ["Ждали продолжение? 🔥", "Сняли с первого дубля", "Это надо видеть до конца", "Повторите, если сможете", "Мой лучший клип за месяц", "Без монтажа!"];
  let seed = 2026; const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  tx(db, () => {
    const ids = handles.map(h => { const id = `demo-${h}`; db.prepare("INSERT INTO users (id, handle, demo, created_at) VALUES (?, ?, 1, ?)").run(id, h, now); return id; });
    TOPIC_IDS.forEach((topic, ti) => { for (let i = 0; i < 6; i++) {
      const id = `d-${topic}-${i}`; insertClip(db, ids[(ti * 5 + i) % ids.length], topic, caps[(ti + i) % 6], "demo", {}, now, id);
      let w = 0, l = 0, rating = 1500, status: ClipStatus = "qual"; const hist: number[] = [], p = [0.85, 0.75, 0.55, 0.45, 0.3, 0.2][i];
      for (let k = 0, n = Math.floor(rng() * 16); k < n && status !== "out"; k++) { const won = rng() < p; won ? w++ : l++; hist.push(won ? 1 : 0); rating += won ? 14 : -14; status = statusOf({ wins: w, losses: l, status }); }
      db.prepare("UPDATE clips SET wins = ?, losses = ?, rating = ?, status = ?, hist = ? WHERE id = ?").run(w, l, rating, status, JSON.stringify(hist), id);
    } });
  });
}
