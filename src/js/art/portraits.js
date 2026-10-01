/**
 * TESSERA — dialogue portraits.
 *
 * Public API (contract: docs/level-format.md §4):
 *   G.Art.Portraits.draw(ctx, who, mood, x, y, size, t, talking)   VIEW space, square, pre-clipped
 *     who  ∈ mira | orion | lum | voice
 *     mood ∈ neutral happy sad angry scared surprised thinking determined
 *
 * Everything is drawn in a normalised 100×100 space. Mood parameters (brows, lids, gaze, mouth,
 * tilt, colour) are blended over ~0.15 s per character so mood changes between lines animate
 * instead of popping. Lighting matches the in-game art: warm key from the upper-left, cool rim
 * from the right. Glows are radial gradients (no shadowBlur). The Voice uses an offscreen buffer
 * for slice-displacement glitches and pre-baked deterministic noise frames.
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const LINE = '#12141d';

  function glow(ctx, x, y, r, col, a) {
    if (a <= 0.002) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.45, `rgba(${col},${a * 0.4})`); g.addColorStop(1, `rgba(${col},0)`);
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = op;
  }

  /** Blend a numeric parameter object toward a target (per-character memory). */
  const memo = {};
  function blended(who, target, t) {
    let m = memo[who];
    if (!m || t < m.t - 0.01 || t - m.t > 2) { m = memo[who] = { t, v: Object.assign({}, target) }; return m.v; }
    const k = 1 - Math.exp(-14 * clamp(t - m.t, 0, 0.25));
    m.t = t;
    for (const key in target) {
      const a = m.v[key], b = target[key];
      if (typeof b === 'number') m.v[key] = (typeof a === 'number' ? a : b) + (b - (typeof a === 'number' ? a : b)) * k;
      else if (Array.isArray(b)) { if (!Array.isArray(a)) m.v[key] = b.slice(); else for (let i = 0; i < b.length; i++) a[i] += (b[i] - a[i]) * k; }
      else m.v[key] = b;
    }
    return m.v;
  }

  function blinkAt(t, seed) {
    const period = 3.4 + seed * 0.7;
    const n = Math.floor((t + seed * 1.7) / period);
    const ph = (t + seed * 1.7) - n * period - hash1(n + seed * 13) * 1.5;
    if (ph < 0 || ph > 0.16) return 0;
    return ph < 0.06 ? ph / 0.06 : 1 - (ph - 0.06) / 0.1;
  }

  // ================================================================== MIRA
  const MIRA_MOODS = {
    neutral:    { bNi: 0, bNo: 0, bFi: 0, bFo: 0, lidT: 0.18, slant: 0, lidB: 0.05, pupil: 1, gx: 0.3, gy: 0.05, mw: 10, mc: 0.15, mo: 0, mx: 0, tilt: 0, blush: 0.3, sweat: 0, teeth: 0 },
    happy:      { bNi: -3, bNo: -2.5, bFi: -3, bFo: -2.5, lidT: 0.1, slant: 0, lidB: 0.38, pupil: 1, gx: 0.2, gy: 0, mw: 13, mc: 1, mo: 0.35, mx: 0, tilt: -0.04, blush: 0.75, sweat: 0, teeth: 1 },
    sad:        { bNi: -4, bNo: 2, bFi: -4, bFo: 2, lidT: 0.42, slant: 0.5, lidB: 0.05, pupil: 1, gx: 0, gy: 0.7, mw: 9, mc: -0.75, mo: 0, mx: 0, tilt: 0.07, blush: 0.25, sweat: 0, teeth: 0 },
    angry:      { bNi: 4, bNo: -1.5, bFi: 4, bFo: -1.5, lidT: 0.34, slant: -0.65, lidB: 0.22, pupil: 0.95, gx: 0.55, gy: 0, mw: 10, mc: -0.55, mo: 0.28, mx: 0, tilt: -0.03, blush: 0.4, sweat: 0, teeth: 1 },
    scared:     { bNi: -5.5, bNo: -2, bFi: -5.5, bFo: -2, lidT: 0, slant: 0.1, lidB: 0, pupil: 0.62, gx: -0.25, gy: 0.1, mw: 8, mc: -0.45, mo: 0.45, mx: 0, tilt: 0.03, blush: 0.15, sweat: 1, teeth: 0 },
    surprised:  { bNi: -6, bNo: -6, bFi: -6, bFo: -6, lidT: 0, slant: 0, lidB: 0, pupil: 0.75, gx: 0.2, gy: 0, mw: 7, mc: 0, mo: 0.9, mx: 0, tilt: -0.05, blush: 0.35, sweat: 0, teeth: 0 },
    thinking:   { bNi: -0.5, bNo: -0.5, bFi: -4.5, bFo: -5, lidT: 0.26, slant: 0, lidB: 0.1, pupil: 1, gx: 0.6, gy: -0.85, mw: 7, mc: -0.1, mo: 0, mx: 3, tilt: 0.07, blush: 0.3, sweat: 0, teeth: 0 },
    determined: { bNi: 3, bNo: 0.5, bFi: 3, bFo: 0.5, lidT: 0.3, slant: -0.25, lidB: 0.16, pupil: 0.92, gx: 0.75, gy: 0, mw: 10, mc: 0.3, mo: 0, mx: 1, tilt: -0.03, blush: 0.35, sweat: 0, teeth: 0 },
  };
  const SKIN = ['#b8775c', '#efbf9d', '#ffe6cf'];
  const HAIR = ['#2e110d', '#6a2619', '#b4532f'];

  function miraHairBack(c) {
    c.beginPath();
    c.moveTo(36, 58); c.lineTo(31, 64); c.lineTo(30, 60); c.lineTo(25, 68);
    c.quadraticCurveTo(22, 62, 21, 58);
    c.bezierCurveTo(12, 46, 13, 22, 35, 10);
    c.bezierCurveTo(54, 0, 83, 6, 87, 28);
    c.bezierCurveTo(90, 40, 89, 52, 86, 60);
    c.lineTo(84, 56); c.lineTo(80, 61); c.lineTo(60, 52);
    c.closePath();
  }
  function miraFace(c) {
    c.beginPath();
    c.moveTo(34, 30);
    c.bezierCurveTo(36, 16, 64, 12, 76, 24);
    c.quadraticCurveTo(80.5, 31, 80.5, 38);
    c.quadraticCurveTo(84, 45, 86.5, 50);
    c.quadraticCurveTo(84, 53.5, 80.5, 53.5);
    c.quadraticCurveTo(80.5, 58, 79.5, 60.5);
    c.quadraticCurveTo(77, 71, 64, 73.5);
    c.quadraticCurveTo(48, 73, 38, 61);
    c.quadraticCurveTo(31.5, 48, 34, 30);
    c.closePath();
  }
  function miraFringe(c, sw) {
    c.beginPath();
    c.moveTo(29, 42);
    c.bezierCurveTo(25, 14, 50, 3, 70, 9);
    c.bezierCurveTo(82, 13, 89 + sw, 23, 85 + sw, 37);
    c.quadraticCurveTo(79, 28.5, 70.5, 27.5);
    c.quadraticCurveTo(64.5, 32.5, 58.5, 27);
    c.quadraticCurveTo(50, 24, 44.5, 32);
    c.quadraticCurveTo(40, 42, 41 + sw * 0.5, 57);
    c.lineTo(34, 59);
    c.closePath();
  }
  function miraBust(c) {
    c.beginPath();
    c.moveTo(0, 101);
    c.bezierCurveTo(2, 86, 13, 79, 29, 77);
    c.quadraticCurveTo(43, 74, 52, 76);
    c.quadraticCurveTo(71, 74, 85, 80);
    c.bezierCurveTo(95, 85, 99, 93, 100, 101);
    c.closePath();
  }

  /** Clip-safe fill + warm/cool rim (same rim trick as the sprite). */
  function lit(ctx, path, fill, outline, warm, cool) {
    path(ctx);
    if (outline) { ctx.lineWidth = outline; ctx.strokeStyle = LINE; ctx.lineJoin = 'round'; ctx.stroke(); }
    ctx.fillStyle = fill; ctx.fill();
    ctx.save(); path(ctx); ctx.clip();
    if (warm) { ctx.save(); ctx.translate(1.6, 2.0); path(ctx); ctx.lineWidth = 2.2; ctx.strokeStyle = warm; ctx.stroke(); ctx.restore(); }
    if (cool) { ctx.save(); ctx.translate(-1.8, -1.0); path(ctx); ctx.lineWidth = 2.4; ctx.strokeStyle = cool; ctx.stroke(); ctx.restore(); }
    ctx.restore();
  }

  function drawMiraEye(ctx, cx, cy, rx, ry, P, open, far, t) {
    ctx.save();
    // eye white shape (almond)
    const path = (c) => {
      c.beginPath();
      c.moveTo(cx - rx, cy + 0.6);
      c.quadraticCurveTo(cx - rx * 0.2, cy - ry * 1.35, cx + rx, cy - ry * 0.25);
      c.quadraticCurveTo(cx + rx * 0.2, cy + ry * 1.25, cx - rx, cy + 0.6);
      c.closePath();
    };
    path(ctx); ctx.fillStyle = '#f7f1ec'; ctx.fill();
    ctx.save(); path(ctx); ctx.clip();
    // iris
    const jit = P.sweat > 0.5 ? (hash1(Math.floor(t * 18)) - 0.5) * 0.8 : 0;
    const ix = cx + P.gx * rx * 0.38 + jit, iy = cy + P.gy * ry * 0.35;
    const ir = ry * 0.82;
    const ig = ctx.createRadialGradient(ix - ir * 0.2, iy - ir * 0.4, ir * 0.1, ix, iy, ir);
    ig.addColorStop(0, '#a7d08a'); ig.addColorStop(0.55, '#4e8a4e'); ig.addColorStop(1, '#1f3a26');
    ctx.beginPath(); ctx.ellipse(ix, iy, ir * (far ? 0.7 : 0.92), ir, 0, 0, TAU); ctx.fillStyle = ig; ctx.fill();
    ctx.lineWidth = 0.6; ctx.strokeStyle = '#173020'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(ix + 0.2, iy, ir * 0.45 * P.pupil * (far ? 0.75 : 1), ir * 0.5 * P.pupil, 0, 0, TAU); ctx.fillStyle = '#0c0f0e'; ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ix - ir * 0.35, iy - ir * 0.4, ir * 0.24, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(ix + ir * 0.35, iy + ir * 0.35, ir * 0.1, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    // upper-lid shadow on the eyeball
    ctx.fillStyle = 'rgba(120,60,50,0.25)'; ctx.fillRect(cx - rx - 1, cy - ry * 1.5, rx * 2 + 2, ry * 0.7);
    // lids (skin), closing from top and bottom; slant tilts the top lid (outer end = +x for near eye)
    const top = clamp(Math.max(P.lidT, 1 - open), 0, 1), bot = P.lidB;
    const yT = cy - ry * 1.3 + top * ry * 2.3, sl = P.slant * ry * 0.9;
    ctx.fillStyle = SKIN[1];
    ctx.beginPath(); ctx.moveTo(cx - rx - 2, cy - ry * 2); ctx.lineTo(cx + rx + 2, cy - ry * 2);
    ctx.lineTo(cx + rx + 2, yT + sl); ctx.lineTo(cx - rx - 2, yT - sl); ctx.closePath(); ctx.fill();
    const yB = cy + ry * 1.2 - bot * ry * 1.4;
    ctx.beginPath(); ctx.moveTo(cx - rx - 2, cy + ry * 2); ctx.lineTo(cx + rx + 2, cy + ry * 2);
    ctx.lineTo(cx + rx + 2, yB); ctx.quadraticCurveTo(cx, yB - bot * 2.5, cx - rx - 2, yB); ctx.closePath(); ctx.fill();
    ctx.restore();
    // lash line along the top lid edge (or closed-eye curve)
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1d0f0d'; ctx.lineWidth = far ? 1.4 : 1.8;
    if (top > 0.92) {
      ctx.beginPath(); ctx.moveTo(cx - rx, cy + 0.8); ctx.quadraticCurveTo(cx, cy + 2.6 + (P.lidB > 0.3 ? -2.6 : 0), cx + rx, cy); ctx.stroke();
    } else {
      const yl = Math.max(yT, cy - ry * 1.0);
      ctx.beginPath(); ctx.moveTo(cx - rx - 0.5, Math.max(yl - sl, cy - ry * 0.4) + 0.6);
      ctx.quadraticCurveTo(cx, Math.min(yl, cy) - ry * 0.25 * (1 - top), cx + rx + 0.8, yl + sl - 0.2);
      ctx.stroke();
      if (!far) { // outer lash flick
        ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx + rx + 0.4, yl + sl - 0.2); ctx.lineTo(cx + rx + 2.4, yl + sl - 1.6); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(120,60,50,0.45)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(cx - rx * 0.6, yB + 0.4); ctx.quadraticCurveTo(cx, yB + 1.2, cx + rx * 0.7, yB); ctx.stroke();
    }
    ctx.restore();
  }

  function drawMiraMouth(ctx, P, talking, t) {
    let open = P.mo;
    if (talking) open = Math.max(open * 0.6, 0.15 + 0.55 * Math.abs(Math.sin(t * 13)) * (0.6 + 0.4 * hash1(Math.floor(t * 9))));
    const cx = 70 + P.mx, cy = 62, w = P.mw, cv = P.mc;
    const L = cx - w / 2, R = cx + w / 2 - 1;
    const cornerY = cy - cv * 2.6;
    if (open < 0.12) {
      ctx.strokeStyle = '#7a2f28'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(L, cornerY); ctx.quadraticCurveTo(cx, cy + cv * 2.2, R, cornerY - (P.mx > 1 ? 1.2 : 0)); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,200,0.6)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(cx - 2, cy + 3.4); ctx.lineTo(cx + 2, cy + 3.4); ctx.stroke();
      return;
    }
    const h = open * 7;
    ctx.beginPath();
    ctx.moveTo(L, cornerY);
    ctx.quadraticCurveTo(cx, cy - h * 0.25 + cv * 1.5, R, cornerY);
    ctx.quadraticCurveTo(cx, cy + h + cv * 1.8, L, cornerY);
    ctx.closePath();
    ctx.fillStyle = '#4a1518'; ctx.fill();
    ctx.save(); ctx.clip();
    if (P.teeth > 0.3 || open > 0.3) { ctx.fillStyle = '#f4eee9'; ctx.fillRect(L, cy - h * 0.4 + cv * 0.6 - 2, w, 2.4 + h * 0.15); }
    ctx.fillStyle = '#c4545a'; ctx.beginPath(); ctx.ellipse(cx, cy + h + cv * 1.2, w * 0.3, h * 0.45, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#6a2622'; ctx.lineWidth = 1; ctx.stroke();
  }

  function drawMira(ctx, mood, t, talking) {
    const P = blended('mira', MIRA_MOODS[mood] || MIRA_MOODS.neutral, t);
    // backdrop: warm key glow upper-left, cool fill right
    const bg = ctx.createLinearGradient(0, 0, 100, 100);
    bg.addColorStop(0, '#3a2a2e'); bg.addColorStop(1, '#141a2a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 100, 100);
    glow(ctx, 18, 14, 60, '255,160,90', 0.22);
    glow(ctx, 96, 70, 50, '90,140,255', 0.16);

    const breath = Math.sin(t * 1.8) * 0.6;
    const nod = talking ? Math.sin(t * 6.5) * 0.7 : 0;
    // bust
    ctx.save(); ctx.translate(0, breath * 0.5);
    const sg = ctx.createLinearGradient(10, 74, 70, 104);
    sg.addColorStop(0, '#ffa75e'); sg.addColorStop(0.5, '#e2712d'); sg.addColorStop(1, '#8e3a1c');
    lit(ctx, miraBust, sg, 2.4, 'rgba(255,220,180,0.5)', 'rgba(110,160,255,0.45)');
    ctx.save(); miraBust(ctx); ctx.clip();
    ctx.fillStyle = '#353b52';
    ctx.beginPath(); ctx.moveTo(0, 101); ctx.bezierCurveTo(4, 84, 14, 78, 30, 77); ctx.quadraticCurveTo(52, 73, 86, 80);
    ctx.lineTo(100, 90); ctx.lineTo(100, 86); ctx.lineTo(70, 84); ctx.quadraticCurveTo(40, 82, 16, 90); ctx.lineTo(4, 101); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#eef8ff'; ctx.beginPath(); ctx.moveTo(0, 95); ctx.quadraticCurveTo(50, 89, 100, 96); ctx.lineTo(100, 99); ctx.quadraticCurveTo(50, 92, 0, 98); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(70,20,6,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(58, 80); ctx.lineTo(60, 101); ctx.stroke();
    ctx.restore();
    // shoulder lamp
    ctx.fillStyle = LINE; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(17, 80, 11, 8, 2) : ctx.rect(17, 80, 11, 8); ctx.fill();
    ctx.fillStyle = '#5e6889'; ctx.fillRect(18.5, 81.5, 8, 5);
    ctx.fillStyle = '#fff4d4'; ctx.beginPath(); ctx.arc(26, 84, 2, 0, TAU); ctx.fill();
    glow(ctx, 26.5, 84, 14, '255,230,170', 0.55);
    // neck
    const ng = ctx.createLinearGradient(0, 58, 0, 80);
    ng.addColorStop(0, '#8e5643'); ng.addColorStop(1, '#d9a487');
    ctx.fillStyle = ng; ctx.beginPath(); ctx.moveTo(44, 58); ctx.lineTo(62, 62); ctx.lineTo(62, 78); ctx.lineTo(44, 78); ctx.closePath(); ctx.fill();
    // collar
    ctx.fillStyle = LINE; ctx.beginPath(); ctx.moveTo(38, 74); ctx.quadraticCurveTo(52, 69, 68, 74); ctx.lineTo(68, 82); ctx.quadraticCurveTo(52, 78, 38, 82); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3e4560'; ctx.beginPath(); ctx.moveTo(39.5, 75); ctx.quadraticCurveTo(52, 70.5, 66.5, 75); ctx.lineTo(66.5, 80); ctx.quadraticCurveTo(52, 76.5, 39.5, 80); ctx.closePath(); ctx.fill();
    ctx.restore();

    // head
    ctx.save();
    ctx.translate(56, 70 + nod * 0.6 + breath * 0.3); ctx.rotate(P.tilt); ctx.translate(-56, -70);
    const sw = Math.sin(t * 1.3) * 0.8 + (talking ? Math.sin(t * 6.5) * 0.4 : 0);
    const hg = ctx.createRadialGradient(40, 18, 2, 50, 36, 46);
    hg.addColorStop(0, HAIR[2]); hg.addColorStop(0.45, HAIR[1]); hg.addColorStop(1, HAIR[0]);
    lit(ctx, miraHairBack, hg, 2.4, 'rgba(255,170,120,0.55)', 'rgba(120,150,240,0.4)');
    const fg = ctx.createRadialGradient(52, 34, 3, 60, 44, 34);
    fg.addColorStop(0, SKIN[2]); fg.addColorStop(0.5, SKIN[1]); fg.addColorStop(1, SKIN[0]);
    lit(ctx, miraFace, fg, 2.2, null, 'rgba(110,160,255,0.55)');
    ctx.save(); miraFace(ctx); ctx.clip();
    // under-fringe and jaw occlusion
    ctx.fillStyle = 'rgba(110,45,35,0.28)'; ctx.beginPath(); ctx.ellipse(38, 50, 7, 20, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(110,45,35,0.18)'; ctx.fillRect(30, 26, 60, 8);
    // nose shading + tip highlight
    ctx.strokeStyle = 'rgba(150,80,60,0.6)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(79, 41); ctx.quadraticCurveTo(83, 48, 82, 52); ctx.stroke();
    ctx.fillStyle = 'rgba(255,245,235,0.8)'; ctx.beginPath(); ctx.arc(84, 48.5, 1.1, 0, TAU); ctx.fill();
    // blush
    const bA = 0.25 + 0.35 * P.blush;
    const cg = ctx.createRadialGradient(64, 54, 0, 64, 54, 9);
    cg.addColorStop(0, `rgba(255,110,100,${bA})`); cg.addColorStop(1, 'rgba(255,110,100,0)');
    ctx.fillStyle = cg; ctx.fillRect(52, 44, 24, 20);
    // freckles (deterministic)
    ctx.fillStyle = 'rgba(150,78,52,0.55)';
    const fr = [[60, 50], [63, 52.5], [66, 50.5], [69, 53], [72, 51], [75, 50], [78, 52], [62, 55], [71, 55.5], [65, 47.8], [74, 47.5]];
    for (const [fx, fy] of fr) { ctx.beginPath(); ctx.arc(fx, fy, 0.5, 0, TAU); ctx.fill(); }
    ctx.restore();
    // ear
    ctx.fillStyle = '#c48e72'; ctx.beginPath(); ctx.ellipse(38.5, 47, 4.2, 6.2, 0.15, 0, TAU); ctx.fill();
    ctx.strokeStyle = LINE; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = '#9a5a46'; ctx.beginPath(); ctx.ellipse(39.2, 47.5, 1.8, 3.4, 0.15, 0, TAU); ctx.fill();

    // eyes + brows
    const bl = blinkAt(t, 0.3);
    const open = 1 - bl;
    drawMiraEye(ctx, 57, 44, 6.4, 5.0, P, open, false, t);
    drawMiraEye(ctx, 75.5, 43.3, 3.6, 4.6, P, open, true, t);
    ctx.lineCap = 'round'; ctx.strokeStyle = HAIR[0];
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(50, 34 + P.bNo); ctx.quadraticCurveTo(56, 31.5 + (P.bNo + P.bNi) / 2, 63, 33 + P.bNi); ctx.stroke();
    ctx.lineWidth = 2.0;
    ctx.beginPath(); ctx.moveTo(71, 33.5 + P.bFi); ctx.quadraticCurveTo(75, 32 + (P.bFi + P.bFo) / 2, 79, 34 + P.bFo); ctx.stroke();
    drawMiraMouth(ctx, P, talking, t);
    if (P.sweat > 0.02) {
      ctx.globalAlpha = P.sweat * 0.9;
      ctx.fillStyle = '#bfe8ff'; ctx.strokeStyle = '#5a8ab0'; ctx.lineWidth = 0.8;
      const sy = 30 + ((t * 6) % 6);
      ctx.beginPath(); ctx.moveTo(44, sy - 4); ctx.quadraticCurveTo(46.5, sy, 44, sy + 1.6); ctx.quadraticCurveTo(41.5, sy, 44, sy - 4); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // fringe + loose strands
    lit(ctx, (c) => miraFringe(c, sw), hg, 2.2, 'rgba(255,175,125,0.6)', 'rgba(120,150,240,0.35)');
    ctx.save(); miraFringe(ctx, sw); ctx.clip();
    ctx.strokeStyle = 'rgba(255,170,120,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(52, 34, 23, Math.PI * 1.08, Math.PI * 1.45); ctx.stroke();
    ctx.strokeStyle = 'rgba(30,8,6,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(48, 10); ctx.quadraticCurveTo(64, 14, 74, 26); ctx.moveTo(40, 16); ctx.quadraticCurveTo(46, 24, 48, 30); ctx.stroke();
    ctx.restore();
    ctx.lineCap = 'round';
    const strand = (pts, w) => {
      for (let layer = 0; layer < 2; layer++) {
        ctx.lineWidth = layer ? w : w + 1.8; ctx.strokeStyle = layer ? HAIR[1] : LINE;
        ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); ctx.stroke();
      }
    };
    strand([80, 25, 88 + sw, 31, 86 + sw * 1.4, 40, 88 + sw * 1.8, 45], 1.8);
    strand([42, 50, 40 + sw * 0.6, 58, 43 + sw, 63, 41 + sw * 1.3, 69], 2.0);
    strand([50, 6, 46, 1 + sw * 0.4, 40, 2, 37 + sw, 6 + sw * 0.5], 1.6);
    ctx.restore();
  }

  // ================================================================== ORION
  const ORION_MOODS = {
    neutral:    { col: [126, 249, 255], spin: 1, lens: 1, slit: 0, jit: 0, bright: 0.8, ring: 1 },
    happy:      { col: [140, 255, 205], spin: 1.4, lens: 1.05, slit: 0, jit: 0, bright: 1, ring: 1.04 },
    sad:        { col: [92, 140, 255], spin: 0.4, lens: 0.85, slit: 0.25, jit: 0, bright: 0.5, ring: 0.96 },
    angry:      { col: [255, 96, 72], spin: 2.2, lens: 0.9, slit: 0.6, jit: 0.2, bright: 1, ring: 1 },
    scared:     { col: [200, 225, 255], spin: 3, lens: 0.75, slit: 0, jit: 1, bright: 0.75, ring: 0.95 },
    surprised:  { col: [235, 255, 255], spin: 1.6, lens: 1.25, slit: 0, jit: 0, bright: 1.2, ring: 1.1 },
    thinking:   { col: [126, 220, 255], spin: 0.6, lens: 0.95, slit: 0.15, jit: 0, bright: 0.7, ring: 1 },
    determined: { col: [80, 200, 255], spin: 1.2, lens: 0.95, slit: 0.35, jit: 0, bright: 1, ring: 1 },
  };

  function drawOrion(ctx, mood, t, talking) {
    const P = blended('orion', ORION_MOODS[mood] || ORION_MOODS.neutral, t);
    const col = P.col.map(Math.round).join(',');
    ctx.fillStyle = '#050b16'; ctx.fillRect(0, 0, 100, 100);
    // faint hex grid
    ctx.strokeStyle = `rgba(${col},0.08)`; ctx.lineWidth = 0.6;
    for (let row = 0; row < 9; row++) for (let q = 0; q < 8; q++) {
      const hx = q * 14 + (row % 2) * 7, hy = row * 12;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + Math.PI / 6; ctx.lineTo(hx + Math.cos(a) * 7, hy + Math.sin(a) * 7); }
      ctx.closePath(); ctx.stroke();
    }
    const jx = P.jit * (hash1(Math.floor(t * 20)) - 0.5) * 2.4, jy = P.jit * (hash1(Math.floor(t * 20) + 9) - 0.5) * 2.4;
    const cx = 50 + jx, cy = 50 + jy;
    glow(ctx, cx, cy, 52, col, 0.28 * P.bright);
    ctx.lineCap = 'round';
    // outer segmented ring
    const R1 = 38 * P.ring;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 12; i++) {
      const a0 = i / 12 * TAU + t * 0.25 * P.spin;
      ctx.strokeStyle = `rgba(${col},${i % 3 === 0 ? 0.9 : 0.4})`;
      ctx.beginPath(); ctx.arc(cx, cy, R1, a0, a0 + TAU / 12 * 0.7); ctx.stroke();
    }
    // tick ring counter-rotating
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${col},0.55)`;
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU - t * 0.4 * P.spin;
      const r0 = 30 * P.ring, r1 = r0 + (i % 4 === 0 ? 4 : 2);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    // thinking: loading arc / determined: brackets
    if (mood === 'thinking') {
      ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 2;
      const a = t * 4;
      ctx.beginPath(); ctx.arc(cx, cy, 26, a, a + 1.2); ctx.stroke();
      for (let i = 0; i < 3; i++) { ctx.fillStyle = `rgba(${col},${0.3 + 0.7 * (Math.floor(t * 3) % 3 === i ? 1 : 0)})`; ctx.beginPath(); ctx.arc(42 + i * 8, 88, 1.6, 0, TAU); ctx.fill(); }
    }
    if (mood === 'determined' || mood === 'angry') {
      ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 2;
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(cx + s * 22, cy - 14); ctx.lineTo(cx + s * 28, cy); ctx.lineTo(cx + s * 22, cy + 14); ctx.stroke();
      }
    }
    // voice waveform around the lens
    const amp = talking ? 1 : 0.12;
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * TAU;
      const v = amp * (0.35 + 0.65 * Math.abs(Math.sin(t * 11 + i * 0.9) * Math.sin(t * 5.3 + i * 0.37)));
      const r0 = 20 * P.lens + 1, r1 = r0 + 1 + v * 7;
      ctx.strokeStyle = `rgba(${col},${0.35 + 0.6 * v})`;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); ctx.stroke();
    }
    // central lens (eye)
    const lr = 18 * P.lens;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy, lr, lr * (1 - P.slit * 0.55), 0, 0, TAU); ctx.clip();
    const lg = ctx.createRadialGradient(cx - 4, cy - 5, 1, cx, cy, lr);
    lg.addColorStop(0, '#ffffff'); lg.addColorStop(0.25, `rgba(${col},1)`); lg.addColorStop(0.7, `rgba(${col},0.35)`); lg.addColorStop(1, '#06121c');
    ctx.fillStyle = lg; ctx.fillRect(cx - lr, cy - lr, lr * 2, lr * 2);
    // iris rings + aperture
    ctx.strokeStyle = 'rgba(5,18,28,0.55)'; ctx.lineWidth = 0.9;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + t * 0.5 * P.spin;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4); ctx.lineTo(cx + Math.cos(a + 0.5) * lr, cy + Math.sin(a + 0.5) * lr); ctx.stroke();
    }
    const pr = (talking ? 4.2 + Math.sin(t * 14) * 1.2 : 4.5) * (mood === 'surprised' ? 0.7 : 1);
    ctx.fillStyle = '#04101a'; ctx.beginPath(); ctx.arc(cx, cy, pr, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(${col},0.9)`; ctx.beginPath(); ctx.arc(cx, cy, pr * 0.35, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(cx, cy, lr, lr * (1 - P.slit * 0.55), 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(cx - lr * 0.45, cy - lr * 0.45 * (1 - P.slit * 0.55), 2.6, 1.6, -0.6, 0, TAU); ctx.fill();
    // sad: a slow falling "tear" packet
    if (mood === 'sad') {
      const k = (t * 0.6) % 1;
      ctx.fillStyle = `rgba(${col},${1 - k})`; ctx.fillRect(cx + 10, cy + 14 + k * 30, 1.6, 4);
    }
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = (t * 20) % 3; y < 100; y += 3) ctx.fillRect(0, y, 100, 1);
  }

  // ================================================================== ЛЮМ
  const LUM_MOODS = {
    neutral:    { col: [95, 244, 230], iris: 20, pupil: 8, lidT: 0.12, lidB: 0, slant: 0, gx: 0.15, gy: 0, jit: 0 },
    happy:      { col: [140, 255, 176], iris: 20, pupil: 8, lidT: 0, lidB: 0, slant: 0, gx: 0, gy: 0, jit: 0 },
    sad:        { col: [108, 155, 255], iris: 18, pupil: 8.5, lidT: 0.45, lidB: 0, slant: 0.5, gx: -0.1, gy: 0.55, jit: 0 },
    angry:      { col: [255, 120, 70], iris: 19, pupil: 6, lidT: 0.38, lidB: 0.2, slant: -0.7, gx: 0.3, gy: 0, jit: 0 },
    scared:     { col: [190, 230, 255], iris: 21, pupil: 4, lidT: 0, lidB: 0, slant: 0.2, gx: -0.2, gy: 0, jit: 1 },
    surprised:  { col: [200, 255, 250], iris: 24, pupil: 4.5, lidT: 0, lidB: 0, slant: 0, gx: 0, gy: 0, jit: 0 },
    thinking:   { col: [95, 230, 255], iris: 19, pupil: 7, lidT: 0.22, lidB: 0.08, slant: 0, gx: 0.55, gy: -0.6, jit: 0 },
    determined: { col: [80, 255, 220], iris: 19, pupil: 7, lidT: 0.32, lidB: 0.22, slant: -0.15, gx: 0.3, gy: 0, jit: 0 },
  };

  function drawLum(ctx, mood, t, talking) {
    const P = blended('lum', LUM_MOODS[mood] || LUM_MOODS.neutral, t);
    const col = P.col.map(Math.round).join(',');
    const bob = Math.sin(t * 2.4) * 1.2 + (mood === 'happy' ? -Math.abs(Math.sin(t * 9)) * 1.6 : 0);
    // backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, 100);
    bg.addColorStop(0, '#16303a'); bg.addColorStop(1, '#0a141c');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 100, 100);
    glow(ctx, 50, 54, 60, col, 0.18);
    ctx.save(); ctx.translate(0, bob);
    // shell (big sphere, cropped)
    const sg = ctx.createRadialGradient(30, 22, 6, 50, 56, 62);
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.5, '#e6eef5'); sg.addColorStop(0.85, '#9fb0c2'); sg.addColorStop(1, '#5b6b80');
    ctx.beginPath(); ctx.arc(50, 58, 54, 0, TAU); ctx.fillStyle = sg; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = LINE; ctx.stroke();
    // cool rim
    ctx.save(); ctx.beginPath(); ctx.arc(50, 58, 54, 0, TAU); ctx.clip();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(110,165,255,0.5)'; ctx.beginPath(); ctx.arc(48, 56, 54, -0.6, 1.2); ctx.stroke();
    // seam + ring light along the bottom
    ctx.strokeStyle = 'rgba(70,90,110,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(50, 16, 46, 10, 0, Math.PI, TAU); ctx.stroke();
    ctx.lineWidth = 3.4; ctx.strokeStyle = `rgb(${col})`;
    ctx.beginPath(); ctx.ellipse(50, 92, 56, 12, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    glow(ctx, 50, 82, 30, col, 0.25);
    ctx.restore();
    // specular
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(50, 58, 47, Math.PI * 1.13, Math.PI * 1.33); ctx.stroke();
    // eye housing
    const ex = 50, ey = 54, ER = 30;
    ctx.beginPath(); ctx.arc(ex, ey, ER + 3.5, 0, TAU); ctx.fillStyle = LINE; ctx.fill();
    ctx.beginPath(); ctx.arc(ex, ey, ER + 2, 0, TAU); ctx.strokeStyle = '#9fb0c4'; ctx.lineWidth = 2; ctx.stroke();
    const hg = ctx.createRadialGradient(ex - 8, ey - 8, 2, ex, ey, ER);
    hg.addColorStop(0, '#2a3446'); hg.addColorStop(1, '#070b12');
    ctx.beginPath(); ctx.arc(ex, ey, ER, 0, TAU); ctx.fillStyle = hg; ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(ex, ey, ER, 0, TAU); ctx.clip();
    const jx = P.jit * (hash1(Math.floor(t * 22)) - 0.5) * 3, jy = P.jit * (hash1(Math.floor(t * 22) + 4) - 0.5) * 3;
    const look = mood === 'thinking' ? Math.sin(t * 0.8) * 0.2 : 0;
    const ix = ex + (P.gx + look) * 9 + jx, iy = ey + P.gy * 9 + jy;
    if (mood === 'happy') {
      glow(ctx, ex, ey, 30, col, 0.5);
      ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ex, ey + 12, 17, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey + 12, 17, Math.PI * 1.3, Math.PI * 1.5); ctx.stroke();
    } else {
      const talkPulse = talking ? Math.abs(Math.sin(t * 12)) * 0.12 : 0;
      const ir = P.iris * (1 + talkPulse);
      glow(ctx, ix, iy, ir * 1.8, col, 0.55);
      const ig = ctx.createRadialGradient(ix - 4, iy - 5, 1, ix, iy, ir);
      ig.addColorStop(0, '#ffffff'); ig.addColorStop(0.3, `rgb(${col})`); ig.addColorStop(0.8, `rgba(${col},0.7)`); ig.addColorStop(1, `rgba(${col},0.25)`);
      ctx.beginPath(); ctx.arc(ix, iy, ir, 0, TAU); ctx.fillStyle = ig; ctx.fill();
      // aperture blades
      ctx.strokeStyle = 'rgba(6,20,26,0.5)'; ctx.lineWidth = 1.2;
      const pr = P.pupil * (talking ? 1 - Math.abs(Math.sin(t * 12)) * 0.25 : 1);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + t * 0.3;
        ctx.beginPath(); ctx.moveTo(ix + Math.cos(a) * pr, iy + Math.sin(a) * pr); ctx.lineTo(ix + Math.cos(a + 0.6) * ir * 0.95, iy + Math.sin(a + 0.6) * ir * 0.95); ctx.stroke();
      }
      // talking: VU segments light up around the iris
      if (talking) {
        ctx.lineWidth = 2.2;
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * TAU, v = Math.abs(Math.sin(t * 9 + i * 1.3));
          ctx.strokeStyle = `rgba(${col},${0.2 + 0.8 * v})`;
          ctx.beginPath(); ctx.arc(ix, iy, ir + 3, a, a + 0.25); ctx.stroke();
        }
      }
      if (mood === 'thinking') {
        ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(ix, iy, ir + 5, t * 2, t * 2 + 4); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(ix, iy, pr, 0, TAU); ctx.fillStyle = '#03080c'; ctx.fill();
      // lids
      const bl = blinkAt(t, 0.7);
      const top = Math.max(P.lidT, bl), sl = P.slant * 10;
      if (top > 0.01) {
        const yT = ey - ER + top * ER * 2;
        ctx.fillStyle = '#d9e3ec';
        ctx.beginPath(); ctx.moveTo(ex - ER - 2, ey - ER - 2); ctx.lineTo(ex + ER + 2, ey - ER - 2); ctx.lineTo(ex + ER + 2, yT + sl); ctx.lineTo(ex - ER - 2, yT - sl); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ex - ER - 2, yT - sl); ctx.lineTo(ex + ER + 2, yT + sl); ctx.stroke();
      }
      if (P.lidB > 0.01) {
        const yB = ey + ER - P.lidB * ER * 2;
        ctx.fillStyle = '#c9d4de';
        ctx.beginPath(); ctx.moveTo(ex - ER - 2, ey + ER + 2); ctx.lineTo(ex + ER + 2, ey + ER + 2); ctx.lineTo(ex + ER + 2, yB); ctx.lineTo(ex - ER - 2, yB); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ex - ER - 2, yB); ctx.lineTo(ex + ER + 2, yB); ctx.stroke();
      }
    }
    ctx.restore();
    // glass reflections
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.ellipse(ex - 13, ey - 14, 5, 3, -0.7, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(ex + 14, ey + 15, 2, 0, TAU); ctx.fill();
    if (mood === 'surprised' || mood === 'scared') {
      ctx.fillStyle = `rgb(${col})`; ctx.font = '700 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(mood === 'surprised' ? '!' : '!?', 86, 16 + Math.sin(t * 8) * 1.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
    // antenna tip in the corner
    const on = (t * 0.9) % 1 < 0.2;
    ctx.strokeStyle = LINE; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(26, 8 + bob); ctx.quadraticCurveTo(20, -2, 14, -6); ctx.stroke();
    ctx.strokeStyle = '#aab6c8'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(26, 8 + bob); ctx.quadraticCurveTo(20, -2, 14, -6); ctx.stroke();
    if (on) glow(ctx, 14, -4, 12, col, 0.8);
  }

  // ================================================================== VOICE
  let vCanvas = null, vctx = null, noise = null;
  function buildNoise() {
    noise = [];
    for (let f = 0; f < 4; f++) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const x = c.getContext('2d'); const img = x.createImageData(64, 64); const r = G.rng(1337 + f * 101);
      for (let i = 0; i < 64 * 64; i++) {
        const v = r(); const k = v * v * 255;
        img.data[i * 4] = k * 0.8; img.data[i * 4 + 1] = k * 0.55; img.data[i * 4 + 2] = k; img.data[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0); noise.push(c);
    }
  }

  function drawVoiceScene(c, mood, t, talking) {
    // deep violet void
    const bg = c.createRadialGradient(50, 46, 4, 50, 50, 75);
    bg.addColorStop(0, '#2a1240'); bg.addColorStop(1, '#07030d');
    c.fillStyle = bg; c.fillRect(0, 0, 100, 100);
    glow(c, 50, 40, 46, '180,110,255', 0.25 + (talking ? 0.1 * Math.abs(Math.sin(t * 9)) : 0));
    // silhouette — same bob + bust shapes as Mira, filled near-black with violet rim
    const fill = c.createLinearGradient(0, 0, 0, 100);
    fill.addColorStop(0, '#120a1c'); fill.addColorStop(1, '#05030a');
    const rimPaths = [miraBust, miraHairBack, miraFace, (q) => miraFringe(q, Math.sin(t * 2) * 1.2)];
    // outer silhouette only: stroke every shape thick first, then fill them all on top
    for (const pth of rimPaths) { pth(c); c.lineWidth = 3.2; c.strokeStyle = 'rgba(190,120,255,0.75)'; c.lineJoin = 'round'; c.stroke(); }
    for (const pth of rimPaths) { pth(c); c.fillStyle = fill; c.fill(); }
    // inner key-light rim on the hair, like Mira's — but cold
    c.save(); miraHairBack(c); c.clip(); c.translate(1.6, 2); miraHairBack(c); c.lineWidth = 1.6; c.strokeStyle = 'rgba(150,90,230,0.4)'; c.stroke(); c.restore();
    // eyes: two faint pale slits, the near one where Mira's would be
    const flick = hash1(Math.floor(t * 7)) < 0.1 ? 0.2 : 1;
    c.globalCompositeOperation = 'lighter';
    for (const [ex, ey, w] of [[57, 44, 4.2], [75.5, 43.3, 2.4]]) {
      const g = c.createRadialGradient(ex, ey, 0, ex, ey, w * 2.2);
      g.addColorStop(0, `rgba(235,210,255,${0.85 * flick})`); g.addColorStop(1, 'rgba(160,90,255,0)');
      c.fillStyle = g; c.fillRect(ex - w * 2.2, ey - w * 2.2, w * 4.4, w * 4.4);
      c.fillStyle = `rgba(255,245,255,${0.9 * flick})`; c.fillRect(ex - w * 0.7, ey - 0.6, w * 1.4, 1.2);
    }
    // mouth: a faint seam that opens while talking
    const open = talking ? Math.abs(Math.sin(t * 12)) * 3 : 0.3;
    c.fillStyle = `rgba(200,150,255,${0.35 + open * 0.12})`;
    c.fillRect(65, 61.5 - open / 2, 10, 0.8 + open);
    c.globalCompositeOperation = 'source-over';
  }

  function drawVoice(ctx, mood, t, talking, x, y, size) {
    const m = ctx.getTransform();
    const s = clamp(Math.hypot(m.a, m.b), 1, 4);
    const px = Math.ceil(size * s);
    if (!vCanvas || vCanvas.width < px) { vCanvas = document.createElement('canvas'); vCanvas.width = vCanvas.height = px; vctx = vCanvas.getContext('2d'); }
    if (!noise) buildNoise();
    vctx.setTransform(1, 0, 0, 1, 0, 0); vctx.clearRect(0, 0, px, px);
    vctx.setTransform(px / 100, 0, 0, px / 100, 0, 0);
    drawVoiceScene(vctx, mood, t, talking);
    // compose: horizontal slice displacement glitches
    const burst = (t % 1.7) < 0.12 || (talking && hash1(Math.floor(t * 10)) < 0.15);
    const intensity = (mood === 'angry' || mood === 'scared' ? 1.6 : 1) * (burst ? 1 : 0.25);
    const slices = 14;
    const sh = size / slices;
    for (let i = 0; i < slices; i++) {
      const r = hash1(i * 3.1 + Math.floor(t * 24));
      const off = r < 0.3 ? (hash1(i + Math.floor(t * 30)) - 0.5) * size * 0.12 * intensity : 0;
      ctx.drawImage(vCanvas, 0, (i / slices) * px, px, px / slices, x + off, y + i * sh, size, sh + 0.5);
    }
    // chromatic ghost
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12 + 0.18 * intensity;
    ctx.drawImage(vCanvas, 0, 0, px, px, x + size * 0.02 * intensity + 1, y, size, size);
    ctx.restore();
    // static
    ctx.save();
    ctx.globalAlpha = 0.16 + (burst ? 0.14 : 0);
    ctx.globalCompositeOperation = 'screen';
    const nf = noise[Math.floor(t * 18) % noise.length];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(nf, x, y, size, size);
    ctx.restore();
    // scanlines + rolling bar
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    for (let yy = 0; yy < size; yy += 3) ctx.fillRect(x, y + yy, size, 1);
    const bar = ((t * 0.35) % 1) * size;
    ctx.fillStyle = 'rgba(200,150,255,0.08)'; ctx.fillRect(x, y + bar, size, size * 0.12);
    ctx.restore();
  }

  /**
   * Draw a character portrait into the square (x, y, size). VIEW space; caller has clipped.
   * @param {CanvasRenderingContext2D} ctx
   * @param {'mira'|'orion'|'lum'|'voice'} who
   * @param {string} mood neutral|happy|sad|angry|scared|surprised|thinking|determined
   * @param {number} x
   * @param {number} y
   * @param {number} size
   * @param {number} t seconds
   * @param {boolean} talking animate the mouth / voice
   */
  function draw(ctx, who, mood, x, y, size, t, talking) {
    ctx.save();
    try {
      if (who === 'voice') { drawVoice(ctx, mood, t, talking, x, y, size); return; }
      ctx.translate(x, y); ctx.scale(size / 100, size / 100);
      if (who === 'mira') drawMira(ctx, mood, t, talking);
      else if (who === 'orion') drawOrion(ctx, mood, t, talking);
      else if (who === 'lum') drawLum(ctx, mood, t, talking);
      else {
        ctx.fillStyle = (G.Characters && G.Characters[who] && G.Characters[who].color) || '#888';
        ctx.globalAlpha = 0.5; ctx.fillRect(8, 8, 84, 84);
      }
    } finally { ctx.restore(); }
  }

  G.Art.Portraits = { draw };
})();
