import React, { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useApp } from "../store";
import { TOPICS } from "../data";
import { api } from "../api";
import { C } from "../theme";
import { Rise, Skeleton, T, Tap, Mut } from "../ui/kit";
import { Icon } from "../ui/Icon";

export function Explore({ openTopic }: { openTopic: (id: string) => void }) {
  const { s, t } = useApp();
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<Record<string, number> | null>(null); const [failed, setFailed] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const load = async () => { setFailed(false); try { setCounts(await api.topics()); } catch { setFailed(true); } };
  useEffect(() => { load(); }, []);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const list = TOPICS.filter(x => !q || `${x.ru} ${x.en}`.toLowerCase().includes(q.toLowerCase()));
  return <View style={{ flex: 1 }}>
    <View style={st.top}><T style={st.h}>{t("explore")}</T></View>
    <View style={st.search}><Icon name="search" size={18} color={C.mut} /><TextInput testID="search" value={q} onChangeText={setQ} placeholder={t("searchPh")} placeholderTextColor={C.mut} style={{ flex: 1, color: C.fg, fontSize: 15 }} /></View>
    {failed ? <Tap testID="explore-retry" label={t("retry")} onPress={load} style={st.fail}><Mut>{t("loadFailed")} · {t("retry")}</Mut></Tap> : null}
    <ScrollView contentContainerStyle={st.grid} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.volt} />}>
      {list.map((x, i) => { const n = counts?.[x.id] ?? 0;
        return <Rise key={x.id} i={i} style={{ width: "33.33%", padding: 1 }}>
          <Tap testID={`tile-${x.id}`} label={`${x[s.lang]}${counts ? `, ${t("clipsN", { n })}` : ""}`} onPress={() => openTopic(x.id)} scale={0.95} style={[st.tile, i % 5 === 1 && { aspectRatio: 3 / 5 }]}>
            <LinearGradient colors={x.g} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Text style={{ fontSize: 38 }}>{x.e}</Text><Text style={st.n}>{x[s.lang]}</Text>{counts ? <Text style={st.c}>{t("clipsN", { n })}</Text> : <Skeleton style={{ width: 54, height: 10 }} />}</Tap></Rise>; })}
    </ScrollView>
  </View>;
}
const st = StyleSheet.create({
  fail: { marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: C.bg3, alignItems: "center" },
  top: { paddingHorizontal: 16, paddingVertical: 10 }, h: { fontSize: 22, fontWeight: "800" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, backgroundColor: C.bg3 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingBottom: 30 },
  tile: { aspectRatio: 3 / 4, alignItems: "center", justifyContent: "center", gap: 4, overflow: "hidden" },
  n: { color: "#fff", fontWeight: "800", fontSize: 13, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 6 }, c: { color: "#fff", fontSize: 11, opacity: 0.9 },
});
