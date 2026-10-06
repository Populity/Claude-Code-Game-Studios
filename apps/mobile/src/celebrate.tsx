import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Celebrate } from "./ui/Celebrate";
import { useApp } from "./store";
import { topicOf } from "./data";
import type { Clip } from "./api";

type Fn = (clips: Clip[], after?: () => void) => void;
const Ctx = createContext<Fn>(() => {});
export const useCelebrate = () => useContext(Ctx);

/** Queues full-screen king / elimination moments one after another. */
export function CelebrateHost({ children }: { children: React.ReactNode }) {
  const { t, s } = useApp();
  const [cur, setCur] = useState<Clip | null>(null);
  const queue = useRef<Clip[]>([]), after = useRef<(() => void) | undefined>(undefined);
  const next = () => { const c = queue.current.shift() ?? null; setCur(c); if (!c) after.current?.(); };
  const fn = useCallback<Fn>((clips, a) => { queue.current.push(...clips); after.current = a; if (!cur) next(); }, [cur]);
  const n = cur ? cur.wins + cur.losses : 0;
  return <Ctx.Provider value={fn}>{children}
    {cur ? <Celebrate key={cur.id + n} kind={cur.status === "king" ? "king" : "out"}
      title={t(cur.status === "king" ? "kingT" : "outT")}
      body={`@${cur.handle} · ${topicOf(cur.topic)[s.lang]}\n${t(cur.status === "king" ? "kingD" : "outD", { p: Math.round((cur.wins / Math.max(1, n)) * 100), l: cur.losses, n })}`}
      onDone={next} /> : null}
  </Ctx.Provider>;
}
