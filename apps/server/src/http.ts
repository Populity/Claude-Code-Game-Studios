import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  status: number; code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

/** For every API response: nothing it returns may run script, be framed or be embedded cross-origin. */
export const API_LOCKDOWN: Record<string, string> = {
  "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
};
const SEC_HEADERS: Record<string, string> = {
  ...API_LOCKDOWN, "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
};
export function send(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, { ...SEC_HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data), ...extra });
  res.end(data);
}

/** Reads a JSON body with a hard size cap; rejects other content types. */
export async function readJson<T = Record<string, unknown>>(req: IncomingMessage, max = 16 * 1024): Promise<T> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "json_required");
  let size = 0; const chunks: Buffer[] = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, "body_too_large"); chunks.push(c as Buffer); }
  try { const v = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!v || typeof v !== "object" || Array.isArray(v)) throw 0; return v as T; }
  catch { throw new HttpError(400, "bad_json"); }
}

/**
 * Client IP. Behind our own Caddy the right-most X-Forwarded-For entry is the one Caddy
 * appended (the real peer); left-most entries are client-controlled and ignored.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  const xff = req.headers["x-forwarded-for"];
  if (trustProxy && typeof xff === "string" && xff) return xff.split(",").map(s => s.trim()).filter(Boolean).pop()!;
  return req.socket.remoteAddress ?? "0.0.0.0";
}
