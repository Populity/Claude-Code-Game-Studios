import { Platform } from "react-native";
import { createVideoPlayer } from "expo-video";
import * as ImageManipulator from "expo-image-manipulator";

/** The server rejects posters over 300 KB; keep a margin. */
const MAX_BYTES = 280 * 1024;
const MAX_HEIGHT = 540;
const AT_SECONDS = 0.5;
const TIMEOUT_MS = 12_000;

const withTimeout = <T,>(p: Promise<T>, what: string) => new Promise<T>((res, rej) => {
  const id = setTimeout(() => rej(new Error(`${what} timed out`)), TIMEOUT_MS);
  p.then(v => { clearTimeout(id); res(v); }, e => { clearTimeout(id); rej(e); });
});

/** Web: hidden <video> seeked to ~0.5 s, drawn to a canvas and encoded as JPEG. */
async function webPoster(uri: string): Promise<Blob> {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = uri;
  const once = (ev: string) => new Promise<void>((res, rej) => { v.addEventListener(ev, () => res(), { once: true }); v.addEventListener("error", () => rej(new Error("video error")), { once: true }); });
  try {
    if (v.readyState < 1) await once("loadedmetadata");
    v.currentTime = Math.min(AT_SECONDS, (v.duration || 1) / 2);
    await once("seeked");
    const k = Math.min(1, MAX_HEIGHT / (v.videoHeight || MAX_HEIGHT));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(v.videoWidth * k)); c.height = Math.max(1, Math.round(v.videoHeight * k));
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    for (const q of [0.8, 0.6, 0.4]) {
      const b = await new Promise<Blob | null>(r => c.toBlob(r, "image/jpeg", q));
      if (b && b.size <= MAX_BYTES) return b;
    }
    throw new Error("poster too large");
  } finally { v.removeAttribute("src"); v.load(); }
}

/** Native: expo-video thumbnail (a native image ref) re-encoded to a JPEG file by expo-image-manipulator. */
async function nativePoster(uri: string): Promise<Blob> {
  const player = createVideoPlayer(uri);
  try {
    if (player.status !== "readyToPlay") await withTimeout(new Promise<void>((res, rej) => {
      const sub = player.addListener("statusChange", ({ status }) => { if (status === "readyToPlay") { sub.remove(); res(); } else if (status === "error") { sub.remove(); rej(new Error("player error")); } });
    }), "player");
    const [thumb] = await withTimeout(player.generateThumbnailsAsync(AT_SECONDS, { maxHeight: MAX_HEIGHT }), "thumbnail");
    if (!thumb) throw new Error("no thumbnail");
    const img = await ImageManipulator.ImageManipulator.manipulate(thumb).renderAsync();
    for (const q of [0.8, 0.6, 0.4]) {
      const saved = await img.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: q });
      const blob = await (await fetch(saved.uri)).blob();
      if (blob.size <= MAX_BYTES) return blob;
    }
    throw new Error("poster too large");
  } finally { player.release(); }
}

/** Makes a JPEG poster from ~0.5 s into the local video file. Rejects on any failure; callers treat that as non-fatal. */
export const makePoster = (uri: string): Promise<Blob> => withTimeout(Platform.OS === "web" ? webPoster(uri) : nativePoster(uri), "poster");
