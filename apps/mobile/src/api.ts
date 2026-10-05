import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import type { ClipStatus } from "./core";

/** Web is served next to the API (same origin); native talks to the public host. */
export const API_BASE: string = Platform.OS === "web"
  ? process.env.EXPO_PUBLIC_API_URL ?? ""
  : process.env.EXPO_PUBLIC_API_URL ?? "https://45-128-234-165.sslip.io";

/** A clip as the API returns it. */
export interface Clip {
  id: string; handle: string; topic: string; caption: string; src: "file" | "link" | "demo"; code: string | null;
  video: string | null; wins: number; losses: number; rating: number; status: ClipStatus; hist: number[]; ts: number;
}
export interface Me { id: string; handle: string; lang: "ru" | "en"; topics: string[] }
export interface BattleTicket { bid: string; ticket: string; topic: string; minWatchMs: number; a: Clip; b: Clip }
export interface VoteResult { delta: number; winner: Clip; loser: Clip; milestones: string[] }

/** HTTP/network failure: `code` is the server's `error` string, or `network` / `timeout`. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, public data: Record<string, unknown> = {}) { super(`${status} ${code}`); }
}

const TOKEN_KEY = "vsv.token", DEVICE_KEY = "vsv.device";
let token: string | null = null;
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

export async function loadToken(): Promise<string | null> {
  try { token = await AsyncStorage.getItem(TOKEN_KEY); } catch { token = null; }
  return token;
}
async function saveToken(t: string) { token = t; await AsyncStorage.setItem(TOKEN_KEY, t).catch(() => {}); }
export async function clearToken() { token = null; await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {}); }
export const hasToken = () => !!token;

/** Stable random id for this install (sent once at registration). */
export async function deviceId(): Promise<string> {
  try { const d = await AsyncStorage.getItem(DEVICE_KEY); if (d) return d; } catch { /* fall through */ }
  const id = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_KEY, id).catch(() => {});
  return id;
}

export const mediaUrl = (path: string) => `${API_BASE}${path}`;

async function request<T>(method: string, path: string, opts: { body?: unknown; auth?: boolean; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 12_000);
  opts.signal?.addEventListener("abort", () => ctl.abort());
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: ctl.signal });
  } catch {
    throw new ApiError(0, ctl.signal.aborted ? "timeout" : "network");
  } finally { clearTimeout(timer); }
  let data: Record<string, unknown> | unknown[] = {};
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    const d = (Array.isArray(data) ? {} : data) as Record<string, unknown>;
    if (res.status === 401 && opts.auth !== false) onUnauthorized?.();
    throw new ApiError(res.status, typeof d.error === "string" ? d.error : "http_error", d);
  }
  return data as T;
}

export const api = {
  async register(p: { handle: string; lang: "ru" | "en"; topics: string[] }): Promise<Me> {
    const r = await request<{ token: string; user: Me }>("POST", "/api/auth/register", { auth: false, body: { ...p, device: await deviceId() } });
    await saveToken(r.token);
    return r.user;
  },
  me: () => request<Me>("GET", "/api/me"),
  updateMe: (p: { lang?: "ru" | "en"; topics?: string[] }) => request<{ ok: true }>("PUT", "/api/me", { body: p }),
  async deleteMe() { await request<{ ok: true }>("DELETE", "/api/me"); await clearToken(); },
  battle: (topic?: string) => request<BattleTicket>("GET", `/api/battle${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`),
  vote: (p: { bid: string; ticket: string; choice: string }) => request<VoteResult>("POST", "/api/vote", { body: p }),
  ranking: (topic?: string) => request<Clip[]>("GET", `/api/ranking${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`),
  myClips: () => request<Clip[]>("GET", "/api/my/clips"),
  topics: () => request<Record<string, number>>("GET", "/api/topics"),
  report: (clip: string, reason: string) => request<{ ok: true }>("POST", "/api/reports", { body: { clip, reason } }),
  block: (clip: string) => request<{ ok: true }>("POST", "/api/blocks", { body: { clip } }),
  addLink: (p: { url: string; topic: string; caption: string }) => request<Clip>("POST", "/api/clips/link", { body: p }),
};

/** Longest query string we send (the server rejects URLs over 2048 chars). */
const MAX_CAPTION_ENCODED = 1200;
const fitCaption = (c: string) => { let s = c; while (encodeURIComponent(s).length > MAX_CAPTION_ENCODED) s = s.slice(0, -1); return s; };

/** Uploads a video as a raw body (with progress 0..1). */
export async function uploadClip(file: { uri: string; mime?: string }, p: { topic: string; caption: string }, onProgress?: (f: number) => void): Promise<Clip> {
  let blob: Blob;
  try { blob = await (await fetch(file.uri)).blob(); } catch { throw new ApiError(0, "read_failed"); }
  return new Promise<Clip>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${API_BASE}/api/clips/upload?topic=${encodeURIComponent(p.topic)}&caption=${encodeURIComponent(fitCaption(p.caption))}`);
    if (token) x.setRequestHeader("Authorization", `Bearer ${token}`);
    x.setRequestHeader("x-rights-confirmed", "1");
    x.setRequestHeader("Content-Type", blob.type || file.mime || "video/mp4");
    x.timeout = 10 * 60_000;
    x.upload.onprogress = e => { if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total); };
    x.onload = () => {
      let d: Record<string, unknown> = {};
      try { d = JSON.parse(x.responseText); } catch { /* ignore */ }
      if (x.status >= 200 && x.status < 300) return resolve(d as unknown as Clip);
      if (x.status === 401) onUnauthorized?.();
      reject(new ApiError(x.status, typeof d.error === "string" ? d.error : "http_error", d));
    };
    x.onerror = () => reject(new ApiError(0, "network"));
    x.ontimeout = () => reject(new ApiError(0, "timeout"));
    x.send(blob);
  });
}
