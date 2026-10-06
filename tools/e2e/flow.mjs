import { chromium } from "playwright";
const URL = "https://45-128-234-165.sslip.io/";
const b = await chromium.launch({ channel: "chrome" });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ru-RU" });
const errs = []; p.on("console", m => m.type() === "error" && errs.push(m.text())); p.on("pageerror", e => errs.push("PAGEERR " + e.message));
let token = null;
p.on("response", async r => { if (!r.url().includes("/api/")) return; console.log("API", r.request().method(), r.url().replace(/^https:\/\/[^/]+/, "").slice(0, 60), r.status());
  if (r.url().endsWith("/api/auth/register") && r.status() === 201) token = (await r.json()).token; });
const id = s => p.getByTestId(s);
const shot = async n => { await p.waitForTimeout(900); await p.screenshot({ path: `shots/${n}.png` }); console.log("SHOT", n, "|", (await p.innerText("body")).replace(/\s+/g, " ").slice(0, 160)); };
try {
  await p.goto(URL, { waitUntil: "networkidle" });
  await p.getByText("Русский").click(); await shot("02-intro1");
  await id("next").click(); await p.waitForTimeout(600); await id("next").click(); await shot("03-login");
  await id("handle").fill("qa_e2e_" + Date.now().toString().slice(-7)); await id("login").click(); await shot("04-consent");
  await id("allow").click(); await shot("05-topics");
  for (const t of ["humor", "food", "gaming"]) await id(`topic-${t}`).click();
  await id("start").click(); await p.waitForTimeout(3000); await shot("06-feed");
  await p.waitForTimeout(3500); await id("vote-0").first().click(); await p.waitForTimeout(2500); await shot("07-voted");
  for (const tab of ["explore", "rank", "me"]) { const el = p.getByTestId(`tab-${tab}`); if (await el.count()) { await el.click(); await shot(`08-${tab}`); } else console.log("no testid tab-" + tab); }
} catch (e) { console.log("FLOW ERROR", e.message.split("\n")[0]); await p.screenshot({ path: "shots/99-error.png" }); }
console.log("ERRORS:", errs);
if (token) { const r = await fetch(URL + "api/me", { method: "DELETE", headers: { Authorization: "Bearer " + token } }); console.log("cleanup DELETE /api/me", r.status); }
await b.close();
