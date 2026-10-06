import { newClip, type ClipRecord, type ClipStatus } from "../src/index.ts";

/** Clip factory for tests. */
export function clip(id: string, o: Partial<ClipRecord> = {}): ClipRecord {
  return { ...newClip(id, o.topic ?? "humor", o.owner ?? `owner-${id}`), ...o };
}
export function withRecord(id: string, wins: number, losses: number, status: ClipStatus = "qual"): ClipRecord {
  return clip(id, { wins, losses, status });
}
/** Deterministic RNG cycling through fixed values. */
export function seq(...values: number[]): () => number {
  let i = 0; return () => values[i++ % values.length];
}
