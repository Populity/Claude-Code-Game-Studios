import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export interface Config {
  port: number; dataDir: string; keys: string[]; trustProxy: boolean;
  metaAppSecret?: string; publicUrl: string; demoSeed: boolean; minWatchMs: number;
  /** Uploads are refused while free disk space would drop below this (keeps SQLite writable). */
  minFreeBytes: number;
  /** Total stored video bytes allowed per account. */
  userQuotaBytes: number;
  /** Reporter account age before its reports count towards automatic removal. */
  reporterMinAgeMs: number;
}
/** Reads env; generates and persists a signing secret on first start (chmod 600). */
export function loadConfig(env = process.env): Config {
  const dataDir = env.DATA_DIR ?? "./data";
  mkdirSync(join(dataDir, "videos"), { recursive: true, mode: 0o700 });
  const secretFile = join(dataDir, "secret.key");
  // An empty SECRET_KEYS (e.g. `${SECRET_KEYS:-}` in compose) means "unset", not "no keys".
  if (!env.SECRET_KEYS && !existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString("base64url"), { mode: 0o600 });
  const keys = (env.SECRET_KEYS || readFileSync(secretFile, "utf8")).split(",").map(s => s.trim()).filter(Boolean);
  if (!keys.length || keys.some(k => k.length < 32)) throw new Error("SECRET_KEYS entries must be ≥ 32 chars");
  return { port: Number(env.PORT ?? 8080), dataDir, keys, trustProxy: env.TRUST_PROXY !== "0", metaAppSecret: env.META_APP_SECRET || undefined,
    publicUrl: env.PUBLIC_URL ?? "", demoSeed: env.DEMO_SEED !== "0", minWatchMs: Number(env.MIN_WATCH_MS ?? 3000),
    minFreeBytes: Number(env.MIN_FREE_BYTES ?? 2 * 1024 ** 3), userQuotaBytes: Number(env.USER_QUOTA_BYTES ?? 1024 ** 3),
    reporterMinAgeMs: Number(env.REPORTER_MIN_AGE_MS ?? 86_400_000) };
}
