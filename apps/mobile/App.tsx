import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StoreProvider, useStore, useApp } from "./src/store";
import { CelebrateHost } from "./src/celebrate";
import { ToastHost } from "./src/ui/media";
import { Onboarding } from "./src/screens/Onboarding";
import { Feed } from "./src/screens/Feed";
import { Explore } from "./src/screens/Explore";
import { Ranking } from "./src/screens/Ranking";
import { Profile } from "./src/screens/Profile";
import { Create } from "./src/screens/Create";
import { Icon } from "./src/ui/Icon";
import { Tap, useNative } from "./src/ui/kit";
import { C } from "./src/theme";
import { isOffline, subscribeNet, watchBrowserNet } from "./src/api";
import type { Key } from "./src/i18n";

type Tab = "home" | "explore" | "rank" | "me";

/** Slim banner that shows while the API is unreachable and hides itself when it is back. */
function OfflineBanner() {
  const { t } = useApp(); const ins = useSafeAreaInsets();
  const [off, setOff] = useState(isOffline());
  useEffect(() => { const u = subscribeNet(setOff); const w = watchBrowserNet(); return () => { u(); w(); }; }, []);
  if (!off) return null;
  return <View accessibilityRole="alert" accessibilityLiveRegion="polite" pointerEvents="none" style={[st.offline, { paddingTop: ins.top + 4 }]}><Text style={st.offTxt}>{t("offline")}</Text></View>;
}

const TAB_LABEL: Record<string, Key> = { home: "aHome", explore: "aExplore", create: "aCreate", rank: "aRank", me: "aProfile" };

function Main() {
  const { s, t } = useApp();
  const ins = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("home");
  const [feedKey, setFeedKey] = useState(0);
  const [feedTopic, setFeedTopic] = useState("foryou");
  const [creating, setCreating] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const go = (t: Tab) => { if (t === tab) return; fade.setValue(0); setTab(t); Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: useNative }).start(); };
  const screen = { home: <Feed key={feedKey} initialTopic={feedTopic} onCreate={() => setCreating(true)} />, explore: <Explore openTopic={id => { setFeedTopic(id); setFeedKey(k => k + 1); go("home"); }} />, rank: <Ranking />, me: <Profile /> }[tab];
  return <View style={{ flex: 1, paddingTop: ins.top }}>
    <Animated.View style={{ flex: 1, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>{screen}</Animated.View>
    <View style={[st.bar, { paddingBottom: ins.bottom, height: 56 + ins.bottom }]}>
      {(["home", "explore", "create", "rank", "me"] as const).map(k => <View key={k} style={st.tab}><Tap testID={`tab-${k}`} label={t(TAB_LABEL[k])} selected={tab === k} onPress={() => { if (k === "home") setFeedTopic("foryou"); if (k === "create") setCreating(true); else go(k); }} scale={0.8} style={st.tabBtn}>
        {k === "me" ? <View style={[st.me, tab === "me" && st.meOn]}><Text style={{ fontWeight: "800", color: C.ink, fontSize: 12 }}>{s.handle[0]?.toUpperCase()}</Text></View>
          : <Icon name={{ home: "home", explore: "search", create: "plus", rank: "trophy" }[k] as "home"} color={k === "create" ? C.volt : C.fg} width={tab === k ? 2.7 : 2} />}
      </Tap></View>)}
    </View>
    <Create open={creating} onClose={() => setCreating(false)} onPublished={() => go("me")} />
  </View>;
}

function Root() {
  const { s } = useStore();
  if (!s) return <View style={[st.root, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={C.volt} /></View>;
  return <ToastHost><CelebrateHost>{s.step === "main" ? <Main /> : <Onboarding />}<OfflineBanner /></CelebrateHost></ToastHost>;
}

export default function App() {
  useEffect(() => {}, []);
  return <SafeAreaProvider><View style={st.root}><StatusBar style="light" /><StoreProvider><Root /></StoreProvider></View></SafeAreaProvider>;
}
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  bar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line, backgroundColor: "#000" },
  tab: { flex: 1, height: 56, alignItems: "center", justifyContent: "center" },
  tabBtn: { padding: 8, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  offline: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 120, backgroundColor: C.red, paddingBottom: 4, alignItems: "center" },
  offTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },
  me: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.volt, alignItems: "center", justifyContent: "center" },
  meOn: { borderWidth: 2, borderColor: "#fff" },
});
