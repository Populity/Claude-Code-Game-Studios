// Procedural 3D models for heroes and enemies, with animation rigs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// AI-generated character meshes (GLB). Heroes with a `model` path in data.js use them;
// the procedural rig is the fallback when a file is missing or fails to load.
const GLB = {};
export async function preloadModels(defs) {
  const loader = new GLTFLoader();
  await Promise.all(defs.filter(d => d.model).map(d => loader.loadAsync(d.model + (window.ASSET_SUFFIX || '')).then(g => { GLB[d.id] = g.scene; }).catch(e => console.warn('model fallback', d.id, e.message))));
}
function glbBody(id, height) {
  const src = GLB[id].clone(true); const wrap = new THREE.Group(); wrap.add(src);
  src.rotation.y = -Math.PI / 2; // generated meshes face +X; game convention is +Z
  const box = new THREE.Box3().setFromObject(src), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = height / size.y; src.scale.setScalar(k); src.position.set(-c.x * k, -box.min.y * k + 0.3, -c.z * k);
  src.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 1.2; } });
  return wrap;
}

const mat = (color, opts = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.5, metalness: 0.05, clearcoat: 0.4, clearcoatRoughness: 0.35, sheen: 0.3, ...opts });
const glow = (color, i = 2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i });


// Big glossy cartoon eyes — the single biggest "animated film" read.
const EYE_W = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1 });
const EYE_P = new THREE.MeshPhysicalMaterial({ color: 0x1a1020, roughness: 0.1, clearcoat: 1 });
const EYE_H = new THREE.MeshBasicMaterial({ color: 0xffffff });
export function addEyes(parent, { y = 0.05, z = 0.36, spread = 0.15, size = 0.11, iris = 0x5a3a1a, angry = false, lid = 0 } = {}) {
  const irisM = new THREE.MeshPhysicalMaterial({ color: iris, roughness: 0.2, clearcoat: 1 });
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(spread * s, y, z);
    const w = new THREE.Mesh(new THREE.SphereGeometry(size, 24, 16), EYE_W); w.scale.z = 0.7; g.add(w);
    const ir = new THREE.Mesh(new THREE.SphereGeometry(size * 0.6, 20, 14), irisM); ir.position.z = size * 0.5; ir.scale.z = 0.5; g.add(ir);
    const p = new THREE.Mesh(new THREE.SphereGeometry(size * 0.33, 16, 12), EYE_P); p.position.z = size * 0.68; p.scale.z = 0.5; g.add(p);
    const h = new THREE.Mesh(new THREE.SphereGeometry(size * 0.12, 8, 6), EYE_H); h.position.set(size * 0.2 * -s, size * 0.25, size * 0.8); g.add(h);
    if (lid) { const l = new THREE.Mesh(new THREE.SphereGeometry(size * 1.05, 20, 12, 0, Math.PI * 2, 0, Math.PI * lid), new THREE.MeshPhysicalMaterial({ color: 0xd8a080, roughness: 0.6 })); l.rotation.x = -0.3; g.add(l); }
    if (angry) { const b = new THREE.Mesh(new THREE.BoxGeometry(size * 1.8, size * 0.35, size * 0.4), EYE_P); b.position.set(0, size * 1.15, size * 0.4); b.rotation.z = 0.45 * s; g.add(b); }
    parent.add(g);
  }
}

function shadowAll(o) { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; }

function humanoid(skin, shirt, pants) {
  const g = new THREE.Group();
  const rig = {};
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 10, 24), mat(shirt));
  body.position.y = 1.35; g.add(body); rig.body = body;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 40, 30), mat(skin, { roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color(0xffc8a8) }));
  head.position.y = 2.25; g.add(head); rig.head = head;
  const mkLimb = (x, y, len, r, m) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 16), m);
    l.position.y = -len / 2 - r; pivot.add(l); g.add(pivot); return pivot;
  };
  rig.armL = mkLimb(-0.58, 1.75, 0.55, 0.14, mat(skin));
  rig.armR = mkLimb(0.58, 1.75, 0.55, 0.14, mat(skin));
  rig.legL = mkLimb(-0.22, 0.85, 0.5, 0.17, mat(pants));
  rig.legR = mkLimb(0.22, 0.85, 0.5, 0.17, mat(pants));
  return { g, rig };
}

// ---------------- HEROES ----------------
export function buildHero(def) {
  const root = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, 0.3, 32), mat(0x1a1030, { metalness: 0.6, roughness: 0.3 }));
  base.position.y = 0.15; root.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.06, 8, 48), glow(def.accent, 3));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.32; root.add(ring);

  let h;
  if (GLB[def.id]) h = { g: glbBody(def.id, 2.8), rig: null };
  else switch (def.id) {
    case 'sigma': {
      h = humanoid(0xd8b48c, 0x15151c, 0x22222a);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.5), mat(0xd8b48c)); jaw.position.set(0, -0.25, 0.08); h.rig.head.add(jaw);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.44, 16, 10, 0, Math.PI * 2, 0, 1.2), mat(0x111111)); hair.position.y = 0.06; h.rig.head.add(hair);
      const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.13, 0.08), glow(0x22e6ff, 1.5)); glasses.position.set(0, 0.05, 0.4); h.rig.head.add(glasses);
      const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.8), mat(0x222233, { metalness: 0.8 })); rifle.position.set(0, -0.7, 0.6); h.rig.armR.add(rifle);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 10), glow(0x22e6ff, 2)); scope.rotation.x = Math.PI / 2; scope.position.set(0, -0.58, 0.5); h.rig.armR.add(scope);
      h.rig.armR.rotation.x = -1.2; h.rig.muzzle = rifle;
      break;
    }
    case 'rizz': {
      h = humanoid(0xf2c6a8, 0xff5fb0, 0x2b0a24);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 14), mat(0xffe066, { roughness: 0.3 })); hair.position.set(0, 0.08, -0.12); hair.scale.set(1, 1.15, 1); h.rig.head.add(hair);
      addEyes(h.rig.head, { iris: 0x2e9d6a, size: 0.12, spread: 0.16 });
      const lips = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.035, 6, 12), glow(0xff2e88, 2)); lips.position.set(0, -0.17, 0.4); h.rig.head.add(lips);
      const phone = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.45, 0.04), glow(0xff9cd5, 1.2)); phone.position.set(0, -0.75, 0.15); h.rig.armR.add(phone);
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.7, 20, 1, true), mat(0xff2e88)); skirt.position.y = 0.95; h.g.add(skirt);
      h.rig.armR.rotation.x = -1.4; h.rig.muzzle = phone;
      break;
    }
    case 'giga': {
      h = humanoid(0xc98a5c, 0xffffff, 0x1a3a8a);
      h.rig.body.scale.set(1.45, 1.05, 1.15);
      h.rig.armL.scale.set(1.8, 1.1, 1.8); h.rig.armR.scale.set(1.8, 1.1, 1.8);
      h.rig.armL.position.x = -0.85; h.rig.armR.position.x = 0.85;
      addEyes(h.rig.head, { iris: 0x3a6ad8, angry: true });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 24), glow(0xffd23f, 2)); band.rotation.x = Math.PI / 2; band.position.y = 0.15; h.rig.head.add(band);
      const mkDb = () => { const d = new THREE.Group(); const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9), mat(0x999999, { metalness: 0.9 })); bar.rotation.z = Math.PI / 2; d.add(bar);
        for (const s of [-0.4, 0.4]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.14, 18), mat(0x111111, { metalness: 0.7 })); p.rotation.z = Math.PI / 2; p.position.x = s; d.add(p); } d.position.y = -0.85; return d; };
      h.rig.armL.add(mkDb()); h.rig.armR.add(mkDb());
      break;
    }
    case 'cat': {
      h = { g: new THREE.Group(), rig: {} };
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 18), mat(0x2d2d3a)); body.scale.set(1, 1.15, 0.95); body.position.y = 1.2; h.g.add(body); h.rig.body = body;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 18), mat(0x2d2d3a)); head.position.y = 2.15; h.g.add(head); h.rig.head = head;
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 4), mat(0x2d2d3a)); ear.position.set(0.3 * s, 0.5, 0); ear.rotation.z = -0.3 * s; head.add(ear);
        
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16), glow(0x8b5cff, 2)); cup.rotation.z = Math.PI / 2; cup.position.set(0.55 * s, 0, 0); head.add(cup);
      }
      addEyes(head, { y: 0.08, z: 0.45, spread: 0.2, size: 0.15, iris: 0x22d890 });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.05, 8, 24, Math.PI), mat(0x111111)); band.position.y = 0.1; head.add(band);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.7), mat(0x111122, { metalness: 0.6 })); deck.position.set(0, 1.0, 0.75); h.g.add(deck);
      for (const s of [-1, 1]) { const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 24), glow(0x22ffb0, 1.5)); disc.position.set(0.4 * s, 1.13, 0.75); h.g.add(disc); (h.rig.discs ||= []).push(disc); }
      const tail = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 20, Math.PI * 1.2), mat(0x2d2d3a)); tail.position.set(0, 0.9, -0.6); tail.rotation.y = Math.PI / 2; h.g.add(tail); h.rig.tail = tail;
      break;
    }
    case 'baba': {
      h = humanoid(0xf0cfb0, 0xd94a3a, 0x5a2a20);
      addEyes(h.rig.head, { iris: 0x7a4a2a, size: 0.1, lid: 0.3 });
      const scarf = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12, 0, Math.PI * 2, 0, 1.9), mat(0xffd23f)); scarf.position.y = 0.05; h.rig.head.add(scarf);
      const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.0, 20), mat(0x3b6bd9)); skirt.position.y = 0.85; h.g.add(skirt);
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), mat(0xffffff, { side: THREE.DoubleSide })); apron.position.set(0, 1.0, 0.62); apron.rotation.x = -0.25; h.g.add(apron);
      const pan = new THREE.Group(); const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.1, 20), mat(0x222222, { metalness: 0.8 }));
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.6), mat(0x442211)); handle.position.z = -0.45; pan.add(disk, handle);
      const fire = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glow(0xff6a00, 4)); fire.position.y = 0.12; pan.add(fire); h.rig.fire = fire;
      pan.position.set(0, -0.85, 0.3); h.rig.armR.add(pan); h.rig.armR.rotation.x = -0.6;
      break;
    }
  }
  root.add(h.g);
  shadowAll(root);
  const rangeRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), new THREE.MeshBasicMaterial({ color: def.accent, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  rangeRing.rotation.x = -Math.PI / 2; rangeRing.position.y = 0.05; rangeRing.visible = false; root.add(rangeRing);
  const stars = new THREE.Group(); stars.position.y = 3.2; root.add(stars);
  return { root, body: h.g, rig: h.rig, ring, rangeRing, stars };
}

export function setHeroLevel(model, def, lvl) {
  model.stars.clear();
  for (let i = 0; i < lvl; i++) {
    const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), glow(0xffd23f, 3));
    s.position.x = (i - (lvl - 1) / 2) * 0.4; model.stars.add(s);
  }
  model.body.scale.setScalar(1 + (lvl - 1) * 0.12);
  model.ring.material.emissiveIntensity = 2 + lvl * 1.5;
}

export function animateHero(m, def, t, attackT) {
  const r = m.rig; const a = Math.max(0, attackT); // 1 → just attacked
  m.body.position.y = Math.sin(t * 3) * 0.05;
  m.stars.rotation.y = t * 2;
  if (!r) { m.body.scale.y = m.body.scale.x * (1 + a * 0.06); return; }
  if (def.id === 'cat') {
    r.head.rotation.z = Math.sin(t * 8) * 0.2; r.head.position.y = 2.15 + Math.abs(Math.sin(t * 8)) * 0.12;
    r.discs.forEach(d => d.rotation.y = t * 12); r.tail.rotation.z = Math.sin(t * 5) * 0.4;
    r.body.scale.y = 1.15 + a * 0.2;
  } else if (def.id === 'giga') {
    r.armL.rotation.x = -2.8 * a + Math.sin(t * 4) * 0.2; r.armR.rotation.x = -2.8 * a - Math.sin(t * 4) * 0.2;
    r.body.rotation.x = 0.3 * a;
  } else if (def.id === 'sigma') {
    r.armR.rotation.x = -1.45 + a * 0.4; r.armL.rotation.x = -1.1; r.head.rotation.y = Math.sin(t * 0.7) * 0.1;
    r.body.position.z = -a * 0.15;
  } else if (def.id === 'rizz') {
    r.armL.rotation.z = 0.4 + Math.sin(t * 5) * 0.3; r.armR.rotation.x = -1.5; r.body.rotation.z = Math.sin(t * 4) * 0.08;
    r.head.rotation.z = Math.sin(t * 4 + 1) * 0.12;
  } else if (def.id === 'baba') {
    r.armR.rotation.x = -0.6 - a * 2.2; r.fire.scale.setScalar(1 + Math.sin(t * 20) * 0.25);
    r.armL.rotation.x = Math.sin(t * 6) * 0.5;
  }
}

// ---------------- ENEMIES ----------------
export function buildEnemy(type) {
  const root = new THREE.Group(); let rig = {};
  if (type === 'soldier' || type === 'runner') {
    const h = humanoid(0xc9a07a, type === 'runner' ? 0xcc3333 : 0x4a5a2a, 0x2a3018); rig = h.rig;
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.47, 16, 10, 0, Math.PI * 2, 0, 1.5), mat(type === 'runner' ? 0x881111 : 0x3a4a1a)); helmet.position.y = 0.08; rig.head.add(helmet);
    addEyes(rig.head, { y: -0.02, z: 0.34, iris: type === 'runner' ? 0xd02020 : 0x556b2f, angry: true, size: 0.1 });
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.9), mat(0x111111)); gun.position.set(0, -0.6, 0.3); rig.armR.add(gun);
    root.add(h.g);
  } else if (type === 'tank' || type === 'boss') {
    const boss = type === 'boss';
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.4), mat(boss ? 0x3a0a3a : 0x4a5040, { metalness: 0.7, roughness: 0.35 })); hull.position.y = 0.75; root.add(hull);
    for (const s of [-1, 1]) { const tr = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 2.6), mat(0x111111)); tr.position.set(0.95 * s, 0.45, 0); root.add(tr); }
    const turret = new THREE.Group(); turret.position.y = 1.3; root.add(turret);
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 0.5, 16), mat(boss ? 0x5a1a5a : 0x5a6050, { metalness: 0.7 })); turret.add(dome);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.6), mat(0x222222, { metalness: 0.9 })); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.05, 1.0); turret.add(barrel);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow(boss ? 0xff00ff : 0xff3020, 4)); light.position.set(0, 0.3, 0.4); turret.add(light);
    if (boss) { for (const s of [-1, 1]) { const horn = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.9, 8), glow(0xff00aa, 2)); horn.position.set(0.5 * s, 0.6, 0); horn.rotation.z = -0.5 * s; turret.add(horn); } }
    rig = { turret, hull };
  } else if (type === 'mage') {
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.0, 20), mat(0x3a1a8a)); robe.position.y = 1.0; root.add(robe);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), mat(0xb8a0ff)); head.position.y = 2.15; root.add(head);
    addEyes(head, { y: 0.02, z: 0.28, spread: 0.12, size: 0.09, iris: 0x8a2be2, angry: true });
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 16), mat(0x2a0a6a)); hat.position.y = 2.75; hat.rotation.z = 0.2; root.add(hat);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), glow(0x22e6ff, 4)); orb.position.set(0.8, 1.8, 0.3); root.add(orb);
    rig = { orb, robe, hat };
  }
  shadowAll(root);
  const shield = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 14), new THREE.MeshBasicMaterial({ color: 0x22e6ff, transparent: true, opacity: 0.18, depthWrite: false }));
  shield.position.y = 1.2; shield.visible = false; root.add(shield);
  return { root, rig, shield };
}

export function animateEnemy(m, type, t, speed) {
  const r = m.rig;
  if (r.legL) {
    const s = Math.sin(t * speed * 3.2);
    r.legL.rotation.x = s * 0.8; r.legR.rotation.x = -s * 0.8;
    r.armL.rotation.x = -s * 0.6; r.armR.rotation.x = -1.2;
    r.body.position.y = 1.35 + Math.abs(s) * 0.06;
  } else if (r.turret) {
    r.turret.rotation.y = Math.sin(t * 0.8) * 0.5; r.hull.position.y = 0.75 + Math.sin(t * 20) * 0.02;
  } else if (r.orb) {
    r.orb.position.y = 1.8 + Math.sin(t * 3) * 0.2; r.orb.rotation.y = t * 3;
    r.robe.rotation.z = Math.sin(t * 2) * 0.05;
  }
}
