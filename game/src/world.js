// Level environments: cartoon-style themed worlds with multiple winding routes.
import * as THREE from 'three';
import { GRID } from './data.js';

const T = GRID.tile;
export const cellToWorld = (c, r) => new THREE.Vector3((c - GRID.w / 2 + 0.5) * T, 0, (r - GRID.h / 2 + 0.5) * T);
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...o });

export const THEMES = {
  meadow: { skyTop: '#4aa8ff', skyBot: '#cfeeff', fog: 0xbfe4ff, ground: 0x6cc24a, ground2: 0x58ad3c, road: 0x5b5e66, curbA: 0xffffff, curbB: 0xe53935, sun: 0xfff1d6, hemiSky: 0xbfe0ff, hemiGround: 0x5a7a3a },
  canyon: { skyTop: '#ff9a52', skyBot: '#ffe0a8', fog: 0xffd9a0, ground: 0xe0a35e, ground2: 0xcf8f4a, road: 0x8a5a3a, curbA: 0xfff3d0, curbB: 0x2a9df4, sun: 0xffe0b0, hemiSky: 0xffd6a0, hemiGround: 0x9a5a30 },
  glacier: { skyTop: '#2c4f9e', skyBot: '#b9d8ff', fog: 0xc8e2ff, ground: 0xeef6ff, ground2: 0xd4e6fa, road: 0x7d94b8, curbA: 0xffffff, curbB: 0x7b4dff, sun: 0xe8f0ff, hemiSky: 0xcfe4ff, hemiGround: 0x8aa0c0 },
};

function skyTexture(top, bot) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, top); g.addColorStop(1, bot); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function groundTexture(th) {
  const S = 24, c = document.createElement('canvas'); c.width = GRID.w * S; c.height = GRID.h * S; const x = c.getContext('2d');
  const a = new THREE.Color(th.ground), b = new THREE.Color(th.ground2);
  for (let i = 0; i < GRID.w; i++) for (let j = 0; j < GRID.h; j++) {
    x.fillStyle = a.clone().lerp(b, ((i + j) % 2) * 0.5 + Math.random() * 0.25).getStyle(); x.fillRect(i * S, j * S, S, S);
  }
  for (let n = 0; n < 2500; n++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; x.beginPath(); x.arc(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 3, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function tracePath(points) {
  const cells = [];
  for (let i = 0; i < points.length - 1; i++) {
    let [c, r] = points[i]; const [c2, r2] = points[i + 1];
    while (c !== c2 || r !== r2) { cells.push([c, r]); c += Math.sign(c2 - c); r += Math.sign(r2 - r); }
  }
  cells.push(points.at(-1)); return cells;
}
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- Props (rounded, chunky, saturated) ----------
const PROPS = {
  meadow: [
    (r) => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.4, 10), M(0x7a4a2a)); tr.position.y = 0.7; g.add(tr);
      const leaf = M([0x3fae3a, 0x55c447, 0x2f9a40][Math.floor(r() * 3)]);
      for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.7 + r() * 0.35, 16, 12), leaf); s.position.set((r() - .5) * 0.9, 1.9 + r() * 0.6, (r() - .5) * 0.9); g.add(s); } return g; },
    (r) => { const g = new THREE.Group(); const wall = [0xfff3e0, 0xffe082, 0xb3e5fc, 0xf8bbd0][Math.floor(r() * 4)];
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.4), M(wall)); b.position.y = 0.6; g.add(b);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.9, 4), M(0xd84315)); roof.position.y = 1.65; roof.rotation.y = Math.PI / 4; g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.05), M(0x6d4c41)); door.position.set(0, 0.3, 0.72); g.add(door);
      for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), M(0x81d4fa, { emissive: 0x335577, emissiveIntensity: 0.3 })); w.position.set(0.5 * s, 0.75, 0.72); g.add(w); }
      return g; },
    (r) => { const g = new THREE.Group(); for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), M([0xff5252, 0xffeb3b, 0xe040fb, 0xffffff][Math.floor(r() * 4)])); f.position.set((r() - .5) * 1.4, 0.2, (r() - .5) * 1.4); g.add(f); } return g; },
  ],
  canyon: [
    (r) => { const g = new THREE.Group(); const m = M(0x3f9b4a); const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.4, 6, 12), m); body.position.y = 1; g.add(body);
      for (const s of [-1, 1]) { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 10), m); arm.position.set(0.45 * s, 1.1 + r() * 0.4, 0); g.add(arm); }
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M(0xff4081)); fl.position.y = 1.95; g.add(fl); return g; },
    (r) => { const g = new THREE.Group(); let y = 0; const cols = [0xc0582e, 0xd8743c, 0xe89350];
      for (let i = 0; i < 3; i++) { const h = 0.8 + r() * 0.6, rad = 1.3 - i * 0.25; const s = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.92, rad, h, 9), M(cols[i], { flatShading: true })); s.position.y = y + h / 2; y += h; g.add(s); } return g; },
    () => { const g = new THREE.Group(); const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6), M(0xb5703c, { flatShading: true })); s.position.y = 0.35; s.scale.y = 0.7; g.add(s); return g; },
  ],
  glacier: [
    (r) => { const g = new THREE.Group(); const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.6), M(0x5d4037)); tr.position.y = 0.3; g.add(tr);
      for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(1 - i * 0.25, 1.1, 10), M(0x1f6f5c)); c.position.y = 0.9 + i * 0.6; g.add(c);
        const sn = new THREE.Mesh(new THREE.ConeGeometry(0.75 - i * 0.22, 0.4, 10), M(0xffffff)); sn.position.y = 1.25 + i * 0.6; g.add(sn); } return g; },
    (r) => { const g = new THREE.Group(); const m = M(0x9fd8ff, { roughness: 0.1, metalness: 0.1, emissive: 0x3388cc, emissiveIntensity: 0.25, transparent: true, opacity: 0.9 });
      for (let i = 0; i < 4; i++) { const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.4 + r() * 0.3), m); c.scale.y = 2.2; c.position.set((r() - .5), 0.6, (r() - .5)); c.rotation.z = (r() - .5) * 0.6; g.add(c); } return g; },
    () => { const g = new THREE.Group(); const w = M(0xffffff);
      [[0.55, 0.5], [0.4, 1.2], [0.28, 1.75]].forEach(([rad, y]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 16, 12), w); s.position.y = y; g.add(s); });
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 8), M(0xff8f00)); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.75, 0.35); g.add(nose);
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 12), M(0x222222)); hat.position.y = 2.1; g.add(hat); return g; },
  ],
};

export function buildWorld(scene, lvl) {
  const th = THEMES[lvl.theme];
  const world = new THREE.Group(); scene.add(world);
  scene.background = skyTexture(th.skyTop, th.skyBot); scene.fog = new THREE.Fog(th.fog, 80, 170);
  const R = rng(lvl.id * 7919);

  // ground slab with rounded cartoon edge
  const W = GRID.w * T, H = GRID.h * T;
  const ground = new THREE.Mesh(new THREE.BoxGeometry(W, 1, H), [M(th.ground2), M(th.ground2), new THREE.MeshStandardMaterial({ map: groundTexture(th), roughness: 0.9 }), M(th.ground2), M(th.ground2), M(th.ground2)]);
  ground.position.y = -0.5; ground.receiveShadow = true; world.add(ground);
  const outer = new THREE.Mesh(new THREE.CircleGeometry(220, 48), M(new THREE.Color(th.ground2).multiplyScalar(0.85)));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -1.01; outer.receiveShadow = true; world.add(outer);

  // grass / snow tufts (instanced) — fine surface detail
  const tuftCol = { meadow: 0x4fae2e, canyon: 0xb5a04a, glacier: 0xffffff }[lvl.theme];
  const TUFTS = 6000; const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 0.45, 4), M(tuftCol, { roughness: 0.8 }), TUFTS);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), mm = new THREE.Matrix4(); let tn = 0;
  const tmpSet = new Set(); lvl.paths.forEach(pts => tracePath(pts).forEach(c => tmpSet.add(c.join(','))));
  for (let i = 0; i < TUFTS * 2 && tn < TUFTS; i++) {
    const x = (R() - 0.5) * W, z = (R() - 0.5) * H; const c = Math.floor(x / T + GRID.w / 2), r = Math.floor(z / T + GRID.h / 2);
    if (tmpSet.has(c + ',' + r)) continue;
    e.set((R() - .5) * 0.5, R() * 6.28, (R() - .5) * 0.5); q.setFromEuler(e); const k = lvl.theme === 'glacier' ? 0.5 : 0.6 + R() * 0.8; sc.set(k, k, k); ps.set(x, 0.18 * k, z);
    tuft.setMatrixAt(tn, mm.compose(ps, q, sc)); tuft.setColorAt(tn, new THREE.Color(tuftCol).offsetHSL(0, 0, (R() - 0.5) * 0.15)); tn++;
  }
  tuft.count = tn; tuft.receiveShadow = true; world.add(tuft);

  // routes → road cells
  const pathSet = new Set(); const allCells = [];
  const routes = lvl.paths.map(pts => {
    for (const c of tracePath(pts)) { const k = c.join(','); if (!pathSet.has(k)) { pathSet.add(k); allCells.push(c); } }
    const wps = pts.map(p => cellToWorld(...p));
    const dir = wps[0].clone().sub(wps[1]).normalize();
    return [wps[0].clone().addScaledVector(dir, T * 1.5), ...wps];
  });
  const m4 = new THREE.Matrix4();
  const road = new THREE.InstancedMesh(new THREE.BoxGeometry(T, 0.2, T), M(th.road, { roughness: 0.8 }), allCells.length);
  allCells.forEach(([c, r], i) => { const p = cellToWorld(c, r); m4.makeTranslation(p.x, 0.0, p.z); road.setMatrixAt(i, m4); });
  road.receiveShadow = true; world.add(road);
  // dashed centre line markings
  const dashMat = M(0xffffff, { roughness: 0.4 });
  const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.03, 0.7), dashMat, allCells.length);
  allCells.forEach(([c, r], i) => { const p = cellToWorld(c, r); const h = pathSet.has((c + 1) + ',' + r) || pathSet.has((c - 1) + ',' + r);
    const v = pathSet.has(c + ',' + (r + 1)) || pathSet.has(c + ',' + (r - 1));
    m4.makeRotationY(h && !v ? Math.PI / 2 : 0).setPosition(p.x, 0.11, p.z); if (h && v) m4.makeScale(0, 0, 0); dash.setMatrixAt(i, m4); });
  world.add(dash);
  // racing curbs (alternating colours, Cars-style)
  const curbs = [];
  for (const [c, r] of allCells) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (pathSet.has((c + dc) + ',' + (r + dr))) continue; const p = cellToWorld(c, r);
    for (let k = 0; k < 2; k++) { const off = (k - 0.5) * T * 0.5; curbs.push([p.x + dc * T * 0.47 + (dc ? 0 : off), p.z + dr * T * 0.47 + (dr ? 0 : off), dc !== 0, (c + r + k) % 2]); }
  }
  const curb = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.28, T * 0.5), M(0xffffff, { roughness: 0.35 }), curbs.length);
  const ca = new THREE.Color(th.curbA), cb = new THREE.Color(th.curbB);
  curbs.forEach(([x, z, vert, alt], i) => { m4.makeRotationY(vert ? 0 : Math.PI / 2).setPosition(x, 0.12, z); curb.setMatrixAt(i, m4); curb.setColorAt(i, alt ? ca : cb); });
  curb.castShadow = true; world.add(curb);

  // spawn gates (one per route)
  const portals = routes.map((wp, i) => {
    const g = new THREE.Group(); g.position.copy(wp[0]); world.add(g);
    const yaw = Math.atan2(wp[1].x - wp[0].x, wp[1].z - wp[0].z); g.rotation.y = yaw;
    const col = [0xff5252, 0xffb300, 0x7c4dff, 0x00bfa5][i % 4];
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 4, 12), M(0x37474f)); p.position.set(1.6 * s, 2, 0); p.castShadow = true; g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4, 0.7, 0.5), M(col)); beam.position.y = 4.1; g.add(beam);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.4, 0.55), M(0xffffff, { emissive: col, emissiveIntensity: 0.6 })); sign.position.y = 4.1; g.add(sign);
    const core = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.6), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, side: THREE.DoubleSide })); core.position.y = 1.9; g.add(core);
    return g;
  });

  // HQ: chunky phone-tower base
  const endP = routes[0].at(-1);
  const base = new THREE.Group(); base.position.copy(endP); world.add(base);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 0.8, 32), M(0xb0bec5)); plinth.position.y = 0.4; base.add(plinth);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 4.4, 0.7), M(0x263238, { roughness: 0.3 })); body.position.y = 3; base.add(body);
  const phone = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.9, 0.1), new THREE.MeshStandardMaterial({ color: 0xff2e88, emissive: 0xff2e88, emissiveIntensity: 0.9 })); phone.position.set(0, 3, 0.36); base.add(phone);
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), M(0xffffff, { emissive: 0xff8fc0, emissiveIntensity: 0.15 })); heart.position.set(0, 3, 0.5); base.add(heart);
  base.traverse(o => { o.castShadow = true; });

  // props: inside field on free cells (blocking them), and a dense ring outside
  const props = PROPS[lvl.theme]; const blocked = new Set();
  const near = (c, r) => { for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (pathSet.has((c + dc) + ',' + (r + dr))) return true; return false; };
  for (let i = 0; i < 40; i++) {
    const c = Math.floor(R() * GRID.w), r = Math.floor(R() * GRID.h), k = c + ',' + r;
    if (pathSet.has(k) || blocked.has(k) || near(c, r) || endP.distanceTo(cellToWorld(c, r)) < 6) continue;
    const g = props[Math.floor(R() * props.length)](R); g.position.copy(cellToWorld(c, r)); g.rotation.y = R() * 6.28; g.scale.setScalar(0.9 + R() * 0.3);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); world.add(g); blocked.add(k);
  }
  for (let i = 0; i < 110; i++) {
    const a = R() * Math.PI * 2, d = 1.12 + R() * 0.9; const x = Math.cos(a) * W / 2 * d, z = Math.sin(a) * H / 2 * d;
    if (Math.abs(x) < W / 2 + 2 && Math.abs(z) < H / 2 + 2) continue;
    const g = props[Math.floor(R() * props.length)](R); g.position.set(x, -1, z); g.rotation.y = R() * 6.28; g.scale.setScalar(1.2 + R() * 1.6);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; }); world.add(g);
  }
  return { world, pathSet, blocked, routes, portals, phone, base, theme: th };
}
