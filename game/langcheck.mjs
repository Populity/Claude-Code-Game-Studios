// Localization smoke check: boots the game under several browser locales and screenshots the menus.
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary' };
const srv = http.createServer((q,r)=>{ const u=decodeURIComponent(q.url.split('?')[0]); const f = path.join('.', u === '/' ? 'index.html' : u); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);return r.end();} r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); r.end(d); }); }).listen(8127);
const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const errs=[]; const out={};
for (const [locale, url] of [['es-ES','/'], ['pt-BR','/'], ['ru-RU','/?lang=en']]) {
  const ctx = await b.newContext({ locale, viewport:{width:1280,height:720} }); const p = await ctx.newPage(); p.setDefaultTimeout(300000);
  p.on('pageerror',e=>errs.push(locale+': '+e.message));
  await p.addInitScript(()=>localStorage.setItem('reelswars', JSON.stringify({quality:'high'})));
  await p.goto('http://localhost:8127'+url); await p.waitForFunction(()=>window.__game);
  out[locale+url] = await p.evaluate(()=>[...document.querySelectorAll('#menu .btn')].map(b=>b.textContent).join(' | '));
  if (locale==='es-ES') { await p.click('[data-go=levels]'); await p.waitForTimeout(500); await p.screenshot({path:'../production/qa/evidence/10-levels-es.png'}); }
  await ctx.close();
}
console.log(JSON.stringify(out,null,1), 'ERRORS:', errs); await b.close(); srv.close();
