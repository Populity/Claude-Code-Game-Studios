import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary' };
const srv = http.createServer((q,r)=>{ const u=decodeURIComponent(q.url.split('?')[0]); const f = path.join('.', u === '/' ? 'index.html' : u); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);return r.end();} r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); r.end(d); }); }).listen(8124);
const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:720} }); p.setDefaultTimeout(300000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') errs.push(m.text()); });
await p.addInitScript(()=>localStorage.setItem('reelswars', JSON.stringify({quality:'high'})));
await p.goto('http://localhost:8124/'); try { await p.waitForFunction(()=>window.__game, null, {timeout:120000}); } catch(e) { console.log('NO GAME', errs); process.exit(1); }
await p.evaluate(()=>{ __game.startLevel(0); const G=__game.G; G.gold=5000; __game.placeHero('sigma',[4,4]); __game.placeHero('rizz',[6,4]); __game.placeHero('giga',[5,6]); });
await p.evaluate(()=>{ document.getElementById('hud').classList.remove('active'); });
await p.waitForTimeout(1500);
await p.evaluate(()=>{ const c=__game.cam, h=__game.G.heroes[0].m.root.position; c.target.set(h.x+2,1.5,h.z+1); c.dist=13; c.pitch=0.35; c.yaw=0; }); await p.waitForTimeout(800);
await p.screenshot({path:'../production/qa/evidence/07-glb-heroes.png'});
console.log('ERRORS:', errs); await b.close(); srv.close();
