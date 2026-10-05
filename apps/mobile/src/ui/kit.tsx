import React, { useEffect, useRef } from "react";
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { BRAND, C, R } from "../theme";
import type { ClipStatus } from "../core";

export const haptic = (k: "light" | "medium" | "success" | "error" = "light") => {
  if (Platform.OS === "web") return;
  if (k === "success" || k === "error") Haptics.notificationAsync(k === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
  else Haptics.impactAsync(k === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
export const useNative = Platform.OS !== "web";

/** Spring-press wrapper used by every tappable element. */
export function Tap({ onPress, children, style, disabled, scale = 0.94, testID, onLongPress }: { onPress?: () => void; onLongPress?: () => void; children: React.ReactNode; style?: StyleProp<ViewStyle>; disabled?: boolean; scale?: number; testID?: string }) {
  const v = useRef(new Animated.Value(1)).current;
  const to = (x: number) => Animated.spring(v, { toValue: x, useNativeDriver: useNative, speed: 40, bounciness: x === 1 ? 12 : 0 }).start();
  return (
    <Pressable testID={testID} disabled={disabled} onPressIn={() => to(scale)} onPressOut={() => to(1)} onLongPress={onLongPress}
      onPress={() => { haptic(); onPress?.(); }} accessibilityRole="button">
      <Animated.View style={[style, { transform: [{ scale: v }], opacity: disabled ? 0.35 : 1 }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Btn({ title, onPress, kind = "primary", disabled, icon, testID }: { title: string; onPress?: () => void; kind?: "primary" | "brand" | "sec" | "light" | "danger"; disabled?: boolean; icon?: React.ReactNode; testID?: string }) {
  const bg = { primary: C.volt, brand: C.volt, sec: C.bg3, light: "#fff", danger: C.bg3 }[kind];
  const fg = kind === "sec" ? C.fg : kind === "danger" ? C.red : C.ink;
  const inner = <View style={st.btnRow}>{icon}<Text style={[st.btnTxt, { color: fg }]}>{title}</Text></View>;
  return (
    <Tap testID={testID} onPress={onPress} disabled={disabled} style={[st.btn, { backgroundColor: bg }]} scale={0.96}>
      {kind === "brand" ? <LinearGradient colors={[...BRAND]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} /> : null}
      {inner}
    </Tap>
  );
}

export function Chip({ label, on, onPress, small, testID }: { label: string; on?: boolean; onPress?: () => void; small?: boolean; testID?: string }) {
  return <Tap testID={testID} onPress={onPress} scale={0.9} style={[st.chip, small && st.chipSm, on && { backgroundColor: C.fg }]}>
    <Text style={[st.chipTxt, small && { fontSize: 12.5 }, on && { color: "#000" }]}>{label}</Text></Tap>;
}

export function Avatar({ size = 40, label, colors, ring = true, rounded = 999 }: { size?: number; label: string; colors?: readonly string[]; ring?: boolean; rounded?: number }) {
  const inner = (
    <View style={{ width: size - 4, height: size - 4, borderRadius: rounded, borderWidth: 2, borderColor: C.bg, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#333" }}>
      {colors ? <LinearGradient colors={colors as [string, string]} style={StyleSheet.absoluteFill} /> : null}
      <Text style={{ fontSize: size * 0.42, fontWeight: "800", color: C.fg }}>{label}</Text>
    </View>);
  return ring ? <LinearGradient colors={[...BRAND]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: rounded, alignItems: "center", justifyContent: "center" }}>{inner}</LinearGradient> : inner;
}

export function Badge({ status, label }: { status: ClipStatus; label: string }) {
  const bg = { qual: "rgba(255,255,255,0.18)", king: C.gold, out: C.red, active: C.ok }[status];
  return <View style={[st.badge, { backgroundColor: bg }]}><Text style={[st.badgeTxt, { color: status === "qual" || status === "out" ? "#fff" : "#000" }]}>{status === "king" ? "👑 " : ""}{label}</Text></View>;
}

/** Fade + rise entrance with a stagger index. */
export function Rise({ i = 0, children, style }: { i?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(v, { toValue: 1, duration: 520, delay: 40 + i * 55, easing: Easing.out(Easing.cubic), useNativeDriver: useNative }).start(); }, []);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}>{children}</Animated.View>;
}

/** Bottom sheet with slide-up spring. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const y = useRef(new Animated.Value(600)).current;
  useEffect(() => { if (open) Animated.spring(y, { toValue: 0, useNativeDriver: useNative, damping: 22, stiffness: 220 }).start(); else y.setValue(600); }, [open]);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.scrim} onPress={onClose} testID="scrim" />
      <Animated.View style={[st.sheet, { transform: [{ translateY: y }] }]}>
        <View style={st.grab} />
        {title ? <Text style={st.sheetTitle}>{title}</Text> : null}
        {children}
      </Animated.View>
    </Modal>
  );
}

export const T = ({ style, children, ...p }: { style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number }) => <Text style={[{ color: C.fg, fontSize: 15 }, style]} {...p}>{children}</Text>;
export const Mut = ({ style, children, ...p }: { style?: StyleProp<TextStyle>; children: React.ReactNode; numberOfLines?: number }) => <Text style={[{ color: C.mut, fontSize: 13 }, style]} {...p}>{children}</Text>;

const st = StyleSheet.create({
  btn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, overflow: "hidden" },
  btnRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  btnTxt: { fontWeight: "700", fontSize: 15 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.bg3 },
  chipSm: { paddingVertical: 5, paddingHorizontal: 10 },
  chipTxt: { color: C.fg, fontWeight: "500", fontSize: 14 },
  badge: { paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999, alignSelf: "flex-start" },
  badgeTxt: { fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "92%", backgroundColor: "#1c1c1c", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 30 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: "#555", alignSelf: "center", marginBottom: 12 },
  sheetTitle: { color: C.fg, fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 14 },
});
export { R };
