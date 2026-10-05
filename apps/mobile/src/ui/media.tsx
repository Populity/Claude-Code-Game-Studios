import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Linking, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { topicOf } from "../data";
import { mediaUrl, type Clip } from "../api";
import { C } from "../theme";
import { Avatar, useNative, haptic } from "./kit";

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

/** Plays a video; the poster stays visible until the first frame is ready. */
function FileVideo({ uri, poster, active }: { uri: string; poster?: string | null; active: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = true; });
  const [ready, setReady] = useState(player.status === "readyToPlay");
  useEffect(() => { const sub = player.addListener("statusChange", ({ status }) => { if (status === "readyToPlay") setReady(true); }); return () => sub.remove(); }, [player]);
  useEffect(() => { active ? player.play() : player.pause(); }, [active, player]);
  return <>
    {poster ? <Image source={{ uri: mediaUrl(poster) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
    <VideoView player={player} style={[StyleSheet.absoluteFill, poster && !ready ? { opacity: 0 } : null]} contentFit="cover" nativeControls={false} />
  </>;
}

/** Square-ish avatar made from a clip's poster, falling back to its topic emoji. */
export function PosterThumb({ clip, size }: { clip: Pick<Clip, "topic" | "poster">; size: number }) {
  const tp = topicOf(clip.topic);
  if (!clip.poster) return <Avatar size={size} label={tp.e} colors={tp.g} />;
  return <Image source={{ uri: mediaUrl(clip.poster) }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#222" }} resizeMode="cover" />;
}

/** Renders a clip: server video (or a local preview uri), demo gradient, or an Instagram link card. */
export function ClipMedia({ clip, uri, active = true, thumb = false }: { clip: Pick<Clip, "topic" | "src" | "video" | "code"> & { poster?: string | null }; uri?: string; active?: boolean; thumb?: boolean }) {
  const tp = topicOf(clip.topic);
  const source = uri ?? (clip.video ? mediaUrl(clip.video) : null);
  if (source && !thumb) return <View style={StyleSheet.absoluteFill}><FileVideo uri={source} poster={clip.poster} active={active} /></View>;
  if (thumb && clip.poster) return <Image source={{ uri: mediaUrl(clip.poster) }} style={StyleSheet.absoluteFill} resizeMode="cover" />;
  return (
    <View style={[StyleSheet.absoluteFill, s.center]}>
      <LinearGradient colors={[tp.g[0], tp.g[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {!thumb && clip.src === "demo" ? <View style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} pointerEvents="none">
        <View style={{ position: "absolute", left: "12%", bottom: "22%" }}><Bob size={22} delay={300}>{tp.e}</Bob></View>
        <View style={{ position: "absolute", right: "14%", top: "28%" }}><Bob size={20} delay={700}>{tp.e}</Bob></View></View> : null}
      {thumb ? <Text style={{ fontSize: 34 }}>{clip.src === "link" ? "🔗" : source ? "🎬" : tp.e}</Text> : <Bob size={64}>{clip.src === "link" ? "🔗" : tp.e}</Bob>}
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
