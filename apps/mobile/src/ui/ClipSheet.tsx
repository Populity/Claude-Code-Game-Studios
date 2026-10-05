import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useApp } from "../store";
import { api, type Clip } from "../api";
import { errMsg } from "../errors";
import { topicOf } from "../data";
import { C } from "../theme";
import { Avatar, Badge, Btn, Chip, Mut, Sheet, T, Tap, haptic } from "./kit";
import { ClipMedia, useToast } from "./media";
import { Icon } from "./Icon";

/** Win/loss history as a row of bars (green win, red loss, grey = not played yet). */
export function Sparkline({ hist, slots = 10 }: { hist: number[]; slots?: number }) {
  const shown = hist.slice(-slots);
  return <View style={{ flexDirection: "row", gap: 3, alignItems: "flex-end", height: 26 }} accessibilityLabel={shown.map(x => (x ? "W" : "L")).join(" ")}>
    {Array.from({ length: Math.max(slots, shown.length) }, (_, k) => <View key={k} style={{ flex: 1, height: shown[k] === 1 ? 26 : shown[k] === 0 ? 14 : 6, borderRadius: 2, backgroundColor: shown[k] === 1 ? C.ok : shown[k] === 0 ? C.red : "rgba(255,255,255,0.2)" }} />)}
  </View>;
}

const REASONS = ["rCopy", "rSpam", "rAbuse", "rAdult", "rOther"] as const;

/** Clip detail: video (or poster / demo art), stats, history and Report / Hide author. */
export function ClipSheet({ clip, onClose }: { clip: Clip | null; onClose: () => void }) {
  const { s, t } = useApp();
  const toast = useToast();
  const [reporting, setReporting] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { setReporting(false); setBusy(false); }, [clip?.id]);
  const mine = !!clip && clip.handle === s.handle;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return; setBusy(true);
    try { await fn(); haptic("success"); toast("✅ " + t(ok === "reported" ? "reported" : "hidden")); onClose(); } catch (e) { toast("⚠️ " + errMsg(e, t)); }
    setBusy(false);
  };
  const tp = clip ? topicOf(clip.topic) : null;
  return <Sheet open={!!clip} onClose={onClose} title={t("clipDetail")}>
    {clip && tp ? <ScrollView testID="clip-sheet" showsVerticalScrollIndicator={false}>
      <View style={st.media}><ClipMedia clip={clip} active muted={s.muted} /></View>
      <View style={st.who}><Avatar size={30} label={(clip.handle[0] ?? "?").toUpperCase()} /><T style={{ fontWeight: "700", flex: 1 }} numberOfLines={1}>@{clip.handle}</T><Badge status={clip.status} label={clip.status === "king" ? "" : t(clip.status)} /></View>
      {clip.caption ? <Mut style={{ marginTop: 6 }}>{clip.caption}</Mut> : null}
      <View style={st.row}><Chip small label={`${tp.e} ${tp[s.lang]}`} /></View>
      <View style={st.stats}>
        {[[clip.rating, t("rating")], [`${clip.wins}–${clip.losses}`, t("battles")]].map(([v, l]) => <View key={String(l)} style={{ alignItems: "center", flex: 1 }}><T style={{ fontSize: 20, fontWeight: "800" }}>{v}</T><Mut>{l}</Mut></View>)}
      </View>
      <Sparkline hist={clip.hist} />
      {!mine ? (reporting
        ? <View style={{ marginTop: 14 }}>
          <Mut style={{ textAlign: "center", marginBottom: 6 }}>{t("reportT")}</Mut>
          {REASONS.map(k => <Tap key={k} testID={`detail-report-${k}`} label={t(k)} onPress={() => run(() => api.report(clip.id, k), "reported")} style={st.opt}><View style={st.optIco}><Icon name="flag" size={18} /></View><T style={{ fontWeight: "600" }}>{t(k)}</T></Tap>)}
        </View>
        : <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          <View style={{ flex: 1 }}><Btn testID="detail-report" kind="sec" title={t("report")} onPress={() => setReporting(true)} /></View>
          <View style={{ flex: 1 }}><Btn testID="detail-block" kind="sec" title={t("blockAuthor")} onPress={() => run(() => api.block(clip.id), "hidden")} /></View></View>) : null}
      <View style={{ marginTop: 8 }}><Btn kind="sec" title={t("close")} onPress={onClose} /></View>
    </ScrollView> : null}
  </Sheet>;
}
const st = StyleSheet.create({
  media: { alignSelf: "center", height: 300, aspectRatio: 9 / 16, borderRadius: 14, overflow: "hidden", backgroundColor: "#111" },
  who: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  row: { flexDirection: "row", marginTop: 8 },
  stats: { flexDirection: "row", marginVertical: 12 },
  opt: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  optIco: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center" },
});
