import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { applyVote, findDuplicate, newClip, pickPair, type ClipRecord } from "./core";
import { seedClips, type Clip } from "./data";
import { tr, type Key, type Lang } from "./i18n";

export type Step = "lang" | "intro1" | "intro2" | "login" | "consent" | "topics" | "main";
export interface Consent { media: boolean; notif: boolean; analytics: boolean }
export interface State {
  v: 1; step: Step; lang: Lang; handle: string; consent: Consent; topics: string[];
  clips: Clip[]; hidden: string[]; blocked: string[]; reports: { id: string; reason: string; ts: number }[];
  mode: "both" | "seq"; streak: number;
}
const KEY = "vsv.trial.v1";
const fresh = (): State => ({ v: 1, step: "lang", lang: "ru", handle: "", consent: { media: true, notif: true, analytics: true }, topics: [],
  clips: seedClips(), hidden: [], blocked: [], reports: [], mode: "both", streak: 1 });

/** Fingerprint index for duplicate detection (Instagram shortcode or file fingerprint). */
export function fingerprintIndex(clips: Clip[]) {
  const m = new Map<string, string>();
  for (const c of clips) { if (c.code) m.set(`ig:${c.code}`, c.id); if (c.fingerprint) m.set(`sha256:${c.fingerprint}`, c.id); }
  return m;
}

function useStoreImpl() {
  const [s, setS] = useState<State | null>(null);
  const ref = useRef<State | null>(null); ref.current = s;
  useEffect(() => { AsyncStorage.getItem(KEY).then(raw => {
    try { const p = raw ? JSON.parse(raw) as State : null; setS(p?.v === 1 ? p : fresh()); } catch { setS(fresh()); }
  }).catch(() => setS(fresh())); }, []);
  const update = useCallback((fn: (s: State) => State) => setS(prev => {
    if (!prev) return prev; const next = fn(prev); AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {}); return next;
  }), []);
  const t = useCallback((k: Key, v?: Record<string, string | number>) => tr(ref.current?.lang ?? "ru", k, v), [s?.lang]);

  const replace = (clips: Clip[], ...changed: ClipRecord[]) => clips.map(c => { const u = changed.find(x => x.id === c.id); return u ? { ...c, ...u } : c; });

  return useMemo(() => ({
    s, t, update,
    /** Next battle for the viewer; never their own, hidden or blocked clips. */
    nextPair(topic: string, recent: Set<string>) {
      const st = ref.current!; return pickPair(st.clips, topic, Math.random, { recent, hidden: new Set(st.hidden), blockedOwners: new Set(st.blocked), viewer: st.handle }) as [Clip, Clip] | null;
    },
    /** Applies a vote with the shared rules; returns rating delta and king/out milestones. */
    vote(winnerId: string, loserId: string) {
      const st = ref.current!; const w = st.clips.find(c => c.id === winnerId)!, l = st.clips.find(c => c.id === loserId)!;
      const r = applyVote(w, l);
      update(x => ({ ...x, clips: replace(x.clips, r.winner, r.loser).map(c => c.id === w.id ? { ...c, hist: [...c.hist, 1] } : c.id === l.id ? { ...c, hist: [...c.hist, 0] } : c) }));
      return { delta: r.delta, milestones: r.milestones.map(m => ({ ...st.clips.find(c => c.id === m.id)!, ...m })) as Clip[] };
    },
    duplicateOf(f: { code?: string; fingerprint?: string }) {
      const idx = fingerprintIndex(ref.current!.clips);
      const id = f.code ? findDuplicate({ kind: "instagram", code: f.code }, idx) : f.fingerprint ? findDuplicate({ kind: "file", sha256: f.fingerprint }, idx) : null;
      return id ? ref.current!.clips.find(c => c.id === id) ?? null : null;
    },
    addClip(p: { topic: string; caption: string; src: "file" | "link"; uri?: string; code?: string; fingerprint?: string }) {
      const st = ref.current!;
      const c: Clip = { ...newClip(`u-${Date.now().toString(36)}`, p.topic, st.handle), handle: st.handle, caption: p.caption, src: p.src, uri: p.uri, code: p.code, fingerprint: p.fingerprint, hist: [], ts: Date.now() };
      update(x => ({ ...x, clips: [...x.clips, c] })); return c;
    },
    /** Demo only: plays up to 10 battles for each of the user's live clips. */
    simulateMine() {
      const st = ref.current!; let clips = st.clips; const milestones: Clip[] = [];
      for (const mine of clips.filter(c => c.owner === st.handle && c.status !== "out")) {
        const p = Math.random();
        for (let k = 0; k < 10; k++) {
          const me = clips.find(c => c.id === mine.id)!; if (me.status === "out") break;
          const opp = clips.find(c => c.topic === me.topic && c.id !== me.id && c.status !== "out" && c.owner !== st.handle); if (!opp) break;
          const won = Math.random() < p; const r = won ? applyVote(me, opp) : applyVote(opp, me);
          clips = replace(clips, r.winner, r.loser).map(c => c.id === me.id ? { ...c, hist: [...c.hist, won ? 1 : 0] } : c);
          r.milestones.filter(m => m.id === me.id).forEach(m => milestones.push(clips.find(c => c.id === m.id)!));
        }
      }
      update(x => ({ ...x, clips })); return milestones;
    },
    report(id: string, reason: string) { update(x => ({ ...x, hidden: [...x.hidden, id], reports: [...x.reports, { id, reason, ts: Date.now() }] })); },
    block(handle: string) { update(x => ({ ...x, blocked: [...x.blocked, handle] })); },
    resetDemo() { update(x => ({ ...fresh(), lang: x.lang, handle: x.handle, topics: x.topics, consent: x.consent, step: "main" })); },
    logout() { update(x => ({ ...fresh(), lang: x.lang, step: "login" })); },
  }), [s, t, update]);
}

type Store = ReturnType<typeof useStoreImpl>;
const Ctx = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: React.ReactNode }) { const v = useStoreImpl(); return <Ctx.Provider value={v}>{children}</Ctx.Provider>; }
export function useStore() { const v = useContext(Ctx); if (!v) throw new Error("StoreProvider missing"); return v; }
/** Store with state guaranteed loaded (use below the loading gate). */
export function useApp() { const v = useStore(); return { ...v, s: v.s! }; }
