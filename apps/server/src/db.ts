import { DatabaseSync } from "node:sqlite";
import type { NonceStore, WindowStore } from "../../../packages/security/src/index.ts";

/** Opens (and migrates) the SQLite database. WAL mode: readers never block the single writer. */
export function openDb(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, lang TEXT NOT NULL DEFAULT 'ru',
      topics TEXT NOT NULL DEFAULT '[]', demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (device TEXT NOT NULL, user_id TEXT NOT NULL, first_seen INTEGER NOT NULL, PRIMARY KEY (device, user_id));
    CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, topic TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '', src TEXT NOT NULL, code TEXT UNIQUE, sha256 TEXT UNIQUE, file TEXT, mime TEXT,
      wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, rating INTEGER NOT NULL, status TEXT NOT NULL,
      hist TEXT NOT NULL DEFAULT '[]', removed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS clips_topic ON clips(topic, status, removed);
    CREATE TABLE IF NOT EXISTS battles (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, viewer TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS votes (battle TEXT PRIMARY KEY, voter TEXT NOT NULL, winner TEXT NOT NULL, loser TEXT NOT NULL, winner_owner TEXT NOT NULL,
      side TEXT NOT NULL, shadow INTEGER NOT NULL, score INTEGER NOT NULL, ip TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS votes_voter ON votes(voter, created_at);
    CREATE TABLE IF NOT EXISTS ip_accounts (subnet TEXT NOT NULL, user_id TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (subnet, user_id));
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, exp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hits (key TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS hits_key ON hits(key, ts);
    CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY, clip TEXT NOT NULL, reporter TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (clip, reporter));
    CREATE TABLE IF NOT EXISTS blocks (user_id TEXT NOT NULL, owner TEXT NOT NULL, PRIMARY KEY (user_id, owner));
    CREATE TABLE IF NOT EXISTS hidden (user_id TEXT NOT NULL, clip TEXT NOT NULL, PRIMARY KEY (user_id, clip));
    CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL, prev TEXT NOT NULL, hash TEXT NOT NULL);
  `);
  return db;
}
export type Db = ReturnType<typeof openDb>;

/** Runs `fn` in an IMMEDIATE transaction (serialises writers). */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export class SqlNonceStore implements NonceStore {
  private db: Db;
  constructor(db: Db) { this.db = db; }
  async consume(nonce: string, expiresAt: number, now: number) {
    this.db.prepare("DELETE FROM nonces WHERE exp <= ?").run(now);
    return Number(this.db.prepare("INSERT OR IGNORE INTO nonces (nonce, exp) VALUES (?, ?)").run(nonce, expiresAt).changes) === 1;
  }
}
export class SqlWindowStore implements WindowStore {
  private db: Db;
  constructor(db: Db) { this.db = db; }
  private list(key: string, now: number, windowMs: number) {
    return (this.db.prepare("SELECT ts FROM hits WHERE key = ? AND ts > ? ORDER BY ts").all(key, now - windowMs) as { ts: number }[]).map(r => r.ts);
  }
  async hit(key: string, now: number, windowMs: number) { this.db.prepare("INSERT INTO hits (key, ts) VALUES (?, ?)").run(key, now); return this.list(key, now, windowMs); }
  async peek(key: string, now: number, windowMs: number) { return this.list(key, now, windowMs); }
  /** Housekeeping: drop hits older than a day. */
  prune(now: number) { this.db.prepare("DELETE FROM hits WHERE ts < ?").run(now - 86_400_000); }
}
