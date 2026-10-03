/**
 * TESSERA — character art: Mira (player) and ЛЮМ (companion drone).
 *
 * Public API (contract: docs/level-format.md §4):
 *   G.Art.Player.draw(ctx, p, t)                      world space; feet at p.y+p.h, centred on p.x+p.w/2
 *   G.Art.Drone.draw(ctx, d, t)                       world space; d.x,d.y = centre
 *   G.Art.Player.drawItem(ctx, item, x, y, t, scale)  repair-part icon (fuse/cell/gear/lens/chip/core/valve/antenna)
 *
 * Animation model
 *   A lightweight 2D skeleton (hip, torso, neck/head, 2-bone IK arms and legs) is posed procedurally
 *   per state ("target pose") and then low-pass blended into the displayed pose, so state changes
 *   never pop. Squash & stretch is a damped spring kicked by jump / land / turn events, plus a
 *   velocity stretch in the air. Hair strands and the belt lanyard are Verlet chains simulated in
 *   WORLD space, so they trail real motion (follow-through) and spring back to their rest shape.
 *   All per-character memory lives in WeakMaps keyed by the entity; p / d are never written to.
 *
 * Lighting
 *   Key light from the upper-left in WORLD space (independent of facing), warm rim on light-facing
 *   edges, cool ambient rim from the lower-right. Glows use additive radial gradients (no shadowBlur).
 *
 * Companions & buffs (docs/companions-spec.md)
 *   G.Art.Party.draw(ctx, c, t)  party member: c.who 'rex' (Рекс: follow/idle/run/jump/controlled/help/
 *                                throw/down, talking) or 'lum' (delegates to G.Art.Drone + control ring /
 *                                help stun pulse). Mira reads p.buffs (shield bubble, glider wing, jetpack
 *                                flame, boots glow, slowmo after-images) and p.iframes (hit flash + blink).
 *
 * Chapter 2 (docs/chapter2-spec.md §2, §4)
 *   p.state 'dash'  : streamlined lunge blended from dashDir (8-way), magenta after-image trail, burst
 *                     on start. Hair cools to steel-blue while p.dashCharges <= 0 and flashes on refill.
 *   p.state 'swing' : both hands on the rope, body hangs along it, legs pump with velocity. The rope
 *                     is drawn from p.rope {ax, ay} to her near hand (taut cable + travelling pulse).
 *   p.talking       : live dialogue acting (p.talkMood ∈ portrait moods): hand gestures, head bob,
 *                     lip flap, brows and mouth shape. ЛЮМ (d.talking / d.talkMood) bobs and pulses.
 *   All Chapter 2 fields are read defensively; missing fields fall back to Chapter 1 behaviour.
 *
 * The draw functions are self-timed from `t` (level time): they sub-step the springs at 60 Hz, so
 * they behave identically whether called every frame or once after G.step(n).
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);
  const easeOutBack = (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
  const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const KEY_X = -0.6, KEY_Y = -0.8;            // direction TOWARD the key light, world space
  const STEP = 1 / 60;

  // ------------------------------------------------------------------ palette
  const C = {
    line: '#12141d',
    suit: ['#9e3f1e', '#e2712d', '#ffb16c'],      // shadow, base, light
    suitFar: ['#5e2617', '#94462a', '#b65f37'],
    gra: ['#1b1f2e', '#373e55', '#606b8c'],
    graFar: ['#121520', '#232838', '#363d53'],
    skin: ['#b8775c', '#efbf9d', '#ffe6cf'],
    skinFar: ['#8e5643', '#c48e72', '#d9a487'],
    hair: ['#341310', '#6a2619', '#b04f30'],
    boot: ['#101219', '#252937', '#4c546d'],
    bootFar: ['#0b0d13', '#191c27', '#2b3042'],
    stripe: '#eef8ff', stripeFar: '#8d9bb0',
    belt: ['#2e2219', '#5a432f', '#8f6e4c'],
    metal: '#d3dae6',
    warmRim: 'rgba(255,236,205,0.85)',
    coolRim: 'rgba(110,165,255,0.42)', hairRim: 'rgba(255,165,120,0.9)', hairCool: 'rgba(120,150,230,0.35)',
  };

  // ------------------------------------------------------------------ small helpers
  /** Additive radial glow (cheap replacement for shadowBlur). col = 'r,g,b'. */
  function glow(ctx, x, y, r, col, a) {
    if (a <= 0.002) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col},${a})`);
    g.addColorStop(0.4, `rgba(${col},${a * 0.45})`);
    g.addColorStop(1, `rgba(${col},0)`);
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = op;
  }

  /** Two-bone IK. Writes joint into j and (reach-clamped) end into e. bend: +1 / -1 picks the side. */
  function ik(a, tx, ty, l1, l2, bend, j, e) {
    let dx = tx - a.x, dy = ty - a.y;
    let d = Math.hypot(dx, dy);
    if (d < 1e-4) { dx = 0; dy = 1; d = 1e-4; }
    const dc = clamp(d, Math.abs(l1 - l2) + 0.05, (l1 + l2) * 0.999);
    const base = Math.atan2(dy, dx);
    const A = Math.acos(clamp((l1 * l1 + dc * dc - l2 * l2) / (2 * l1 * dc), -1, 1)) * bend;
    j.x = a.x + Math.cos(base + A) * l1; j.y = a.y + Math.sin(base + A) * l1;
    e.x = a.x + Math.cos(base) * dc; e.y = a.y + Math.sin(base) * dc;
  }

  /**
   * Jointed limb (polyline) with outline + 3-tone cylindrical shading. Layers are drawn across all
   * segments before the next layer so joints stay seamless. Light offset is projected onto each
   * segment's normal so the lit side always reads correctly.
   */
  function limb(ctx, pts, segs, lx, ly) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let layer = 0; layer < 4; layer++) {
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i], a = pts[i], b = pts[i + 1];
        let w, col, o;
        if (layer === 0) { w = s.w + 1.5; col = C.line; o = 0; }
        else if (layer === 1) { w = s.w; col = s.pal[0]; o = 0; }
        else if (layer === 2) { w = s.w * 0.7; col = s.pal[1]; o = s.w * 0.14; }
        else { w = s.w * 0.26; col = s.pal[2]; o = s.w * 0.3; }
        let ox = 0, oy = 0;
        if (o) {
          let dx = b.x - a.x, dy = b.y - a.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
          const dot = lx * dx + ly * dy; let px = lx - dot * dx, py = ly - dot * dy;
          const pl = Math.hypot(px, py) || 1; px /= pl; py /= pl;
          ox = px * o; oy = py * o;
        }
        ctx.lineWidth = w; ctx.strokeStyle = col;
        ctx.beginPath(); ctx.moveTo(a.x + ox, a.y + oy); ctx.lineTo(b.x + ox, b.y + oy); ctx.stroke();
      }
    }
  }

  /** A band across a segment (reflective stripe / cuff). */
  function band(ctx, a, b, f0, f1, w, col) {
    ctx.lineCap = 'butt';
    ctx.lineWidth = w; ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.moveTo(lerp(a.x, b.x, f0), lerp(a.y, b.y, f0));
    ctx.lineTo(lerp(a.x, b.x, f1), lerp(a.y, b.y, f1));
    ctx.stroke();
    ctx.lineCap = 'round';
  }

  /**
   * Fill a closed shape with outline, then clip to it and lay a warm key rim on light-facing edges
   * and a cool ambient rim on the opposite edges. `inner` (optional) draws details inside the clip.
   */
  function shape(ctx, path, fill, lx, ly, inner, outlineW, warm, cool) {
    path(ctx);
    if (outlineW !== 0) { ctx.lineWidth = outlineW || 1.5; ctx.strokeStyle = C.line; ctx.lineJoin = 'round'; ctx.stroke(); }
    ctx.fillStyle = fill; ctx.fill();
    ctx.save();
    path(ctx); ctx.clip();
    if (inner) inner(ctx);
    ctx.save(); ctx.translate(-lx * 0.75, -ly * 0.75); path(ctx);
    ctx.lineWidth = 0.75; ctx.strokeStyle = warm || C.warmRim; ctx.globalAlpha = 0.6; ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(lx * 0.6, ly * 0.6); path(ctx);
    ctx.lineWidth = 0.65; ctx.strokeStyle = cool || C.coolRim; ctx.stroke(); ctx.restore();
    ctx.restore();
  }

  // ------------------------------------------------------------------ repair-part icons
  const ITEM_GLOW = {
    fuse: '255,200,90', cell: '120,255,140', gear: '255,190,110', lens: '120,235,255',
    chip: '90,240,255', core: '200,150,255', valve: '255,120,100', antenna: '255,110,110',
  };

  /**
   * Draw a small glowing icon for a repair item (~10 px at scale 1), centred on x,y.
   * Shared so the entities art can reuse the same silhouettes.
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} item fuse|cell|gear|lens|chip|core|valve|antenna
   * @param {number} x
   * @param {number} y
   * @param {number} t seconds (animates glints / blinks)
   * @param {number} [scale=1]
   */
  function drawItem(ctx, item, x, y, t, scale) {
    ctx.save();
    ctx.translate(x, y);
    if (scale && scale !== 1) ctx.scale(scale, scale);
    const gcol = ITEM_GLOW[item] || '255,255,255';
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    glow(ctx, 0, 0, 10, gcol, 0.28 + 0.12 * pulse);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = C.line; ctx.lineWidth = 0.9;
    switch (item) {
      case 'fuse': {
        ctx.rotate(-0.35);
        G.roundRect(ctx, -3.4, -1.9, 6.8, 3.8, 1.3); ctx.fillStyle = 'rgba(190,230,255,0.45)'; ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#ffd36a'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-2.6, 0);
        for (let i = 1; i <= 6; i++) ctx.lineTo(-2.6 + i * 0.87, i % 2 ? -0.9 : 0.9);
        ctx.stroke();
        glow(ctx, 0, 0, 4, '255,210,90', 0.5 + 0.3 * pulse);
        for (const sx of [-4.6, 3.0]) {
          ctx.fillStyle = C.metal; ctx.strokeStyle = C.line; ctx.lineWidth = 0.8;
          G.roundRect(ctx, sx, -2.3, 1.6, 4.6, 0.4); ctx.fill(); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(-2.6, -1.5, 4.4, 0.5);
        break;
      }
      case 'cell': {
        ctx.fillStyle = C.metal; ctx.fillRect(-1.1, -5.4, 2.2, 1.3); ctx.strokeRect(-1.1, -5.4, 2.2, 1.3);
        G.roundRect(ctx, -3, -4.3, 6, 8.8, 1.1); ctx.fillStyle = '#283044'; ctx.fill(); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const on = i < 2 || pulse > 0.5;
          ctx.fillStyle = on ? '#8dff92' : '#2f5a3a';
          ctx.fillRect(-1.9, 2.1 - i * 2.2, 3.8, 1.5);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-2.6, -3.8, 0.7, 7.6);
        break;
      }
      case 'gear': {
        ctx.rotate(t * 0.9);
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a0 = (i / 8) * TAU;
          ctx.lineTo(Math.cos(a0 - 0.2) * 4.6, Math.sin(a0 - 0.2) * 4.6);
          ctx.lineTo(Math.cos(a0 + 0.2) * 4.6, Math.sin(a0 + 0.2) * 4.6);
          ctx.lineTo(Math.cos(a0 + 0.36) * 3.4, Math.sin(a0 + 0.36) * 3.4);
          ctx.lineTo(Math.cos(a0 + TAU / 8 - 0.36) * 3.4, Math.sin(a0 + TAU / 8 - 0.36) * 3.4);
        }
        ctx.closePath();
        const g = ctx.createLinearGradient(-3, -3, 3, 3);
        g.addColorStop(0, '#ffd08a'); g.addColorStop(1, '#8d5a22');
        ctx.fillStyle = g; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 1.4, 0, TAU); ctx.fillStyle = '#2a1d12'; ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, TAU); ctx.strokeStyle = 'rgba(80,45,15,0.7)'; ctx.lineWidth = 0.5; ctx.stroke();
        break;
      }
      case 'lens': {
        ctx.beginPath(); ctx.arc(0, 0, 4.4, 0, TAU); ctx.fillStyle = '#8f9bb0'; ctx.fill(); ctx.stroke();
        const g = ctx.createRadialGradient(-1, -1, 0.3, 0, 0, 3.3);
        g.addColorStop(0, '#e6ffff'); g.addColorStop(0.5, '#59d6f0'); g.addColorStop(1, '#14506a');
        ctx.beginPath(); ctx.arc(0, 0, 3.3, 0, TAU); ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.6;
        const ga = t * 1.5;
        ctx.beginPath(); ctx.arc(0, 0, 2.4, ga, ga + 0.9); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-1.2, -1.2, 0.6, 0, TAU); ctx.fill();
        break;
      }
      case 'chip': {
        ctx.fillStyle = '#e4c35c';
        for (let i = -1; i <= 1; i++) {
          ctx.fillRect(i * 1.9 - 0.45, -4.6, 0.9, 1.4); ctx.fillRect(i * 1.9 - 0.45, 3.2, 0.9, 1.4);
          ctx.fillRect(-4.6, i * 1.9 - 0.45, 1.4, 0.9); ctx.fillRect(3.2, i * 1.9 - 0.45, 1.4, 0.9);
        }
        G.roundRect(ctx, -3.4, -3.4, 6.8, 6.8, 0.8); ctx.fillStyle = '#1d2a28'; ctx.fill(); ctx.stroke();
        ctx.strokeStyle = `rgba(90,240,255,${0.6 + 0.4 * pulse})`; ctx.lineWidth = 0.6;
        ctx.strokeRect(-1.6, -1.6, 3.2, 3.2);
        ctx.beginPath(); ctx.moveTo(-1.6, 0); ctx.lineTo(-2.8, 0); ctx.moveTo(1.6, 0.8); ctx.lineTo(2.8, 0.8); ctx.moveTo(0, -1.6); ctx.lineTo(0, -2.8); ctx.stroke();
        ctx.fillStyle = '#b8ffff'; ctx.fillRect(-0.7, -0.7, 1.4, 1.4);
        break;
      }
      case 'core': {
        ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(214,180,255,0.9)';
        ctx.beginPath(); ctx.ellipse(0, 0, 5, 1.5, t * 1.3, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(0, 0, 5, 1.5, -t * 0.9 + 1.2, 0, TAU); ctx.stroke();
        glow(ctx, 0, 0, 6, '210,160,255', 0.6 + 0.3 * pulse);
        const g = ctx.createRadialGradient(-0.8, -0.8, 0.2, 0, 0, 3);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#d7b8ff'); g.addColorStop(1, '#5b2fc0');
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 0.7; ctx.stroke();
        break;
      }
      case 'valve': {
        ctx.fillStyle = C.metal; ctx.fillRect(-0.9, 2.6, 1.8, 2.4); ctx.strokeRect(-0.9, 2.6, 1.8, 2.4);
        ctx.rotate(Math.sin(t * 1.2) * 0.3);
        ctx.lineWidth = 2.4; ctx.strokeStyle = C.line;
        ctx.beginPath(); ctx.arc(0, -0.6, 3.6, 0, TAU); ctx.stroke();
        ctx.lineWidth = 1.4; ctx.strokeStyle = '#e4473b';
        ctx.beginPath(); ctx.arc(0, -0.6, 3.6, 0, TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,170,150,0.9)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(0, -0.6, 3.6, Math.PI * 1.1, Math.PI * 1.55); ctx.stroke();
        ctx.strokeStyle = '#b3332b'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-3.4, -0.6); ctx.lineTo(3.4, -0.6); ctx.moveTo(0, -4); ctx.lineTo(0, 2.8); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -0.6, 1.2, 0, TAU); ctx.fillStyle = '#e8c06a'; ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 0.6; ctx.stroke();
        break;
      }
      case 'antenna': {
        ctx.fillStyle = '#2b3245'; G.roundRect(ctx, -2.2, 3, 4.4, 1.8, 0.5); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = C.line;
        ctx.beginPath(); ctx.moveTo(0, 3.2); ctx.lineTo(0, -3.6); ctx.stroke();
        ctx.lineWidth = 0.9; ctx.strokeStyle = C.metal;
        ctx.beginPath(); ctx.moveTo(0, 3.2); ctx.lineTo(0, -3.6); ctx.stroke();
        ctx.lineWidth = 0.8; ctx.strokeStyle = '#aab6c8';
        ctx.beginPath(); ctx.moveTo(-3.4, -1.2); ctx.quadraticCurveTo(-2.2, 1.6, 0, 1.2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-1.6, -2); ctx.lineTo(1.8, -2); ctx.stroke();
        const blink = (t * 1.5) % 1 < 0.5;
        ctx.beginPath(); ctx.arc(0, -4.3, 1, 0, TAU); ctx.fillStyle = blink ? '#ff6a5e' : '#7a2620'; ctx.fill();
        if (blink) glow(ctx, 0, -4.3, 4, '255,90,80', 0.8);
        break;
      }
      default: {
        ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fillStyle = '#ffe17a'; ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ================================================================== MIRA
  const HIP_Y = -20.6, THIGH = 10, SHIN = 9.6, UARM = 6.8, FARM = 6.4;
  const KEYS = ['hx', 'hy', 'lean', 'tilt', 'lookX', 'lookY', 'nfx', 'nfy', 'ffx', 'ffy', 'ntoe', 'ftoe',
    'nhx', 'nhy', 'fhx', 'fhy', 'squint', 'mouth', 'brow', 'breath', 'smile'];
  const RATE = { idle: 10, run: 24, jump: 16, fall: 12, wall: 18, land: 30, push: 14, interact: 20, spawn: 60, dead: 0, dash: 42, swing: 16 };
  const DASH_COL = '#ff6ad5', DASH_RGB = '255,106,213';
  const HAIR_EMPTY = ['#161d30', '#34466e', '#7c9bd6'];

  // Hair strand definitions in the head frame (facing +x): anchor, rest direction, segments, length, width.
  const STRANDS = [
    { ax: 5.0, ay: -2.4, dx: 0.3, dy: 1, n: 2, len: 1.9, w: 1.1, front: true },     // fringe tip
    { ax: -0.7, ay: 1.4, dx: -0.1, dy: 1, n: 2, len: 2.0, w: 1.2, front: true },    // lock before the ear
    { ax: -4.6, ay: 4.0, dx: -0.5, dy: 1, n: 3, len: 1.9, w: 1.4, front: false },   // nape
    { ax: -3.6, ay: -5.6, dx: -0.92, dy: 0.25, n: 2, len: 1.6, w: 1.0, front: false }, // crown tuft
  ];
  const LANYARD = { ax: -4.2, ay: -1.0, n: 3, len: 2.3 };   // torso frame (belt D-ring)

  const mem = new WeakMap();
  const V = () => ({ x: 0, y: 0 });

  function newSkeleton() {
    return { hipN: V(), hipF: V(), shN: V(), shF: V(), neck: V(), head: V(), headA: 0,
      kneeN: V(), ankN: V(), kneeF: V(), ankF: V(), elbN: V(), handN: V(), elbF: V(), handF: V(), item: V() };
  }

  function newMem(p, t) {
    const M = {
      t, st: 0, phase: 0, sq: 0, sqV: 0, airS: 0, airK: 0, turn: 0,
      prevState: p.state, prevFace: p.facing || 1, face: p.facing || 1,
      fx: p.x + p.w / 2, fy: p.y + p.h,
      P: {}, T: {}, S: newSkeleton(),
      blinkAt: t + 1.5, blinkN: 0, hairLagX: 0, hairLagY: 0, hairLagVX: 0, hairLagVY: 0,
      strands: null, lanyard: null, sparkT: 0, deadPose: null, spawnFx: false,
      hairE: 0, refillT: -9, trail: [], trailT: 0, ropeT: -9,
      xf: { fx: 0, fy: 0, a: 1, d: 1, pv: 0 },
    };
    for (const k of KEYS) M.P[k] = 0;
    targetPose(p, M, t, M.P);
    return M;
  }

  // ---------------------------------------------------------------- target poses
  function shoulderOf(T, near, o) {
    const c = Math.cos(T.lean), s = Math.sin(T.lean);
    const x = near ? 1.0 : -1.4, y = -12.3;
    o.x = T.hx + x * c - y * s; o.y = T.hy + x * s + y * c;
    return o;
  }
  const _s1 = V(), _s2 = V();

  /**
   * Dialogue acting layer. Writes face keys into T; returns [nearHand, farHand] offsets
   * (shoulder-relative) when `body` is true, else null. mood = portrait mood id.
   */
  function talkPose(mood, tt, T, body) {
    const syl = Math.abs(Math.sin(tt * 13.0) * Math.sin(tt * 4.7 + 1.0));   // lip flap envelope
    const beat = Math.sin(tt * 2.6), up = Math.max(0, beat);
    const bob = Math.sin(tt * 5.2);
    let nh = [5.0 + 1.5 * beat, 5.2 - 2.2 * up], fh = [-1.4, 11.4];
    let mouthBase = 0.1, mouthAmp = 0.55;
    T.tilt += 0.035 * bob; T.lookX = Math.max(T.lookX, 0.6);
    switch (mood) {
      case 'happy':
        nh = [6.2 + beat, 3.6 + 1.6 * Math.sin(tt * 5.2)]; fh = [-5.2, 5.4 - 1.2 * up];
        T.hy -= 0.6 * Math.abs(Math.sin(tt * 6)); T.brow = 0.55; T.smile = 1; T.tilt -= 0.05;
        mouthBase = 0.16; mouthAmp = 0.7; break;
      case 'sad':
        nh = [2.8, 11.0]; fh = [1.6, 10.6];
        T.lookY = 0.8; T.tilt += 0.11; T.brow = 0.55; T.smile = -0.8; T.lean += 0.07; T.lookX = 0.2;
        mouthBase = 0.02; mouthAmp = 0.3; break;
      case 'angry':
        nh = [7.2 + 2.2 * beat, 2.4 - 1.2 * up]; fh = [-2.4, 10.4];
        T.lean += 0.1; T.brow = -1; T.squint = Math.max(T.squint, 0.45); T.smile = -0.7; T.tilt += 0.03 * Math.sin(tt * 9);
        mouthBase = 0.14; mouthAmp = 0.8; break;
      case 'scared':
        nh = [4.4, 4.6 + 0.4 * Math.sin(tt * 31)]; fh = [3.0, 5.4];
        T.lean -= 0.09; T.hx -= 0.6 + 0.2 * Math.sin(tt * 29); T.brow = 1; T.smile = -0.5; T.lookX = -0.3;
        mouthBase = 0.12; mouthAmp = 0.45; break;
      case 'surprised':
        nh = [6.4, -1.2]; fh = [-6.2, 0.2];
        T.brow = 1.2; T.hy -= 0.6; T.tilt -= 0.06; mouthBase = 0.5; mouthAmp = 0.35; break;
      case 'thinking':
        nh = [3.8, -1.4]; fh = [3.4, 8.0];
        T.lookY = -0.75; T.lookX = 0.8; T.tilt += 0.08; T.brow = 0.35; T.smile = -0.15;
        mouthBase = 0.02; mouthAmp = 0.35; break;
      case 'determined':
        nh = [5.2, 2.0 - 3.0 * up]; fh = [-1.6, 11.0];
        T.lean += 0.05; T.brow = -0.6; T.smile = 0.2; T.squint = Math.max(T.squint, 0.2); break;
      default:
        T.brow = 0.15 + 0.3 * up; break;
    }
    T.mouth = Math.max(T.mouth, mouthBase + syl * mouthAmp);
    return body ? [nh, fh] : null;
  }

  /** Procedural target pose for the current state at time tt (local space, facing +x, feet at 0,0). */
  function targetPose(p, M, tt, T) {
    const state = p.state === 'spawn' || p.state === 'dead' ? 'idle' : p.state;
    const st = M.st;
    const sp = clamp(Math.abs(p.vx) / 250, 0, 1);
    const fwd = p.vx * M.face >= 0 ? 1 : -1;
    T.hx = 0; T.hy = HIP_Y; T.lean = 0.02; T.tilt = 0; T.lookX = 0.35; T.lookY = 0;
    T.nfx = 2.4; T.nfy = -2; T.ffx = -2.6; T.ffy = -2; T.ntoe = 0; T.ftoe = 0;
    T.squint = 0; T.mouth = 0; T.brow = 0; T.breath = 0; T.smile = 0;
    let nh = [1.5, 12.0], fh = [-1.1, 11.8], abs = false;

    switch (state) {
      case 'idle': {
        const br = Math.sin(tt * 2.1);
        T.breath = br;
        T.hx = Math.sin(tt * 0.65) * 0.35;
        T.lean = 0.02 + br * 0.008;
        // look-around beats (only once she has been idle for a moment)
        const on = sstep(1.5, 2.2, st);
        const ph = (st + 3) % 7.5;
        const back = sstep(3.9, 4.25, ph) * (1 - sstep(5.3, 5.7, ph)) * on;
        const up = sstep(1.0, 1.3, ph) * (1 - sstep(2.3, 2.7, ph)) * on;
        T.lookX = lerp(0.35, -1, back); T.lookY = -0.9 * up + 0.15 * back;
        T.tilt = -0.07 * up + 0.05 * back;
        nh = [1.6, 12 - br * 0.25]; fh = [-1.2, 11.8 - br * 0.25];
        break;
      }
      case 'run': {
        const k = sp, ph = M.phase;
        const A = 1 + 6.6 * k, lift = 1.2 + 5.2 * k;
        const foot = (f, xo) => [A * Math.sin(f) + 1.2 * k + xo,
          -2 - Math.max(0, Math.cos(f - 0.45)) * lift,
          0.55 * k * Math.max(0, -Math.sin(f)) + 0.25 * k * Math.max(0, Math.cos(f))];
        const n = foot(ph, 0.4), f = foot(ph + Math.PI, -0.4);
        T.nfx = n[0]; T.nfy = n[1]; T.ntoe = n[2];
        T.ffx = f[0]; T.ffy = f[1]; T.ftoe = f[2];
        T.hy = HIP_Y + 0.7 * k + 1.1 * k * Math.cos(2 * ph);
        T.hx = 1.0 * k * fwd;
        T.lean = fwd > 0 ? 0.05 + 0.16 * k + 0.025 * Math.sin(2 * ph) : -0.08;
        T.tilt = -T.lean * 0.6 + 0.03 * Math.cos(2 * ph);
        T.lookX = 0.7;
        T.mouth = 0.12 * k;
        const arm = (s) => { const u = (s + 1) / 2; return [lerp(-4.8, 4.6, u) * k + 1.5 * (1 - k), lerp(9.6, 5.2, u) * k + 12 * (1 - k)]; };
        nh = arm(-Math.sin(ph)); fh = arm(Math.sin(ph));
        fh[0] -= 0.8;
        break;
      }
      case 'jump': {
        const u = clamp(-p.vy / 700, 0, 1);
        const e = u * u;
        T.nfx = lerp(3.0, 1.4, e); T.nfy = lerp(-9.0, -1.0, e);
        T.ffx = lerp(-1.6, -2.0, e); T.ffy = lerp(-6.0, 0.2, e);
        T.ntoe = lerp(0.35, 0.95, e); T.ftoe = lerp(0.5, 1.0, e);
        T.hy = HIP_Y - 0.4;
        T.lean = 0.04 + 0.08 * sp * fwd;
        nh = [lerp(5.6, 8.6, e), lerp(2.0, -3.4, e)];
        fh = [lerp(-5.0, -3.6, e), lerp(3.2, 8.6, e)];
        T.tilt = -0.07 * e; T.lookY = -0.7 * e; T.lookX = 0.6;
        T.mouth = 0.35 * e; T.brow = 0.4 * e;
        break;
      }
      case 'fall': {
        const f = clamp(p.vy / 900, 0, 1);
        const fl = Math.sin(tt * 11) * f;
        nh = [8.8 + fl * 0.6, 1.5 - 1.8 * f + fl * 0.8];
        fh = [-7.4 - fl * 0.6, -1.4 - 2.6 * f - fl * 0.7];
        T.nfx = 2.6 + Math.sin(tt * 8) * f * 0.8; T.nfy = lerp(-5.0, -1.6, f);
        T.ffx = -2.2 - Math.sin(tt * 8 + 1) * f * 0.6; T.ffy = lerp(-3.4, -0.6, f);
        T.ntoe = 0.5; T.ftoe = 0.55;
        T.hy = HIP_Y - 0.3;
        T.lean = -0.04 + 0.06 * sp * fwd;
        T.tilt = 0.1; T.lookY = 0.9; T.lookX = 0.4;
        T.mouth = 0.55 * f; T.brow = 0.8 * f;
        break;
      }
      case 'wall': {
        // Visual facing is away from the wall: wall sits at local x ≈ -10.5.
        const j = Math.sin(tt * 47) * 0.25;
        T.hx = -2.0; T.hy = HIP_Y + 1.6 + j; T.lean = -0.14;
        nh = [4.6, 5.0]; fh = [-6.8, -3.6];
        T.nfx = -6.6; T.nfy = -1.8; T.ntoe = -0.55;
        T.ffx = -8.4; T.ffy = -8.6; T.ftoe = -1.35;
        T.lookX = 1; T.lookY = 0.45; T.tilt = 0.06;
        T.squint = 0.35; T.brow = -0.4;
        break;
      }
      case 'land': {
        T.nfx = 3.4; T.ffx = -3.4;
        nh = [3.4, 10.0]; fh = [-3.2, 10.2];
        T.lookY = 0.5;
        break;
      }
      case 'push': {
        const ph = M.phase;
        T.lean = 0.5; T.hx = -2.3; T.hy = HIP_Y + 1.8 + 0.45 * Math.cos(2 * ph);
        const foot = (f) => [-3.4 + 4.4 * Math.sin(f), -2 - Math.max(0, Math.cos(f - 0.3)) * 2.4, 0.55 * Math.max(0, -Math.sin(f))];
        const n = foot(ph), f = foot(ph + Math.PI);
        T.nfx = n[0]; T.nfy = n[1]; T.ntoe = n[2];
        T.ffx = f[0] - 0.6; T.ffy = f[1]; T.ftoe = f[2];
        abs = true;
        nh = [10.3, -24.6 + 0.3 * Math.sin(ph)]; fh = [9.6, -27.6];
        T.tilt = -0.3; T.lookX = 1; T.squint = 0.7; T.mouth = 0.2; T.brow = -1;
        break;
      }
      case 'dash': {
        // 8-way lunge: blend a forward, an upward and a downward key pose by the dash direction
        const dd = p.dashDir || { x: M.face, y: 0 };
        let ux = Math.abs(dd.x || 0), uy = dd.y || 0;
        if (ux < 1e-3 && Math.abs(uy) < 1e-3) ux = 1;
        const sum = ux + Math.abs(uy);
        const wf = ux / sum, wu = Math.max(0, -uy) / sum, wd = Math.max(0, uy) / sum;
        const mix = (f, u, d) => f * wf + u * wu + d * wd;
        const k = sstep(0, 0.05, st);                       // snap into the pose
        T.lean = mix(0.78, 0.08, 0.3) * k + 0.02 * (1 - k);
        T.hx = mix(1.6, 0, 0.6); T.hy = HIP_Y + mix(0.8, -1.2, 1.4);
        T.nfx = mix(-7.2, 0.9, 4.2); T.nfy = mix(-4.6, 1.2, -8.4); T.ntoe = mix(1.1, 0.9, 0.3);
        T.ffx = mix(-10.4, -0.9, 1.0); T.ffy = mix(-9.6, 0.6, -5.8); T.ftoe = mix(1.3, 1.0, 0.5);
        nh = [mix(8.6, 2.6, 4.2), mix(2.4, -11.6, -6.2)];
        fh = [mix(-7.6, -0.8, -4.4), mix(4.4, -11.0, -7.0)];
        T.tilt = mix(-0.42, -0.12, 0.05); T.lookX = 1; T.lookY = mix(0, -1, 1);
        T.squint = 0.55; T.brow = -0.9; T.mouth = 0.16; T.smile = -0.3;
        break;
      }
      case 'swing': {
        // hang along the rope: lean = rope angle seen from the body, hands on the rope above her
        const r = p.rope;
        let ra = 0;
        if (r && isFinite(r.ax) && isFinite(r.ay)) {
          const bx = p.x + p.w / 2, by = p.y + 10;
          ra = Math.atan2((r.ax - bx) * M.face, -(r.ay - by));
        } else if (r && isFinite(r.angle)) ra = -r.angle * M.face;
        const L = clamp(ra * 0.85, -0.95, 0.95);
        T.lean = L; T.hx = 0; T.hy = HIP_Y;
        const kick = clamp(p.vx * M.face / 380, -1, 1);
        const sL = Math.sin(L), cL = Math.cos(L);
        T.nfx = -sL * 18.5 + kick * 3.4 + 0.6; T.nfy = HIP_Y + cL * 18.2 - Math.max(0, kick) * 2.2;
        T.ffx = -sL * 18.5 - kick * 2.2 - 1.2; T.ffy = HIP_Y + cL * 17.6 - Math.max(0, -kick) * 2.6;
        T.ntoe = 0.6 + kick * 0.3; T.ftoe = 0.7;
        abs = true;
        shoulderOf(T, true, _s1); shoulderOf(T, false, _s2);
        const dx = Math.sin(ra), dy = -Math.cos(ra);
        nh = [_s1.x + dx * 11.4, _s1.y + dy * 11.4]; fh = [_s2.x + dx * 9.6 + 0.6, _s2.y + dy * 9.6 + 0.4];
        T.tilt = -L * 0.75; T.lookX = 0.8; T.lookY = -0.35 * Math.abs(kick) + 0.25;
        T.mouth = 0.14 * Math.abs(kick); T.brow = -0.3; T.squint = 0.2;
        break;
      }
      case 'interact': {
        const k = sstep(0, 0.1, st) * (1 - sstep(0.22, 0.36, st));
        nh = [lerp(1.6, 9.0, k), lerp(12, 4.2, k)];
        fh = [-3.4, 9.6];
        T.lean = 0.02 + 0.12 * k; T.hx = 0.6 * k;
        T.tilt = 0.06 * k; T.lookX = 1; T.lookY = 0.5 * k;
        T.nfx = 3.0; T.ffx = -2.8;
        break;
      }
    }

    // live dialogue acting (body gestures only on calm grounded states; face always)
    if (p.talking) {
      const body = state === 'idle' || state === 'interact' || state === 'land';
      const g = talkPose(p.talkMood, tt, T, body);
      if (body && g) { nh = g[0]; fh = g[1]; abs = false; }
    }

    // landing recovery is additive on any grounded pose (landImpact decays over ~0.25 s)
    if (p.onGround && state !== 'wall') {
      const L = p.landImpact || 0;
      T.hy += 5.0 * L; T.lean += 0.16 * L; T.tilt += 0.1 * L; T.squint = Math.max(T.squint, 0.55 * L);
      if (!abs) { nh[1] -= 2.2 * L; fh[1] -= 2.2 * L; nh[0] += 1.4 * L; fh[0] -= 1.4 * L; }
    }

    // carried item: both hands hold it in front of the chest
    if (p.carry && state !== 'dead') {
      shoulderOf(T, true, _s1);
      const c = Math.cos(T.lean), s = Math.sin(T.lean);
      const ix = _s1.x + 6.2 * c - 6.4 * s, iy = _s1.y + 6.2 * s + 6.4 * c;
      if (state === 'wall') { nh = [ix + 1.6 - _s1.x, iy + 1.8 - _s1.y]; }
      else { abs = true; nh = [ix + 1.7, iy + 1.9]; fh = [ix - 1.3, iy - 2.4]; }
    }

    if (abs) {
      if (state === 'wall') { shoulderOf(T, false, _s2); T.fhx = _s2.x + fh[0]; T.fhy = _s2.y + fh[1]; T.nhx = nh[0]; T.nhy = nh[1]; }
      else { T.nhx = nh[0]; T.nhy = nh[1]; T.fhx = fh[0]; T.fhy = fh[1]; }
    } else {
      shoulderOf(T, true, _s1); shoulderOf(T, false, _s2);
      T.nhx = _s1.x + nh[0]; T.nhy = _s1.y + nh[1];
      T.fhx = _s2.x + fh[0]; T.fhy = _s2.y + fh[1];
    }
    if (state === 'wall' && p.carry) { shoulderOf(T, true, _s1); T.nhx = _s1.x + nh[0]; T.nhy = _s1.y + nh[1]; }
  }

  // ---------------------------------------------------------------- skeleton solve
  function solve(P, S) {
    const c = Math.cos(P.lean), s = Math.sin(P.lean);
    const tp = (x, y, o) => { o.x = P.hx + x * c - y * s; o.y = P.hy + x * s + y * c; };
    const br = P.breath * 0.22;
    tp(1.2, -0.6, S.hipN); tp(-1.2, -0.6, S.hipF);
    tp(1.0, -12.3 - br, S.shN); tp(-1.4, -12.3 - br, S.shF);
    tp(0.6, -14.0 - br * 0.6, S.neck);
    S.headA = P.lean * 0.55 + P.tilt;
    const hc = Math.cos(S.headA), hs = Math.sin(S.headA);
    S.head.x = S.neck.x + 0.7 * hc + 5.6 * hs;
    S.head.y = S.neck.y + 0.7 * hs - 5.6 * hc;
    ik(S.hipN, P.nfx, P.nfy, THIGH, SHIN, -1, S.kneeN, S.ankN);
    ik(S.hipF, P.ffx, P.ffy, THIGH, SHIN, -1, S.kneeF, S.ankF);
    ik(S.shN, P.nhx, P.nhy, UARM, FARM, 1, S.elbN, S.handN);
    ik(S.shF, P.fhx, P.fhy, UARM, FARM, 1, S.elbF, S.handF);
    S.item.x = S.shN.x + 6.2 * c - 6.4 * s; S.item.y = S.shN.y + 6.2 * s + 6.4 * c;
  }

  // ---------------------------------------------------------------- transform local <-> world
  function setXf(M, fx, fy) {
    const sy = clamp(1 + M.sq + M.airS, 0.72, 1.3);
    const sx = clamp(1 - (sy - 1) * 0.65, 0.75, 1.25) * (1 - 0.14 * M.turn);
    M.xf.fx = fx; M.xf.fy = fy; M.xf.a = sx * M.face; M.xf.d = sy; M.xf.pv = -22 * M.airK;
  }
  function toWorld(xf, lx, ly, o) { o.x = xf.fx + xf.a * lx; o.y = xf.fy + xf.pv + xf.d * (ly - xf.pv); return o; }
  function toLocal(xf, wx, wy, o) { o.x = (wx - xf.fx) / xf.a; o.y = (wy - xf.fy - xf.pv) / xf.d + xf.pv; return o; }
  function applyXf(ctx, xf) {
    ctx.translate(xf.fx, xf.fy + xf.pv);
    ctx.scale(xf.a, xf.d);
    ctx.translate(0, -xf.pv);
  }

  // ---------------------------------------------------------------- secondary motion (Verlet)
  const _w = V(), _l = V();
  function headPoint(S, hx, hy, o) {
    const c = Math.cos(S.headA), s = Math.sin(S.headA);
    o.x = S.head.x + hx * c - hy * s; o.y = S.head.y + hx * s + hy * c; return o;
  }
  function torsoPoint(P, x, y, o) {
    const c = Math.cos(P.lean), s = Math.sin(P.lean);
    o.x = P.hx + x * c - y * s; o.y = P.hy + x * s + y * c; return o;
  }
  function initChains(M) {
    const S = M.S, xf = M.xf;
    M.strands = STRANDS.map((d) => {
      const pts = [];
      for (let i = 0; i <= d.n; i++) {
        headPoint(S, d.ax + d.dx * d.len * i, d.ay + d.dy * d.len * i, _l);
        toWorld(xf, _l.x, _l.y, _w);
        pts.push({ x: _w.x, y: _w.y, px: _w.x, py: _w.y });
      }
      return pts;
    });
    const lp = [];
    for (let i = 0; i <= LANYARD.n; i++) {
      torsoPoint(M.P, LANYARD.ax, LANYARD.ay + i * LANYARD.len, _l); toWorld(xf, _l.x, _l.y, _w);
      lp.push({ x: _w.x, y: _w.y, px: _w.x, py: _w.y });
    }
    M.lanyard = lp;
  }

  function simChain(pts, ax, ay, rdx, rdy, len, h, grav, stiff, damp) {
    pts[0].x = ax; pts[0].y = ay; pts[0].px = ax; pts[0].py = ay;
    const h2 = h * h;
    for (let i = 1; i < pts.length; i++) {
      const q = pts[i];
      const vx = (q.x - q.px) * damp, vy = (q.y - q.py) * damp;
      q.px = q.x; q.py = q.y;
      const rx = ax + rdx * len * i, ry = ay + rdy * len * i;
      q.x += vx + ((rx - q.x) * stiff) * h2;
      q.y += vy + (grav + (ry - q.y) * stiff) * h2;
    }
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-4;
        const k = (d - len) / d;
        b.x -= dx * k; b.y -= dy * k;
      }
    }
  }

  function simSecondary(M, h) {
    const S = M.S, xf = M.xf;
    const c = Math.cos(S.headA), s = Math.sin(S.headA);
    for (let i = 0; i < STRANDS.length; i++) {
      const d = STRANDS[i];
      headPoint(S, d.ax, d.ay, _l); toWorld(xf, _l.x, _l.y, _w);
      // rest direction: head frame -> local -> world (mirror by facing)
      const lx = d.dx * c - d.dy * s, ly = d.dx * s + d.dy * c;
      const wx = lx * Math.sign(xf.a), wy = ly;
      simChain(M.strands[i], _w.x, _w.y, wx, wy, d.len, h, 260, 900, 0.86);
    }
    torsoPoint(M.P, LANYARD.ax, LANYARD.ay, _l); toWorld(xf, _l.x, _l.y, _w);
    simChain(M.lanyard, _w.x, _w.y, -0.25 * Math.sign(xf.a), 1, LANYARD.len, h, 900, 140, 0.9);
  }

  // ---------------------------------------------------------------- update (self-timed)
  function update(M, p, t) {
    let dt = t - M.t;
    const fx = p.x + p.w / 2, fy = p.y + p.h;
    const teleport = Math.hypot(fx - M.fx, fy - M.fy) > 90;
    if (dt < -0.001 || dt > 1) dt = 0;
    dt = Math.min(dt, 0.3);
    M.t = t;

    // visual facing: away from the wall while wall-sliding (telegraphs the wall jump)
    const vface = p.state === 'wall' && p.wallDir ? -p.wallDir : (p.facing || 1);
    if (vface !== M.face) { M.face = vface; M.turn = 1; }

    // one-shot events
    if (p.state !== M.prevState) {
      if (p.state === 'jump' && p.vy < -300) M.sqV += M.prevState === 'wall' ? 4.5 : 5.5;
      if (p.state === 'land') M.sqV -= 5.5 * (0.45 + (p.landImpact || 0));
      if (p.state === 'dead') { M.deadPose = Object.assign({}, M.P); }
      if (p.state === 'spawn') { M.spawnFx = false; M.sq = 0; M.sqV = 0; }
      if (p.state === 'dash') {
        M.sqV += 3.5;
        if (G.fx) {
          const dd = p.dashDir || { x: M.face, y: 0 };
          G.fx.burst(fx - (dd.x || 0) * 6, fy - 22 - (dd.y || 0) * 6, { count: 12, color: [DASH_COL, '#ffd0f4', '#ffffff'], speed: 150, life: 0.32, size: 1.8, gravity: 0, drag: 4, glow: true, shape: 'square' });
        }
      }
      if (p.state === 'swing') M.ropeT = t;
      M.prevState = p.state;
    }
    if (p.state === 'dead') { M.fx = fx; M.fy = fy; return; }

    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    const h = dt / n;
    const fx0 = M.fx, fy0 = M.fy;
    if (teleport || !M.strands) { setXf(M, fx, fy); solve(M.P, M.S); initChains(M); }
    let rate = RATE[p.state] != null ? RATE[p.state] : 14;
    if (p.talking) rate = Math.max(rate, 18);
    // dash-charge hair cue: cools while empty, flashes on refill
    const empty = p.canDash !== false && typeof p.dashCharges === 'number' && p.dashCharges <= 0 ? 1 : 0;
    if (!empty && M.hairE > 0.5 && p.state !== 'dead') M.refillT = t;
    M.hairE += (empty - M.hairE) * (1 - Math.exp(-(empty ? 30 : 18) * dt));
    // after-image trail (feet positions sampled while dashing)
    if (p.state === 'dash' && t - M.trailT >= 0.04) { M.trailT = t; M.trail.push({ x: fx, y: fy, t }); if (M.trail.length > 7) M.trail.shift(); }
    while (M.trail.length && t - M.trail[0].t > 0.28) M.trail.shift();
    const air = !p.onGround && p.state !== 'spawn';
    const T = M.T;

    for (let i = 0; i < n && h > 0; i++) {
      const tt = t - dt + h * (i + 1);
      M.st = p.stateTime - (dt - h * (i + 1));
      if (p.state === 'run') M.phase += Math.abs(p.vx) * h / 94 * TAU;
      else if (p.state === 'push') M.phase += Math.max(40, Math.abs(p.vx)) * h / 52 * TAU;
      targetPose(p, M, tt, T);
      const a = 1 - Math.exp(-rate * h);
      for (const k of KEYS) M.P[k] += (T[k] - M.P[k]) * a;
      // squash spring + air stretch + turn
      const acc = -430 * M.sq - 17 * M.sqV;
      M.sqV += acc * h; M.sq += M.sqV * h;
      M.airS += ((air ? clamp(Math.abs(p.vy) / 900, 0, 1) * 0.1 : 0) - M.airS) * (1 - Math.exp(-14 * h));
      M.airK += ((air ? 1 : 0) - M.airK) * (1 - Math.exp(-12 * h));
      M.turn = Math.max(0, M.turn - h / 0.11);
      // blink scheduler (deterministic)
      if (tt > M.blinkAt + 0.16) { M.blinkN++; M.blinkAt = tt + (hash1(M.blinkN) < 0.2 ? 0.25 : 2.2 + hash1(M.blinkN * 3.7) * 2.6); }
      // world transform for this sub-step (interpolated position) + secondary motion
      const k = (i + 1) / n;
      setXf(M, lerp(fx0, fx, teleport ? 1 : k), lerp(fy0, fy, teleport ? 1 : k));
      solve(M.P, M.S);
      // bob hair mass: lags behind velocity (in local space)
      const tx = clamp(-p.vx * 0.006, -1.6, 1.6) * M.face, ty = clamp(-p.vy * 0.0035, -1.8, 1.8);
      const fxk = 260 * (tx - M.hairLagX) - 13 * M.hairLagVX, fyk = 260 * (ty - M.hairLagY) - 13 * M.hairLagVY;
      M.hairLagVX += fxk * h; M.hairLagVY += fyk * h; M.hairLagX += M.hairLagVX * h; M.hairLagY += M.hairLagVY * h;
      simSecondary(M, h);
    }
    M.fx = fx; M.fy = fy;
    setXf(M, fx, fy); solve(M.P, M.S);
  }

  // ---------------------------------------------------------------- body drawing (local space)
  const SEG = {
    thighN: { w: 5.2, pal: C.suit }, shinN: { w: 4.4, pal: C.gra },
    thighF: { w: 5.0, pal: C.suitFar }, shinF: { w: 4.2, pal: C.graFar },
    uarmN: { w: 3.8, pal: C.suit }, farmN: { w: 3.3, pal: C.gra },
    uarmF: { w: 3.6, pal: C.suitFar }, farmF: { w: 3.1, pal: C.graFar },
  };

  function drawBoot(ctx, ank, toe, pal, lx, ly) {
    ctx.save();
    ctx.translate(ank.x, ank.y); ctx.rotate(toe);
    const path = (c) => {
      c.beginPath(); c.moveTo(-2.1, -2.6); c.lineTo(1.3, -2.6);
      c.quadraticCurveTo(2.0, -1.2, 4.4, -0.8); c.quadraticCurveTo(5.7, -0.4, 5.5, 1.0);
      c.lineTo(5.4, 2.1); c.lineTo(-2.5, 2.1); c.quadraticCurveTo(-2.9, -0.2, -2.1, -2.6); c.closePath();
    };
    shape(ctx, path, pal[1], lx, ly, (c) => {
      c.fillStyle = pal[0]; c.fillRect(-3, 1.0, 9, 1.2);              // sole
      c.fillStyle = '#d0682b'; c.fillRect(-3, -2.7, 4.6, 0.9);         // orange cuff
      c.fillStyle = pal[2]; c.globalAlpha = 0.6; c.fillRect(1.5, -1.3, 2.4, 0.6); c.globalAlpha = 1;
    }, 1.4);
    ctx.restore();
  }

  function drawGlove(ctx, h, pal) {
    ctx.beginPath(); ctx.arc(h.x, h.y, 1.65, 0, TAU);
    ctx.lineWidth = 1.2; ctx.strokeStyle = C.line; ctx.stroke();
    ctx.fillStyle = pal[1]; ctx.fill();
    ctx.beginPath(); ctx.arc(h.x - 0.4, h.y - 0.45, 0.65, 0, TAU); ctx.fillStyle = pal[2]; ctx.fill();
  }

  // current hair palette (swapped per draw by the dash-charge cue)
  let HAIR = C.hair;
  const hairMemo = new Map();
  function hexMix(a, b, k) {
    const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(lerp((A >> sh) & 255, (B >> sh) & 255, k));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }
  /** Hair palette for empty-charge amount e (0..1) and refill flash f (0..1), quantised + memoised. */
  function hairPalette(e, f) {
    const qe = Math.round(clamp(e, 0, 1) * 16), qf = Math.round(clamp(f, 0, 1) * 8);
    if (!qe && !qf) return C.hair;
    const key = qe * 16 + qf;
    let v = hairMemo.get(key);
    if (!v) {
      v = C.hair.map((c, i) => {
        const m = hexMix(c, HAIR_EMPTY[i], qe / 16);
        if (!qf) return m;
        const n = m.match(/\d+/g).map(Number), w = qf / 8 * 0.75;
        return `rgb(${Math.round(lerp(n[0], 255, w))},${Math.round(lerp(n[1], 200, w))},${Math.round(lerp(n[2], 240, w))})`;
      });
      hairMemo.set(key, v);
    }
    return v;
  }

  function drawStrand(ctx, M, idx, xf) {
    const pts = M.strands[idx], d = STRANDS[idx];
    const L = [];
    for (const q of pts) { toLocal(xf, q.x, q.y, _l); L.push(_l.x, _l.y); }
    ctx.lineCap = 'round';
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < pts.length - 1; i++) {
        const w = d.w * (1 - i / pts.length * 0.6);
        ctx.lineWidth = layer === 0 ? w + 1.1 : layer === 1 ? w : w * 0.35;
        ctx.strokeStyle = layer === 0 ? C.line : layer === 1 ? HAIR[1] : HAIR[2];
        ctx.beginPath(); ctx.moveTo(L[i * 2], L[i * 2 + 1]); ctx.lineTo(L[i * 2 + 2], L[i * 2 + 3]); ctx.stroke();
      }
    }
  }

  function drawLanyard(ctx, M, xf) {
    const L = [];
    for (const q of M.lanyard) { toLocal(xf, q.x, q.y, _l); L.push(_l.x, _l.y); }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let layer = 0; layer < 2; layer++) {
      ctx.lineWidth = layer ? 0.7 : 1.5; ctx.strokeStyle = layer ? '#5a6278' : C.line;
      ctx.beginPath(); ctx.moveTo(L[0], L[1]);
      for (let i = 2; i < L.length; i += 2) ctx.lineTo(L[i], L[i + 1]);
      ctx.stroke();
    }
    const ex = L[L.length - 2], ey = L[L.length - 1];
    ctx.fillStyle = C.line; ctx.fillRect(ex - 1.3, ey - 0.4, 2.6, 3.0);
    ctx.fillStyle = '#e2712d'; ctx.fillRect(ex - 0.8, ey, 1.6, 2.1);
    ctx.fillStyle = C.stripe; ctx.fillRect(ex - 0.8, ey + 0.7, 1.6, 0.5);
  }

  function torsoPath(c, b) {
    c.beginPath();
    c.moveTo(-4.5, 1.0); c.lineTo(4.3, 1.0);
    c.quadraticCurveTo(4.5, -2.8, 3.8, -5.0);
    c.quadraticCurveTo(5.5 + b, -8.4, 4.8 + b * 0.6, -11.1);
    c.quadraticCurveTo(4.2, -13.3, 2.0, -13.9);
    c.lineTo(-1.8, -13.9);
    c.quadraticCurveTo(-4.4, -13.5, -4.7, -10.6);
    c.quadraticCurveTo(-5.0, -7.2, -4.1, -4.7);
    c.quadraticCurveTo(-4.9, -2.0, -4.5, 1.0);
    c.closePath();
  }

  function drawTorso(ctx, M, lx, ly) {
    const P = M.P, S = M.S;
    // neck
    const hb = headPoint(S, -0.2, 3.6, V());
    ctx.lineCap = 'round';
    ctx.lineWidth = 4.2; ctx.strokeStyle = C.line;
    ctx.beginPath(); ctx.moveTo(S.neck.x, S.neck.y + 0.5); ctx.lineTo(hb.x, hb.y); ctx.stroke();
    ctx.lineWidth = 2.8; ctx.strokeStyle = C.skin[0];
    ctx.beginPath(); ctx.moveTo(S.neck.x, S.neck.y + 0.5); ctx.lineTo(hb.x, hb.y); ctx.stroke();

    ctx.save();
    ctx.translate(P.hx, P.hy); ctx.rotate(P.lean);
    const c = Math.cos(-P.lean), s = Math.sin(-P.lean);
    const tlx = lx * c - ly * s, tly = lx * s + ly * c;
    const b = P.breath * 0.18;
    const g = ctx.createLinearGradient(tlx * 7, -7 + tly * 9, -tlx * 7, -7 - tly * 9);
    g.addColorStop(0, C.suit[2]); g.addColorStop(0.35, C.suit[1]); g.addColorStop(1, C.suit[0]);
    shape(ctx, (q) => torsoPath(q, b), g, tlx, tly, (q) => {
      // graphite back panel + shoulder yoke
      q.fillStyle = C.gra[1];
      q.beginPath(); q.moveTo(-6, 2); q.lineTo(-2.0, 2); q.quadraticCurveTo(-1.2, -6, -2.2, -11.2);
      q.lineTo(5.5, -11.6); q.lineTo(5.5, -16); q.lineTo(-6, -16); q.closePath(); q.fill();
      q.fillStyle = C.gra[2]; q.globalAlpha = 0.5; q.fillRect(-1.6, -13.4, 4.5, 0.8); q.globalAlpha = 1;
      // panel seam shading
      q.strokeStyle = 'rgba(0,0,0,0.25)'; q.lineWidth = 0.6;
      q.beginPath(); q.moveTo(-2.0, 1.5); q.quadraticCurveTo(-1.2, -6, -2.2, -11.2); q.lineTo(5.5, -11.6); q.stroke();
      // reflective chest stripe
      q.fillStyle = C.stripe; q.fillRect(-1.6, -9.3, 8, 1.1);
      q.fillStyle = 'rgba(255,255,255,0.7)'; q.fillRect(-1.6, -9.3, 8, 0.35);
      // zipper
      q.strokeStyle = 'rgba(60,20,8,0.55)'; q.lineWidth = 0.5;
      q.beginPath(); q.moveTo(3.0, -13.4); q.quadraticCurveTo(3.9, -8, 3.0, -2.6); q.stroke();
      // belt
      q.fillStyle = C.belt[1]; q.fillRect(-6, -3.0, 12, 2.4);
      q.fillStyle = C.belt[2]; q.fillRect(-6, -3.0, 12, 0.55);
      q.fillStyle = C.belt[0]; q.fillRect(-6, -0.9, 12, 0.4);
      q.fillStyle = C.metal; q.fillRect(2.4, -3.2, 1.9, 2.8);
      q.fillStyle = C.belt[1]; q.fillRect(2.9, -2.6, 0.9, 1.6);
      // hip shading under the belt
      q.fillStyle = 'rgba(40,10,0,0.25)'; q.fillRect(-6, -0.5, 12, 2);
    });
    // collar
    ctx.fillStyle = C.line; G.roundRect(ctx, -2.5, -15.6, 5.6, 2.8, 1.2); ctx.fill();
    ctx.fillStyle = C.gra[1]; G.roundRect(ctx, -2.0, -15.2, 4.6, 2.0, 0.9); ctx.fill();
    ctx.fillStyle = C.gra[2]; ctx.fillRect(-1.4, -15.0, 3.2, 0.5);
    // pouch on the back hip
    ctx.fillStyle = C.line; G.roundRect(ctx, -6.6, -3.6, 3.8, 5.0, 0.9); ctx.fill();
    ctx.fillStyle = C.belt[1]; G.roundRect(ctx, -6.1, -3.1, 2.8, 4.0, 0.6); ctx.fill();
    ctx.fillStyle = C.belt[2]; ctx.fillRect(-6.1, -3.1, 2.8, 1.1);
    ctx.fillStyle = C.metal; ctx.fillRect(-5.0, -2.2, 0.8, 0.6);
    // wrench handle peeking from the pouch
    ctx.strokeStyle = C.line; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-5.6, -3.2); ctx.lineTo(-6.4, -5.6); ctx.stroke();
    ctx.strokeStyle = '#9aa5b8'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-5.6, -3.2); ctx.lineTo(-6.4, -5.6); ctx.stroke();
    ctx.restore();
  }

  function drawHead(ctx, M, p, t, lx, ly) {
    const P = M.P, S = M.S;
    ctx.save();
    ctx.translate(S.head.x, S.head.y); ctx.rotate(S.headA);
    const c = Math.cos(-S.headA), s = Math.sin(-S.headA);
    const hlx = lx * c - ly * s, hly = lx * s + ly * c;
    const lagX = M.hairLagX, lagY = M.hairLagY;

    // hair: back mass (behind the face)
    const hg = ctx.createRadialGradient(hlx * 3.5, -2 + hly * 3.5, 0.5, 0, 0, 8.5);
    hg.addColorStop(0, HAIR[2]); hg.addColorStop(0.45, HAIR[1]); hg.addColorStop(1, HAIR[0]);
    const backPath = (q) => {
      q.beginPath();
      q.moveTo(3.4, -5.6);
      q.bezierCurveTo(1.0, -7.9, -5.4, -7.4, -6.3 + lagX * 0.3, -2.6 + lagY * 0.3);
      q.bezierCurveTo(-6.9 + lagX * 0.6, 1.0 + lagY * 0.5, -6.4 + lagX, 3.9 + lagY, -4.9 + lagX, 5.2 + lagY);
      q.quadraticCurveTo(-3.3 + lagX * 0.6, 5.7 + lagY * 0.6, -2.1, 4.4);
      q.lineTo(-1.0, 0.4);
      q.closePath();
    };
    shape(ctx, backPath, hg, hlx, hly, null, 1.5, C.hairRim, C.hairCool);

    // face
    const facePath = (q) => {
      q.beginPath();
      q.moveTo(-2.0, -4.3);
      q.bezierCurveTo(0.5, -6.6, 4.7, -6.0, 5.3, -2.3);
      q.quadraticCurveTo(5.5, -0.7, 5.9, 0.8);
      q.lineTo(6.4, 1.7); q.lineTo(5.6, 2.2);
      q.quadraticCurveTo(5.5, 3.0, 5.25, 3.5);
      q.quadraticCurveTo(4.8, 5.4, 2.8, 5.6);
      q.quadraticCurveTo(0.2, 5.5, -1.6, 3.3);
      q.quadraticCurveTo(-2.7, 0, -2.0, -4.3);
      q.closePath();
    };
    const sg = ctx.createRadialGradient(1.5 + hlx * 2.5, -0.5 + hly * 2.5, 0.5, 1.5, 0.5, 7.5);
    sg.addColorStop(0, C.skin[2]); sg.addColorStop(0.45, C.skin[1]); sg.addColorStop(1, C.skin[0]);
    shape(ctx, facePath, sg, hlx, hly, (q) => {
      // jaw / under-hair occlusion shadow
      q.fillStyle = 'rgba(120,50,40,0.25)';
      q.beginPath(); q.ellipse(-1.4, 0.5, 2.0, 5.5, 0, 0, TAU); q.fill();
      // cheek warmth
      const cg = q.createRadialGradient(3.6, 2.0, 0, 3.6, 2.0, 1.8);
      cg.addColorStop(0, 'rgba(255,120,110,0.45)'); cg.addColorStop(1, 'rgba(255,120,110,0)');
      q.fillStyle = cg; q.fillRect(1.6, 0, 4, 4);
      // freckles
      q.fillStyle = 'rgba(160,80,55,0.75)';
      q.fillRect(3.0, 1.1, 0.35, 0.35); q.fillRect(3.9, 1.5, 0.35, 0.35); q.fillRect(4.6, 1.0, 0.3, 0.3); q.fillRect(3.4, 2.0, 0.3, 0.3);
    }, 1.4);

    // ear
    ctx.beginPath(); ctx.ellipse(-0.9, 0.9, 1.1, 1.55, 0.1, 0, TAU);
    ctx.fillStyle = C.skin[0]; ctx.fill();
    ctx.beginPath(); ctx.ellipse(-0.75, 1.0, 0.45, 0.8, 0.1, 0, TAU); ctx.fillStyle = '#9a5a46'; ctx.fill();

    // eyes
    const bl = blinkAmount(M, t);
    const open = (1 - bl) * (1 - P.squint * 0.5);
    const gx = clamp(P.lookX, -1, 1) * 0.38, gy = clamp(P.lookY, -1, 1) * 0.35;
    drawEye(ctx, 2.75, -0.3, 0.92, 1.4, open, gx, gy, true);
    drawEye(ctx, 5.05, -0.35, 0.5, 1.25, open, gx * 0.6, gy, false);
    // brows
    const by = -2.55 - P.brow * 0.55;
    ctx.strokeStyle = HAIR[0]; ctx.lineWidth = 0.7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(1.6, by + 0.15 + (P.brow < 0 ? -P.brow * 0.2 : 0)); ctx.lineTo(3.7, by - 0.35 + (P.brow < 0 ? P.brow * -0.45 : 0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4.6, by - 0.25); ctx.lineTo(5.4, by - 0.05); ctx.stroke();
    // nose bridge highlight
    ctx.fillStyle = 'rgba(255,240,225,0.6)'; ctx.fillRect(5.7, 0.4, 0.4, 0.8);
    // mouth
    if (P.mouth > 0.12) {
      ctx.beginPath(); ctx.ellipse(4.5, 3.75, 0.55 + P.mouth * 0.2, 0.25 + P.mouth * 0.75, 0, 0, TAU);
      ctx.fillStyle = '#5a1e1e'; ctx.fill();
    } else {
      ctx.strokeStyle = '#8a3d33'; ctx.lineWidth = 0.55;
      const sm = clamp(P.smile, -1, 1);
      ctx.beginPath(); ctx.moveTo(3.75, 3.55 - sm * 0.2); ctx.quadraticCurveTo(4.5, 3.85 - P.squint * 0.3 + sm * 0.55, 5.2, 3.45 - sm * 0.25); ctx.stroke();
    }

    // hair: front cap + side-swept fringe
    const frontPath = (q) => {
      q.beginPath();
      q.moveTo(-2.5, -0.6);
      q.bezierCurveTo(-3.2, -6.0, 0.4, -7.8, 3.3, -6.6);
      q.bezierCurveTo(5.4, -5.8, 6.4 + lagX * 0.2, -3.7 + lagY * 0.2, 5.9 + lagX * 0.3, -1.6 + lagY * 0.3);
      q.quadraticCurveTo(4.8, -3.0, 3.7, -3.2);
      q.quadraticCurveTo(2.7, -2.3, 1.7, -3.1);
      q.quadraticCurveTo(0.6, -3.7, -0.2, -2.1);
      q.quadraticCurveTo(-0.5, 0.6, -0.8 + lagX * 0.3, 2.4);
      q.lineTo(-2.0, 1.8);
      q.closePath();
    };
    shape(ctx, frontPath, hg, hlx, hly, (q) => {
      // anisotropic sheen band
      q.strokeStyle = 'rgba(255,170,130,0.55)'; q.lineWidth = 0.8;
      q.beginPath(); q.arc(0.6, -1.0, 5.4, Math.PI * 1.08, Math.PI * 1.42); q.stroke();
      q.strokeStyle = 'rgba(30,8,6,0.5)'; q.lineWidth = 0.5;
      q.beginPath(); q.moveTo(0.4, -6.4); q.quadraticCurveTo(2.6, -5, 3.6, -3.4); q.stroke();
    }, 0, C.hairRim, C.hairCool);
    // outline only the fringe edge so front and back hair read as one mass
    ctx.strokeStyle = C.line; ctx.lineWidth = 0.8; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(4.6, -5.9);
    ctx.bezierCurveTo(5.6, -5.2, 6.4 + lagX * 0.2, -3.7 + lagY * 0.2, 5.9 + lagX * 0.3, -1.6 + lagY * 0.3);
    ctx.quadraticCurveTo(4.8, -3.0, 3.7, -3.2); ctx.quadraticCurveTo(2.7, -2.3, 1.7, -3.1);
    ctx.quadraticCurveTo(0.6, -3.7, -0.2, -2.1); ctx.quadraticCurveTo(-0.5, 0.6, -0.8 + lagX * 0.3, 2.4); ctx.stroke();
    ctx.restore();
  }

  function blinkAmount(M, t) {
    const d = t - M.blinkAt;
    if (d < 0 || d > 0.16) return 0;
    return d < 0.06 ? d / 0.06 : 1 - (d - 0.06) / 0.1;
  }

  function drawEye(ctx, x, y, rx, ry, open, gx, gy, near) {
    const h = ry * clamp(open, 0.08, 1);
    if (open < 0.25) {
      ctx.strokeStyle = '#2a1714'; ctx.lineWidth = 0.55;
      ctx.beginPath(); ctx.moveTo(x - rx, y + 0.2); ctx.quadraticCurveTo(x, y + 0.55, x + rx, y + 0.2); ctx.stroke();
      return;
    }
    if (near) {
      ctx.beginPath(); ctx.ellipse(x + 0.1, y, rx + 0.35, h + 0.15, 0, 0, TAU); ctx.fillStyle = '#f6f1ee'; ctx.fill();
    }
    ctx.beginPath(); ctx.ellipse(x + gx, y + gy * 0.6, rx, h, 0, 0, TAU);
    ctx.fillStyle = '#2b2a2c'; ctx.fill();
    if (near && open > 0.5) {
      ctx.fillStyle = '#5f8a5a'; ctx.beginPath(); ctx.ellipse(x + gx, y + gy * 0.6 + h * 0.35, rx * 0.6, h * 0.35, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + gx - 0.55, y + gy * 0.6 - h * 0.55, 0.5, 0.5);
    }
    // upper lash line
    ctx.strokeStyle = '#1d0f0d'; ctx.lineWidth = near ? 0.6 : 0.45;
    ctx.beginPath(); ctx.moveTo(x - rx - 0.25, y - h * 0.55); ctx.quadraticCurveTo(x, y - h - 0.25, x + rx + 0.35, y - h * 0.65); ctx.stroke();
  }

  function drawLamp(ctx, M, t, lx, ly) {
    const S = M.S, P = M.P;
    const c = Math.cos(P.lean), s = Math.sin(P.lean);
    const x = S.shN.x + 1.4 * c + 0.4 * s, y = S.shN.y + 1.4 * s - 0.4 * c;
    ctx.save(); ctx.translate(x, y); ctx.rotate(P.lean);
    // faint forward cone
    const cg = ctx.createLinearGradient(0, 0, 22, 0);
    cg.addColorStop(0, 'rgba(255,236,180,0.07)'); cg.addColorStop(1, 'rgba(255,236,180,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = cg; ctx.beginPath(); ctx.moveTo(1.6, -0.6); ctx.lineTo(22, -5); ctx.lineTo(22, 7); ctx.lineTo(1.6, 0.8); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = C.line; G.roundRect(ctx, -1.6, -1.6, 3.6, 3.0, 0.8); ctx.fill();
    ctx.fillStyle = C.gra[2]; G.roundRect(ctx, -1.1, -1.1, 2.6, 2.0, 0.5); ctx.fill();
    ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(1.4, -0.1, 0.75, 0, TAU); ctx.fill();
    glow(ctx, 1.6, -0.1, 5.5, '255,232,170', 0.4 + 0.06 * Math.sin(t * 9.0));
    ctx.restore();
  }

  /** Draw the whole character in local space (ctx already at feet, flipped and squashed). */
  function drawBody(ctx, M, p, t) {
    const S = M.S, xf = M.xf;
    HAIR = hairPalette(M.hairE, 1 - clamp((t - M.refillT) / 0.3, 0, 1));
    const lx = KEY_X * Math.sign(xf.a), ly = KEY_Y;
    // far limbs
    limb(ctx, [S.shF, S.elbF, S.handF], [SEG.uarmF, SEG.farmF], lx, ly);
    band(ctx, S.elbF, S.handF, 0.62, 0.78, SEG.farmF.w * 0.92, C.stripeFar);
    drawGlove(ctx, S.handF, C.bootFar);
    limb(ctx, [S.hipF, S.kneeF, S.ankF], [SEG.thighF, SEG.shinF], lx, ly);
    band(ctx, S.kneeF, S.ankF, 0.3, 0.44, SEG.shinF.w * 0.92, C.stripeFar);
    drawBoot(ctx, S.ankF, M.P.ftoe, C.bootFar, lx, ly);
    drawLanyard(ctx, M, xf);
    // near leg (the belt overlaps its top)
    limb(ctx, [S.hipN, S.kneeN, S.ankN], [SEG.thighN, SEG.shinN], lx, ly);
    band(ctx, S.kneeN, S.ankN, 0.3, 0.44, SEG.shinN.w * 0.92, C.stripe);
    ctx.beginPath(); ctx.arc(S.kneeN.x + 0.3, S.kneeN.y, 1.55, 0, TAU); ctx.fillStyle = C.gra[1]; ctx.fill();
    ctx.lineWidth = 0.6; ctx.strokeStyle = C.line; ctx.stroke();
    drawBoot(ctx, S.ankN, M.P.ntoe, C.boot, lx, ly);
    // back hair strands
    drawStrand(ctx, M, 2, xf); drawStrand(ctx, M, 3, xf);
    drawTorso(ctx, M, lx, ly);
    drawHead(ctx, M, p, t, lx, ly);
    drawStrand(ctx, M, 0, xf); drawStrand(ctx, M, 1, xf);
    if (p.carry) drawItem(ctx, p.carry, S.item.x, S.item.y, t, 1);
    // near arm
    limb(ctx, [S.shN, S.elbN, S.handN], [SEG.uarmN, SEG.farmN], lx, ly);
    band(ctx, S.elbN, S.handN, 0.62, 0.78, SEG.farmN.w * 0.92, C.stripe);
    drawGlove(ctx, S.handN, C.boot);
    drawLamp(ctx, M, t, lx, ly);
  }

  // ---------------------------------------------------------------- offscreen (spawn / ghost)
  let oc = null, octx = null;
  const OCW = 76, OCH = 76, OCX = 38, OCY = 64;
  function renderOffscreen(ctx, M, p, t, tint, tintA) {
    const m = ctx.getTransform();
    const s = clamp(Math.hypot(m.a, m.b), 1, 4);
    const pw = Math.ceil(OCW * s), ph = Math.ceil(OCH * s);
    if (!oc || oc.width < pw || oc.height < ph) {
      oc = document.createElement('canvas'); oc.width = pw; oc.height = ph; octx = oc.getContext('2d');
    }
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, pw, ph);
    const xf = M.xf;
    octx.setTransform(s, 0, 0, s, 0, 0);
    octx.translate(OCX, OCY + xf.pv); octx.scale(xf.a, xf.d); octx.translate(0, -xf.pv);
    // strands are stored in world space; draw relative to a transform whose world origin matches
    drawBody(octx, M, p, t);
    if (tintA > 0) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-atop';
      octx.globalAlpha = tintA; octx.fillStyle = tint; octx.fillRect(0, 0, pw, ph);
      octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over';
    }
    return { pw, ph };
  }

  function drawSpawn(ctx, M, p, t) {
    const k = clamp(p.stateTime / 0.45, 0, 1);
    const e = easeOutCubic(k);
    const fx = M.xf.fx, fy = M.xf.fy;
    if (!M.spawnFx && G.fx) {
      M.spawnFx = true;
      G.fx.burst(fx, fy - 22, { count: 14, color: ['#7ef9ff', '#c8ffff', '#5fd8ff'], speed: 120, life: 0.5, size: 2, gravity: -60, glow: true, shape: 'square' });
    }
    const { pw, ph } = renderOffscreen(ctx, M, p, t, '#7ef9ff', 0.85 * (1 - k));
    const edge = fy + 3 - e * 58;
    ctx.save();
    ctx.beginPath(); ctx.rect(fx - 40, edge, 80, fy + 6 - edge); ctx.clip();
    ctx.globalAlpha = 0.35 + 0.65 * k;
    ctx.drawImage(oc, 0, 0, pw, ph, fx - OCX, fy - OCY, OCW, OCH);
    // scanline slices jitter while materialising
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 * (1 - k);
    for (let i = 0; i < 6; i++) {
      const sy = 6 + i * 9 + Math.floor(hash1(i + Math.floor(t * 30)) * 6);
      const off = (hash1(i * 7.3 + Math.floor(t * 40)) - 0.5) * 7 * (1 - k);
      const srcY = (sy / OCH) * ph;
      ctx.drawImage(oc, 0, srcY, pw, (2.5 / OCH) * ph, fx - OCX + off, fy - OCY + sy, OCW, 2.5);
    }
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // beam column
    const a = 1 - k;
    const bg = ctx.createLinearGradient(fx - 16, 0, fx + 16, 0);
    bg.addColorStop(0, 'rgba(126,249,255,0)'); bg.addColorStop(0.5, `rgba(126,249,255,${0.32 * a})`); bg.addColorStop(1, 'rgba(126,249,255,0)');
    ctx.fillStyle = bg; ctx.fillRect(fx - 16, fy - 70, 32, 72);
    // reveal edge
    ctx.fillStyle = `rgba(210,255,255,${0.9 * a})`; ctx.fillRect(fx - 12, edge - 0.6, 24, 1.2);
    glow(ctx, fx, edge, 16, '126,249,255', 0.55 * a);
    // floor ring
    ctx.strokeStyle = `rgba(126,249,255,${0.8 * a})`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(fx, fy - 0.5, 6 + 10 * e, 1.8 + 1.4 * e, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function drawGhost(ctx, M, p, t) {
    const k = clamp(p.stateTime / 0.3, 0, 1);
    if (k >= 1 || !M.deadPose) return;
    const P = M.P; Object.assign(P, M.deadPose); solve(P, M.S);
    const { pw, ph } = renderOffscreen(ctx, M, p, t, '#e9fbff', 0.9);
    const fx = M.xf.fx, fy = M.xf.fy;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 * (1 - k) * (1 - k);
    const sc = 1 + 0.25 * k;
    ctx.translate(fx, fy - 22 - 8 * k); ctx.scale(sc * (1 + 0.3 * k), sc);
    ctx.drawImage(oc, 0, 0, pw, ph, -OCX, -OCY + 22, OCW, OCH);
    ctx.restore();
  }

  // ---------------------------------------------------------------- Chapter 2: dash trail, rope
  /** Magenta after-images of the current pose at recently sampled feet positions + speed lines. */
  function drawTrail(ctx, M, p, t) {
    const { pw, ph } = renderOffscreen(ctx, M, p, t, DASH_COL, 0.82);
    ctx.save();
    const n = M.trail.length;
    for (let i = 0; i < n; i++) {
      const q = M.trail[i];
      const age = clamp((t - q.t) / 0.28, 0, 1);
      if (age >= 1) continue;
      ctx.globalAlpha = 0.42 * (1 - age) * (0.35 + 0.65 * (i + 1) / n);
      ctx.drawImage(oc, 0, 0, pw, ph, q.x - OCX, q.y - OCY, OCW, OCH);
    }
    // speed lines along the trail
    const a = M.trail[0], b = { x: M.xf.fx, y: M.xf.fy };
    const dx = b.x - a.x, dy = b.y - a.y, dl = Math.hypot(dx, dy);
    if (dl > 4) {
      ctx.globalCompositeOperation = 'lighter';
      const nx = -dy / dl, ny = dx / dl;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 7 + (hash1(i + Math.floor(t * 30)) - 0.5) * 3;
        const yo = -22 + (i - 1.5) * 4;
        const fade = 1 - clamp((t - M.trail[n - 1].t) / 0.2, 0, 1);
        ctx.globalAlpha = 0.45 * fade;
        ctx.strokeStyle = i % 2 ? '#ffe2f7' : DASH_COL; ctx.lineWidth = i % 2 ? 0.8 : 1.4;
        ctx.beginPath();
        ctx.moveTo(a.x + nx * off * 0.6, a.y + yo + ny * off * 0.6);
        ctx.lineTo(b.x - dx / dl * 10 + nx * off * 0.6, b.y + yo - dy / dl * 10 + ny * off * 0.6);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Grapple rope from the anchor (p.rope.ax/ay) to her near hand: taut braided cable + energy pulse. */
  function drawRope(ctx, M, p, t) {
    const r = p.rope;
    let ax = r.ax, ay = r.ay;
    if (!isFinite(ax) || !isFinite(ay)) {
      if (!isFinite(r.angle) || !isFinite(r.len)) return;
      ax = p.x + p.w / 2 - Math.sin(r.angle) * r.len; ay = p.y + 10 - Math.cos(r.angle) * r.len;
    }
    toWorld(M.xf, M.S.handN.x, M.S.handN.y, _w);
    const hx = _w.x, hy = _w.y;
    const dx = hx - ax, dy = hy - ay, dl = Math.hypot(dx, dy) || 1;
    const nx = -dy / dl, ny = dx / dl;
    // attach twang: lateral vibration that decays in ~0.4 s
    const ta = t - M.ropeT;
    const tw = ta >= 0 && ta < 0.5 ? Math.sin(ta * 70) * 3.2 * Math.exp(-ta * 9) : 0;
    const mx = (ax + hx) / 2 + nx * tw, my = (ay + hy) / 2 + ny * tw + Math.min(2, dl * 0.01);
    ctx.save();
    ctx.lineCap = 'round';
    const path = () => { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, hx, hy); };
    path(); ctx.strokeStyle = C.line; ctx.lineWidth = 2.6; ctx.stroke();
    path(); ctx.strokeStyle = '#8f7c5e'; ctx.lineWidth = 1.5; ctx.stroke();
    // braid ticks
    ctx.strokeStyle = '#d9c7a2'; ctx.lineWidth = 0.6;
    const n = Math.max(2, Math.floor(dl / 4));
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const k = i / n, u = 1 - k;
      const x = u * u * ax + 2 * u * k * mx + k * k * hx, y = u * u * ay + 2 * u * k * my + k * k * hy;
      ctx.moveTo(x - nx * 0.6 - dx / dl * 0.7, y - ny * 0.6 - dy / dl * 0.7); ctx.lineTo(x + nx * 0.6 + dx / dl * 0.7, y + ny * 0.6 + dy / dl * 0.7);
    }
    ctx.stroke();
    // energy pulse travelling from hand to anchor
    ctx.globalCompositeOperation = 'lighter';
    for (let j = 0; j < 2; j++) {
      const k = 1 - ((t * 1.6 + j * 0.5) % 1), u = 1 - k;
      const x = u * u * ax + 2 * u * k * mx + k * k * hx, y = u * u * ay + 2 * u * k * my + k * k * hy;
      glow(ctx, x, y, 5, '126,249,255', 0.5);
    }
    ctx.strokeStyle = 'rgba(126,249,255,0.18)'; ctx.lineWidth = 3; path(); ctx.stroke();
    // carabiner at the hand
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = C.line; ctx.beginPath(); ctx.arc(hx, hy, 1.9, 0, TAU); ctx.fill();
    ctx.fillStyle = C.metal; ctx.beginPath(); ctx.arc(hx - 0.3, hy - 0.3, 1.1, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /**
   * Draw Mira in world space.
   * @param {CanvasRenderingContext2D} ctx camera-translated world context
   * @param {G.Player} p player (read only)
   * @param {number} t level time in seconds
   */
  function drawPlayer(ctx, p, t) {
    let M = mem.get(p);
    if (!M || t < M.t - 0.001) { M = newMem(p, t); mem.set(p, M); }
    update(M, p, t);
    ctx.save();
    try {
      if (p.state === 'dead' || p.dead) drawGhost(ctx, M, p, t);
      else if (p.state === 'spawn' && p.stateTime < 0.45) drawSpawn(ctx, M, p, t);
      else {
        // contact shadow
        if (p.onGround) {
          const sg = ctx.createRadialGradient(M.xf.fx, M.xf.fy, 0, M.xf.fx, M.xf.fy, 11);
          sg.addColorStop(0, 'rgba(0,0,0,0.32)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = sg; ctx.save(); ctx.translate(M.xf.fx, M.xf.fy); ctx.scale(1, 0.22); ctx.translate(-M.xf.fx, -M.xf.fy);
          ctx.fillRect(M.xf.fx - 11, M.xf.fy - 11, 22, 22); ctx.restore();
        }
        if (M.trail.length) drawTrail(ctx, M, p, t);
        if (p.state === 'swing' && p.rope) drawRope(ctx, M, p, t);
        const B = readBuffs(p), bf = buffMem(M, p, t, B);
        if (B.slow) drawSlowGhosts(ctx, M, p, t, bf);
        ctx.save();
        applyXf(ctx, M.xf);
        drawBuffsBack(ctx, M, p, t, B, bf);
        // i-frames: blink (spec §1: 0.9 s after a hit)
        const ifr = num(p.iframes, 0);
        const ga = ctx.globalAlpha;
        if (ifr > 0 && Math.floor(t * 15) % 2) ctx.globalAlpha = ga * 0.3;
        drawBody(ctx, M, p, t);
        ctx.globalAlpha = ga;
        drawBuffsFrontLocal(ctx, M, p, t, B, bf);
        ctx.restore();
        const flash = clamp((ifr - 0.72) / 0.18, 0, 1);
        if (flash > 0) drawHurtFlash(ctx, M, p, t, flash);
        drawBuffsWorld(ctx, M, p, t, B, bf);
        // refill flash: a quick magenta ring + sparkle around her head
        const rf = t - M.refillT;
        if (rf >= 0 && rf < 0.35) {
          toWorld(M.xf, M.S.head.x, M.S.head.y, _w);
          const k = rf / 0.35;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = `rgba(${DASH_RGB},${0.85 * (1 - k)})`; ctx.lineWidth = 1.4 * (1 - k) + 0.4;
          ctx.beginPath(); ctx.arc(_w.x, _w.y, 5 + 13 * easeOutCubic(k), 0, TAU); ctx.stroke();
          glow(ctx, _w.x, _w.y, 16, DASH_RGB, 0.5 * (1 - k));
          ctx.restore();
        }
        // occasional glove sparks while wall-sliding
        if (p.state === 'wall' && G.fx && t - M.sparkT > 0.09 && hash1(Math.floor(t * 20)) < 0.35) {
          M.sparkT = t;
          const S = M.S; toWorld(M.xf, S.handF.x - 1.5, S.handF.y, _w);
          G.fx.spawn({ x: _w.x, y: _w.y, vx: -M.face * (20 + Math.random() * 40), vy: -30 - Math.random() * 50, life: 0.25, size: 1.6,
            color: '#ffd27a', gravity: 500, drag: 2, glow: true, shape: 'spark' });
        }
      }
    } finally { ctx.restore(); }
  }

  // ================================================================== ЛЮМ (drone)
  const dmem = new WeakMap();
  const MOOD = {
    neutral: [95, 244, 230], happy: [140, 255, 176], alert: [255, 181, 71], sad: [108, 155, 255],
  };
  const SHELL = ['#9fb0c2', '#e9f0f6', '#ffffff'];

  // portrait mood -> drone eye mood while talking
  const TALK_MOOD = { neutral: 'neutral', happy: 'happy', sad: 'sad', angry: 'alert', scared: 'alert', surprised: 'alert', thinking: 'neutral', determined: 'neutral' };
  function droneMood(d) {
    if (d.talking && d.talkMood && d.state !== 'broken' && d.state !== 'waking') return TALK_MOOD[d.talkMood] || d.mood;
    return d.mood;
  }

  function newDroneMem(d, t) {
    return { t, tilt: 0, ef: d.facing || 1, px: 0, py: 0, ant: 0, antV: 0, col: (MOOD[d.mood] || MOOD.neutral).slice(),
      rotor: 0, sparkT: t, vxPrev: d.vx || 0, happyT: 9, prevMood: d.mood, blinkAt: t + 2, blinkN: 0, spinFx: false };
  }

  function updateDrone(M, d, t) {
    let dt = t - M.t;
    if (dt < -0.001 || dt > 1) dt = 0;
    dt = Math.min(dt, 0.3);
    M.t = t;
    const dm = droneMood(d);
    if (dm !== M.prevMood) { if (dm === 'happy') M.happyT = 0; M.prevMood = dm; }
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6)), h = dt / n;
    const target = MOOD[dm] || MOOD.neutral;
    let dx = (d.lookX != null ? d.lookX : d.x + (d.facing || 1) * 10) - d.x, dy = (d.lookY != null ? d.lookY : d.y) - d.y;
    if (d.talking && d.talkMood === 'thinking') { dx = (d.facing || 1) * 14 + Math.sin(t * 0.9) * 10; dy = -22; }
    else if (d.talking && d.talkMood === 'scared') { dx += Math.sin(t * 23) * 8; }
    const dl = Math.hypot(dx, dy) || 1, pm = Math.min(1.5, dl / 30);
    for (let i = 0; i < n && h > 0; i++) {
      const tt = t - dt + h * (i + 1);
      const tiltT = d.state === 'follow' ? clamp((d.vx || 0) / 260, -1, 1) * 0.32 : 0;
      M.tilt += (tiltT - M.tilt) * (1 - Math.exp(-8 * h));
      M.ef += ((d.facing || 1) - M.ef) * (1 - Math.exp(-10 * h));
      M.px += (dx / dl * pm - M.px) * (1 - Math.exp(-12 * h));
      M.py += (dy / dl * pm - M.py) * (1 - Math.exp(-12 * h));
      // antenna: spring driven by horizontal acceleration
      const ax = ((d.vx || 0) - M.vxPrev) / Math.max(h, 1e-3); M.vxPrev = d.vx || 0;
      M.antV += (-160 * M.ant - 7 * M.antV - clamp(ax, -3000, 3000) * 0.0009) * h;
      M.ant += M.antV * h;
      for (let c = 0; c < 3; c++) M.col[c] += (target[c] - M.col[c]) * (1 - Math.exp(-8 * h));
      M.rotor += h * 60;
      M.happyT += h;
      if (tt > M.blinkAt + 0.14) { M.blinkN++; M.blinkAt = tt + 2.5 + hash1(M.blinkN * 5.1) * 3; }
    }
  }

  /**
   * Draw ЛЮМ in world space.
   * @param {CanvasRenderingContext2D} ctx camera-translated world context
   * @param {G.Drone} d drone (read only): x,y centre, vx,vy, facing, state, stateTime, lookX/lookY, mood
   * @param {number} t level time in seconds
   */
  function drawDrone(ctx, d, t) {
    let M = dmem.get(d);
    if (!M || t < M.t - 0.001) { M = newDroneMem(d, t); dmem.set(d, M); }
    updateDrone(M, d, t);
    const st = d.stateTime || 0;
    const col = M.col.map((v) => Math.round(v)).join(',');
    let tilt = M.tilt, oy = 0, eyeOn = 1, rotorA = 1, spin = 1, crack = 0, bodyRot = 0, sparks = false;
    let mood = droneMood(d);
    const talking = !!d.talking && d.state !== 'broken' && d.state !== 'waking';
    M.talk = talking ? Math.abs(Math.sin(t * 13.0) * Math.sin(t * 4.7 + 1.0)) : 0;
    if (d.state === 'broken') {
      bodyRot = 1.15; eyeOn = flicker(t, 0.12) ? 0.35 : 0; rotorA = 0; crack = 1; sparks = true; mood = 'broken';
    } else if (d.state === 'waking') {
      const k = st / 1.2;
      crack = 1 - sstep(0.55, 1.0, k);
      bodyRot = 1.15 * (1 - easeOutBack(sstep(0.22, 0.62, k)));
      eyeOn = k < 0.4 ? (flicker(t * 1.6, 0.25 + k * 1.6) ? 1 : 0.1) : 1;
      rotorA = sstep(0.18, 0.55, k);
      const sk = sstep(0.62, 0.95, k);
      spin = Math.cos(sk * TAU); if (Math.abs(spin) < 0.18) spin = spin < 0 ? -0.18 : 0.18;
      sparks = k < 0.3;
      if (k > 0.6 && !M.spinFx && G.fx) {
        M.spinFx = true;
        G.fx.burst(d.x, d.y, { count: 10, color: ['#7ef9ff', '#d9ffff'], speed: 90, life: 0.45, size: 1.6, gravity: 0, glow: true, shape: 'square' });
      }
      if (k > 0.25) mood = 'neutral';
      else mood = 'broken';
    } else {
      M.spinFx = false;
      if (mood === 'happy') oy -= Math.abs(Math.sin(M.happyT * 11)) * 2.6 * Math.exp(-M.happyT * 2.2);
      if (mood === 'sad') oy += 1.5;
      oy += Math.sin(t * 3.1) * 0.6;
      if (talking) {
        // speaking bob: little nods on the syllable beat + a slow lean into the line
        oy += -Math.abs(Math.sin(t * 6.5)) * 1.3 + M.talk * 0.5;
        tilt += Math.sin(t * 3.3) * 0.07 * (d.facing || 1) + (d.talkMood === 'thinking' ? 0.12 * (d.facing || 1) : 0);
        if (d.talkMood === 'happy') oy -= Math.abs(Math.sin(t * 9)) * 1.2;
        if (d.talkMood === 'scared') tilt += Math.sin(t * 37) * 0.05;
      }
    }

    ctx.save();
    try {
      ctx.translate(d.x, d.y + oy);
      // thruster wash
      if (rotorA > 0.05) {
        glow(ctx, 0, 9, 10, col, 0.22 * rotorA);
        ctx.globalCompositeOperation = 'lighter';
        const fl = 0.75 + 0.25 * hash1(Math.floor(t * 30));
        const jg = ctx.createLinearGradient(0, 6.5, 0, 6.5 + 6 * fl);
        jg.addColorStop(0, `rgba(${col},${0.55 * rotorA})`); jg.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = jg;
        ctx.beginPath(); ctx.moveTo(-2.2, 6.6); ctx.lineTo(2.2, 6.6); ctx.lineTo(0, 6.6 + 6 * fl); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.rotate(tilt + bodyRot);
      ctx.scale(spin, 1);
      const ef = clamp(M.ef, -1, 1);
      const lx = KEY_X, ly = KEY_Y;

      // rotor arms + discs (behind the shell)
      for (const side of [-1, 1]) {
        const ax = side * 6.0, ay = -2.6, bx = side * 10.6, by = -5.4 + (d.state === 'broken' && side > 0 ? 3.5 : 0);
        ctx.lineCap = 'round';
        ctx.strokeStyle = C.line; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.strokeStyle = '#7d8aa0'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = C.line; ctx.beginPath(); ctx.arc(bx, by - 0.6, 1.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c7d2e0'; ctx.beginPath(); ctx.arc(bx, by - 0.6, 0.9, 0, TAU); ctx.fill();
        if (rotorA > 0.02) {
          ctx.fillStyle = `rgba(210,240,255,${0.22 * rotorA})`;
          ctx.beginPath(); ctx.ellipse(bx, by - 1.4, 4.8, 1.15, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = `rgba(235,250,255,${0.55 * rotorA})`; ctx.lineWidth = 0.6;
          const ra = M.rotor * (side > 0 ? 1 : -1);
          for (let b = 0; b < 2; b++) {
            const c = Math.cos(ra + b * Math.PI) * 4.6;
            ctx.beginPath(); ctx.moveTo(bx - c, by - 1.4 - 0.25); ctx.lineTo(bx + c, by - 1.4 + 0.25); ctx.stroke();
          }
        } else {
          ctx.strokeStyle = '#9aa6b8'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(bx - 3.6, by - 1.1); ctx.lineTo(bx + 3.2, by - 2.0); ctx.stroke();
        }
      }
      // antenna (spring sway; droops when broken / sad)
      {
        const droop = d.state === 'broken' ? 1.3 : mood === 'sad' ? 0.35 : 0;
        const baseX = -1.8 * ef, baseY = -7.2;
        const a = -0.32 * ef + M.ant + droop * -ef;
        const tx = baseX + Math.sin(a) * 6, ty = baseY - Math.cos(a) * 6;
        const mx = baseX + Math.sin(a * 0.5) * 3.2, my = baseY - Math.cos(a * 0.5) * 3.2;
        ctx.strokeStyle = C.line; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(baseX, baseY + 1); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
        ctx.strokeStyle = '#aab6c8'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(baseX, baseY + 1); ctx.quadraticCurveTo(mx, my, tx, ty); ctx.stroke();
        const on = d.state === 'broken' ? 0 : (talking ? 0.4 + 0.6 * M.talk : ((t * 0.9) % 1 < 0.18 ? 1 : 0.35)) * eyeOn;
        ctx.fillStyle = C.line; ctx.beginPath(); ctx.arc(tx, ty, 1.5, 0, TAU); ctx.fill();
        ctx.fillStyle = on > 0.5 ? `rgb(${col})` : '#4b5a66'; ctx.beginPath(); ctx.arc(tx, ty, 0.95, 0, TAU); ctx.fill();
        if (on > 0) glow(ctx, tx, ty, 5, col, 0.6 * on);
      }

      // shell
      const R = 7.6;
      const sg = ctx.createRadialGradient(lx * 3.4, ly * 3.4, 0.6, 0, 0, R + 1);
      sg.addColorStop(0, SHELL[2]); sg.addColorStop(0.5, SHELL[1]); sg.addColorStop(1, SHELL[0]);
      const shellPath = (q) => { q.beginPath(); q.arc(0, 0, R, 0, TAU); };
      shape(ctx, shellPath, sg, lx, ly, (q) => {
        // graphite underside cap
        q.fillStyle = '#3a4258';
        q.beginPath(); q.ellipse(0, 7.4, 8.6, 3.6, 0, 0, TAU); q.fill();
        q.fillStyle = 'rgba(255,255,255,0.18)'; q.fillRect(-6, 4.0, 12, 0.5);
        // top seam
        q.strokeStyle = 'rgba(70,90,110,0.45)'; q.lineWidth = 0.5;
        q.beginPath(); q.ellipse(0, -3.6, 6.6, 1.7, 0, Math.PI, TAU); q.stroke();
        // equator ring light
        q.lineWidth = 1.5; q.strokeStyle = d.state === 'broken' ? '#33505a' : `rgb(${col})`;
        q.beginPath(); q.ellipse(0, 1.6, R, 2.4, 0, 0, Math.PI); q.stroke();
        // cracks
        if (crack > 0.01) {
          q.globalAlpha = crack;
          q.strokeStyle = '#2a3140'; q.lineWidth = 0.6;
          q.beginPath(); q.moveTo(-6.8, -2.4); q.lineTo(-4.4, -1.2); q.lineTo(-3.6, -3.0); q.lineTo(-1.8, -2.0);
          q.moveTo(-4.4, -1.2); q.lineTo(-4.8, 1.4); q.moveTo(5.8, -4.2); q.lineTo(4.2, -2.8); q.lineTo(4.8, -1.0); q.stroke();
          q.globalAlpha = 1;
        }
      });
      if (d.state !== 'broken') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(${col},0.25)`; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.ellipse(0, 1.6, R + 0.3, 2.6, 0, 0.15, Math.PI - 0.15); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      // specular
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, R - 1.6, Math.PI * 1.12, Math.PI * 1.38); ctx.stroke();

      // eye
      drawDroneEye(ctx, M, d, t, ef, col, eyeOn, mood);
    } finally { ctx.restore(); }

    // ambient sparks while broken (tiny, rate-limited)
    if (sparks && G.fx && t - M.sparkT > 0.25) {
      M.sparkT = t;
      if (hash1(Math.floor(t * 4) + 0.5) < 0.4) {
        G.fx.burst(d.x - 3, d.y - 3, { count: 3, color: ['#bfffff', '#7ef9ff', '#ffe6a0'], speed: 90, life: 0.3, size: 1.5, gravity: 500, glow: true, shape: 'spark' });
      }
    }
  }

  function flicker(t, duty) {
    const n = Math.floor(t * 14);
    return hash1(n) < duty;
  }

  function drawDroneEye(ctx, M, d, t, ef, col, eyeOn, mood) {
    const ex = 2.2 * ef, ey = -0.5;
    const blink = (() => { const q = t - M.blinkAt; return q < 0 || q > 0.14 ? 0 : 1 - Math.abs(q - 0.07) / 0.07; })();
    // housing
    ctx.beginPath(); ctx.arc(ex, ey, 4.7, 0, TAU);
    ctx.fillStyle = C.line; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, 4.1, 0, TAU);
    const hg = ctx.createRadialGradient(ex - 1, ey - 1, 0.3, ex, ey, 4.1);
    hg.addColorStop(0, '#2a3446'); hg.addColorStop(1, '#0b1018');
    ctx.fillStyle = hg; ctx.fill();
    ctx.strokeStyle = '#9fb0c4'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(ex, ey, 4.35, 0, TAU); ctx.stroke();
    if (eyeOn <= 0.01) {
      ctx.strokeStyle = 'rgba(120,140,160,0.35)'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.arc(ex, ey, 2.3, 0, TAU); ctx.stroke();
    } else if (mood === 'happy') {
      glow(ctx, ex, ey, 7, col, 0.45);
      ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ex, ey + 1.3, 2.3, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(ex - 2.2, ey - 2.6, 0.7, 0.7);
    } else {
      const px = ex + M.px * 1.0, py = ey + M.py * 1.0;
      const tk = M.talk || 0;
      const ir = (mood === 'alert' ? 2.9 : mood === 'sad' ? 2.25 : mood === 'broken' ? 2.0 : 2.55) * (1 + 0.14 * tk);
      const pr = mood === 'alert' ? 0.85 : 1.1;
      ctx.globalAlpha = eyeOn;
      glow(ctx, px, py, 7.5 + 3 * tk, col, 0.45 + 0.35 * tk);
      if (tk > 0.02) {
        // voice rings radiating from the lens
        ctx.strokeStyle = `rgba(${col},${0.5 * tk})`; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(ex, ey, 5.2 + tk * 1.6, -0.9, 0.9); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 6.6 + tk * 2.2, -0.6, 0.6); ctx.stroke();
      }
      const ig = ctx.createRadialGradient(px - 0.5, py - 0.5, 0.2, px, py, ir);
      ig.addColorStop(0, '#ffffff'); ig.addColorStop(0.35, `rgb(${col})`); ig.addColorStop(1, `rgba(${col},0.55)`);
      ctx.beginPath(); ctx.arc(px, py, ir, 0, TAU); ctx.fillStyle = ig; ctx.fill();
      // aperture ticks
      ctx.strokeStyle = 'rgba(10,20,30,0.45)'; ctx.lineWidth = 0.35;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + t * 0.6;
        ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * pr * 1.3, py + Math.sin(a) * pr * 1.3); ctx.lineTo(px + Math.cos(a) * ir * 0.9, py + Math.sin(a) * ir * 0.9); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fillStyle = '#071017'; ctx.fill();
      ctx.globalAlpha = 1;
      // lids: blink + sad droop, clipped to the housing
      const lid = Math.max(blink, mood === 'sad' ? 0.42 : 0);
      if (lid > 0.01) {
        ctx.save();
        ctx.beginPath(); ctx.arc(ex, ey, 4.15, 0, TAU); ctx.clip();
        ctx.fillStyle = '#d7e1ea';
        const yl = ey - 4.2 + lid * 8.4;
        const sl = mood === 'sad' ? 1.6 * ef : 0;
        ctx.beginPath(); ctx.moveTo(ex - 5, ey - 5); ctx.lineTo(ex + 5, ey - 5); ctx.lineTo(ex + 5, yl + sl); ctx.lineTo(ex - 5, yl - sl); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(ex - 5, yl - sl); ctx.lineTo(ex + 5, yl + sl); ctx.stroke();
        ctx.restore();
      }
      if (mood === 'alert') {
        ctx.strokeStyle = `rgba(${col},0.8)`; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(ex, ey, 4.0, -0.4 + t * 3, 0.6 + t * 3); ctx.stroke();
      }
    }
    // glass reflection
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(ex - 1.6, ey - 1.7, 0.75, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.arc(ex + 1.6, ey + 1.8, 0.4, 0, TAU); ctx.fill();
  }


  // ================================================================== Mira: pickup buffs + hurt
  // docs/companions-spec.md §1–2. Reads p.buffs = {shield:{hits,t}, glider:{t,uses}, jetpack:{fuel},
  // boots:{t}, slowmo:{t}} and p.iframes defensively; optional engine hints: p.gliding, p.jetting.
  const BUFF = { shield: '95,178,255', glider: '159,240,255', jet: '255,140,58', boots: '255,225,74', slow: '179,139,255', hurt: '#ff5a4a' };
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  /** Normalised view of p.buffs (missing / malformed entries → inactive). */
  function readBuffs(p) {
    const b = (p && p.buffs) || {};
    const o = (k) => (b[k] && typeof b[k] === 'object' ? b[k] : null);
    const sh = o('shield'), gl = o('glider'), jp = o('jetpack'), bo = o('boots'), sm = o('slowmo');
    return {
      shield: sh && num(sh.hits, 1) > 0 && num(sh.t, 1) > 0 ? { hits: num(sh.hits, 1), t: num(sh.t, 9) } : null,
      glider: gl && num(gl.t, 1) > 0 && num(gl.uses, 1) > 0 ? { t: num(gl.t, 9) } : null,
      jet: jp && num(jp.fuel, 0) > 0 ? { fuel: num(jp.fuel, 0) } : null,
      boots: bo && num(bo.t, 0) > 0 ? { t: num(bo.t, 0) } : null,
      slow: sm && num(sm.t, 0) > 0 ? { t: num(sm.t, 0) } : null,
    };
  }
  /** Expiry warning: blinks faster as the remaining time runs out (< 3 s). */
  const expiring = (rem, t) => (rem < 3 ? (Math.sin(t * (10 + (3 - rem) * 8)) > -0.2 ? 1 : 0.35) : 1);
  function buffMem(M, p, t, B) {
    if (!M.bf) M.bf = { fuel: B.jet ? B.jet.fuel : 0, jetK: 0, glideK: 0, hits: B.shield ? B.shield.hits : 0, hitT: -9, vy: p.vy || 0, ground: !!p.onGround, ringT: -9, hist: [], histT: 0, t, shieldK: 0 };
    const b = M.bf;
    let dt = clamp(t - b.t, 0, 0.1); if (t < b.t - 0.01) dt = 0; b.t = t;
    const fuel = B.jet ? B.jet.fuel : 0;
    const thrust = p.jetting != null ? !!p.jetting : (B.jet && fuel < b.fuel - 1e-4 && !p.onGround);
    b.fuel = fuel;
    b.jetK += ((thrust ? 1 : 0) - b.jetK) * (1 - Math.exp(-18 * dt));
    const gliding = p.gliding != null ? !!p.gliding : p.state === 'glide' || (!!B.glider && !p.onGround && (p.vy || 0) > 10 && (p.vy || 0) < 150 && p.state !== 'swing' && p.state !== 'wall');
    b.glideK += ((gliding ? 1 : 0) - b.glideK) * (1 - Math.exp(-(gliding ? 12 : 7) * dt));
    b.shieldK += ((B.shield ? 1 : 0) - b.shieldK) * (1 - Math.exp(-10 * dt));
    const hits = B.shield ? B.shield.hits : 0;
    if (hits < b.hits) b.hitT = t;
    b.hits = hits;
    // mid-air jump with boots → kick ring
    const vy = p.vy || 0;
    if (B.boots && !p.onGround && !b.ground && vy < -220 && b.vy > -60) {
      b.ringT = t;
      toWorld(M.xf, 0, 0, _w);
      if (G.fx) G.fx.burst(_w.x, _w.y, { count: 10, color: ['#ffe14a', '#fff6c8', '#ffffff'], speed: 120, life: 0.35, size: 1.6, gravity: 200, glow: true, shape: 'spark' });
    }
    b.vy = vy; b.ground = !!p.onGround;
    if (B.slow && t - b.histT > 0.05) { b.histT = t; b.hist.push({ x: M.xf.fx, y: M.xf.fy }); if (b.hist.length > 4) b.hist.shift(); }
    if (!B.slow) b.hist.length = 0;
    return b;
  }

  /** Things behind her body (local skeleton space, applyXf already set). */
  function drawBuffsBack(ctx, M, p, t, B, b) {
    const S = M.S;
    const ang = Math.atan2(S.shF.x - S.hipF.x, -(S.shF.y - S.hipF.y));   // torso lean
    const bx = lerp(S.shF.x, S.hipF.x, 0.42) - 3.6, by = lerp(S.shF.y, S.hipF.y, 0.42);
    // --- glider: folded roll on the back, or deployed wing frame above her
    if (B.glider || b.glideK > 0.02) {
      const k = b.glideK, ex = B.glider ? expiring(B.glider.t, t) : 0.5;
      if (k < 0.98) {
        ctx.save(); ctx.translate(bx - 1.2, by - 6); ctx.rotate(ang + 1.35);
        ctx.globalAlpha *= 1 - k;
        ctx.fillStyle = C.line; G.roundRect(ctx, -6.5, -2.4, 13, 4.8, 2.4); ctx.fill();
        const rg = ctx.createLinearGradient(0, -2, 0, 2); rg.addColorStop(0, '#e9f6ff'); rg.addColorStop(1, '#6c8fb0');
        ctx.fillStyle = rg; G.roundRect(ctx, -5.8, -1.7, 11.6, 3.4, 1.7); ctx.fill();
        ctx.fillStyle = '#e2712d'; ctx.fillRect(-2.2, -1.7, 1.4, 3.4); ctx.fillRect(1.6, -1.7, 1.4, 3.4);
        ctx.restore();
      }
      if (k > 0.02) {
        const hy = S.head.y - 13 - 4 * k, span = 30 * easeOutBack(clamp(k, 0, 1)), sag = 7 * k;
        const tilt = clamp((p.vx || 0) * (M.face || 1) / 900, -0.25, 0.25) - 0.08;
        const ct = Math.cos(tilt), sn = Math.sin(tilt);
        // rigging lines from the canopy to her shoulders
        ctx.strokeStyle = 'rgba(30,34,48,0.75)'; ctx.lineWidth = 0.45;
        ctx.beginPath();
        for (const sx of [-span, -span * 0.45, span * 0.45, span]) {
          const tgt = sx < 0 ? S.shF : S.shN, sy = 2.6;
          ctx.moveTo(-1 + sx * ct - sy * sn, hy + sx * sn + sy * ct);
          ctx.lineTo(tgt.x, tgt.y);
        }
        ctx.stroke();
        ctx.save();
        ctx.translate(-1, hy); ctx.rotate(tilt);
        // canopy (crescent with cells)
        const path = (q) => {
          q.beginPath(); q.moveTo(-span, sag * 0.2);
          q.quadraticCurveTo(0, -9 * k - sag * 0.2, span, sag * 0.2);
          q.quadraticCurveTo(span * 0.9, 3 + sag * 0.2, span * 0.82, 3.2);
          q.quadraticCurveTo(0, -4 * k + 3, -span * 0.82, 3.2);
          q.quadraticCurveTo(-span * 0.9, 3 + sag * 0.2, -span, sag * 0.2); q.closePath();
        };
        const cg = ctx.createLinearGradient(-span, -8, span * 0.6, 4);
        cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.45, '#bfe9ff'); cg.addColorStop(1, '#5c87ad');
        ctx.globalAlpha *= ex;
        shape(ctx, path, cg, KEY_X * Math.sign(M.xf.a), KEY_Y, (q) => {
          q.strokeStyle = 'rgba(40,60,90,0.45)'; q.lineWidth = 0.6;
          for (let i = -3; i <= 3; i++) { const x = i / 3.5 * span; q.beginPath(); q.moveTo(x, -12); q.lineTo(x * 0.9, 6); q.stroke(); }
          q.fillStyle = '#e2712d'; q.beginPath(); q.moveTo(-span, sag * 0.2); q.quadraticCurveTo(0, -9 * k - sag * 0.2, span, sag * 0.2);
          q.quadraticCurveTo(0, -9 * k - sag * 0.2 + 2.2, -span, sag * 0.2 + 1.6); q.fill();
        }, 1.1);
        glow(ctx, 0, -2, span * 0.9, BUFF.glider, 0.16 * k);
        ctx.restore();
        // wind streaks while gliding
        if (G.fx && k > 0.6 && hash1(Math.floor(t * 24)) < 0.35) {
          toWorld(M.xf, (Math.random() - 0.5) * 50, hy, _w);
          G.fx.spawn({ x: _w.x, y: _w.y, vx: -(p.vx || 0) * 0.4, vy: -20, life: 0.3, size: 1, color: '#dff6ff', gravity: 0, drag: 2, shape: 'spark' });
        }
      }
    }
    // --- jetpack: twin canisters + fuel gauge + flame when thrusting
    if (B.jet || b.jetK > 0.02) {
      ctx.save(); ctx.translate(bx, by); ctx.rotate(ang);
      const can = (x) => {
        ctx.fillStyle = C.line; G.roundRect(ctx, x - 2.4, -7.2, 4.8, 13, 2.2); ctx.fill();
        const g = ctx.createLinearGradient(x - 2, 0, x + 2, 0); g.addColorStop(0, '#5b6378'); g.addColorStop(0.45, '#c7cfdc'); g.addColorStop(1, '#444b5c');
        ctx.fillStyle = g; G.roundRect(ctx, x - 1.7, -6.5, 3.4, 11.6, 1.6); ctx.fill();
        ctx.fillStyle = '#e2712d'; ctx.fillRect(x - 1.7, -3.2, 3.4, 1.3);
        ctx.fillStyle = '#2a2f3b'; ctx.fillRect(x - 1.3, 5, 2.6, 2.2);
      };
      can(-2.8); can(0.6);
      const fuel = B.jet ? clamp(B.jet.fuel / 3, 0, 1) : 0;
      ctx.fillStyle = '#10131a'; ctx.fillRect(2.6, -5.5, 1.4, 9);
      ctx.fillStyle = fuel > 0.3 ? '#7dffb0' : '#ff5a4a'; ctx.fillRect(2.8, -5.3 + 8.6 * (1 - fuel), 1, 8.6 * fuel);
      const fk = b.jetK;
      if (fk > 0.02) {
        for (const x of [-2.8, 0.6]) {
          const L = (9 + 5 * hash1(Math.floor(t * 40) + x)) * fk;
          const fg = ctx.createLinearGradient(0, 7, 0, 7 + L);
          fg.addColorStop(0, 'rgba(255,255,240,0.95)'); fg.addColorStop(0.25, 'rgba(255,200,90,0.9)'); fg.addColorStop(0.7, 'rgba(255,90,40,0.55)'); fg.addColorStop(1, 'rgba(255,60,30,0)');
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = fg;
          ctx.beginPath(); ctx.moveTo(x - 1.5, 7); ctx.quadraticCurveTo(x - 2.2, 7 + L * 0.4, x, 7 + L); ctx.quadraticCurveTo(x + 2.2, 7 + L * 0.4, x + 1.5, 7); ctx.closePath(); ctx.fill();
          ctx.restore();
          glow(ctx, x, 9, 9 * fk, BUFF.jet, 0.55 * fk);
        }
        if (G.fx && hash1(Math.floor(t * 30)) < 0.6) {
          toWorld(M.xf, bx, by + 10, _w);
          G.fx.spawn({ x: _w.x + (Math.random() - 0.5) * 4, y: _w.y, vx: (Math.random() - 0.5) * 30, vy: 140 + Math.random() * 80, life: 0.28, size: 1.6 + Math.random(), color: Math.random() < 0.5 ? '#ffb347' : '#ff7a3a', gravity: -100, drag: 3, glow: true, shape: 'circle', fade: true });
        }
      }
      ctx.restore();
    }
  }

  /** Things over her body. Local skeleton space (applyXf set). */
  function drawBuffsFrontLocal(ctx, M, p, t, B, b) {
    const S = M.S;
    if (B.boots) {
      const ex = expiring(B.boots.t, t), pulse = 0.55 + 0.25 * Math.sin(t * 6);
      for (const [a, near] of [[S.ankF, false], [S.ankN, true]]) {
        glow(ctx, a.x + 1, a.y + 1, 7, BUFF.boots, pulse * ex * (near ? 0.8 : 0.5));
        ctx.save(); ctx.translate(a.x - 2.2, a.y - 0.6);
        ctx.fillStyle = near ? '#ffe14a' : '#b89a2a'; ctx.strokeStyle = C.line; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-3.4, -2.6); ctx.lineTo(-1.6, -0.2); ctx.lineTo(-3.8, 0.4); ctx.lineTo(0, 1.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** World-space overlays: shield bubble, boots ring, slowmo aura. */
  function drawBuffsWorld(ctx, M, p, t, B, b) {
    const cx = M.xf.fx, cy = M.xf.fy - 21;
    // boots double-jump ring
    const rk = (t - b.ringT) / 0.35;
    if (rk >= 0 && rk < 1) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${BUFF.boots},${0.9 * (1 - rk)})`; ctx.lineWidth = 2 * (1 - rk) + 0.5;
      ctx.beginPath(); ctx.ellipse(cx, M.xf.fy + 2, 6 + 16 * easeOutCubic(rk), 2 + 4 * easeOutCubic(rk), 0, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // slow-motion aura: clock ticks at her feet + violet halo
    if (B.slow) {
      const ex = expiring(B.slow.t, t);
      glow(ctx, cx, cy, 30, BUFF.slow, 0.18 * ex);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${BUFF.slow},${0.55 * ex})`; ctx.lineWidth = 0.9;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU + t * 0.4;
        const r0 = 15, r1 = i % 3 === 0 ? 19 : 17;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, M.xf.fy + Math.sin(a) * r0 * 0.24); ctx.lineTo(cx + Math.cos(a) * r1, M.xf.fy + Math.sin(a) * r1 * 0.24); ctx.stroke();
      }
      ctx.restore();
    }
    // shield bubble
    if (b.shieldK > 0.02) {
      const k = b.shieldK, ex = B.shield ? expiring(B.shield.t, t) : 1;
      const hitK = clamp(1 - (t - b.hitT) / 0.4, 0, 1);
      const R = 25 + Math.sin(t * 3) * 0.6 + hitK * 4;
      const a = k * ex;
      ctx.save();
      const bg = ctx.createRadialGradient(cx - 6, cy - 8, 2, cx, cy, R);
      bg.addColorStop(0, `rgba(${BUFF.shield},0)`); bg.addColorStop(0.75, `rgba(${BUFF.shield},${0.08 * a})`); bg.addColorStop(1, `rgba(${BUFF.shield},${0.3 * a + 0.4 * hitK})`);
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      // hex lattice drifting over the surface
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
      ctx.strokeStyle = `rgba(${BUFF.shield},${(0.16 + 0.5 * hitK) * a})`; ctx.lineWidth = 0.6;
      const off = (t * 4) % 9;
      for (let row = -4; row <= 4; row++) for (let q = -4; q <= 4; q++) {
        const hx = cx + q * 9 + (row & 1) * 4.5 - off * 0.3, hy = cy + row * 7.8;
        const dd = Math.hypot(hx - cx, hy - cy) / R; if (dd > 1.05) continue;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const aa = i / 6 * TAU + Math.PI / 6; ctx.lineTo(hx + Math.cos(aa) * 4.4 * (0.6 + 0.4 * dd), hy + Math.sin(aa) * 4.4 * (0.6 + 0.4 * dd)); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = `rgba(${BUFF.shield},${0.6 * a + 0.4 * hitK})`; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(235,248,255,${0.7 * a})`; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, R - 3, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
      // remaining hits as pips on the crown of the bubble
      const hits = B.shield ? Math.min(5, Math.round(B.shield.hits)) : 0;
      for (let i = 0; i < hits; i++) {
        const px = cx + (i - (hits - 1) / 2) * 5, py = cy - R - 1;
        ctx.fillStyle = `rgba(${BUFF.shield},${0.95 * a})`;
        ctx.beginPath(); ctx.moveTo(px, py - 2.2); ctx.lineTo(px + 1.8, py); ctx.lineTo(px, py + 2.2); ctx.lineTo(px - 1.8, py); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Slow-motion after-images (violet) at recently sampled positions. */
  function drawSlowGhosts(ctx, M, p, t, b) {
    if (!b.hist.length) return;
    const { pw, ph } = renderOffscreen(ctx, M, p, t, '#b38bff', 0.85);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < b.hist.length; i++) {
      const h = b.hist[i];
      if (Math.hypot(h.x - M.xf.fx, h.y - M.xf.fy) < 1.5) continue;
      ctx.globalAlpha = 0.12 + 0.1 * i / b.hist.length;
      ctx.drawImage(oc, 0, 0, pw, ph, h.x - OCX, h.y - OCY, OCW, OCH);
    }
    ctx.restore();
  }

  /** Hit flash: tinted silhouette over the body at the start of the i-frames. */
  function drawHurtFlash(ctx, M, p, t, k) {
    const { pw, ph } = renderOffscreen(ctx, M, p, t, BUFF.hurt, 1);
    ctx.save(); ctx.globalAlpha = 0.85 * k;
    ctx.drawImage(oc, 0, 0, pw, ph, M.xf.fx - OCX, M.xf.fy - OCY, OCW, OCH);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * k;
    ctx.drawImage(oc, 0, 0, pw, ph, M.xf.fx - OCX, M.xf.fy - OCY, OCW, OCH);
    ctx.restore();
  }

  // ================================================================== РЕКС (companion / npc)
  // Big gruff survivor from an older «Ковчег-7» wreck: faded, patched pre-standard flight suit,
  // heavy build, beard, scars, aviator goggles, oxygen bottle on his back and a mechanical brace on
  // his left (near) forearm. Same skeleton approach as Mira (IK limbs, low-passed pose) but chunkier.
  const RX = {
    suit: ['#3e2a1e', '#74513a', '#a27a58'], suitFar: ['#2a1d15', '#4b3527', '#644836'],
    panel: ['#1d2427', '#36403f', '#58635f'], panelFar: ['#141a1c', '#232b2b', '#36403f'],
    patch: '#5d6534', patch2: '#7d5c2c', tape: '#8f8d84',
    skin: ['#7a4733', '#b07656', '#d49b77'], beard: ['#241c17', '#4a3c31', '#857261'],
    steel: ['#2a2e33', '#6a737d', '#bcc4cc'], boot: ['#121316', '#2b2c30', '#4d4e54'],
    amber: '#e8a15a', amberRGB: '232,161,90',
  };
  const RSEG = {
    thighN: { w: 7.6, pal: RX.suit }, shinN: { w: 6.4, pal: RX.panel },
    thighF: { w: 7.2, pal: RX.suitFar }, shinF: { w: 6.0, pal: RX.panelFar },
    uarmN: { w: 6.8, pal: RX.suit }, farmN: { w: 6.0, pal: RX.suit },
    uarmF: { w: 6.4, pal: RX.suitFar }, farmF: { w: 5.6, pal: RX.suitFar },
  };
  const RL = { thigh: 12.6, shin: 12.4, torso: 19, uarm: 11.2, farm: 11 };
  const RKEYS = ['hx', 'hy', 'lean', 'head', 'fnx', 'fny', 'ffx', 'ffy', 'hnx', 'hny', 'hfx', 'hfy'];
  const REX_IDLE = { hx: 0, hy: -24.2, lean: 0.07, head: 0, fnx: 4, fny: 0, ffx: -4.5, ffy: 0, hnx: 2.6, hny: 20.5, hfx: -1.6, hfy: 20.5 };
  const REX_POSE = {
    npc: { hx: -0.8, hy: -24.4, lean: -0.04, head: -0.05, fnx: 5.5, fny: 0, ffx: -5, ffy: 0, hnx: 7.5, hny: 9, hfx: 6.5, hfy: 7.5 },
    helpWind: { hx: -1, hy: -18.5, lean: 0.45, head: 0.12, fnx: 8, fny: 0, ffx: -7, ffy: 0, hnx: 9, hny: 15.5, hfx: 8, hfy: 16 },
    helpHeave: { hx: 1, hy: -26, lean: -0.14, head: -0.3, fnx: 6, fny: 0, ffx: -5, ffy: -1.5, hnx: 6, hny: -17.5, hfx: 4.5, hfy: -18 },
    throwWind: { hx: -2, hy: -23, lean: -0.34, head: -0.12, fnx: 8.5, fny: 0, ffx: -7, ffy: 0, hnx: -7, hny: -15, hfx: -9, hfy: -13 },
    throwRel: { hx: 2.5, hy: -21, lean: 0.52, head: 0.22, fnx: 9, fny: 0, ffx: -7.5, ffy: -1.5, hnx: 17, hny: 5, hfx: 16, hfy: 7.5 },
    down: { hx: -1, hy: -13.5, lean: 0.4, head: 0.42, fnx: 8, fny: 0, ffx: -11.5, ffy: -1, hnx: 2.5, hny: 18.5, hfx: 6, hfy: 21 },
  };
  const REX_MOOD = { // in-world acting for npc talk lines: brow, head tilt, gesture energy
    neutral: { brow: 0, tilt: 0, gest: 0.6 }, happy: { brow: -0.6, tilt: -0.06, gest: 0.8 }, sad: { brow: -0.4, tilt: 0.22, gest: 0.2 },
    angry: { brow: 1, tilt: 0.05, gest: 1.2 }, scared: { brow: -1, tilt: -0.08, gest: 0.9 }, surprised: { brow: -1, tilt: -0.12, gest: 0.7 },
    thinking: { brow: 0.3, tilt: 0.14, gest: 0.1 }, determined: { brow: 0.8, tilt: 0.04, gest: 0.9 },
  };
  const rmem = new WeakMap();
  const mix = (T, P2, k) => { if (k <= 0) return; for (const key of RKEYS) T[key] = lerp(T[key], P2[key], k); };

  /** Feet point of a companion (rect actors: bottom-centre; otherwise x,y is the feet). */
  function feetOf(c) {
    if (c.w != null && c.h != null) return [num(c.x, 0) + num(c.w, 0) / 2, num(c.y, 0) + num(c.h, 0)];
    return [num(c.x, 0), num(c.y, 0)];
  }
  function rexMode(c) {
    const s = c.state || 'idle';
    if (s === 'down' || s === 'help' || s === 'throw') return s;
    const air = c.onGround === false || (c.onGround == null && Math.abs(num(c.vy, 0)) > 60);
    if (air) return 'jump';
    if (Math.abs(num(c.vx, 0)) > 14) return 'run';
    return c.npc ? 'npc' : 'idle';
  }
  function newRexMem(c, t) {
    const P = Object.assign({}, REX_IDLE);
    return { t, P, T: Object.assign({}, REX_IDLE), phase: 0, mode: rexMode(c), modeT: t, face: c.facing < 0 ? -1 : 1, turn: 0,
      blinkAt: t + 2, blinkN: 0, relFx: false, landT: -9, air: false, talk: 0, gest: 0, sparkT: t };
  }
  function rexUpdate(M, c, t) {
    let dt = t - M.t; if (dt < -0.001 || dt > 1) dt = 0; dt = Math.min(dt, 0.1); M.t = t;
    const mode = rexMode(c);
    if (mode !== M.mode) {
      if (M.mode === 'jump' && mode !== 'jump') { M.landT = t; }
      M.mode = mode; M.modeT = t; M.relFx = false;
    }
    const st = t - M.modeT;
    const face = num(c.facing, M.face) < 0 ? -1 : 1;
    if (face !== M.face) { M.face = face; M.turn = 1; }
    M.turn = Math.max(0, M.turn - dt * 7);
    M.phase += Math.abs(num(c.vx, 0)) * dt / 40 * TAU;
    M.talk += ((c.talking ? 1 : 0) - M.talk) * (1 - Math.exp(-8 * dt));
    if (t > M.blinkAt + 0.15) { M.blinkN++; M.blinkAt = t + 2.2 + hash1(M.blinkN * 3.3) * 3; }
    // target pose
    const T = M.T; Object.assign(T, REX_IDLE);
    const br = Math.sin(t * 1.7);
    T.hy += br * 0.35;
    let rate = 12;
    if (mode === 'npc') { Object.assign(T, REX_POSE.npc); T.hy += br * 0.35; }
    else if (mode === 'run') {
      const s = clamp(Math.abs(num(c.vx, 0)) / 150, 0.25, 1), ph = M.phase;
      T.lean = 0.12 + 0.16 * s;
      T.hy = -24.2 + s * (0.4 - 1.8 * Math.abs(Math.sin(ph)));
      T.fnx = 1 - Math.cos(ph) * 9 * s; T.fny = -Math.max(0, Math.sin(ph)) * 6.5 * s;
      T.ffx = -1 + Math.cos(ph) * 9 * s; T.ffy = -Math.max(0, -Math.sin(ph)) * 6.5 * s;
      T.hnx = 3 + Math.cos(ph) * 8 * s; T.hny = 18.5 - Math.abs(Math.cos(ph)) * 2.5 * s;
      T.hfx = 1 - Math.cos(ph) * 8 * s; T.hfy = 18.5 - Math.abs(Math.cos(ph)) * 2.5 * s;
      T.head = -0.04 * s; rate = 26;
    } else if (mode === 'jump') {
      const up = num(c.vy, 0) < 0;
      if (up) Object.assign(T, { hy: -26, lean: 0.04, fnx: 6.5, fny: -8, ffx: -3, ffy: -5, hnx: 10, hny: -3, hfx: -7, hfy: 3, head: -0.12 });
      else Object.assign(T, { hy: -25, lean: 0.12, fnx: 5, fny: -2.5, ffx: -5.5, ffy: -1, hnx: 11, hny: 5, hfx: -9, hfy: 7, head: 0.05 });
      rate = 16;
    } else if (mode === 'help') {
      mix(T, REX_POSE.helpWind, easeOutCubic(clamp(st / 0.24, 0, 1)));
      mix(T, REX_POSE.helpHeave, sstep(0.3, 0.42, st));
      mix(T, REX_IDLE, sstep(0.75, 1.15, st));
      rate = 28;
    } else if (mode === 'throw') {
      mix(T, REX_POSE.throwWind, easeOutCubic(clamp(st / 0.26, 0, 1)));
      mix(T, REX_POSE.throwRel, sstep(0.28, 0.38, st));
      mix(T, REX_IDLE, sstep(0.7, 1.05, st));
      rate = 28;
    } else if (mode === 'down') {
      Object.assign(T, REX_POSE.down);
      const hb = Math.sin(t * 3.2);
      T.hy += hb * 0.5; T.lean += hb * 0.03; T.head += Math.sin(t * 0.7) * 0.06;
      rate = st < 0.4 ? 9 : 6;
    }
    // landing squash
    const lk = clamp(1 - (t - M.landT) / 0.25, 0, 1);
    if (mode !== 'jump' && lk > 0) { T.hy += 3.5 * Math.sin(lk * Math.PI); T.lean += 0.08 * lk; }
    // talking / acting (overrides the near arm)
    const mood = REX_MOOD[c.talkMood] || REX_MOOD.neutral;
    if (M.talk > 0.01 && (mode === 'idle' || mode === 'npc')) {
      const g = M.talk * mood.gest * (0.45 + 0.55 * Math.max(0, Math.sin(t * 1.9)));
      T.hnx = lerp(T.hnx, 11 + Math.sin(t * 2.3) * 2, clamp(g, 0, 1));
      T.hny = lerp(T.hny, 4 + Math.sin(t * 4.1) * 2.5 - g * 3, clamp(g, 0, 1));
      T.head += mood.tilt * M.talk + Math.sin(t * 6.3) * 0.05 * M.talk;
      T.lean += 0.04 * Math.sin(t * 1.3) * M.talk;
    }
    const k = 1 - Math.exp(-rate * dt);
    for (const key of RKEYS) M.P[key] += (T[key] - M.P[key]) * k;
    return { mode, st };
  }

  function rexBoot(ctx, a, lx, ly, far) {
    ctx.save(); ctx.translate(a.x, a.y);
    const path = (q) => { q.beginPath(); q.moveTo(-3.2, -3.6); q.lineTo(2, -3.6); q.quadraticCurveTo(2.8, -1.6, 6, -1.2); q.quadraticCurveTo(7.8, -0.6, 7.6, 1.4); q.lineTo(7.5, 2.6); q.lineTo(-3.8, 2.6); q.quadraticCurveTo(-4.2, -0.4, -3.2, -3.6); q.closePath(); };
    shape(ctx, path, far ? RX.boot[0] : RX.boot[1], lx, ly, (q) => {
      q.fillStyle = '#0b0c0e'; q.fillRect(-4.5, 1.2, 13, 1.6);
      q.fillStyle = far ? '#3a3226' : '#5a4a36'; q.fillRect(-3.6, -3.6, 5.8, 1.4);  // worn leather cuff
      q.strokeStyle = 'rgba(200,200,190,0.35)'; q.lineWidth = 0.4; q.beginPath(); q.moveTo(0.5, -2); q.lineTo(3.5, -1.2); q.stroke();
    }, 1.2);
    ctx.restore();
  }
  function rexGlove(ctx, h, far, metal) {
    ctx.beginPath(); ctx.arc(h.x, h.y, 3.1, 0, TAU);
    ctx.fillStyle = C.line; ctx.fill();
    ctx.beginPath(); ctx.arc(h.x, h.y, 2.4, 0, TAU);
    ctx.fillStyle = far ? '#2c2622' : '#4a3d33'; ctx.fill();
    if (metal) { ctx.fillStyle = RX.steel[1]; ctx.fillRect(h.x - 0.4, h.y - 2.6, 2.6, 1.6); ctx.fillStyle = RX.steel[2]; ctx.fillRect(h.x - 0.2, h.y - 2.5, 2.2, 0.5); }
    ctx.fillStyle = 'rgba(255,230,200,0.25)'; ctx.beginPath(); ctx.arc(h.x - 0.8, h.y - 0.9, 1, 0, TAU); ctx.fill();
  }

  function rexTorso(ctx, H, lean, lx, ly, br) {
    ctx.save(); ctx.translate(H.x, H.y); ctx.rotate(lean);
    const c = Math.cos(-lean), s = Math.sin(-lean);
    const tlx = lx * c - ly * s, tly = lx * s + ly * c;
    // oxygen bottle strapped to the back
    ctx.save(); ctx.translate(-10.2, -11); ctx.rotate(-0.12);
    ctx.fillStyle = C.line; G.roundRect(ctx, -3.6, -9, 7.2, 17, 3.2); ctx.fill();
    const bg = ctx.createLinearGradient(-3, 0, 3, 0); bg.addColorStop(0, '#2e3a3a'); bg.addColorStop(0.4, '#6d7f7b'); bg.addColorStop(1, '#263030');
    ctx.fillStyle = bg; G.roundRect(ctx, -2.8, -8.2, 5.6, 15.4, 2.6); ctx.fill();
    ctx.fillStyle = '#9a5a2a'; ctx.fillRect(-2.8, -3, 5.6, 1.4);
    ctx.fillStyle = '#7a3e1e'; ctx.fillRect(-2.8, 3, 5.6, 1);
    ctx.fillStyle = RX.steel[1]; ctx.fillRect(-1, -10.5, 2, 2.6);
    ctx.restore();
    const path = (q) => {
      q.beginPath(); q.moveTo(-6.8, 3.2);
      q.bezierCurveTo(-8.8, -4, -10, -13, -7.6, -19.6);
      q.quadraticCurveTo(-3.6, -23.6, 2, -22);
      q.bezierCurveTo(7.4, -20.6, 10, -14.5, 9.4, -9.5 + br * 0.3);
      q.quadraticCurveTo(10, -3, 7.2, 3.2); q.closePath();
    };
    const g = ctx.createLinearGradient(-8, -22, 10, 4);
    g.addColorStop(0, RX.suit[2]); g.addColorStop(0.45, RX.suit[1]); g.addColorStop(1, RX.suit[0]);
    shape(ctx, path, g, tlx, tly, (q) => {
      // old-pattern yoke (grey shoulder panel)
      q.fillStyle = RX.panel[1];
      q.beginPath(); q.moveTo(-11, -21); q.lineTo(11, -17); q.lineTo(11, -12.6); q.quadraticCurveTo(0, -15.5, -11, -15.8); q.closePath(); q.fill();
      q.fillStyle = 'rgba(255,255,255,0.12)'; q.fillRect(-10, -19.8, 20, 0.7);
      // faded reflective band
      q.strokeStyle = 'rgba(205,200,180,0.5)'; q.lineWidth = 1.4;
      q.beginPath(); q.moveTo(-10, -10.6); q.quadraticCurveTo(0, -8.8, 11, -8.2); q.stroke();
      // zipper
      q.strokeStyle = 'rgba(20,14,10,0.6)'; q.lineWidth = 0.7;
      q.beginPath(); q.moveTo(6.4, -19.5); q.quadraticCurveTo(7.4, -9, 5.6, 2.4); q.stroke();
      // patches + tape
      q.save(); q.translate(-1.6, -5); q.rotate(0.12);
      q.fillStyle = RX.patch; q.fillRect(-3, -2.5, 6.2, 5.2);
      q.strokeStyle = 'rgba(230,220,180,0.55)'; q.lineWidth = 0.35; q.setLineDash([0.8, 0.7]); q.strokeRect(-2.6, -2.1, 5.4, 4.4); q.setLineDash([]);
      q.restore();
      q.save(); q.translate(-6, -15.6); q.rotate(-0.5); q.fillStyle = RX.tape; q.fillRect(-2.6, -0.8, 5.2, 1.6); q.fillStyle = 'rgba(0,0,0,0.2)'; q.fillRect(-2.6, 0.4, 5.2, 0.4); q.restore();
      q.save(); q.translate(4.5, -1.8); q.rotate(-0.2); q.fillStyle = RX.patch2; q.fillRect(-1.8, -1.6, 3.6, 3.2); q.restore();
      // faded К-7 badge
      q.fillStyle = '#2b2622'; q.fillRect(1.4, -18.2, 4, 2.8);
      q.fillStyle = '#b5652a'; q.fillRect(1.8, -17.6, 3.2, 0.7);
      q.fillStyle = 'rgba(220,210,190,0.6)'; q.fillRect(1.8, -16.6, 1.4, 0.6);
      // tank strap across the chest
      q.strokeStyle = '#2e2219'; q.lineWidth = 1.8; q.beginPath(); q.moveTo(-9, -19); q.lineTo(9.5, -4); q.stroke();
      q.strokeStyle = '#5c4632'; q.lineWidth = 0.8; q.beginPath(); q.moveTo(-9, -19.4); q.lineTo(9.5, -4.4); q.stroke();
      q.fillStyle = RX.steel[1]; q.fillRect(3.2, -10.6, 2, 2);
      // grime + belt
      const gg = q.createLinearGradient(0, -8, 0, 4); gg.addColorStop(0, 'rgba(20,12,6,0)'); gg.addColorStop(1, 'rgba(20,12,6,0.4)');
      q.fillStyle = gg; q.fillRect(-11, -8, 22, 12);
      q.fillStyle = '#231b14'; q.fillRect(-11, -1.4, 22, 3.4);
      q.fillStyle = '#4a3a2a'; q.fillRect(-11, -1.4, 22, 0.8);
      q.fillStyle = RX.steel[1]; q.fillRect(5, -1.6, 2.8, 3.6); q.fillStyle = RX.steel[2]; q.fillRect(5.2, -1.4, 2.4, 0.6);
      q.fillStyle = '#3c3024'; q.fillRect(-6.5, -0.8, 4.6, 4.6); q.fillStyle = '#5a4734'; q.fillRect(-6.5, -0.8, 4.6, 1.2);
    }, 1.6);
    // turned-up collar
    ctx.fillStyle = C.line; ctx.beginPath(); ctx.moveTo(-3.5, -22.4); ctx.lineTo(4.6, -21.6); ctx.lineTo(4.2, -24.6); ctx.lineTo(-3, -25.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = RX.panel[2]; ctx.beginPath(); ctx.moveTo(-2.8, -22.6); ctx.lineTo(3.8, -22); ctx.lineTo(3.5, -24); ctx.lineTo(-2.4, -24.7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function rexHead(ctx, M, c, t, lx, ly, jaw, blink, browK) {
    // assumes ctx at head centre, rotated
    const skull = (q) => {
      q.beginPath(); q.moveTo(-5.4, 4.6);
      q.bezierCurveTo(-7.6, 1, -7.4, -6.2, -2.6, -8);
      q.bezierCurveTo(2, -9.2, 6.2, -7, 6.5, -3.1);
      q.lineTo(6.7, -1.7); q.lineTo(8.4, 1.4); q.quadraticCurveTo(7.8, 2.7, 6.7, 2.7);
      q.lineTo(6.5, 4.6); q.lineTo(1, 7.2); q.closePath();
    };
    const sg = ctx.createRadialGradient(2, -3, 1, 0, 0, 10);
    sg.addColorStop(0, RX.skin[2]); sg.addColorStop(0.55, RX.skin[1]); sg.addColorStop(1, RX.skin[0]);
    shape(ctx, skull, sg, lx, ly, (q) => {
      // buzz cut (salt & pepper) + grey temple
      q.fillStyle = 'rgba(40,32,28,0.78)';
      q.beginPath(); q.moveTo(-8, 0.5); q.quadraticCurveTo(-6, -3, -3, -3.6); q.lineTo(5.2, -6.6); q.lineTo(5.2, -10); q.lineTo(-8, -10); q.closePath(); q.fill();
      q.fillStyle = 'rgba(160,150,140,0.35)';
      for (let i = 0; i < 26; i++) q.fillRect(-7 + hash1(i * 3.1) * 11.5, -8.8 + hash1(i * 7.7) * 5.5, 0.45, 0.45);
      // scalp scar with stitch ticks
      q.strokeStyle = 'rgba(225,160,140,0.9)'; q.lineWidth = 0.55;
      q.beginPath(); q.moveTo(-3.6, -8.4); q.quadraticCurveTo(-1.6, -6.4, 0.6, -5.2); q.stroke();
      q.lineWidth = 0.35; q.beginPath();
      for (let i = 0; i < 4; i++) { const x = -3.1 + i * 1.1, y = -7.9 + i * 0.85; q.moveTo(x - 0.5, y + 0.6); q.lineTo(x + 0.5, y - 0.6); }
      q.stroke();
      // cheek shadow under the brow
      q.fillStyle = 'rgba(70,30,20,0.25)'; q.fillRect(1.5, -2, 6, 2.5);
    }, 1.4);
    // ear
    ctx.fillStyle = RX.skin[0]; ctx.beginPath(); ctx.ellipse(-1.8, 0.2, 1.6, 2.4, 0.1, 0, TAU); ctx.fill();
    ctx.strokeStyle = C.line; ctx.lineWidth = 0.7; ctx.stroke();
    // goggles band + lens pushed up on the forehead
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-7, -3.2); ctx.quadraticCurveTo(-1, -6.4, 5.2, -6.6); ctx.stroke();
    ctx.strokeStyle = '#4a3a2c'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.fillStyle = C.line; ctx.beginPath(); ctx.ellipse(4.6, -7, 2.5, 2, -0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#9a7a4a'; ctx.beginPath(); ctx.ellipse(4.6, -7, 1.9, 1.5, -0.2, 0, TAU); ctx.fill();
    const lg = ctx.createLinearGradient(3, -8.4, 6, -5.6); lg.addColorStop(0, '#ffe2a8'); lg.addColorStop(0.5, '#c8742c'); lg.addColorStop(1, '#3a1e0e');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.ellipse(4.7, -7, 1.3, 1.05, -0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(3.9, -7.7, 0.6, 0.5);
    // eye under a heavy brow
    const open = 1 - blink;
    ctx.fillStyle = '#e8ddd0'; ctx.beginPath(); ctx.ellipse(4.5, -1.3, 1.25, 0.85 * open + 0.05, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1410'; ctx.beginPath(); ctx.ellipse(5, -1.3, 0.6, 0.7 * open + 0.05, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = RX.beard[0]; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(2.6, -3.1 - browK * 0.2); ctx.lineTo(6.5, -2.6 + browK * 0.9); ctx.stroke();
    // facial scar through the eye
    ctx.strokeStyle = 'rgba(230,165,145,0.95)'; ctx.lineWidth = 0.55;
    ctx.beginPath(); ctx.moveTo(3.4, -5.2); ctx.lineTo(4.2, -2.8); ctx.moveTo(4.8, 0); ctx.lineTo(5.8, 2.4); ctx.stroke();
    // beard (jaw drops while talking) + moustache
    const beard = (q) => {
      q.beginPath(); q.moveTo(6.8, 2.2);
      q.quadraticCurveTo(7.8, 5 + jaw, 5.8, 8.4 + jaw);
      q.quadraticCurveTo(2.6, 11.2 + jaw, -0.6, 8.8 + jaw * 0.5);
      q.quadraticCurveTo(-3.4, 6.6, -3.8, 1.6);
      q.quadraticCurveTo(-1.6, 3.2, 0.8, 2.6);
      q.quadraticCurveTo(3, 2.4, 4.4, 1.8); q.closePath();
    };
    const bgd = ctx.createLinearGradient(-2, 1, 6, 10);
    bgd.addColorStop(0, RX.beard[2]); bgd.addColorStop(0.5, RX.beard[1]); bgd.addColorStop(1, RX.beard[0]);
    shape(ctx, beard, bgd, lx, ly, (q) => {
      q.strokeStyle = 'rgba(200,190,175,0.35)'; q.lineWidth = 0.4;
      for (let i = 0; i < 7; i++) { const x = -2 + i * 1.2; q.beginPath(); q.moveTo(x, 3 + (i % 2)); q.lineTo(x + 0.6, 7.5 + jaw * 0.7 - Math.abs(i - 4) * 0.4); q.stroke(); }
    }, 1.2, 'rgba(255,230,200,0.5)');
    if (jaw > 0.15) {
      ctx.fillStyle = '#1d0e0a'; ctx.beginPath(); ctx.ellipse(5.4, 4.4 + jaw * 0.45, 1.3, 0.35 + jaw * 0.7, 0.15, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = RX.beard[1]; ctx.strokeStyle = C.line; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(3.8, 2.2); ctx.quadraticCurveTo(6, 1.6, 7.6, 2.6); ctx.quadraticCurveTo(7.4, 4, 6.2, 3.8); ctx.quadraticCurveTo(4.8, 3.4, 3.8, 3.6); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  const _rs = { H: V(), sh: V(), shN: V(), shF: V(), hipN: V(), hipF: V(), kN: V(), aN: V(), kF: V(), aF: V(), eN: V(), hN: V(), eF: V(), hF: V(), neck: V(), head: V() };
  /** Draw Рекс's body at the local origin (feet), facing +x. */
  function rexBody(ctx, M, c, t, mode, st) {
    const P = M.P, R = _rs;
    const lx = KEY_X * M.face, ly = KEY_Y;
    const br = Math.sin(t * 1.7);
    R.H.x = P.hx; R.H.y = P.hy;
    const sl = Math.sin(P.lean), cl = Math.cos(P.lean);
    R.sh.x = R.H.x + sl * RL.torso; R.sh.y = R.H.y - cl * RL.torso;
    R.shN.x = R.sh.x + 1.2 * cl; R.shN.y = R.sh.y + 1.6 + 1.2 * sl;
    R.shF.x = R.sh.x - 2.6 * cl; R.shF.y = R.sh.y + 0.4 - 2.6 * sl;
    R.hipN.x = R.H.x + 1.6; R.hipN.y = R.H.y; R.hipF.x = R.H.x - 1.6; R.hipF.y = R.H.y - 0.6;
    ik(R.hipF, P.ffx, P.ffy - 2.6, RL.thigh, RL.shin, -1, R.kF, R.aF);
    ik(R.hipN, P.fnx, P.fny - 2.6, RL.thigh, RL.shin, -1, R.kN, R.aN);
    ik(R.shF, R.shF.x + P.hfx, R.shF.y + P.hfy, RL.uarm, RL.farm, 1, R.eF, R.hF);
    ik(R.shN, R.shN.x + P.hnx, R.shN.y + P.hny, RL.uarm, RL.farm, 1, R.eN, R.hN);
    // far arm + far leg
    limb(ctx, [R.shF, R.eF, R.hF], [RSEG.uarmF, RSEG.farmF], lx, ly);
    band(ctx, R.eF, R.hF, 0.78, 0.92, RSEG.farmF.w * 0.95, '#2c2622');
    rexGlove(ctx, R.hF, true, false);
    limb(ctx, [R.hipF, R.kF, R.aF], [RSEG.thighF, RSEG.shinF], lx, ly);
    rexBoot(ctx, R.aF, lx, ly, true);
    // near leg
    limb(ctx, [R.hipN, R.kN, R.aN], [RSEG.thighN, RSEG.shinN], lx, ly);
    ctx.save(); ctx.translate(R.kN.x + 0.6, R.kN.y); ctx.rotate(Math.atan2(R.aN.y - R.kN.y, R.aN.x - R.kN.x) - Math.PI / 2);
    ctx.fillStyle = C.line; G.roundRect(ctx, -3.2, -2.2, 6.4, 5, 1.6); ctx.fill();
    ctx.fillStyle = RX.patch; G.roundRect(ctx, -2.6, -1.6, 5.2, 3.8, 1.2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-2.2, -1.4, 4.4, 0.6);
    ctx.restore();
    band(ctx, R.kN, R.aN, 0.55, 0.62, RSEG.shinN.w * 0.95, 'rgba(200,195,175,0.55)');
    rexBoot(ctx, R.aN, lx, ly, false);
    // torso, neck, head
    rexTorso(ctx, R.H, P.lean, lx, ly, br);
    R.neck.x = R.sh.x + sl * 2 + 2.2; R.neck.y = R.sh.y - cl * 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.line; ctx.lineWidth = 7.4; ctx.beginPath(); ctx.moveTo(R.sh.x + 1, R.sh.y + 1); ctx.lineTo(R.neck.x, R.neck.y - 2); ctx.stroke();
    ctx.strokeStyle = RX.skin[0]; ctx.lineWidth = 5.8; ctx.stroke();
    const ha = P.lean * 0.45 + P.head;
    ctx.save(); ctx.translate(R.neck.x + Math.sin(ha) * 6.4, R.neck.y - Math.cos(ha) * 6.4); ctx.rotate(ha);
    const syl = c.talking ? Math.abs(Math.sin(t * 11) * Math.sin(t * 3.9 + 0.7)) : 0;
    const mood = REX_MOOD[c.talkMood] || REX_MOOD.neutral;
    const bl = t > M.blinkAt && t < M.blinkAt + 0.15 ? Math.sin((t - M.blinkAt) / 0.15 * Math.PI) : 0;
    const browK = mode === 'down' ? -0.6 : mode === 'help' || mode === 'throw' ? 1 : mood.brow * M.talk + (c.npc && !c.talking ? 0.4 : 0);
    rexHead(ctx, M, c, t, lx, ly, syl * 1.6 + (mode === 'throw' && st > 0.26 && st < 0.6 ? 1.2 : 0), mode === 'down' ? 0.55 + 0.45 * bl : bl, browK);
    ctx.restore();
    // near arm: sleeve + mechanical brace over the forearm
    limb(ctx, [R.shN, R.eN, R.hN], [RSEG.uarmN, RSEG.farmN], lx, ly);
    const dx = R.hN.x - R.eN.x, dy = R.hN.y - R.eN.y, dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
    band(ctx, R.eN, R.hN, 0.12, 0.88, RSEG.farmN.w * 0.9, RX.steel[0]);
    band(ctx, R.eN, R.hN, 0.16, 0.84, RSEG.farmN.w * 0.62, RX.steel[1]);
    for (const f of [0.22, 0.5, 0.78]) band(ctx, R.eN, R.hN, f, f + 0.06, RSEG.farmN.w * 1.0, RX.steel[0]);
    // piston rod + highlight
    ctx.strokeStyle = RX.steel[2]; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(R.eN.x + nx * 2.4 + dx * 0.1, R.eN.y + ny * 2.4 + dy * 0.1); ctx.lineTo(R.eN.x + nx * 2.4 + dx * 0.7, R.eN.y + ny * 2.4 + dy * 0.7); ctx.stroke();
    // elbow hinge with amber status LED
    ctx.fillStyle = C.line; ctx.beginPath(); ctx.arc(R.eN.x, R.eN.y, 2.8, 0, TAU); ctx.fill();
    ctx.fillStyle = RX.steel[1]; ctx.beginPath(); ctx.arc(R.eN.x, R.eN.y, 2.1, 0, TAU); ctx.fill();
    ctx.fillStyle = RX.steel[0]; ctx.beginPath(); ctx.arc(R.eN.x, R.eN.y, 0.8, 0, TAU); ctx.fill();
    const led = mode === 'down' ? (hash1(Math.floor(t * 7)) < 0.4 ? 1 : 0.15) : 0.7 + 0.3 * Math.sin(t * 2.5);
    const lpx = lerp(R.eN.x, R.hN.x, 0.36) - nx * 1, lpy = lerp(R.eN.y, R.hN.y, 0.36) - ny * 1;
    ctx.fillStyle = mode === 'down' ? '#ff5a3a' : RX.amber; ctx.globalAlpha = led; ctx.fillRect(lpx - 0.6, lpy - 0.6, 1.3, 1.3); ctx.globalAlpha = 1;
    glow(ctx, lpx, lpy, 4, mode === 'down' ? '255,90,58' : RX.amberRGB, 0.5 * led);
    rexGlove(ctx, R.hN, false, true);
    return R;
  }

  function drawRex(ctx, c, t) {
    let M = rmem.get(c);
    if (!M || t < M.t - 0.001) { M = newRexMem(c, t); rmem.set(c, M); }
    const { mode, st } = rexUpdate(M, c, t);
    const [fx, fy] = feetOf(c);
    const controlled = c.state === 'controlled' || (G.game && G.game.controlled === c && c !== (G.game && G.game.player));
    // contact shadow + controlled ring (behind)
    if (mode !== 'jump') {
      const sg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 15);
      sg.addColorStop(0, 'rgba(0,0,0,0.38)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(fx + 1.5, fy); ctx.scale(1, 0.24); ctx.fillStyle = sg; ctx.fillRect(-15, -15, 30, 30); ctx.restore();
    }
    if (controlled) {
      const pu = 0.5 + 0.5 * Math.sin(t * 3.4);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(${RX.amberRGB},${0.35 + 0.25 * pu})`; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.ellipse(fx, fy + 0.5, 17, 4.2, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = `rgba(${RX.amberRGB},${0.6 + 0.3 * pu})`; ctx.lineWidth = 1.6;
      for (let i = 0; i < 3; i++) { const a = t * 1.2 + i / 3 * TAU; ctx.beginPath(); ctx.ellipse(fx, fy + 0.5, 17, 4.2, 0, a, a + 0.7); ctx.stroke(); }
      ctx.restore();
    }
    const blinkA = num(c.iframes, 0) > 0 && Math.floor(t * 16) % 2 ? 0.4 : 1;
    ctx.save();
    ctx.globalAlpha *= blinkA;
    ctx.translate(fx, fy);
    const sq = M.turn;
    ctx.scale(M.face * (1 - 0.12 * sq), 1);
    const R = rexBody(ctx, M, c, t, mode, st);
    // throw / heave release: motion arc in front of his hands
    const rel = mode === 'help' ? 0.3 : mode === 'throw' ? 0.28 : -1;
    if (rel > 0) {
      const k = (st - rel) / 0.2;
      if (k > 0 && k < 1) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255,236,205,${0.55 * (1 - k)})`; ctx.lineWidth = 2.4 * (1 - k) + 0.5; ctx.lineCap = 'round';
        ctx.beginPath();
        if (mode === 'help') ctx.arc(R.sh.x + 2, R.sh.y + 4, 20, 0.9 - k * 0.4, -1.2 - k * 0.4, true);
        else ctx.arc(R.sh.x - 2, R.sh.y + 2, 20, -2.2 + k * 0.6, 0.4 + k * 0.6);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      if (st > rel && !M.relFx && G.fx) {
        M.relFx = true;
        G.fx.dust && G.fx.dust(fx, fy, 6);
        G.fx.burst(fx + M.face * 14, fy - 30, { count: 8, color: ['#fff2d8', '#e8a15a'], speed: 140, life: 0.28, size: 1.4, gravity: 0, drag: 5, glow: true, shape: 'spark', angle: M.face > 0 ? -0.6 : Math.PI + 0.6, spread: 1.2 });
      }
    }
    ctx.restore();
    // down: brace sparks + hurt glow
    if (mode === 'down') {
      glow(ctx, fx, fy - 18, 26, '255,70,50', 0.12 + 0.06 * Math.sin(t * 3.2));
      if (G.fx && t - M.sparkT > 0.4 && hash1(Math.floor(t * 5)) < 0.5) {
        M.sparkT = t;
        G.fx.burst(fx + M.face * (R.eN.x), fy + R.eN.y, { count: 3, color: ['#ffd27a', '#ffffff'], speed: 70, life: 0.25, size: 1.2, gravity: 500, glow: true, shape: 'spark' });
      }
    }
    // controlled marker: a small amber chevron over his head
    if (controlled) {
      const hy = fy + R.sh.y - 22 + Math.sin(t * 3) * 1.5;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, fx, hy, 8, RX.amberRGB, 0.35);
      ctx.fillStyle = `rgba(${RX.amberRGB},0.9)`;
      ctx.beginPath(); ctx.moveTo(fx - 3.4, hy - 2); ctx.lineTo(fx, hy + 1.8); ctx.lineTo(fx + 3.4, hy - 2); ctx.lineTo(fx, hy - 0.4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- ЛЮМ as a party member
  const LUM_RGB = '95,244,230';
  const lproxy = new WeakMap();
  const pclock = new WeakMap();
  /** Seconds since c.state last changed (own clock; never trusts engine timers). */
  function stateClock(c, t) {
    let m = pclock.get(c);
    if (!m || m.s !== c.state || t < m.t - 0.01) { m = { s: c.state, t: m ? t : t - 9 }; pclock.set(c, m); }
    return t - m.t;
  }
  function drawLumMember(ctx, c, t) {
    if (!G.Art.Drone || !G.Art.Drone.draw) return;
    const st = stateClock(c, t);
    const native = c.state === 'follow' || c.state === 'broken' || c.state === 'waking' || c.state == null;
    let d = c;
    if (!native) {
      d = lproxy.get(c);
      if (!d) { d = {}; lproxy.set(c, d); }
      Object.assign(d, c);
      d.state = c.state === 'down' ? 'broken' : 'follow';
      d.stateTime = st; d.mood = c.mood || (c.state === 'help' ? 'alert' : 'neutral');
    }
    let cx = num(c.x, 0), cy = num(c.y, 0);
    if (c.cx != null) { cx = c.cx; cy = num(c.cy, cy); }
    const controlled = c.state === 'controlled' || (G.game && G.game.controlled === c);
    if (controlled) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, cx, cy, 22, LUM_RGB, 0.18);
      ctx.strokeStyle = `rgba(${LUM_RGB},0.55)`; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const a = -t * 1.6 + i / 4 * TAU; ctx.beginPath(); ctx.arc(cx, cy, 15, a, a + 0.9); ctx.stroke(); }
      ctx.restore();
    }
    G.Art.Drone.draw(ctx, d, t);
    if (c.state === 'help') {
      const R = 3 * (G.TILE || 32);
      const k = clamp(st / 0.5, 0, 1);
      if (k < 1) {
        const e = easeOutCubic(k);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const fg = ctx.createRadialGradient(cx, cy, R * e * 0.6, cx, cy, R * e);
        fg.addColorStop(0, `rgba(${LUM_RGB},0)`); fg.addColorStop(1, `rgba(${LUM_RGB},${0.22 * (1 - k)})`);
        ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(cx, cy, R * e + 0.1, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(${LUM_RGB},${0.9 * (1 - k)})`; ctx.lineWidth = 2.2 * (1 - k) + 0.6;
        ctx.beginPath(); ctx.arc(cx, cy, R * e, 0, TAU); ctx.stroke();
        ctx.strokeStyle = `rgba(220,255,250,${0.6 * (1 - k)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, R * e * 0.72, 0, TAU); ctx.stroke();
        // radial zap ticks
        ctx.strokeStyle = `rgba(${LUM_RGB},${0.7 * (1 - k)})`;
        for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + hash1(i) * 0.3; const r0 = R * e * 0.82, r1 = R * e * (0.92 + 0.08 * hash1(i + Math.floor(t * 20))); ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke(); }
        ctx.restore();
        glow(ctx, cx, cy, 20, '220,255,250', 0.7 * (1 - k));
      }
    }
  }

  const pfailed = {};
  /**
   * Draw a party member in WORLD space (docs/companions-spec.md §4).
   * Reads c.who ('rex' | 'lum'), c.state (follow/idle/controlled/help/throw/down), c.facing, c.vx, c.vy,
   * c.onGround, c.talking, c.talkMood, c.iframes. Rect actors (x,y,w,h) are drawn feet-at-bottom-centre;
   * ЛЮМ uses its centre (x,y). Never throws.
   * @param {CanvasRenderingContext2D} ctx camera-translated world context
   * @param {object} c companion (read only)
   * @param {number} t level time in seconds
   */
  function drawParty(ctx, c, t) {
    if (!c) return;
    ctx.save();
    try {
      if (c.who === 'lum') drawLumMember(ctx, c, t);
      else drawRex(ctx, c, t);
    } catch (err) {
      const k = String(c.who);
      if (!pfailed[k]) { pfailed[k] = true; console.warn('Art.Party draw failed for', k, err); if (G.errors) G.errors.push('art:party:' + k + ': ' + (err && err.message)); }
    } finally { ctx.restore(); }
  }
  G.Art.Party = { draw: drawParty };

  G.Art.Player = { draw: drawPlayer, drawItem };
  G.Art.Drone = { draw: drawDrone };
})();
