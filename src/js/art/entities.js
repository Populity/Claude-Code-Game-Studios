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
 *
 * Chapter 2 types: anchor, wind, dashcrystal, fallplat, sentinel, npc (who 'echo' = ЭХО;
 * `talking` + `talkMood` drive head tilt, ring pulse, grille and arm gestures). Dash energy = magenta.
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
    let k = lerp(easeInOutCubic(o), easeOutCubic(o), 0.4) + 0.06 * Math.sin(clamp01((o - 0.82) / 0.18) * Math.PI);
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
    // translucent recess: the opening must read as passable (background visible)
    ctx.fillStyle = 'rgba(4,6,10,0.22)'; ctx.fillRect(px, py, pw, ph);
    if (k > 0.02) { shadow(ctx, x + w / 2, py + half - d + 2, pw * 0.7, 4, 0.5); shadow(ctx, x + w / 2, py + half + d - 2, pw * 0.7, 4, 0.35); }
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
    ctx.fillStyle = 'rgba(4,5,8,0.22)'; ctx.fillRect(px, py, pw, ph);
    if (k > 0.02 && k < 0.999) shadow(ctx, x + w / 2, py + ph - d + 2, pw * 0.8, 4, 0.55);
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
        // opaque core so the walkable plane reads on bright backgrounds too
        for (const [sx, sw] of segs) {
          ctx.fillStyle = rgba('#0b2a33', 0.35 + 0.3 * solid); ctx.fillRect(sx, y + 1, sw, 6.5);
          ctx.fillStyle = rgba(col, (0.3 + 0.4 * solid) * fl); ctx.fillRect(sx, y + 1, sw, 6);
          ctx.fillStyle = rgba('#ffffff', (0.55 + 0.45 * solid) * fl); ctx.fillRect(sx, y, sw, 1.4);
          ctx.fillStyle = rgba('#03141a', 0.5 * a); ctx.fillRect(sx, y + 7, sw, 0.8);
        }
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
      ctx.fillStyle = rgba(e.active ? P.glyph : P.glyph2, e.active ? 0.95 : 0.6 + 0.2 * Math.sin(t * 2.5));
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
      ctx.fillRect(lx - 1.1, y + 3.8, 2.2, 1.6);
    }
    glow(ctx, x + w / 2, y + 4.6, w * 0.6, 5, col, e.active ? 0.8 : 0.4 + 0.1 * Math.sin(t * 3));
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
    glow(ctx, cx, floor, 16, 5, C.item, 0.6);
    glow(ctx, cx, cy, 22, 22, C.item, 0.6 + 0.15 * Math.sin(t * 3 + seed));
    glow(ctx, cx, cy, 9, 9, '#fff4c0', 0.35);
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
        g.fillText('K-7', w / 2, 8.5);
        if (P.wreck) { const r = G.rng(71); for (let i = 0; i < 6; i++) { g.fillStyle = rgba(P.rust, 0.3 + r() * 0.35); g.fillRect(r() * w, r() * h, 1 + r() * 3, 2 + r() * 6); } }
      } else {
        g.fillStyle = 'rgba(6,8,10,0.6)'; G.roundRect(g, -0.8, -0.8, w + 1.6, h + 1.6, 2.5); g.fill();
        bevel(g, 0, 0, w, h, P.stone, 2, 0.35);
        grain(g, 0, 0, w, h, G.hash(P.key + 'crate'));
        // chiselled bevel
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(3, 3, w - 6, 1); g.fillRect(3, 3, 1, h - 6);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(3, h - 4, w - 6, 1); g.fillRect(w - 4, 3, 1, h - 6);
        // carved glyph square
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.4; g.strokeRect(8.5, 8.5, w - 17, h - 17);
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.8; g.strokeRect(9.8, 9.8, w - 17, h - 17);
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
      ctx.strokeStyle = rgba(P.glyph, 0.45 + 0.15 * Math.sin(t * 1.5 + x)); ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1;
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
    glow(ctx, cx, cy, 18 * s, 18 * s, C.shard, (0.75 + 0.2 * Math.sin(t * 3 + seed)) * a + k * 0.6);
    glow(ctx, cx, cy, 7 * s, 9 * s, '#ffffff', 0.3 * a);
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
    glow(ctx, cx, top, 22, 8 + fire * 10, col, 0.5 + 0.15 * Math.sin(t * 4) + fire * 0.9);
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
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      let a, yy;
      if (fire > 0) { a = fire * (1 - i * 0.2); yy = top - 6 - i * 6 - (1 - fire) * 40; }
      else { const ph = ((t * 1.2 - i * 0.33) % 1 + 1) % 1; a = Math.sin(ph * Math.PI) * 0.75; yy = top - 4 - ph * 16; }
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

  // ======================================================================================
  // CHAPTER 2 (docs/chapter2-spec.md §2, §4). All fields read defensively.
  // ======================================================================================
  const DASH = '#ff6ad5', ECHO = '#ffd27a', SENT = '#ff3b3b';
  /** Centre of an entity whether the engine stores a rect (x,y,w,h) or a centre (cx/cy or w=0). */
  function centre(e) {
    const cx = e.cx != null ? e.cx : e.x + (e.w || 0) / 2;
    const cy = e.cy != null ? e.cy : e.y + (e.h || 0) / 2;
    return [cx, cy];
  }
  /** Own clock for a field value: seconds since `e[field]` last changed (for unknown timers). */
  const since = new WeakMap();
  function sinceChange(e, field, t) {
    let m = since.get(e);
    if (!m) { m = {}; since.set(e, m); }
    const v = e[field];
    const s = m[field];
    if (!s || s.v !== v || t < s.t - 0.01) { m[field] = { v, t: s ? t : t - 99 }; return s ? 0 : 99; }
    return t - s.t;
  }

  // ------------------------------------------------------------------ ANCHOR (grapple point)
  function drawAnchor(ctx, e, t, P) {
    const [cx, cy] = e.w ? centre(e) : [e.x + T / 2, e.y + T / 2];
    const att = !!e.attached;
    const col = att ? C.jump : P.glyph;
    // reach indicator when the player is airborne and in range
    const pl = G.game && G.game.player;
    let near = 0;
    if (pl && !pl.dead) {
      const reach = (e.len || (G.CONFIG && G.CONFIG.swing && G.CONFIG.swing.reach) || 4) * T;
      const d = Math.hypot(pl.x + pl.w / 2 - cx, pl.y + 10 - cy);
      near = d < reach ? 1 - d / reach * 0.6 : 0;
      if (!pl.onGround && d < reach && !att) {
        ctx.save();
        ctx.strokeStyle = rgba(C.jump, 0.18 + 0.12 * Math.sin(t * 6)); ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = -t * 12;
        ctx.beginPath(); ctx.arc(cx, cy, 14 + 2 * Math.sin(t * 6), 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }
    // mount: bronze bracket bolted into the rock
    const body = sprite(`anc:${P.key}`, 24, 24, 3, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(13, 13, 10, 0, TAU); g.fill();
      const m = P.metal;
      const gr = g.createLinearGradient(2, 2, 22, 22); gr.addColorStop(0, m[0]); gr.addColorStop(0.5, m[1]); gr.addColorStop(1, m[2]);
      g.fillStyle = gr;
      g.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU + Math.PI / 8; g.lineTo(12 + Math.cos(a) * 10, 12 + Math.sin(a) * 10); }
      g.closePath(); g.fill();
      g.strokeStyle = '#12141d'; g.lineWidth = 1; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(5, 6, 6, 1);
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; rivet(g, 12 + Math.cos(a) * 7.4, 12 + Math.sin(a) * 7.4, 0.9); }
      g.fillStyle = '#12141d'; g.beginPath(); g.arc(12, 12, 5, 0, TAU); g.fill();
    });
    blit(ctx, body, cx - 12, cy - 12);
    // energy eye + rotating claw ring
    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + cx * 0.01);
    glow(ctx, cx, cy, 16 + near * 8, 16 + near * 8, col, (att ? 0.9 : 0.35 + 0.3 * pulse) + near * 0.25);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx, cy, 2.6 + (att ? 0.8 : 0.4 * pulse), 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(cx - 0.7, cy - 0.7, 0.9, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    const spin = t * (att ? 4 : 0.8);
    const r = att ? 4.2 : 4.8 + near;
    for (let i = 0; i < 3; i++) { const a = spin + i / 3 * TAU; ctx.beginPath(); ctx.arc(cx, cy, r, a, a + 1.2); ctx.stroke(); }
  }

  // ------------------------------------------------------------------ WIND current zone
  function windIntensity(e, t) {
    if (e.on === false || e.phase === 'off' || e.phase === 'disabled') return 0.08;
    if (e.phase === 'warn') return 0.25 + 0.2 * (Math.floor(t * 12) % 2);
    if (typeof e.phase === 'number') return 0.08 + 0.92 * clamp01(e.phase);
    return 1;
  }
  function drawWind(ctx, e, t, P) {
    const x = e.x, y = e.y, w = e.w || T, h = e.h || T;
    const dir = e.dir || 'up';
    const ux = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, uy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    const I = windIntensity(e, t);
    const str = (e.strength || 900) / 900;
    const along = ux ? w : h, across = ux ? h : w;
    const col = '#d8f4ff';
    // faint volume tint
    ctx.save();
    const g0 = ux ? ctx.createLinearGradient(ux > 0 ? x : x + w, 0, ux > 0 ? x + w : x, 0) : ctx.createLinearGradient(0, uy > 0 ? y : y + h, 0, uy > 0 ? y + h : y);
    g0.addColorStop(0, `rgba(190,235,255,${0.10 * I})`); g0.addColorStop(1, 'rgba(190,235,255,0)');
    ctx.fillStyle = g0; ctx.fillRect(x, y, w, h);
    // streaks (deterministic lanes, flow along dir)
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    const lanes = Math.min(48, Math.max(3, Math.round(across / 5)));
    const per = Math.min(4, Math.max(2, Math.round(along / 60)));
    const speed = 220 * Math.sqrt(str) * (0.4 + 0.6 * I);
    for (let i = 0; i < lanes; i++) {
      const s = hash1(i * 3.1 + x * 0.013 + y * 0.007);
      const off = (i + 0.5) / lanes * across + (s - 0.5) * 4;
      for (let k = 0; k < per; k++) {
        const L = 10 + 22 * hash1(i * 7.7 + k) * (0.5 + 0.5 * str);
        const sp = speed * (0.7 + 0.6 * hash1(i * 1.3 + k * 9));
        const pos = ((t * sp + s * along * 3 + k * along / per) % (along + L)) - L;
        const wob = Math.sin(t * 5 + i + k) * 1.4;
        const a = (0.3 + 0.4 * hash1(i + k * 5)) * I;
        if (a < 0.02) continue;
        ctx.strokeStyle = rgba(col, a); ctx.lineWidth = 0.8 + hash1(i * 2 + k) * 0.8;
        ctx.beginPath();
        if (ux) {
          const sx = ux > 0 ? x + pos : x + w - pos;
          ctx.moveTo(sx, y + off + wob); ctx.lineTo(sx + ux * L, y + off - wob * 0.5);
        } else {
          const sy = uy > 0 ? y + pos : y + h - pos;
          ctx.moveTo(x + off + wob, sy); ctx.lineTo(x + off - wob * 0.5, sy + uy * L);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
    // upstream vent grille (bronze louvres) on the source edge
    ctx.save();
    const vx = ux ? (ux > 0 ? x : x + w) : x, vy = uy ? (uy > 0 ? y : y + h) : y;
    const vertical = !!ux;
    const len = vertical ? h : w;
    ctx.fillStyle = '#12141d';
    if (vertical) ctx.fillRect(vx - 3, vy, 6, len); else ctx.fillRect(vx, vy - 3, len, 6);
    ctx.fillStyle = P.metal[1];
    if (vertical) ctx.fillRect(vx - 2, vy + 1, 4, len - 2); else ctx.fillRect(vx + 1, vy - 2, len - 2, 4);
    ctx.fillStyle = P.metal[2];
    for (let i = 4; i < len - 2; i += 5) { if (vertical) ctx.fillRect(vx - 2, vy + i, 4, 1.4); else ctx.fillRect(vx + i, vy - 2, 1.4, 4); }
    ctx.fillStyle = rgba(P.glyph, 0.35 + 0.55 * I);
    if (vertical) ctx.fillRect(vx - 0.5, vy + 2, 1, len - 4); else ctx.fillRect(vx + 2, vy - 0.5, len - 4, 1);
    ctx.restore();
    // drifting dust
    if (I > 0.5 && G.fx && every(e, '_windFx', t, 0.18) && inView(x + w / 2, y + h / 2, 60)) {
      const r = Math.random();
      const px = ux ? (ux > 0 ? x + 2 : x + w - 2) : x + r * w, py = uy ? (uy > 0 ? y + 2 : y + h - 2) : y + r * h;
      G.fx.spawn({ x: px, y: py, vx: ux * 260 * str, vy: uy * 260 * str, life: Math.min(1.2, along / 260), size: 1.4, color: '#e9f6ff', drag: 0.4, gravity: 0 });
    }
  }

  // ------------------------------------------------------------------ DASH CRYSTAL
  function drawDashCrystal(ctx, e, t, P) {
    const [cx, cy0] = centre(e);
    const ready = e.ready !== false;
    const regrow = (G.CONFIG && G.CONFIG.dashcrystal && G.CONFIG.dashcrystal.regrow) || 2.5;
    const st = sinceChange(e, 'ready', t);
    const cy = cy0 + Math.sin(t * 2.4 + cx * 0.05) * 2.2;
    if (!ready) {
      const k = clamp01(st / regrow);
      // shattered: an outline that refills from the bottom
      ctx.save();
      ctx.strokeStyle = rgba(DASH, 0.25 + 0.3 * k); ctx.lineWidth = 0.8; ctx.setLineDash([2, 2]);
      crystalPath(ctx, cx, cy, 5.5 + 2.5 * k, t); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.rect(cx - 10, cy + 10 - 20 * k, 20, 20 * k); ctx.clip();
      crystalPath(ctx, cx, cy, 5.5 + 2.5 * k, t); ctx.fillStyle = rgba(DASH, 0.25); ctx.fill();
      ctx.restore();
      if (st < 0.35) { // pop ring
        const q = st / 0.35;
        ctx.strokeStyle = rgba('#ffe2f7', 0.9 * (1 - q)); ctx.lineWidth = 2 * (1 - q) + 0.3;
        ctx.beginPath(); ctx.arc(cx, cy, 6 + 20 * easeOutCubic(q), 0, TAU); ctx.stroke();
      }
      return;
    }
    const born = st < 0.3 ? easeOutBack(st / 0.3) : 1;
    shadow(ctx, cx + 2, cy0 + 16, 7, 1.6, 0.25);
    glow(ctx, cx, cy, 22, 22, DASH, 0.55 + 0.15 * Math.sin(t * 5));
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(born, born); ctx.translate(-cx, -cy);
    // faceted body: 3 tones split by a rotating ridge (fake 3D spin)
    const r = 8, ridge = Math.sin(t * 1.7) * 3.2;
    ctx.fillStyle = '#12141d'; crystalPath(ctx, cx, cy, r + 1.2, t); ctx.fill();
    ctx.fillStyle = '#b82f8f'; crystalPath(ctx, cx, cy, r, t); ctx.fill();
    ctx.fillStyle = DASH;
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.45); ctx.lineTo(cx + ridge, cy); ctx.lineTo(cx, cy + r * 1.45); ctx.lineTo(cx - r * 0.95, cy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd0f4';
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.45); ctx.lineTo(cx + ridge, cy); ctx.lineTo(cx - r * 0.95, cy); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.45); ctx.lineTo(cx + ridge, cy); ctx.lineTo(cx, cy + r * 1.45); ctx.stroke();
    // inner core
    glow(ctx, cx, cy, 6, 6, '#ffffff', 0.6 + 0.3 * Math.sin(t * 7));
    ctx.restore();
    // orbiting motes
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = t * 2.2 + i / 3 * TAU;
      const ox = Math.cos(a) * 12, oy = Math.sin(a) * 4;
      ctx.fillStyle = rgba('#ffd0f4', oy < 0 ? 0.35 : 0.85);
      ctx.fillRect(cx + ox - 0.8, cy + oy - 0.8, 1.6, 1.6);
    }
    ctx.restore();
  }
  function crystalPath(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 1.45); ctx.lineTo(cx + r * 0.95, cy); ctx.lineTo(cx, cy + r * 1.45); ctx.lineTo(cx - r * 0.95, cy); ctx.closePath();
  }

  // ------------------------------------------------------------------ FALLING PLATFORM
  function drawFallPlat(ctx, e, t, P) {
    const state = e.state || 'idle';
    const w = e.w || 2 * T, hh = Math.min(e.h || 16, 16);
    let x = e.x, y = e.y;
    const st = e.t != null ? e.t : sinceChange(e, 'state', t);
    if (state === 'gone') {
      // respawn shimmer at home (only when the engine exposes it)
      const hy = e.homeY != null ? e.homeY : e.y0 != null ? e.y0 : e.home && e.home.y;
      const hx = e.homeX != null ? e.homeX : e.x0 != null ? e.x0 : e.home && e.home.x != null ? e.home.x : x;
      const resp = (G.CONFIG && G.CONFIG.fallplat && G.CONFIG.fallplat.respawn) || 3;
      if (hy != null && st > resp - 0.6) {
        const k = clamp01((st - (resp - 0.6)) / 0.6);
        ctx.strokeStyle = rgba(P.glyph, 0.6 * k * (0.6 + 0.4 * Math.sin(t * 30))); ctx.lineWidth = 1;
        ctx.strokeRect(hx + 0.5, hy + 0.5, w - 1, hh - 1);
      }
      return;
    }
    let rot = 0;
    if (state === 'shaking') {
      const k = clamp01(st / ((G.CONFIG && G.CONFIG.fallplat && G.CONFIG.fallplat.shake) || 0.5));
      x += Math.sin(t * 90) * (0.6 + 1.4 * k); y += Math.sin(t * 73 + 1) * 0.5 * k;
      if (G.fx && every(e, '_fpFx', t, 0.08) && inView(x + w / 2, y)) {
        G.fx.spawn({ x: x + Math.random() * w, y: y + hh, vx: 0, vy: 30, life: 0.6, size: 1.6, color: P.human ? '#8b8f96' : P.stone[1], gravity: 700 });
      }
    } else if (state === 'falling') rot = Math.min(0.12, st * 0.15) * (hash1(e.x * 0.1) < 0.5 ? -1 : 1);
    const key = `fp:${P.key}:${w}:${hh}`;
    const body = sprite(key, w, hh, 2, (g) => {
      if (P.human) { bevel(g, 0, 0, w, hh, P.metal, 2, 0.35); hazard(g, 2, 2, w - 4, 3, 4); }
      else {
        bevel(g, 0, 0, w, hh, P.stone, 2, 0.3);
        g.save(); G.roundRect(g, 0, 0, w, hh, 2); g.clip(); grain(g, 0, 0, w, hh, Math.round(w * 7 + hh), true); g.restore();
        g.fillStyle = P.bronze[1]; g.fillRect(0, 0, w, 2); g.fillStyle = P.bronze[0]; g.fillRect(0, 0, w, 0.8);
        // under-teeth: it is clearly not anchored
        g.fillStyle = P.stone[2];
        for (let i = 3; i < w - 3; i += 7) { g.beginPath(); g.moveTo(i, hh); g.lineTo(i + 3, hh + 2); g.lineTo(i + 6, hh); g.fill(); }
      }
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(w * 0.32, 2); g.lineTo(w * 0.36, hh * 0.5); g.lineTo(w * 0.31, hh); g.moveTo(w * 0.7, 2); g.lineTo(w * 0.66, hh * 0.6); g.stroke();
    });
    ctx.save();
    ctx.translate(x + w / 2, y + hh / 2); ctx.rotate(rot); ctx.translate(-w / 2, -hh / 2);
    blit(ctx, body, 0, 0);
    // glowing crack + warning glyphs while shaking
    const warn = state === 'shaking' ? 1 : state === 'falling' ? 0.5 : 0;
    const a = warn ? 0.5 + 0.5 * Math.sin(t * 40) : 0.25 + 0.1 * Math.sin(t * 2);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(warn ? '#ff7a3a' : P.glyph, a); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(w * 0.32, 2); ctx.lineTo(w * 0.36, hh * 0.5); ctx.lineTo(w * 0.31, hh); ctx.moveTo(w * 0.7, 2); ctx.lineTo(w * 0.66, hh * 0.6); ctx.stroke();
    ctx.fillStyle = rgba(warn ? '#ff7a3a' : P.glyph, a * 0.8);
    for (let i = 8; i < w - 6; i += 16) ctx.fillRect(i, hh * 0.5 - 0.5, 4, 1);
    ctx.restore();
  }

  // ------------------------------------------------------------------ SENTINEL (Architect guard drone)
  const smem = new WeakMap();
  function drawSentinel(ctx, e, t, P) {
    const [cx, cy] = centre(e);
    const state = e.state || 'patrol';
    let m = smem.get(e);
    if (!m || t < m.t - 0.01) { m = { t, tilt: 0, open: 0, ex: 0, ey: 0, heat: 0, face: 1 }; smem.set(e, m); }
    const dt = clamp01(t - m.t) ; m.t = t;
    const vx = e.vx || 0, vy = e.vy || 0;
    const chase = state === 'chase', alert = state === 'alert', stun = state === 'stunned';
    const heatT = chase ? 1 : alert ? 0.85 : state === 'return' ? 0.25 : stun ? 0 : 0.35;
    const k = 1 - Math.exp(-10 * dt);
    m.heat += (heatT - m.heat) * k;
    m.open += ((chase ? 1 : alert ? 0.7 : stun ? -0.6 : 0) - m.open) * k;
    if (Math.abs(vx) > 8) m.face = vx > 0 ? 1 : -1;
    m.tilt += ((stun ? 0.9 * m.face : Math.max(-0.45, Math.min(0.45, vx / 400))) - m.tilt) * (1 - Math.exp(-6 * dt));
    // eye look target
    let lx = m.face * 6, ly = 2;
    if (e.eye && isFinite(e.eye.x)) { const dx = e.eye.x - cx, dy = e.eye.y - cy, d = Math.hypot(dx, dy) || 1; lx = dx / d * 2.4; ly = dy / d * 2.4; }
    else if (state === 'patrol') { lx = Math.sin(t * 1.3) * 2.4; ly = 1; }
    else { const d = Math.hypot(lx, ly); lx = lx / d * 2.4; ly = ly / d * 2.4; }
    m.ex += (lx - m.ex) * (1 - Math.exp(-14 * dt)); m.ey += (ly - m.ey) * (1 - Math.exp(-14 * dt));
    const at = alert ? (e.alertT != null ? e.alertT : sinceChange(e, 'state', t)) : 0;
    const jx = alert ? Math.sin(t * 80) * 0.8 : 0;
    const bob = stun ? 0 : Math.sin(t * 3.2 + cx * 0.02) * 1.2;
    const heat = m.heat;
    const eyeCol = stun ? '#5a6d80' : heat > 0.6 ? SENT : '#ffb347';
    const flick = stun ? (hash1(Math.floor(t * 14)) < 0.18 ? 0.8 : 0.05) : 1;

    // detection cone (patrol scan / chase lock)
    if (!stun) {
      const ang = Math.atan2(m.ey, m.ex);
      const reach = Math.min(90, ((e.range || 7) * T) * 0.4);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const cg = ctx.createRadialGradient(cx, cy, 2, cx, cy, reach);
      cg.addColorStop(0, rgba(eyeCol, 0.16 * heat + 0.04)); cg.addColorStop(1, rgba(eyeCol, 0));
      ctx.fillStyle = cg;
      const spread = chase ? 0.18 : 0.35;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, reach, ang - spread, ang + spread); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // chase thrust trail
    if (chase && (Math.abs(vx) + Math.abs(vy)) > 30) {
      const sp = Math.hypot(vx, vy);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = rgba(SENT, 0.35 - i * 0.1); ctx.lineWidth = 3 - i;
        ctx.beginPath(); ctx.moveTo(cx - vx / sp * 6, cy - vy / sp * 6 + (i - 1) * 3);
        ctx.lineTo(cx - vx / sp * (18 + sp * 0.05), cy - vy / sp * (18 + sp * 0.05) + (i - 1) * 3); ctx.stroke();
      }
      ctx.restore();
    }
    glow(ctx, cx, cy + 12, 10, 4, eyeCol, stun ? 0 : 0.3);
    ctx.save();
    ctx.translate(cx + jx, cy + bob);
    ctx.rotate(m.tilt);
    // fins (open with heat; limp when stunned)
    const op = m.open;
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 7, -2); ctx.rotate(s * (0.5 - op * 0.55));
      ctx.fillStyle = '#12141d';
      ctx.beginPath(); ctx.moveTo(0, -2.4); ctx.lineTo(s * 11, -6 - op * 2); ctx.lineTo(s * 9, 1.5); ctx.lineTo(0, 2.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.human ? '#5f6a7a' : '#6e5532';
      ctx.beginPath(); ctx.moveTo(s * 1, -1.4); ctx.lineTo(s * 9.6, -5 - op * 2); ctx.lineTo(s * 8, 0.6); ctx.lineTo(s * 1, 1.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba(eyeCol, 0.5 + 0.5 * heat); ctx.fillRect(s > 0 ? 3 : -8, -1.6 - op, 5, 0.8);
      ctx.restore();
    }
    // hull: kite-shaped bronze/stone wedge
    const hull = sprite(`sent:${P.key}`, 22, 26, 2, (g) => {
      g.translate(11, 11);
      g.fillStyle = '#12141d';
      g.beginPath(); g.moveTo(0, -11); g.lineTo(10, -2); g.lineTo(5, 9); g.lineTo(0, 14); g.lineTo(-5, 9); g.lineTo(-10, -2); g.closePath(); g.fill();
      const gr = g.createLinearGradient(-8, -10, 8, 12);
      const m = P.human ? P.metal : ['#8f7a5c', '#4b3d2b', '#1f1810'];
      gr.addColorStop(0, m[0]); gr.addColorStop(0.45, m[1]); gr.addColorStop(1, m[2]);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -9.6); g.lineTo(8.6, -2); g.lineTo(4.2, 8.2); g.lineTo(0, 12.4); g.lineTo(-4.2, 8.2); g.lineTo(-8.6, -2); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,240,210,0.35)'; g.beginPath(); g.moveTo(0, -9.6); g.lineTo(-8.6, -2); g.lineTo(-7, -2); g.lineTo(0, -8); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(-8, -2); g.lineTo(8, -2); g.moveTo(-4, 8); g.lineTo(4, 8); g.moveTo(0, 8); g.lineTo(0, 12); g.stroke();
      rivet(g, -5.5, -3.6, 0.6); rivet(g, 5.5, -3.6, 0.6);
      // eye socket
      g.fillStyle = '#06080c'; g.beginPath(); g.ellipse(0, 1.6, 4.6, 3.8, 0, 0, TAU); g.fill();
      g.strokeStyle = m[0]; g.lineWidth = 0.6; g.stroke();
    });
    blit(ctx, hull, -11, -11);
    // stinger antenna
    ctx.strokeStyle = '#12141d'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, 13); ctx.lineTo(Math.sin(t * 4) * 1.2, 18); ctx.stroke();
    ctx.fillStyle = rgba(eyeCol, flick * (0.4 + 0.6 * ((t * (chase ? 6 : 1.5)) % 1 < 0.4 ? 1 : 0)));
    ctx.beginPath(); ctx.arc(Math.sin(t * 4) * 1.2, 18, 1.1, 0, TAU); ctx.fill();
    // glyph seam
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(eyeCol, (0.25 + 0.6 * heat) * flick); ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-7, -2.6); ctx.lineTo(-3, -6); ctx.moveTo(7, -2.6); ctx.lineTo(3, -6); ctx.stroke();
    // eye
    const ex = m.ex * 0.8, ey = 1.6 + m.ey * 0.6;
    glow(ctx, ex, ey, 9 + 6 * heat, 9 + 6 * heat, eyeCol, (0.45 + 0.5 * heat) * flick);
    const pr = chase ? 1.3 : alert ? 1 + 0.6 * Math.abs(Math.sin(t * 20)) : 1.9;
    ctx.fillStyle = rgba(eyeCol, flick); ctx.beginPath(); ctx.ellipse(ex, ey, 2.6, chase ? 1.6 : 2.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba('#fff1d6', flick); ctx.beginPath(); ctx.arc(ex, ey, pr * 0.55, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // brow plate: angry slant when chasing
    ctx.fillStyle = '#12141d';
    ctx.beginPath(); ctx.moveTo(-5, -2.2 + op * 1.6); ctx.lineTo(5, -2.2 + op * 1.6); ctx.lineTo(5, -2.2 - op * 0.2); ctx.lineTo(0, -1.6 + op * 2.4); ctx.lineTo(-5, -2.2 - op * 0.2); ctx.closePath(); ctx.fill();
    ctx.restore();
    // alert telegraph: lock-on brackets closing in + "!" glyph
    if (alert) {
      const q = clamp01(at / ((G.CONFIG && G.CONFIG.sentinel && G.CONFIG.sentinel.alertTime) || 0.45));
      const R = 20 - 10 * q;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(SENT, 0.5 + 0.5 * Math.sin(t * 40)); ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * TAU + Math.PI / 4 + q;
        ctx.beginPath(); ctx.arc(cx, cy, R, a - 0.3, a + 0.3); ctx.stroke();
      }
      ctx.fillStyle = rgba(SENT, 0.9);
      ctx.fillRect(cx - 1, cy - 26 - 2 * q, 2, 6); ctx.fillRect(cx - 1, cy - 18.5 - 2 * q, 2, 2);
      ctx.restore();
    }
    // stunned: arcs + sparks
    if (stun) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba('#9fe8ff', 0.8); ctx.lineWidth = 0.8;
      const n = Math.floor(t * 18);
      for (let i = 0; i < 2; i++) {
        if (hash1(n + i * 7) < 0.4) continue;
        ctx.beginPath();
        let px = cx + (hash1(n * 3 + i) - 0.5) * 18, py = cy + (hash1(n * 5 + i) - 0.5) * 16;
        ctx.moveTo(px, py);
        for (let j = 0; j < 4; j++) { px += (hash1(n + j * 11 + i) - 0.5) * 9; py += (hash1(n + j * 13 + i) - 0.5) * 9; ctx.lineTo(px, py); }
        ctx.stroke();
      }
      ctx.restore();
      if (every(e, '_stFx', t, 0.3)) sparks(cx, cy, { count: 3, color: ['#9fe8ff', '#ffffff'], speed: 110 });
    }
  }

  // ------------------------------------------------------------------ NPC: ЭХО (Architect custodian automaton)
  const ECHO_MOODS = {
    neutral:    { tilt: 0.06, ring: 1, spin: 1, eye: 0.85, slit: 0.35, col: [255, 210, 122], arm: 0, lean: 0 },
    happy:      { tilt: 0.16, ring: 1.12, spin: 1.4, eye: 1, slit: 0.2, col: [255, 226, 150], arm: 0.5, lean: -0.02 },
    sad:        { tilt: 0.22, ring: 0.8, spin: 0.35, eye: 0.5, slit: 0.6, col: [200, 170, 120], arm: -0.3, lean: 0.08 },
    angry:      { tilt: -0.05, ring: 1.05, spin: 2.6, eye: 1, slit: 0.75, col: [255, 120, 70], arm: 0.8, lean: 0.06 },
    scared:     { tilt: -0.1, ring: 0.9, spin: 3.2, eye: 1, slit: 0.1, col: [255, 236, 190], arm: -0.4, lean: -0.08 },
    surprised:  { tilt: -0.08, ring: 1.3, spin: 1.8, eye: 1.2, slit: 0, col: [255, 240, 200], arm: 0.6, lean: -0.05 },
    thinking:   { tilt: 0.28, ring: 0.95, spin: 0.5, eye: 0.7, slit: 0.45, col: [255, 200, 110], arm: 1.2, lean: 0.03 },
    determined: { tilt: -0.02, ring: 1.05, spin: 1.2, eye: 1, slit: 0.55, col: [255, 196, 90], arm: 0.3, lean: 0 },
  };
  const nmem = new WeakMap();
  function drawNpc(ctx, e, t, P) {
    if (e.who === 'rex') { drawRexNpc(ctx, e, t); return; }
    if (e.who && e.who !== 'echo') { drawNpcFallback(ctx, e, t); return; }
    const fx = e.x + (e.w || T) / 2, fy = e.y + (e.h || T);
    const talking = !!e.talking;
    const tm = talking ? (ECHO_MOODS[e.talkMood] || ECHO_MOODS.neutral) : ECHO_MOODS.neutral;
    let m = nmem.get(e);
    if (!m || t < m.t - 0.01) { m = { t, v: Object.assign({}, tm), col: tm.col.slice(), face: e.facing || -1, talk: 0 }; nmem.set(e, m); }
    const dt = clamp01(t - m.t); m.t = t;
    const k = 1 - Math.exp(-6 * dt);
    for (const key in tm) if (typeof tm[key] === 'number') m.v[key] += (tm[key] - m.v[key]) * k;
    for (let i = 0; i < 3; i++) m.col[i] += (tm.col[i] - m.col[i]) * k;
    m.talk += ((talking ? 1 : 0) - m.talk) * (1 - Math.exp(-8 * dt));
    // facing: explicit, else toward the player
    let fTarget = e.facing || 0;
    const pl = G.game && G.game.player;
    if (!fTarget) fTarget = pl ? (pl.x + pl.w / 2 < fx ? -1 : 1) : -1;
    m.face += (fTarget - m.face) * (1 - Math.exp(-5 * dt));
    const V = m.v;
    const col = '#' + m.col.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
    const syl = talking ? Math.abs(Math.sin(t * 9.5) * Math.sin(t * 3.7 + 0.6)) : 0;
    const breath = Math.sin(t * 1.1);
    const sway = Math.sin(t * 0.55) * 0.025 + V.lean;
    // idle head tilt beats + talking tilt
    const idleTilt = Math.sin(t * 0.37) * 0.05 + (Math.sin(t * 0.21) > 0.85 ? 0.12 : 0);
    const headA = V.tilt * m.talk + idleTilt * (1 - m.talk * 0.6) + (talking ? Math.sin(t * 2.2) * 0.06 : 0);
    const B = ['#e9c98a', '#a27843', '#4a3218'];   // bronze
    const D = '#12141d';

    shadow(ctx, fx + 3, fy, 16, 3, 0.45);
    glow(ctx, fx, fy - 60, 34, 34, col, 0.18 + 0.12 * m.talk + 0.15 * syl);
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(m.face < 0 ? -1 : 1, 1);
    const sx = Math.abs(m.face) < 0.999 ? Math.max(0.35, Math.abs(m.face)) : 1;  // turning squash
    ctx.scale(sx, 1);

    // --- legs: long, thin; right leg plated, left leg bare mechanism (asymmetry)
    const hipY = -30;
    ctx.lineCap = 'round';
    const leg = (x0, x1, w, c1, c2) => {
      ctx.strokeStyle = D; ctx.lineWidth = w + 1.6; ctx.beginPath(); ctx.moveTo(x0, hipY); ctx.lineTo(x0 + 1, -15); ctx.lineTo(x1, -1.5); ctx.stroke();
      ctx.strokeStyle = c1; ctx.lineWidth = w; ctx.stroke();
      ctx.strokeStyle = c2; ctx.lineWidth = w * 0.3; ctx.beginPath(); ctx.moveTo(x0 - w * 0.2, hipY); ctx.lineTo(x0 + 1 - w * 0.2, -15); ctx.stroke();
    };
    leg(-3, -4.5, 2.2, '#5c4a35', '#9c8364');
    leg(2.5, 3.5, 3.4, B[1], B[0]);
    ctx.fillStyle = D; ctx.fillRect(-7.5, -2.5, 6, 2.5); ctx.fillRect(1, -3, 7, 3);
    ctx.fillStyle = B[1]; ctx.fillRect(1.6, -2.4, 5.8, 1.6);
    // knee joint
    ctx.fillStyle = D; ctx.beginPath(); ctx.arc(-2, -15, 1.9, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(-2, -15, 0.8, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(0, hipY); ctx.rotate(sway);
    // --- tabard of overlapping plates (sways)
    for (let i = 0; i < 5; i++) {
      const px = -6 + i * 3, sw = Math.sin(t * 1.3 + i * 0.9) * 0.6;
      ctx.fillStyle = D; ctx.beginPath(); ctx.moveTo(px - 0.6, -1); ctx.lineTo(px + 3.6, -1); ctx.lineTo(px + 3 + sw, 11 - (i % 2) * 2); ctx.lineTo(px + sw, 12 - (i % 2) * 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = i % 2 ? B[2] : B[1]; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px + 3, 0); ctx.lineTo(px + 2.5 + sw, 10 - (i % 2) * 2); ctx.lineTo(px + 0.5 + sw, 10.8 - (i % 2) * 2); ctx.closePath(); ctx.fill();
    }
    // --- torso: narrow, tall bronze shell with exposed ribs on the left
    const chestY = -24 - breath * 0.3;
    ctx.fillStyle = D;
    ctx.beginPath(); ctx.moveTo(-5.5, 1); ctx.lineTo(-6.5, chestY + 4); ctx.lineTo(-4, chestY); ctx.lineTo(5, chestY - 1); ctx.lineTo(7.5, chestY + 5); ctx.lineTo(5, 1); ctx.closePath(); ctx.fill();
    const tg = ctx.createLinearGradient(-6, chestY, 6, 2); tg.addColorStop(0, B[0]); tg.addColorStop(0.5, B[1]); tg.addColorStop(1, B[2]);
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(-2.5, chestY + 1); ctx.lineTo(4.4, chestY + 0.2); ctx.lineTo(6.5, chestY + 5); ctx.lineTo(4.2, 0); ctx.closePath(); ctx.fill();
    // ribs (exposed side)
    ctx.strokeStyle = '#7d6446'; ctx.lineWidth = 0.9;
    for (let i = 0; i < 5; i++) { const y = chestY + 4 + i * 3.6; ctx.beginPath(); ctx.moveTo(-5.2, y); ctx.quadraticCurveTo(-3.6, y - 1, -1.6, y); ctx.stroke(); }
    // spine of cables
    ctx.strokeStyle = '#2a2016'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-1.4, 0); ctx.lineTo(-2.2, chestY + 1); ctx.stroke();
    // chest core (pulses with speech)
    glow(ctx, 1.8, chestY + 9, 7 + 4 * syl, 7 + 4 * syl, col, 0.55 + 0.4 * syl);
    ctx.fillStyle = D; ctx.fillRect(0.2, chestY + 6.5, 3.4, 5);
    ctx.fillStyle = col; ctx.fillRect(0.8, chestY + 7.2 + 3 * (1 - syl * 0.6) * 0.3, 2.2, 3.4);
    // glyph channels on the plate
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(col, 0.35 + 0.35 * m.talk); ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(4.5, chestY + 3); ctx.lineTo(3.2, chestY + 5); ctx.lineTo(5.2, chestY + 13); ctx.lineTo(3.4, chestY + 18); ctx.stroke();
    ctx.restore();
    // --- far arm (thin, long, hangs; slight finger twitch)
    const shY = chestY + 1.5;
    const tw = Math.sin(t * 7) * (Math.sin(t * 0.9) > 0.7 ? 0.25 : 0);
    ctx.strokeStyle = D; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-3.5, shY); ctx.lineTo(-5.5, shY + 11); ctx.lineTo(-5 + tw, shY + 22); ctx.stroke();
    ctx.strokeStyle = '#5c4a35'; ctx.lineWidth = 1.2; ctx.stroke();
    // --- big asymmetric pauldron (near shoulder)
    ctx.fillStyle = D; ctx.beginPath(); ctx.ellipse(4.2, shY - 0.5, 5.6, 3.8, -0.25, 0, TAU); ctx.fill();
    const pg = ctx.createLinearGradient(0, shY - 4, 8, shY + 3); pg.addColorStop(0, B[0]); pg.addColorStop(1, B[2]);
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(4.2, shY - 0.7, 4.8, 3.1, -0.25, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(1.5, shY + 0.4, 6, 0.6);
    // --- near arm: gesture (raise / palm out / chin) from mood + speech beat
    const gest = m.talk * (0.35 + 0.65 * Math.max(0, Math.sin(t * 1.9))) * (1 + Math.max(0, V.arm)) * 0.6;
    const chin = talking && e.talkMood === 'thinking' ? 1 : 0;
    const ua = 1.35 - gest * 1.2 - chin * 0.9 + (V.arm < 0 ? -V.arm * 0.2 : 0);   // upper arm angle from +x (down = PI/2)
    const fa = ua - 0.3 - gest * 1.1 - chin * 1.9;
    const ex = 5 + Math.cos(ua) * 10, ey = shY + 2 + Math.sin(ua) * 10;
    const hx = ex + Math.cos(fa) * 10, hy = ey + Math.sin(fa) * 10;
    ctx.strokeStyle = D; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(5, shY + 2); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = B[1]; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = B[0]; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(5, shY + 1.5); ctx.lineTo(ex, ey - 0.5); ctx.stroke();
    ctx.fillStyle = D; ctx.beginPath(); ctx.arc(ex, ey, 1.6, 0, TAU); ctx.fill();
    // three long fingers
    ctx.strokeStyle = D; ctx.lineWidth = 0.9;
    for (let i = -1; i <= 1; i++) {
      const a = fa + i * 0.35 + (gest > 0.2 ? -0.4 : 0.2) + Math.sin(t * 3 + i) * 0.05;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(a) * 3.6, hy + Math.sin(a) * 3.6); ctx.stroke();
    }
    if (gest > 0.3) glow(ctx, hx, hy, 6, 6, col, 0.35 * gest);

    // --- head: neck rods, cracked mask, ring of light
    const neckY = chestY - 1;
    ctx.strokeStyle = D; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0.5, neckY + 1); ctx.lineTo(1, neckY - 4); ctx.moveTo(2.5, neckY + 1); ctx.lineTo(2.2, neckY - 4); ctx.stroke();
    ctx.save();
    ctx.translate(1.6, neckY - 9); ctx.rotate(headA);
    const ringA = t * 0.6 * V.spin;
    const rr = 11 * V.ring * (1 + 0.06 * syl);
    const ringTilt = 0.28;
    const drawRing = (back) => {
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const a0 = ringA + i / 9 * TAU, a1 = a0 + TAU / 9 * 0.62;
        const mid = (a0 + a1) / 2;
        const isBack = Math.sin(mid) < 0;
        if (isBack !== back) continue;
        ctx.strokeStyle = rgba(col, (back ? 0.35 : 0.85) * (0.6 + 0.4 * (i % 3 === 0 ? 1 : 0.5)) * (0.75 + 0.25 * m.talk + 0.3 * syl));
        ctx.lineWidth = back ? 1 : 1.6;
        ctx.beginPath(); ctx.ellipse(0, -5.5, rr, rr * ringTilt, -0.18, a0, a1); ctx.stroke();
      }
      ctx.restore();
    };
    drawRing(true);
    // mask (tall oval, chin narrow); crack across the left eye
    const mask = (q) => { q.beginPath(); q.moveTo(0, -7.5); q.bezierCurveTo(5.4, -7.5, 6.2, -1, 4.6, 3.5); q.quadraticCurveTo(3, 7.5, 0.4, 7.8); q.quadraticCurveTo(-3.6, 7, -4.6, 2); q.bezierCurveTo(-5.6, -3, -4.4, -7.5, 0, -7.5); q.closePath(); };
    mask(ctx); ctx.lineWidth = 1.6; ctx.strokeStyle = D; ctx.stroke();
    const mg = ctx.createLinearGradient(-4, -7, 5, 7); mg.addColorStop(0, '#f6e6c4'); mg.addColorStop(0.5, '#c9a46a'); mg.addColorStop(1, '#6b4c26');
    ctx.fillStyle = mg; ctx.fill();
    ctx.save(); mask(ctx); ctx.clip();
    ctx.fillStyle = 'rgba(60,35,10,0.35)'; ctx.fillRect(-6, 3, 12, 6);
    // eye slits (near eye bright, far eye behind the crack flickers)
    const eo = V.eye * (1 + 0.2 * syl), sl = V.slit;
    glow(ctx, 2.6, -1, 5 * eo, 5 * eo, col, 0.55 * eo);
    ctx.fillStyle = D; ctx.beginPath(); ctx.ellipse(2.6, -1, 1.9, 1.2 * (1 - sl * 0.7) + 0.2, -0.15, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(2.8, -1, 1.2, (0.8 * (1 - sl * 0.75) + 0.12) * eo, -0.15, 0, TAU); ctx.fill();
    const farOn = hash1(Math.floor(t * 9)) < 0.82 ? 1 : 0.2;
    ctx.fillStyle = D; ctx.beginPath(); ctx.ellipse(-2, -1.2, 1.3, 1.1 * (1 - sl * 0.6) + 0.2, 0.1, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(col, 0.75 * farOn * eo); ctx.beginPath(); ctx.ellipse(-2, -1.2, 0.7, 0.55 * (1 - sl * 0.6) + 0.1, 0.1, 0, TAU); ctx.fill();
    // mouth grille: bars light up with speech
    for (let i = 0; i < 4; i++) {
      const on = talking ? Math.abs(Math.sin(t * 11 + i * 1.3)) * syl : 0;
      ctx.fillStyle = on > 0.25 ? rgba(col, 0.4 + 0.6 * on) : 'rgba(40,24,8,0.75)';
      ctx.fillRect(-0.6 + i * 1.3, 3.6, 0.7, 2.2);
    }
    // crack: dark fissure leaking light
    ctx.strokeStyle = D; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(-1.4, -7.8); ctx.lineTo(-0.6, -4.5); ctx.lineTo(-2.4, -2.6); ctx.lineTo(-1.6, 0.6); ctx.lineTo(-3.4, 3.4); ctx.moveTo(-2.4, -2.6); ctx.lineTo(-4.6, -3.4); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(col, 0.25 + 0.35 * syl); ctx.lineWidth = 0.4; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    // key-light rim
    ctx.strokeStyle = 'rgba(255,248,225,0.6)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.arc(0.4, 0, 6.6, Math.PI * 1.1, Math.PI * 1.5); ctx.stroke();
    ctx.restore();
    // crest fin on top of the mask (asymmetric)
    ctx.fillStyle = D; ctx.beginPath(); ctx.moveTo(-1, -7); ctx.lineTo(-4.5, -12); ctx.lineTo(1.5, -7.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = B[1]; ctx.beginPath(); ctx.moveTo(-0.6, -7.4); ctx.lineTo(-3.6, -11); ctx.lineTo(0.8, -7.7); ctx.closePath(); ctx.fill();
    drawRing(false);
    ctx.restore();
    ctx.restore();
    ctx.restore();
    // dust motes drifting through its light
    if (G.fx && every(e, '_echoFx', t, talking ? 0.35 : 0.8) && inView(fx, fy - 40)) {
      G.fx.spawn({ x: fx + (Math.random() - 0.5) * 30, y: fy - 50 - Math.random() * 20, vx: (Math.random() - 0.5) * 8, vy: -6 - Math.random() * 6, life: 1.6, size: 1.2, color: col, glow: true, gravity: 0 });
    }
  }
  /** Generic placeholder for unknown npc `who`: a lit silhouette, never throws. */
  function drawNpcFallback(ctx, e, t) {
    const fx = e.x + (e.w || T) / 2, fy = e.y + (e.h || T);
    const colr = (G.Characters && G.Characters[e.who] && G.Characters[e.who].color) || '#c8c8c8';
    shadow(ctx, fx + 2, fy, 10, 2.5, 0.4);
    ctx.fillStyle = '#12141d';
    ctx.fillRect(fx - 5, fy - 34, 10, 34);
    ctx.beginPath(); ctx.arc(fx, fy - 40, 6, 0, TAU); ctx.fill();
    glow(ctx, fx, fy - 40, 12, 12, colr.length === 7 ? colr : '#c8c8c8', 0.3 + (e.talking ? 0.3 * Math.abs(Math.sin(t * 10)) : 0));
  }

  // ======================================================================================
  // PICKUPS + SUDDEN HAZARDS (docs/companions-spec.md §2–3). Fields read defensively:
  // pickup {kind, taken, t}; hazards {state, t (time in state)} with state aliases below.
  // ======================================================================================
  const PK = { medkit: '#5dffa0', heart: '#ff4a6e', shield: '#5fb2ff', glider: '#9ff0ff', jetpack: '#ff8c3a', boots: '#ffe14a', slowmo: '#b38bff' };
  function pkIcon(g, kind, col) {
    g.lineJoin = 'round'; g.lineWidth = 1.4; g.strokeStyle = '#12141d';
    const P = (f) => { g.beginPath(); f(); g.closePath(); g.fill(); g.stroke(); };
    if (kind === 'medkit') { g.fillStyle = '#eef2f0'; G.roundRect(g, -7, -5, 14, 11, 2); g.fill(); g.stroke(); g.fillStyle = '#5a6670'; g.fillRect(-3, -7, 6, 2); g.fillStyle = col; g.fillRect(-1.6, -3.4, 3.2, 8); g.fillRect(-4, -1, 8, 3.2); }
    else if (kind === 'heart') { g.fillStyle = col; P(() => { g.moveTo(0, 7); g.bezierCurveTo(-9, 0, -7, -8, 0, -3.5); g.bezierCurveTo(7, -8, 9, 0, 0, 7); }); g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(-3, -2.6, 1.6, 1, -0.6, 0, TAU); g.fill(); }
    else if (kind === 'shield') { g.fillStyle = col; P(() => { g.moveTo(0, -7.5); g.lineTo(6.5, -5); g.lineTo(5.5, 2); g.lineTo(0, 7.5); g.lineTo(-5.5, 2); g.lineTo(-6.5, -5); }); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(-1, -5.5, 2, 10); }
    else if (kind === 'glider') { g.fillStyle = col; P(() => { g.moveTo(-8, 1); g.quadraticCurveTo(0, -8, 8, 1); g.quadraticCurveTo(0, -3, -8, 1); }); g.strokeStyle = '#e2712d'; g.beginPath(); g.moveTo(-6, 1); g.lineTo(0, 7); g.lineTo(6, 1); g.stroke(); }
    else if (kind === 'jetpack') { g.fillStyle = '#c7cfdc'; for (const x of [-4.5, 0.5]) { G.roundRect(g, x, -6, 4, 10, 2); g.fill(); g.stroke(); } g.fillStyle = col; P(() => { g.moveTo(-4, 5); g.lineTo(-2.5, 9); g.lineTo(-1, 5); g.moveTo(1, 5); g.lineTo(2.5, 9); g.lineTo(4, 5); }); }
    else if (kind === 'boots') { g.fillStyle = col; P(() => { g.moveTo(-3, -6); g.lineTo(2, -6); g.lineTo(2, 1); g.lineTo(7, 3); g.lineTo(7, 6); g.lineTo(-3, 6); }); g.fillStyle = '#fff6c8'; P(() => { g.moveTo(-3, -3); g.lineTo(-8, -6); g.lineTo(-6, -2); g.lineTo(-8, 0); g.lineTo(-3, 1); }); }
    else { g.fillStyle = col; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.stroke(); g.strokeStyle = '#12141d'; g.beginPath(); g.moveTo(0, -4.5); g.lineTo(0, 0); g.lineTo(3, 2); g.stroke(); }
  }
  function drawPickup(ctx, e, t, P) {
    const kind = PK[e.kind] ? e.kind : 'medkit', col = PK[kind];
    const [cx, cy0] = e.w ? centre(e) : [e.x + T / 2, e.y + T / 2];
    const taken = !!e.taken, tk = taken ? sinceChange(e, 'taken', t) : (sinceChange(e, 'taken', t), 99);
    if (taken && tk > 0.5) return;
    const bob = Math.sin(t * 2.6 + cx * 0.05) * 3, cy = cy0 + bob - (taken ? 14 * easeOutCubic(clamp01(tk / 0.5)) : 0);
    const a = taken ? 1 - clamp01(tk / 0.5) : 1, sc = taken ? 1 + tk * 1.6 : 1 + 0.05 * Math.sin(t * 5);
    if (!taken) shadow(ctx, cx + 2, cy0 + T / 2 - 1, 8 - bob * 0.5, 2, 0.35);
    glow(ctx, cx, cy, 22, 22, col, (0.45 + 0.15 * Math.sin(t * 4)) * a);
    ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(col, 0.7); ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) { const q = t * 1.3 + i / 6 * TAU; ctx.beginPath(); ctx.arc(cx, cy, 12 * sc, q, q + 0.6); ctx.stroke(); }
    ctx.restore();
    const spr = sprite('pk:' + kind, 22, 22, 2, (g) => { g.translate(11, 11); pkIcon(g, kind, col); });
    ctx.save(); ctx.globalAlpha = a; ctx.translate(cx, cy); ctx.scale(sc, sc); blit(ctx, spr, -11, -11); ctx.restore();
    if (taken && !e._pkFx) { e._pkFx = true; sparks(cx, cy, { count: 14, color: [col, '#ffffff'], speed: 170, gravity: 0, life: 0.45 }); }
    if (!taken && every(e, '_pkTw', t, 0.5) && G.fx && inView(cx, cy)) G.fx.spawn({ x: cx + (Math.random() - 0.5) * 18, y: cy + 6, vx: 0, vy: -25, life: 0.7, size: 1.3, color: col, glow: true, gravity: 0 });
  }
  const HS = (e) => { const s = e.state || 'idle'; return ({ shake: 'shaking', warn: 'shaking', armed: 'shaking', beep: 'shaking', triggered: 'shaking', fall: 'falling', drop: 'falling', broken: 'gone', shattered: 'gone', shatter: 'gone', boom: 'boom', exploded: 'boom', landed: 'fallen', solid: 'fallen', erupt: 'erupting', on: 'erupting' })[s] || s; };
  const hst = (e, t) => (typeof e.t === 'number' ? e.t : sinceChange(e, 'state', t));
  function rockCols(P) { return P.human ? P.metal : P.stone; }
  function drawStalactite(ctx, e, t, P) {
    const s = HS(e), st = hst(e, t), C3 = rockCols(P);
    let x = e.x + T / 2, y = e.y;
    if (s === 'gone') { if (st < 0.05 && !e._stFx) { e._stFx = 1; sparks(x, y + T, { count: 12, color: C3, speed: 160, shape: 'square', glow: false }); } return; }
    e._stFx = 0;
    if (s === 'shaking') { x += Math.sin(t * 80) * 1.4; if (G.fx && every(e, '_stD', t, 0.06) && inView(x, y)) G.fx.spawn({ x: x + (Math.random() - 0.5) * 14, y: y + 2, vx: 0, vy: 20, life: 0.6, size: 1.5, color: C3[1], gravity: 600 }); }
    const spr = sprite('stal:' + P.key, 24, 40, 2, (g) => {
      const gr = g.createLinearGradient(0, 0, 24, 0); gr.addColorStop(0, C3[0]); gr.addColorStop(0.5, C3[1]); gr.addColorStop(1, C3[2]);
      g.fillStyle = gr; g.strokeStyle = '#12141d'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(24, 0); g.lineTo(17, 14); g.lineTo(14, 26); g.lineTo(12, 39); g.lineTo(9, 24); g.lineTo(5, 12); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.moveTo(5, 2); g.lineTo(10, 20); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.moveTo(16, 4); g.lineTo(14, 16); g.stroke();
    });
    blit(ctx, spr, x - 12, y);
    if (s === 'shaking') { glow(ctx, x, y + 6, 10, 10, C.bad, 0.4 + 0.3 * Math.sin(t * 40)); }
    if (s === 'falling') { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x - 1, y - 18, 2, 18); }
  }
  function drawMine(ctx, e, t, P) {
    const s = HS(e), st = hst(e, t), x = e.x + T / 2, y = e.y + (e.h || T);
    if (s === 'boom' || s === 'gone') {
      const k = clamp01(st / 0.45);
      if (!e._mFx) { e._mFx = 1; sparks(x, y - 6, { count: 18, color: ['#ffd27a', '#ff6a3a', '#fff'], speed: 260 }); G.fx && G.fx.shake && G.fx.shake(5, 0.25); }
      if (k < 1) { glow(ctx, x, y - 8, 60 * k + 10, 60 * k + 10, '#ff8a3a', 1 - k); ctx.strokeStyle = rgba('#fff3d0', 1 - k); ctx.lineWidth = 3 * (1 - k); ctx.beginPath(); ctx.arc(x, y - 6, 48 * easeOutCubic(k), 0, TAU); ctx.stroke(); }
      ctx.fillStyle = 'rgba(10,8,6,0.55)'; ctx.beginPath(); ctx.ellipse(x, y - 1, 14, 3, 0, 0, TAU); ctx.fill();
      return;
    }
    e._mFx = 0;
    const armed = s === 'shaking';
    ctx.fillStyle = '#12141d'; ctx.beginPath(); ctx.ellipse(x, y - 1, 10, 4.5, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = P.human ? '#4a4f55' : '#55503f'; ctx.beginPath(); ctx.ellipse(x, y - 1, 8.6, 3.4, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = rockCols(P)[1]; ctx.fillRect(x - 12, y - 2, 6, 2); ctx.fillRect(x + 6, y - 2, 6, 2);
    const pin = armed ? 2 : 0;
    ctx.fillStyle = '#2a2d33'; ctx.fillRect(x - 1.2, y - 6 - pin, 2.4, 2.4 + pin);
    const on = armed ? Math.floor(st * 16) % 2 : (t % 1.6) < 0.12 ? 1 : 0;
    ctx.fillStyle = on ? C.bad : '#4a1a1c'; ctx.fillRect(x - 1, y - 7 - pin, 2, 1.6);
    if (on) glow(ctx, x, y - 6 - pin, armed ? 16 : 6, armed ? 16 : 6, C.bad, armed ? 0.9 : 0.35);
  }
  function drawGeyser(ctx, e, t, P) {
    const per = e.period || 3, on = e.on || 0.8;
    let s = HS(e); const x = e.x + T / 2, y = e.y + (e.h && e.h <= T ? e.h : T);
    const H = (e.colH || e.eruptH || ((e.hTiles || (e.h > T ? e.h / T : e.h) || 6) * T));
    if (!e.state) { const ph = (t + (e.offset || 0)) % per; s = ph > per - on ? 'erupting' : ph > per - on - 0.6 ? 'shaking' : 'idle'; }
    ctx.fillStyle = '#12141d'; ctx.beginPath(); ctx.ellipse(x, y - 2, 13, 5, 0, Math.PI, 0); ctx.fill();
    const C3 = rockCols(P); ctx.fillStyle = C3[1]; ctx.beginPath(); ctx.ellipse(x, y - 2, 11, 3.6, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#0b0d10'; ctx.beginPath(); ctx.ellipse(x, y - 3, 5.5, 1.6, 0, 0, TAU); ctx.fill();
    if (s === 'idle' && G.fx && every(e, '_gS', t, 0.25) && inView(x, y)) G.fx.spawn({ x: x + (Math.random() - 0.5) * 6, y: y - 4, vx: 0, vy: -20, life: 1, size: 3, color: 'rgba(220,235,240,0.35)', gravity: -10, grow: 2, fade: true });
    if (s === 'shaking') { glow(ctx, x, y - 4, 14, 8, '#bff4ff', 0.5); for (let i = 0; i < 4; i++) { const k = ((t * 2 + i / 4) % 1); ctx.strokeStyle = rgba('#dff8ff', 1 - k); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(x + Math.sin(i * 3.1) * 4, y - 4 - k * 10, 1 + k * 1.5, 0, TAU); ctx.stroke(); } }
    if (s === 'erupting') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createLinearGradient(0, y, 0, y - H); gr.addColorStop(0, 'rgba(230,250,255,0.85)'); gr.addColorStop(0.7, 'rgba(160,220,240,0.45)'); gr.addColorStop(1, 'rgba(160,220,240,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x - 5, y - 3);
      for (let i = 0; i <= 10; i++) { const yy = y - 3 - H * i / 10; ctx.lineTo(x - 5 - i * 0.8 + Math.sin(t * 20 + i) * 1.5, yy); }
      for (let i = 10; i >= 0; i--) { const yy = y - 3 - H * i / 10; ctx.lineTo(x + 5 + i * 0.8 + Math.sin(t * 23 + i * 1.7) * 1.5, yy); }
      ctx.fill(); ctx.restore();
      glow(ctx, x, y - H, 20, 14, '#e8fbff', 0.5);
      if (G.fx && every(e, '_gE', t, 0.04) && inView(x, y - H)) G.fx.spawn({ x: x + (Math.random() - 0.5) * 12, y: y - H, vx: (Math.random() - 0.5) * 80, vy: -40, life: 0.6, size: 2, color: '#dff8ff', gravity: 500 });
    }
  }
  function drawCollapse(ctx, e, t, P) {
    const s = HS(e), st = hst(e, t);
    const w = e.w > 16 ? e.w : (e.w || 3) * T, h = e.h > 16 ? e.h : (e.h || 1) * T;
    let x = e.x;
    if (s === 'shaking') { x += Math.sin(t * 70) * 1.2; if (G.fx && every(e, '_cD', t, 0.05) && inView(x + w / 2, e.y)) G.fx.spawn({ x: x + Math.random() * w, y: e.y + h, vx: 0, vy: 30, life: 0.6, size: 1.6, color: rockCols(P)[1], gravity: 700 }); }
    if (s === 'fallen' && !e._cFx) { e._cFx = 1; sparks(x + w / 2, e.y + h, { count: 16, color: rockCols(P), shape: 'square', glow: false }); G.fx && G.fx.shake && G.fx.shake(6, 0.3); }
    const spr = sprite(`col:${P.key}:${w}:${h}`, w, h, 3, (g) => {
      bevel(g, 0, 0, w, h, rockCols(P), 2, 0.3); grain(g, 0, 0, w, h, Math.round(w + h * 3), true);
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.2; g.beginPath();
      for (let i = 1; i < w / 24; i++) { g.moveTo(i * 24, 0); g.lineTo(i * 24 - 4, h * 0.5); g.lineTo(i * 24 + 3, h); }
      g.stroke(); g.fillStyle = rockCols(P)[2];
      for (let i = 4; i < w - 4; i += 9) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + 3, h + 3); g.lineTo(i + 6, h); g.fill(); }
    });
    blit(ctx, spr, x, e.y);
    if (s === 'shaking' || s === 'idle') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(s === 'shaking' ? '#ff7a3a' : '#000000', s === 'shaking' ? 0.5 + 0.5 * Math.sin(t * 40) : 0); ctx.lineWidth = 0.9; ctx.beginPath();
      for (let i = 1; i < w / 24; i++) { ctx.moveTo(x + i * 24, e.y); ctx.lineTo(x + i * 24 - 4, e.y + h * 0.5); ctx.lineTo(x + i * 24 + 3, e.y + h); }
      ctx.stroke(); ctx.restore();
    }
    void st;
  }
  // npc Рекс before recruitment: drawn by the party renderer in a crossed-arms idle
  const rexNpc = new WeakMap();
  function drawRexNpc(ctx, e, t) {
    if (!G.Art.Party) return drawNpcFallback(ctx, e, t);
    let c = rexNpc.get(e); if (!c) { c = { who: 'rex', npc: true, state: 'idle', vx: 0, vy: 0, onGround: true }; rexNpc.set(e, c); }
    c.x = e.x; c.y = e.y; c.w = e.w || T; c.h = e.h || 2 * T; c.talking = !!e.talking; c.talkMood = e.talkMood;
    const pl = G.game && G.game.player;
    c.facing = e.facing || (pl ? (pl.x + pl.w / 2 < c.x + c.w / 2 ? -1 : 1) : -1);
    G.Art.Party.draw(ctx, c, t);
  }

  // ------------------------------------------------------------------ dispatcher
  const DRAW = {
    door: drawDoor, bridge: drawBridge, lever: drawLever, plate: drawPlate, terminal: drawTerminal,
    part: drawPart, socket: drawSocket, mplatform: drawMPlatform, crate: drawCrate, laser: drawLaser,
    saw: drawSaw, checkpoint: drawCheckpoint, exit: drawExit, shard: drawShard, jumppad: drawJumppad, sign: drawSign,
    anchor: drawAnchor, wind: drawWind, dashcrystal: drawDashCrystal, fallplat: drawFallPlat, sentinel: drawSentinel, npc: drawNpc,
    pickup: drawPickup, stalactite: drawStalactite, mine: drawMine, geyser: drawGeyser, collapse: drawCollapse,
  };
  const failed = {};

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
      try { fn(ctx, e, t, P); } catch (err) {
        // never let one bad entity (e.g. half-initialised Chapter 2 fields) kill the frame; report once per type
        if (!failed[e.type]) { failed[e.type] = true; console.warn('Art.Entities draw failed for', e.type, err); if (G.errors) G.errors.push('art:' + e.type + ': ' + (err && err.message)); }
      } finally { ctx.restore(); }
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
