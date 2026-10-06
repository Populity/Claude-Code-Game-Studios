import React, { useEffect, useRef, useState } from "react";
import { Animated, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../store";
import { TOPICS, topicOf } from "../data";
import { api, type Clip } from "../api";
import { errMsg } from "../errors";
import { C } from "../theme";
import { PosterThumb } from "../ui/media";
import { Badge, Chip, ErrorState, Mut, Rise, Skeleton, T, Tap, useNative } from "../ui/kit";
import { ClipSheet } from "../ui/ClipSheet";

function Pod({ c, place, onOpen }: { c?: Clip; place: 1 | 2 | 3; onOpen: (c: Clip) => void }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { v.setValue(0); Animated.spring(v, { toValue: 1, delay: place === 1 ? 250 : place === 2 ? 100 : 400, useNativeDriver: useNative, damping: 12, stiffness: 120 }).start(); }, [c?.id]);
  if (!c) return <View style={{ flex: 1 }} />;
  const h = { 1: 110, 2: 80, 3: 60 }[place];
  return <Tap testID={`pod-${place}`} label={`${place}. @${c.handle}`} onPress={() => onOpen(c)} scale={0.97} style={{ flex: 1, alignItems: "center", gap: 5 }}>
    {place === 1 ? <Animated.Text style={{ fontSize: 30, marginBottom: -10, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }] }}>👑</Animated.Text> : null}
    <PosterThumb clip={c} size={place === 1 ? 82 : 62} />
    <Text numberOfLines={1} style={{ color: C.fg, fontWeight: "700", fontSize: 12 }}>@{c.handle}</Text><Mut style={{ fontSize: 12 }}>{c.rating}</Mut>
    <Animated.View style={[st.col, { height: h, backgroundColor: place === 1 ? "#4a3c0e" : "#222", transform: [{ scaleY: v }] }]}><Text style={st.place}>{place}</Text></Animated.View>
  </Tap>;
}

export function Ranking() {
  const { s, t } = useApp();
  const [topic, setTopic] = useState("all");
  const [list, setList] = useState<Clip[] | null>(null); const [err, setErr] = useState("");
  const [refreshing, setRefreshing] = useState(false); const [sel, setSel] = useState<Clip | null>(null);
  const load = async (soft = false) => {
    if (!soft) { setList(null); } setErr("");
    try { setList(await api.ranking(topic === "all" ? undefined : topic)); } catch (e) { setErr(errMsg(e, t)); setList(x => x ?? []); }
  };
  useEffect(() => { let alive = true; (async () => { await load(); if (!alive) return; })(); return () => { alive = false; }; }, [topic]);
  const refresh = async () => { setRefreshing(true); await load(true); setRefreshing(false); };
  return <View style={{ flex: 1 }}>
    <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}><T style={{ fontSize: 22, fontWeight: "800" }}>{t("ranking")}</T></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
      {[{ id: "all", n: t("all") }, ...TOPICS.map(x => ({ id: x.id, n: `${x.e} ${x[s.lang]}` }))].map(x => <Chip key={x.id} testID={`rank-${x.id}`} label={x.n} on={topic === x.id} onPress={() => setTopic(x.id)} />)}
    </ScrollView>
    {list === null ? <View testID="rank-skeleton" style={{ flex: 1 }}>
      <View style={st.podium}>{[80, 110, 60].map((h, i) => <View key={i} style={{ flex: 1, alignItems: "center", gap: 6 }}><Skeleton style={{ width: i === 1 ? 82 : 62, height: i === 1 ? 82 : 62, borderRadius: 41 }} /><Skeleton style={{ width: "100%", height: h, borderRadius: 12 }} /></View>)}</View>
      {[0, 1, 2, 3, 4].map(i => <View key={i} style={st.row}><Skeleton style={{ width: 22, height: 14 }} /><Skeleton style={{ width: 44, height: 44, borderRadius: 22 }} /><View style={{ flex: 1, gap: 6 }}><Skeleton style={{ width: "50%", height: 14 }} /><Skeleton style={{ width: "30%", height: 12 }} /></View></View>)}</View>
    : err && list.length === 0 ? <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.volt} />}><ErrorState text={err} retryLabel={t("retry")} onRetry={() => load()} /></ScrollView>
    : <ScrollView contentContainerStyle={{ paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.volt} />}>
      {err ? <Mut style={{ textAlign: "center", padding: 16 }}>{err}</Mut> : null}
      <View style={st.podium}><Pod c={list[1]} place={2} onOpen={setSel} /><Pod c={list[0]} place={1} onOpen={setSel} /><Pod c={list[2]} place={3} onOpen={setSel} /></View>
      {list.slice(3, 40).map((c, i) => <Rise key={c.id} i={Math.min(i, 8)}><Tap testID="rank-row" label={`${i + 4}. @${c.handle}`} onPress={() => setSel(c)} scale={0.98} style={st.row}>
        <Text style={st.rk}>{i + 4}</Text><PosterThumb clip={c} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}><T numberOfLines={1} style={{ fontWeight: "700" }}>@{c.handle}{c.handle === s.handle ? " ⭐" : ""}</T><Mut numberOfLines={1}>{topicOf(c.topic)[s.lang]} · {c.wins}–{c.losses}</Mut></View>
        <View><Badge status={c.status} label={c.status === "king" ? "" : t(c.status)} /></View><Text style={st.score}>{c.rating}</Text></Tap></Rise>)}
    </ScrollView>}
    <ClipSheet clip={sel} onClose={() => setSel(null)} />
  </View>;
}
const st = StyleSheet.create({
  podium: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 16, paddingTop: 30, paddingBottom: 18 },
  col: { width: "100%", borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: "center", paddingTop: 8, transformOrigin: "bottom" },
  place: { color: C.fg, fontWeight: "900", fontSize: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 9 },
  rk: { width: 22, textAlign: "center", color: C.mut, fontWeight: "700" },
  score: { color: C.fg, fontWeight: "800", width: 44, textAlign: "right" },
});
