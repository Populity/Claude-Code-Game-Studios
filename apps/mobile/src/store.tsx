import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError, api, clearToken, loadToken, setUnauthorizedHandler } from "./api";
import { tr, type Key, type Lang } from "./i18n";

export type Step = "lang" | "intro1" | "intro2" | "login" | "consent" | "topics" | "main";
export interface Consent { media: boolean; notif: boolean; analytics: boolean }
/** Device-side state; clips, ratings and votes live on the server. */
export interface State {
  v: 2; step: Step; lang: Lang; handle: string; consent: Consent; topics: string[];
  mode: "both" | "seq"; votes: number;
}
const KEY = "vsv.app.v2";
const fresh = (): State => ({ v: 2, step: "lang", lang: "ru", handle: "", consent: { media: true, notif: true, analytics: true }, topics: [], mode: "both", votes: 0 });

function useStoreImpl() {
  const [s, setS] = useState<State | null>(null);
  const ref = useRef<State | null>(null); ref.current = s;

  const persist = (next: State) => { AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {}); };
  const update = useCallback((fn: (s: State) => State) => setS(prev => {
    if (!prev) return prev; const next = fn(prev); persist(next); return next;
  }), []);
  const t = useCallback((k: Key, v?: Record<string, string | number>) => tr(ref.current?.lang ?? "ru", k, v), [s?.lang]);

  /** Drops the session and returns to the login step (keeps language). */
  const logout = useCallback(async () => { await clearToken(); update(x => ({ ...fresh(), lang: x.lang, step: "login" })); }, [update]);

  useEffect(() => {
    let alive = true;
    (async () => {
      let st = fresh();
      try { const raw = await AsyncStorage.getItem(KEY); const p = raw ? JSON.parse(raw) as State : null; if (p?.v === 2) st = p; } catch { /* first run */ }
      const tok = await loadToken();
      if (tok) {
        try { const me = await api.me(); st = { ...st, step: "main", handle: me.handle, lang: me.lang, topics: me.topics }; }
        catch (e) {
          if (e instanceof ApiError && e.status === 401) { await clearToken(); st = { ...fresh(), lang: st.lang }; }
          else if (st.step !== "main") st = { ...fresh(), lang: st.lang }; // offline and nothing cached
        }
      } else if (st.step === "main") st = { ...fresh(), lang: st.lang, step: "login" };
      if (!alive) return;
      persist(st); setS(st);
      setUnauthorizedHandler(() => { void logout(); });
    })();
    return () => { alive = false; setUnauthorizedHandler(null); };
  }, [logout]);

  return useMemo(() => ({
    s, t, update, logout,
    /** Creates the account from the onboarding choices and enters the app. */
    async register() {
      const st = ref.current!;
      const me = await api.register({ handle: st.handle, lang: st.lang, topics: st.topics });
      update(x => ({ ...x, step: "main", handle: me.handle, lang: me.lang, topics: me.topics }));
    },
    /** Changes the language locally and on the server (best effort). */
    setLang(lang: Lang) { update(x => ({ ...x, lang })); api.updateMe({ lang }).catch(() => {}); },
    /** Saves the topic list on the server first; throws on failure so the UI can keep the old list. */
    async setTopics(topics: string[]) { await api.updateMe({ topics }); update(x => ({ ...x, topics })); },
    async deleteAccount() { await api.deleteMe(); update(x => ({ ...fresh(), lang: x.lang, step: "login" })); },
  }), [s, t, update, logout]);
}

type Store = ReturnType<typeof useStoreImpl>;
const Ctx = createContext<Store | null>(null);
export function StoreProvider({ children }: { children: React.ReactNode }) { const v = useStoreImpl(); return <Ctx.Provider value={v}>{children}</Ctx.Provider>; }
export function useStore() { const v = useContext(Ctx); if (!v) throw new Error("StoreProvider missing"); return v; }
/** Store with state guaranteed loaded (use below the loading gate). */
export function useApp() { const v = useStore(); return { ...v, s: v.s! }; }
