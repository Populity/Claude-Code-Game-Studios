import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const URL = "https://45-128-234-165.sslip.io/";
const b = await chromium.launch({ channel: "chrome" });
// 1. Make a real 2-second test video (webm) in the browser.
const g = await b.newPage();
const bytes = await g.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 360; c.height = 640; const x = c.getContext("2d");
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" }); const parts = [];
  rec.ondataavailable = e => parts.push(e.data); rec.start();
  const t0 = performance.now(); const seed = Math.random() * 360;
  await new Promise(r => { const f = () => { const t = performance.now() - t0; x.fillStyle = `hsl(${(seed + t / 10) % 360} 80% 50%)`; x.fillRect(0, 0, 360, 640); x.fillStyle = "#fff"; x.font = "bold 48px sans-serif"; x.fillText("VSV QA " + (t / 1000).toFixed(1), 30, 320); t < 2000 ? requestAnimationFrame(f) : r(); }; f(); });
  rec.stop(); await new Promise(r => rec.onstop = r);
  return Array.from(new Uint8Array(await new Blob(parts).arrayBuffer()));
});
writeFileSync("test.webm", Buffer.from(bytes)); console.log("video bytes", bytes.length); await g.close();

// 2. Onboard, then upload through the Create sheet.
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU" });
const errs = []; p.on("console", m => m.type() === "error" && errs.push(m.text())); p.on("pageerror", e => errs.push("PAGEERR " + e.message));
let token = null;
p.on("response", async r => { if (!r.url().includes("/api/")) return; console.log("API", r.request().method(), r.url().replace(/^https:\/\/[^/]+/, "").slice(0, 70), r.status());
  if (r.url().endsWith("/api/auth/register") && r.status() === 201) token = (await r.json()).token; });
const id = s => p.getByTestId(s);
const shot = async n => { await p.waitForTimeout(900); await p.screenshot({ path: `shots/${n}.png` }); console.log("SHOT", n, "|", (await p.innerText("body")).replace(/\s+/g, " ").slice(0, 200)); };
try {
  await p.goto(URL, { waitUntil: "networkidle" });
  await p.getByText("Русский").click(); await id("next").click(); await p.waitForTimeout(600); await id("next").click();
  await id("handle").fill("qa_up_" + Date.now().toString().slice(-7)); await id("login").click(); await id("allow").click();
  for (const t of ["humor", "food", "gaming"]) await id(`topic-${t}`).click();
  await id("start").click(); await p.waitForTimeout(2500);
  await id("tab-create").click(); await shot("10-create");
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), id("opt-gallery").click()]);
  await fc.setFiles("test.webm"); await shot("11-draft");
  await id("caption").fill("Тестовый клип QA"); await id("rights").click(); await shot("12-ready");
  await id("publish").click(); await p.waitForTimeout(5000); await shot("13-published");
  await id("tab-me").click(); await shot("14-profile");
  // 3. Video served with range support.
  const mine = await (await fetch(URL + "api/my/clips", { headers: { Authorization: "Bearer " + token } })).json();
  console.log("my clips", mine.map(c => ({ src: c.src, topic: c.topic, video: c.video, caption: c.caption })));
  if (mine[0]?.video) { const v = await fetch(URL + mine[0].video.slice(1), { headers: { Range: "bytes=0-99" } }); console.log("video range", v.status, v.headers.get("content-type"), v.headers.get("content-range")); }
} catch (e) { console.log("FLOW ERROR", e.message.split("\n")[0]); await p.screenshot({ path: "shots/99-error.png" }); }
console.log("ERRORS:", errs);
if (token) { const r = await fetch(URL + "api/me", { method: "DELETE", headers: { Authorization: "Bearer " + token } }); console.log("cleanup DELETE /api/me", r.status); }
await b.close();
