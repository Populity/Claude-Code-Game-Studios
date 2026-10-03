/**
 * TESSERA — boss art (procedural Canvas 2D). Logic: src/js/world/bosses.js.
 *   G.Art.Bosses.draw(ctx, e, t, level)   WORLD space; e.type 'boss' | 'bossproj'
 *   G.Art.Bosses.drawHUD(ctx, boss, t)    VIEW space; letterbox + text-free segmented HP bar
 * Language: Architect bronze + stone, energy in the boss's signature colour; universal red = lethal
 * telegraph, white flash = hurt. Every attack has a visible wind-up driven by `telegraphT` (0..1).
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const VW = G.VIEW_W || 960;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = (k) => k * k * (3 - 2 * k);
  const SIG = { archivist: '#b98cff', colossus: '#ffb347', warden: '#ff4d5e' };
  const BRONZE = ['#f0c47a', '#b4823e', '#6b4520', '#2e1c0e'];

  // ---- cached radial glow sprites (lighter compositing, no shadowBlur)
  const glowCache = {};
  function glowSprite(color) {
    if (glowCache[color]) return glowCache[color];
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, color); gr.addColorStop(0.35, color + '88'); gr.addColorStop(1, color + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (glowCache[color] = c);
  }
  function glow(ctx, x, y, r, color, a = 1) {
    if (r <= 0 || a <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  function lin(ctx, x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; }
  function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.closePath(); }
  /** Hurt flash / death shake common to all bosses. */
  function shakeOf(e, t) {
    let k = 0;
    if (e.state === 'dying') k = 2 + e.deathT * 3;
    if (e.hurtT > 0) k = Math.max(k, e.hurtT * 8);
    if (e.state === 'intro' && e.roarT < 1) k = Math.max(k, (1 - e.roarT) * 5);
    return k ? { x: Math.sin(t * 61) * k, y: Math.cos(t * 47) * k * 0.6 } : { x: 0, y: 0 };
  }
  function flash(e) { return e.hurtT > 0 ? Math.min(1, e.hurtT * 2.2) * (Math.sin(e.hurtT * 60) > 0 ? 1 : 0.5) : 0; }
  /** Expanding roar rings (intro roar + phase shifts). */
  function roarRings(ctx, e, x, y, col) {
    if (e.roarT > 1.4) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const k = clamp01(e.roarT * 1.2 - i * 0.18); if (k <= 0 || k >= 1) continue;
      ctx.strokeStyle = col; ctx.globalAlpha = (1 - k) * 0.7; ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(x, y, 40 + k * 340, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  /** Shared dying look: white-out swelling over the body; dead = scorched wreck handled per kind. */
  function deathFlash(ctx, e, x, y, r) {
    if (e.state !== 'dying') return;
    const k = clamp01(e.deathT / G.CONFIG.bosses.common.deathTime);
    glow(ctx, x, y, r * (1 + k * 2), '#ffffff', k * 0.9);
    glow(ctx, x, y, r * 0.8, '#ffe17a', 0.4 + Math.sin(e.deathT * 30) * 0.3);
  }
  function glyphs(ctx, x, y, w, n, seed, col, a) {
    const r = G.rng(seed); ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    for (let i = 0; i < n; i++) {
      const gx = x + (i + 0.5) * (w / n); ctx.beginPath();
      const k = (r() * 4) | 0;
      if (k === 0) { ctx.arc(gx, y, 3, 0, TAU); } else if (k === 1) { ctx.moveTo(gx - 3, y - 3); ctx.lineTo(gx + 3, y + 3); ctx.moveTo(gx + 3, y - 3); ctx.lineTo(gx - 3, y + 3); }
      else if (k === 2) { ctx.moveTo(gx, y - 4); ctx.lineTo(gx + 3, y + 3); ctx.lineTo(gx - 3, y + 3); ctx.closePath(); } else { ctx.moveTo(gx - 3, y); ctx.lineTo(gx + 3, y); ctx.moveTo(gx, y - 4); ctx.lineTo(gx, y + 4); }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ================================================================== 1 — Архивариус
  function drawArchivist(ctx, e, t) {
    const col = SIG.archivist, s = shakeOf(e, t);
    if (e.state === 'dead') return drawWreck(ctx, e.bx, e.floorY, 170, col, t);
    const x = e.bx + s.x, y = e.by + s.y;
    const f = flash(e), tel = e.telegraphT || 0;
    glow(ctx, x, y, 260, col, 0.18 + (e.exposed ? 0.15 : 0));
    // drifting ground shadow + levitation beam
    ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(e.bx, e.floorY - 2, 90, 10, 0, 0, TAU); ctx.fill(); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.1;
    ctx.fillStyle = lin(ctx, 0, y + 60, 0, e.floorY, [col, col + '00']); poly(ctx, [x - 30, y + 70, x + 30, y + 70, x + 80, e.floorY, x - 80, e.floorY]); ctx.fill(); ctx.restore();
    // orbiting tablets (pages of the archive) — back half
    const orbit = (front) => {
      for (let i = 0; i < 6; i++) {
        const a = t * 0.5 + (i / 6) * TAU, z = Math.sin(a);
        if ((z > 0) !== front) continue;
        const ox = x + Math.cos(a) * 120, oy = y - 20 + z * 22;
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(Math.cos(a) * 0.3); ctx.globalAlpha = 0.65 + z * 0.3;
        ctx.fillStyle = lin(ctx, -9, -14, 9, 14, ['#d8c8a8', '#7a6850']); ctx.fillRect(-9, -14, 18, 28);
        glyphs(ctx, -9, -4, 18, 2, i * 7, col, 0.9); glyphs(ctx, -9, 6, 18, 2, i * 9 + 1, col, 0.7);
        ctx.restore();
      }
    };
    orbit(false);
    // robe (long tapered bronze mantle with glyph bands)
    ctx.save(); ctx.translate(x, y);
    const sway = Math.sin(t * 1.3) * 6;
    ctx.fillStyle = lin(ctx, -70, -60, 70, 120, [BRONZE[0], BRONZE[1], BRONZE[2], BRONZE[3]]);
    ctx.beginPath(); ctx.moveTo(-46, -40); ctx.quadraticCurveTo(-70, 40, -60 + sway, 118); ctx.lineTo(-20 + sway, 104); ctx.lineTo(0 + sway, 124); ctx.lineTo(20 + sway, 104); ctx.lineTo(60 + sway, 118); ctx.quadraticCurveTo(70, 40, 46, -40); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,180,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    for (let b = 0; b < 3; b++) { const by = 10 + b * 32; ctx.fillStyle = 'rgba(20,10,30,0.45)'; ctx.fillRect(-56 + b * 3, by, 112 - b * 6, 8); glyphs(ctx, -54 + b * 3, by + 4, 108 - b * 6, 9, 31 + b, col, 0.55 + 0.4 * Math.sin(t * 2 + b)); }
    // shoulders + arms holding the open codex
    for (const sd of [-1, 1]) {
      ctx.fillStyle = lin(ctx, sd * 30, -50, sd * 80, -10, [BRONZE[0], BRONZE[2]]);
      ctx.beginPath(); ctx.ellipse(sd * 52, -34, 26, 18, sd * 0.3, 0, TAU); ctx.fill();
      const hx = sd * 62, hy = 8 + Math.sin(t * 1.7 + sd) * 4;
      ctx.strokeStyle = BRONZE[2]; ctx.lineWidth = 10; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sd * 56, -26); ctx.quadraticCurveTo(sd * 78, -6, hx, hy); ctx.stroke();
      ctx.fillStyle = BRONZE[1]; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, TAU); ctx.fill();
      // orb charge in the palms
      if (e.charge > 0) { glow(ctx, hx, hy, 18 + e.charge * 34, col, 0.4 + e.charge * 0.6); glow(ctx, hx, hy, 8 + e.charge * 8, '#ffffff', e.charge); }
    }
    // chest core under a lattice; exposed = lattice open + pulsing heart
    const coreA = e.exposed ? 1 : 0.35;
    ctx.fillStyle = '#140a1e'; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.fill();
    glow(ctx, 0, 0, e.exposed ? 60 + Math.sin(t * 9) * 10 : 30, e.exposed ? '#ffffff' : col, coreA);
    ctx.fillStyle = e.exposed ? '#fff4ff' : col; ctx.beginPath(); ctx.arc(0, 0, e.exposed ? 14 + Math.sin(t * 9) * 2 : 9, 0, TAU); ctx.fill();
    if (!e.exposed) { ctx.strokeStyle = BRONZE[0]; ctx.lineWidth = 3; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + t * 0.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 24, Math.sin(a) * 24); ctx.stroke(); } }
    // hood + mask with the single lens (laser origin at y-26)
    ctx.fillStyle = lin(ctx, -40, -100, 40, -30, ['#3a2614', '#140b05']);
    ctx.beginPath(); ctx.moveTo(-40, -36); ctx.quadraticCurveTo(-44, -98, 0, -108); ctx.quadraticCurveTo(44, -98, 40, -36); ctx.closePath(); ctx.fill();
    ctx.fillStyle = lin(ctx, -22, -70, 22, -20, ['#f7e2b0', '#b08850']);
    ctx.beginPath(); ctx.moveTo(-20, -66); ctx.lineTo(20, -66); ctx.lineTo(14, -24); ctx.lineTo(0, -16); ctx.lineTo(-14, -24); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(60,30,10,0.6)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-6, -64); ctx.lineTo(-2, -40); ctx.lineTo(-8, -30); ctx.stroke(); // crack
    const lensCol = e.laser && e.laser.stage ? '#ff3b4e' : col;
    glow(ctx, 0, -26, 26 + tel * 40, lensCol, 0.6 + tel * 0.4);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -26 - 0 * 0, 5 + tel * 3, 0, TAU); ctx.fill();
    // halo ring
    ctx.strokeStyle = col; ctx.globalAlpha = 0.7; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, -112, 42, 9, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    if (f) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = f * 0.8; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, 0, 80, 120, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
    orbit(true);
    // shield bubble: hex shimmer, fades when the last pillar falls
    if (e.shieldA > 0.01) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const R = (G.CONFIG.bosses.archivist.bodyR) * 1.9;
      ctx.globalAlpha = 0.12 * e.shieldA; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - 10, R, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.5 * e.shieldA; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 10, R, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.25 * e.shieldA; ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) { const a = i / 14 * TAU + t * 0.3; const hx = x + Math.cos(a) * R * 0.92, hy = y - 10 + Math.sin(a) * R * 0.92; ctx.beginPath(); for (let k = 0; k < 6; k++) { const b = k / 6 * TAU; ctx.lineTo(hx + Math.cos(b) * 9, hy + Math.sin(b) * 9); } ctx.closePath(); ctx.stroke(); }
      ctx.restore();
      // energy tethers from standing pillars to the shield (shows WHY it is shielded)
      if (e.pillars) for (const q of e.pillars) if (q.state === 'up') {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = col; ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 6 + q.x); ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -t * 40;
        ctx.beginPath(); ctx.moveTo(q.x + q.w / 2, q.y); ctx.quadraticCurveTo((q.x + x) / 2, q.y - 120, x, y); ctx.stroke(); ctx.restore();
      }
    }
    // exposure countdown ring
    if (e.exposed) {
      ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = 0.8; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 40, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(e.exposeT / e.exposeMax)); ctx.stroke(); ctx.restore();
    }
    drawArchLaser(ctx, e, t);
    roarRings(ctx, e, x, y, col);
    deathFlash(ctx, e, x, y, 120);
  }
  function drawArchLaser(ctx, e, t) {
    const L = e.laser; if (!L || !L.stage) return;
    const ex = L.x + Math.cos(L.ang) * L.len, ey = L.y + Math.sin(L.ang) * L.len;
    ctx.save();
    if (L.stage === 'aim' || L.stage === 'lock') {
      const k = L.stage === 'lock' ? 1 : e.telegraphT;
      ctx.strokeStyle = '#ff3b4e'; ctx.globalAlpha = 0.35 + k * 0.55; ctx.lineWidth = 1 + k * 2;
      ctx.setLineDash(L.stage === 'lock' ? [] : [10, 8]); ctx.lineDashOffset = -t * 60;
      ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      // sweep-direction chevrons near the impact point
      const nx = -Math.sin(L.ang) * L.dir, ny = Math.cos(L.ang) * L.dir;
      for (let i = 1; i <= 3; i++) {
        const cx = ex + nx * (14 + i * 14) - Math.cos(L.ang) * 20, cy = ey + ny * (14 + i * 14) - Math.sin(L.ang) * 20;
        ctx.globalAlpha = (0.3 + 0.7 * k) * (Math.sin(t * 10 - i) * 0.5 + 0.5);
        ctx.beginPath(); ctx.moveTo(cx - ny * 8 - nx * 6, cy + nx * 8 - ny * 6); ctx.lineTo(cx, cy); ctx.lineTo(cx + ny * 8 - nx * 6, cy - nx * 8 - ny * 6); ctx.stroke();
      }
      glow(ctx, ex, ey, 16 + k * 20, '#ff3b4e', k);
    } else {
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const [w, c, a] of [[34, '#ff2a4a', 0.25], [18, '#ff6a7a', 0.6], [7, '#ffffff', 1]]) {
        ctx.strokeStyle = c; ctx.globalAlpha = a; ctx.lineWidth = w + Math.sin(t * 50) * 2;
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(ex, ey); ctx.stroke();
      }
      glow(ctx, ex, ey, 60, '#ff6a3a', 1); glow(ctx, L.x, L.y, 50, '#ffffff', 0.8);
    }
    ctx.restore();
  }

  // ================================================================== 2 — Колосс Бурь
  function drawColossus(ctx, e, t) {
    const C = G.CONFIG.bosses.colossus, col = SIG.colossus, s = shakeOf(e, t);
    if (e.state === 'dead') return drawWreck(ctx, e.bx, e.footY, 200, col, t);
    const W = C.w, H = C.h, x = e.bx + s.x, fy = e.footY;
    const f = flash(e);
    // landing reticle for the incoming shell (drawn in world, on the floor)
    if (e.reticle && e.atk && e.atk.name === 'salvo') {
      const k = e.telegraphT, rx = e.reticle.x, ry = e.reticle.y;
      ctx.save(); ctx.strokeStyle = '#ff3b4e'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5 + k * 0.5;
      ctx.beginPath(); ctx.ellipse(rx, ry - 2, C.blastR * (1.6 - k * 0.6), 10 * (1.6 - k * 0.6), 0, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(rx, ry - 2, C.blastR, 10, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.15 + k * 0.25; ctx.fillStyle = '#ff3b4e'; ctx.fill();
      glow(ctx, rx, ry, 40 + k * 30, '#ff3b4e', 0.3 + k * 0.4); ctx.restore();
    }
    ctx.save(); ctx.translate(x, fy); ctx.scale(e.facing, 1);
    // shadow
    ctx.globalAlpha = 0.4; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(0, -2, W * 0.7, 12, 0, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    // legs: gait from walkT; stomp raises the front leg
    const gait = e.moving ? Math.sin(e.walkT * 2.2) : 0;
    const bob = Math.abs(gait) * 4 + (e.turnT ? Math.sin(e.turnT * Math.PI) * 6 : 0);
    const legs = [[-W * 0.26, gait * 10, 0], [W * 0.26, -gait * 10, ease(e.stompT || 0) * 46]];
    for (const [lx, sw, lift] of legs) {
      const hipX = lx, hipY = -H * 0.42 - bob, footX = lx + sw, footY = -lift;
      const kneeX = (hipX + footX) / 2 + 22, kneeY = (hipY + footY) / 2;
      ctx.strokeStyle = '#2b2620'; ctx.lineWidth = 30; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY - 14); ctx.stroke();
      ctx.strokeStyle = '#6a5a48'; ctx.lineWidth = 18; ctx.stroke();
      ctx.fillStyle = '#9a8468'; ctx.beginPath(); ctx.arc(kneeX, kneeY, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = lin(ctx, footX - 34, footY - 24, footX + 34, footY, ['#7d6a52', '#2b2218']);
      poly(ctx, [footX - 36, footY, footX + 40, footY, footX + 30, footY - 22, footX - 26, footY - 22]); ctx.fill();
      if (lift > 2) glow(ctx, footX, footY + 4, 30 + lift, '#ff3b4e', ease(e.stompT) * 0.7);
    }
    // torso: armoured storm-engine
    const ty = -H * 0.95 - bob;
    ctx.fillStyle = lin(ctx, -W / 2, ty, W / 2, ty + H * 0.55, ['#a8987e', '#5a4c3c', '#241c14']);
    poly(ctx, [-W * 0.46, ty + 20, -W * 0.3, ty, W * 0.32, ty, W * 0.5, ty + 30, W * 0.44, ty + H * 0.55, -W * 0.42, ty + H * 0.55]); ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,210,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < 5; i++) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-W * 0.38, ty + 30 + i * 20, W * 0.76, 3); }
    // storm coils on the chest
    for (let i = 0; i < 3; i++) glow(ctx, -W * 0.1 + i * 22, ty + 60, 12 + Math.sin(t * 8 + i) * 4, col, 0.7);
    // head + visor
    ctx.fillStyle = '#3a3128'; poly(ctx, [W * 0.05, ty - 26, W * 0.34, ty - 22, W * 0.38, ty + 6, W * 0.04, ty + 8]); ctx.fill();
    const eyeK = e.atk ? 0.6 + e.telegraphT * 0.4 : 0.4;
    ctx.fillStyle = e.atk ? '#ff3b4e' : col; ctx.fillRect(W * 0.16, ty - 12, W * 0.18, 6);
    glow(ctx, W * 0.26, ty - 9, 26, e.atk ? '#ff3b4e' : col, eyeK);
    // back vent + valve (open while reloading; steam)
    const vx = -W * 0.44, vy = -H * 0.74 - bob;
    ctx.fillStyle = '#1a140e'; ctx.beginPath(); ctx.arc(vx, vy, 22, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(vx, vy);
    const vo = e.ventT || 0;
    for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2 + vo * 0.9); ctx.fillStyle = '#7d6a52'; ctx.fillRect(2 + vo * 10, -6, 18, 12); ctx.restore(); }
    if (vo > 0.05) {
      glow(ctx, 0, 0, 40 + Math.sin(t * 20) * 6, '#ffd27a', vo);
      if (!e.valveGone) { ctx.strokeStyle = '#ff5a3a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.moveTo(0, -12); ctx.lineTo(0, 12); ctx.stroke(); }
      ctx.globalAlpha = 0.35 * vo; ctx.fillStyle = '#e8f0f4';
      for (let i = 0; i < 5; i++) { const k = ((t * 1.4 + i / 5) % 1); ctx.beginPath(); ctx.arc(-k * 50, -k * 70, 6 + k * 18, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    // shoulder cannon (aims at the arc apex), ammo drum lamps
    const mx = W * 0.3, my = -H * 0.9 - bob;
    ctx.save(); ctx.translate(mx, my);
    const ang = e.facing > 0 ? e.cannonAng : Math.PI - e.cannonAng;
    ctx.rotate(G.clamp(ang, -1.4, 0.2));
    ctx.fillStyle = lin(ctx, 0, -14, 0, 14, ['#8a7a64', '#3a3128']); ctx.fillRect(-20, -14, 78, 28);
    ctx.fillStyle = '#20180f'; ctx.fillRect(56, -17, 14, 34);
    const ct = e.atk && e.atk.name === 'salvo' ? e.telegraphT : 0;
    if (ct > 0) { glow(ctx, 66, 0, 20 + ct * 40, '#ff8a3a', ct); glow(ctx, 66, 0, 8 + ct * 10, '#ffffff', ct * ct); }
    ctx.restore();
    const salvoN = G.CONFIG.bosses.colossus.salvo[Math.min(e.phase, 2)];
    for (let i = 0; i < salvoN; i++) { const used = e.atk && e.atk.name === 'salvo' && i < e.atk.n; ctx.fillStyle = used ? '#3a2a1a' : col; ctx.beginPath(); ctx.arc(-W * 0.1 + i * 14, ty + 16, 4, 0, TAU); ctx.fill(); }
    if (f) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = f * 0.7; ctx.fillStyle = '#fff'; ctx.fillRect(-W / 2, -H, W, H); }
    ctx.restore();
    roarRings(ctx, e, x, fy - H * 0.6, col);
    deathFlash(ctx, e, x, fy - H * 0.55, 130);
  }

  // ================================================================== 3 — Первый Страж
  function drawWarden(ctx, e, t) {
    const C = G.CONFIG.bosses.warden, col = SIG.warden, s = shakeOf(e, t);
    if (e.state === 'dead') return drawWreck(ctx, e.bx, e.floorY, 150, col, t);
    const x = e.bx + s.x, y = e.by + s.y, f = flash(e);
    glow(ctx, x, y, 300, col, 0.15);
    // support pylon to the ceiling
    ctx.fillStyle = lin(ctx, x - 20, 0, x + 20, 0, ['#2a2430', '#5a5060', '#1a1620']); ctx.fillRect(x - 16, e.y, 32, y - e.y - 50);
    // beam arms
    drawArms(ctx, e, t);
    // outer rotating ring with socket lamps (one lamp per filled socket)
    ctx.save(); ctx.translate(x, y);
    ctx.rotate(t * 0.15); ctx.strokeStyle = '#6a5a70'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(0, 0, C.shellR + 18, 0, TAU); ctx.stroke();
    ctx.strokeStyle = BRONZE[1]; ctx.lineWidth = 2; ctx.stroke();
    ctx.rotate(-t * 0.15);
    for (let i = 0; i < e.socketsTotal; i++) {
      const a = -Math.PI / 2 + (i - (e.socketsTotal - 1) / 2) * 0.5, lx = Math.cos(a) * (C.shellR + 18), ly = Math.sin(a) * (C.shellR + 18);
      const on = i < e.filled; ctx.fillStyle = on ? '#ffe17a' : '#2a1a1a'; ctx.beginPath(); ctx.arc(lx, ly, 7, 0, TAU); ctx.fill();
      if (on) glow(ctx, lx, ly, 20, '#ffe17a', 0.9);
    }
    // armoured petals (open with openT)
    const o = ease(e.openT || 0);
    for (let i = 0; i < 4; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 2 + Math.PI / 4 + t * 0.05); ctx.translate(o * 34, 0);
      ctx.fillStyle = lin(ctx, 0, -C.shellR, C.shellR, C.shellR, ['#9a90a8', '#40384a', '#1a1620']);
      ctx.beginPath(); ctx.moveTo(4, 0); ctx.arc(4, 0, C.shellR - 2, -Math.PI / 4 + 0.06, Math.PI / 4 - 0.06); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,230,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
      glyphs(ctx, C.shellR * 0.45, 0, C.shellR * 0.4, 2, i * 13, col, 0.6);
      ctx.restore();
    }
    // the core eye
    const pulse = 0.5 + 0.5 * Math.sin(t * (e.exposed ? 10 : 3));
    glow(ctx, 0, 0, 40 + o * 50 + pulse * 10, e.exposed ? '#ffffff' : col, 0.7 + o * 0.3);
    ctx.fillStyle = e.exposed ? '#fff0f2' : '#ff8a96'; ctx.beginPath(); ctx.arc(0, 0, C.coreR * (0.5 + o * 0.5), 0, TAU); ctx.fill();
    ctx.fillStyle = '#300'; ctx.beginPath(); ctx.ellipse(0, 0, 4 + o * 3, 12 + o * 6, 0, 0, TAU); ctx.fill();
    // spawn hatch glow (top)
    if (e.hatchT > 0) glow(ctx, 0, -C.shellR - 6, 20 + e.hatchT * 30, '#ff3b4e', e.hatchT);
    if (f) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = f * 0.8; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, C.shellR + 10, 0, TAU); ctx.fill(); }
    ctx.restore();
    roarRings(ctx, e, x, y, col);
    deathFlash(ctx, e, x, y, 110);
  }
  function drawArms(ctx, e, t) {
    if (!e.arms || !e.arms.length) return;
    const C = G.CONFIG.bosses.warden;
    ctx.save(); ctx.lineCap = 'round';
    for (const a of e.arms) {
      const ex = e.bx + Math.cos(a.ang) * a.len, ey = e.by + Math.sin(a.ang) * a.len;
      // emitter fin
      ctx.save(); ctx.translate(e.bx, e.by); ctx.rotate(a.ang); ctx.fillStyle = '#4a4054'; poly(ctx, [C.shellR - 4, -10, C.shellR + 26, -5, C.shellR + 26, 5, C.shellR - 4, 10]); ctx.fill(); ctx.restore();
      if (e.armState === 'warn' || (e.armState === 'on' && e.armK < 0.5)) {
        const k = e.armState === 'warn' ? e.telegraphT : 1;
        ctx.strokeStyle = '#ff3b4e'; ctx.globalAlpha = (0.3 + 0.6 * k) * (Math.sin(t * 40) > 0 ? 1 : 0.4); ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.moveTo(e.bx, e.by); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]);
      }
      if (e.armK > 0.05) {
        ctx.globalCompositeOperation = 'lighter';
        for (const [w, c, al] of [[C.armWidth * 2.6, '#ff2a3a', 0.22], [C.armWidth * 1.3, '#ff6a7a', 0.6], [C.armWidth * 0.45, '#ffffff', 1]]) {
          ctx.strokeStyle = c; ctx.globalAlpha = al * e.armK; ctx.lineWidth = w + Math.sin(t * 45 + a.ang) * 1.5;
          ctx.beginPath(); ctx.moveTo(e.bx, e.by); ctx.lineTo(ex, ey); ctx.stroke();
        }
        glow(ctx, ex, ey, 34, '#ff5a3a', e.armK);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Destroyed boss: smouldering heap of plates with a dying ember. */
  function drawWreck(ctx, x, floorY, w, col, t) {
    const r = G.rng(Math.floor(x));
    ctx.save();
    for (let i = 0; i < 9; i++) {
      const px = x + (r() - 0.5) * w, ph = 10 + r() * 26, pw = 20 + r() * 40;
      ctx.save(); ctx.translate(px, floorY - ph * 0.4); ctx.rotate((r() - 0.5) * 1.2);
      ctx.fillStyle = lin(ctx, -pw / 2, -ph / 2, pw / 2, ph / 2, ['#6a5a48', '#2a2018']); ctx.fillRect(-pw / 2, -ph / 2, pw, ph); ctx.restore();
    }
    glow(ctx, x, floorY - 14, 40 + Math.sin(t * 2) * 6, col, 0.35);
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#9a9a9a';
    for (let i = 0; i < 4; i++) { const k = (t * 0.3 + i / 4) % 1; ctx.beginPath(); ctx.arc(x + Math.sin(i * 3 + t) * 20, floorY - 20 - k * 120, 8 + k * 20, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  // ================================================================== projectiles + props
  function drawProj(ctx, e, t) {
    if (!e.live) return;
    const x = e.px, y = e.py;
    switch (e.kind) {
      case 'orb': {
        const a = Math.atan2(e.vy, e.vx);
        for (let i = 1; i <= 4; i++) glow(ctx, x - Math.cos(a) * i * 9, y - Math.sin(a) * i * 9, e.r * (1.6 - i * 0.25), SIG.archivist, 0.35 - i * 0.06);
        glow(ctx, x, y, e.r * 3, SIG.archivist, 0.9);
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * 3);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, e.r * 0.8, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-e.r * 0.5, 0); ctx.lineTo(e.r * 0.5, 0); ctx.moveTo(0, -e.r * 0.5); ctx.lineTo(0, e.r * 0.5); ctx.stroke();
        ctx.restore();
        if (e.life < 1) { ctx.globalAlpha = 1; }
        break;
      }
      case 'crystal': {
        const bob = Math.sin(t * 3 + x) * 4, a = e.ready ? 1 : 0.25;
        glow(ctx, x, y + bob, 34, '#ff7ad9', 0.7 * a);
        ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y + bob); ctx.rotate(Math.sin(t * 2) * 0.2);
        ctx.fillStyle = lin(ctx, -8, -14, 8, 14, ['#ffe0f6', '#ff7ad9', '#a02a80']); poly(ctx, [0, -15, 9, 0, 0, 15, -9, 0]); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
        break;
      }
      case 'shell': {
        const col = e.deflected ? '#7ef9ff' : '#ff8a3a';
        glow(ctx, x - e.vx * 0.03, y - e.vy * 0.03, e.r * 2.4, col, 0.5);
        ctx.fillStyle = lin(ctx, x - e.r, y - e.r, x + e.r, y + e.r, ['#8a7a64', '#201810']); ctx.beginPath(); ctx.arc(x, y, e.r, 0, TAU); ctx.fill();
        glow(ctx, x, y, e.r * 1.4, col, 0.6 + 0.4 * Math.sin(t * 30));
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill();
        break;
      }
      case 'blast': {
        const k = 1 - e.life / e.maxLife;
        glow(ctx, x, y, e.r * (1 + k), e.harmless ? '#7ef9ff' : '#ff8a3a', 1 - k);
        glow(ctx, x, y, e.r * 0.7 * (1 - k), '#ffffff', 1 - k);
        ctx.save(); ctx.strokeStyle = '#fff1c0'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 4 * (1 - k) + 1; ctx.beginPath(); ctx.arc(x, y, e.r * (0.5 + k), 0, TAU); ctx.stroke(); ctx.restore();
        break;
      }
      case 'shock': {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const h = e.h;
        ctx.fillStyle = lin(ctx, 0, y - h - 10, 0, y, ['rgba(255,140,60,0)', 'rgba(255,140,60,0.8)', '#fff1c0']);
        ctx.beginPath(); ctx.moveTo(x - e.dir * 50, y); ctx.quadraticCurveTo(x - e.dir * 10, y - h * 0.6, x, y - h - 4 + Math.sin(t * 40) * 3); ctx.quadraticCurveTo(x + e.dir * 6, y - h * 0.4, x + e.dir * 14, y); ctx.closePath(); ctx.fill();
        glow(ctx, x, y - h / 2, 30, '#ff8a3a', 0.8); ctx.restore();
        break;
      }
      case 'seeker': {
        const ang = Math.atan2(e.vy || 0, e.vx || 1), lean = G.clamp((e.vx || 0) / 300, -0.4, 0.4);
        glow(ctx, x, y, 34, SIG.warden, 0.35);
        ctx.save(); ctx.translate(x, y); ctx.rotate(lean);
        ctx.fillStyle = lin(ctx, -14, -12, 14, 12, ['#a098a8', '#3a3440']);
        poly(ctx, [-16, 0, -6, -12, 6, -12, 16, 0, 6, 12, -6, 12]); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#2a2430'; for (const sd of [-1, 1]) { poly(ctx, [sd * 14, -4, sd * 24, -10 + Math.sin(t * 30) * 3, sd * 22, 2]); ctx.fill(); }
        const ex = e.eye ? G.clamp((e.eye.x - x) / 60, -4, 4) : 0, ey = e.eye ? G.clamp((e.eye.y - y) / 60, -3, 3) : 0;
        ctx.fillStyle = '#ff2a3a'; ctx.beginPath(); ctx.arc(ex, ey, 4.5, 0, TAU); ctx.fill();
        glow(ctx, ex, ey, 14, '#ff3b4e', 0.9);
        ctx.restore(); void ang;
        break;
      }
    }
  }
  function drawPillar(ctx, e, t) {
    const heat = e.heat || 0;
    if (e.state === 'down') {
      ctx.fillStyle = '#5a4a3a';
      const r = G.rng(Math.floor(e.x));
      for (let i = 0; i < 5; i++) { ctx.save(); ctx.translate(e.x + e.w / 2 + (r() - 0.5) * 40, e.y + e.h - 6 - r() * 6); ctx.rotate(r() - 0.5); ctx.fillRect(-9, -5, 18, 10); ctx.restore(); }
      glow(ctx, e.x + e.w / 2, e.y + e.h - 8, 24, '#ff8a3a', Math.max(0, 0.6 - e.downT * 0.2));
      return;
    }
    const k = e.state === 'rising' ? ease(e.riseT) : 1, h = e.h * k, y = e.y + e.h - h;
    ctx.fillStyle = lin(ctx, e.x, y, e.x + e.w, y, ['#d8c8a8', '#8a7458', '#4a3a28']); ctx.fillRect(e.x - 4, y, e.w + 8, h);
    ctx.fillStyle = '#3a2c1c'; ctx.fillRect(e.x - 7, y, e.w + 14, 8); ctx.fillRect(e.x - 7, e.y + e.h - 8, e.w + 14, 8);
    const sigA = 0.5 + 0.4 * Math.sin(t * 3 + e.x);
    for (let i = 0; i < 4; i++) if (y + 16 + i * 20 < e.y + e.h - 10) glyphs(ctx, e.x, y + 18 + i * 20, e.w, 2, Math.floor(e.x) + i, SIG.archivist, sigA);
    glow(ctx, e.x + e.w / 2, y, 20, SIG.archivist, 0.6 * k);
    if (heat > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = heat; ctx.fillStyle = lin(ctx, 0, y, 0, y + h, ['#ff3a1a', '#ffb347', '#ff3a1a']); ctx.fillRect(e.x - 4, y, e.w + 8, h); ctx.restore();
      glow(ctx, e.x + e.w / 2, y + h / 2, 40 + heat * 30, '#ff6a3a', heat);
    }
  }
  function drawFan(ctx, e, t) {
    const hx = e.hx, hy = e.hy, d = e.dirX;
    // wind streaks across the zone when powered
    if (e.powered) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 2;
      const r = G.rng(Math.floor(e.x));
      for (let i = 0; i < 14; i++) {
        const ly = e.y + r() * e.h, sp = 0.6 + r() * 0.8, k = ((t * sp + r()) % 1);
        const lx = d > 0 ? e.x + k * e.w : e.x + e.w - k * e.w;
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.45; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + d * 40, ly + Math.sin(t * 4 + i) * 3); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save(); ctx.translate(hx, hy);
    ctx.fillStyle = '#2a241c'; ctx.fillRect(-18, -4, 36, 4);
    ctx.fillStyle = lin(ctx, -16, -70, 16, 0, ['#8a7a64', '#3a3128']); ctx.fillRect(-14, -74, 28, 72);
    ctx.translate(d * 12, -40);
    ctx.fillStyle = '#14100c'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 34, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = e.powered ? '#bfe8ff' : '#6a5a48'; ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) { const a = e.spin + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 3, Math.sin(a) * 30); ctx.stroke(); }
    glow(ctx, 0, 0, 30, e.powered ? '#7ef9ff' : '#3a3128', e.powered ? 0.6 : 0.2);
    // direction arrow lamp
    ctx.fillStyle = e.powered ? '#7ef9ff' : '#4a3a2a'; poly(ctx, [d * 14, -46, d * 24, -40, d * 14, -34]); ctx.fill();
    ctx.restore();
  }

  // ================================================================== HUD (view space)
  function icon(ctx, kind, x, y, col) {
    ctx.save(); ctx.translate(x, y); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2;
    if (kind === 'archivist') { poly(ctx, [-9, -10, 9, -10, 7, 8, 0, 12, -7, 8]); ctx.stroke(); ctx.beginPath(); ctx.arc(0, -2, 3, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, -14, 10, 3, 0, 0, TAU); ctx.stroke(); }
    else if (kind === 'colossus') { ctx.strokeRect(-9, -10, 18, 12); ctx.beginPath(); ctx.moveTo(-5, 2); ctx.lineTo(-7, 12); ctx.moveTo(5, 2); ctx.lineTo(7, 12); ctx.moveTo(4, -8); ctx.lineTo(13, -13); ctx.stroke(); }
    else { ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, TAU); ctx.fill(); for (let i = 0; i < 3; i++) { const a = i / 3 * TAU - Math.PI / 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10); ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16); ctx.stroke(); } }
    ctx.restore();
  }
  function drawHUD(ctx, b, t) {
    // letterbox
    if (b.letterbox > 0.001) {
      const h = G.CONFIG.bosses.common.letterbox * ease(b.letterbox);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, h); ctx.fillRect(0, (G.VIEW_H || 540) - h, VW, h);
    }
    if (b.hudA <= 0.01) return;
    const col = SIG[b.kind] || '#fff';
    const n = b.maxHp, gap = 6, segW = Math.min(64, 360 / n), w = n * segW + (n - 1) * gap;
    const x0 = (VW - w) / 2 + 16, y0 = 30 + (b.state === 'intro' ? (1 - ease(clamp01(b.introT / 1.2))) * -40 : 0);
    ctx.save(); ctx.globalAlpha = b.hudA;
    ctx.fillStyle = 'rgba(4,6,12,0.65)'; G.roundRect(ctx, x0 - 46, y0 - 16, w + 58, 32, 10); ctx.fill();
    ctx.strokeStyle = col + '88'; ctx.lineWidth = 1; ctx.stroke();
    icon(ctx, b.kind, x0 - 26, y0, col);
    const shown = b.state === 'intro' ? Math.min(n, Math.floor(b.introT / (G.CONFIG.bosses.common.introTime * 0.7) * (n + 1))) : b.hp;
    for (let i = 0; i < n; i++) {
      const sx = x0 + i * (segW + gap), full = i < shown;
      const justLost = i === b.hp && b.hurtT > 0;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; poly(ctx, [sx + 4, y0 - 7, sx + segW, y0 - 7, sx + segW - 4, y0 + 7, sx, y0 + 7]); ctx.fill();
      if (full || justLost) {
        ctx.fillStyle = justLost ? '#ffffff' : lin(ctx, 0, y0 - 7, 0, y0 + 7, ['#ffffff', col, col]);
        ctx.globalAlpha = b.hudA * (justLost ? b.hurtT / G.CONFIG.bosses.common.hurtTime : 1);
        poly(ctx, [sx + 4, y0 - 7, sx + segW, y0 - 7, sx + segW - 4, y0 + 7, sx, y0 + 7]); ctx.fill();
        ctx.globalAlpha = b.hudA;
      }
    }
    // phase pips under the bar
    for (let i = 0; i < 3; i++) { ctx.fillStyle = i <= b.phase ? col : 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(x0 + w / 2 - 14 + i * 14, y0 + 13, 2.5, 0, TAU); ctx.fill(); }
    // vulnerable cue: the bar pulses white while the boss can be hit
    const vulnerable = b.exposed || b.ventOpen;
    if (vulnerable) { ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = b.hudA * (0.4 + 0.4 * Math.sin(t * 10)); ctx.lineWidth = 2; G.roundRect(ctx, x0 - 48, y0 - 18, w + 62, 36, 11); ctx.stroke(); }
    ctx.restore();
  }

  function draw(ctx, e, t) {
    if (e.type === 'boss') {
      if (e.kind === 'colossus') drawColossus(ctx, e, t);
      else if (e.kind === 'warden') drawWarden(ctx, e, t);
      else drawArchivist(ctx, e, t);
      return;
    }
    if (e.kind === 'pillar') return drawPillar(ctx, e, t);
    if (e.kind === 'fan') return drawFan(ctx, e, t);
    drawProj(ctx, e, t);
  }

  G.Art = G.Art || {};
  G.Art.Bosses = { draw, drawHUD, SIG };
})();
