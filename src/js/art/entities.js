/**
 * TESSERA — entity art: mechanisms, props, hazards and collectibles.
 *
 * Contract: docs/level-format.md §4. `G.Art.Entities.draw(ctx, e, t, level)` is called in
 * WORLD space (ctx already camera-translated) once per visible entity per frame.
 *
 * Design language
 *  - Two families, picked from `level.biome`:
 *      HUMAN (ship, wreck): painted steel, hazard stripes, rivets, LEDs. Wreck = grimier, rust.
 *      ARCHITECT (desert, canyon, ruins, caves, crystal, tower): weathered stone + bronze with
 *      glowing glyph channels (biome-tinted energy colour, amber secondary).
 *  - Universal gameplay colours (never biome-tinted): red = danger / locked, green = ok / open,
 *    teal = checkpoint (safe), warm yellow = carryable part, cyan = jump energy / shards.
 *  - Key light from the upper-left: diagonal body gradients, 1px rim light on top/left edges,
 *    shade on bottom/right, contact shadows nudged to the right.
 *
 * Performance
 *  - Static bodies are painted once into offscreen canvases keyed by type+palette+size
 *    (and render scale) and blitted; only the animated layers are drawn live.
 *  - Glows use a cached radial sprite with 'lighter' compositing (no shadowBlur).
 *  - Ambient particles go through G.fx and are rate-limited per entity with level time.
 */
(function () {
  'use strict';
  const T = G.TILE;
  const TAU = Math.PI * 2;
  const VW = G.VIEW_W || 960, VH = G.VIEW_H || 540;

  // ------------------------------------------------------------------ math / easing
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3);
  const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const easeOutBack = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
  /** Cheap deterministic hash → [0,1). */
  const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ------------------------------------------------------------------ colours
  const C = {
    ok: '#5dffa0', bad: '#ff3b55', warn: '#ffb347',
    hazA: '#f2b22e', hazB: '#1b1a1f',
    laser: '#ff2350', laserMid: '#ff5a78', laserCore: '#fff3f6',
    item: '#ffd760', safe: '#6dffc8', jump: '#7ef9ff', shard: '#7ef9ff',
  };
  const rgbaMemo = new Map();
  /** '#rrggbb' + alpha → css rgba() (memoised, alpha rounded to 1/100). */
  function rgba(hex, a) {
    a = Math.round(clamp01(a) * 100) / 100;
    const k = hex + a;
    let v = rgbaMemo.get(k);
    if (!v) {
      const n = parseInt(hex.slice(1), 16);
      v = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
      if (rgbaMemo.size > 4000) rgbaMemo.clear();
      rgbaMemo.set(k, v);
    }
    return v;
  }

  // ------------------------------------------------------------------ palettes
  const STONE = {
    desert: ['#dcc096', '#a3845e', '#4a3826'],
    canyon: ['#d3a487', '#93654d', '#40291f'],
    ruins: ['#bab6a0', '#7c7a6c', '#33332b'],
    caves: ['#929ba8', '#5a616c', '#1f232a'],
    crystal: ['#a197c0', '#62597c', '#252036'],
    tower: ['#909cb0', '#535d6e', '#1b2029'],
  };
  const GLYPH = {
    desert: ['#7ef9ff', '#ffb347'], canyon: ['#7ef9ff', '#ff9f4a'], ruins: ['#7ef9ff', '#ffcf6b'],
    caves: ['#5affd2', '#7ef9ff'], crystal: ['#c9a0ff', '#7ef9ff'], tower: ['#9ff4ff', '#ffcf6b'],
  };
  const palCache = {};
  /** Resolve the style palette for a level (memoised per biome+variant). */
  function palette(level) {
    const biome = (level && level.biome) || 'ruins';
    const variant = (level && level.def && level.def.variant) || '';
    const key = biome + (variant ? ':' + variant : '');
    if (palCache[key]) return palCache[key];
    let p;
    if (biome === 'ship' || biome === 'wreck') {
      const wreck = biome === 'wreck';
      p = {
        key, human: true, wreck,
        metal: wreck ? ['#a39a8c', '#635c53', '#25211d'] : ['#a3afbf', '#5f6a7a', '#212833'],
        panel: wreck ? '#3f3a34' : '#343d4b',
        paint: wreck ? '#a8652a' : '#c98f22',
        crate: wreck ? ['#8a7a52', '#5b4f33', '#2a2417'] : ['#6f8094', '#465466', '#1e2530'],
        accent: wreck ? '#ffb347' : '#5fd8ff',
        glyph: wreck ? '#ffb347' : '#5fd8ff', glyph2: '#ffcf6b', rust: '#8a4a26',
      };
    } else {
      const g = GLYPH[biome] || GLYPH.ruins;
      p = {
        key, human: false, biome,
        stone: STONE[biome] || STONE.ruins,
        bronze: biome === 'tower' || biome === 'caves' ? ['#d0ad74', '#7e5d33', '#2f200d'] : ['#efc888', '#a27843', '#402b14'],
        glyph: g[0], glyph2: g[1], moss: variant === 'overgrown',
      };
      p.metal = p.bronze; p.accent = p.glyph;
    }
    return (palCache[key] = p);
  }

  // ------------------------------------------------------------------ sprite cache
  const cache = new Map();
  let cacheScale = 0;
  /** Supersampling factor for cached sprites so they stay crisp under the view scale. */
  function spriteScale() {
    const s = Math.max(1, Math.min(3, Math.ceil((G.renderScale || 1) - 0.01)));
    if (s !== cacheScale) { cache.clear(); cacheScale = s; }
    return s;
  }
  /**
   * Get (or paint once) an offscreen sprite. `paint(g, w, h)` draws in logical px with
   * (0,0) at the sprite's logical origin; `pad` px of margin is available on every side.
   */
  function sprite(key, w, h, pad, paint) {
    const S = spriteScale();
    let c = cache.get(key);
    if (c) return c;
    if (cache.size > 500) cache.clear();
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((w + pad * 2) * S));
    c.height = Math.max(1, Math.ceil((h + pad * 2) * S));
    const g = c.getContext('2d');
    g.scale(S, S); g.translate(pad, pad);
    paint(g, w, h);
    c.pad = pad; c.lw = w + pad * 2; c.lh = h + pad * 2;
    cache.set(key, c);
    return c;
  }
  /** Draw a cached sprite with its logical origin at (x, y). */
  function blit(ctx, c, x, y) { ctx.drawImage(c, x - c.pad, y - c.pad, c.lw, c.lh); }

  function glowSprite(color) {
    return sprite('glow:' + color, 64, 64, 0, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(color, 1));
      gr.addColorStop(0.18, rgba(color, 0.62));
      gr.addColorStop(0.45, rgba(color, 0.2));
      gr.addColorStop(1, rgba(color, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
  }
  /** Additive soft glow ellipse centred on (x, y). */
  function glow(ctx, x, y, rx, ry, color, a) {
    if (a <= 0.01) return;
    const c = glowSprite(color);
    const pa = ctx.globalAlpha, pc = ctx.globalCompositeOperation;
    ctx.globalAlpha = pa * Math.min(1, a);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(c, x - rx, y - ry, rx * 2, ry * 2);
    ctx.globalAlpha = pa; ctx.globalCompositeOperation = pc;
  }
  /** Soft contact shadow on the floor. */
  function shadow(ctx, x, y, rx, ry, a) {
    const c = sprite('shadow', 64, 64, 0, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
    const pa = ctx.globalAlpha;
    ctx.globalAlpha = pa * a;
    ctx.drawImage(c, x - rx, y - ry, rx * 2, ry * 2);
    ctx.globalAlpha = pa;
  }

  /** Rate limiter for ambient fx: true roughly once per `interval` seconds of level time. */
  function every(e, key, t, interval) {
    const n = e[key];
    if (n == null || t < n - interval * 3) { e[key] = t + interval * Math.random(); return false; }
    if (t >= n) { e[key] = t + interval * (0.6 + Math.random() * 0.8); return true; }
    return false;
  }
  /** Is a world point inside the current camera view (+margin)? Used to gate fx spawns. */
  function inView(x, y, m = 40) {
    const g = G.game;
    if (!g || !g.cam) return true;
    return x > g.cam.x - m && x < g.cam.x + VW + m && y > g.cam.y - m && y < g.cam.y + VH + m;
  }
  function sparks(x, y, opts) {
    if (!G.fx || !inView(x, y)) return;
    G.fx.burst(x, y, Object.assign({ count: 4, color: ['#fff6c8', '#ffd060', '#ffffff'], speed: 160, life: 0.35, size: 2, gravity: 500, shape: 'spark', glow: true }, opts));
  }

  // ------------------------------------------------------------------ paint primitives (sprites)
  /** Body fill lit from the upper-left: cols = [light, base, dark]. */
  function bevel(g, x, y, w, h, cols, r = 0, rim = 0.3) {
    const gr = g.createLinearGradient(x, y, x + w * 0.7, y + h);
    gr.addColorStop(0, cols[0]); gr.addColorStop(0.42, cols[1]); gr.addColorStop(1, cols[2]);
    g.fillStyle = gr;
    if (r) { G.roundRect(g, x, y, w, h, r); g.fill(); } else g.fillRect(x, y, w, h);
    if (rim) {
      g.fillStyle = `rgba(255,255,255,${rim})`; g.fillRect(x + r * 0.6, y, w - r * 1.2, 1); g.fillRect(x, y + r * 0.6, 1, h - r * 1.2);
      g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(x + r * 0.6, y + h - 1, w - r * 1.2, 1); g.fillRect(x + w - 1, y + r * 0.6, 1, h - r * 1.2);
    }
  }
  function rivet(g, x, y, r = 1.3) {
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(x + 0.4, y + 0.5, r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(x - 0.3, y - 0.3, r * 0.6, 0, TAU); g.fill();
  }
  function hazard(g, x, y, w, h, step = 6) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = C.hazA; g.fillRect(x, y, w, h);
    g.fillStyle = C.hazB;
    for (let i = -h - step; i < w + h; i += step * 2) {
      g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + step, y + h); g.lineTo(x + i + step + h, y); g.lineTo(x + i + h, y); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, w, 0.8);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + h - 0.8, w, 0.8);
    g.restore();
  }
  /** Carved stone grain: a few random darker / lighter flecks and a crack or two. */
  function grain(g, x, y, w, h, seed, crack = true) {
    const r = G.rng(seed);
    for (let i = 0; i < (w * h) / 40; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
      g.fillRect(x + r() * w, y + r() * h, 1 + r() * 2, 1);
    }
    if (crack) {
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.8;
      g.beginPath();
      let cx = x + r() * w, cy = y;
      g.moveTo(cx, cy);
      for (let i = 0; i < 4; i++) { cx += (r() - 0.5) * 6; cy += h * (0.08 + r() * 0.1); g.lineTo(cx, cy); }
      g.stroke();
    }
  }
  /**
   * Architect glyph: a rune of 3–4 strokes on a 3×3 grid plus a dot. Deterministic per seed.
   * Draws strokes only (caller sets strokeStyle / lineWidth).
   */
  function rune(g, cx, cy, s, seed) {
    const r = G.rng(seed * 9973 + 17);
    const P = () => [Math.floor(r() * 3) - 1, Math.floor(r() * 3) - 1];
    g.beginPath();
    let [ax, ay] = P();
    g.moveTo(cx + ax * s, cy + ay * s);
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      let [bx, by] = P();
      if (bx === ax && by === ay) by = -by || 1;
      g.lineTo(cx + bx * s, cy + by * s); ax = bx; ay = by;
    }
    if (r() < 0.5) { g.moveTo(cx + s * 0.9, cy); g.arc(cx, cy, s * 0.9, 0, Math.PI * (0.5 + r())); }
    g.stroke();
    g.beginPath(); g.arc(cx + (r() < 0.5 ? -s : s) * 0.5, cy + s * 1.35, 0.7, 0, TAU); g.fill();
  }
  function moss(g, x, y, w, seed) {
    const r = G.rng(seed);
    for (let i = 0; i < w / 3; i++) {
      const mx = x + r() * w, mh = 1 + r() * 3;
      g.fillStyle = r() < 0.5 ? '#5f8a3a' : '#7aa848';
      g.beginPath(); g.ellipse(mx, y + 0.5, 1.5 + r() * 2, mh * 0.6, 0, 0, TAU); g.fill();
      if (r() < 0.3) { g.fillRect(mx, y, 0.8, mh + 2); }
    }
  }

  // ======================================================================================
  // DOOR
  // ======================================================================================
  function drawDoor(ctx, e, t, P) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const o = clamp01(e.openT || 0);
    const moving = o > 0.002 && o < 0.998;
    if (e._po != null && e._po > 0 && o === 0 && G.fx && inView(x, y)) G.fx.dust(x + w / 2, y + h, 8);
    e._po = o;
    if (moving && every(e, '_dustT', t, 0.16)) G.fx && G.fx.dust(x + w / 2, y + h, 2);
    // ease with a little overshoot as it arrives fully open
    let k = easeInOutCubic(o) + 0.06 * Math.sin(clamp01((o - 0.82) / 0.18) * Math.PI);
    const jx = moving ? (hash1(Math.floor(t * 45)) - 0.5) * 1.6 : 0;
    const jy = moving ? (hash1(Math.floor(t * 45) + 7) - 0.5) * 0.8 : 0;
    const status = o >= 0.6 ? C.ok : moving ? (Math.sin(t * 22) > 0 ? C.warn : '#7a4a20') : C.bad;
    shadow(ctx, x + w / 2 + 3, y + h, w * 0.8, 3, 0.35);
    if (P.human) humanDoor(ctx, e, t, P, x, y, w, h, k, jx, jy, status);
    else archDoor(ctx, e, t, P, x, y, w, h, k, jx, jy, status, o);
  }

  function humanDoor(ctx, e, t, P, x, y, w, h, k, jx, jy, status) {
    const px = x + 3, py = y + 7, pw = w - 6, ph = h - 10, half = ph / 2;
    const key = `doorH:${P.key}:${pw}x${ph}`;
    const vy = (u) => half - 5 + 10 * (1 - Math.abs(u / pw - 0.5) * 2); // V seam (point down)
    const paintPanel = (top) => (g) => {
      g.save();
      g.beginPath();
      if (top) { g.moveTo(0, 0); g.lineTo(pw, 0); g.lineTo(pw, vy(pw)); g.lineTo(pw / 2, vy(pw / 2)); g.lineTo(0, vy(0)); }
      else { g.moveTo(0, vy(0)); g.lineTo(pw / 2, vy(pw / 2)); g.lineTo(pw, vy(pw)); g.lineTo(pw, ph); g.lineTo(0, ph); }
      g.closePath(); g.clip();
      bevel(g, 0, top ? 0 : half - 6, pw, half + 6, P.metal, 0, 0);
      // inset panel + rib
      const y0 = top ? 4 : half + 9, y1 = top ? half - 13 : ph - 4;
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(4, y0, pw - 8, y1 - y0);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(4, y1, pw - 8, 1); g.fillRect(pw - 5, y0, 1, y1 - y0);
      g.fillStyle = P.panel; g.fillRect(5, y0 + 1, pw - 10, y1 - y0 - 1);
      const rib = (y0 + y1) / 2;
      bevel(g, 2, rib - 2, pw - 4, 4, P.metal, 0, 0.25);
      if (top && pw >= 20) { g.fillStyle = '#0c1118'; g.fillRect(pw / 2 - 5, y0 + 3, 10, 3); g.fillStyle = rgba(P.accent, 0.35); g.fillRect(pw / 2 - 4, y0 + 3.5, 8, 1); }
      // hazard band following the V seam
      g.save();
      g.beginPath();
      const s = top ? -1 : 1;
      g.moveTo(0, vy(0)); g.lineTo(pw / 2, vy(pw / 2)); g.lineTo(pw, vy(pw));
      g.lineTo(pw, vy(pw) + 8 * s); g.lineTo(pw / 2, vy(pw / 2) + 8 * s); g.lineTo(0, vy(0) + 8 * s); g.closePath();
      g.clip();
      hazard(g, 0, half - 16, pw, 32, 4);
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, vy(0)); g.lineTo(pw / 2, vy(pw / 2)); g.lineTo(pw, vy(pw)); g.stroke();
      // rivets
      const ry = top ? [3, half - 15] : [half + 11, ph - 3];
      for (const yy of ry) { rivet(g, 2.5, yy); rivet(g, pw - 2.5, yy); }
      if (P.wreck) {
        const r = G.rng(G.hash(key) + (top ? 1 : 2));
        for (let i = 0; i < 4; i++) { g.fillStyle = rgba(P.rust, 0.35 + r() * 0.3); g.fillRect(r() * pw, top ? r() * half : half + r() * half, 1 + r() * 2, 4 + r() * 10); }
      }
      g.restore();
    };
    const top = sprite(key + ':t', pw, ph, 0, paintPanel(true));
    const bot = sprite(key + ':b', pw, ph, 0, paintPanel(false));
    const d = (half + 6) * k;
    // frame recess behind the panels
    ctx.fillStyle = '#07090d'; ctx.fillRect(px, py, pw, ph);
    if (k > 0.02) {
      // light leaking through the opening gap
      const gy = py + half;
      glow(ctx, x + w / 2, gy, pw * 0.8, Math.max(4, d), P.accent, 0.12 * Math.min(1, k * 3));
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    ctx.drawImage(top, px + jx, py - d + jy, pw, ph);
    ctx.drawImage(bot, px + jx, py + d + jy, pw, ph);
    ctx.restore();
    // static frame: jambs, header with status light, threshold
    const frame = sprite(`doorHF:${P.key}:${w}x${h}`, w, h, 2, (g) => {
      bevel(g, 0, 0, 3, h, P.metal, 0, 0.3);
      bevel(g, w - 3, 0, 3, h, P.metal, 0, 0.3);
      bevel(g, -1, -1, w + 2, 8, P.metal, 0, 0.35);
      hazard(g, 1, 4.5, w - 2, 2.5, 3);
      g.fillStyle = '#0a0d12'; g.fillRect(w / 2 - 4, 0.5, 8, 3.5);
      bevel(g, -1, h - 3, w + 2, 3, P.metal, 0, 0.25);
      for (let yy = 12; yy < h - 6; yy += 16) { rivet(g, 1.5, yy, 0.9); rivet(g, w - 1.5, yy, 0.9); }
    });
    blit(ctx, frame, x, y);
    ctx.fillStyle = status; ctx.fillRect(x + w / 2 - 3, y + 1, 6, 2.5);
    glow(ctx, x + w / 2, y + 2, 9, 6, status, 0.85);
  }

  function archDoor(ctx, e, t, P, x, y, w, h, k, jx, jy, status, o) {
    const px = x + 4, py = y + 8, pw = w - 8, ph = h - 8;
    const key = `doorA:${P.key}:${pw}x${ph}`;
    const sr = Math.max(5, Math.min(pw / 2 - 2.5, 10));
    const scy = ph * 0.5;
    const slab = sprite(key, pw, ph, 0, (g) => {
      bevel(g, 0, 0, pw, ph, P.stone, 0, 0.25);
      grain(g, 0, 0, pw, ph, G.hash(key));
      // carved border
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.strokeRect(2.5, 2.5, pw - 5, ph - 5);
      g.strokeStyle = 'rgba(255,255,255,0.14)'; g.strokeRect(3.5, 3.5, pw - 5, ph - 5);
      // glyph channel grooves (dark carved)
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.fillStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(pw / 2, 6); g.lineTo(pw / 2, scy - sr - 2); g.moveTo(pw / 2, scy + sr + 2); g.lineTo(pw / 2, ph - 6); g.stroke();
      for (let i = 0; i < 2; i++) rune(g, pw / 2, 14 + i * 12, 2.6, i + 3);
      rune(g, pw / 2, ph - 14, 2.6, 9);
      // seal disc
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(pw / 2 + 0.6, scy + 0.8, sr + 1.5, 0, TAU); g.fill();
      const bg = g.createLinearGradient(pw / 2 - sr, scy - sr, pw / 2 + sr, scy + sr);
      bg.addColorStop(0, P.bronze[0]); bg.addColorStop(0.5, P.bronze[1]); bg.addColorStop(1, P.bronze[2]);
      g.fillStyle = bg; g.beginPath(); g.arc(pw / 2, scy, sr, 0, TAU); g.fill();
      g.fillStyle = P.stone[2]; g.beginPath(); g.arc(pw / 2, scy, sr - 2.4, 0, TAU); g.fill();
      if (P.moss) moss(g, 1, 1, pw - 2, G.hash(key) + 5);
    });
    // glyph light overlay, tinted per state colour
    const lit = (col) => sprite(`doorAG:${pw}x${ph}:${col}`, pw, ph, 0, (g) => {
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(pw / 2, 6); g.lineTo(pw / 2, scy - sr - 2); g.moveTo(pw / 2, scy + sr + 2); g.lineTo(pw / 2, ph - 6); g.stroke();
      for (let i = 0; i < 2; i++) rune(g, pw / 2, 14 + i * 12, 2.6, i + 3);
      rune(g, pw / 2, ph - 14, 2.6, 9);
      g.lineWidth = 1.2; g.beginPath(); g.arc(pw / 2, scy, sr - 3.6, 0, TAU); g.stroke();
      rune(g, pw / 2, scy, Math.max(1.6, sr * 0.32), 21);
    });
    const powered = !!e.powered;
    const col = powered || o > 0.5 ? P.glyph : C.bad;
    const pulse = powered ? 0.85 + 0.15 * Math.sin(t * 9) : 0.45 + 0.25 * Math.sin(t * 2.6);
    const d = ph * k;
    ctx.fillStyle = '#06070a'; ctx.fillRect(px, py, pw, ph);
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    const sx = px + jx, sy = py - d + jy;
    ctx.drawImage(slab, sx, sy, pw, ph);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = pulse;
    ctx.drawImage(lit(col), sx, sy, pw, ph);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    glow(ctx, sx + pw / 2, sy + scy, sr * 2.4, sr * 2.4, col, 0.5 * pulse);
    // seal splitting as it unlocks: rotating ring segment
    if (powered && o < 1) {
      ctx.strokeStyle = rgba(P.glyph, 0.9); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx + pw / 2, sy + scy, sr + 1, t * 6, t * 6 + 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(sx + pw / 2, sy + scy, sr + 1, t * 6 + Math.PI, t * 6 + Math.PI + 2); ctx.stroke();
    }
    ctx.restore();
    // fixed stone frame: jamb pillars + lintel with state lamp
    const frame = sprite(`doorAF:${P.key}:${w}x${h}`, w, h, 3, (g) => {
      bevel(g, 0, 4, 4, h - 4, P.stone, 0, 0.25);
      bevel(g, w - 4, 4, 4, h - 4, P.stone, 0, 0.25);
      bevel(g, -2, -1, w + 4, 9, P.stone, 1, 0.3);
      grain(g, -2, -1, w + 4, 9, G.hash('lintel' + w), false);
      g.fillStyle = P.bronze[1]; g.fillRect(-2, 7, w + 4, 1.5);
      g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(w / 2, 3.5, 2.6, 0, TAU); g.fill();
      if (P.moss) moss(g, -2, -1, w + 4, G.hash('dm' + w));
    });
    blit(ctx, frame, x, y);
    ctx.fillStyle = status; ctx.beginPath(); ctx.arc(x + w / 2, y + 3.5, 1.8, 0, TAU); ctx.fill();
    glow(ctx, x + w / 2, y + 3.5, 9, 7, status, 0.9);
    if (k > 0.05) glow(ctx, x + w / 2, py + ph, pw, 3, P.glyph, 0.25 * k);
  }

  // ======================================================================================
  // BRIDGE
  // ======================================================================================
  function drawBridge(ctx, e, t, P) {
    const x = e.x, y = e.y, w = e.w;
    const ex = clamp01(e.extendT || 0);
    const f = easeOutCubic(clamp01(ex / 0.6));
    const solid = clamp01((ex - 0.6) / 0.25);
    const anc = 5, half = w / 2 - anc;
    const L = f * half;
    // lock "clunk": brief dip just after it becomes solid
    const dip = ex > 0.6 && ex < 0.85 ? Math.sin(((ex - 0.6) / 0.25) * Math.PI) * 1.2 : 0;
    if (ex < 0.02) {
      // ghost outline hints where the bridge will appear
      ctx.strokeStyle = rgba(P.human ? C.hazA : P.glyph, 0.16 + 0.06 * Math.sin(t * 2));
      ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + anc + 2, y + 1.5); ctx.lineTo(x + w - anc - 2, y + 1.5); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (P.human) {
      const deck = sprite(`bridgeH:${P.key}:${Math.ceil(half)}`, Math.ceil(half) + 1, 20, 1, (g, hw) => {
        // under-truss
        g.strokeStyle = P.metal[2]; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(0, 17); g.lineTo(hw, 17);
        for (let xx = 0; xx < hw; xx += 10) { g.moveTo(xx, 8); g.lineTo(xx + 5, 17); g.lineTo(xx + 10, 8); }
        g.stroke();
        g.strokeStyle = P.metal[1]; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(0, 16.5); g.lineTo(hw, 16.5); g.stroke();
        // deck plate
        bevel(g, 0, 0, hw, 8, P.metal, 0, 0.35);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let xx = 2; xx < hw - 6; xx += 4) g.fillRect(xx, 2.5 + ((xx / 4) % 2), 2, 1);
        for (let xx = 16; xx < hw; xx += 16) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(xx, 0, 1, 8); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(xx + 1, 0, 0.6, 8); }
        g.fillStyle = C.hazA; g.fillRect(0, 0, hw, 1);
        hazard(g, hw - 6, 0, 6, 8, 3);
      });
      const yy = y + dip;
      for (let side = 0; side < 2; side++) {
        if (L < 0.5) break;
        ctx.save();
        if (side) { ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
        ctx.beginPath(); ctx.rect(x + anc, yy - 2, L, 24); ctx.clip();
        blit(ctx, deck, x + anc + L - deck.lw + deck.pad * 2 - 1, yy);
        ctx.restore();
      }
      // anchors
      const a = sprite(`bridgeHA:${P.key}`, anc, 18, 2, (g) => { bevel(g, 0, -3, anc, 21, P.metal, 1, 0.35); g.fillStyle = '#0a0d12'; g.fillRect(1, 9, anc - 2, 4); });
      blit(ctx, a, x, y); blit(ctx, a, x + w - anc, y);
      const led = solid > 0.5 ? C.ok : ex > 0.01 ? C.warn : C.bad;
      for (const lx of [x + anc / 2, x + w - anc / 2]) { ctx.fillStyle = led; ctx.fillRect(lx - 1.2, y + 10, 2.4, 2); glow(ctx, lx, y + 11, 6, 5, led, 0.8); }
      if (ex > 0.01 && ex < 0.6 && every(e, '_fxT', t, 0.12)) {
        sparks(x + anc + L, y + 4, { count: 2, speed: 90, angle: Math.PI / 2, spread: 2 });
        sparks(x + w - anc - L, y + 4, { count: 2, speed: 90, angle: Math.PI / 2, spread: 2 });
      }
    } else {
      // hard-light bridge
      const col = P.glyph;
      const fl = solid < 1 ? 0.65 + 0.35 * Math.abs(Math.sin(t * 31) * Math.sin(t * 13)) : 0.92 + 0.08 * Math.sin(t * 5);
      const a = (0.35 + 0.55 * solid) * fl;
      if (L > 0.5) {
        const segs = [[x + anc, L], [x + w - anc - L, L]];
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const [sx, sw] of segs) {
          const ug = ctx.createLinearGradient(0, y + 3, 0, y + 26);
          ug.addColorStop(0, rgba(col, 0.28 * a)); ug.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = ug; ctx.fillRect(sx, y + 3, sw, 23);
          const bg = ctx.createLinearGradient(0, y, 0, y + 7);
          bg.addColorStop(0, rgba('#ffffff', 0.85 * a)); bg.addColorStop(0.25, rgba(col, 0.75 * a)); bg.addColorStop(1, rgba(col, 0.18 * a));
          ctx.fillStyle = bg; ctx.fillRect(sx, y, sw, 7);
        }
        // flowing hex/chevron pattern toward the centre
        ctx.beginPath(); ctx.rect(x + anc, y, L, 7); ctx.rect(x + w - anc - L, y, L, 7); ctx.clip();
        ctx.strokeStyle = rgba('#ffffff', 0.32 * a); ctx.lineWidth = 0.8;
        ctx.beginPath();
        const off = (t * 14) % 8;
        for (let xx = x - 8 + off; xx < x + w / 2; xx += 8) { ctx.moveTo(xx, y + 1); ctx.lineTo(xx + 3, y + 3.5); ctx.lineTo(xx, y + 6); }
        for (let xx = x + w + 8 - off; xx > x + w / 2; xx -= 8) { ctx.moveTo(xx, y + 1); ctx.lineTo(xx - 3, y + 3.5); ctx.lineTo(xx, y + 6); }
        ctx.stroke();
        ctx.restore();
        if (f < 0.999) {
          glow(ctx, x + anc + L, y + 3, 9, 9, col, 0.9);
          glow(ctx, x + w - anc - L, y + 3, 9, 9, col, 0.9);
        } else if (solid >= 1) {
          // seam where both halves met
          glow(ctx, x + w / 2, y + 3, 5 + Math.sin(t * 3) * 1.5, 6, col, 0.35);
        }
      }
      const em = sprite(`bridgeAE:${P.key}`, anc + 2, 16, 3, (g) => {
        bevel(g, 0, -3, anc + 2, 17, P.bronze, 1, 0.35);
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(1, 1, anc, 6);
      });
      const on = ex > 0.01;
      for (const side of [0, 1]) {
        const exx = side ? x + w - anc - 2 : x;
        blit(ctx, em, exx, y);
        const cxx = exx + (anc + 2) / 2;
        ctx.fillStyle = on ? rgba('#ffffff', 0.9) : rgba(col, 0.35);
        ctx.beginPath(); ctx.moveTo(cxx, y + 1); ctx.lineTo(cxx + 2, y + 4); ctx.lineTo(cxx, y + 7); ctx.lineTo(cxx - 2, y + 4); ctx.closePath(); ctx.fill();
        glow(ctx, cxx, y + 4, on ? 10 : 6, on ? 10 : 6, col, on ? 0.75 : 0.18 + 0.08 * Math.sin(t * 2));
      }
    }
  }

  // ======================================================================================
  // LEVER
  // ======================================================================================
  function drawLever(ctx, e, t, P) {
    const x = e.x, y = e.y, cx = x + 16;
    const ft = clamp01(e.flipT || 0);
    // overshoot in the direction of travel
    const k = e.active ? easeOutBack(ft, 2.2) : 1 - easeOutBack(1 - ft, 2.2);
    const ang = lerp(-0.72, 0.72, k);
    const piv = { x: cx, y: y + 23 };
    shadow(ctx, cx + 3, y + 32, 15, 3, 0.4);
    // handle
    const len = 17;
    ctx.save();
    ctx.translate(piv.x, piv.y); ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#11151b'; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len); ctx.stroke();
    ctx.strokeStyle = P.human ? P.metal[0] : P.bronze[0]; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-0.4, 0); ctx.lineTo(-0.4, -len); ctx.stroke();
    ctx.restore();
    const kx = piv.x + Math.sin(ang) * len, ky = piv.y - Math.cos(ang) * len;
    const invite = !e.active && !(e.oneShot && e.active);
    if (P.human) {
      const kg = ctx.createRadialGradient(kx - 1.2, ky - 1.4, 0.5, kx, ky, 4.2);
      kg.addColorStop(0, '#ffb0a0'); kg.addColorStop(0.45, '#e2402f'); kg.addColorStop(1, '#5a120c');
      ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ky, 4, 0, TAU); ctx.fill();
      if (invite) glow(ctx, kx, ky, 10, 10, '#ff8a5a', 0.22 + 0.14 * Math.sin(t * 4));
    } else {
      const col = e.active ? P.glyph : P.glyph2;
      ctx.fillStyle = '#0b0d10';
      ctx.beginPath(); ctx.moveTo(kx, ky - 5.2); ctx.lineTo(kx + 3.4, ky); ctx.lineTo(kx, ky + 4); ctx.lineTo(kx - 3.4, ky); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(kx, ky - 4.2); ctx.lineTo(kx + 2.5, ky); ctx.lineTo(kx, ky + 3); ctx.lineTo(kx - 2.5, ky); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(kx - 1, ky - 2.5, 1, 2.2);
      glow(ctx, kx, ky, 11, 11, col, 0.45 + 0.2 * Math.sin(t * 4));
    }
    // base (drawn over the handle root)
    const base = sprite(`leverB:${P.key}`, 26, 11, 2, (g) => {
      if (P.human) {
        bevel(g, 0, 2, 26, 9, P.metal, 1.5, 0.35);
        hazard(g, 1, 7.5, 24, 3, 3);
        g.fillStyle = '#07090c'; G.roundRect(g, 4, 0, 18, 4, 2); g.fill();
        rivet(g, 3, 5, 0.9); rivet(g, 23, 5, 0.9);
      } else {
        bevel(g, 1, 3, 24, 8, P.stone, 1, 0.25);
        grain(g, 1, 3, 24, 8, 77, false);
        bevel(g, 0, 1, 26, 3.5, P.bronze, 1, 0.4);
        g.fillStyle = '#07090c'; G.roundRect(g, 6, 0, 14, 3, 1.5); g.fill();
      }
    });
    blit(ctx, base, x + 3, y + 21);
    // pivot cap
    ctx.fillStyle = P.human ? P.metal[1] : P.bronze[1];
    ctx.beginPath(); ctx.arc(piv.x, piv.y, 2.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(piv.x - 0.7, piv.y - 0.8, 1, 0, TAU); ctx.fill();
    // indicator lamp
    const lc = e.active ? C.ok : C.bad;
    const lx = P.human ? x + 9 : cx, ly = P.human ? y + 26.2 : y + 28;
    ctx.fillStyle = lc; ctx.beginPath(); ctx.arc(lx, ly, 1.5, 0, TAU); ctx.fill();
    glow(ctx, lx, ly, 7, 6, lc, e.active ? 0.95 : 0.55 + 0.25 * Math.sin(t * 3));
    if (P.human) { const l2 = e.active ? '#1d3a25' : '#3a1a1a'; ctx.fillStyle = l2; ctx.beginPath(); ctx.arc(x + 23, y + 26.2, 1.5, 0, TAU); ctx.fill(); }
  }

  // ======================================================================================
  // PRESSURE PLATE
  // ======================================================================================
  function drawPlate(ctx, e, t, P) {
    const x = e.x, y = e.y, w = e.w;
    const p = clamp01(e.pressT || 0);
    const sink = easeOutBack(p, 2.5) * 2.6;
    const col = e.active ? C.ok : C.warn;
    if (p > 0.05) glow(ctx, x + w / 2, y + 2, w * 0.65, 12, e.active ? C.ok : P.glyph, 0.35 * p);
    const top = sprite(`plateT:${P.key}:${w}`, w - 6, 4, 1, (g, pw) => {
      if (P.human) { bevel(g, 0, 0, pw, 4, P.metal, 1, 0.4); hazard(g, 2, 0.6, pw - 4, 1.8, 2.5); }
      else {
        bevel(g, 0, 0, pw, 4, P.bronze, 1, 0.45);
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(3, 1.6, pw - 6, 1);
      }
    });
    blit(ctx, top, x + 3, y + sink);
    if (!P.human) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(e.active ? P.glyph : P.glyph2, e.active ? 0.95 : 0.35 + 0.15 * Math.sin(t * 2.5));
      ctx.fillRect(x + 6, y + sink + 1.6, w - 12, 1);
      ctx.globalCompositeOperation = 'source-over';
    }
    const frame = sprite(`plateF:${P.key}:${w}`, w, 4, 1, (g) => {
      if (P.human) bevel(g, 0, 0, w, 4, ['#4a5260', '#2a3039', '#111418'], 1, 0.3);
      else bevel(g, 0, 0, w, 4, P.stone, 1, 0.3);
      g.fillStyle = '#05070a'; g.fillRect(2.5, 0, w - 5, 1.2);
    });
    blit(ctx, frame, x, y + 2);
    // LED row
    for (let lx = x + 6; lx <= x + w - 6; lx += 6) {
      ctx.fillStyle = e.active ? col : rgba(col, 0.55 + 0.3 * Math.sin(t * 3 + lx * 0.2));
      ctx.fillRect(lx - 0.8, y + 4, 1.6, 1.2);
    }
    glow(ctx, x + w / 2, y + 4.6, w * 0.6, 4, col, e.active ? 0.6 : 0.2);
  }

  // ======================================================================================
  // TERMINAL
  // ======================================================================================
  function drawTerminal(ctx, e, t, P) {
    const x = e.x, y = e.y, cx = x + 16;
    const solved = !!e.solved;
    const col = solved ? C.ok : P.human ? P.accent : P.glyph;
    shadow(ctx, cx + 3, y + 64, 16, 3, 0.45);
    if (P.human) {
      const body = sprite(`termH:${P.key}`, 32, 64, 2, (g) => {
        bevel(g, 5, 57, 22, 7, P.metal, 1.5, 0.35);
        bevel(g, 10, 30, 12, 28, [P.metal[1], P.panel, '#0f1319'], 0, 0.2);
        g.fillStyle = 'rgba(0,0,0,0.5)'; for (let yy = 36; yy < 54; yy += 3) g.fillRect(12, yy, 8, 1);
        // console head
        g.fillStyle = 'rgba(0,0,0,0.35)'; G.roundRect(g, 1.5, 5.5, 30, 27, 3); g.fill();
        bevel(g, 0, 4, 31, 27, P.metal, 3, 0.4);
        g.fillStyle = '#05080c'; G.roundRect(g, 3, 7, 25, 18, 2); g.fill();
        // keyboard ledge
        bevel(g, -1, 29, 34, 5, P.metal, 1.5, 0.35);
        g.fillStyle = 'rgba(0,0,0,0.45)'; for (let kx = 2; kx < 31; kx += 3.4) g.fillRect(kx, 30.5, 2.2, 1.2);
        hazard(g, 10, 50, 12, 3, 3);
        rivet(g, 2.5, 6.5, 0.8); rivet(g, 28.5, 6.5, 0.8);
        g.fillStyle = '#0a0d12'; g.fillRect(25, 1, 2, 4); // antenna stub
      });
      blit(ctx, body, x, y);
      // screen content
      const sx = x + 3.5, sy = y + 7.5, sw = 24, sh = 17;
      ctx.save();
      ctx.beginPath(); ctx.rect(sx, sy, sw, sh); ctx.clip();
      ctx.fillStyle = solved ? '#04200f' : '#03121b'; ctx.fillRect(sx, sy, sw, sh);
      if (!solved) {
        const off = (t * 7) % 3.2;
        for (let i = 0; i < 7; i++) {
          const li = Math.floor(t * 7 / 3.2) + i;
          const lw = 4 + hash1(li) * 16;
          ctx.fillStyle = rgba(col, hash1(li + 99) < 0.2 ? 0.95 : 0.55);
          ctx.fillRect(sx + 1.5, sy + sh - 2 - i * 3.2 + off - 3.2, lw, 1.3);
        }
        if (Math.sin(t * 8) > 0) { ctx.fillStyle = col; ctx.fillRect(sx + 2, sy + sh - 3, 2.5, 1.6); }
      } else {
        ctx.fillStyle = C.ok; ctx.font = '800 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('OK', sx + sw / 2 + 4, sy + sh / 2 + 0.5);
        ctx.strokeStyle = C.ok; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx + 3.5, sy + 8.5); ctx.lineTo(sx + 5.5, sy + 10.8); ctx.lineTo(sx + 9, sy + 6); ctx.stroke();
      }
      // scanlines + glass glare
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; for (let yy = sy; yy < sy + sh; yy += 2) ctx.fillRect(sx, yy, sw, 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 10, sy); ctx.lineTo(sx, sy + 10); ctx.closePath(); ctx.fill();
      ctx.restore();
      glow(ctx, sx + sw / 2, sy + sh / 2, 22, 18, col, 0.28 + (solved ? 0.08 : 0.04 * Math.sin(t * 17)));
      const ll = solved ? C.ok : Math.sin(t * 5) > 0 ? C.warn : '#4a3010';
      ctx.fillStyle = ll; ctx.fillRect(x + 25, y + 0.5, 2, 1.6);
      glow(ctx, x + 26, y + 1.3, 6, 5, ll, 0.8);
    } else {
      const body = sprite(`termA:${P.key}`, 32, 64, 2, (g) => {
        g.beginPath(); g.moveTo(4, 64); g.lineTo(28, 64); g.lineTo(23, 39); g.lineTo(9, 39); g.closePath();
        const gr = g.createLinearGradient(4, 39, 28, 64);
        gr.addColorStop(0, P.stone[0]); gr.addColorStop(0.45, P.stone[1]); gr.addColorStop(1, P.stone[2]);
        g.fillStyle = gr; g.fill();
        g.save(); g.clip(); grain(g, 4, 39, 24, 25, 311); g.restore();
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(4.5, 64); g.lineTo(9.5, 39.5); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.1; rune(g, 16, 51, 2.4, 41);
        bevel(g, 5, 34, 22, 5.5, P.bronze, 1.5, 0.45);
        g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(13, 34.5, 6, 1.6);
        if (P.moss) moss(g, 5, 34, 22, 9);
      });
      blit(ctx, body, x, y);
      const fl = 0.86 + 0.14 * Math.sin(t * 23) * Math.sin(t * 7.3);
      const hx = x + 2, hy = y + 4, hw = 28, hh = 22;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // projection cone
      const cg = ctx.createLinearGradient(0, y + 35, 0, hy + hh);
      cg.addColorStop(0, rgba(col, 0.45 * fl)); cg.addColorStop(1, rgba(col, 0.04));
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.moveTo(cx - 2, y + 35); ctx.lineTo(cx + 2, y + 35); ctx.lineTo(hx + hw, hy + hh); ctx.lineTo(hx, hy + hh); ctx.closePath(); ctx.fill();
      // hologram pane
      ctx.fillStyle = rgba(col, 0.13 * fl); ctx.fillRect(hx, hy, hw, hh);
      ctx.strokeStyle = rgba(col, 0.75 * fl); ctx.lineWidth = 1; ctx.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hh - 1);
      ctx.fillStyle = rgba(col, 0.9 * fl);
      ctx.fillRect(hx - 1, hy - 1, 4, 1); ctx.fillRect(hx - 1, hy - 1, 1, 4); ctx.fillRect(hx + hw - 3, hy + hh, 4, 1); ctx.fillRect(hx + hw, hy + hh - 3, 1, 4);
      ctx.beginPath(); ctx.rect(hx + 1, hy + 1, hw - 2, hh - 2); ctx.clip();
      ctx.strokeStyle = rgba(col, 0.85 * fl); ctx.fillStyle = rgba(col, 0.85 * fl); ctx.lineWidth = 0.9;
      if (!solved) {
        const off = (t * 5) % 7;
        for (let r = 0; r < 4; r++) {
          const row = Math.floor(t * 5 / 7) + r;
          for (let c = 0; c < 4; c++) rune(ctx, hx + 5 + c * 6.2, hy + hh - 2 - r * 7 + off - 4, 1.6, row * 7 + c);
        }
      } else {
        ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - 6, hy + 11); ctx.lineTo(cx - 1.5, hy + 15.5); ctx.lineTo(cx + 7, hy + 6); ctx.stroke();
        ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(cx, hy + 11, 9 + Math.sin(t * 3), 0, TAU); ctx.stroke();
      }
      // scan line sweeping down
      const sl = hy + ((t * 14) % hh);
      ctx.fillStyle = rgba('#ffffff', 0.25 * fl); ctx.fillRect(hx, sl, hw, 0.8);
      ctx.restore();
      glow(ctx, cx, y + 35, 8, 5, col, 0.9);
      glow(ctx, cx, hy + hh / 2, 24, 20, col, 0.2);
    }
  }

  // ======================================================================================
  // ITEMS (parts / socket silhouettes) — 20×20 icon centred on (0,0)
  // ======================================================================================
  function itemPath(g, item, mono) {
    const M = (c) => mono || c;
    const glass = (a) => (mono ? mono : `rgba(170,230,255,${a})`);
    g.lineCap = 'round'; g.lineJoin = 'round';
    switch (item) {
      case 'fuse': {
        g.save(); g.rotate(-0.55);
        g.fillStyle = glass(0.35); G.roundRect(g, -6.5, -3.6, 13, 7.2, 2); g.fill();
        g.strokeStyle = M('#dff6ff'); g.lineWidth = 0.8; g.stroke();
        if (!mono) { g.strokeStyle = '#ffb347'; g.lineWidth = 1; g.beginPath(); g.moveTo(-6, 0); for (let i = 0; i < 5; i++) g.lineTo(-4 + i * 2.2, i % 2 ? -1.6 : 1.6); g.lineTo(6, 0); g.stroke(); }
        for (const s of [-1, 1]) {
          const cxx = s * 8.2;
          g.fillStyle = M('#c9d1dc'); G.roundRect(g, cxx - 2.6, -4.6, 5.2, 9.2, 1.2); g.fill();
          if (!mono) { g.fillStyle = '#7d8794'; g.fillRect(cxx - 2.6, -1, 5.2, 0.9); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(cxx - 2, -4, 1, 8); }
        }
        g.restore(); break;
      }
      case 'cell': {
        g.fillStyle = M('#c9d1dc'); g.fillRect(-2.2, -10, 4.4, 2.6);
        g.fillStyle = M('#1d2733'); G.roundRect(g, -5.5, -7.8, 11, 17, 2); g.fill();
        g.strokeStyle = M('#9aa6b6'); g.lineWidth = 1; g.stroke();
        if (!mono) {
          for (let i = 0; i < 3; i++) { g.fillStyle = i < 3 ? '#6dffc8' : '#2a4038'; g.fillRect(-3.4, 4.6 - i * 3.8, 6.8, 2.6); }
          g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-4.4, -6.6, 1, 14);
        }
        break;
      }
      case 'gear': {
        g.beginPath();
        const n = 8;
        for (let i = 0; i < n * 4; i++) {
          const a = (i / (n * 4)) * TAU;
          const r = i % 4 < 2 ? 9 : 6.6;
          g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        g.closePath();
        g.moveTo(2.6, 0); g.arc(0, 0, 2.6, 0, TAU, true);
        if (mono) g.fillStyle = mono;
        else { const gr = g.createLinearGradient(-8, -8, 8, 8); gr.addColorStop(0, '#ffe2a0'); gr.addColorStop(0.5, '#d29a48'); gr.addColorStop(1, '#6a4418'); g.fillStyle = gr; }
        g.fill('evenodd');
        if (!mono) { g.strokeStyle = 'rgba(80,40,10,0.6)'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, 0, 4.6, 0, TAU); g.stroke(); }
        break;
      }
      case 'lens': {
        if (mono) { g.fillStyle = mono; g.beginPath(); g.arc(0, 0, 8.6, 0, TAU); g.fill(); g.fillRect(-2, 7, 4, 3); break; }
        g.fillStyle = '#8b96a5'; g.fillRect(-2, 7, 4, 3);
        const lg = g.createRadialGradient(-2.5, -2.5, 0.5, 0, 0, 8);
        lg.addColorStop(0, '#f2feff'); lg.addColorStop(0.35, '#9eeeff'); lg.addColorStop(1, '#1f6f9a');
        g.fillStyle = lg; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill();
        g.strokeStyle = '#d6dde6'; g.lineWidth = 2.2; g.beginPath(); g.arc(0, 0, 7.6, 0, TAU); g.stroke();
        g.strokeStyle = '#59636f'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, 0, 8.8, 0.2, Math.PI * 1.2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.2; g.beginPath(); g.arc(0, 0, 4.6, Math.PI * 1.05, Math.PI * 1.45); g.stroke();
        break;
      }
      case 'chip': {
        g.fillStyle = M('#e4bf62');
        for (let i = 0; i < 4; i++) { const o = -5.25 + i * 3.5; g.fillRect(o - 0.8, -9, 1.6, 3); g.fillRect(o - 0.8, 6, 1.6, 3); g.fillRect(-9, o - 0.8, 3, 1.6); g.fillRect(6, o - 0.8, 3, 1.6); }
        g.fillStyle = M('#1f2630'); G.roundRect(g, -6.6, -6.6, 13.2, 13.2, 1.5); g.fill();
        if (!mono) {
          g.strokeStyle = '#4a5666'; g.lineWidth = 0.8; g.strokeRect(-4.2, -4.2, 8.4, 8.4);
          g.fillStyle = '#7ef9ff'; g.beginPath(); g.arc(0, 0, 1.8, 0, TAU); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-6, -6, 12, 1);
        }
        break;
      }
      case 'core': {
        g.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; g.lineTo(Math.cos(a) * 9.4, Math.sin(a) * 9.4); }
        g.closePath();
        if (mono) { g.fillStyle = mono; g.fill(); break; }
        const bg = g.createLinearGradient(-8, -8, 8, 8); bg.addColorStop(0, '#f2cf8e'); bg.addColorStop(0.5, '#9c7038'); bg.addColorStop(1, '#3e2810');
        g.fillStyle = bg; g.fill();
        const cg = g.createRadialGradient(-1, -1, 0.5, 0, 0, 6.2);
        cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.35, '#ffe08a'); cg.addColorStop(1, '#c46a10');
        g.fillStyle = cg; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(126,249,255,0.9)'; g.lineWidth = 0.8; g.beginPath(); g.ellipse(0, 0, 7.6, 2.6, -0.5, 0, TAU); g.stroke();
        break;
      }
      case 'valve': {
        g.fillStyle = M('#8b96a5'); g.fillRect(-2.4, 4, 4.8, 4); g.fillStyle = M('#c9d1dc'); g.fillRect(-7, 7.6, 14, 2.6);
        g.strokeStyle = M('#d9483a'); g.lineWidth = 2.4;
        g.beginPath(); g.arc(0, -2, 7, 0, TAU); g.stroke();
        g.lineWidth = 1.6; g.beginPath();
        for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; g.moveTo(0, -2); g.lineTo(Math.cos(a) * 6.5, -2 + Math.sin(a) * 6.5); }
        g.stroke();
        g.fillStyle = M('#f2e6d0'); g.beginPath(); g.arc(0, -2, 1.9, 0, TAU); g.fill();
        if (!mono) { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 0.8; g.beginPath(); g.arc(0, -2, 7, Math.PI * 1.1, Math.PI * 1.5); g.stroke(); }
        break;
      }
      case 'antenna': {
        g.fillStyle = M('#59636f'); g.fillRect(-4.5, 7, 9, 3);
        g.strokeStyle = M('#c9d1dc'); g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, 7.5); g.lineTo(0, -5); g.stroke();
        g.lineWidth = 1.3; g.beginPath(); g.moveTo(-6, 1); g.quadraticCurveTo(0, 6, 6, 1); g.stroke();
        g.fillStyle = M('#ff5a4a'); g.beginPath(); g.arc(0, -6.5, 2.4, 0, TAU); g.fill();
        g.strokeStyle = M('#7ef9ff'); g.lineWidth = 0.9;
        g.beginPath(); g.arc(0, -6.5, 5, -Math.PI * 0.85, -Math.PI * 0.55); g.stroke();
        g.beginPath(); g.arc(0, -6.5, 5, -Math.PI * 0.45, -Math.PI * 0.15); g.stroke();
        break;
      }
      default: {
        g.fillStyle = M('#ffd760'); g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill();
      }
    }
  }
  /** Cached item icon sprite (20×20 logical, origin = top-left of the box). */
  function itemSprite(item, mono) {
    return sprite(`item:${item}:${mono || ''}`, 20, 20, 3, (g) => {
      g.translate(10, 10);
      if (!mono) { g.save(); g.translate(0.8, 1); itemPath(g, item, 'rgba(0,0,0,0.45)'); g.restore(); }
      itemPath(g, item, mono);
    });
  }
  /** Draw an item icon of `size` px centred at (x, y). `mono` = flat silhouette colour. */
  function drawItem(ctx, item, x, y, size = 18, mono = null, rot = 0) {
    const s = itemSprite(item, mono);
    const k = size / 20;
    if (rot) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
      ctx.drawImage(s, (-10 - s.pad) * k, (-10 - s.pad) * k, s.lw * k, s.lh * k);
      ctx.restore();
    } else ctx.drawImage(s, x + (-10 - s.pad) * k, y + (-10 - s.pad) * k, s.lw * k, s.lh * k);
  }
  function star(ctx, x, y, s, col, a) {
    if (a <= 0.02 || s <= 0.1) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha *= a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.18, y - s * 0.18); ctx.lineTo(x + s, y); ctx.lineTo(x + s * 0.18, y + s * 0.18);
    ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.18, y + s * 0.18); ctx.lineTo(x - s, y); ctx.lineTo(x - s * 0.18, y - s * 0.18);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ======================================================================================
  // PART (carryable)
  // ======================================================================================
  function drawPart(ctx, e, t, P) {
    if (e.taken) return;
    const seed = (e.tx || 0) * 3.7 + (e.ty || 0) * 1.3;
    const bob = Math.sin(t * 2.6 + seed) * 2.6;
    const cx = e.x + 10, floor = e.y + 22, cy = e.y + 9 + bob;
    shadow(ctx, cx + 1.5, floor, 9 - bob * 0.5, 2.3, 0.45);
    // pickup ring on the floor
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(C.item, 0.35 + 0.15 * Math.sin(t * 3 + seed));
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(cx, floor - 0.5, 11, 2.6, 0, 0, TAU); ctx.stroke();
    ctx.restore();
    glow(ctx, cx, floor, 14, 4, C.item, 0.35);
    glow(ctx, cx, cy, 20, 20, C.item, 0.32 + 0.1 * Math.sin(t * 3 + seed));
    const rot = e.item === 'gear' ? t * 0.8 : Math.sin(t * 1.3 + seed) * 0.12;
    drawItem(ctx, e.item, cx, cy, 18, null, rot);
    // glint
    const gp = ((t + seed) % 2.4) / 2.4;
    const ga = gp < 0.25 ? Math.sin((gp / 0.25) * Math.PI) : 0;
    star(ctx, cx + 6, cy - 6, 5 * ga, '#ffffff', ga);
    // rising motes
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.6 + hash1(i + seed)) % 1;
      ctx.fillStyle = rgba(C.item, Math.sin(ph * Math.PI) * 0.8);
      ctx.fillRect(cx - 7 + hash1(i * 3 + seed) * 14, floor - 2 - ph * 22, 1.3, 1.3);
    }
    ctx.restore();
  }

  // ======================================================================================
  // SOCKET (broken machine)
  // ======================================================================================
  function drawSocket(ctx, e, t, P) {
    const x = e.x, y = e.y, cx = x + 16;
    const on = !!e.active;
    const rt = e.repairT || 0;
    const spin = on ? Math.max(0, rt - 0.15) * 9 - 6 * (1 - Math.exp(-Math.max(0, rt - 0.15) * 1.5)) : 0;
    shadow(ctx, cx + 3, y + 64, 17, 3, 0.45);
    const blink = 0.5 + 0.5 * Math.sin(t * 5);
    if (P.human) {
      const body = sprite(`sockH:${P.key}`, 32, 64, 3, (g) => {
        bevel(g, 2, 8, 28, 56, P.metal, 2, 0.35);
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(4, 10, 24, 52);
        bevel(g, 1, 5, 30, 5, P.metal, 1.5, 0.45);
        // fan well
        g.fillStyle = '#06080b'; g.beginPath(); g.arc(16, 20, 7.6, 0, TAU); g.fill();
        g.strokeStyle = P.metal[0]; g.lineWidth = 1; g.beginPath(); g.arc(16, 20, 8.2, Math.PI * 0.9, Math.PI * 1.7); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(16, 20, 8.2, -0.3, Math.PI * 0.8); g.stroke();
        // slot recess
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(6.5, 30.5, 19, 19);
        g.fillStyle = '#05070a'; g.fillRect(6, 30, 19, 19);
        const ig = g.createLinearGradient(6, 30, 6, 49); ig.addColorStop(0, 'rgba(0,0,0,0.9)'); ig.addColorStop(1, 'rgba(40,46,56,0.6)');
        g.fillStyle = ig; g.fillRect(7, 31, 17, 17);
        hazard(g, 3, 54, 26, 3.5, 3);
        for (const [rx, ry] of [[4.5, 12], [27.5, 12], [4.5, 60], [27.5, 60]]) rivet(g, rx, ry, 0.9);
        g.fillStyle = '#0a0d12'; g.fillRect(29, 46, 2.5, 4);
        if (P.wreck) { const r = G.rng(51); for (let i = 0; i < 5; i++) { g.fillStyle = rgba(P.rust, 0.3 + r() * 0.3); g.fillRect(3 + r() * 26, 10 + r() * 40, 1 + r() * 2, 4 + r() * 8); } }
      });
      blit(ctx, body, x, y);
      // fan
      ctx.save();
      ctx.translate(cx, y + 20);
      ctx.rotate(on ? spin : 0.3 + (Math.sin(t * 13) > 0.97 ? 0.08 : 0));
      ctx.fillStyle = on ? P.metal[0] : P.metal[1];
      for (let i = 0; i < 5; i++) {
        ctx.rotate(TAU / 5);
        ctx.beginPath(); ctx.moveTo(0, -1.5); ctx.quadraticCurveTo(4, -6, 1.5, -7); ctx.lineTo(-1, -1); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#2a313b'; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
      if (on) glow(ctx, cx, y + 20, 12, 12, C.ok, 0.18);
    } else {
      const body = sprite(`sockA:${P.key}`, 32, 64, 3, (g) => {
        bevel(g, 3, 12, 26, 52, P.stone, 1, 0.25);
        grain(g, 3, 12, 26, 52, 913);
        bevel(g, 0, 6, 32, 7, P.stone, 1.5, 0.35);
        bevel(g, 1, 58, 30, 6, P.stone, 1, 0.25);
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(16, 14); g.lineTo(16, 24); g.moveTo(16, 50); g.lineTo(16, 57); g.stroke();
        rune(g, 9, 18, 1.8, 61); rune(g, 23, 18, 1.8, 62);
        // crack
        g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(28, 26); g.lineTo(24, 31); g.lineTo(26, 36); g.lineTo(22, 42); g.stroke();
        // cradle
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(16.6, 37.6, 12, 0, TAU); g.fill();
        g.fillStyle = '#06070a'; g.beginPath(); g.arc(16, 37, 8, 0, TAU); g.fill();
        if (P.moss) moss(g, 0, 6, 32, 17);
      });
      blit(ctx, body, x, y);
      // rotating bronze rings
      const ring = sprite(`sockAR:${P.key}`, 26, 26, 1, (g) => {
        g.translate(13, 13);
        const bg = g.createLinearGradient(-12, -12, 12, 12);
        bg.addColorStop(0, P.bronze[0]); bg.addColorStop(0.5, P.bronze[1]); bg.addColorStop(1, P.bronze[2]);
        g.strokeStyle = bg; g.lineWidth = 3;
        g.beginPath(); g.arc(0, 0, 10.5, 0, TAU); g.stroke();
        g.fillStyle = P.bronze[1];
        for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; g.save(); g.rotate(a); g.fillRect(-1.2, -13, 2.4, 3.5); g.restore(); }
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.7; g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.stroke();
      });
      ctx.save();
      ctx.translate(cx, y + 37);
      ctx.rotate(on ? spin : 0.35);
      ctx.drawImage(ring, -13 - ring.pad, -13 - ring.pad, ring.lw, ring.lh);
      ctx.restore();
      if (on) {
        ctx.save();
        ctx.translate(cx, y + 37); ctx.rotate(-spin * 1.6);
        ctx.strokeStyle = rgba(P.glyph, 0.85); ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 13.8, (i / 3) * TAU, (i / 3) * TAU + 1.3); ctx.stroke(); }
        ctx.restore();
        // lit glyph channels
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(P.glyph, 0.75 + 0.25 * Math.sin(t * 4)); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, y + 14); ctx.lineTo(cx, y + 24); ctx.moveTo(cx, y + 50); ctx.lineTo(cx, y + 57); ctx.stroke();
        rune(ctx, x + 9, y + 18, 1.8, 61); rune(ctx, x + 23, y + 18, 1.8, 62);
        ctx.restore();
      }
    }
    // slot contents
    const sy = y + (P.human ? 39.5 : 37);
    if (on) {
      const seat = rt < 0.35 ? 1 + (1 - easeOutBack(rt / 0.35, 3)) * 0.5 : 1;
      glow(ctx, cx, sy, 16, 16, P.human ? C.item : P.glyph, 0.45 + 0.15 * Math.sin(t * 4));
      drawItem(ctx, e.needs, cx, sy, 14 * seat, null, e.needs === 'gear' ? spin * 0.5 : 0);
    } else {
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.55 * blink;
      drawItem(ctx, e.needs, cx, sy, 13, C.warn);
      ctx.restore();
      glow(ctx, cx, sy, 13, 13, C.warn, 0.22 * blink);
      ctx.strokeStyle = rgba(C.warn, 0.35 + 0.4 * blink); ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
      ctx.lineDashOffset = -t * 6;
      if (P.human) ctx.strokeRect(x + 7.5, y + 31.5, 16, 16);
      else { ctx.beginPath(); ctx.arc(cx, sy, 7.5, 0, TAU); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // status lamp
    const lc = on ? C.ok : Math.sin(t * 7) > 0 ? C.bad : '#4a1018';
    const lx = P.human ? x + 26 : cx, ly = P.human ? y + 12 : y + 9.5;
    ctx.fillStyle = lc; ctx.beginPath(); ctx.arc(lx, ly, 1.7, 0, TAU); ctx.fill();
    glow(ctx, lx, ly, 8, 7, lc, on ? 0.9 : 0.75);
    // broken: dangling, sparking cable (human) / crackling crack (architect)
    if (!on) {
      if (P.human) {
        const sw = Math.sin(t * 1.9) * 2;
        const endX = x + 33 + sw, endY = y + 59;
        ctx.strokeStyle = '#141820'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x + 30, y + 48); ctx.quadraticCurveTo(x + 36, y + 52 + sw * 0.3, endX, endY); ctx.stroke();
        ctx.strokeStyle = '#b8653a'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(endX, endY); ctx.lineTo(endX + 0.8, endY + 1.6); ctx.moveTo(endX, endY); ctx.lineTo(endX - 0.9, endY + 1.5); ctx.stroke();
        if (every(e, '_sparkT', t, 0.9)) { sparks(endX, endY + 1, { count: 5 + (Math.random() * 4 | 0), color: ['#fff6c8', '#ffd060', '#7ef9ff'] }); e._flashT = t; }
        if (e._flashT != null && t - e._flashT < 0.12) glow(ctx, endX, endY + 1, 12, 12, '#ffe8a0', 1 - (t - e._flashT) / 0.12);
      } else {
        if (every(e, '_sparkT', t, 1.1)) { sparks(x + 25, y + 32, { count: 4, color: [P.glyph2, '#ffffff'], speed: 120 }); e._flashT = t; }
        if (e._flashT != null && t - e._flashT < 0.15) glow(ctx, x + 25, y + 32, 10, 10, P.glyph2, 1 - (t - e._flashT) / 0.15);
        ctx.strokeStyle = rgba(P.glyph2, 0.25 + 0.25 * Math.max(0, Math.sin(t * 9) * Math.sin(t * 3.1)));
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 28, y + 26); ctx.lineTo(x + 24, y + 31); ctx.lineTo(x + 26, y + 36); ctx.lineTo(x + 22, y + 42); ctx.stroke();
      }
    } else {
      if (P.human) {
        ctx.strokeStyle = '#141820'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x + 30, y + 48); ctx.quadraticCurveTo(x + 34, y + 54, x + 33, y + 64); ctx.stroke();
        // energy flowing up the cabinet
        const fy = y + 50 - ((t * 30) % 22);
        glow(ctx, x + 30, fy, 3, 5, C.ok, 0.7);
      }
      if (rt < 0.7) {
        const k = rt / 0.7;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(P.human ? C.item : P.glyph, (1 - k) * 0.9); ctx.lineWidth = 2 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.arc(cx, sy, 8 + easeOutCubic(k) * 40, 0, TAU); ctx.stroke();
        ctx.restore();
        glow(ctx, cx, sy, 30, 40, '#ffffff', (1 - k) * 0.7);
      }
    }
  }

  // ======================================================================================
  // MOVING PLATFORM
  // ======================================================================================
  function drawMPlatform(ctx, e, t, P) {
    const x = e.x, y = e.y, w = e.w;
    const run = e.running !== false;
    const speed = Math.hypot(e.dx || 0, e.dy || 0) * 60; // px/s
    const sp = clamp01(speed / 90);
    const up = (e.dy || 0) < -0.01 ? 1 : (e.dy || 0) > 0.01 ? -0.5 : 0;
    const hover = run ? Math.sin(t * 3 + x * 0.01) * 0.6 : 0;
    const yy = y + hover;
    const col = P.human ? '#6fc8ff' : P.glyph;
    const intensity = run ? 0.55 + 0.45 * sp + 0.25 * up * sp : 0.08;
    // thrusters (behind the body)
    const n = Math.max(2, Math.round(w / 48));
    for (let i = 0; i < n; i++) {
      const tx = x + (w * (i + 0.5)) / n;
      const fl = run ? 0.85 + 0.15 * Math.sin(t * 40 + i * 2.1) * Math.sin(t * 17 + i) : 1;
      const len = (6 + 12 * intensity) * fl;
      if (run) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fg = ctx.createLinearGradient(0, yy + 16, 0, yy + 16 + len);
        fg.addColorStop(0, rgba('#ffffff', 0.9 * intensity)); fg.addColorStop(0.25, rgba(col, 0.7 * intensity)); fg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.moveTo(tx - 3.4, yy + 16); ctx.lineTo(tx + 3.4, yy + 16); ctx.lineTo(tx + 1, yy + 16 + len); ctx.lineTo(tx - 1, yy + 16 + len); ctx.closePath(); ctx.fill();
        ctx.restore();
        glow(ctx, tx, yy + 19, 9, 6 + len * 0.5, col, 0.55 * intensity);
      } else glow(ctx, tx, yy + 17, 3, 2, P.human ? C.bad : P.glyph2, 0.35);
    }
    // underside light cast on the world below
    if (run) glow(ctx, x + w / 2, yy + 30, w * 0.55, 12, col, 0.12 * intensity);
    const body = sprite(`mplat:${P.key}:${w}`, w, 22, 3, (g) => {
      if (P.human) {
        // keel
        g.beginPath(); g.moveTo(3, 12); g.lineTo(w - 3, 12); g.lineTo(w - 9, 18); g.lineTo(9, 18); g.closePath();
        g.fillStyle = P.metal[2]; g.fill();
        bevel(g, 0, 0, w, 13, P.metal, 2, 0.4);
        hazard(g, 2, 9, w - 4, 3, 3);
        g.fillStyle = 'rgba(0,0,0,0.3)'; for (let xx = 6; xx < w - 4; xx += 8) g.fillRect(xx, 3, 4, 1);
        for (let i = 0; i < n; i++) { const tx = (w * (i + 0.5)) / n; bevel(g, tx - 4.5, 14, 9, 4, P.metal, 1, 0.3); g.fillStyle = '#05070a'; g.fillRect(tx - 3, 17, 6, 1.5); }
        rivet(g, 3, 5.5, 0.9); rivet(g, w - 3, 5.5, 0.9);
      } else {
        g.beginPath(); g.moveTo(1, 9); g.lineTo(w - 1, 9); g.lineTo(w - 10, 18); g.lineTo(10, 18); g.closePath();
        const sg = g.createLinearGradient(0, 9, 0, 18); sg.addColorStop(0, P.stone[1]); sg.addColorStop(1, P.stone[2]);
        g.fillStyle = sg; g.fill();
        g.save(); g.clip(); grain(g, 0, 9, w, 9, w * 7, false); g.restore();
        bevel(g, 0, 0, w, 5, P.bronze, 1.5, 0.5);
        bevel(g, 1, 4.5, w - 2, 5, P.stone, 0, 0.15);
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(6, 11.5, w - 12, 1.4);
        for (let i = 0; i < n; i++) { const tx = (w * (i + 0.5)) / n; g.fillStyle = P.bronze[2]; g.beginPath(); g.moveTo(tx - 4, 15); g.lineTo(tx + 4, 15); g.lineTo(tx + 3, 18.5); g.lineTo(tx - 3, 18.5); g.closePath(); g.fill(); }
        for (let xx = 10; xx < w - 8; xx += 14) { g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.8; rune(g, xx, 7, 1.2, xx); }
        if (P.moss) moss(g, 2, 0, w - 4, w);
      }
    });
    blit(ctx, body, x, yy);
    // energy strip
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sa = run ? 0.65 + 0.35 * Math.sin(t * 4) : 0.12;
    if (P.human) {
      ctx.fillStyle = rgba(col, sa); ctx.fillRect(x + 6, yy + 6, w - 12, 1);
    } else {
      ctx.fillStyle = rgba(col, sa); ctx.fillRect(x + 6, yy + 11.5, w - 12, 1.4);
      if (run) { const px = x + 6 + (((t * 40) % (w - 12)) + (w - 12)) % (w - 12); glow(ctx, px, yy + 12, 6, 3, col, 0.8); }
    }
    ctx.restore();
  }

  // ======================================================================================
  // CRATE
  // ======================================================================================
  function drawCrate(ctx, e, t, P) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    shadow(ctx, x + w / 2 + 3, y + h, w * 0.62, 3.2, 0.5);
    const spr = sprite(`crate:${P.key}:${w}`, w, h, 2, (g) => {
      if (P.human) {
        bevel(g, 0, 0, w, h, P.crate, 1.5, 0.35);
        // cross bracing
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(5, 5); g.lineTo(w - 5, h - 5); g.moveTo(w - 5, 5); g.lineTo(5, h - 5); g.stroke();
        g.strokeStyle = P.crate[0]; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(5, 5); g.lineTo(w - 5, h - 5); g.moveTo(w - 5, 5); g.lineTo(5, h - 5); g.stroke();
        // steel frame
        g.strokeStyle = P.metal[1]; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3);
        g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0.5, h - 1); g.lineTo(0.5, 0.5); g.lineTo(w - 1, 0.5); g.stroke();
        // corner caps
        for (const [cx, cy] of [[0, 0], [w - 6, 0], [0, h - 6], [w - 6, h - 6]]) { bevel(g, cx, cy, 6, 6, P.metal, 1, 0.4); rivet(g, cx + 3, cy + 3, 0.9); }
        // stencil band
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(6, h / 2 - 4, w - 12, 8);
        hazard(g, 7, h / 2 - 3, w - 14, 6, 3);
        g.fillStyle = 'rgba(230,236,244,0.75)'; g.font = '700 4.5px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(P.wreck ? 'K-7 · 03' : 'K-7 · 12', w / 2, 8);
        if (P.wreck) { const r = G.rng(71); for (let i = 0; i < 6; i++) { g.fillStyle = rgba(P.rust, 0.3 + r() * 0.35); g.fillRect(r() * w, r() * h, 1 + r() * 3, 2 + r() * 6); } }
      } else {
        bevel(g, 0, 0, w, h, P.stone, 2, 0.3);
        grain(g, 0, 0, w, h, G.hash(P.key + 'crate'));
        // chiselled bevel
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(3, 3, w - 6, 1); g.fillRect(3, 3, 1, h - 6);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(3, h - 4, w - 6, 1); g.fillRect(w - 4, 3, 1, h - 6);
        // carved glyph square
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.strokeRect(9.5, 9.5, w - 19, h - 19);
        g.fillStyle = 'rgba(0,0,0,0.45)'; rune(g, w / 2, h / 2, 3, G.hash(P.key) % 50);
        // bronze corner bands
        g.fillStyle = P.bronze[1]; g.fillRect(0, 5, w, 1.6); g.fillRect(0, h - 7, w, 1.6);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 5, w, 0.5); g.fillRect(0, h - 7, w, 0.5);
        if (P.moss) moss(g, 1, 0.5, w - 2, 31);
      }
    });
    const glyphLit = !P.human;
    const p = clamp01((e.pushedT || 0) / 0.1);
    if (p > 0) {
      ctx.save();
      const a = Math.sin(t * 42) * 0.03 * p;
      ctx.translate(x + w / 2, y + h);
      ctx.rotate(a);
      blit(ctx, spr, -w / 2, -h - Math.abs(a) * 8);
      ctx.restore();
    } else blit(ctx, spr, x, y);
    if (glyphLit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(P.glyph, 0.22 + 0.1 * Math.sin(t * 1.5 + x)); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 0.9;
      rune(ctx, x + w / 2, y + h / 2, 3, G.hash(P.key) % 50);
      ctx.restore();
    }
  }

  // ======================================================================================
  // LASER
  // ======================================================================================
  const DIR_ROT = { down: 0, left: Math.PI / 2, up: Math.PI, right: -Math.PI / 2 };
  function drawLaser(ctx, e, t, P) {
    const cx = e.x + 16, cy = e.y + 16;
    const ph = e.phase || 'on';
    const len = (e.len || 0) * T;
    const rot = DIR_ROT[e.dir] || 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    // canonical: mounted on the ceiling (−y), nozzle points +y, beam from y=16 to 16+len
    if (ph === 'on' && len > 0) {
      const fl = 0.85 + 0.15 * Math.sin(t * 61) * Math.sin(t * 23);
      const wob = Math.sin(t * 90) * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      const y0 = 13, y1 = 16 + len;
      // wide glow
      let g = ctx.createLinearGradient(-14, 0, 14, 0);
      g.addColorStop(0, rgba(C.laser, 0)); g.addColorStop(0.5, rgba(C.laser, 0.42 * fl)); g.addColorStop(1, rgba(C.laser, 0));
      ctx.fillStyle = g; ctx.fillRect(-14, y0, 28, y1 - y0);
      // mid beam
      g = ctx.createLinearGradient(-4.5, 0, 4.5, 0);
      g.addColorStop(0, rgba(C.laserMid, 0)); g.addColorStop(0.5, rgba(C.laserMid, 0.95)); g.addColorStop(1, rgba(C.laserMid, 0));
      ctx.fillStyle = g; ctx.fillRect(-4.5 + wob, y0, 9, y1 - y0);
      // white-hot core
      ctx.fillStyle = rgba(C.laserCore, 0.95 * fl); ctx.fillRect(-1.1 - wob * 0.5, y0, 2.2, y1 - y0);
      // energy pulses travelling along the beam
      for (let i = 0; i < Math.ceil(len / 40) + 1; i++) {
        const py = y0 + (((t * 420 + i * 40) % (len + 40)) - 20);
        if (py > y0 && py < y1) glow(ctx, 0, py, 5, 12, C.laserCore, 0.45);
      }
      // impact
      const ip = 1 + 0.25 * Math.sin(t * 47);
      glow(ctx, 0, y1, 16 * ip, 10 * ip, C.laser, 0.95);
      glow(ctx, 0, y1, 6 * ip, 4 * ip, C.laserCore, 1);
      glow(ctx, 0, y0 + 2, 12, 9, C.laser, 0.9);
      ctx.globalCompositeOperation = 'source-over';
      if (every(e, '_fxT', t, 0.07)) {
        const s = Math.sin(rot), c = Math.cos(rot);
        // local (0, y1) → world, and the "back up the beam" direction
        const wx = cx - s * y1, wy = cy + c * y1;
        const back = Math.atan2(-c, s);
        sparks(wx, wy, { count: 3, angle: back, spread: 2.4, speed: 220, life: 0.3, color: ['#ffffff', '#ffd0d8', C.laserMid], gravity: 600 });
      }
    } else if (ph === 'warn' && len > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const fl = Math.sin(t * 50) > -0.2 ? 1 : 0.25;
      ctx.strokeStyle = rgba(C.laserMid, 0.6 * fl); ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]); ctx.lineDashOffset = -t * 60;
      ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(0, 16 + len); ctx.stroke();
      ctx.setLineDash([]);
      const g = ctx.createLinearGradient(-6, 0, 6, 0);
      g.addColorStop(0, rgba(C.laser, 0)); g.addColorStop(0.5, rgba(C.laser, 0.14 * fl)); g.addColorStop(1, rgba(C.laser, 0));
      ctx.fillStyle = g; ctx.fillRect(-6, 16, 12, len);
      glow(ctx, 0, 16 + len, 6, 4, C.laser, 0.6 * fl);
      ctx.globalCompositeOperation = 'source-over';
    }
    // emitter housing
    const hs = sprite(`laserH:${P.key}`, 32, 32, 3, (g) => {
      g.translate(16, 16);
      if (P.human) {
        bevel(g, -15, -16, 30, 9, P.metal, 1.5, 0.35); // wall mount plate
        hazard(g, -13, -9, 26, 3, 3);
        g.beginPath(); g.moveTo(-10, -6); g.lineTo(10, -6); g.lineTo(7, 9); g.lineTo(-7, 9); g.closePath();
        const bg = g.createLinearGradient(-10, -6, 8, 9); bg.addColorStop(0, P.metal[0]); bg.addColorStop(0.45, P.metal[1]); bg.addColorStop(1, P.metal[2]);
        g.fillStyle = bg; g.fill();
        g.fillStyle = 'rgba(0,0,0,0.4)'; for (let i = -6; i <= 6; i += 3) g.fillRect(i - 0.6, -4, 1.2, 6);
        bevel(g, -5.5, 8, 11, 6, P.metal, 1, 0.4);
        g.fillStyle = '#0a0406'; g.fillRect(-3.5, 12, 7, 3.5);
        rivet(g, -12, -13, 0.9); rivet(g, 12, -13, 0.9);
      } else {
        bevel(g, -15, -16, 30, 8, P.stone, 1, 0.3);
        g.beginPath(); g.moveTo(-11, -8); g.lineTo(11, -8); g.lineTo(5, 10); g.lineTo(-5, 10); g.closePath();
        const bg = g.createLinearGradient(-11, -8, 8, 10); bg.addColorStop(0, P.bronze[0]); bg.addColorStop(0.5, P.bronze[1]); bg.addColorStop(1, P.bronze[2]);
        g.fillStyle = bg; g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(-8, -3); g.lineTo(0, 4); g.lineTo(8, -3); g.stroke();
        g.fillStyle = '#0a0406'; g.beginPath(); g.ellipse(0, 11, 4.5, 3.5, 0, 0, TAU); g.fill();
        g.strokeStyle = P.bronze[0]; g.lineWidth = 1.2; g.beginPath(); g.ellipse(0, 11, 5, 4, 0, 0, TAU); g.stroke();
      }
    });
    ctx.drawImage(hs, -16 - hs.pad, -16 - hs.pad, hs.lw, hs.lh);
    // lens
    const lensY = P.human ? 13.5 : 11.5;
    if (ph === 'on') {
      ctx.fillStyle = C.laserCore; ctx.beginPath(); ctx.arc(0, lensY, 2.6, 0, TAU); ctx.fill();
      glow(ctx, 0, lensY, 10, 10, C.laser, 1);
    } else if (ph === 'warn') {
      const k = 0.5 + 0.5 * Math.sin(t * 40);
      ctx.fillStyle = rgba(C.laserMid, 0.6 + 0.4 * k); ctx.beginPath(); ctx.arc(0, lensY, 2.2, 0, TAU); ctx.fill();
      glow(ctx, 0, lensY, 8 + 4 * k, 8 + 4 * k, C.laser, 0.6 + 0.4 * k);
    } else if (ph === 'off') {
      ctx.fillStyle = '#5a1420'; ctx.beginPath(); ctx.arc(0, lensY, 2.2, 0, TAU); ctx.fill();
      glow(ctx, 0, lensY, 6, 6, C.laser, 0.3 + 0.1 * Math.sin(t * 3));
    } else {
      ctx.fillStyle = '#1d1f24'; ctx.beginPath(); ctx.arc(0, lensY, 2.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-2, lensY - 1); ctx.lineTo(1.5, lensY + 1.5); ctx.stroke();
    }
    // status lamp on the housing
    const sl = ph === 'disabled' ? C.ok : ph === 'off' ? C.warn : C.bad;
    ctx.fillStyle = sl; ctx.fillRect(-1.2, -11.5, 2.4, 1.8);
    glow(ctx, 0, -10.6, 5, 4, sl, ph === 'disabled' ? 0.5 : 0.8);
    ctx.restore();
    if (ph === 'disabled') {
      const s = Math.sin(rot), c = Math.cos(rot);
      const wx = cx - s * (lensY + 2), wy = cy + c * (lensY + 2);
      if (every(e, '_fxT', t, 1.4)) { sparks(wx, wy, { count: 3, speed: 110, color: ['#fff6c8', '#ffb347'] }); e._flashT = t; }
      if (e._flashT != null && t - e._flashT < 0.1) glow(ctx, wx, wy, 8, 8, '#ffd080', 1 - (t - e._flashT) / 0.1);
    }
  }

  // ======================================================================================
  // SAW
  // ======================================================================================
  function sawSprite(P, r) {
    return sprite(`saw:${P.key}:${r}`, r * 2, r * 2, 2, (g) => {
      g.translate(r, r);
      const n = Math.max(10, Math.round(r * 0.8));
      const step = TAU / n;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = i * step;
        g.lineTo(Math.cos(a) * (r - 4.5), Math.sin(a) * (r - 4.5));
        g.lineTo(Math.cos(a + step * 0.62) * r, Math.sin(a + step * 0.62) * r);
        g.lineTo(Math.cos(a + step * 0.78) * (r - 3), Math.sin(a + step * 0.78) * (r - 3));
      }
      g.closePath();
      const cols = P.human ? ['#f4f7fb', '#9aa5b3', '#3a414b'] : ['#f6dca8', '#b08a50', '#4a3218'];
      const gr = g.createLinearGradient(-r, -r, r, r);
      gr.addColorStop(0, cols[0]); gr.addColorStop(0.5, cols[1]); gr.addColorStop(1, cols[2]);
      g.fillStyle = gr; g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.stroke();
      // red danger band
      g.strokeStyle = '#c8202e'; g.lineWidth = Math.max(2, r * 0.13);
      g.beginPath(); g.arc(0, 0, r - 7.5, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.8;
      g.beginPath(); g.arc(0, 0, r - 7.5 + g.lineWidth * 2, 0, TAU); g.stroke();
      // relief slots
      g.fillStyle = 'rgba(0,0,0,0.5)';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        g.save(); g.rotate(a);
        g.beginPath(); g.arc(0, 0, r * 0.52, -0.25, 0.35); g.arc(0, 0, r * 0.44, 0.35, -0.25, true); g.closePath(); g.fill();
        g.restore();
      }
      // hub
      const hg = g.createLinearGradient(-r * 0.25, -r * 0.25, r * 0.25, r * 0.25);
      hg.addColorStop(0, '#e4e9ef'); hg.addColorStop(1, '#4a525e');
      g.fillStyle = hg; g.beginPath(); g.arc(0, 0, r * 0.27, 0, TAU); g.fill();
      g.fillStyle = '#20252c';
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; g.beginPath(); g.arc(Math.cos(a) * r * 0.17, Math.sin(a) * r * 0.17, 1, 0, TAU); g.fill(); }
      if (!P.human) { g.fillStyle = P.glyph; g.beginPath(); g.arc(0, 0, 1.8, 0, TAU); g.fill(); }
    });
  }
  function drawSaw(ctx, e, t, P) {
    const r = e.r || 18;
    const dt = e._lt == null ? 0 : Math.min(0.1, Math.max(0, t - e._lt));
    e._lt = t;
    const run = e.running !== false;
    const target = run ? 18 : 0;
    if (e._spin == null) e._spin = target;
    e._spin = lerp(e._spin, target, 1 - Math.exp(-dt * (run ? 5 : 1.4)));
    e._ang = ((e._ang || 0) + e._spin * dt) % TAU;
    const sp = e._spin / 18;
    // rail
    if (e.pts && e.pts.length > 1) {
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(6,8,12,0.75)'; ctx.lineWidth = 6;
      ctx.beginPath(); e.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (e.mode === 'loop') ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = P.human ? 'rgba(150,160,175,0.55)' : rgba(P.bronze[1], 0.6); ctx.lineWidth = 1.2; ctx.stroke();
      for (const p of [e.pts[0], e.pts[e.pts.length - 1]]) {
        ctx.fillStyle = P.human ? P.metal[1] : P.bronze[1]; ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#0a0c10'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    const s = sawSprite(P, r);
    if (sp > 0.05) glow(ctx, e.x, e.y, r * 1.9, r * 1.9, '#ff3a2a', 0.22 * sp);
    ctx.save();
    ctx.translate(e.x, e.y);
    // motion-blur ghosts
    if (sp > 0.25) {
      for (let i = 1; i <= 2; i++) {
        ctx.save(); ctx.rotate(e._ang - i * 0.16 * sp); ctx.globalAlpha = 0.28 / i;
        ctx.drawImage(s, -r - s.pad, -r - s.pad, s.lw, s.lh); ctx.restore();
      }
    }
    ctx.save(); ctx.rotate(e._ang);
    ctx.drawImage(s, -r - s.pad, -r - s.pad, s.lw, s.lh);
    ctx.restore();
    if (sp > 0.25) {
      // blurred tooth band + hot edge
      ctx.strokeStyle = `rgba(225,230,238,${0.32 * sp})`; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, r - 2, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba('#ff6a3a', 0.35 * sp); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, r - 0.5, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    // fixed key-light sheen (upper-left)
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.7, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
    ctx.restore();
    if (run && every(e, '_fxT', t, 0.22)) {
      const a = Math.random() * TAU;
      const px = e.x + Math.cos(a) * r, py = e.y + Math.sin(a) * r;
      sparks(px, py, { count: 2, angle: a + Math.PI / 2, spread: 0.6, speed: 260, life: 0.3, color: ['#ffffff', '#ffc070', '#ff7a3a'] });
    }
  }

  // ======================================================================================
  // CHECKPOINT
  // ======================================================================================
  function drawCheckpoint(ctx, e, t, P) {
    const x = e.x, y = e.y, cx = x + 16, floor = y + 64;
    const lit = !!e.lit;
    const I = lit ? (e.current ? 1 : 0.45) : 0;
    const lt = e.litT || 0;
    const col = C.safe;
    shadow(ctx, cx + 3, floor, 13, 3, 0.4);
    if (I > 0) glow(ctx, cx, floor, 30, 6, col, 0.45 * I);
    if (P.human) {
      const body = sprite(`cpH:${P.key}`, 32, 64, 2, (g) => {
        bevel(g, 7, 58, 18, 6, P.metal, 1.5, 0.35);
        hazard(g, 8, 61, 16, 2.5, 2.5);
        bevel(g, 14.5, 15, 3.5, 44, P.metal, 0, 0.35);
        bevel(g, 10, 4, 12, 3, P.metal, 1, 0.4);
        bevel(g, 11, 15, 10, 3, P.metal, 1, 0.4);
        g.fillStyle = 'rgba(8,10,14,0.9)'; g.fillRect(11.5, 7, 9, 8);
      });
      blit(ctx, body, x, y);
      // lamp
      const lampC = lit ? col : '#3a1a1c';
      const lg = ctx.createRadialGradient(cx - 1, y + 10, 0.5, cx, y + 11, 5);
      lg.addColorStop(0, lit ? '#ffffff' : '#6a3036'); lg.addColorStop(1, lampC);
      ctx.fillStyle = lg; ctx.fillRect(x + 12, y + 7.5, 8, 7);
      ctx.fillStyle = 'rgba(20,24,30,0.9)'; ctx.fillRect(x + 14.5, y + 7, 1, 8); ctx.fillRect(x + 17.5, y + 7, 1, 8);
      if (lit) glow(ctx, cx, y + 11, 18 + 4 * Math.sin(t * 3), 16, col, 0.7 * I + 0.15);
      else if (Math.sin(t * 2) > 0.85) glow(ctx, cx, y + 11, 6, 6, C.bad, 0.5);
      // hologram flag
      if (lit) {
        const grow = easeOutBack(clamp01(lt / 0.5), 1.6);
        const fw = 18 * grow, fh = 11;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const fa = (0.45 + 0.35 * I) * (0.88 + 0.12 * Math.sin(t * 29));
        ctx.beginPath();
        const N = 8;
        for (let i = 0; i <= N; i++) { const u = i / N; ctx.lineTo(cx + 2 + u * fw, y + 18 + Math.sin(t * 4 - u * 4) * 1.8 * u); }
        for (let i = N; i >= 0; i--) { const u = i / N; ctx.lineTo(cx + 2 + u * fw, y + 18 + fh - u * 2 + Math.sin(t * 4 - u * 4) * 1.8 * u); }
        ctx.closePath();
        ctx.fillStyle = rgba(col, 0.28 * fa); ctx.fill();
        ctx.strokeStyle = rgba(col, 0.9 * fa); ctx.lineWidth = 0.8; ctx.stroke();
        // emblem
        ctx.fillStyle = rgba('#ffffff', 0.7 * fa);
        const ex = cx + 2 + fw * 0.45, ey = y + 18 + fh / 2 - 0.5 + Math.sin(t * 4 - 1.8) * 0.8;
        ctx.beginPath(); ctx.moveTo(ex, ey - 3); ctx.lineTo(ex + 2.5, ey); ctx.lineTo(ex, ey + 3); ctx.lineTo(ex - 2.5, ey); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    } else {
      const body = sprite(`cpA:${P.key}`, 32, 64, 2, (g) => {
        g.beginPath(); g.moveTo(8, 64); g.lineTo(24, 64); g.lineTo(21, 22); g.lineTo(16, 18); g.lineTo(11, 22); g.closePath();
        const gr = g.createLinearGradient(8, 18, 24, 64);
        gr.addColorStop(0, P.stone[0]); gr.addColorStop(0.45, P.stone[1]); gr.addColorStop(1, P.stone[2]);
        g.fillStyle = gr; g.fill();
        g.save(); g.clip(); grain(g, 8, 18, 16, 46, 555);
        g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(8, 18, 1.2, 46);
        g.restore();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(16, 26); g.lineTo(16, 58); g.stroke();
        rune(g, 16, 33, 2, 81); rune(g, 16, 47, 2, 82);
        bevel(g, 6, 59, 20, 5, P.bronze, 1, 0.4);
        bevel(g, 10, 17, 12, 3, P.bronze, 1, 0.45);
        if (P.moss) moss(g, 6, 59, 20, 93);
      });
      blit(ctx, body, x, y);
      // glyph channel light
      if (lit) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = rgba(col, 0.5 + 0.5 * I); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, y + 26); ctx.lineTo(cx, y + 58); ctx.stroke();
        rune(ctx, cx, y + 33, 2, 81); rune(ctx, cx, y + 47, 2, 82);
        ctx.restore();
      }
      // floating crystal + energy flame
      const bob = Math.sin(t * 2.2) * 1.5;
      const ccy = y + 8 + bob;
      if (lit) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 3; i++) {
          const ph = (t * 1.6 + i / 3) % 1;
          const fx = cx + Math.sin(t * 5 + i * 2) * 2 * ph;
          const fy = ccy - 2 - ph * 14;
          const fs = (1 - ph) * 4.2 * (0.6 + 0.4 * I);
          ctx.fillStyle = rgba(col, (1 - ph) * 0.7);
          ctx.beginPath(); ctx.moveTo(fx, fy - fs * 1.8); ctx.quadraticCurveTo(fx + fs, fy, fx, fy + fs); ctx.quadraticCurveTo(fx - fs, fy, fx, fy - fs * 1.8); ctx.fill();
        }
        ctx.restore();
        glow(ctx, cx, ccy, 20, 22, col, 0.55 * I + 0.15);
      }
      const sw = 3.6 * (0.35 + 0.65 * Math.abs(Math.cos(t * 1.4)));
      ctx.beginPath(); ctx.moveTo(cx, ccy - 6); ctx.lineTo(cx + sw, ccy); ctx.lineTo(cx, ccy + 6); ctx.lineTo(cx - sw, ccy); ctx.closePath();
      const cg = ctx.createLinearGradient(cx - 4, ccy - 6, cx + 4, ccy + 6);
      if (lit) { cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.5, col); cg.addColorStop(1, '#1f8a6a'); }
      else { cg.addColorStop(0, '#9aa4ac'); cg.addColorStop(0.5, '#4a545e'); cg.addColorStop(1, '#1c2228'); }
      ctx.fillStyle = cg; ctx.fill();
      if (!lit) glow(ctx, cx, ccy, 8, 8, col, 0.1 + 0.08 * Math.sin(t * 1.8));
    }
    // ignition pulse
    if (lit && lt < 0.6) {
      const k = lt / 0.6;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(col, (1 - k) * 0.9); ctx.lineWidth = 3 * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(cx, y + 12, 8 + easeOutCubic(k) * 60, 0, TAU); ctx.stroke();
      const bg = ctx.createLinearGradient(cx - 10, 0, cx + 10, 0);
      bg.addColorStop(0, rgba(col, 0)); bg.addColorStop(0.5, rgba(col, (1 - k) * 0.6)); bg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = bg; ctx.fillRect(cx - 10, y - 120 * (1 - k * 0.5), 20, 120 * (1 - k * 0.5) + 64);
      ctx.restore();
      glow(ctx, cx, y + 12, 40, 40, '#ffffff', (1 - k) * 0.5);
    }
  }

  // ======================================================================================
  // EXIT
  // ======================================================================================
  function drawExit(ctx, e, t, P) {
    const x = e.x, y = e.y, w = e.w, h = e.h, cx = x + w / 2, floor = y + h;
    const locked = !!e.locked;
    if (e.used && e._usedT == null) e._usedT = t;
    if (!e.used) e._usedT = null;
    const col = P.human ? '#a8f0ff' : P.glyph;
    const ix = x + 3, iy = y + 7, iw = w - 6, ih = h - 7;
    const pulse = 0.85 + 0.15 * Math.sin(t * 2);
    if (!locked) {
      glow(ctx, cx, floor, 52, 9, col, 0.55 * pulse);
      glow(ctx, cx, y + h * 0.55, 42, 62, col, 0.22 * pulse);
    }
    // interior
    ctx.save();
    ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
    if (locked) {
      const g = ctx.createLinearGradient(0, iy, 0, floor);
      g.addColorStop(0, '#05060a'); g.addColorStop(1, '#140608');
      ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const yy = iy + (((t * 12 + i * 23) % ih) + ih) % ih;
        ctx.fillStyle = rgba(C.bad, 0.06 + 0.04 * Math.sin(t * 7 + i)); ctx.fillRect(ix, yy, iw, 1);
      }
    } else {
      ctx.fillStyle = '#0a1418'; ctx.fillRect(ix, iy, iw, ih);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, iy, 0, floor);
      g.addColorStop(0, rgba(col, 0.25 * pulse)); g.addColorStop(0.7, rgba(col, 0.6 * pulse)); g.addColorStop(1, rgba('#ffffff', 0.9));
      ctx.fillStyle = g; ctx.fillRect(ix, iy, iw, ih);
      // shimmering vertical light bands
      for (let i = 0; i < 3; i++) {
        const bx = ix + iw * (0.5 + 0.42 * Math.sin(t * (0.7 + i * 0.3) + i * 2.1));
        const bg = ctx.createLinearGradient(bx - 4, 0, bx + 4, 0);
        bg.addColorStop(0, rgba('#ffffff', 0)); bg.addColorStop(0.5, rgba('#ffffff', 0.22)); bg.addColorStop(1, rgba('#ffffff', 0));
        ctx.fillStyle = bg; ctx.fillRect(bx - 4, iy, 8, ih);
      }
      // rising motes
      for (let i = 0; i < 10; i++) {
        const ph = (t * (0.25 + hash1(i) * 0.2) + hash1(i + 11)) % 1;
        const mx = ix + 2 + hash1(i + 3) * (iw - 4) + Math.sin(t * 2 + i) * 1.5;
        const my = floor - ph * ih;
        ctx.fillStyle = rgba('#ffffff', Math.sin(ph * Math.PI) * 0.9);
        const ms = 0.8 + hash1(i + 7) * 1.2;
        ctx.fillRect(mx, my, ms, ms);
      }
    }
    ctx.restore();
    // frame
    if (P.human) {
      const fr = sprite(`exitH:${P.key}:${w}x${h}`, w, h, 8, (g) => {
        bevel(g, -5, -3, 8, h + 3, P.metal, 1.5, 0.35);
        bevel(g, w - 3, -3, 8, h + 3, P.metal, 1.5, 0.35);
        hazard(g, -3, 14, 3, h - 18, 3); hazard(g, w, 14, 3, h - 18, 3);
        bevel(g, -7, -6, w + 14, 13, P.metal, 2, 0.4);
        g.fillStyle = '#062814'; G.roundRect(g, w / 2 - 13, -4, 26, 8, 1.5); g.fill();
        for (const yy of [6, h - 6]) { rivet(g, -2, yy, 0.9); rivet(g, w + 2, yy, 0.9); }
      });
      blit(ctx, fr, x, y);
      const sc = locked ? C.bad : C.ok;
      ctx.fillStyle = sc; ctx.font = '800 5.6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(locked ? 'ЗАКРЫТО' : 'ВЫХОД', cx, y + 0.3);
      glow(ctx, cx, y, 20, 8, sc, 0.5);
    } else {
      const fr = sprite(`exitA:${P.key}:${w}x${h}`, w, h, 10, (g) => {
        bevel(g, -6, 2, 9, h - 2, P.stone, 1, 0.28);
        bevel(g, w - 3, 2, 9, h - 2, P.stone, 1, 0.28);
        grain(g, -6, 2, 9, h - 2, 1201); grain(g, w - 3, 2, 9, h - 2, 1202);
        g.beginPath(); g.moveTo(-9, 8); g.lineTo(-9, -2); g.lineTo(w / 2 - 6, -8); g.lineTo(w / 2 + 6, -8); g.lineTo(w + 9, -2); g.lineTo(w + 9, 8); g.closePath();
        const lg = g.createLinearGradient(-9, -8, w, 8); lg.addColorStop(0, P.stone[0]); lg.addColorStop(0.5, P.stone[1]); lg.addColorStop(1, P.stone[2]);
        g.fillStyle = lg; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(-9, -2, 1, 10);
        g.fillStyle = P.bronze[1]; g.fillRect(-9, 6.5, w + 18, 1.6);
        // keystone
        bevel(g, w / 2 - 5, -9, 10, 13, P.bronze, 1.5, 0.45);
        g.fillStyle = '#07080a'; g.beginPath(); g.arc(w / 2, -2.5, 3, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1;
        for (const [px, s] of [[-1.5, 1], [w + 1.5, 2]]) { g.beginPath(); g.moveTo(px, 14); g.lineTo(px, h - 10); g.stroke(); rune(g, px, 24, 1.8, 140 + s); rune(g, px, h - 22, 1.8, 150 + s); }
        if (P.moss) { moss(g, -9, -2, w / 2 + 3, 77); moss(g, -6, h - 1, 9, 78); }
      });
      blit(ctx, fr, x, y);
      const gc = locked ? C.bad : P.glyph;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(gc, locked ? 0.45 + 0.2 * Math.sin(t * 2.5) : 0.75 * pulse); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1;
      for (const [px, s] of [[x - 1.5, 1], [x + w + 1.5, 2]]) { ctx.beginPath(); ctx.moveTo(px, y + 14); ctx.lineTo(px, floor - 10); ctx.stroke(); rune(ctx, px, y + 24, 1.8, 140 + s); rune(ctx, px, floor - 22, 1.8, 150 + s); }
      ctx.restore();
      ctx.fillStyle = gc; ctx.beginPath(); ctx.arc(cx, y - 2.5, 1.9, 0, TAU); ctx.fill();
      glow(ctx, cx, y - 2.5, 10, 10, gc, 0.8);
    }
    // lock seal
    if (locked) {
      const k = 0.6 + 0.4 * Math.sin(t * 3);
      const ly = y + h * 0.45;
      glow(ctx, cx, ly, 18, 18, C.bad, 0.45 * k);
      ctx.save();
      ctx.translate(cx, ly);
      ctx.strokeStyle = rgba(C.bad, 0.65 + 0.35 * k); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.stroke();
      ctx.rotate(t * 0.6);
      ctx.lineWidth = 0.8; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.rotate(-t * 0.6);
      // padlock rune
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, -1.5, 2.6, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = rgba(C.bad, 0.65 + 0.35 * k); ctx.fillRect(-3.6, -1.5, 7.2, 5.5);
      ctx.fillStyle = '#14060a'; ctx.fillRect(-0.6, 0, 1.2, 2.4);
      ctx.restore();
    }
    // used: bright flash
    if (e.used && e._usedT != null) {
      const k = clamp01((t - e._usedT) / 0.9);
      glow(ctx, cx, y + h * 0.55, 40 + 120 * k, 60 + 120 * k, '#ffffff', (1 - k) * 0.95);
      glow(ctx, cx, y + h * 0.55, 30, 60, col, 0.6);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ffffff', 0.5 + 0.5 * (1 - k)); ctx.fillRect(ix, iy, iw, ih);
      ctx.restore();
    }
  }

  // ======================================================================================
  // SHARD
  // ======================================================================================
  function drawShard(ctx, e, t, P) {
    let k = 0;
    if (e.collected) { k = (e.collectT || 0) / 0.4; if (k >= 1) return; }
    const seed = (e.index || 0) * 1.7 + (e.tx || 0) * 0.31;
    const cx = e.x + 8;
    const cy = e.y + 8 + Math.sin(t * 2.4 + seed) * 2.2 - easeOutCubic(k) * 18;
    const s = 1 + easeOutBack(k) * 0.7;
    const a = 1 - k * k;
    glow(ctx, cx, cy, 16 * s, 16 * s, C.shard, (0.4 + 0.12 * Math.sin(t * 3 + seed)) * a + k * 0.6);
    if (!e.collected) shadow(ctx, cx + 1, e.y + 24, 5, 1.6, 0.25);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, cy); ctx.scale(s, s);
    // spinning bipyramid: 4 equator vertices
    const phi = t * 2.2 + seed + k * 12;
    const R = 5.5, TOP = -8, BOT = 8.5, EQ = -0.5;
    const verts = [];
    for (let i = 0; i < 4; i++) { const an = phi + (i * Math.PI) / 2; verts.push({ x: Math.cos(an) * R, z: Math.sin(an) }); }
    const faces = [];
    for (let i = 0; i < 4; i++) {
      const a0 = verts[i], a1 = verts[(i + 1) % 4];
      const z = (a0.z + a1.z) / 2;
      if (z < -0.05) continue;
      const nx = (a0.x + a1.x) / 2 / R; // facing −1 (left) .. +1 (right)
      faces.push({ a0, a1, z, nx });
    }
    faces.sort((p, q) => p.z - q.z);
    for (const f of faces) {
      const lit = clamp01(0.55 - f.nx * 0.45 + f.z * 0.2);
      ctx.fillStyle = lit > 0.7 ? '#e6ffff' : lit > 0.45 ? '#86f6ff' : '#2aa0c4';
      ctx.beginPath(); ctx.moveTo(0, TOP); ctx.lineTo(f.a0.x, EQ); ctx.lineTo(f.a1.x, EQ); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lit > 0.7 ? '#9ef8ff' : lit > 0.45 ? '#3ccbe6' : '#16627e';
      ctx.beginPath(); ctx.moveTo(0, BOT); ctx.lineTo(f.a0.x, EQ); ctx.lineTo(f.a1.x, EQ); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(230,255,255,0.75)'; ctx.lineWidth = 0.6;
    let minX = 0, maxX = 0; for (const v of verts) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); }
    ctx.beginPath(); ctx.moveTo(0, TOP); ctx.lineTo(maxX, EQ); ctx.lineTo(0, BOT); ctx.lineTo(minX, EQ); ctx.closePath(); ctx.stroke();
    ctx.restore();
    const sp = ((t * 0.8 + seed) % 1.7) / 1.7;
    const sa = sp < 0.2 ? Math.sin((sp / 0.2) * Math.PI) : 0;
    star(ctx, cx - 3, cy - 5, 5 * sa, '#ffffff', sa * a);
    if (k > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(C.shard, (1 - k) * 0.9); ctx.lineWidth = 2 * (1 - k) + 0.4;
      ctx.beginPath(); ctx.arc(cx, cy, 5 + easeOutCubic(k) * 24, 0, TAU); ctx.stroke();
      ctx.restore();
      star(ctx, cx, cy, 14 * (1 - k), '#ffffff', 1 - k);
    }
  }

  // ======================================================================================
  // JUMP PAD
  // ======================================================================================
  function drawJumppad(ctx, e, t, P) {
    const x = e.x, y = e.y, cx = x + 16, floor = y + 10;
    const ft = e.fireT == null ? 99 : e.fireT;
    const ext = ft < 1.5 ? 12 * Math.exp(-ft * 6) * Math.cos(ft * 26) : 0;
    const breathe = ft >= 1.5 ? 0.5 + 0.5 * Math.sin(t * 3) : 0;
    const top = y + 1 - ext + breathe * 0.6;
    const col = C.jump;
    const fire = ft < 0.45 ? 1 - ft / 0.45 : 0;
    shadow(ctx, cx + 2, floor, 17, 2.5, 0.45);
    glow(ctx, cx, top, 20, 7 + fire * 10, col, 0.3 + 0.12 * Math.sin(t * 4) + fire * 0.9);
    // springs
    ctx.strokeStyle = P.human ? '#c9d1dc' : P.bronze[0]; ctx.lineWidth = 1.3; ctx.lineJoin = 'round';
    for (const sx of [x + 9, x + 23]) {
      const yA = floor - 4, yB = top + 3;
      ctx.beginPath(); ctx.moveTo(sx, yA);
      for (let i = 1; i <= 6; i++) ctx.lineTo(sx + (i % 2 ? 3 : -3), lerp(yA, yB, i / 6));
      ctx.lineTo(sx, yB); ctx.stroke();
    }
    const base = sprite(`jpB:${P.key}`, 32, 5, 1, (g) => {
      if (P.human) { bevel(g, 1, 0, 30, 5, P.metal, 1.5, 0.35); hazard(g, 3, 2, 26, 2, 2.5); }
      else { bevel(g, 1, 0, 30, 5, P.stone, 1.5, 0.3); g.fillStyle = P.bronze[1]; g.fillRect(1, 0, 30, 1.2); }
    });
    blit(ctx, base, x, floor - 5);
    const plate = sprite(`jpT:${P.key}`, 30, 4, 1, (g) => {
      bevel(g, 0, 0, 30, 4, P.human ? P.metal : P.bronze, 1.5, 0.5);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(4, 1.5, 22, 1);
    });
    blit(ctx, plate, x + 1, top);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(col, 0.6 + 0.4 * fire + 0.15 * Math.sin(t * 4)); ctx.fillRect(x + 5, top + 1.5, 22, 1);
    // chevrons
    ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      let a, yy;
      if (fire > 0) { a = fire * (1 - i * 0.2); yy = top - 6 - i * 6 - (1 - fire) * 40; }
      else { const ph = ((t * 1.2 - i * 0.33) % 1 + 1) % 1; a = Math.sin(ph * Math.PI) * 0.45; yy = top - 4 - ph * 16; }
      ctx.strokeStyle = rgba(col, a);
      ctx.beginPath(); ctx.moveTo(cx - 5, yy + 3); ctx.lineTo(cx, yy); ctx.lineTo(cx + 5, yy + 3); ctx.stroke();
    }
    ctx.restore();
  }

  // ======================================================================================
  // SIGN
  // ======================================================================================
  function drawSign(ctx, e, t, P) {
    const x = e.x, y = e.y, cx = x + 16;
    shadow(ctx, cx + 3, y + 32, 11, 2.5, 0.4);
    if (P.human) {
      const s = sprite(`signH:${P.key}`, 32, 32, 2, (g) => {
        bevel(g, 14.5, 18, 3, 14, P.metal, 0, 0.35);
        bevel(g, 10, 30, 12, 2, P.metal, 1, 0.3);
        g.fillStyle = 'rgba(0,0,0,0.4)'; G.roundRect(g, 4.8, 3.8, 24, 16, 2); g.fill();
        bevel(g, 4, 3, 24, 16, ['#3e4a5a', '#283240', '#141a22'], 2, 0.3);
        g.strokeStyle = C.hazA; g.lineWidth = 1; G.roundRect(g, 5.5, 4.5, 21, 13, 1.5); g.stroke();
        g.fillStyle = 'rgba(230,236,244,0.85)';
        g.fillRect(8, 7.5, 2.4, 2.4); g.fillRect(8.4, 10.8, 1.6, 4);
        g.fillStyle = 'rgba(230,236,244,0.6)'; g.fillRect(12.5, 8, 11, 1.2); g.fillRect(12.5, 11, 9, 1.2); g.fillRect(12.5, 14, 10, 1.2);
        rivet(g, 6, 5, 0.6); rivet(g, 26, 5, 0.6);
      });
      blit(ctx, s, x, y);
      const a = 0.5 + 0.5 * Math.sin(t * 2.5);
      ctx.fillStyle = rgba(P.accent, 0.5 + 0.5 * a); ctx.fillRect(x + 25.5, y + 16.5, 1.6, 1.6);
      glow(ctx, x + 26.3, y + 17.3, 6, 5, P.accent, 0.5 * a);
    } else {
      const s = sprite(`signA:${P.key}`, 32, 32, 2, (g) => {
        bevel(g, 9, 25, 14, 7, P.stone, 1, 0.3);
        g.fillStyle = 'rgba(0,0,0,0.4)';
        g.beginPath(); g.moveTo(6.8, 26); g.lineTo(6.8, 8); g.quadraticCurveTo(6.8, 2.8, 16.8, 2.8); g.quadraticCurveTo(26.8, 2.8, 26.8, 8); g.lineTo(26.8, 26); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(6, 25); g.lineTo(6, 7); g.quadraticCurveTo(6, 2, 16, 2); g.quadraticCurveTo(26, 2, 26, 7); g.lineTo(26, 25); g.closePath();
        const gr = g.createLinearGradient(6, 2, 22, 25); gr.addColorStop(0, P.stone[0]); gr.addColorStop(0.45, P.stone[1]); gr.addColorStop(1, P.stone[2]);
        g.fillStyle = gr; g.fill();
        g.save(); g.clip(); grain(g, 6, 2, 20, 23, 404); g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(6, 2, 1, 23); g.restore();
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.8; g.strokeRect(8.5, 7.5, 15, 15);
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.fillStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.9;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rune(g, 11 + c * 5, 10.5 + r * 5, 1.25, r * 3 + c + 200);
        if (P.moss) moss(g, 7, 3, 18, 405);
      });
      blit(ctx, s, x, y);
      const a = 0.45 + 0.3 * Math.sin(t * 1.8 + x * 0.05);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(P.glyph2, a); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 0.9;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rune(ctx, x + 11 + c * 5, y + 10.5 + r * 5, 1.25, r * 3 + c + 200);
      ctx.restore();
      glow(ctx, cx, y + 15, 16, 14, P.glyph2, 0.18 * a);
    }
  }

  // ------------------------------------------------------------------ dispatcher
  const DRAW = {
    door: drawDoor, bridge: drawBridge, lever: drawLever, plate: drawPlate, terminal: drawTerminal,
    part: drawPart, socket: drawSocket, mplatform: drawMPlatform, crate: drawCrate, laser: drawLaser,
    saw: drawSaw, checkpoint: drawCheckpoint, exit: drawExit, shard: drawShard, jumppad: drawJumppad, sign: drawSign,
  };

  G.Art.Entities = {
    /**
     * Draw one entity in WORLD space. Style adapts to `level.biome` (human ship/wreck vs
     * Architect tech). Restores all ctx state before returning.
     * @param {CanvasRenderingContext2D} ctx camera-translated context
     * @param {object} e runtime entity (fields per docs/level-format.md §4)
     * @param {number} t level time in seconds
     * @param {object} level runtime level (uses `biome`, `def.variant`)
     */
    draw(ctx, e, t, level) {
      const fn = DRAW[e.type];
      if (!fn) return;
      const P = palette(level || (G.game && G.game.level));
      ctx.save();
      try { fn(ctx, e, t, P); } finally { ctx.restore(); }
    },
    /**
     * Draw a repair-item icon (fuse, cell, gear, lens, chip, core, valve, antenna) centred at
     * (x, y). Useful for the player's carried item and UI. `mono` draws a flat silhouette.
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} item
     * @param {number} x
     * @param {number} y
     * @param {number} [size=18] icon size in px
     * @param {string|null} [mono] silhouette colour
     * @param {number} [rot=0] rotation in radians
     */
    drawItem(ctx, item, x, y, size = 18, mono = null, rot = 0) {
      ctx.save();
      try { drawItem(ctx, item, x, y, size, mono, rot); } finally { ctx.restore(); }
    },
    /** Drop all cached sprites (e.g. after a palette change). */
    clearCache() { cache.clear(); },
  };
})();
