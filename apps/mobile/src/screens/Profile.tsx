import React, { useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useApp } from "../store";
import { TOPICS, topicOf } from "../data";
import { api, type Clip } from "../api";
import { errMsg } from "../errors";
import { C } from "../theme";
import { Avatar, Badge, Btn, Chip, ErrorState, Mut, Rise, Sheet, Skeleton, T, Tap } from "../ui/kit";
import { ClipMedia, useToast } from "../ui/media";
import { Icon } from "../ui/Icon";

export function Profile() {
  const { s, t, setLang, setTopics, logout, deleteAccount, refreshStats } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false); const [confirmDel, setConfirmDel] = useState(false); const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Clip[] | null>(null); const [loadErr, setLoadErr] = useState(false); const [refreshing, setRefreshing] = useState(false);
  const [sel, setSel] = useState<Clip | null>(null); const [confirmClip, setConfirmClip] = useState(false);
  const load = async () => { setLoadErr(false); refreshStats(); try { setMine(await api.myClips()); } catch { setLoadErr(true); setMine(x => x ?? []); } };
  useEffect(() => { load(); }, []);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const { clips: nClips, wins, kings } = s.stats;
  const toggleTopic = async (id: string) => {
    const next = s.topics.includes(id) ? s.topics.filter(y => y !== id) : [...s.topics, id];
    if (next.length < 3) return toast(t("min3"));
    try { await setTopics(next); } catch (e) { toast("⚠️ " + errMsg(e, t)); }
  };
  const delClip = async () => {
    const c = sel; if (!c || busy) return; setBusy(true);
    try { await api.deleteClip(c.id); setMine(m => (m ?? []).filter(x => x.id !== c.id)); toast("✅ " + t("clipDeleted")); refreshStats(); }
    catch (e) { toast("⚠️ " + errMsg(e, t)); }
    setBusy(false); setConfirmClip(false); setSel(null);
  };
  const del = async () => {
    if (busy) return; setBusy(true);
    try { await deleteAccount(); } catch (e) { setBusy(false); setConfirmDel(false); toast("⚠️ " + errMsg(e, t)); }
  };
  return <View style={{ flex: 1 }}>
    <View style={st.top}><T style={{ flex: 1, fontSize: 22, fontWeight: "800" }} numberOfLines={1}>@{s.handle}</T><Tap testID="settings" label={t("aSettings")} onPress={() => setOpen(true)} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Icon name="menu" /></Tap></View>
    <ScrollView contentContainerStyle={{ paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.volt} />}>
      <View style={st.head}><Avatar size={88} label={s.handle[0]?.toUpperCase() ?? "?"} />
        <View style={st.stats}>{[[nClips || (mine?.length ?? 0), t("clips")], [wins, t("wins")], [kings, t("kings")]].map(([n, l]) => <View key={String(l)} style={{ alignItems: "center" }}><T style={{ fontSize: 18, fontWeight: "800" }}>{n}</T><Mut>{l}</Mut></View>)}</View></View>
      <View style={{ paddingHorizontal: 16, gap: 8 }}><T style={{ fontWeight: "700" }}>{s.handle}</T>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{s.topics.map(id => <Chip key={id} small label={`${topicOf(id).e} ${topicOf(id)[s.lang]}`} />)}</View>
        <Btn kind="sec" title={t("settings")} onPress={() => setOpen(true)} /></View>
      <View style={st.tabs}><Icon name="grid" /></View>
      {mine === null ? <View style={st.grid} testID="profile-skeleton">{[0, 1, 2].map(i => <View key={i} style={{ width: "33.33%", padding: 1 }}><Skeleton style={{ aspectRatio: 9 / 16, borderRadius: 0 }} /></View>)}</View>
        : loadErr && mine.length === 0 ? <ErrorState text={t("loadFailed")} retryLabel={t("retry")} onRetry={load} />
        : mine.length ? <View style={st.grid}>{mine.map((c, i) => <Rise key={c.id} i={i} style={{ width: "33.33%", padding: 1 }}><Tap onPress={() => setSel(c)} label={`${topicOf(c.topic)[s.lang]}, ${c.rating}`} scale={0.97} style={st.cell} testID="my-clip">
        <ClipMedia clip={c} thumb /><View style={{ position: "absolute", top: 6, left: 6 }}><Badge status={c.status} label={t(c.status)} /></View>
        <View style={st.ov}><View style={{ flexDirection: "row", gap: 2 }}>{Array.from({ length: 10 }, (_, k) => <View key={k} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: c.hist[k] === 1 ? C.ok : c.hist[k] === 0 ? C.red : "rgba(255,255,255,0.25)" }} />)}</View>
          <Text style={{ color: "#fff", fontSize: 11 }}>{topicOf(c.topic)[s.lang]} · {c.rating}</Text></View></Tap></Rise>)}</View>
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
    <Sheet open={!!sel && !confirmClip} onClose={() => setSel(null)} title={t("clipActions")}>
      {sel ? <Mut style={{ textAlign: "center", marginTop: -8, marginBottom: 12 }}>{topicOf(sel.topic)[s.lang]} · {t("rating")} {sel.rating} · {sel.wins}–{sel.losses}</Mut> : null}
      <Btn testID="clip-delete" kind="danger" title={t("clipDel")} onPress={() => setConfirmClip(true)} />
    </Sheet>
    <Sheet open={confirmClip} onClose={() => !busy && setConfirmClip(false)} title={t("clipDelT")}>
      <Mut style={{ textAlign: "center", marginBottom: 16 }}>{t("clipDelD")}</Mut>
      <View style={{ gap: 8 }}><Btn testID="clip-delete-confirm" kind="danger" title={t("deleteYes")} disabled={busy} onPress={delClip} /><Btn kind="sec" title={t("cancel")} disabled={busy} onPress={() => setConfirmClip(false)} /></View>
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
