import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp, type Step } from "../store";
import { errMsg } from "../errors";
import { ApiError } from "../api";
import { TOPICS } from "../data";
import { BRAND, C } from "../theme";
import { Btn, Chip, Mut, Rise, T, reduceMotion, useNative } from "../ui/kit";
import { Icon, type IconName } from "../ui/Icon";

function Orb({ color, size, style, delay = 0 }: { color: string; size: number; style: object; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (reduceMotion()) return; const a = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: 4500, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative }), Animated.timing(v, { toValue: 0, duration: 4500, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative })])); a.start(); return () => a.stop(); }, []);
  return <Animated.View style={[{ position: "absolute", width: size, height: size, borderRadius: size, backgroundColor: color, opacity: 0.22 }, style,
    { transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, 24] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }] }]} />;
}
export function AppMark({ size = 100, icon = "swords" }: { size?: number; icon?: IconName }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(v, { toValue: 1, useNativeDriver: useNative, damping: 10, stiffness: 120 }).start(); }, []);
  return <Animated.View style={{ transform: [{ scale: v }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-140deg", "0deg"] }) }] }}>
    <LinearGradient colors={[...BRAND]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size * 0.28, alignItems: "center", justifyContent: "center" }}>
      <Icon name={icon} size={size * 0.55} color={C.ink} width={2.2} /></LinearGradient></Animated.View>;
}

function Shell({ hero, children }: { hero: React.ReactNode; children: React.ReactNode }) {
  const ins = useSafeAreaInsets();
  return <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 22, paddingTop: ins.top + 10, paddingBottom: ins.bottom + 22 }} keyboardShouldPersistTaps="handled">
      <View style={st.hero}>{hero}</View><View style={{ gap: 12 }}>{children}</View></ScrollView></KeyboardAvoidingView>;
}
const Dots = ({ i }: { i: number }) => <View style={{ flexDirection: "row", gap: 6 }}>{[0, 1].map(k => <View key={k} style={{ height: 4, borderRadius: 2, width: k === i ? 22 : 8, backgroundColor: k === i ? "#fff" : "#555" }} />)}</View>;

export function Onboarding() {
  const { s, t, update, register } = useApp();
  const go = (step: Step) => update(x => ({ ...x, step }));
  const [handle, setHandle] = useState(s.handle);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return; setBusy(true); setErr(null);
    try { await register(); }
    catch (e) { setErr(errMsg(e, t)); if (e instanceof ApiError && (e.code === "handle_taken" || e.code === "bad_handle")) go("login"); }
    finally { setBusy(false); }
  };

  if (s.step === "lang") return <Shell hero={<><Orb color={C.mint} size={240} style={{ left: 0, top: 40 }} /><Orb color={C.cyan} size={200} style={{ right: 0, top: 160 }} delay={1500} /><AppMark /></>}>
    <Rise i={0}><T style={st.h}>VSV</T></Rise><Rise i={1}><Mut>{t("chooseLang")}</Mut></Rise>
    <Rise i={2} style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ flex: 1 }}><Btn testID="lang-ru" kind="sec" title="🇷🇺 Русский" onPress={() => update(x => ({ ...x, lang: "ru", step: "intro1" }))} /></View>
      <View style={{ flex: 1 }}><Btn testID="lang-en" kind="sec" title="🇬🇧 English" onPress={() => update(x => ({ ...x, lang: "en", step: "intro1" }))} /></View></Rise>
  </Shell>;

  if (s.step === "intro1") return <Shell key="i1" hero={<><Orb color={C.volt} size={240} style={{ left: 0, top: 30 }} />
    <View style={{ flexDirection: "row", gap: 12, transform: [{ rotate: "-6deg" }] }}>
      {[["#ee0979", "#ff6a00", "💃"], ["#fc466b", "#3f5efb", "🎸"]].map(([a, b, e], k) => <Rise key={k} i={k * 2}><LinearGradient colors={[a, b]} style={[st.card, k ? { marginTop: 34 } : null]}><T style={{ fontSize: 54 }}>{e}</T></LinearGradient></Rise>)}
    </View><T style={st.vs}>VS</T></>}>
    <Rise i={0}><Dots i={0} /></Rise><Rise i={1}><T style={st.h}>{t("onb1t")}</T></Rise><Rise i={2}><Mut style={{ fontSize: 15 }}>{t("onb1d")}</Mut></Rise>
    <Rise i={3}><Btn testID="next" title={t("next")} onPress={() => go("intro2")} /></Rise></Shell>;

  if (s.step === "intro2") return <Shell key="i2" hero={<><Orb color={C.gold} size={260} style={{ left: 30, top: 40 }} />
    <Rise><T style={{ fontSize: 90, textAlign: "center" }}>👑</T></Rise>
    <View style={{ flexDirection: "row", gap: 5, width: 230, marginTop: 16 }}>{[1, 1, 0, 1, 1, 1, 0, 1, 1, 1].map((w, k) => <Rise key={k} i={k + 2} style={{ flex: 1 }}><View style={{ height: 8, borderRadius: 4, backgroundColor: w ? C.ok : C.red }} /></Rise>)}</View>
    <Rise i={13}><T style={{ fontSize: 26, fontWeight: "800", marginTop: 12 }}>8 / 10 · 80%</T></Rise></>}>
    <Rise i={0}><Dots i={1} /></Rise><Rise i={1}><T style={st.h}>{t("onb2t")}</T></Rise><Rise i={2}><Mut style={{ fontSize: 15 }}>{t("onb2d")}</Mut></Rise>
    <Rise i={3}><Btn testID="next" title={t("next")} onPress={() => go("login")} /></Rise></Shell>;

  if (s.step === "login") return <Shell key="lg" hero={<><Orb color={C.mint} size={260} style={{ left: 40, top: 40 }} /><AppMark size={110} icon="link" /></>}>
    <Rise i={0}><T style={st.h}>{t("loginT")}</T></Rise><Rise i={1}><Mut style={{ fontSize: 15 }}>{t("loginD")}</Mut></Rise>
    <Rise i={2} style={st.mock}><Mut>{t("loginNote")}</Mut>
      <TextInput testID="handle" value={handle} onChangeText={v => { setErr(null); setHandle(v.replace(/[^\w.]/g, "").slice(0, 30)); }} placeholder={t("handlePh")} placeholderTextColor={C.mut} autoCapitalize="none" autoCorrect={false} style={st.input} />
      {err ? <Mut style={st.err}>{err}</Mut> : null}
      <Btn testID="login" title={t("loginAs")} disabled={handle.length < 2} onPress={() => { setErr(null); update(x => ({ ...x, handle, step: "consent" })); }} /></Rise>
    <Rise i={3}><Mut style={{ fontSize: 11.5, textAlign: "center" }}>{t("terms")}</Mut></Rise></Shell>;

  if (s.step === "consent") {
    const rows: [keyof typeof s.consent | "profile", "pProfile" | "pMedia" | "pNotif" | "pAnalytics", "pProfileD" | "pMediaD" | "pNotifD" | "pAnalyticsD"][] =
      [["profile", "pProfile", "pProfileD"], ["media", "pMedia", "pMediaD"], ["notif", "pNotif", "pNotifD"], ["analytics", "pAnalytics", "pAnalyticsD"]];
    return <Shell key="cs" hero={<View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}><View style={st.ava}><T style={{ fontWeight: "800", fontSize: 20 }}>{s.handle[0]?.toUpperCase()}</T></View><T style={{ fontSize: 22 }}>⇄</T><AppMark size={56} /></View>}>
      <Rise i={0}><T style={st.h}>{t("consentT")}</T></Rise><Rise i={1}><Mut>@{s.handle} · {t("consentD")}</Mut></Rise>
      {rows.map(([k, a, b], i) => <Rise key={k} i={i + 2} style={st.perm}><View style={{ flex: 1 }}><T style={{ fontWeight: "600" }}>{t(a)}</T><Mut style={{ marginTop: 2 }}>{t(b)}</Mut></View>
        <Switch testID={`sw-${k}`} disabled={k === "profile"} value={k === "profile" ? true : s.consent[k]} onValueChange={v => { if (k !== "profile") update(x => ({ ...x, consent: { ...x.consent, [k]: v } })); }} trackColor={{ true: C.volt, false: "#3a3a3a" }} thumbColor="#fff" /></Rise>)}
      <Rise i={6}><View style={st.note}><Mut style={{ fontSize: 12 }}>{t("consentNote")}</Mut></View></Rise>
      <Rise i={7}><Btn testID="allow" title={t("allow")} onPress={() => go("topics")} /></Rise></Shell>;
  }

  // topics
  const toggle = (id: string) => update(x => ({ ...x, topics: x.topics.includes(id) ? x.topics.filter(y => y !== id) : [...x.topics, id] }));
  return <Shell key="tp" hero={<AppMark size={72} icon="grid" />}>
    <Rise i={0}><T style={st.h}>{t("topicsT")}</T></Rise><Rise i={1}><Mut>{t("topicsD")}</Mut></Rise>
    <Rise i={2} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{TOPICS.map(x => <Chip key={x.id} testID={`topic-${x.id}`} label={`${x.e} ${x[s.lang]}`} on={s.topics.includes(x.id)} onPress={() => toggle(x.id)} />)}</Rise>
    {err ? <Mut style={st.err}>{err}</Mut> : null}
    <Rise i={3}><Btn testID="start" kind="brand" title={`${t("start")} · ${s.topics.length} ${t("picked")}`} disabled={s.topics.length < 3 || busy} onPress={start} /></Rise></Shell>;
}

const st = StyleSheet.create({
  hero: { flex: 1, minHeight: 300, alignItems: "center", justifyContent: "center" },
  h: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  vs: { position: "absolute", fontSize: 44, fontWeight: "900", fontStyle: "italic", color: C.volt, textShadowColor: "#000", textShadowRadius: 18 },
  card: { width: 120, height: 200, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  mock: { gap: 10, borderWidth: 1, borderStyle: "dashed", borderColor: "#555", borderRadius: 14, padding: 14, backgroundColor: C.bg2 },
  input: { backgroundColor: C.bg3, color: C.fg, borderRadius: 12, padding: 13, fontSize: 15 },
  perm: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: C.bg2 },
  err: { color: C.red, fontSize: 13 },
  note: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12 },
  ava: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.bg3, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.mint },
});
