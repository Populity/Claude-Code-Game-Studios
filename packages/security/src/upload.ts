/** Server-side upload validation: never trust the client's MIME type or file name. */
export type VideoContainer = "mp4" | "mov" | "webm" | "mkv" | "3gp";
export interface UploadPolicy { maxBytes: number; minBytes: number; allowed: readonly VideoContainer[] }
export const DEFAULT_UPLOAD_POLICY: UploadPolicy = { maxBytes: 200 * 1024 * 1024, minBytes: 10 * 1024, allowed: ["mp4", "mov", "webm", "3gp"] };

/** Detects the container from magic bytes (first 16 bytes are enough). */
export function sniffContainer(head: Uint8Array): VideoContainer | null {
  const ascii = (o: number, n: number) => String.fromCharCode(...head.slice(o, o + n));
  if (head.length >= 12 && ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand === "qt  ") return "mov";
    if (brand.startsWith("3g")) return "3gp";
    return "mp4"; // isom, iso2, mp41, mp42, avc1, M4V , dash…
  }
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    // EBML: webm and mkv share the header; DocType string follows within the first bytes.
    return ascii(0, Math.min(head.length, 64)).includes("webm") ? "webm" : "mkv";
  }
  return null;
}

export type UploadRejection = "too_small" | "too_large" | "unknown_format" | "format_not_allowed";
export function validateUpload(head: Uint8Array, declaredBytes: number, p: UploadPolicy = DEFAULT_UPLOAD_POLICY):
  { ok: true; container: VideoContainer } | { ok: false; reason: UploadRejection } {
  if (!Number.isFinite(declaredBytes) || declaredBytes < p.minBytes) return { ok: false, reason: "too_small" };
  if (declaredBytes > p.maxBytes) return { ok: false, reason: "too_large" };
  const c = sniffContainer(head);
  if (!c) return { ok: false, reason: "unknown_format" };
  if (!p.allowed.includes(c)) return { ok: false, reason: "format_not_allowed" };
  return { ok: true, container: c };
}
