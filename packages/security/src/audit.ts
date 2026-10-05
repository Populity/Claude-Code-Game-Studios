import { hex, sha256 } from "./crypto.ts";

/**
 * Tamper-evident audit log: each entry stores the hash of the previous one, so
 * deleting or editing any past entry breaks verification of everything after it.
 */
export interface AuditEntry { seq: number; ts: number; actor: string; action: string; data: unknown; prev: string; hash: string }
export const GENESIS = "0".repeat(64);

const canonical = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
};
async function entryHash(e: Omit<AuditEntry, "hash">) { return hex(await sha256(canonical([e.seq, e.ts, e.actor, e.action, e.data, e.prev]))); }

export async function appendAudit(prev: AuditEntry | null, actor: string, action: string, data: unknown, ts: number): Promise<AuditEntry> {
  const base = { seq: prev ? prev.seq + 1 : 0, ts, actor, action, data, prev: prev ? prev.hash : GENESIS };
  return { ...base, hash: await entryHash(base) };
}

/** Returns the index of the first broken entry, or -1 if the chain is intact. */
export async function verifyAudit(chain: readonly AuditEntry[]): Promise<number> {
  let prev = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i || e.prev !== prev || e.hash !== await entryHash(e)) return i;
    prev = e.hash;
  }
  return -1;
}
