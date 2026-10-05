import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary' };
const srv = http.createServer((q,r)=>{ const u=decodeURIComponent(q.url.split('?')[0]); const f = path.join('.', u === '/' ? 'index.html' : u); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);return r.end();} r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'}); r.end(d); }); }).listen(8126);
const b = await chromium.launch({ args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport:{width:1280,height:720} }); p.setDefaultTimeout(300000);
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error'||m.type()==='warning') errs.push(m.text()); });
await p.addInitScript(()=>localStorage.setItem('reelswars', JSON.stringify({quality:'high'})));
await p.goto('http://localhost:8126/'); try { await p.waitForFunction(()=>window.__game, null, {timeout:120000}); } catch(e) { console.log('NO GAME', errs); process.exit(1); }
await p.evaluate(()=>{ __game.startLevel(0); const G=__game.G; G.gold=5000; __game.placeHero('sigma',[4,4]); __game.spawnWave(); G.speed=1; });
await p.evaluate(()=>{ document.getElementById('hud').classList.remove('active'); });
await p.waitForTimeout(1500);
await p.evaluate(()=>{ const c=__game.cam, h=__game.G.heroes[0].m.root.position; c.target.set(h.x+2,1.5,h.z+1); c.dist=40; c.pitch=0.9; c.yaw=0; c.target.set(-14,0,-8); __game.callAlly('llama',[3,2]); __game.callAlly('drone',[8,4]); __game.callAlly('meteor',[6,2]); const A=__game.G.allies; A[0].m.position.y=5; A[1].m.position.y=7.5; A[2].m.position.y=9; }); await p.waitForTimeout(2500);
console.log(JSON.stringify(await p.evaluate(()=>({n:__game.G.allies.length, a:__game.G.allies.map(a=>[a.def.id,a.phase,a.m.position.toArray().map(v=>v.toFixed(1))]), cd:__game.G.allyCd, t:__game.G.time}))));
await p.screenshot({path:'../production/qa/evidence/09-allies.png'});
console.log('ERRORS:', errs); await b.close(); srv.close();
