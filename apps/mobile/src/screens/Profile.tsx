import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../store";
import { TOPICS, topicOf } from "../data";
import { api, type Clip } from "../api";
import { errMsg } from "../errors";
import { C } from "../theme";
import { Avatar, Badge, Btn, Chip, Mut, Rise, Sheet, T, Tap } from "../ui/kit";
import { ClipMedia, useToast } from "../ui/media";
import { Icon } from "../ui/Icon";

export function Profile() {
  const { s, t, setLang, setTopics, logout, deleteAccount } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false); const [confirmDel, setConfirmDel] = useState(false); const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Clip[]>([]);
  useEffect(() => { api.myClips().then(setMine).catch(e => toast("⚠️ " + errMsg(e, t))); }, []);
  const wins = mine.reduce((n, c) => n + c.wins, 0), kings = mine.filter(c => c.status === "king").length;
  const toggleTopic = async (id: string) => {
    const next = s.topics.includes(id) ? s.topics.filter(y => y !== id) : [...s.topics, id];
    if (next.length < 3) return toast(t("min3"));
    try { await setTopics(next); } catch (e) { toast("⚠️ " + errMsg(e, t)); }
  };
  const del = async () => {
    if (busy) return; setBusy(true);
    try { await deleteAccount(); } catch (e) { setBusy(false); setConfirmDel(false); toast("⚠️ " + errMsg(e, t)); }
  };
  return <View style={{ flex: 1 }}>
    <View style={st.top}><T style={{ flex: 1, fontSize: 22, fontWeight: "800" }} numberOfLines={1}>@{s.handle}</T><Tap testID="settings" onPress={() => setOpen(true)}><Icon name="menu" /></Tap></View>
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={st.head}><Avatar size={88} label={s.handle[0]?.toUpperCase() ?? "?"} />
        <View style={st.stats}>{[[mine.length, t("clips")], [wins, t("wins")], [kings, t("kings")]].map(([n, l]) => <View key={String(l)} style={{ alignItems: "center" }}><T style={{ fontSize: 18, fontWeight: "800" }}>{n}</T><Mut>{l}</Mut></View>)}</View></View>
      <View style={{ paddingHorizontal: 16, gap: 8 }}><T style={{ fontWeight: "700" }}>{s.handle}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{s.topics.map(id => <Chip key={id} small label={`${topicOf(id).e} ${topicOf(id)[s.lang]}`} />)}</View>
        <Btn kind="sec" title={t("settings")} onPress={() => setOpen(true)} /></View>
      <View style={st.tabs}><Icon name="grid" /></View>
      {mine.length ? <View style={st.grid}>{mine.map((c, i) => <Rise key={c.id} i={i} style={{ width: "33.33%", padding: 1 }}><View style={st.cell} testID="my-clip">
        <ClipMedia clip={c} thumb /><View style={{ position: "absolute", top: 6, left: 6 }}><Badge status={c.status} label={t(c.status)} /></View>
        <View style={st.ov}><View style={{ flexDirection: "row", gap: 2 }}>{Array.from({ length: 10 }, (_, k) => <View key={k} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: c.hist[k] === 1 ? C.ok : c.hist[k] === 0 ? C.red : "rgba(255,255,255,0.25)" }} />)}</View>
          <Text style={{ color: "#fff", fontSize: 11 }}>{topicOf(c.topic)[s.lang]} · {c.rating}</Text></View></View></Rise>)}</View>
        : <View style={st.empty}><View style={st.emptyIco}><Icon name="camera" size={34} /></View><T style={{ fontSize: 20, fontWeight: "800" }}>{t("noClips")}</T><Mut style={{ textAlign: "center" }}>{t("noClipsD")}</Mut></View>}
    </ScrollView>
    <Sheet open={open} onClose={() => setOpen(false)} title={t("settings")}>
      <ScrollView>
        <Mut style={st.lbl}>{t("language")}</Mut>
        <View style={{ flexDirection: "row", gap: 10 }}>{(["ru", "en"] as const).map(l => <View key={l} style={{ flex: 1 }}><Chip testID={`set-${l}`} label={l === "ru" ? "🇷🇺 Русский" : "🇬🇧 English"} on={s.lang === l} onPress={() => setLang(l)} /></View>)}</View>
        <Mut style={st.lbl}>{t("myTopics")}</Mut>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{TOPICS.map(x => <Chip key={x.id} small label={`${x.e} ${x[s.lang]}`} on={s.topics.includes(x.id)} onPress={() => toggleTopic(x.id)} />)}</View>
        <View style={{ gap: 8, marginTop: 18 }}>
          <Btn kind="sec" title={t("logout")} onPress={() => { setOpen(false); void logout(); }} />
          <Btn testID="delete-account" kind="danger" title={t("deleteAcc")} onPress={() => { setOpen(false); setConfirmDel(true); }} /></View>
      </ScrollView>
    </Sheet>
    <Sheet open={confirmDel} onClose={() => !busy && setConfirmDel(false)} title={t("deleteT")}>
      <Mut style={{ textAlign: "center", marginBottom: 16 }}>{t("deleteD")}</Mut>
      <View style={{ gap: 8 }}><Btn testID="delete-confirm" kind="danger" title={t("deleteYes")} disabled={busy} onPress={del} /><Btn kind="sec" title={t("cancel")} disabled={busy} onPress={() => setConfirmDel(false)} /></View>
    </Sheet>
  </View>;
}
const st = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 20, paddingHorizontal: 16, paddingBottom: 12 },
  stats: { flex: 1, flexDirection: "row", justifyContent: "space-around" },
  tabs: { borderTopWidth: 1, borderColor: C.line, marginTop: 14, paddingVertical: 10, alignItems: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { aspectRatio: 9 / 16, backgroundColor: "#111", overflow: "hidden" },
  ov: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 6, gap: 4, backgroundColor: "rgba(0,0,0,0.55)" },
  empty: { alignItems: "center", padding: 40, gap: 10 },
  emptyIco: { width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: C.fg, alignItems: "center", justifyContent: "center" },
  lbl: { fontWeight: "700", marginTop: 14, marginBottom: 8 },
});
