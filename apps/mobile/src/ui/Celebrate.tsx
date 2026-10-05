import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Dimensions, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "../theme";
import { haptic, useNative } from "./kit";

/** Particle burst (confetti for king, shards for elimination). */
function Burst({ colors, count = 46 }: { colors: string[]; count?: number }) {
  const { width, height } = Dimensions.get("window");
  const ps = useMemo(() => Array.from({ length: count }, (_, i) => ({ v: new Animated.Value(0), a: Math.random() * Math.PI * 2, d: 120 + Math.random() * Math.max(width, height) * 0.5, s: 6 + Math.random() * 8, c: colors[i % colors.length], r: Math.random() * 720 })), []);
  useEffect(() => { Animated.stagger(6, ps.map(p => Animated.timing(p.v, { toValue: 1, duration: 1300, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }))).start(); }, []);
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
    {ps.map((p, i) => <Animated.View key={i} style={{ position: "absolute", width: p.s, height: p.s / 2, borderRadius: 1, backgroundColor: p.c,
      opacity: p.v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
      transform: [{ translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(p.a) * p.d] }) },
        { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(p.a) * p.d + 120] }) },
        { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.r}deg`] }) }] }} />)}
  </View>;
}

export function Celebrate({ kind, title, body, onDone }: { kind: "king" | "out"; title: string; body: string; onDone: () => void }) {
  const a = useRef(new Animated.Value(0)).current, ico = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    haptic(kind === "king" ? "success" : "error");
    Animated.timing(a, { toValue: 1, duration: 260, useNativeDriver: useNative }).start();
    Animated.spring(ico, { toValue: 1, useNativeDriver: useNative, damping: 9, stiffness: 140 }).start();
    const t = setTimeout(close, 2700); return () => clearTimeout(t);
  }, []);
  const close = () => Animated.timing(a, { toValue: 0, duration: 300, useNativeDriver: useNative }).start(onDone);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, st.wrap, { opacity: a }]}>
      <Pressable style={st.center} onPress={close} testID="celebrate">
        <Burst colors={kind === "king" ? [C.volt, C.mint, C.cyan, C.gold, "#fff"] : [C.red, "#7a1a2a", "#fff"]} />
        <Animated.Text style={{ fontSize: 96, transform: [{ scale: ico.interpolate({ inputRange: [0, 1], outputRange: [kind === "king" ? 0.2 : 1.8, 1] }) },
          { translateY: ico.interpolate({ inputRange: [0, 1], outputRange: [kind === "king" ? -120 : 0, 0] }) },
          { rotate: ico.interpolate({ inputRange: [0, 1], outputRange: [kind === "king" ? "-30deg" : "12deg", "0deg"] }) }] }}>{kind === "king" ? "👑" : "💔"}</Animated.Text>
        <Text style={st.title}>{title}</Text><Text style={st.body}>{body}</Text>
      </Pressable>
    </Animated.View>
  );
}
const st = StyleSheet.create({
  wrap: { zIndex: 80, backgroundColor: "rgba(0,0,0,0.88)" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30, gap: 12 },
  title: { color: C.fg, fontSize: 30, fontWeight: "900", textAlign: "center" },
  body: { color: C.mut, fontSize: 15, textAlign: "center" },
});
