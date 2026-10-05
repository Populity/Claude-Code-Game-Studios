import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useApp } from "../store";
import { api, uploadClip } from "../api";
import { makePoster } from "../poster";
import { errMsg } from "../errors";
import { TOPICS, topicOf } from "../data";
import { instagramShortcode, suggestTopic } from "../core";
import { BRAND, C } from "../theme";
import { Btn, Chip, Mut, Sheet, T, Tap, haptic } from "../ui/kit";
import { ClipMedia, useToast } from "../ui/media";
import { Icon, type IconName } from "../ui/Icon";
import { LinearGradient } from "expo-linear-gradient";

type Draft = { src: "file"; uri: string; mime?: string; size?: number } | { src: "link" };
const MAX_BYTES = 200 * 1024 * 1024;

/** Create flow: record / gallery / Instagram link → caption + topic → rights → publish. */
export function Create({ open, onClose, onPublished }: { open: boolean; onClose: () => void; onPublished: () => void }) {
  const { s, t } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [link, setLink] = useState(""); const [caption, setCaption] = useState("");
  const [topic, setTopic] = useState(s.topics[0] ?? "humor"); const [touched, setTouched] = useState(false);
  const [rights, setRights] = useState(false); const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!open) { setDraft(null); setLink(""); setCaption(""); setRights(false); setTouched(false); setBusy(false); setErr(null); setPct(0); setTopic(s.topics[0] ?? "humor"); } }, [open]);

  const code = instagramShortcode(link);

  async function pick(camera: boolean) {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast(t("noPerm")); return; }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["videos"], videoMaxDuration: 60, quality: 1 };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    if (a.fileSize && a.fileSize > MAX_BYTES) { haptic("error"); toast("⛔ " + t("errTooLarge")); return; }
    setErr(null); setDraft({ src: "file", uri: a.uri, mime: a.mimeType ?? undefined, size: a.fileSize });
  }

  async function publish() {
    if (!draft || busy) return;
    if (draft.src === "file" && !rights) return;
    if (draft.src === "link" && !code) return;
    setBusy(true); setErr(null); setPct(0);
    try {
      if (draft.src === "file") {
        const clip = await uploadClip({ uri: draft.uri, mime: draft.mime }, { topic, caption }, f => setPct(Math.round(f * 100)));
        // The poster is a nicety: any failure here must not fail the publish.
        try { await api.uploadPoster(clip.id, await makePoster(draft.uri)); } catch { /* clip stays without poster */ }
      }
      else await api.addLink({ url: link.trim(), topic, caption });
    } catch (e) { setBusy(false); haptic("error"); setErr(errMsg(e, t)); return; }
    haptic("success"); toast("🎉 " + t("published")); onClose(); onPublished();
  }

  const opt = (icon: IconName, title: string, desc: string, onPress: () => void, colors: readonly string[], id: string) =>
    <Tap testID={id} onPress={onPress} style={st.opt}><LinearGradient colors={colors as [string, string]} style={st.optIco}><Icon name={icon} size={24} color={C.ink} /></LinearGradient>
      <View style={{ flex: 1 }}><T style={{ fontWeight: "700" }}>{title}</T><Mut>{desc}</Mut></View></Tap>;

  return <Sheet open={open} onClose={onClose} title={t("create")}>
    {!draft ? <View>
      {opt("camera", t("recordO"), t("recordD"), () => pick(true), BRAND, "opt-record")}
      {opt("image", t("galleryO"), t("galleryD"), () => pick(false), [C.mint, C.cyan], "opt-gallery")}
      {opt("link", t("linkO"), t("linkD"), () => setDraft({ src: "link" }), [C.cyan, "#3B82F6"], "opt-link")}
    </View> : busy ? <View style={{ alignItems: "center", gap: 16, paddingVertical: 30 }}>
      <View style={st.bar}><View style={{ height: "100%", backgroundColor: C.volt, width: `${draft.src === "file" ? pct : 100}%` }} /></View>
      <ActivityIndicator color={C.volt} /><T style={{ fontWeight: "700" }}>{draft.src === "file" && pct > 0 ? t("sending", { p: pct }) : t("uploading")}</T></View>
    : <ScrollView keyboardShouldPersistTaps="handled">
      {draft.src === "link" ? <><TextInput testID="link-input" value={link} onChangeText={setLink} placeholder={t("linkPh")} placeholderTextColor={C.mut} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={st.input} />
        {link && !code ? <Mut style={st.err}>{t("badLink")}</Mut> : null}
</> : null}
      <View style={{ flexDirection: "row", gap: 12, marginTop: 12 }}>
        <View style={st.preview}><ClipMedia clip={{ topic, src: draft.src, video: null, code: code ?? null }} uri={draft.src === "file" ? draft.uri : undefined} active={open} thumb={draft.src === "link"} /></View>
        <TextInput testID="caption" value={caption} onChangeText={v => { setCaption(v); if (!touched) setTopic(suggestTopic(v, s.topics, TOPICS, s.topics[0] ?? "humor")); }} placeholder={t("caption")} placeholderTextColor={C.mut} multiline maxLength={220} style={[st.input, { flex: 1, height: 150, textAlignVertical: "top" }]} />
      </View>
      <Mut style={{ fontWeight: "700", marginTop: 14, marginBottom: 8 }}>{t("topicFor")}</Mut>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {[...s.topics, ...TOPICS.map(x => x.id).filter(x => !s.topics.includes(x))].map(id => <Chip key={id} label={`${topicOf(id).e} ${topicOf(id)[s.lang]}`} on={topic === id} onPress={() => { setTouched(true); setTopic(id); }} />)}
      </ScrollView>
      {draft.src === "file" ? <View style={st.rights}><Switch testID="rights" value={rights} onValueChange={setRights} trackColor={{ true: C.volt, false: "#3a3a3a" }} thumbColor="#fff" /><Mut style={{ flex: 1 }}>{t("rights")}</Mut></View>
        : <Mut style={{ marginTop: 12 }}>{t("linkD")}.</Mut>}
      {err ? <Mut style={st.err}>⛔ {err}</Mut> : null}
      <View style={{ marginTop: 14 }}><Btn testID="publish" kind="brand" title={t("publish")} onPress={publish} disabled={draft.src === "file" ? !rights : !code} /></View>
    </ScrollView>}
  </Sheet>;
}
const st = StyleSheet.create({
  opt: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 },
  optIco: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  input: { backgroundColor: C.bg3, color: C.fg, borderRadius: 12, padding: 12, fontSize: 15 },
  err: { color: C.red, marginTop: 6 },
  preview: { width: 110, aspectRatio: 9 / 16, borderRadius: 12, overflow: "hidden", backgroundColor: "#111" },
  rights: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  bar: { width: "80%", height: 8, borderRadius: 4, backgroundColor: C.bg3, overflow: "hidden" },
});

