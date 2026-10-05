import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, FlatList, Pressable, ScrollView, StyleSheet, Text, View, type GestureResponderEvent, type ViewToken } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useApp } from "../store";
import { CAPS, TOPICS, topicOf, type Clip } from "../data";
import { BRAND, C } from "../theme";
import { Avatar, Badge, Chip, Mut, T, Tap, Sheet, Btn, haptic, useNative } from "../ui/kit";
import { ClipMedia, Progress, useToast } from "../ui/media";
import { Icon } from "../ui/Icon";
import { useCelebrate } from "../celebrate";

interface Battle { key: string; pair: [Clip, Clip]; topic: string }

function Half({ clip, side, active, seen, faded, grow, onTap, onMore, lang, t }: {
  clip: Clip; side: 0 | 1; active: boolean; seen: boolean; faded: Animated.Value; grow: Animated.Value;
  onTap: (e: GestureResponderEvent) => void; onMore: () => void; lang: "ru" | "en"; t: ReturnType<typeof useApp>["t"] }) {
  const cap = typeof clip.caption === "number" ? CAPS[lang][clip.caption] : clip.caption;
  return <Animated.View style={[st.half, { flex: grow, opacity: faded }]}>
    <Pressable style={StyleSheet.absoluteFill} onPress={onTap} testID={`half-${side}`}>
      <ClipMedia clip={clip} active={active} />
      {clip.src === "demo" ? <Progress active={active} /> : null}
      <View style={st.sideTag}><Text style={st.sideTxt}>{side ? "B" : "A"}</Text></View>
      {seen ? <View style={st.seen}><Icon name="check" size={14} color="#fff" /></View> : null}
      <View style={st.meta} pointerEvents="none">
        <LinearGradient colors={["transparent", "rgba(0,0,0,0.85)"]} style={StyleSheet.absoluteFill} />
        <View style={st.who}><Avatar size={26} label={clip.handle[0].toUpperCase()} /><Text style={st.handle} numberOfLines={1}>@{clip.handle}</Text></View>
        <Badge status={clip.status} label={t(clip.status)} />
        {cap ? <Text style={st.cap} numberOfLines={2}>{cap}</Text> : null}
        <Mut style={{ fontSize: 11 }}>{t("rating")} {clip.rating} · {clip.wins + clip.losses} {t("battles")}</Mut>
      </View>
    </Pressable>
    <Tap onPress={onMore} style={st.more} testID={`more-${side}`}><Icon name="dots" size={20} color="#fff" /></Tap>
  </Animated.View>;
}

function BattleCard({ b, height, active, onDone, onReport }: { b: Battle; height: number; active: boolean; onDone: () => void; onReport: (c: Clip) => void }) {
  const { s, t, vote, update } = useApp();
  const celebrate = useCelebrate();
  const [mode, setMode] = useState(s.mode);
  const [show, setShow] = useState<0 | 1>(0);
  const [seen, setSeen] = useState<[boolean, boolean]>([s.mode === "seq", false]);
  const [result, setResult] = useState<{ side: 0 | 1; delta: number } | null>(null);
  const vs = useRef(new Animated.Value(0)).current, slide = useRef(new Animated.Value(0)).current, res = useRef(new Animated.Value(0)).current, bolt = useRef(new Animated.Value(0)).current;
  const grow = useRef([new Animated.Value(1), new Animated.Value(1)]).current, fade = useRef([new Animated.Value(1), new Animated.Value(1)]).current;
  const lastTap = useRef([0, 0]);
  const live = b.pair.map(p => s.clips.find(c => c.id === p.id) ?? p) as [Clip, Clip];

  useEffect(() => { if (active) { vs.setValue(0); Animated.spring(vs, { toValue: 1, useNativeDriver: useNative, damping: 8, stiffness: 120 }).start(); } }, [active]);
  const canVote = mode === "both" || (seen[0] && seen[1]);

  const showSide = (i: 0 | 1) => { if (result) return; setShow(i); setSeen(x => (i ? [x[0], true] : [true, x[1]])); haptic();
    Animated.spring(slide, { toValue: i, useNativeDriver: useNative, damping: 18, stiffness: 160 }).start(); };
  const setM = (m: "both" | "seq") => { if (result || m === mode) return; setMode(m); update(x => ({ ...x, mode: m })); if (m === "seq") { setShow(0); slide.setValue(0); setSeen([true, false]); } };

  const doVote = useCallback((i: 0 | 1) => {
    if (result) return;
    if (!canVote) { haptic("error"); return; }
    haptic("medium");
    const r = vote(live[i].id, live[1 - i].id);
    setResult({ side: i, delta: r.delta }); setMode("both");
    Animated.parallel([
      Animated.spring(grow[i], { toValue: 1.9, useNativeDriver: false, damping: 16, stiffness: 140 }),
      Animated.timing(fade[1 - i], { toValue: 0.35, duration: 450, useNativeDriver: false }),
      Animated.sequence([Animated.spring(bolt, { toValue: 1, useNativeDriver: false, damping: 6, stiffness: 180 }), Animated.timing(bolt, { toValue: 2, duration: 450, delay: 250, useNativeDriver: false })]),
      Animated.spring(res, { toValue: 1, delay: 200, useNativeDriver: false, damping: 10, stiffness: 120 }),
    ]).start();
    if (r.milestones.length) setTimeout(() => celebrate(r.milestones, onDone), 700); else setTimeout(onDone, 1500);
  }, [result, canVote, live]);

  const tap = (i: 0 | 1) => () => {
    const now = Date.now();
    if (now - lastTap.current[i] < 320) { lastTap.current[i] = 0; doVote(i); return; }
    lastTap.current[i] = now;
    if (mode === "seq") setTimeout(() => { if (lastTap.current[i] === now) showSide((1 - show) as 0 | 1); }, 330);
  };

  const halves = [0, 1].map(i => <Half key={i} clip={live[i]} side={i as 0 | 1} active={active && (mode === "both" || show === i)} seen={mode === "seq" && seen[i]}
    faded={fade[i]} grow={grow[i]} onTap={tap(i as 0 | 1)} onMore={() => onReport(live[i])} lang={s.lang} t={t} />);

  return <View style={{ height, paddingBottom: 10 }} testID="battle">
    <View style={st.arena}>
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
    </View>
    <View style={st.ctrl}>
      <View style={st.seg}>{(["both", "seq"] as const).map(m => <Tap key={m} testID={`mode-${m}`} onPress={() => setM(m)} style={[st.segBtn, mode === m && { backgroundColor: "#fff" }]}>
        <Text style={[st.segTxt, mode === m && { color: "#000" }]}>{t(m)}</Text></Tap>)}</View>
      {mode === "seq" && !result ? <Tap onPress={() => showSide((1 - show) as 0 | 1)} style={st.swap}><Text style={st.segTxt}>{show ? "← A" : "B →"}</Text></Tap> : null}
      <View style={{ flex: 1 }} /><Chip small label={`${topicOf(b.topic).e} ${topicOf(b.topic)[s.lang]}`} />
    </View>
    <View style={st.votes}>{[0, 1].map(i => <View key={i} style={{ flex: 1 }}>
      <Tap testID={`vote-${i}`} disabled={!canVote || (!!result && result.side !== i)} onPress={() => doVote(i as 0 | 1)}
        style={[st.vbtn, result?.side === i && { backgroundColor: C.volt }]}>
        <Icon name="bolt" size={18} color={result?.side === i ? C.ink : C.fg} fill={result?.side === i ? C.ink : "none"} />
        <Text style={[st.vtxt, result?.side === i && { color: C.ink }]}>{t("vote")} {i ? "B" : "A"}</Text></Tap></View>)}</View>
    <Mut style={{ textAlign: "center", marginTop: 8, minHeight: 18 }}>{result ? " " : canVote ? t("dblTap") : t("watchBoth")}</Mut>
  </View>;
}

export function Feed() {
  const { s, t, nextPair, update, report, block } = useApp();
  const toast = useToast();
  const [h, setH] = useState(0);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [active, setActive] = useState(0);
  const [rep, setRep] = useState<Clip | null>(null);
  const recent = useRef(new Set<string>());
  const list = useRef<FlatList<Battle>>(null);
  const [topic, setTopic] = useState("foryou");

  const make = useCallback((n: number): Battle[] => {
    const out: Battle[] = [];
    for (let k = 0; k < n; k++) for (let tries = 0; tries < 8; tries++) {
      const tp = topic !== "foryou" ? topic : s.topics[Math.floor(Math.random() * s.topics.length)] ?? "humor";
      const p = nextPair(tp, recent.current);
      if (p) { p.forEach(c => recent.current.add(c.id)); if (recent.current.size > 14) recent.current = new Set([...recent.current].slice(-14)); out.push({ key: `${Date.now()}-${Math.random()}`, pair: p, topic: tp }); break; }
    }
    return out;
  }, [topic, s.topics, s.hidden.length, s.blocked.length]);

  useEffect(() => { setBattles(make(3)); setActive(0); list.current?.scrollToOffset({ offset: 0, animated: false }); }, [topic, s.hidden.length, s.blocked.length]);
  const onView = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => { const v = viewableItems[0]; if (v?.index != null) setActive(v.index); }).current;
  const advance = (i: number) => () => { if (i + 1 < battles.length) list.current?.scrollToIndex({ index: i + 1, animated: true }); };
  const topics = ["foryou", ...s.topics, ...TOPICS.map(x => x.id).filter(x => !s.topics.includes(x))];

  return <View style={{ flex: 1 }}>
    <View style={st.top}><Text style={st.logo}>VSV</Text><T style={{ fontWeight: "700" }}>🔥 {s.streak}</T>
      <Tap testID="lang-toggle" onPress={() => update(x => ({ ...x, lang: x.lang === "ru" ? "en" : "ru" }))} style={st.lang}><Text style={{ color: C.fg, fontWeight: "800", fontSize: 13 }}>{s.lang.toUpperCase()}</Text></Tap></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 14, paddingBottom: 10, paddingTop: 4 }} style={{ flexGrow: 0, flexShrink: 0 }}>
      {topics.map(id => { const tp = id === "foryou" ? null : topicOf(id); const on = id === topic;
        return <Tap key={id} testID={`story-${id}`} onPress={() => setTopic(id)} style={{ alignItems: "center", width: 68, gap: 5 }}>
          <View style={[st.story, on && st.storyOn, !on && !s.topics.includes(id) && id !== "foryou" && { borderColor: "#444" }]}>
            <Avatar size={58} ring={false} rounded={18} label={tp ? tp.e : "✨"} colors={tp ? tp.g : [C.bg3, C.bg3]} /></View>
          <Text numberOfLines={1} style={{ color: C.fg, fontSize: 12 }}>{tp ? tp[s.lang] : t("forYou")}</Text></Tap>; })}
    </ScrollView>
    <View style={{ flex: 1 }} onLayout={e => setH(e.nativeEvent.layout.height)}>
      {h > 0 && battles.length === 0 ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}><Text style={{ fontSize: 48 }}>🥲</Text><T>{t("noPair")}</T></View> : null}
      {h > 0 ? <FlatList ref={list} data={battles} keyExtractor={b => b.key} pagingEnabled showsVerticalScrollIndicator={false} decelerationRate="fast"
        snapToInterval={h} getItemLayout={(_, i) => ({ length: h, offset: h * i, index: i })} onViewableItemsChanged={onView} viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        onEndReached={() => setBattles(b => [...b, ...make(3)])} onEndReachedThreshold={1.5} windowSize={3}
        renderItem={({ item, index }) => <BattleCard b={item} height={h} active={index === active} onDone={advance(index)} onReport={setRep} />} /> : null}
    </View>
    <Sheet open={!!rep} onClose={() => setRep(null)} title={t("reportT")}>
      {rep ? <Mut style={{ textAlign: "center", marginTop: -8, marginBottom: 8 }}>@{rep.handle}</Mut> : null}
      {(["rCopy", "rSpam", "rAbuse", "rAdult"] as const).map(k => <Tap key={k} testID={`report-${k}`} onPress={() => { report(rep!.id, k); setRep(null); haptic("success"); toast("✅ " + t("reported")); }} style={st.opt}>
        <View style={st.optIco}><Icon name="flag" size={20} /></View><T style={{ fontWeight: "600" }}>{t(k)}</T></Tap>)}
      <View style={{ marginTop: 8 }}><Btn kind="sec" title={t("hideAuthor")} onPress={() => { block(rep!.owner); setRep(null); toast("✅ " + t("hidden")); }} /></View>
    </Sheet>
  </View>;
}

const st = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  logo: { flex: 1, fontSize: 28, fontWeight: "900", fontStyle: "italic", letterSpacing: -1.5, color: C.volt },
  lang: { borderWidth: 1.5, borderColor: "#fff", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  story: { padding: 2, borderRadius: 22, borderWidth: 2, borderColor: C.mint },
  storyOn: { borderColor: C.volt, shadowColor: C.volt, shadowOpacity: 0.8, shadowRadius: 10, transform: [{ scale: 1.04 }] },
  arena: { flex: 1, position: "relative" },
  half: { overflow: "hidden", borderRadius: 4, backgroundColor: "#111", flex: 1 },
  sideTag: { position: "absolute", top: 18, left: 10, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", zIndex: 3 },
  sideTxt: { color: "#fff", fontWeight: "900", fontSize: 13 },
  seen: { position: "absolute", top: 18, right: 48, padding: 5, borderRadius: 999, backgroundColor: "rgba(0,0,0,0.6)", zIndex: 3 },
  more: { position: "absolute", top: 14, right: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", zIndex: 5 },
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
  segBtn: { paddingVertical: 6, paddingHorizontal: 11, borderRadius: 8 },
  segTxt: { color: C.mut, fontWeight: "700", fontSize: 13 },
  swap: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.bg3 },
  votes: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  vbtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: C.bg3 },
  vtxt: { color: C.fg, fontWeight: "800", fontSize: 15 },
  opt: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 10 },
  optIco: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
});
void BRAND; void Easing;
