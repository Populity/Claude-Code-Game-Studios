/** Instagram post/video shortcode from a URL, or `null` if it is not an Instagram video link. */
export function instagramShortcode(url: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([\w-]{5,})/i.exec(url.trim());
  return m ? m[1] : null;
}

/** Identity of a submitted clip: Instagram shortcode for links, content hash for files. */
export type ClipFingerprint = { kind: "instagram"; code: string } | { kind: "file"; sha256: string };

export function fingerprintKey(f: ClipFingerprint): string {
  return f.kind === "instagram" ? `ig:${f.code}` : `sha256:${f.sha256.toLowerCase()}`;
}

/** Returns the existing clip id with the same fingerprint, or `null`. */
export function findDuplicate(f: ClipFingerprint, index: ReadonlyMap<string, string>): string | null {
  return index.get(fingerprintKey(f)) ?? null;
}
