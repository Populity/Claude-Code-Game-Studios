import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Easing, Linking, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { topicOf, type Clip } from "../data";
import { C } from "../theme";
import { useNative, haptic } from "./kit";

function Bob({ children, size, delay = 0 }: { children: string; size: number; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { const a = Animated.loop(Animated.sequence([
    Animated.timing(v, { toValue: 1, duration: 1100, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative }),
    Animated.timing(v, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: useNative })])); a.start(); return () => a.stop(); }, []);
  return <Animated.Text style={{ fontSize: size, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) }, { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "6deg"] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }}>{children}</Animated.Text>;
}

/** Story-style progress bar on top of a playing clip. */
export function Progress({ active }: { active: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (!active) return; const a = Animated.loop(Animated.timing(v, { toValue: 1, duration: 8000, easing: Easing.linear, useNativeDriver: false })); v.setValue(0); a.start(); return () => a.stop(); }, [active]);
  return <View style={s.prog}><Animated.View style={[s.progFill, { width: v.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} /></View>;
}

function FileVideo({ uri, active }: { uri: string; active: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = true; });
  useEffect(() => { active ? player.play() : player.pause(); }, [active, player]);
  return <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />;
}

/** Renders a clip: demo gradient, user video file, or an Instagram link card. */
export function ClipMedia({ clip, active = true, thumb = false }: { clip: Pick<Clip, "topic" | "src" | "uri" | "code">; active?: boolean; thumb?: boolean }) {
  const tp = topicOf(clip.topic);
  if (clip.src === "file" && clip.uri) return <View style={StyleSheet.absoluteFill}><FileVideo uri={clip.uri} active={active && !thumb} /></View>;
  return (
    <View style={[StyleSheet.absoluteFill, s.center]}>
      <LinearGradient colors={[tp.g[0], tp.g[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {!thumb && clip.src === "demo" ? <View style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} pointerEvents="none">
        <View style={{ position: "absolute", left: "12%", bottom: "22%" }}><Bob size={22} delay={300}>{tp.e}</Bob></View>
        <View style={{ position: "absolute", right: "14%", top: "28%" }}><Bob size={20} delay={700}>{tp.e}</Bob></View></View> : null}
      {thumb ? <Text style={{ fontSize: 34 }}>{clip.src === "link" ? "🔗" : tp.e}</Text> : <Bob size={64}>{clip.src === "link" ? "🔗" : tp.e}</Bob>}
      {clip.src === "link" && !thumb && clip.code ? <Text onPress={() => { haptic(); Linking.openURL(`https://www.instagram.com/reel/${clip.code}/`); }} style={s.open}>Instagram ↗</Text> : null}
    </View>
  );
}

/* ---------- toast ---------- */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const y = useRef(new Animated.Value(-140)).current; const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m); clearTimeout(timer.current); y.setValue(-140);
    Animated.spring(y, { toValue: 0, useNativeDriver: useNative, damping: 16, stiffness: 180 }).start();
    timer.current = setTimeout(() => Animated.timing(y, { toValue: -140, duration: 260, useNativeDriver: useNative }).start(() => setMsg(null)), 2800);
  }, []);
  return <ToastCtx.Provider value={show}>{children}
    {msg ? <Animated.View pointerEvents="none" style={[s.toast, { transform: [{ translateY: y }] }]}><Text style={s.toastTxt} testID="toast">{msg}</Text></Animated.View> : null}
  </ToastCtx.Provider>;
}

const s = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  prog: { position: "absolute", top: 8, left: 8, right: 8, height: 2.5, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden", zIndex: 2 },
  progFill: { height: "100%", backgroundColor: "#fff" },
  open: { marginTop: 14, color: "#000", backgroundColor: "#fff", fontWeight: "700", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, overflow: "hidden" },
  toast: { position: "absolute", top: 54, left: 12, right: 12, zIndex: 99, padding: 14, borderRadius: 14, backgroundColor: "rgba(38,38,38,0.97)", shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 20 },
  toastTxt: { color: C.fg, fontWeight: "600" },
});
