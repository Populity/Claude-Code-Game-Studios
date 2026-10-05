// Reels Wars: Meme Defense — engine, game loop, UI.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ALLIES, GRID, HEROES, ENEMIES, LEVELS, difficulty, ULT, COMBO, EARLY_WAVE_BONUS, SELL_RATIO } from './data.js';
import { buildHero, setHeroLevel, animateHero, buildEnemy, animateEnemy, preloadModels, addEyes } from './models.js';
import { Sfx } from './audio.js';
import { buildWorld, cellToWorld } from './world.js';
import { LANGS, initLang, setLang, getLang, t, heroName, heroDesc, levelName, allyName, allyDesc, diffName, applyStatic } from './i18n.js';

const $ = id => document.getElementById(id);
const T = GRID.tile;

// ---------- Save ----------
const save = (() => { try { return JSON.parse(localStorage.getItem('reelswars') || '{}'); } catch { return {}; } })();
save.stars ||= {}; save.diff ||= 4;
const persist = () => { try { localStorage.setItem('reelswars', JSON.stringify(save)); } catch {} };

// ---------- Renderer ----------
// Quality: ULTRA renders at >=1080p internal resolution with GTAO + SMAA; HIGH skips AO.
save.quality ||= 'ultra';
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 600);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.45, 0.9);
composer.addPass(bloom); composer.addPass(new OutputPass());
const smaa = new SMAAPass(1, 1); composer.addPass(smaa);
function pixelRatio() { return save.quality === 'ultra' ? Math.min(2.5, Math.max(devicePixelRatio, 1080 / innerHeight, 1920 / innerWidth)) : Math.min(devicePixelRatio, 1.5); }
function resize() {
  const w = innerWidth, h = innerHeight, pr = pixelRatio();
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
  renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  gtao.enabled = save.quality === 'ultra';
}
addEventListener('resize', resize); resize();

const hemi = new THREE.HemisphereLight(0xc8bcff, 0x403020, 0.7); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0e0, 3.2);
sun.position.set(-30, 55, 28); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 32, bottom: -32, near: 1, far: 160 }); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
scene.add(sun);
const rim = new THREE.DirectionalLight(0xaad4ff, 0.8); rim.position.set(30, 20, -30); scene.add(rim);

// ---------- Camera control ----------
const cam = { yaw: 0, pitch: 0.95, dist: 42, target: new THREE.Vector3(0, 0, 1), shake: 0 };
function updateCamera(dt, t) {
  const s = cam.shake > 0 ? cam.shake : 0; cam.shake = Math.max(0, cam.shake - dt * 2.5);
  camera.position.set(cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist + (Math.random() - .5) * s,
    Math.sin(cam.pitch) * cam.dist + (Math.random() - .5) * s,
    cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
  camera.lookAt(cam.target);
}
let drag = null;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => { if (e.button === 2) drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => { if (drag) { cam.yaw -= (e.clientX - drag.x) * 0.005; cam.pitch = THREE.MathUtils.clamp(cam.pitch + (e.clientY - drag.y) * 0.004, 0.45, 1.35); drag = { x: e.clientX, y: e.clientY }; } });
canvas.addEventListener('wheel', e => { cam.dist = THREE.MathUtils.clamp(cam.dist + e.deltaY * 0.04, 25, 110); }, { passive: true });

// ---------- World building ----------
let world = null;
function buildLevelWorld(lvl) {
  if (world) scene.remove(world);
  const w = buildWorld(scene, lvl); world = w.world;
  hemi.color.set(w.theme.hemiSky); hemi.groundColor.set(w.theme.hemiGround); sun.color.set(w.theme.sun); rim.color.set(w.theme.hemiSky);
  return w;
}

// ---------- Particles ----------
const MAXP = 3000;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pMat = new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: dotTex() });
const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);
const parts = [];
function dotTex() { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(0.4, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); }
function burst(pos, color, n = 20, spd = 6, life = 0.7, up = 4) {
  const col = new THREE.Color(color);
  for (let i = 0; i < n && parts.length < MAXP; i++) parts.push({ p: pos.clone(), v: new THREE.Vector3((Math.random() - .5) * spd, Math.random() * up, (Math.random() - .5) * spd), c: col, life, max: life });
}
function updateParticles(dt) {
  let n = 0;
  for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; q.life -= dt; if (q.life <= 0) { parts.splice(i, 1); continue; } q.v.y -= 9 * dt; q.p.addScaledVector(q.v, dt); if (q.p.y < 0.1) { q.p.y = 0.1; q.v.multiplyScalar(0.5); } }
  for (const q of parts) { const k = q.life / q.max; pPos.set([q.p.x, q.p.y, q.p.z], n * 3); pCol.set([q.c.r * k, q.c.g * k, q.c.b * k], n * 3); n++; }
  pGeo.setDrawRange(0, n); pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

// ---------- Floating labels & HP bars ----------
const labels = $('labels'); const tmpV = new THREE.Vector3();
const floats = [];
function project(v) { tmpV.copy(v).project(camera); return [(tmpV.x + 1) / 2 * innerWidth, (1 - tmpV.y) / 2 * innerHeight, tmpV.z < 1]; }
function floatText(pos, text, color = '#ffd23f', size = 16) {
  const el = document.createElement('div'); el.className = 'ft'; el.textContent = text; el.style.color = color; el.style.fontSize = size + 'px'; labels.appendChild(el);
  floats.push({ el, p: pos.clone().setY(pos.y + 2.5), life: 1.1 });
}
function updateFloats(dt) {
  for (let i = floats.length - 1; i >= 0; i--) { const f = floats[i]; f.life -= dt; f.p.y += dt * 2.5; if (f.life <= 0) { f.el.remove(); floats.splice(i, 1); continue; }
    const [x, y, vis] = project(f.p); f.el.style.left = x + 'px'; f.el.style.top = y + 'px'; f.el.style.opacity = Math.min(1, f.life * 2); f.el.style.display = vis ? '' : 'none'; }
}

// ---------- Game state ----------
let G = null; // current run
const heroDef = id => HEROES.find(h => h.id === id);

function startLevel(idx) {
  const lvl = LEVELS[idx]; const D = difficulty(save.diff);
  labels.innerHTML = ''; floats.length = 0; parts.length = 0;
  const w = buildLevelWorld(lvl);
  G = { idx, lvl, D, ...w, gold: lvl.startGold, lives: Math.max(1, Math.round(lvl.lives * D.lives)), maxLives: 0,
    wave: 0, spawnQ: [], enemies: [], heroes: [], shots: [], beams: [], occupied: new Set(w.blocked), time: 0, waveTimer: 6, between: true,
    allyCd: {}, allies: [], selectedAlly: null, combo: 1, comboT: 0, comboKills: 0, ult: 0, speed: 1, paused: false, over: false, selectedShop: null, selectedHero: null, kills: 0, leaks: 0 };
  G.maxLives = G.lives;
  cam.target.set(0, 0, 2); cam.pitch = 1.0; cam.dist = 66; cam.yaw = 0;
  buildShop(); buildAllyBar(); hideSel(); show('hud'); updateHud();
  $('waveMax').textContent = lvl.waves.length;
  banner(t('lvl.banner', { n: lvl.id, name: levelName(lvl) }), 2.5);
  Sfx.music(true);
}

function spawnWave() {
  if (G.wave >= G.lvl.waves.length) return;
  const groups = G.lvl.waves[G.wave]; G.wave++; G.between = false;
  let t = 0;
  for (const [type, count, gap] of groups) {
    const n = Math.max(1, Math.round(count * (type === 'boss' ? 1 : G.D.countMul)));
    const R = G.routes.length;
    if (type === 'boss') for (let i = 0; i < n; i++) G.spawnQ.push({ type, route: (G.wave + i) % R, at: G.time + t + i * gap * 2 });
    else for (let r = 0; r < R; r++) { const m = Math.max(1, Math.ceil(n * 0.7)); for (let i = 0; i < m; i++) G.spawnQ.push({ type, route: r, at: G.time + t + i * gap + r * 0.3 }); }
    t += 0.5;
  }
  G.spawnQ.sort((a, b) => a.at - b.at);
  banner(G.wave === G.lvl.waves.length ? t('wave.final') : t('wave.n', { n: G.wave }), 1.5); Sfx.wave();
  if (groups.some(g => g[0] === 'boss')) { setTimeout(() => banner(t('boss'), 1.5), 1600); cam.shake = 1; }
  updateHud();
}

function makeEnemy(type, route = 0) {
  const wps = G.routes[route];
  const def = ENEMIES[type]; const m = buildEnemy(type);
  m.root.scale.setScalar(def.scale); m.root.position.copy(wps[0]); world.add(m.root);
  const hpEl = document.createElement('div'); hpEl.className = 'hpb'; hpEl.innerHTML = '<i></i>'; labels.appendChild(hpEl);
  const hp = def.hp * G.D.hp * (1 + G.wave * 0.06);
  G.enemies.push({ type, def, m, hp, maxHp: hp, shield: 0, wp: 1, speed: def.speed * G.D.speed, slow: 0, slowT: 0, stun: 0, burn: 0, burnT: 0, cd: def.shieldCd || 0, wps, t: Math.random() * 10, hpEl, dist: 0, dead: false });
  burst(wps[0].clone().setY(2), 0xffffff, 25, 5);
}

function damage(e, amt, src) {
  if (e.dead) return;
  amt *= (1 - e.def.armor * (src === 'burn' ? 0.5 : 1));
  if (e.shield > 0) { const s = Math.min(e.shield, amt); e.shield -= s; amt -= s; }
  e.hp -= amt;
  if (e.hp <= 0) kill(e);
}
function kill(e) {
  e.dead = true; G.kills++;
  G.comboKills++; G.comboT = COMBO.window;
  G.combo = Math.min(COMBO.max, 1 + Math.floor(G.comboKills / COMBO.step));
  const reward = Math.round(e.def.reward * G.D.reward * G.combo);
  G.gold += reward; G.ult = Math.min(1, G.ult + G.D.ultCharge / ULT.killsNeeded * (e.type === 'boss' ? 8 : e.type === 'tank' ? 2 : 1));
  const p = e.m.root.position.clone();
  floatText(p, `+${reward} 👍`, G.combo > 1 ? '#ff2e88' : '#ffd23f', G.combo > 1 ? 20 : 16);
  const big = e.type === 'tank' || e.type === 'boss';
  burst(p.clone().setY(1), big ? 0xff8020 : 0xff2e88, big ? 80 : 30, big ? 14 : 8, big ? 1.1 : 0.7, big ? 10 : 5);
  if (big) { cam.shake = Math.max(cam.shake, e.type === 'boss' ? 1.6 : 0.6); Sfx.boom(); } else Sfx.pop();
  world.remove(e.m.root); e.hpEl.remove();
  if (G.combo >= 3 && G.comboKills % COMBO.step === 0) { floatText(p, t('combo.pop', { n: G.combo }), '#22e6ff', 26); }
  updateHud();
}

function placeHero(id, cell) {
  const def = heroDef(id); if (G.gold < def.cost) return;
  G.gold -= def.cost;
  const m = buildHero(def); const p = cellToWorld(...cell); m.root.position.copy(p); world.add(m.root);
  const h = { def, m, lvl: 1, cell, cd: 0, atk: 0, target: null, spent: def.cost, buff: 0 };
  setHeroLevel(m, def, 1); G.heroes.push(h); G.occupied.add(cell.join(','));
  burst(p.clone().setY(1), def.accent, 50, 10, 0.9, 8); Sfx.place(); cam.shake = 0.3;
  floatText(p, def.name.toUpperCase(), '#fff', 15);
  updateHud(); buildShop();
}

const stat = h => h.def.levels[h.lvl - 1];

function heroUpdate(h, dt) {
  const s = stat(h); const pos = h.m.root.position;
  h.cd -= dt; h.atk = Math.max(0, h.atk - dt * 3);
  const mul = 1 + h.buff;
  let tgt = null, best = -1;
  for (const e of G.enemies) { if (e.dead) continue; const d = e.m.root.position.distanceTo(pos); if (d <= s.range && e.dist > best) { best = e.dist; tgt = e; } }
  if (tgt) { const tp = tgt.m.root.position; const yaw = Math.atan2(tp.x - pos.x, tp.z - pos.z); h.m.body.rotation.y = lerpAngle(h.m.body.rotation.y, yaw, Math.min(1, dt * 10)); }
  h.target = tgt;
  const k = h.def.kind;
  if (k === 'beam') { if (tgt) { damage(tgt, s.dmg * mul * dt, 'beam'); tgt.slow = Math.max(tgt.slow, s.slow); tgt.slowT = 0.3; if (tgt.shield > 0) tgt.shield -= 40 * dt; } return; }
  if (k === 'pulse') {
    // buff aura applied in buffPass
    if (h.cd <= 0 && G.enemies.some(e => !e.dead && e.m.root.position.distanceTo(pos) <= s.range)) {
      h.cd = s.rate; h.atk = 1;
      for (const e of G.enemies) if (!e.dead && e.m.root.position.distanceTo(pos) <= s.range) damage(e, s.dmg * mul, 'pulse');
      ringFx(pos, s.range, h.def.accent); Sfx.bass();
    }
    return;
  }
  if (!tgt || h.cd > 0) return;
  h.cd = s.rate; h.atk = 1;
  const muzzle = pos.clone().setY(2);
  if (k === 'sniper') {
    damage(tgt, s.dmg * mul, 'sniper'); tracer(muzzle, tgt.m.root.position.clone().setY(1.2), h.def.accent);
    burst(tgt.m.root.position.clone().setY(1.2), 0xffffff, 10, 5); Sfx.snipe();
  } else if (k === 'slam') {
    for (const e of G.enemies) if (!e.dead && e.m.root.position.distanceTo(pos) <= s.splash) { damage(e, s.dmg * mul, 'slam'); if (e.type !== 'boss' && e.type !== 'tank') e.stun = Math.max(e.stun, s.stun); }
    ringFx(pos, s.splash, h.def.accent); burst(pos.clone().setY(0.3), 0xffd23f, 40, 12, 0.6, 3); cam.shake = Math.max(cam.shake, 0.35); Sfx.slam();
  } else if (k === 'mortar') {
    const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff6a00, emissive: 0xff6a00, emissiveIntensity: 4 }));
    world.add(ballMesh);
    const lead = tgt.m.root.position.clone(); // simple lead: predict along velocity
    G.shots.push({ mesh: ballMesh, from: muzzle, to: lead, t: 0, dur: 0.9, s, mul, color: h.def.accent }); Sfx.throw();
  }
}
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

function tracer(a, b, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 })); world.add(line);
  G.beams.push({ obj: line, life: 0.15, max: 0.15 });
}
function ringFx(pos, r, color) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(pos).setY(0.3); world.add(ring);
  G.beams.push({ obj: ring, life: 0.45, max: 0.45, grow: r });
}

// persistent beam lines for 'beam' heroes
const beamPool = new Map();
function updateBeams() {
  for (const h of G.heroes) {
    if (h.def.kind !== 'beam') continue;
    let b = beamPool.get(h);
    if (!b) { b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xff5fb0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })); world.add(b); beamPool.set(h, b); }
    if (h.target && !h.target.dead) {
      const a = h.m.root.position.clone().setY(2.1), c = h.target.m.root.position.clone().setY(1.3);
      const len = a.distanceTo(c); b.visible = true; b.scale.set(1 + h.lvl * 0.5 + Math.sin(G.time * 40) * 0.4, len, 1 + h.lvl * 0.5);
      b.position.copy(a).lerp(c, 0.5); b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
      if (Math.random() < 0.4) burst(c, 0xff5fb0, 2, 3, 0.4, 2);
    } else b.visible = false;
  }
}

function useUlt() {
  if (!G || G.ult < 1 || G.paused || G.over) return;
  G.ult = 0; cam.shake = 2.2; Sfx.ult();
  banner(t('ult.banner'), 1.4);
  for (const e of [...G.enemies]) { if (e.dead) continue; e.stun = ULT.stun; damage(e, ULT.dmg * G.D.hp * 0.7, 'ult'); burst(e.m.root.position.clone().setY(1), 0x22e6ff, 25, 10, 1, 8); }
  for (let i = 0; i < 6; i++) { const rw = G.routes[i % G.routes.length]; ringFx(rw[1 + Math.floor(Math.random() * (rw.length - 2))], 12, i % 2 ? 0xff2e88 : 0x22e6ff); }
  updateHud();
}


// ---------- Sky allies ----------
function buildAlly(id) {
  const g = new THREE.Group(); const M = (c, o = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.4, clearcoat: 0.5, ...o });
  if (id === 'drone') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 0.8, 8, 16), M(0xffd23f)); body.rotation.z = Math.PI / 2; g.add(body);
    const cam = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), M(0x111111, { metalness: 0.8 })); cam.position.set(0, -0.3, 0.4); g.add(cam);
    g.userData.rotors = [];
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.2), M(0x333333)); arm.position.set(x * 0.6, 0.1, z * 0.6); arm.rotation.y = Math.atan2(x, z); g.add(arm);
      const r = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.15), M(0xffffff)); r.position.set(x * 1.0, 0.3, z * 1.0); g.add(r); g.userData.rotors.push(r); }
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 })); led.position.set(0, 0.4, 0); g.add(led);
  } else if (id === 'llama') {
    const wool = M(0xfff4e0, { roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0xffffff) });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 1.0, 8, 16), wool); body.rotation.x = Math.PI / 2; body.position.y = 1.4; g.add(body);
    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.9, 8, 12), wool); neck.position.set(0, 2.3, 0.7); g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 16), wool); head.position.set(0, 2.95, 0.85); head.scale.z = 1.3; g.add(head);
    addEyes(head, { y: 0.1, z: 0.3, spread: 0.17, size: 0.1, iris: 0x6b3fa0 });
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.35, 8), wool); ear.position.set(0.18 * s, 0.42, -0.05); head.add(ear); }
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.05), M(0xff2e88)); shades.position.set(0, 0.12, 0.42); head.add(shades);
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.8, 6, 10), wool); leg.position.set(x * 0.35, 0.55, z * 0.55); g.add(leg); }
    const chute = new THREE.Group(); chute.position.y = 6;
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4), M(0xff5fb0, { side: THREE.DoubleSide })); chute.add(canopy);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4.2), M(0xffffff)); line.position.set(Math.cos(a) * 1.1, -2.2, Math.sin(a) * 1.1); line.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); chute.add(line); }
    g.add(chute); g.userData.chute = chute;
  } else {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0x5a2a1a, emissive: 0xff5a00, emissiveIntensity: 1.2, flatShading: true, roughness: 0.9 })); g.add(rock);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(1.6, 5, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); fire.position.y = 3; g.add(fire);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function callAlly(id, point) {
  const def = ALLIES.find(a => a.id === id); if ((G.allyCd[id] || 0) > 0) return;
  G.allyCd[id] = def.cd; G.selectedAlly = null; ghost.visible = ghostRange.visible = false;
  const m = buildAlly(id); m.position.set(point.x, 45, point.z); world.add(m);
  G.allies.push({ def, m, target: point.clone(), phase: 'fall', t: 0, cd: 0 });
  banner(def.emoji + ' ' + allyName(def).toUpperCase(), 1.1); Sfx.wave(); buildAllyBar();
}
function enemiesNear(p, r) { return G.enemies.filter(e => !e.dead && e.m.root.position.distanceTo(p) <= r); }
function allyUpdate(a, dt) {
  const d = a.def, p = a.m.position; a.t += dt;
  if (a.phase === 'fall') {
    const speed = d.id === 'meteor' ? 55 : d.id === 'llama' ? 14 : 30; const floor = d.id === 'drone' ? 7 : 0;
    p.y = Math.max(floor, p.y - speed * dt); if (d.id === 'meteor') { a.m.rotation.x += dt * 4; burst(p, 0xff8020, 3, 2, 0.5, 1); }
    if (d.id === 'llama') a.m.rotation.z = Math.sin(a.t * 3) * 0.15;
    if (p.y > floor) return;
    a.phase = 'active'; a.t = 0;
    if (d.id === 'meteor') {
      for (const e of enemiesNear(a.target, d.radius)) { damage(e, d.dmg * G.D.hp * 0.6, 'ult'); e.burn = d.burn; e.burnT = 4; }
      burst(a.target.clone().setY(1), 0xff6a00, 160, 22, 1.4, 16); ringFx(a.target, d.radius, 0xff3b1f); ringFx(a.target, d.radius * 1.4, 0xffd23f); cam.shake = 2.4; Sfx.boom(); Sfx.ult(); a.done = true; world.remove(a.m); return;
    }
    if (d.id === 'llama') {
      a.m.rotation.z = 0; a.m.remove(a.m.userData.chute);
      for (const e of enemiesNear(a.target, d.radius)) { damage(e, d.dmg * G.D.hp * 0.6, 'slam'); e.stun = Math.max(e.stun, d.stun); }
      burst(a.target.clone().setY(0.3), 0xfff4e0, 70, 14, 0.8, 5); ringFx(a.target, d.radius, 0xff5fb0); cam.shake = 1.2; Sfx.slam();
    }
    return;
  }
  if (a.t >= d.life) { a.done = true; burst(p.clone().setY(p.y + 1), 0xffffff, 30, 6, 0.6, 6); world.remove(a.m); return; }
  if (d.id === 'drone') { a.m.userData.rotors.forEach((r, i) => r.rotation.y += dt * 40 * (i % 2 ? 1 : -1)); p.x = a.target.x + Math.cos(a.t * 0.8) * 3; p.z = a.target.z + Math.sin(a.t * 0.8) * 3; p.y = 7 + Math.sin(a.t * 3) * 0.3; }
  a.cd -= dt; if (a.cd > 0) return;
  const tgt = enemiesNear(d.id === 'drone' ? a.target : p, d.range).sort((x, y) => y.dist - x.dist)[0]; if (!tgt) return;
  a.cd = d.rate; const from = p.clone().setY(d.id === 'drone' ? p.y - 0.4 : 3); const to = tgt.m.root.position.clone().setY(1.2);
  if (d.id === 'llama') a.m.rotation.y = Math.atan2(to.x - p.x, to.z - p.z);
  damage(tgt, (d.id === 'drone' ? d.dmg : d.spit) * G.D.hp * 0.6, 'ally'); tracer(from, to, d.id === 'drone' ? 0xffd23f : 0xb8ff6a); burst(to, d.id === 'drone' ? 0xffd23f : 0xb8ff6a, 6, 4, 0.4, 2); Sfx.snipe();
}
function buildAllyBar() {
  const bar = $('allies'); bar.innerHTML = '';
  for (const a of ALLIES) { const cd = G.allyCd[a.id] || 0; const el = document.createElement('div');
    el.className = 'ally' + (cd > 0 ? ' cd' : '') + (G.selectedAlly === a.id ? ' on' : ''); el.title = allyDesc(a); el.dataset.id = a.id;
    el.innerHTML = `<span class="em">${a.emoji}</span><span><b>${allyName(a)}</b><br><small>${cd > 0 ? Math.ceil(cd) + t('sec') : t('ally.ready', { k: a.key })}</small></span><i style="width:${cd > 0 ? (1 - cd / a.cd) * 100 : 100}%"></i>`;
    el.onclick = () => selectAlly(a.id); bar.appendChild(el); }
}
function selectAlly(id) { if (!G || (G.allyCd[id] || 0) > 0) return; Sfx.click(); G.selectedAlly = G.selectedAlly === id ? null : id; G.selectedShop = null; buildShop(); buildAllyBar(); }

// ---------- Update loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  const rt = now / 1000;
  if (G && !G.paused && !G.over) for (let i = 0; i < G.speed; i++) step(dt);
  if (G) { G.base.rotation.y = Math.sin(rt * 0.5) * 0.3; updateLabels(); }
  updateParticles(dt * (G?.paused ? 0 : 1)); updateFloats(dt);
  if (!G || $('menu').classList.contains('active') || $('levels').classList.contains('active') || $('heroes').classList.contains('active') || $('howto').classList.contains('active')) menuScene(rt);
  updateCamera(dt, rt);
  composer.render();
}

function step(dt) {
  G.time += dt;
  // waves
  if (G.between && G.wave < G.lvl.waves.length) { G.waveTimer -= dt; if (G.waveTimer <= 0) spawnWave(); }
  while (G.spawnQ.length && G.spawnQ[0].at <= G.time) { const q = G.spawnQ.shift(); makeEnemy(q.type, q.route); };
  if (!G.between && !G.spawnQ.length && !G.enemies.length) {
    if (G.wave >= G.lvl.waves.length) return finish(true);
    G.between = true; G.waveTimer = 9; G.gold += 40 + G.wave * 10; floatText(G.base.position.clone(), t('wave.clear', { n: 40 + G.wave * 10 }), '#22e6ff', 18); updateHud();
  }
  // combo decay
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) { G.comboKills = 0; G.combo = 1; updateHud(); } }
  // enemies
  for (const e of G.enemies) {
    if (e.dead) continue; e.t += dt;
    if (e.burnT > 0) { e.burnT -= dt; damage(e, e.burn * dt, 'burn'); if (Math.random() < 0.3) burst(e.m.root.position.clone().setY(1.2), 0xff6a00, 1, 1, 0.5, 3); if (e.dead) continue; }
    if (e.slowT > 0) e.slowT -= dt; else e.slow = 0;
    if (e.def.shieldAura) { e.cd -= dt; if (e.cd <= 0) { e.cd = e.def.shieldCd; for (const o of G.enemies) if (!o.dead && o.m.root.position.distanceTo(e.m.root.position) < e.def.shieldAura) o.shield = Math.max(o.shield, e.def.shieldAmt * G.D.hp); ringFx(e.m.root.position, e.def.shieldAura, 0x22e6ff); } }
    if (e.stun > 0) { e.stun -= dt; e.m.shield.visible = e.shield > 0; continue; }
    const v = e.speed * (1 - e.slow) * dt;
    const target = e.wps[e.wp]; const pos = e.m.root.position;
    const dir = target.clone().sub(pos); const d = dir.length();
    if (d <= v) { pos.copy(target); e.wp++; if (e.wp >= e.wps.length) { leak(e); continue; } }
    else { dir.normalize(); pos.addScaledVector(dir, v); e.m.root.rotation.y = lerpAngle(e.m.root.rotation.y, Math.atan2(dir.x, dir.z), Math.min(1, dt * 8)); }
    e.dist += v; e.m.shield.visible = e.shield > 0;
    animateEnemy(e.m, e.type, e.t, e.speed * (1 - e.slow));
  }
  G.enemies = G.enemies.filter(e => !e.dead);
  // hero buffs (cat DJ aura)
  for (const h of G.heroes) h.buff = 0;
  for (const c of G.heroes) if (c.def.kind === 'pulse') for (const h of G.heroes) if (h !== c && h.m.root.position.distanceTo(c.m.root.position) <= stat(c).range) h.buff = Math.max(h.buff, stat(c).buff);
  for (const h of G.heroes) { heroUpdate(h, dt); animateHero(h.m, h.def, G.time + h.cell[0], h.atk); }
  for (const a of G.allies) allyUpdate(a, dt);
  G.allies = G.allies.filter(a => !a.done);
  for (const k in G.allyCd) if (G.allyCd[k] > 0) G.allyCd[k] -= dt;
  updateBeams();
  // mortar shots
  for (const s of G.shots) {
    s.t += dt / s.dur; const k = Math.min(1, s.t);
    s.mesh.position.lerpVectors(s.from, s.to, k); s.mesh.position.y += Math.sin(k * Math.PI) * 6;
    s.mesh.rotation.x += dt * 15;
    if (Math.random() < 0.8) burst(s.mesh.position, 0xff6a00, 1, 0.5, 0.35, 0.5);
    if (k >= 1) {
      s.done = true; world.remove(s.mesh);
      for (const e of G.enemies) if (!e.dead && e.m.root.position.distanceTo(s.to) <= s.s.splash) { damage(e, s.s.dmg * s.mul, 'mortar'); e.burn = s.s.burn; e.burnT = 3; }
      burst(s.to.clone().setY(0.5), 0xff6a00, 60, 12, 0.9, 9); ringFx(s.to, s.s.splash, 0xff3b1f); cam.shake = Math.max(cam.shake, 0.5); Sfx.boom();
    }
  }
  G.shots = G.shots.filter(s => !s.done);
  for (const b of G.beams) { b.life -= dt; const k = b.life / b.max; b.obj.material.opacity = k; if (b.grow) b.obj.scale.setScalar(b.grow * (1 - k * 0.8)); if (b.life <= 0) world.remove(b.obj); }
  G.beams = G.beams.filter(b => b.life > 0);
}

function leak(e) {
  e.dead = true; world.remove(e.m.root); e.hpEl.remove(); G.leaks++;
  G.lives -= e.def.dmg; cam.shake = 1; Sfx.hurt();
  floatText(G.base.position.clone(), `-${e.def.dmg} ❤`, '#ff3030', 22);
  G.comboKills = 0; G.combo = 1;
  if (G.lives <= 0) { G.lives = 0; finish(false); }
  updateHud();
}

function updateLabels() {
  for (const e of G.enemies) {
    const [x, y, vis] = project(e.m.root.position.clone().setY(e.def.scale * 3.1));
    const el = e.hpEl; el.style.display = vis ? '' : 'none'; el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.width = (e.type === 'boss' ? 80 : e.type === 'tank' ? 46 : 34) + 'px';
    el.firstChild.style.width = Math.max(0, e.hp / e.maxHp * 100) + '%';
    el.firstChild.style.background = e.hp / e.maxHp > 0.5 ? '#4f4' : e.hp / e.maxHp > 0.25 ? '#fd3' : '#f43';
    el.classList.toggle('sh', e.shield > 0);
  }
}

function finish(win) {
  G.over = true; Sfx.music(false);
  const ratio = G.lives / G.maxLives; const stars = win ? (ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : 1) : 0;
  if (win) { const key = G.lvl.id; save.stars[key] = Math.max(save.stars[key] || 0, stars); persist(); Sfx.win(); } else Sfx.lose();
  $('endTitle').textContent = win ? t('end.win') : t('end.lose');
  $('endStars').textContent = win ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
  $('endText').textContent = t('end.stats', { d: diffName(save.diff, G.D.name), v: save.diff, k: G.kills, l: G.leaks });
  $('btnNext').textContent = win ? (G.idx < LEVELS.length - 1 ? t('end.nextLevel') : t('end.again')) : t('end.rematch');
  $('end').classList.add('active');
}

// ---------- Input on field ----------
const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2();
const ghost = new THREE.Mesh(new THREE.BoxGeometry(T * 0.95, 0.1, T * 0.95), new THREE.MeshBasicMaterial({ color: 0x22ffb0, transparent: true, opacity: 0.45 }));
ghost.visible = false; scene.add(ghost);
const ghostRange = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: 0x22ffb0, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
ghostRange.rotation.x = -Math.PI / 2; ghostRange.visible = false; scene.add(ghostRange);

function pickCell(e) {
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera);
  const hit = new THREE.Vector3(); ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit);
  if (!hit) return null;
  const c = Math.floor(hit.x / T + GRID.w / 2), r = Math.floor(hit.z / T + GRID.h / 2);
  if (c < 0 || r < 0 || c >= GRID.w || r >= GRID.h) return null; return [c, r];
}
canvas.addEventListener('pointermove', e => {
  if (G && G.selectedAlly) { const cell = pickCell(e); if (!cell) return; const p = cellToWorld(...cell); const a = ALLIES.find(x => x.id === G.selectedAlly);
    ghostRange.position.set(p.x, 0.1, p.z); ghostRange.scale.setScalar(a.radius || a.range); ghostRange.material.color.set(0x22e6ff); ghostRange.visible = true; ghost.visible = false; return; }
  if (G) ghostRange.material.color.set(0x22ffb0);
  if (!G || !G.selectedShop) { ghost.visible = ghostRange.visible = false; return; }
  const cell = pickCell(e); if (!cell) { ghost.visible = ghostRange.visible = false; return; }
  const ok = !G.pathSet.has(cell.join(',')) && !G.occupied.has(cell.join(','));
  const p = cellToWorld(...cell); ghost.position.set(p.x, 0.08, p.z); ghost.material.color.set(ok ? 0x22ffb0 : 0xff3030); ghost.visible = true;
  const r = heroDef(G.selectedShop).levels[0].range; ghostRange.position.set(p.x, 0.1, p.z); ghostRange.scale.setScalar(r); ghostRange.visible = true;
});
canvas.addEventListener('pointerdown', e => {
  if (!G || e.button !== 0 || G.over) return;
  const cell = pickCell(e); if (!cell) return; const key = cell.join(',');
  if (G.selectedAlly) { callAlly(G.selectedAlly, cellToWorld(...cell)); return; }
  if (G.selectedShop) {
    if (!G.pathSet.has(key) && !G.occupied.has(key)) { placeHero(G.selectedShop, cell); if (G.gold < heroDef(G.selectedShop).cost) { G.selectedShop = null; ghost.visible = ghostRange.visible = false; buildShop(); } }
    return;
  }
  const h = G.heroes.find(h => h.cell.join(',') === key); selectHero(h || null);
});

function selectHero(h) {
  if (G.selectedHero) G.selectedHero.m.rangeRing.visible = false;
  G.selectedHero = h; if (!h) return hideSel();
  h.m.rangeRing.visible = true; h.m.rangeRing.scale.setScalar(stat(h).range);
  const s = stat(h); const nextCost = h.def.upg[h.lvl];
  const el = $('sel'); el.classList.remove('hidden');
  el.innerHTML = `<h3>${h.def.emoji} ${heroName(h.def)} <span class="stars">${'★'.repeat(h.lvl)}</span></h3>
    <div class="muted">${heroDesc(h.def)}</div>
    <div>${t('sel.dmg')}: <b>${s.dmg}</b>${h.def.kind === 'beam' ? t('sel.perSec') : ''} · ${t('sel.range')}: <b>${s.range}</b>${h.buff ? ` · ${t('sel.buff')}: +${Math.round(h.buff * 100)}%` : ''}</div>
    <div class="row">${nextCost ? `<button class="btn sm" id="bUp" ${G.gold < nextCost ? 'disabled' : ''}>${t('sel.upgrade', { c: nextCost })}</button>` : `<b class="stars">${t('sel.max')}</b>`}
    <button class="btn sm" id="bSell">${t('sel.sell', { c: Math.round(h.spent * SELL_RATIO) })}</button></div>`;
  $('bUp') && ($('bUp').onclick = () => { if (G.gold < nextCost) return; G.gold -= nextCost; h.spent += nextCost; h.lvl++; setHeroLevel(h.m, h.def, h.lvl); burst(h.m.root.position.clone().setY(1.5), 0xffd23f, 60, 8, 1, 10); Sfx.upgrade(); floatText(h.m.root.position, 'LEVEL UP!', '#ffd23f', 22); updateHud(); selectHero(h); });
  $('bSell').onclick = () => { G.gold += Math.round(h.spent * SELL_RATIO); world.remove(h.m.root); const b = beamPool.get(h); if (b) { world.remove(b); beamPool.delete(h); } G.heroes.splice(G.heroes.indexOf(h), 1); G.occupied.delete(h.cell.join(',')); G.selectedHero = null; hideSel(); updateHud(); Sfx.pop(); };
}
function hideSel() { $('sel').classList.add('hidden'); }

// ---------- UI ----------
function show(id) { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id)); }
const qBtn = $('btnQuality');
const qLabel = () => qBtn.textContent = t('menu.gfx', { q: t(save.quality === 'ultra' ? 'gfx.ultra' : 'gfx.high') });
qBtn.onclick = () => { save.quality = save.quality === 'ultra' ? 'high' : 'ultra'; persist(); qLabel(); resize(); }; qLabel();
document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { Sfx.click(); if (b.dataset.go === 'levels') renderLevels(); if (b.dataset.go === 'heroes') renderHeroes(); show(b.dataset.go); });
let bannerT;
function banner(text, dur) { const b = $('banner'); b.textContent = text; b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), dur * 1000); }

function buildShop() {
  const shop = $('shop'); shop.innerHTML = '';
  HEROES.forEach((h, i) => {
    const d = document.createElement('div'); d.className = 'hero' + (G.selectedShop === h.id ? ' on' : '') + (G.gold < h.cost ? ' poor' : '');
    d.innerHTML = `<span class="em">${h.emoji}</span>${heroName(h)}<br><b>${h.cost}👍</b> <small class="muted">[${i + 1}]</small>`; d.title = heroDesc(h);
    d.onclick = () => selectShop(h.id); shop.appendChild(d);
  });
}
function selectShop(id) { if (!G) return; Sfx.click(); G.selectedShop = G.selectedShop === id ? null : id; selectHero(null); buildShop(); }
function updateHud() {
  if (!G) return;
  $('lives').textContent = G.lives; $('gold').textContent = G.gold; $('wave').textContent = G.wave;
  $('combo').textContent = G.combo; $('comboBox').style.transform = `scale(${1 + (G.combo - 1) * 0.08})`;
  $('ultFill').style.width = (G.ult * 100) + '%'; $('btnUlt').disabled = G.ult < 1;
  $('btnWave').disabled = !G.between || G.wave >= G.lvl.waves.length;
  document.querySelectorAll('.shop .hero').forEach((d, i) => d.classList.toggle('poor', G.gold < HEROES[i].cost));
}
$('btnWave').onclick = () => { if (G?.between) { G.gold += EARLY_WAVE_BONUS; spawnWave(); } };
$('btnSpeed').onclick = () => { if (!G) return; G.speed = G.speed === 1 ? 2 : G.speed === 2 ? 3 : 1; $('btnSpeed').textContent = 'x' + G.speed; };
$('btnPause').onclick = () => { if (!G || G.over) return; G.paused = true; $('pause').classList.add('active'); };
$('btnResume').onclick = () => { G.paused = false; $('pause').classList.remove('active'); };
$('btnRestart').onclick = () => { $('pause').classList.remove('active'); clearRun(); startLevel(G_idx()); };
$('btnQuit').onclick = () => { $('pause').classList.remove('active'); quit(); };
$('btnUlt').onclick = useUlt;
$('btnNext').onclick = () => { $('end').classList.remove('active'); const won = G.lives > 0; const i = won ? Math.min(G.idx + 1, LEVELS.length - 1) : G.idx; const next = won && G.idx === LEVELS.length - 1 ? G.idx : i; clearRun(); startLevel(next); };
$('btnEndMenu').onclick = () => { $('end').classList.remove('active'); quit(); };
const G_idx = () => G.idx;
function clearRun() { for (const b of beamPool.values()) world.remove(b); beamPool.clear(); labels.innerHTML = ''; }
function quit() { clearRun(); G = null; Sfx.music(false); setupMenuScene(); show('menu'); }
setInterval(() => { updateHud(); if (G) buildAllyBar(); }, 250);

addEventListener('keydown', e => {
  if (!G) return;
  if (e.key >= '1' && e.key <= '5') selectShop(HEROES[+e.key - 1].id);
  const ak = ALLIES.find(a => a.key.toLowerCase() === e.key.toLowerCase() || ({ z: 'я', x: 'ч', c: 'с' })[a.key.toLowerCase()] === e.key); if (ak) selectAlly(ak.id);
  if (e.key === 'q' || e.key === 'Q' || e.key === 'й') useUlt();
  if (e.key === ' ') { e.preventDefault(); $('btnWave').click(); }
  if (e.key === 'f' || e.key === 'а') $('btnSpeed').click();
  if (e.key === 'Escape') { if (G.selectedAlly) { G.selectedAlly = null; buildAllyBar(); ghostRange.visible = false; } else if (G.selectedShop) { G.selectedShop = null; buildShop(); ghost.visible = ghostRange.visible = false; } else if (G.paused) $('btnResume').click(); else $('btnPause').click(); }
});

function renderLevels() {
  const wrap = $('levelCards'); wrap.innerHTML = '';
  LEVELS.forEach((l, i) => {
    const unlocked = i === 0 || save.stars[LEVELS[i - 1].id];
    const st = save.stars[l.id] || 0;
    const c = document.createElement('div'); c.className = 'card' + (unlocked ? '' : ' locked');
    c.innerHTML = `<div class="em">${l.emoji}</div><h3>${l.id}. ${levelName(l)}</h3><p>${t('card.waves', { w: l.waves.length, p: l.paths.length, l: l.lives })}</p><div class="stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</div>${unlocked ? '' : `<p>${t('card.locked')}</p>`}`;
    c.onclick = () => { Sfx.click(); startLevel(i); }; wrap.appendChild(c);
  });
  diffUi();
}
function diffUi() { const D = difficulty(save.diff); $('diff').value = save.diff; $('diffVal').textContent = save.diff; $('diffName').textContent = diffName(save.diff, D.name); $('diffName').style.color = save.diff >= 9 ? '#ff3030' : save.diff >= 6 ? '#ffa040' : '#22ffb0';
  $('diffInfo').textContent = t('diff.info', { hp: D.hp.toFixed(2), sp: D.speed.toFixed(2), rw: D.reward.toFixed(2) }) + (D.lives < 1 ? t('diff.lives') : ''); }
$('diff').oninput = e => { save.diff = +e.target.value; persist(); diffUi(); };
function renderHeroes() {
  const wrap = $('heroCards'); wrap.innerHTML = '';
  HEROES.forEach(h => { const c = document.createElement('div'); c.className = 'card'; c.innerHTML = `<div class="em">${h.emoji}</div><h3>${heroName(h)}</h3><p>${heroDesc(h)}</p><p>${t('card.price')}: <b>${h.cost}👍</b> · ${t('card.dmg')} ${h.levels[0].dmg}→${h.levels[2].dmg}</p>`; wrap.appendChild(c); });
}

// ---------- Menu background scene ----------
let menuHeroes = [];
function setupMenuScene() {
  const w = buildLevelWorld(LEVELS[0]); G = null;
  menuHeroes = HEROES.map((def, i) => { const m = buildHero(def); setHeroLevel(m, def, 3); m.root.position.set((i - 2) * 4, 0, 6); world.add(m.root); return { m, def }; });
  
}
function menuScene(t) {
  cam.yaw = Math.sin(t * 0.1) * 0.5; cam.dist = 40; cam.pitch = 0.5; cam.target.set(0, 2, 4);
  menuHeroes.forEach((h, i) => { animateHero(h.m, h.def, t + i, Math.max(0, Math.sin(t * 2 + i))); h.m.body.rotation.y = Math.sin(t * 0.6 + i) * 0.6; });
  
}
document.addEventListener('click', () => Sfx.unlock(), { once: true });

initLang(save.lang); applyStatic(); qLabel();
const langBtn = $('btnLang');
const langLabel = () => langBtn.textContent = t('menu.lang') + ': ' + LANGS[getLang()];
langBtn.onclick = () => { const ks = Object.keys(LANGS); const next = ks[(ks.indexOf(getLang()) + 1) % ks.length]; setLang(next); save.lang = next; persist(); applyStatic(); qLabel(); langLabel(); Sfx.click(); };
langLabel();
await preloadModels(HEROES);
setupMenuScene(); show('menu');
requestAnimationFrame(frame);
// debug hook for automated QA
window.__game = { cam, get G() { return G; }, startLevel, spawnWave: () => spawnWave(), placeHero: (id, c) => placeHero(id, c), callAlly: (id, c) => callAlly(id, cellToWorld(...c)), useUlt, show };
