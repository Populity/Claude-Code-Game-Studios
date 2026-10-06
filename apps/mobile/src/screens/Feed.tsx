import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type ViewToken } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useApp } from "../store";
import { TOPICS, topicOf } from "../data";
import { ApiError, api, mediaUrl, type BattleTicket, type Clip } from "../api";
import { errMsg } from "../errors";
import { BRAND, C } from "../theme";
import { Avatar, Badge, Chip, ErrorState, Mut, Skeleton, T, Tap, Sheet, Btn, dur, haptic, useNative } from "../ui/kit";
import { ClipMedia, Progress, useToast } from "../ui/media";
import { Icon } from "../ui/Icon";
import { useCelebrate } from "../celebrate";

type Battle = BattleTicket & { key: string; at: number };
/** Tickets live 15 min on the server; prefetched battles older than this are replaced. */
const MAX_AGE_MS = 14 * 60_000;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function Half({ clip, side, active, seen, faded, grow, onTap, onMore, onEnd, muted, t }: {
  clip: Clip; side: 0 | 1; active: boolean; muted: boolean; onEnd?: () => void; seen: boolean; faded: Animated.Value; grow: Animated.Value;
  onTap: (e: GestureResponderEvent) => void; onMore: () => void; t: ReturnType<typeof useApp>["t"] }) {
  const cap = clip.caption;
  return <Animated.View style={[st.half, { flex: grow, opacity: faded }]}>
    <Pressable style={StyleSheet.absoluteFill} onPress={onTap} testID={`half-${side}`} accessibilityLabel={`${side ? "B" : "A"} @${clip.handle}`}>
      <ClipMedia clip={clip} active={active} muted={muted} onEnd={onEnd} />
      {!clip.video && clip.src === "demo" ? <Progress active={active} /> : null}
      <View style={st.sideTag}><Text style={st.sideTxt}>{side ? "B" : "A"}</Text></View>
      {seen ? <View style={st.seen}><Icon name="check" size={14} color="#fff" /></View> : null}
      <View style={st.meta} pointerEvents="none">
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.85)"]} style={StyleSheet.absoluteFill} />
        <View style={st.who}><Avatar size={26} label={(clip.handle[0] ?? "?").toUpperCase()} /><Text style={st.handle} numberOfLines={1}>@{clip.handle}</Text></View>
        <Badge status={clip.status} label={t(clip.status)} />
        {cap ? <Text style={st.cap} numberOfLines={2}>{cap}</Text> : null}
        <Mut style={{ fontSize: 11 }}>{t("rating")} {clip.rating} · {clip.wins + clip.losses} {t("battles")}</Mut>
      </View>
    </Pressable>
    <Tap onPress={onMore} label={t("aMore")} style={st.more} testID={`more-${side}`}><Icon name="dots" size={20} color="#fff" /></Tap>
  </Animated.View>;
}

function BattleCard({ b, height, active, onDone, onReport }: { b: Battle; height: number; active: boolean; onDone: () => void; onReport: (c: Clip) => void }) {
  const { s, t, update, refreshStats } = useApp();
  const toast = useToast();
  const celebrate = useCelebrate();
  const [mode, setMode] = useState(s.mode);
  const [show, setShow] = useState<0 | 1>(0);
  const [seen, setSeen] = useState<[boolean, boolean]>([s.mode === "seq", false]);
  const [result, setResult] = useState<{ side: 0 | 1; delta: number; clips: [Clip, Clip] } | null>(null);
  const [left, setLeft] = useState(b.minWatchMs);
  const sending = useRef(false);
  const [soundSide, setSoundSide] = useState<0 | 1>(0);
  const [hint, setHint] = useState(false);
  const arenaFade = useRef(new Animated.Value(1)).current;
  const hasVideo = !!(b.a.video || b.b.video);
  const vs = useRef(new Animated.Value(0)).current, slide = useRef(new Animated.Value(0)).current, res = useRef(new Animated.Value(0)).current, bolt = useRef(new Animated.Value(0)).current;
  const grow = useRef([new Animated.Value(1), new Animated.Value(1)]).current, fade = useRef([new Animated.Value(1), new Animated.Value(1)]).current;
  const lastTap = useRef([0, 0]);
  const live: [Clip, Clip] = result ? result.clips : [b.a, b.b];

  useEffect(() => { if (active) { vs.setValue(0); Animated.spring(vs, { toValue: 1, useNativeDriver: useNative, damping: 8, stiffness: 120 }).start(); } }, [active]);
  // The server rejects votes sent before minWatchMs, so the clock starts when the battle is on screen.
  useEffect(() => {
    if (!active || result) return;
    const end = Date.now() + b.minWatchMs; setLeft(b.minWatchMs);
    const id = setInterval(() => { const l = Math.max(0, end - Date.now()); setLeft(l); if (l === 0) clearInterval(id); }, 250);
    return () => clearInterval(id);
  }, [active, b.bid]);
  // One-time hint that clips are muted (shown on the first battle that has video).
  useEffect(() => {
    if (!active || !hasVideo || !s.muted || s.unmuteHintShown) return;
    setHint(true);
    const id = setTimeout(() => { setHint(false); update(x => ({ ...x, unmuteHintShown: true })); }, 4500);
    return () => clearTimeout(id);
  }, [active, hasVideo]);
  const watched = left <= 0;
  const canVote = watched && (mode === "both" || (seen[0] && seen[1]));

  const showSide = (i: 0 | 1) => { if (result) return; setShow(i); setSeen(x => (i ? [x[0], true] : [true, x[1]])); haptic();
    Animated.spring(slide, { toValue: i, useNativeDriver: useNative, damping: 18, stiffness: 160 }).start(); };
  const setM = (m: "both" | "seq") => { if (result || m === mode) return; setMode(m); update(x => ({ ...x, mode: m })); if (m === "seq") { setShow(0); slide.setValue(0); setSeen([true, false]); } };

  const doVote = useCallback(async (i: 0 | 1) => {
    if (result || sending.current) return;
    if (!canVote) { haptic("error"); return; }
    sending.current = true; haptic("medium");
    let r; let netRetried = false;
    try {
      for (let attempt = 0; ; attempt++) {
        try { r = await api.vote({ bid: b.bid, ticket: b.ticket, choice: live[i].id }); break; }
        catch (e) {
          if (e instanceof ApiError && e.status === 425 && attempt < 3) { await sleep(800); continue; }
          // One quiet retry after a network blip (a replayed ticket will surface as the usual stale error).
          if (e instanceof ApiError && (e.code === "network" || e.code === "timeout") && !netRetried) { netRetried = true; await sleep(1200); continue; }
          throw e;
        }
      }
    } catch (e) {
      sending.current = false; haptic("error");
      const gone = e instanceof ApiError && e.status === 410;
      const stale = gone || (e instanceof ApiError && [403, 409, 425].includes(e.status));
      if (!gone) toast("⚠️ " + errMsg(e, t));
      if (stale) setTimeout(onDone, gone ? 0 : 900);
      return;
    }
    refreshStats();
    const clips: [Clip, Clip] = live.map(c => (c.id === r.winner.id ? r.winner : c.id === r.loser.id ? r.loser : c)) as [Clip, Clip];
    if (mode === "seq") { arenaFade.setValue(0.3); Animated.timing(arenaFade, { toValue: 1, duration: dur(260), useNativeDriver: false }).start(); }
    setResult({ side: i, delta: r.delta, clips }); setMode("both");
    Animated.parallel([
      Animated.spring(grow[i], { toValue: 1.9, useNativeDriver: false, damping: 16, stiffness: 140 }),
      Animated.timing(fade[1 - i], { toValue: 0.35, duration: dur(450), useNativeDriver: false }),
      Animated.sequence([Animated.spring(bolt, { toValue: 1, useNativeDriver: false, damping: 6, stiffness: 180 }), Animated.timing(bolt, { toValue: 2, duration: dur(450), delay: dur(250), useNativeDriver: false })]),
      Animated.spring(res, { toValue: 1, delay: dur(200), useNativeDriver: false, damping: 10, stiffness: 120 }),
    ]).start();
    const moments = [r.winner, r.loser].filter(c => r.milestones.includes(c.id));
    if (moments.length) setTimeout(() => celebrate(moments, onDone), 700); else setTimeout(onDone, 1500);
  }, [result, canVote, b.bid, mode]);

  const tap = (i: 0 | 1) => () => {
    const now = Date.now();
    if (now - lastTap.current[i] < 320) { lastTap.current[i] = 0; doVote(i); return; }
    lastTap.current[i] = now; setSoundSide(i);
    if (mode === "seq") setTimeout(() => { if (lastTap.current[i] === now) showSide((1 - show) as 0 | 1); }, 330);
  };

  const halves = [0, 1].map(i => <Half key={i} clip={live[i]} side={i as 0 | 1} active={active && (mode === "both" || show === i)} seen={mode === "seq" && seen[i]}
    muted={s.muted || (mode === "both" && soundSide !== i)} onEnd={mode === "seq" && i === 0 && !seen[1] && !result ? () => showSide(1) : undefined}
    faded={fade[i]} grow={grow[i]} onTap={tap(i as 0 | 1)} onMore={() => onReport(live[i])} t={t} />);

  return <View style={{ height, paddingBottom: 10 }} testID="battle">
    <Animated.View style={[st.arena, { opacity: arenaFade }]}>
      {mode === "both" ? <View style={{ flex: 1, flexDirection: "row", gap: 3 }}>{halves}</View>
        : <View style={{ flex: 1, overflow: "hidden" }}>
          <Animated.View style={{ flexDirection: "row", width: "200%", flex: 1, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: ["0%", "-50%"] }) as unknown as number }] }}>
            {halves.map((h, i) => <View key={i} style={{ width: "50%", flexDirection: "row" }}>{h}</View>)}</Animated.View></View>}
      {mode === "both" && !result ? <Animated.View pointerEvents="none" style={[st.vs, { transform: [{ scale: vs }, { rotate: vs.interpolate({ inputRange: [0, 1], outputRange: ["-180deg", "0deg"] }) }] }]}>
        <Text style={st.vsTxt}>VS</Text></Animated.View> : null}
      {result ? <>
        <Animated.View pointerEvents="none" style={[st.boltWrap, { left: result.side ? "62%" : "18%", opacity: bolt.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }),
          transform: [{ scale: bolt.interpolate({ inputRange: [0, 1, 2], outputRange: [0.2, 1.2, 1.4] }) }, { translateY: bolt.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0, -60] }) }] }]}>
          <Icon name="bolt" size={110} color="#000" width={0.8} fill={C.volt} /></Animated.View>
        <Animated.View pointerEvents="none" style={[st.result, { left: result.side ? "40%" : "8%", opacity: res, transform: [{ scale: res.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
          <Text style={st.win}>{t("win")}</Text><Text style={st.delta}>+{result.delta} {t("rating")}</Text></Animated.View></> : null}
      {hint ? <View pointerEvents="none" style={st.hint}><Text style={st.hintTxt}>{t("unmuteHint")}</Text></View> : null}
    </Animated.View>
    <View style={st.ctrl}>
      <View style={st.seg}>{(["both", "seq"] as const).map(m => <Tap key={m} testID={`mode-${m}`} onPress={() => setM(m)} style={[st.segBtn, mode === m && { backgroundColor: "#fff" }]}>
        <Text style={[st.segTxt, mode === m && { color: "#000" }]}>{t(m)}</Text></Tap>)}</View>
      {mode === "seq" && !result ? <Tap onPress={() => showSide((1 - show) as 0 | 1)} style={st.swap}><Text style={st.segTxt}>{show ? "← A" : "B →"}</Text></Tap> : null}
      <View style={{ flex: 1 }} />
      <Tap testID="mute" label={s.muted ? t("aMute") : t("aUnmute")} onPress={() => { update(x => ({ ...x, muted: !x.muted, unmuteHintShown: true })); setHint(false); }} style={st.mute}><Icon name={s.muted ? "mute" : "volume"} size={20} /></Tap><Chip small label={`${topicOf(b.topic).e} ${topicOf(b.topic)[s.lang]}`} />
    </View>
    <View style={st.votes}>{[0, 1].map(i => <View key={i} style={{ flex: 1 }}>
      <Tap testID={`vote-${i}`} label={t("aVote", { s: i ? "B" : "A" })} disabled={!canVote || (!!result && result.side !== i)} onPress={() => doVote(i as 0 | 1)}
        style={[st.vbtn, result?.side === i && { backgroundColor: C.volt }]}>
        <Icon name="bolt" size={18} color={result?.side === i ? C.ink : C.fg} fill={result?.side === i ? C.ink : "none"} />
        <Text style={[st.vtxt, result?.side === i && { color: C.ink }]}>{t("vote")} {i ? "B" : "A"}</Text></Tap></View>)}</View>
    <Mut style={{ textAlign: "center", marginTop: 8, minHeight: 18 }}>{result ? " " : !watched ? t("watchWait", { s: Math.ceil(left / 1000) }) : canVote ? t("dblTap") : t("watchBoth")}</Mut>
  </View>;
}

export function Feed({ initialTopic = "foryou", onCreate }: { initialTopic?: string; onCreate: () => void }) {
  const { s, t, update } = useApp();
  const toast = useToast();
  const [h, setH] = useState(0);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [active, setActive] = useState(0);
  const [rep, setRep] = useState<Clip | null>(null);
  const [topic, setTopic] = useState(initialTopic);
  const [phase, setPhase] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [errText, setErrText] = useState("");
  const list = useRef<FlatList<Battle>>(null);
  const run = useRef({ gen: 0, fetching: false, exhausted: false, count: 0, waiting: -1 });

  /** Fetches up to `n` more battles (one at a time) so the next ones are ready before the user swipes. */
  const fill = useCallback(async (n: number) => {
    const r = run.current; if (r.fetching || r.exhausted) return;
    const gen = r.gen; r.fetching = true;
    try {
      for (let k = 0; k < n; k++) {
        const b = await api.battle(topic === "foryou" ? undefined : topic);
        if (gen !== r.gen) return;
        [b.a, b.b].forEach(c => { if (c.poster) Image.prefetch(mediaUrl(c.poster)).catch(() => {}); });
        r.count++; setBattles(x => [...x, { ...b, key: b.bid, at: Date.now() }]); setPhase("ready");
      }
    } catch (e) {
      if (gen !== r.gen) return;
      if (e instanceof ApiError && e.code === "no_battle") { r.exhausted = true; if (r.count === 0) setPhase("empty"); }
      else if (r.count === 0) { setErrText(errMsg(e, t)); setPhase("error"); }
      else if (!(e instanceof ApiError && e.status === 401)) toast("⚠️ " + errMsg(e, t));
    } finally { if (gen === r.gen) r.fetching = false; }
  }, [topic, t]);

  const reload = useCallback((keepTopic = topic) => {
    const r = run.current; r.gen++; r.fetching = false; r.exhausted = false; r.count = 0; r.waiting = -1;
    setBattles([]); setActive(0); setPhase("loading"); setTopic(keepTopic);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [topic]);

  useEffect(() => { fill(2); }, [topic, run.current.gen]);
  // Keep two battles prefetched ahead of the active one; resolve a swipe that was waiting for the network.
  useEffect(() => {
    if (battles.length - active <= 2) fill(1);
    const w = run.current.waiting;
    if (w >= 0 && w < battles.length) { run.current.waiting = -1; list.current?.scrollToIndex({ index: w, animated: true }); }
  }, [active, battles.length]);

  const onView = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => { const v = viewableItems[0]; if (v?.index != null) setActive(v.index); }).current;
  const advance = (i: number) => () => {
    const r = run.current;
    if (i + 1 < r.count) list.current?.scrollToIndex({ index: i + 1, animated: true });
    else if (r.exhausted) { setBattles([]); setPhase("empty"); r.count = 0; }
    else { r.waiting = i + 1; fill(1); }
  };
  /** Prefetched battles may hold a blocked/reported clip or an expiring ticket, so refetch everything ahead. */
  const dropAhead = (scroll = true) => {
    const r = run.current, i = active;
    r.gen++; r.fetching = false; r.exhausted = false; r.count = i + 1; r.waiting = scroll ? i + 1 : -1;
    setBattles(x => x.slice(0, i + 1)); fill(2);
  };
  // Tickets expire server-side after 15 min: skip an expired active battle, refill expired ones ahead.
  useEffect(() => {
    const now = Date.now();
    if (battles[active] && now - battles[active].at > MAX_AGE_MS) advance(active)();
    else if (battles.slice(active + 1).some(b => now - b.at > MAX_AGE_MS)) dropAhead(false);
  }, [active, battles.length]);
  const topics = ["foryou", ...s.topics, ...TOPICS.map(x => x.id).filter(x => !s.topics.includes(x))];

  const doReport = async (reason: string) => {
    const c = rep; if (!c) return; setRep(null);
    try { await api.report(c.id, reason); haptic("success"); toast("✅ " + t("reported")); dropAhead(); } catch (e) { toast("⚠️ " + errMsg(e, t)); }
  };
  const doBlock = async () => {
    const c = rep; if (!c) return; setRep(null);
    try { await api.block(c.id); toast("✅ " + t("hidden")); dropAhead(); } catch (e) { toast("⚠️ " + errMsg(e, t)); }
  };

  return <View style={{ flex: 1 }}>
    <View style={st.top}><Text style={st.logo}>VSV</Text><T style={{ fontWeight: "700" }}>🔥 {s.stats.streak}</T>
      <Tap testID="lang-toggle" label={t("aLang")} onPress={() => { const l = s.lang === "ru" ? "en" : "ru"; update(x => ({ ...x, lang: l })); api.updateMe({ lang: l }).catch(() => {}); }} style={st.lang}><Text style={{ color: C.fg, fontWeight: "800", fontSize: 13 }}>{s.lang.toUpperCase()}</Text></Tap></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 14, paddingBottom: 10, paddingTop: 4 }} style={{ flexGrow: 0, flexShrink: 0 }}>
      {topics.map(id => { const tp = id === "foryou" ? null : topicOf(id); const on = id === topic;
        return <Tap key={id} testID={`story-${id}`} onPress={() => { if (id !== topic) reload(id); }} style={{ alignItems: "center", width: 68, gap: 5 }}>
          <View style={[st.story, on && st.storyOn, !on && !s.topics.includes(id) && id !== "foryou" && { borderColor: "#444" }]}>
            <Avatar size={58} ring={false} rounded={18} label={tp ? tp.e : "✨"} colors={tp ? tp.g : [C.bg3, C.bg3]} /></View>
          <Text numberOfLines={1} style={{ color: C.fg, fontSize: 12 }}>{tp ? tp[s.lang] : t("forYou")}</Text></Tap>; })}
    </ScrollView>
    <View style={{ flex: 1 }} onLayout={e => setH(e.nativeEvent.layout.height)}>
      {phase === "loading" ? <View style={{ flex: 1, padding: 12, gap: 10 }} testID="feed-skeleton"><View style={{ flex: 1, flexDirection: "row", gap: 3 }}><Skeleton style={{ flex: 1, borderRadius: 4 }} /><Skeleton style={{ flex: 1, borderRadius: 4 }} /></View>
        <View style={{ flexDirection: "row", gap: 8 }}><Skeleton style={{ flex: 1, height: 46, borderRadius: 12 }} /><Skeleton style={{ flex: 1, height: 46, borderRadius: 12 }} /></View></View> : null}
      {phase === "empty" ? <View style={st.center} testID="empty"><Text style={{ fontSize: 48 }}>🥲</Text><T style={{ fontSize: 20, fontWeight: "800" }}>{t("noBattleT")}</T>
        <Mut style={{ textAlign: "center" }}>{t("noBattleD")}</Mut>
        <View style={{ width: 240, gap: 8, marginTop: 8 }}><Btn kind="brand" title={t("addClip")} onPress={onCreate} /><Btn kind="sec" title={t("tryAgain")} onPress={() => reload()} /></View></View> : null}
      {phase === "error" ? <View style={st.center}><ErrorState text={errText} retryLabel={t("retry")} onRetry={() => reload()} /></View> : null}
      {h > 0 && battles.length > 0 ? <FlatList ref={list} data={battles} keyExtractor={b => b.key} pagingEnabled showsVerticalScrollIndicator={false} decelerationRate="fast"
        snapToInterval={h} getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })} onViewableItemsChanged={onView} viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        windowSize={3}
        renderItem={({ item, index }) => <BattleCard b={item} height={h} active={index === active} onDone={advance(index)} onReport={setRep} />} /> : null}
    </View>
    <Sheet open={!!rep} onClose={() => setRep(null)} title={t("reportT")}>
      {rep ? <Mut style={{ textAlign: "center", marginTop: -8, marginBottom: 8 }}>@{rep.handle}</Mut> : null}
      {(["rCopy", "rSpam", "rAbuse", "rAdult", "rOther"] as const).map(k => <Tap key={k} testID={`report-${k}`} onPress={() => doReport(k)} style={st.opt}>
        <View style={st.optIco}><Icon name="flag" size={20} /></View><T style={{ fontWeight: "600" }}>{t(k)}</T></Tap>)}
      <View style={{ marginTop: 8 }}><Btn kind="sec" title={t("hideAuthor")} onPress={doBlock} /></View>
    </Sheet>
  </View>;
}

const st = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  logo: { flex: 1, fontSize: 28, fontWeight: "900", fontStyle: "italic", letterSpacing: -1.5, color: C.volt },
  lang: { borderWidth: 1.5, borderColor: "#fff", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, minWidth: 44, alignItems: "center" },
  story: { padding: 2, borderRadius: 22, borderWidth: 2, borderColor: C.mint },
  storyOn: { borderColor: C.volt, shadowColor: C.volt, shadowOpacity: 0.8, shadowRadius: 10, transform: [{ scale: 1.04 }] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 30 },
  arena: { flex: 1, position: "relative" },
  half: { overflow: "hidden", borderRadius: 4, backgroundColor: "#111", flex: 1 },
  sideTag: { position: "absolute", top: 18, left: 10, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", zIndex: 3 },
  sideTxt: { color: "#fff", fontWeight: "900", fontSize: 13 },
  seen: { position: "absolute", top: 18, right: 48, padding: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 3 },
  more: { position: "absolute", top: 10, right: 6, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", zIndex: 5 },
  meta: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 10, paddingTop: 60, gap: 5 },
  who: { flexDirection: "row", alignItems: "center", gap: 7 },
  handle: { color: "#fff", fontWeight: "700", fontSize: 13, flexShrink: 1 },
  cap: { color: "#fff", fontSize: 12.5, opacity: 0.92 },
  vs: { position: "absolute", left: "50%", top: "44%", marginLeft: -30, marginTop: -30, width: 60, height: 60, borderRadius: 30, backgroundColor: "#000", borderWidth: 3, borderColor: C.volt, alignItems: "center", justifyContent: "center", zIndex: 4 },
  vsTxt: { color: C.volt, fontWeight: "900", fontStyle: "italic", fontSize: 20 },
  boltWrap: { position: "absolute", top: "30%", zIndex: 7 },
  result: { position: "absolute", top: "58%", zIndex: 6, alignItems: "center" },
  win: { color: "#fff", fontSize: 38, fontWeight: "900", textShadowColor: "#000", textShadowRadius: 20 },
  delta: { color: C.ok, fontSize: 16, fontWeight: "800", textShadowColor: "#000", textShadowRadius: 8 },
  ctrl: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  seg: { flexDirection: "row", backgroundColor: C.bg3, borderRadius: 10, padding: 3 },
  segBtn: { paddingVertical: 10, paddingHorizontal: 11, borderRadius: 8 },
  segTxt: { color: C.mut, fontWeight: "700", fontSize: 13 },
  swap: { paddingVertical: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.bg3 },
  mute: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
  hint: { position: "absolute", top: 12, alignSelf: "center", backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, zIndex: 8 },
  hintTxt: { color: "#fff", fontSize: 12, fontWeight: "600" },
  votes: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  vbtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: C.bg3 },
  vtxt: { color: C.fg, fontWeight: "800", fontSize: 15 },
  opt: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10 },
  optIco: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
});
void BRAND; void Easing;
