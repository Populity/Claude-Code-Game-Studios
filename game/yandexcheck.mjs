// Yandex Games integration check: serves a mock /sdk.js and verifies language, ready() and reward button.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const MOCK = `window.__ya={ready:0,ads:0};window.YaGames={init:async()=>({environment:{i18n:{lang:'ru'}},features:{LoadingAPI:{ready(){__ya.ready++}}},getPlayer:async()=>({getData:async()=>({}),setData:async()=>{}}),adv:{showFullscreenAdv({callbacks}){__ya.ads++;callbacks.onOpen();callbacks.onClose()},showRewardedVideo({callbacks}){callbacks.onOpen();callbacks.onRewarded();callbacks.onClose()}}})};`;
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary' };
const srv = http.createServer((q,r)=>{ const u=decodeURIComponent(q.url.split('?')[0]); if (u==='/sdk.js'){r.writeHead(200,{'content-type':'text/javascript'});return r.end(MOCK);} const f = path.join('.', u === '/' ? 'index.html' : u); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);return r.end();} r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); r.end(d); }); }).listen(8128);
const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ locale:'en-US', viewport:{width:1280,height:720} }); const p = await ctx.newPage(); p.setDefaultTimeout(300000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>localStorage.setItem('reelswars', JSON.stringify({quality:'high'})));
await p.goto('http://localhost:8128/?platform=yandex'); await p.waitForFunction(()=>window.__game);
const r = await p.evaluate(async()=>{ __game.startLevel(0); const G=__game.G; const g0=G.gold; document.getElementById('btnReward').click(); await new Promise(r=>setTimeout(r,300));
  return { ready: __ya.ready, play: document.querySelector('[data-go=levels]').textContent, rewardVisible: !document.getElementById('btnReward').hidden, goldGain: __game.G.gold - g0 }; });
console.log(JSON.stringify(r), 'ERRORS:', errs); await b.close(); srv.close();
