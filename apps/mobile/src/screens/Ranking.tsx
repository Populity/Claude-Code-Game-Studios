import React, { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../store";
import { TOPICS, topicOf, type Clip } from "../data";
import { C } from "../theme";
import { Avatar, Badge, Chip, Mut, Rise, T, useNative } from "../ui/kit";

function Pod({ c, place, lang }: { c?: Clip; place: 1 | 2 | 3; lang: "ru" | "en" }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { v.setValue(0); Animated.spring(v, { toValue: 1, delay: place === 1 ? 250 : place === 2 ? 100 : 400, useNativeDriver: useNative, damping: 12, stiffness: 120 }).start(); }, [c?.id]);
  if (!c) return <View style={{ flex: 1 }} />;
  const h = { 1: 110, 2: 80, 3: 60 }[place];
  return <View style={{ flex: 1, alignItems: "center", gap: 5 }}>
    {place === 1 ? <Animated.Text style={{ fontSize: 30, marginBottom: -10, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }] }}>👑</Animated.Text> : null}
    <Avatar size={place === 1 ? 82 : 62} label={topicOf(c.topic).e} colors={topicOf(c.topic).g} />
    <Text numberOfLines={1} style={{ color: C.fg, fontWeight: "700", fontSize: 12 }}>@{c.handle}</Text><Mut style={{ fontSize: 12 }}>{c.rating}</Mut>
    <Animated.View style={[st.col, { height: h, backgroundColor: place === 1 ? "#4a3c0e" : "#222", transform: [{ scaleY: v }] }]}><Text style={st.place}>{place}</Text></Animated.View>
  </View>;
}

export function Ranking() {
  const { s, t } = useApp();
  const [topic, setTopic] = useState("all");
  const list = s.clips.filter(c => c.status !== "out" && (topic === "all" || c.topic === topic)).sort((a, b) => b.rating - a.rating);
  return <View style={{ flex: 1 }}>
    <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}><T style={{ fontSize: 22, fontWeight: "800" }}>{t("ranking")}</T></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
      {[{ id: "all", n: t("all") }, ...TOPICS.map(x => ({ id: x.id, n: `${x.e} ${x[s.lang]}` }))].map(x => <Chip key={x.id} testID={`rank-${x.id}`} label={x.n} on={topic === x.id} onPress={() => setTopic(x.id)} />)}
    </ScrollView>
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={st.podium}><Pod c={list[1]} place={2} lang={s.lang} /><Pod c={list[0]} place={1} lang={s.lang} /><Pod c={list[2]} place={3} lang={s.lang} /></View>
      {list.slice(3, 40).map((c, i) => <Rise key={c.id} i={Math.min(i, 8)} style={st.row}>
        <Text style={st.rk}>{i + 4}</Text><Avatar size={44} label={topicOf(c.topic).e} colors={topicOf(c.topic).g} />
        <View style={{ flex: 1, minWidth: 0 }}><T numberOfLines={1} style={{ fontWeight: "700" }}>@{c.handle}{c.owner === s.handle ? " ⭐" : ""}</T><Mut numberOfLines={1}>{topicOf(c.topic)[s.lang]} · {c.wins}–{c.losses}</Mut></View>
        <View><Badge status={c.status} label={c.status === "king" ? "" : t(c.status)} /></View><Text style={st.score}>{c.rating}</Text></Rise>)}
    </ScrollView>
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
