import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const URL = "https://45-128-234-165.sslip.io/";
const api = async (m, path, tok, body, headers = {}) => { const r = await fetch(URL + "api/" + path, { method: m, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), ...(body && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...headers }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const ts = Date.now().toString().slice(-7);
const up = await api("POST", "auth/register", null, { handle: "qa_owner_" + ts, device: "qa-owner-" + ts, lang: "ru", topics: ["humor", "food", "gaming"] });
const vid = new Uint8Array(readFileSync("test.webm"));
const clip = await api("POST", "clips/upload?topic=music&caption=QA", up.body.token, vid, { "x-rights-confirmed": "1", "Content-Type": "video/webm" });
console.log("owner upload", clip.status, clip.body?.id);
const b = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU" });
const errs = []; p.on("pageerror", e => errs.push("PAGEERR " + e.message)); p.on("console", m => m.type() === "error" && errs.push(m.text()));
let token = null; p.on("response", async r => { if (r.url().endsWith("/api/auth/register") && r.status() === 201) token = (await r.json()).token; });
const id = s => p.getByTestId(s);
try {
  await p.goto(URL, { waitUntil: "networkidle" });
  await p.getByText("Русский").click(); await id("next").click(); await p.waitForTimeout(600); await id("next").click();
  await id("handle").fill("qa_view_" + ts); await id("login").click(); await id("allow").click();
  for (const t of ["music", "food", "gaming"]) await id(`topic-${t}`).click();
  await id("start").click(); await p.waitForTimeout(2500);
  let found = false;
  for (let i = 0; i < 6 && !found; i++) {
    await id("story-music").click(); await p.waitForTimeout(3500);
    const vids = await p.evaluate(() => [...document.querySelectorAll("video")].map(v => ({ src: v.currentSrc, rs: v.readyState, t: v.currentTime, paused: v.paused, w: v.videoWidth })));
    const ours = vids.find(v => v.src.includes(clip.body.id));
    console.log("try", i, "videos:", vids.length, ours ? JSON.stringify(ours) : "");
    if (ours) { found = true; await p.screenshot({ path: "shots/15-video-battle.png" }); }
  }
  console.log(found ? "PLAYBACK FOUND" : "our clip not shown in 6 tries");
} catch (e) { console.log("FLOW ERROR", e.message.split("\n")[0]); await p.screenshot({ path: "shots/99-error.png" }); }
console.log("ERRORS:", errs);
for (const t of [token, up.body.token]) if (t) console.log("cleanup", (await api("DELETE", "me", t)).status);
await b.close();
