/** Text input hardening for captions, handles and report notes. */
// Control chars (except \n \t), bidi overrides/isolates, zero-width and BOM.
const STRIP = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

/** NFKC-normalizes, strips invisible/bidi characters, collapses whitespace, caps length by code points. */
export function cleanText(input: unknown, maxLen = 220): string {
  if (typeof input !== "string") return "";
  const s = input.normalize("NFKC").replace(STRIP, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return Array.from(s).slice(0, maxLen).join("");
}

/** Handles: 2–30 of [a-z0-9._], no leading/trailing dot, no "..", lowercase. Returns null if invalid. */
export function cleanHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const h = input.normalize("NFKC").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{2,30}$/.test(h) || h.startsWith(".") || h.endsWith(".") || h.includes("..")) return null;
  if (RESERVED.has(h)) return null;
  return h;
}
const RESERVED = new Set(["admin", "root", "support", "vsv", "moderator", "system", "api", "help", "security", "instagram", "meta"]);

/** Safe identifier (ids, topics, enum values). */
export const isSafeId = (v: unknown, max = 64): v is string => typeof v === "string" && v.length > 0 && v.length <= max && /^[A-Za-z0-9_-]+$/.test(v);
