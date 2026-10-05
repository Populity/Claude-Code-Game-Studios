/**
 * Storage ports. Production implements them on Postgres (see supabase/migrations)
 * with atomic statements; the in-memory versions are for tests and local dev.
 */
export interface NonceStore {
  /** Atomically records `nonce` until `expiresAt`. Returns false if it was already used. */
  consume(nonce: string, expiresAt: number, now: number): Promise<boolean>;
}
export interface WindowStore {
  /** Appends a hit at `now` for `key` and returns hit timestamps within (now - windowMs, now]. */
  hit(key: string, now: number, windowMs: number): Promise<number[]>;
  /** Hits within the window without recording a new one. */
  peek(key: string, now: number, windowMs: number): Promise<number[]>;
}

export class MemoryNonceStore implements NonceStore {
  private used = new Map<string, number>();
  async consume(nonce: string, expiresAt: number, now: number): Promise<boolean> {
    for (const [k, exp] of this.used) if (exp <= now) this.used.delete(k);
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expiresAt); return true;
  }
}
export class MemoryWindowStore implements WindowStore {
  private hits = new Map<string, number[]>();
  private prune(key: string, now: number, windowMs: number) {
    const list = (this.hits.get(key) ?? []).filter(t => t > now - windowMs);
    this.hits.set(key, list); return list;
  }
  async hit(key: string, now: number, windowMs: number) { const l = this.prune(key, now, windowMs); l.push(now); return [...l]; }
  async peek(key: string, now: number, windowMs: number) { return [...this.prune(key, now, windowMs)]; }
}
