/**
 * TESSERA — cinematic cutscene illustrations (G.Art.Scenes).
 *
 * Contract (docs/level-format.md §4):
 *   G.Art.Scenes.draw(ctx, id, t, W, H, shotIndex)
 *     ctx  — 2D context already scaled to the logical view (VIEW space).
 *     id   — scene id (design/game-brief.md); unknown ids draw a dark gradient fallback.
 *     t    — seconds since the shot started; every motion is either periodic or
 *            asymptotic so any t (0 … 120+ … ∞) is safe.
 *     W, H — logical size (960×540). Scenes are composed in a 960×540 design space and
 *            scaled if W/H differ.
 *
 * Rendering approach
 *   • Everything is procedural Canvas 2D. Static layers (nebulae, starfields, planet
 *     textures, the «Ковчег-7» hull, dunes, cloud sprites…) are painted once into
 *     offscreen canvases created lazily and memoised in a small LRU keyed by
 *     name + size + resolution (see `layer`).
 *   • Per frame we composite those layers under slow camera moves (push-ins, pull-outs,
 *     parallax) and add the live parts: glows (additive sprite "bloom"), particles,
 *     pulses, fire, lights.
 *   • Layout is deterministic (G.rng / integer hash); nothing per-frame uses
 *     Math.random so screenshots are reproducible.
 *   • ctx state is always restored (draw() wraps every scene in save/restore and a
 *     try/catch that falls back to the gradient).
 */
(function () {
  'use strict';

  const DW = 960, DH = 540;
  const TAU = Math.PI * 2;
  const MONO = '"Share Tech Mono", "Consolas", monospace';
  const SANS = '"Exo 2", "Segoe UI", sans-serif';

  // ════════════════════════════════════════════════════════════════════ math
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  /** Smoothstep of v between edges a and b. */
  const sstep = (a, b, v) => { const x = clamp01((v - a) / (b - a)); return x * x * (3 - 2 * x); };
  const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
  const easeInOut = (x) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const fract = (x) => x - Math.floor(x);
  /** Asymptotic 0→1 ramp with time constant tau (safe for unbounded t). */
  const settle = (t, tau) => 1 - Math.exp(-Math.max(0, t) / tau);

  /** Integer hash of (a, b) → [0, 1). Deterministic stand-in for random per frame. */
  function hash(a, b) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul((b | 0) + 1, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  /** Tileable (in x) 2D value noise. Returns n(x, y, periodX). */
  function valueNoise(seed) {
    const N = 256, r = G.rng(seed), v = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) v[i] = r();
    return function (x, y, px) {
      px = px || N;
      const xi = Math.floor(x), yi = Math.floor(y);
      let xf = x - xi, yf = y - yi;
      xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf);
      const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
      const y0 = yi & 255, y1 = (y0 + 1) & 255;
      const a = v[y0 * N + x0], b = v[y0 * N + x1], c = v[y1 * N + x0], d = v[y1 * N + x1];
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
  }
  /** Fractal sum of `oct` octaves; `px` keeps every octave tileable in x. */
  function fbm(n, x, y, oct, px) {
    let s = 0, a = 0.5, f = 1, nn = 0;
    for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f, px ? px * f : 0); nn += a; a *= 0.5; f *= 2; }
    return s / nn;
  }
  let NOISES = null;
  const noises = () => NOISES || (NOISES = [valueNoise(11), valueNoise(23), valueNoise(37), valueNoise(51)]);

  // ════════════════════════════════════════════════════════════════════ layer cache
  const cache = new Map();
  let cachePx = 0;
  const CACHE_BUDGET_PX = 26e6; // ~100 MB of RGBA; least-recently-used layers are dropped beyond it

  /** Cache resolution multiplier: follows the canvas scale, quantised, capped for memory. */
  function res() { const s = G.renderScale || 1; return Math.min(1.5, Math.max(1, Math.round(s * 4) / 4)); }

  /**
   * Lazily paint + memoise an offscreen layer of logical size w×h.
   * build(g, w, h, canvas) draws in logical units (g is pre-scaled by `scale`).
   * Returned canvas has .lw/.lh = logical size; draw it with drawImage(c, x, y, c.lw, c.lh).
   */
  function layer(key, w, h, build, scale) {
    const s = scale != null ? scale : res();
    const k = key + '|' + w + 'x' + h + '@' + s;
    let c = cache.get(k);
    if (c) { cache.delete(k); cache.set(k, c); return c; }
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.lw = w; c.lh = h;
    const g = c.getContext('2d');
    g.setTransform(s, 0, 0, s, 0, 0);
    build(g, w, h, c);
    cache.set(k, c);
    cachePx += c.width * c.height;
    while (cachePx > CACHE_BUDGET_PX && cache.size > 1) {
      const first = cache.keys().next().value;
      if (first === k) break;
      const old = cache.get(first);
      cache.delete(first);
      cachePx -= old.width * old.height;
    }
    return c;
  }
  const blit = (ctx, c, x, y) => ctx.drawImage(c, x || 0, y || 0, c.lw, c.lh);

  // ════════════════════════════════════════════════════════════════════ palette
  const C = {
    white: [255, 255, 255], cyan: [126, 249, 255], ice: [190, 220, 255], blue: [120, 170, 255],
    plasma: [150, 200, 255], gold: [255, 214, 150], amber: [255, 170, 90], orange: [255, 120, 40],
    fire: [255, 150, 60], red: [255, 60, 40], deepRed: [180, 30, 20], rose: [255, 120, 140],
    violet: [170, 110, 255], magenta: [220, 90, 255], smoke: [26, 20, 22], dust: [196, 140, 92],
    warm: [255, 226, 180], beam: [200, 250, 255],
  };
  const STAR_COLS = [[155, 176, 255], [202, 216, 255], [248, 247, 255], [255, 244, 234], [255, 222, 180], [255, 190, 140]];

  // ════════════════════════════════════════════════════════════════════ sprites
  /** Soft radial glow sprite (bloom building block) for colour c. */
  function glowImg(c) {
    return layer('glow:' + c.join(','), 64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.1, rgba(c, 0.75)); gr.addColorStop(0.25, rgba(c, 0.32));
      gr.addColorStop(0.5, rgba(c, 0.1)); gr.addColorStop(0.75, rgba(c, 0.03)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }, 2);
  }
  /** Soft round puff (smoke, haze) with a broad core. */
  function puffImg(c) {
    return layer('puff:' + c.join(','), 64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(c, 1)); gr.addColorStop(0.45, rgba(c, 0.6)); gr.addColorStop(0.8, rgba(c, 0.15)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }, 1);
  }
  /** Draw a glow sprite centred at x,y (caller chooses the composite op). */
  function glow(ctx, x, y, r, c, a) {
    if (!(a > 0.004) || !(r > 0.3)) return;
    ctx.globalAlpha = a > 1 ? 1 : a;
    ctx.drawImage(glowImg(c), x - r, y - r, r * 2, r * 2);
  }
  /** Elliptical glow, rotated by `rot`. */
  function glowE(ctx, x, y, rx, ry, rot, c, a) {
    if (!(a > 0.004) || !(rx > 0.3) || !(ry > 0.3)) return;
    ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
    ctx.globalAlpha = a > 1 ? 1 : a;
    ctx.drawImage(glowImg(c), -rx, -ry, rx * 2, ry * 2);
    ctx.restore();
  }
  function puff(ctx, x, y, r, c, a) {
    if (!(a > 0.004) || !(r > 0.3)) return;
    ctx.globalAlpha = a > 1 ? 1 : a;
    ctx.drawImage(puffImg(c), x - r, y - r, r * 2, r * 2);
  }
  /** Four-point star flare (glints, lens sparkle). */
  function flare(ctx, x, y, len, c, a) {
    glowE(ctx, x, y, len, len * 0.06, 0, c, a);
    glowE(ctx, x, y, len * 0.06, len * 0.75, 0, c, a * 0.8);
    glow(ctx, x, y, len * 0.22, c, a);
  }

  /** Painterly cloud sprite: many soft blobs, lit top → shaded base. */
  function cloudImg(key, w, h, seed, lit, shade, n, flat) {
    return layer('cloud:' + key, w, h, (g) => {
      const r = G.rng(seed);
      const blobs = [];
      for (let i = 0; i < n; i++) {
        const u = 0.08 + r() * 0.84;
        const env = Math.sin(Math.PI * u);
        const top = h * (0.92 - 0.72 * env * (flat ? 0.6 : 1));
        const cy = lerp(top + h * 0.12, h * 0.86, Math.pow(r(), 0.8));
        const rad = h * (0.1 + 0.2 * r()) * (0.5 + 0.8 * env);
        blobs.push([u * w, cy, rad, clamp01((cy - top) / (h * 0.86 - top + 1))]);
      }
      blobs.sort((a, b) => b[1] - a[1]);
      for (const [x, y, rad, k] of blobs) {
        const c = mixc(lit, shade, Math.pow(k, 0.7));
        const gr = g.createRadialGradient(x, y - rad * 0.25, 0, x, y, rad);
        gr.addColorStop(0, rgba(mixc(c, lit, 0.35), 0.75)); gr.addColorStop(0.55, rgba(c, 0.5)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }, 0.5);
  }

  // ════════════════════════════════════════════════════════════════════ painters
  /** Paint a starfield. o: {pow,size,alpha,wrap,band:{y0,k,spread,frac},yMax} */
  function paintStars(g, w, h, seed, n, o) {
    o = o || {};
    const r = G.rng(seed);
    for (let i = 0; i < n; i++) {
      const x = r() * w;
      let y = r() * h;
      if (o.band && r() < o.band.frac) y = o.band.y0 + (x - w / 2) * o.band.k + (r() + r() + r() - 1.5) * o.band.spread;
      const m = Math.pow(r(), o.pow || 2.6);
      const c = STAR_COLS[(r() * STAR_COLS.length) | 0];
      if (o.yMax && y > o.yMax) continue;
      const a = (0.16 + 0.84 * m) * (o.alpha || 1);
      const s = 0.4 + m * (o.size || 1.5);
      const xs = o.wrap ? [x, x - w, x + w] : [x];
      for (const xx of xs) {
        if (xx < -10 || xx > w + 10) continue;
        g.globalAlpha = 1;
        g.fillStyle = rgba(c, a);
        if (s < 1.05) g.fillRect(xx, y, s * 1.15, s * 1.15);
        else { g.beginPath(); g.arc(xx, y, s * 0.62, 0, TAU); g.fill(); }
        if (m > 0.55) { g.globalAlpha = a * 0.55; g.drawImage(glowImg(c), xx - s * 4, y - s * 4, s * 8, s * 8); }
        if (m > 0.88) {
          g.globalAlpha = a * 0.45;
          g.drawImage(glowImg(c), xx - s * 9, y - 0.5, s * 18, 1);
          g.drawImage(glowImg(c), xx - 0.5, y - s * 7, 1, s * 14);
        }
      }
    }
    g.globalAlpha = 1;
  }
  /** Soft additive nebula clouds. blobs: [{x,y,sx,sy,r,c,a,n}] */
  function paintNebula(g, seed, blobs) {
    const r = G.rng(seed);
    g.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      for (let i = 0; i < (b.n || 10); i++) {
        const x = b.x + (r() - 0.5) * b.sx, y = b.y + (r() - 0.5) * b.sy;
        const rad = b.r * (0.35 + r() * 0.8);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, rgba(b.c, b.a)); gr.addColorStop(0.45, rgba(b.c, b.a * 0.4)); gr.addColorStop(1, rgba(b.c, 0));
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    g.globalCompositeOperation = 'source-over';
  }
  /** Dark absorbing dust lanes (source-over dark blobs). */
  function paintDustLanes(g, seed, lanes) {
    const r = G.rng(seed);
    for (const L of lanes) {
      for (let i = 0; i < (L.n || 12); i++) {
        const u = r();
        const x = lerp(L.x0, L.x1, u) + (r() - 0.5) * L.j, y = lerp(L.y0, L.y1, u) + (r() - 0.5) * L.j;
        const rad = L.r * (0.4 + r() * 0.8);
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, `rgba(2,2,6,${L.a})`); gr.addColorStop(1, 'rgba(2,2,6,0)');
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }
  function vfill(g, y0, y1, stops, x, w) {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    for (const [o, c] of stops) gr.addColorStop(o, typeof c === 'string' ? c : rgba(c, 1));
    g.fillStyle = gr; g.fillRect(x || 0, y0, w || DW, y1 - y0);
  }
  /** Ring band seen from the planet surface: an elliptical arch of fine strands. */
  function paintSkyRing(g, cx, cy, rx, ry, rot, a0, a1, width, col, alpha) {
    const N = 30;
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const gap = f > 0.58 && f < 0.66 ? 0.12 : 1;
      const prof = (0.3 + 0.7 * Math.abs(Math.sin(f * 11.3 + 0.7))) * gap * sstep(0, 0.12, f) * (1 - sstep(0.88, 1, f));
      const off = (f - 0.5) * width;
      g.strokeStyle = rgba(mixc(col, [255, 200, 170], f * 0.4), alpha * prof);
      g.lineWidth = (width / N) * 1.5;
      g.beginPath(); g.ellipse(cx, cy, rx + off, ry + off * (ry / rx), rot, a0, a1); g.stroke();
    }
  }
  /**
   * One dune ridge layer: sharp crests (1-|sin|^p), lit crest strokes on the sun side.
   * o: {y, amp, seed, top, bottom, rim, rimA, sunRight}
   */
  function paintDunes(g, w, h, o) {
    const r = G.rng(o.seed);
    const f1 = (0.004 + r() * 0.003) * (o.freq || 1), f2 = (0.009 + r() * 0.006) * (o.freq || 1), f3 = 0.035 + r() * 0.02;
    const p1 = r() * TAU, p2 = r() * TAU, p3 = r() * TAU;
    const ys = [], step = 3;
    for (let x = 0; x <= w + step; x += step) {
      const big = 0.5 + 0.5 * Math.sin(x * f1 + p1);
      const crest = 1 - Math.pow(Math.abs(Math.sin(x * f2 + p2 + big * 1.3)), 0.7);
      ys.push(o.y - o.amp * (0.45 * big + 0.5 * crest * (0.4 + 0.6 * big) + 0.05 * Math.sin(x * f3 + p3)));
    }
    g.beginPath(); g.moveTo(-2, h + 2);
    ys.forEach((y, i) => g.lineTo(i * step, y));
    g.lineTo(w + 4, h + 2); g.closePath();
    const top = Math.min.apply(null, ys);
    const gr = g.createLinearGradient(0, top, 0, Math.min(h, o.y + o.amp * 1.5 + 60));
    gr.addColorStop(0, rgba(o.top, 1)); gr.addColorStop(1, rgba(o.bottom, 1));
    g.fillStyle = gr; g.fill();
    // lee-side shading: darker wedge under each crest on the side away from the sun
    if (o.shade) {
      g.save(); g.clip();
      g.fillStyle = rgba(o.shade, o.shadeA || 0.35);
      g.beginPath();
      for (let i = 1; i < ys.length - 1; i++) {
        const facing = o.sunRight ? ys[i + 1] - ys[i] : ys[i - 1] - ys[i];
        if (facing < -0.15) { const x = i * step; g.rect(x, ys[i], step + 0.6, 26 + o.amp * 0.6); }
      }
      g.fill();
      g.restore();
    }
    if (o.rim) {
      g.lineWidth = o.rimW || 1.4; g.strokeStyle = rgba(o.rim, o.rimA || 0.6); g.beginPath();
      for (let i = 0; i < ys.length - 1; i++) {
        const d = o.sunRight ? ys[i + 1] - ys[i] : ys[i] - ys[i + 1];
        if (d > 0.25) { g.moveTo(i * step, ys[i]); g.lineTo(i * step + step, ys[i + 1]); }
      }
      g.stroke();
    }
    return ys;
  }
  /** Horizontal haze band (atmospheric perspective). */
  function paintHaze(g, y0, y1, c, a) {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.5, rgba(c, a)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, y0, DW, y1 - y0);
  }
  /** Distant mesa silhouettes along a horizon. */
  function paintMesas(g, y, seed, col, hmax) {
    const r = G.rng(seed);
    g.fillStyle = rgba(col, 1); g.beginPath(); g.moveTo(0, y + 4);
    let x = 0;
    while (x < DW) {
      const gap = 30 + r() * 120; x += gap; g.lineTo(x, y + 2);
      if (r() < 0.55) {
        const w = 30 + r() * 110, hh = (0.3 + r() * 0.7) * hmax;
        g.lineTo(x + w * 0.12, y - hh); g.lineTo(x + w * 0.88, y - hh * (0.9 + r() * 0.15)); g.lineTo(x + w, y + 2); x += w;
      }
    }
    g.lineTo(DW, y + 4); g.lineTo(DW, y + 30); g.lineTo(0, y + 30); g.closePath(); g.fill();
  }

  // ════════════════════════════════════════════════════════════════════ post
  function vignette(ctx, a, col) {
    const key = col ? col.join(',') : '0,0,0';
    const v = layer('vig:' + key, 128, 128, (g) => {
      const c = col || [0, 0, 0];
      const gr = g.createRadialGradient(64, 64, 26, 64, 64, 92);
      gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.55, rgba(c, 0.35)); gr.addColorStop(1, rgba(c, 1));
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }, 1);
    ctx.globalAlpha = a; ctx.drawImage(v, 0, 0, DW, DH); ctx.globalAlpha = 1;
  }
  let grainState = null;
  /** Animated film grain (soft-light noise) — the painterly "tooth" over everything. */
  function grain(ctx, t, a) {
    const img = layer('grain', 160, 160, (g, w, h, c) => {
      const id = g.createImageData(c.width, c.height), d = id.data, r = G.rng(991);
      for (let i = 0; i < d.length; i += 4) { const v = 128 + (r() + r() - 1) * 120; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(id, 0, 0);
    }, 1);
    if (!grainState || grainState.ctx !== ctx || grainState.img !== img) grainState = { ctx, img, pat: ctx.createPattern(img, 'repeat') };
    const f = Math.floor(t * 18);
    const ox = (hash(f, 3) * 160) | 0, oy = (hash(f, 7) * 160) | 0;
    ctx.save();
    ctx.globalAlpha = a; ctx.globalCompositeOperation = 'soft-light';
    ctx.translate(-ox, -oy); ctx.fillStyle = grainState.pat; ctx.fillRect(ox, oy, DW, DH);
    ctx.restore();
  }
  /** Camera: zoom z about focus (fx, fy), plus offset/roll. Pair with ctx.restore(). */
  function cam(ctx, z, fx, fy, ox, oy, rot) {
    ctx.save();
    ctx.translate(fx + (ox || 0), fy + (oy || 0));
    if (rot) ctx.rotate(rot);
    ctx.scale(z, z);
    ctx.translate(-fx, -fy);
  }
  /** Lens flare ghosts along the line from a light source through the frame centre. */
  function lensFlare(ctx, x, y, a) {
    const dx = DW / 2 - x, dy = DH / 2 - y;
    const ghosts = [[0.35, 14, C.gold, 0.12], [0.62, 26, C.ice, 0.07], [0.9, 8, C.rose, 0.14], [1.25, 40, C.violet, 0.05], [1.55, 16, C.cyan, 0.08]];
    for (const [k, r, c, ga] of ghosts) glow(ctx, x + dx * k * 2, y + dy * k * 2, r, c, ga * a);
    glowE(ctx, x, y, 420, 3.5, 0, C.ice, 0.35 * a);
    glowE(ctx, x, y, 200, 14, 0, C.ice, 0.12 * a);
  }

  // ════════════════════════════════════════════════════════════════════ Tessera (planet)
  const TEX_W = 640, TEX_H = 320, TEX_FULL = TEX_W + TEX_W / 2 + 4;
  function wrapCopy(d, w, full, h) {
    for (let y = 0; y < h; y++) for (let x = w; x < full; x++) {
      const s = (y * full + (x - w)) * 4, t = (y * full + x) * 4;
      d[t] = d[s]; d[t + 1] = d[s + 1]; d[t + 2] = d[s + 2]; d[t + 3] = d[s + 3];
    }
  }
  /** Equirect-ish surface texture: amber deserts, rose highlands, canyon networks, frost caps. */
  function planetTex() {
    return layer('tessera-tex', TEX_FULL, TEX_H, (g, w, h, c) => {
      const [n1, n2, n3] = noises();
      const id = g.createImageData(TEX_FULL, TEX_H), d = id.data;
      const stops = [[0, [64, 26, 36]], [0.25, [112, 46, 54]], [0.4, [168, 82, 78]], [0.52, [206, 128, 82]],
        [0.64, [228, 162, 96]], [0.78, [240, 198, 142]], [1, [252, 228, 192]]];
      const pal = [];
      for (let i = 0; i < 256; i++) {
        const e = i / 255; let j = 0; while (j < stops.length - 2 && e > stops[j + 1][0]) j++;
        pal.push(mixc(stops[j][1], stops[j + 1][1], clamp01((e - stops[j][0]) / (stops[j + 1][0] - stops[j][0]))));
      }
      for (let y = 0; y < TEX_H; y++) {
        const v = y / TEX_H, lat = Math.abs(v - 0.5) * 2;
        for (let x = 0; x < TEX_W; x++) {
          const X = (x / TEX_W) * 8, Y = v * 4;
          const wx = fbm(n2, X, Y, 3, 8) * 2.4;
          let e = fbm(n1, X + wx, Y + wx * 0.4, 5, 8);
          e = clamp01((e - 0.3) / 0.42) + 0.04 * Math.sin(v * 150 + wx * 7);
          const rid = 1 - Math.abs(2 * fbm(n3, X * 2 + wx, Y * 2, 3, 16) - 1);
          let col = pal[(clamp01(e) * 255) | 0];
          if (rid > 0.86) col = mixc(col, [70, 30, 34], (rid - 0.86) * 4.5);
          const pc = sstep(0.8, 0.93, lat + (wx - 1.2) * 0.06);
          if (pc > 0) col = mixc(col, [250, 232, 214], pc * 0.9);
          const i = (y * TEX_FULL + x) * 4;
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
        }
      }
      wrapCopy(d, TEX_W, TEX_FULL, TEX_H);
      g.putImageData(id, 0, 0);
    }, 1);
  }
  /** Banded, swirling cloud layer (alpha) — rotates faster than the surface. */
  function cloudTex() {
    return layer('tessera-clouds', TEX_FULL, TEX_H, (g, w, h, c) => {
      const [, n2, , n4] = noises();
      const id = g.createImageData(TEX_FULL, TEX_H), d = id.data;
      for (let y = 0; y < TEX_H; y++) {
        const v = y / TEX_H;
        for (let x = 0; x < TEX_W; x++) {
          const X = (x / TEX_W) * 8;
          const wv = fbm(n2, X * 0.5 + 3, v * 3, 3, 4);
          const cl = fbm(n4, X + wv * 1.8, v * 12 + wv * 4, 5, 8);
          const a = sstep(0.5, 0.74, cl) * (0.55 + 0.45 * Math.sin(v * Math.PI));
          const i = (y * TEX_FULL + x) * 4;
          d[i] = 255; d[i + 1] = 238 - a * 10; d[i + 2] = 226 - a * 14; d[i + 3] = a * 235;
        }
      }
      wrapCopy(d, TEX_W, TEX_FULL, TEX_H);
      g.putImageData(id, 0, 0);
    }, 1);
  }
  /**
   * Map an equirect texture onto a disc as a rotating sphere: N vertical slices,
   * uniform in longitude, placed at x = cx + R·sin(φ).
   */
  function sphereMap(ctx, tex, cx, cy, R, rot, N) {
    N = N || 44;
    const base = fract(rot) * TEX_W;
    const sw = TEX_W / 2 / N;
    for (let i = 0; i < N; i++) {
      const p0 = -Math.PI / 2 + (Math.PI * i) / N, p1 = p0 + Math.PI / N;
      const x0 = cx + R * Math.sin(p0), x1 = cx + R * Math.sin(p1);
      const sx = (base + sw * i) % TEX_W;
      ctx.drawImage(tex, sx, 0, sw, TEX_H, x0, cy - R, x1 - x0 + 0.6, R * 2);
    }
  }
  /** Per-pixel lambert + soft terminator + rose terminator scattering, as a dark overlay. */
  function shadeImg(R, L, key) {
    return layer('shade:' + key, R * 2, R * 2, (g, w, h, c) => {
      const S = c.width, id = g.createImageData(S, S), d = id.data;
      const night = [3, 2, 9], term = [120, 34, 52];
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const nx = ((px + 0.5) / S) * 2 - 1, ny = ((py + 0.5) / S) * 2 - 1, d2 = nx * nx + ny * ny;
        if (d2 >= 1) continue;
        const nz = Math.sqrt(1 - d2);
        const lam = nx * L[0] + ny * L[1] + nz * L[2];
        const day = sstep(-0.1, 0.42, lam);
        const tz = Math.exp(-Math.pow((lam - 0.02) / 0.11, 2));
        const limb = (1 - nz) * 0.35;
        const col = mixc(night, term, tz * 0.85);
        const a = clamp01((1 - day) * 0.985 + limb * day + tz * 0.12);
        const i = (py * S + px) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = a * 255;
      }
      g.putImageData(id, 0, 0);
    });
  }
  /** Additive atmosphere: thin bright limb + soft outer halo on the sunlit side. */
  function atmoImg(R, L, key, col) {
    const E = R * 1.32;
    return layer('atmo:' + key, E * 2, E * 2, (g, w, h, c) => {
      const S = c.width, id = g.createImageData(S, S), d = id.data;
      const lx = L[0], ly = L[1], ll = Math.hypot(lx, ly) || 1;
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const x = (((px + 0.5) / S) * 2 - 1) * 1.32, y = (((py + 0.5) / S) * 2 - 1) * 1.32;
        const rho = Math.hypot(x, y);
        const lit = clamp01(0.2 + ((x / (rho || 1)) * lx + (y / (rho || 1)) * ly) / ll * 0.95);
        let a;
        if (rho > 1) a = (Math.exp(-(rho - 1) / 0.028) * 0.95 + Math.exp(-(rho - 1) / 0.11) * 0.3) * lit;
        else a = Math.pow(rho, 14) * 0.85 * lit + Math.pow(rho, 4) * 0.08 * lit;
        const k = clamp01((rho - 0.96) * 6);
        const cc = mixc([255, 214, 170], col, k);
        const i = (py * S + px) * 4;
        d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = clamp01(a) * 255;
      }
      g.putImageData(id, 0, 0);
    });
  }
  /** Tessera's dusty ring (axis-aligned; rotated + split front/back when drawn). */
  function ringImg(R, ratio, key) {
    const ro = R * 2.05, ri = R * 1.3, w = ro * 2 + 8, h = ro * ratio * 2 + 8;
    return layer('ring:' + key, w, h, (g) => {
      const N = 110, n = noises()[1];
      for (let i = 0; i < N; i++) {
        const f = i / (N - 1), rad = lerp(ri, ro, f);
        const gap = f > 0.6 && f < 0.665 ? 0.08 : 1;
        const a = (0.15 + 0.75 * fbm(n, f * 18, 3.3, 3)) * gap * sstep(0, 0.1, f) * (1 - sstep(0.85, 1, f));
        g.strokeStyle = rgba(mixc([246, 214, 186], [214, 150, 140], fract(f * 3.1) * 0.6), a * 0.85);
        g.lineWidth = ((ro - ri) / N) * 1.7;
        g.beginPath(); g.ellipse(w / 2, h / 2, rad, rad * ratio, 0, 0, TAU); g.stroke();
      }
    });
  }
  function drawRingHalf(ctx, img, cx, cy, tilt, front, alpha) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt);
    ctx.beginPath();
    if (front) ctx.rect(-img.lw / 2 - 2, 0, img.lw + 4, img.lh / 2 + 4);
    else ctx.rect(-img.lw / 2 - 2, -img.lh / 2 - 4, img.lw + 4, img.lh / 2 + 4);
    ctx.clip();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(img, -img.lw / 2, -img.lh / 2, img.lw, img.lh);
    ctx.restore();
  }
  /**
   * The full planet: back ring half → rotating surface + clouds → shading → ring shadow
   * → front ring half → additive atmosphere.
   * p: {x, y, R, L, key, tilt, ratio, rot, crot, ring}
   */
  function drawTessera(ctx, p) {
    const ring = p.ring !== false ? ringImg(p.R, p.ratio, p.key) : null;
    if (ring) drawRingHalf(ctx, ring, p.x, p.y, p.tilt, false, 0.9);
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, p.R, 0, TAU); ctx.clip();
    sphereMap(ctx, planetTex(), p.x, p.y, p.R, p.rot);
    ctx.globalAlpha = 0.92;
    sphereMap(ctx, cloudTex(), p.x, p.y, p.R, p.crot);
    ctx.globalAlpha = 1;
    if (ring) { // ring shadow cast onto the disc
      ctx.save(); ctx.translate(p.x, p.y + p.R * 0.12); ctx.rotate(p.tilt);
      ctx.strokeStyle = 'rgba(10,4,12,0.35)'; ctx.lineWidth = p.R * 0.3;
      ctx.beginPath(); ctx.ellipse(0, 0, p.R * 1.62, p.R * 1.62 * p.ratio, 0, 0, Math.PI); ctx.stroke();
      ctx.restore();
    }
    ctx.drawImage(shadeImg(p.R, p.L, p.key), p.x - p.R, p.y - p.R, p.R * 2, p.R * 2);
    ctx.restore();
    if (ring) drawRingHalf(ctx, ring, p.x, p.y, p.tilt, true, 1);
    const atmo = atmoImg(p.R, p.L, p.key, [255, 120, 130]);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(atmo, p.x - atmo.lw / 2, p.y - atmo.lh / 2, atmo.lw, atmo.lh);
    ctx.restore();
  }
  /** Cratered moon sphere lit from L. */
  function moonImg(key, R, L, base, seed) {
    return layer('moon:' + key, R * 2 + 4, R * 2 + 4, (g, w, h, c) => {
      const S = c.width, id = g.createImageData(S, S), d = id.data, n = noises()[2], n2 = noises()[3];
      const rr = (S - 4 * (S / (R * 2 + 4))) / 2, cc = S / 2;
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const nx = (px + 0.5 - cc) / rr, ny = (py + 0.5 - cc) / rr, d2 = nx * nx + ny * ny;
        if (d2 >= 1.0) continue;
        const nz = Math.sqrt(1 - d2);
        const m = fbm(n, nx * 2.2 + seed, ny * 2.2 + seed, 5);
        const cr = fbm(n2, nx * 6 + seed, ny * 6, 3);
        const alb = 0.68 + (m - 0.5) * 0.9 - sstep(0.62, 0.7, cr) * 0.18 + sstep(0.7, 0.74, cr) * 0.12;
        const lam = nx * L[0] + ny * L[1] + nz * L[2];
        const lit = Math.pow(clamp01(lam), 0.8) * 1.08 + 0.035;
        const edge = clamp01((1 - Math.sqrt(d2)) * rr * 0.9);
        const i = (py * S + px) * 4;
        d[i] = base[0] * alb * lit; d[i + 1] = base[1] * alb * lit; d[i + 2] = base[2] * alb * lit; d[i + 3] = 255 * edge;
      }
      g.putImageData(id, 0, 0);
    });
  }
  function drawMoon(ctx, img, x, y, haloC, haloA) {
    if (haloC) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; glow(ctx, x, y, img.lw * 1.4, haloC, haloA); ctx.restore(); }
    ctx.drawImage(img, x - img.lw / 2, y - img.lh / 2, img.lw, img.lh);
  }

  // ════════════════════════════════════════════════════════════════════ the Spire
  /** Architect Spire silhouette: terraced base, tapering shaft, floating rings, needle. */
  function drawSpire(ctx, x, by, h, fill, rim, t, lightA, lightC) {
    const w = h * 0.15;
    const pts = [[1.7, 0], [1.45, -0.05], [1.0, -0.06], [0.88, -0.15], [0.55, -0.17], [0.44, -0.4], [0.5, -0.42],
      [0.32, -0.44], [0.26, -0.66], [0.36, -0.68], [0.18, -0.7], [0.1, -0.86], [0.03, -0.92], [0, -1]];
    ctx.save(); ctx.translate(x, by);
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(-px * w, py * h) : ctx.moveTo(-px * w, py * h)));
    for (let i = pts.length - 2; i >= 0; i--) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
    ctx.closePath(); ctx.fill();
    if (rim) {
      ctx.strokeStyle = rim; ctx.lineWidth = Math.max(0.8, h * 0.006);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo(pts[i][0] * w, pts[i][1] * h) : ctx.moveTo(pts[i][0] * w, pts[i][1] * h));
      ctx.stroke();
    }
    // floating halo rings around the upper shaft (Architect tech), slowly bobbing
    ctx.strokeStyle = fill; ctx.lineWidth = Math.max(1, h * 0.012);
    for (let i = 0; i < 3; i++) {
      const yy = (-0.74 - i * 0.055) * h + Math.sin(t * 0.8 + i) * h * 0.006;
      ctx.beginPath(); ctx.ellipse(0, yy, w * (0.9 - i * 0.2), w * 0.14, 0, 0, TAU); ctx.stroke();
    }
    if (lightA > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const c = lightC || C.cyan;
      glow(ctx, 0, -h, h * 0.22, c, lightA * 0.5);
      glow(ctx, 0, -h, h * 0.05, C.white, lightA * 0.8);
      for (let i = 0; i < 3; i++) glow(ctx, 0, (-0.74 - i * 0.055) * h, w * 0.5, c, lightA * 0.12);
    }
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════ «Ковчег-7»
  /** Ship-local frame: 1000×280, centre y 140, bow at +x. Section cuts for break-up. */
  const SHIP = { W: 1000, H: 280, CY: 140, CUT_A: 342, CUT_B: 614, RING_X: 680, RING_RX: 34, RING_RY: 120 };
  const M_HI = [204, 214, 230], M_MID = [118, 128, 146], M_LO = [28, 32, 44];
  function metal(g, y0, y1, hi, mid, lo) {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, rgba(hi || M_HI, 1)); gr.addColorStop(0.38, rgba(mid || M_MID, 1)); gr.addColorStop(1, rgba(lo || M_LO, 1));
    return gr;
  }
  /** Paint the colony ship hull (lit from the upper left). */
  function paintShip(g) {
    const r = G.rng(7001);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const RX = SHIP.RING_X, RRX = SHIP.RING_RX, RRY = SHIP.RING_RY;
    // ── radiator panels
    for (const s of [-1, 1]) {
      const y0 = 140 + s * 18, y1 = 140 + s * 122;
      g.beginPath(); g.moveTo(228, y0); g.lineTo(336, y0); g.lineTo(316, y1); g.lineTo(246, y1); g.closePath();
      const gr = g.createLinearGradient(0, y0, 0, y1);
      if (s < 0) { gr.addColorStop(0, '#262b37'); gr.addColorStop(1, '#4e566c'); } else { gr.addColorStop(0, '#1d212b'); gr.addColorStop(1, '#0f1117'); }
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      g.strokeStyle = 'rgba(6,8,12,0.75)'; g.lineWidth = 1;
      g.beginPath(); for (let x = 232; x < 340; x += 6) { g.moveTo(x, y0); g.lineTo(x, y1); } g.stroke();
      for (let i = 1; i < 7; i++) { g.fillStyle = 'rgba(255,100,50,0.12)'; g.fillRect(226, lerp(y0, y1, i / 7) - 0.8, 114, 1.6); }
      g.restore();
      g.strokeStyle = s < 0 ? 'rgba(225,236,255,0.6)' : 'rgba(110,120,150,0.25)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(246, y1); g.lineTo(316, y1); g.stroke();
    }
    // ── habitat ring, back half + spokes
    g.lineWidth = 13; g.strokeStyle = '#242836';
    g.beginPath(); g.ellipse(RX, 140, RRX, RRY, 0, Math.PI / 2, Math.PI * 1.5); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(150,170,210,0.2)';
    g.beginPath(); g.ellipse(RX, 140, RRX - 5, RRY - 5, 0, Math.PI / 2, Math.PI * 1.5); g.stroke();
    g.strokeStyle = '#353b4c'; g.lineWidth = 3;
    for (const a of [0.7, 2.3, 3.95, 5.5]) { g.beginPath(); g.moveTo(RX, 140); g.lineTo(RX + Math.cos(a) * RRX, 140 + Math.sin(a) * RRY); g.stroke(); }
    // ── spine truss
    const sx0 = 200, sx1 = 764;
    g.fillStyle = metal(g, 135, 145, M_MID, [78, 86, 102], M_LO); g.fillRect(sx0, 135, sx1 - sx0, 10);
    g.fillStyle = metal(g, 128, 133, M_HI, M_MID, M_LO); g.fillRect(sx0, 128, sx1 - sx0, 4.5);
    g.fillStyle = metal(g, 147, 152, M_MID, M_LO, M_LO); g.fillRect(sx0, 147, sx1 - sx0, 4.5);
    g.strokeStyle = 'rgba(150,162,186,0.75)'; g.lineWidth = 1; g.beginPath();
    for (let x = sx0; x < sx1; x += 12) { g.moveTo(x, 132); g.lineTo(x + 6, 148); g.lineTo(x + 12, 132); }
    g.stroke();
    for (let i = 0; i < 46; i++) {
      const x = lerp(sx0, sx1, r()), up = r() < 0.5, w = 3 + r() * 9, h = 2 + r() * 4;
      g.fillStyle = up ? '#8a94aa' : '#262a36'; g.fillRect(x, up ? 128 - h : 152, w, h);
    }
    // ── nozzles
    for (const ny of [114, 140, 166]) {
      const gr = g.createLinearGradient(0, ny - 16, 0, ny + 16);
      gr.addColorStop(0, '#a3acc0'); gr.addColorStop(0.4, '#4a5164'); gr.addColorStop(1, '#12141b');
      g.fillStyle = gr; g.beginPath();
      g.moveTo(100, ny - 8); g.bezierCurveTo(82, ny - 9, 66, ny - 13, 52, ny - 16); g.lineTo(52, ny + 16);
      g.bezierCurveTo(66, ny + 13, 82, ny + 9, 100, ny + 8); g.closePath(); g.fill();
      g.fillStyle = '#08090d'; g.beginPath(); g.ellipse(52, ny, 3.5, 16, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(220,228,245,0.4)'; g.lineWidth = 1; g.beginPath();
      g.moveTo(100, ny - 8); g.bezierCurveTo(82, ny - 9, 66, ny - 13, 52, ny - 16); g.stroke();
    }
    // ── reactor block + shadow shield
    g.fillStyle = metal(g, 104, 176); G.roundRect(g, 96, 104, 124, 72, 10); g.fill();
    g.strokeStyle = 'rgba(8,10,16,0.55)'; g.lineWidth = 1; g.beginPath();
    for (const x of [128, 160, 192]) { g.moveTo(x, 106); g.lineTo(x, 174); }
    g.moveTo(98, 140); g.lineTo(218, 140); g.stroke();
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i % 2 ? '#15151a' : '#c99a2e'; const x = 130 + i * 6;
      g.beginPath(); g.moveTo(x, 167); g.lineTo(x + 6, 167); g.lineTo(x + 3, 173); g.lineTo(x - 3, 173); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(240,246,255,0.65)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(104, 104.6); g.lineTo(212, 104.6); g.stroke();
    const sg = g.createLinearGradient(0, 90, 0, 190); sg.addColorStop(0, '#b0b9cc'); sg.addColorStop(0.5, '#555c70'); sg.addColorStop(1, '#14161d');
    g.fillStyle = sg; g.beginPath(); g.moveTo(218, 100); g.lineTo(230, 90); g.lineTo(235, 90); g.lineTo(235, 190); g.lineTo(230, 190); g.lineTo(218, 180); g.closePath(); g.fill();
    // ── cryo section
    function capsule(x, y, w, h) {
      g.fillStyle = metal(g, y - h / 2, y + h / 2, [218, 226, 240], [140, 150, 168], [34, 38, 52]);
      G.roundRect(g, x, y - h / 2, w, h, h / 2); g.fill();
      g.strokeStyle = 'rgba(10,12,18,0.6)'; g.lineWidth = 1; g.beginPath();
      g.moveTo(x + 7, y - h / 2 + 1); g.lineTo(x + 7, y + h / 2 - 1); g.moveTo(x + w - 7, y - h / 2 + 1); g.lineTo(x + w - 7, y + h / 2 - 1); g.stroke();
      g.fillStyle = 'rgba(120,236,255,0.9)';
      for (let wx = x + 11; wx < x + w - 12; wx += 5) g.fillRect(wx, y - 0.5, 2.2, 2);
      g.strokeStyle = 'rgba(245,250,255,0.6)'; g.beginPath(); g.moveTo(x + h / 2, y - h / 2 + 0.6); g.lineTo(x + w - h / 2, y - h / 2 + 0.6); g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const x = 354 + i * 62;
      g.fillStyle = '#363c4c'; g.fillRect(x + 25, 104, 6, 72);
      if (i === 1 || i === 2) { g.fillStyle = '#363c4c'; g.fillRect(x + 26, 80, 4, 120); capsule(x + 4, 91, 48, 18); capsule(x + 4, 189, 48, 18); }
      capsule(x, 116, 56, 22); capsule(x, 164, 56, 22);
    }
    // ── forward hull
    const hull = () => { g.beginPath(); g.moveTo(744, 121); g.lineTo(862, 112); g.bezierCurveTo(930, 112, 972, 128, 984, 140); g.bezierCurveTo(972, 152, 930, 168, 862, 168); g.lineTo(744, 159); g.closePath(); };
    g.fillStyle = metal(g, 124, 156); g.fillRect(730, 124, 16, 32);
    hull(); g.fillStyle = metal(g, 112, 168, [226, 232, 244], [130, 140, 158], [24, 28, 40]); g.fill();
    g.save(); hull(); g.clip();
    g.strokeStyle = 'rgba(10,12,18,0.45)'; g.lineWidth = 1; g.beginPath();
    for (const x of [786, 826, 868, 912]) { g.moveTo(x, 100); g.lineTo(x, 180); }
    g.moveTo(744, 151); g.lineTo(984, 151); g.stroke();
    g.fillStyle = '#b8452e'; g.fillRect(744, 146, 220, 3);
    g.fillStyle = 'rgba(26,30,42,0.85)'; g.font = '700 9px ' + SANS; g.textBaseline = 'alphabetic';
    g.fillText('КОВЧЕГ-7', 772, 141);
    g.fillStyle = 'rgba(255,226,170,0.95)';
    for (let i = 0; i < 8; i++) g.fillRect(916 + i * 6, 126, 3.6, 2.6);
    g.restore();
    g.strokeStyle = 'rgba(248,252,255,0.75)'; g.lineWidth = 1.2; g.beginPath();
    g.moveTo(746, 121.4); g.lineTo(862, 112.6); g.bezierCurveTo(930, 112.6, 970, 127, 982, 139); g.stroke();
    g.strokeStyle = '#59627a'; g.lineWidth = 2; g.beginPath(); g.moveTo(820, 113); g.lineTo(812, 90); g.stroke();
    g.save(); g.translate(808, 86); g.rotate(-0.45);
    g.fillStyle = metal(g, -6, 6, [234, 240, 250], [120, 130, 150], [40, 44, 58]); g.beginPath(); g.ellipse(0, 0, 13, 5, 0, 0, TAU); g.fill();
    g.restore();
    // ── hub + ring front half
    g.fillStyle = metal(g, 122, 158); g.beginPath(); g.ellipse(RX, 140, 9, 18, 0, 0, TAU); g.fill();
    const rg = g.createLinearGradient(0, 18, 0, 262); rg.addColorStop(0, '#dbe3f0'); rg.addColorStop(0.5, '#6d7690'); rg.addColorStop(1, '#1b1f2c');
    g.strokeStyle = rg; g.lineWidth = 13; g.beginPath(); g.ellipse(RX, 140, RRX, RRY, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.PI * (i + 0.5)) / 16;
      g.fillStyle = 'rgba(8,10,16,0.55)'; g.fillRect(RX + Math.cos(a) * RRX - 6, 140 + Math.sin(a) * RRY - 0.6, 12, 1.2);
    }
    g.strokeStyle = 'rgba(245,250,255,0.55)'; g.lineWidth = 1.2; g.beginPath(); g.ellipse(RX, 140, RRX + 6, RRY + 6, 0, -Math.PI / 2, -0.15); g.stroke();
    g.fillStyle = 'rgba(255,214,150,0.8)';
    for (let i = 0; i < 24; i++) {
      const a = -Math.PI / 2 + (Math.PI * (i + 0.5)) / 24;
      g.fillRect(RX + Math.cos(a) * (RRX + 1) - 0.9, 140 + Math.sin(a) * (RRY + 1) - 0.9, 1.8, 1.8);
    }
  }
  const shipImg = () => layer('ship', SHIP.W, SHIP.H, paintShip, 2);

  /** Weathered/broken variants for the orbital graveyard (0 = recent, 1..3 = ancient). */
  function wreckImg(v) {
    return layer('wreck' + v, SHIP.W, SHIP.H, (g) => {
      const r = G.rng(500 + v * 31);
      g.drawImage(shipImg(), 0, 0, SHIP.W, SHIP.H);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = v === 0 ? 'rgba(30,40,70,0.22)' : 'rgba(44,28,22,' + (0.5 + v * 0.08) + ')';
      g.fillRect(0, 0, SHIP.W, SHIP.H);
      for (let i = 0; i < 26 + v * 8; i++) {
        const x = r() * 1000, y = 70 + r() * 140, rad = 6 + r() * 34;
        const gr = g.createRadialGradient(x, y, 0, x, y, rad);
        gr.addColorStop(0, v ? 'rgba(20,12,8,0.7)' : 'rgba(10,10,14,0.55)'); gr.addColorStop(1, 'rgba(20,12,8,0)');
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      const chunks = v === 0 ? 2 : 3 + v * 2;
      for (let i = 0; i < chunks; i++) {
        const cx = 120 + r() * 840, cy = 90 + r() * 100, sz = 14 + r() * (v ? 60 : 30);
        g.beginPath();
        for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, rr = sz * (0.5 + r() * 0.6); g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8); }
        g.closePath(); g.fill();
      }
      if (v === 1) { g.beginPath(); g.moveTo(880, 0); for (let y = 0; y <= 280; y += 20) g.lineTo(880 + r() * 40, y); g.lineTo(1000, 280); g.lineTo(1000, 0); g.fill(); }
      if (v === 2) g.fillRect(220, 0, 130, 124);
      if (v === 3) { g.beginPath(); g.ellipse(SHIP.RING_X, 140, 50, 130, 0, -2.2, -0.4); g.lineTo(SHIP.RING_X, 140); g.fill(); g.fillRect(0, 150, 240, 130); }
      g.globalCompositeOperation = 'source-over';
    }, 1);
  }

  /** Jagged break line through the hull at local x. */
  function jag(x, seed) {
    const pts = [];
    for (let y = -10; y <= SHIP.H + 10; y += 14) pts.push([x + (hash(seed, y) - 0.5) * 26, y]);
    return pts;
  }
  /** Clip to the hull section 'aft' | 'cryo' | 'fore' | 'aftcryo' (jagged cuts). */
  function clipPart(ctx, part) {
    const A = jag(SHIP.CUT_A, 17), B = jag(SHIP.CUT_B, 29);
    const left = part === 'aft' || part === 'aftcryo' ? null : A;
    const right = part === 'fore' ? null : part === 'aft' ? A : B;
    ctx.beginPath();
    if (left) left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    else { ctx.moveTo(-20, -20); ctx.lineTo(-20, SHIP.H + 20); }
    if (right) for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    else { ctx.lineTo(SHIP.W + 20, SHIP.H + 20); ctx.lineTo(SHIP.W + 20, -20); }
    ctx.closePath(); ctx.clip();
  }
  const PART_PIVOT = { all: 500, aft: 190, cryo: 478, fore: 800, aftcryo: 320 };
  /**
   * Draw the ship (or a section) centred on (x, y).
   * o: {img, part, engine (0..1), lights (bool), heat (0..1), crack (0..1)}
   */
  function drawShip(ctx, x, y, s, rot, t, o) {
    o = o || {};
    const part = o.part || 'all';
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s); ctx.translate(-PART_PIVOT[part], -SHIP.CY);
    ctx.save();
    if (part !== 'all') clipPart(ctx, part);
    ctx.drawImage(o.img || shipImg(), 0, 0, SHIP.W, SHIP.H);
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    const hasAft = part === 'all' || part === 'aft' || part === 'aftcryo';
    const hasFore = part === 'all' || part === 'fore';
    if (o.engine > 0 && hasAft) {
      const e = o.engine * (0.9 + 0.1 * Math.sin(t * 23) * Math.sin(t * 7.3));
      for (const ny of [114, 140, 166]) {
        glow(ctx, 52, ny, 22, C.plasma, 0.9 * e);
        glowE(ctx, 10, ny, 70, 12, 0, C.blue, 0.55 * e);
        glowE(ctx, -40, ny, 150, 20, 0, C.blue, 0.22 * e);
        for (let k = 0; k < 4; k++) glow(ctx, 40 - k * 16, ny, 6 - k, C.white, 0.5 * e);
      }
      glow(ctx, 30, 140, 90, C.blue, 0.18 * e);
    }
    if (o.lights !== false) {
      if (hasFore) {
        const ringN = 10;
        for (let k = 0; k < ringN; k++) {
          const a = (k / ringN) * TAU + t * 0.4, ca = Math.cos(a);
          if (ca < 0.05) continue;
          glow(ctx, SHIP.RING_X + SHIP.RING_RX * ca, 140 + SHIP.RING_RY * Math.sin(a), 5, C.warm, 0.55 * ca);
        }
        const strobe = fract(t / 1.6) < 0.06 ? 1 : 0;
        glow(ctx, 984, 140, 14, C.white, strobe * 0.9);
        glow(ctx, 936, 127, 18, C.gold, 0.18);
      }
      if (hasAft) {
        const bl = 0.5 + 0.5 * Math.sin(t * 3.2);
        glow(ctx, 316, 18, 9, C.red, 0.7 * bl);
        glow(ctx, 316, 262, 9, [80, 255, 140], 0.6 * (1 - bl));
      }
      if (part === 'all' || part === 'cryo' || part === 'aftcryo') {
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.3);
        glowE(ctx, 478, 140, 140, 60, 0, C.cyan, 0.06 + 0.04 * pulse);
      }
    }
    if (o.heat > 0) { // re-entry glow on the hull underside
      glowE(ctx, PART_PIVOT[part] - 40, 200, 220, 70, 0, C.orange, 0.35 * o.heat);
      glowE(ctx, PART_PIVOT[part] - 80, 210, 140, 40, 0, C.warm, 0.3 * o.heat);
    }
    if (o.crack > 0) drawCracks(ctx, t, o.crack, part);
    ctx.restore();
  }
  /** Glowing structural fractures around the section joints (ship-local, additive). */
  function drawCracks(ctx, t, k, part) {
    const lines = [[SHIP.CUT_A, 17], [SHIP.CUT_B, 29]];
    ctx.lineCap = 'round';
    for (const [x, seed] of lines) {
      if (part === 'fore' && x === SHIP.CUT_A) continue;
      if (part === 'aft' && x === SHIP.CUT_B) continue;
      const pts = jag(x, seed);
      const fl = 0.75 + 0.25 * Math.sin(t * 17 + x);
      const n = Math.max(2, Math.round(pts.length * clamp01(k * 1.3)));
      const mid = (pts.length / 2) | 0;
      const from = Math.max(0, mid - (n >> 1)), to = Math.min(pts.length, mid + (n >> 1) + 1);
      ctx.strokeStyle = rgba(C.fire, 0.55 * k * fl); ctx.lineWidth = 5;
      ctx.beginPath(); for (let i = from; i < to; i++) (i === from ? ctx.moveTo(pts[i][0], pts[i][1]) : ctx.lineTo(pts[i][0], pts[i][1])); ctx.stroke();
      ctx.strokeStyle = rgba(C.warm, 0.9 * k * fl); ctx.lineWidth = 1.6; ctx.stroke();
      for (let i = from; i < to; i += 2) glow(ctx, pts[i][0], pts[i][1], 22, C.orange, 0.35 * k * fl);
      // branching fractures
      ctx.strokeStyle = rgba(C.amber, 0.6 * k * fl); ctx.lineWidth = 1;
      ctx.beginPath();
      for (let b = 0; b < 6; b++) {
        const p = pts[(from + ((b * 7) % Math.max(1, to - from))) % pts.length];
        let bx = p[0], by = p[1];
        ctx.moveTo(bx, by);
        for (let s = 0; s < 4; s++) { bx += (hash(seed + b, s) - 0.5) * 30 + (b % 2 ? 9 : -9); by += (hash(seed + b, s + 9) - 0.5) * 22; ctx.lineTo(bx, by); }
      }
      ctx.stroke();
    }
  }

  /** Escape pod (local +x = heat shield / direction of travel). */
  function drawPod(ctx, x, y, s, rot, t, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    if (o.thrust > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const f = o.thrust * (0.85 + 0.15 * Math.sin(t * 41));
      glowE(ctx, -34, 0, 30, 7, 0, C.plasma, 0.9 * f);
      glowE(ctx, -60, 0, 60, 14, 0, C.blue, 0.4 * f);
      glow(ctx, -21, 0, 9, C.white, f);
      ctx.restore();
    }
    const bg = ctx.createLinearGradient(0, -12, 0, 12);
    bg.addColorStop(0, '#e2e8f2'); bg.addColorStop(0.45, '#8790a6'); bg.addColorStop(1, '#22262f');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(9, -12); ctx.lineTo(-13, -6.5); ctx.lineTo(-19, -4.5); ctx.lineTo(-19, 4.5); ctx.lineTo(-13, 6.5); ctx.lineTo(9, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8452e'; ctx.fillRect(-6, -9.4, 3, 18.8);
    ctx.fillStyle = '#3a2a24'; ctx.beginPath(); ctx.ellipse(10, 0, 4, 12.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(140,240,255,0.95)'; ctx.beginPath(); ctx.ellipse(-1, -4, 2.6, 1.8, -0.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(8, -11.6); ctx.lineTo(-13, -6.1); ctx.stroke();
    if (o.heat > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const h = o.heat * (0.85 + 0.15 * Math.sin(t * 37 + 1));
      glowE(ctx, 15, 0, 12, 22, 0, C.warm, 0.95 * h);
      glowE(ctx, 22, 0, 26, 40, 0, C.orange, 0.55 * h);
      glow(ctx, 14, 0, 60, C.orange, 0.25 * h);
    }
    if (o.burnt) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = 'rgba(30,16,10,0.45)'; ctx.fillRect(-25, -15, 40, 30); }
    ctx.restore();
  }

  /**
   * Re-entry fire trail. (x, y) = hot head; (dx, dy) = unit direction the trail streams to.
   * Additive flame core → orange → red, then dark smoke beyond.
   */
  function fireTrail(ctx, x, y, dx, dy, len, width, t, seed, k) {
    const px = -dy, py = dx;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 16; i++) { // smoke first (behind)
      const u = 0.35 + (i / 16) * 0.9;
      const w = Math.sin(t * 3 + i * 1.7 + seed) * width * 0.4 * u;
      puff(ctx, x + dx * len * u + px * w, y + dy * len * u + py * w, width * (0.8 + u * 1.6), C.smoke, 0.22 * k * (1 - u / 1.25));
    }
    ctx.globalCompositeOperation = 'lighter';
    const n = 26;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const fl = hash(seed * 97 + i, Math.floor(t * 24));
      const w = Math.sin(t * 9 + i * 0.9 + seed) * width * 0.35 * u;
      const cx = x + dx * len * u * 0.75 + px * w, cy = y + dy * len * u * 0.75 + py * w;
      const c = u < 0.12 ? C.warm : u < 0.4 ? C.fire : u < 0.7 ? C.orange : C.deepRed;
      glow(ctx, cx, cy, width * (0.6 + u * 1.5) * (0.85 + 0.3 * fl), c, k * Math.pow(1 - u, 1.4) * 0.55);
    }
    glow(ctx, x, y, width * 1.2, C.white, 0.8 * k);
    glow(ctx, x, y, width * 3.5, C.orange, 0.3 * k);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ════════════════════════════════════════════════════════════════════ shared backdrops
  function spaceNebula(key, seed, blobs, lanes, top, bot) {
    return layer('neb:' + key, DW, DH, (g) => {
      vfill(g, 0, DH, [[0, top || [3, 4, 10]], [1, bot || [7, 5, 16]]]);
      paintNebula(g, seed, blobs);
      if (lanes) paintDustLanes(g, seed + 1, lanes);
    }, 0.5);
  }
  function starLayer(key, seed, n, o) { return layer('stars:' + key, DW, DH, (g) => paintStars(g, DW, DH, seed, n, o)); }
  /** Draw a horizontally tiling layer scrolled by ox. */
  function tileX(ctx, img, ox, y) {
    const x = ((ox % DW) + DW) % DW;
    ctx.drawImage(img, x - DW, y || 0, DW, DH);
    ctx.drawImage(img, x, y || 0, DW, DH);
  }
  /** Out-of-focus foreground motes drifting by (cinematic depth cue). */
  function bokeh(ctx, t, n, vx, vy, c, a, seed) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const x = fract(hash(seed, i) + (t * vx * (0.6 + hash(seed, i + 50))) / 1200) * 1200 - 120;
      const y = fract(hash(seed, i + 9) + (t * vy) / 700) * 700 - 80;
      const r = 3 + hash(seed, i + 20) * 14;
      glow(ctx, x, y, r * 2.2, c, a * (0.3 + 0.7 * hash(seed, i + 31)) * (0.6 + 0.4 * Math.sin(t * 0.7 + i)));
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ════════════════════════════════════════════════════════════════════ scenes
  const TITLE_L = norm3([0.62, -0.66, 0.38]);

  /** title — Tessera with ring + moons, drifting stars, the planet's pulsing signal. Loops. */
  function sceneTitle(ctx, t) {
    const P = { x: 828, y: 432, R: 238 };
    blit(ctx, spaceNebula('title', 31, [
      { x: 900, y: 200, sx: 260, sy: 220, r: 300, c: [150, 50, 90], a: 0.11, n: 14 },
      { x: 840, y: 520, sx: 300, sy: 120, r: 240, c: [190, 96, 40], a: 0.08, n: 10 },
      { x: 200, y: 400, sx: 300, sy: 200, r: 260, c: [60, 36, 130], a: 0.08, n: 12 },
      { x: 90, y: 90, sx: 200, sy: 120, r: 200, c: [20, 90, 120], a: 0.06, n: 8 },
    ], [{ x0: 0, y0: 470, x1: 520, y1: 300, r: 90, a: 0.35, j: 70, n: 16 }]));
    blit(ctx, starLayer('title-far', 101, 1500, { pow: 3.4, size: 1.1, alpha: 0.85, band: { y0: 250, k: -0.5, spread: 120, frac: 0.45 } }));
    tileX(ctx, starLayer('title-near', 202, 150, { pow: 2.1, size: 2.0, wrap: true }), -t * 3.2);
    // twinkling hero stars
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = fract(hash(77, i) - t * 3.2 / DW) * DW, y = 40 + hash(78, i) * 300;
      const tw = Math.pow(0.5 + 0.5 * Math.sin(t * (0.6 + hash(79, i)) + i * 2), 3);
      flare(ctx, x, y, 10 + 10 * hash(80, i), STAR_COLS[i % 6], 0.25 + 0.5 * tw);
    }
    ctx.restore();
    // sun glare off the top-right edge
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 1010, 60, 420, [255, 170, 140], 0.16);
    glow(ctx, 1000, 40, 140, C.warm, 0.25);
    ctx.restore();
    // moons
    drawMoon(ctx, moonImg('m1', 30, norm3([0.7, -0.4, 0.45]), [236, 214, 200], 3.1), 142, 118, C.rose, 0.12);
    drawMoon(ctx, moonImg('m2', 11, norm3([0.75, -0.5, 0.4]), [210, 196, 230], 7.7), 902, 92, C.ice, 0.1);
    // the planet
    drawTessera(ctx, { x: P.x, y: P.y, R: P.R, L: TITLE_L, key: 'title', tilt: -0.32, ratio: 0.22, rot: t * 0.0032, crot: t * 0.0055 + 0.3 });
    // the signal: a pulsing point on the night side + rings spreading across space
    const bx = 704, by = 520;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const period = 4.2;
    for (let k = 0; k < 3; k++) {
      const age = fract(t / period + k / 3) * period;
      const rad = 8 + age * 150, a = Math.pow(1 - age / period, 2);
      ctx.strokeStyle = rgba(C.cyan, 0.22 * a); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(bx, by, rad, rad * 0.82, -0.2, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(C.cyan, 0.05 * a); ctx.lineWidth = 9; ctx.stroke();
    }
    const beat = Math.exp(-fract(t / (period / 3)) * 6);
    glow(ctx, bx, by, 26 + 20 * beat, C.cyan, 0.35 + 0.5 * beat);
    glow(ctx, bx, by, 4, C.white, 0.9);
    ctx.restore();
    bokeh(ctx, t, 8, -14, -4, C.gold, 0.05, 5);
    // keep the logo + menu column moody and readable
    ctx.save();
    const gr = ctx.createRadialGradient(480, 280, 40, 480, 280, 430);
    gr.addColorStop(0, 'rgba(2,3,8,0.55)'); gr.addColorStop(0.6, 'rgba(2,3,8,0.3)'); gr.addColorStop(1, 'rgba(2,3,8,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, DW, DH);
    ctx.restore();
    vignette(ctx, 0.75);
  }

  /** space — «Ковчег-7» gliding through deep space; slow push-in. */
  function sceneSpace(ctx, t) {
    const k = easeInOut(Math.min(t, 18) / 18);
    cam(ctx, 1 + 0.03 * k, 480, 240);
    blit(ctx, spaceNebula('space', 41, [
      { x: 700, y: 140, sx: 500, sy: 160, r: 260, c: [30, 110, 140], a: 0.09, n: 16 },
      { x: 300, y: 380, sx: 420, sy: 160, r: 280, c: [90, 40, 140], a: 0.09, n: 14 },
      { x: 860, y: 420, sx: 200, sy: 160, r: 220, c: [170, 90, 50], a: 0.06, n: 8 },
    ], [{ x0: 200, y0: 120, x1: 900, y1: 330, r: 80, a: 0.4, j: 60, n: 20 }]));
    blit(ctx, starLayer('space-far', 303, 1700, { pow: 3.3, size: 1.1, band: { y0: 260, k: 0.25, spread: 90, frac: 0.5 } }));
    ctx.restore();
    cam(ctx, 1 + 0.06 * k, 480, 240);
    tileX(ctx, starLayer('space-near', 404, 120, { pow: 2, size: 1.9, wrap: true }), -t * 6);
    ctx.restore();
    // distant sun with anamorphic flare
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const sx = 120, sy = 86;
    glow(ctx, sx, sy, 300, [255, 190, 140], 0.18);
    glow(ctx, sx, sy, 60, C.warm, 0.55);
    glow(ctx, sx, sy, 10, C.white, 1);
    lensFlare(ctx, sx, sy, 0.8 + 0.1 * Math.sin(t * 0.7));
    ctx.restore();
    // the ship
    cam(ctx, 1 + 0.12 * k, 500, 236);
    const shx = 420 + 140 * settle(t, 16), shy = 236 + Math.sin(t * 0.35) * 3;
    drawShip(ctx, shx, shy, 0.66, -0.035, t, { engine: 1 });
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; // sun rim light sweeping the bow
    glowE(ctx, shx + 150, shy - 40, 200, 20, -0.04, C.warm, 0.08 + 0.04 * Math.sin(t * 0.5));
    ctx.restore();
    ctx.restore();
    bokeh(ctx, t, 10, -40, 0, C.ice, 0.06, 9);
    vignette(ctx, 0.8);
    grain(ctx, t, 0.35);
  }

  /** signal — bridge viewport, a rhythmic signal pulsing out of an uncharted system. */
  const SIG_P = 3.2, SIG_BEATS = [0, 0.26, 0.52, 1.42];
  function sigValue(tau) {
    const ph = fract(tau / SIG_P) * SIG_P;
    let v = (hash(Math.floor(tau * 90), 5) - 0.5) * 0.12;
    for (const o of SIG_BEATS) {
      const d = ph - o;
      if (d >= 0 && d < 0.6) v += Math.exp(-d * 10) * Math.sin(d * 120) * (o === 1.42 ? 1 : 0.7);
    }
    return v;
  }
  function sceneSignal(ctx, t) {
    const SX = 640, SY = 196;
    const k = easeInOut(Math.min(t, 18) / 18);
    cam(ctx, 1 + 0.14 * k, SX, SY);
    blit(ctx, spaceNebula('signal', 51, [
      { x: 640, y: 196, sx: 160, sy: 90, r: 200, c: [80, 40, 160], a: 0.12, n: 12 },
      { x: 300, y: 300, sx: 500, sy: 200, r: 260, c: [20, 50, 110], a: 0.08, n: 12 },
    ], [{ x0: 100, y0: 380, x1: 900, y1: 260, r: 80, a: 0.4, j: 60, n: 18 }], [2, 2, 8], [5, 4, 14]));
    blit(ctx, starLayer('signal-far', 505, 1500, { pow: 3.3, size: 1.1 }));
    // the unknown system: a dim red star with faint orbits
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    let flash = 0;
    const ph = fract(t / SIG_P) * SIG_P;
    for (const o of SIG_BEATS) { const d = ph - o; if (d >= 0) flash += Math.exp(-d * 7); }
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(C.violet, 0.12);
      ctx.beginPath(); ctx.ellipse(SX, SY, 34 + i * 26, (34 + i * 26) * 0.32, -0.25, 0, TAU); ctx.stroke();
      const a = t * (0.5 / (i + 1)) + i * 2;
      const px = SX + Math.cos(a) * (34 + i * 26), py = SY + Math.sin(a) * (34 + i * 26) * 0.32;
      const c = Math.cos(-0.25), s = Math.sin(-0.25);
      glow(ctx, SX + (px - SX) * c - (py - SY) * s, SY + (px - SX) * s + (py - SY) * c, 3, C.ice, 0.6);
    }
    glow(ctx, SX, SY, 70 + 30 * flash, [200, 120, 255], 0.3 + 0.25 * flash);
    glow(ctx, SX, SY, 16, [255, 150, 160], 0.9);
    glow(ctx, SX, SY, 4, C.white, 1);
    // expanding signal fronts
    for (let c = -1; c <= 0; c++) {
      const base = Math.floor(t / SIG_P) + c;
      for (const o of SIG_BEATS) {
        const age = t - (base * SIG_P + o);
        if (age < 0 || age > 4.5) continue;
        const rad = 12 + Math.pow(age, 0.85) * 170, a = Math.pow(1 - age / 4.5, 2) * (o === 1.42 ? 1 : 0.65);
        ctx.strokeStyle = rgba([190, 160, 255], 0.5 * a); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(SX, SY, rad, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(C.violet, 0.1 * a); ctx.lineWidth = 12; ctx.stroke();
      }
    }
    ctx.restore();
    ctx.restore();
    // bridge frame in front (fixed): the parallax against the zoom sells the depth
    blit(ctx, layer('bridge-frame', DW, DH, paintBridge));
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; // glass reflections
    glowE(ctx, 250, 200, 260, 30, -0.9, C.ice, 0.035);
    glowE(ctx, 760, 330, 180, 16, -0.9, C.ice, 0.03);
    for (let i = 0; i < 7; i++) glow(ctx, 160 + i * 110, 470, 40, i % 3 ? C.cyan : C.amber, 0.12 + 0.05 * Math.sin(t * 2 + i));
    ctx.restore();
    drawSignalHud(ctx, t, SX, SY, flash);
    vignette(ctx, 0.6);
    grain(ctx, t, 0.35);
  }
  function paintBridge(g) {
    const dark = '#06080d';
    g.fillStyle = dark;
    // left & right canopy pillars
    g.beginPath(); g.moveTo(0, 0); g.lineTo(118, 0); g.lineTo(74, 420); g.lineTo(0, 470); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(DW, 0); g.lineTo(DW - 118, 0); g.lineTo(DW - 74, 420); g.lineTo(DW, 470); g.closePath(); g.fill();
    // top canopy beam
    g.beginPath(); g.moveTo(0, 0); g.lineTo(DW, 0); g.lineTo(DW, 46); g.lineTo(DW - 160, 52); g.lineTo(160, 52); g.lineTo(0, 46); g.closePath(); g.fill();
    // console
    g.beginPath(); g.moveTo(0, 430); g.lineTo(140, 400); g.lineTo(DW - 140, 400); g.lineTo(DW, 430); g.lineTo(DW, DH); g.lineTo(0, DH); g.closePath();
    const cg = g.createLinearGradient(0, 400, 0, DH); cg.addColorStop(0, '#141a24'); cg.addColorStop(1, '#05070b');
    g.fillStyle = cg; g.fill();
    // rim light (cyan instrument glow) on the inner edges
    g.strokeStyle = 'rgba(126,249,255,0.28)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(118, 52); g.lineTo(74, 420); g.moveTo(DW - 118, 52); g.lineTo(DW - 74, 420);
    g.moveTo(160, 52.5); g.lineTo(DW - 160, 52.5); g.moveTo(140, 400.5); g.lineTo(DW - 140, 400.5); g.stroke();
    g.strokeStyle = 'rgba(160,190,230,0.08)'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(112, 52); g.lineTo(68, 420); g.moveTo(DW - 112, 52); g.lineTo(DW - 68, 420); g.stroke();
    // console screens + buttons
    const r = G.rng(808);
    for (let i = 0; i < 6; i++) {
      const x = 170 + i * 108;
      g.fillStyle = 'rgba(20,60,80,0.8)'; G.roundRect(g, x, 418, 78, 30, 4); g.fill();
      g.strokeStyle = 'rgba(126,249,255,0.35)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = 'rgba(126,249,255,0.5)';
      for (let j = 0; j < 5; j++) g.fillRect(x + 6, 424 + j * 5, 20 + r() * 46, 1.5);
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = r() < 0.2 ? 'rgba(255,170,80,0.8)' : 'rgba(126,249,255,0.6)'; g.fillRect(150 + r() * 660, 460 + r() * 60, 3, 2); }
    // bolts
    g.fillStyle = 'rgba(140,160,190,0.25)';
    for (let y = 70; y < 400; y += 40) { g.beginPath(); g.arc(40 + (y / 420) * 30, y, 2, 0, TAU); g.arc(DW - 40 - (y / 420) * 30, y, 2, 0, TAU); g.fill(); }
  }
  function drawSignalHud(ctx, t, SX, SY, flash) {
    const cyan = C.cyan;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // reticle
    const rr = 54 + Math.sin(t * 2) * 3;
    ctx.strokeStyle = rgba(cyan, 0.65); ctx.lineWidth = 1.4;
    ctx.save(); ctx.translate(SX, SY); ctx.rotate(t * 0.15);
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.arc(0, 0, rr, -0.35, 0.35); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = rgba(cyan, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(SX + rr * 0.8, SY - rr * 0.8); ctx.lineTo(SX + 110, SY - 92); ctx.lineTo(SX + 250, SY - 92); ctx.stroke();
    ctx.font = '14px ' + MONO; ctx.textBaseline = 'bottom'; ctx.fillStyle = rgba(cyan, 0.85);
    ctx.fillText('ИСТОЧНИК НЕ КАТАЛОГИЗИРОВАН', SX + 114, SY - 96);
    ctx.font = '12px ' + MONO; ctx.fillStyle = rgba(cyan, 0.55); ctx.textBaseline = 'top';
    ctx.fillText('α 14ч 29м 43с · δ −62° 40′', SX + 114, SY - 88);
    ctx.fillText('ДИСТ. ≈ 0.8 пк · ИСКУССТВ.: 97%', SX + 114, SY - 72);
    // waveform panel
    const px = 150, py = 70, pw = 330, ph = 92;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(6,24,32,0.55)'; G.roundRect(ctx, px, py, pw, ph, 6); ctx.fill();
    ctx.strokeStyle = rgba(cyan, 0.35); ctx.lineWidth = 1; ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(cyan, 0.08);
    ctx.beginPath();
    for (let i = 1; i < 6; i++) { ctx.moveTo(px + (pw * i) / 6, py + 4); ctx.lineTo(px + (pw * i) / 6, py + ph - 4); }
    ctx.moveTo(px + 4, py + ph / 2); ctx.lineTo(px + pw - 4, py + ph / 2); ctx.stroke();
    ctx.beginPath();
    const N = 200, win = 6.4;
    for (let i = 0; i <= N; i++) {
      const x = px + 6 + ((pw - 12) * i) / N;
      const v = sigValue(t - win * (1 - i / N));
      const y = py + ph / 2 - Math.max(-1, Math.min(1, v)) * (ph * 0.42);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgba(cyan, 0.18); ctx.lineWidth = 5; ctx.stroke();
    ctx.strokeStyle = rgba([210, 255, 255], 0.9); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.font = '12px ' + MONO; ctx.textBaseline = 'top'; ctx.fillStyle = rgba(cyan, 0.7);
    ctx.fillText('ВХОДЯЩИЙ СИГНАЛ · 1420.405 МГц', px + 2, py + ph + 6);
    ctx.fillStyle = rgba(cyan, 0.45);
    ctx.fillText('ПЕРИОД 3.20 с · ПОВТОРОВ: ' + (412 + Math.floor(t / SIG_P)), px + 2, py + ph + 22);
    // level bars
    for (let i = 0; i < 14; i++) {
      const lv = clamp01(0.15 + Math.abs(sigValue(t - i * 0.03)) * 0.9 + flash * 0.15);
      ctx.fillStyle = rgba(i > 10 ? C.amber : cyan, 0.25 + 0.5 * lv);
      ctx.fillRect(px + pw + 12, py + ph - 6 - i * 6.2, 18 * lv + 4, 4);
    }
    const rec = fract(t) < 0.5;
    ctx.fillStyle = rgba(C.red, rec ? 0.9 : 0.25); ctx.beginPath(); ctx.arc(px + pw - 14, py + 12, 3.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** anomaly — gravitational lens swirl gripping the ship; red alarm. */
  function sceneAnomaly(ctx, t) {
    const AX = 660, AY = 190;
    const k = easeInOut(Math.min(t, 14) / 14);
    const sh = 1.5 + 2.5 * k;
    const jx = (hash(Math.floor(t * 30), 1) - 0.5) * sh, jy = (hash(Math.floor(t * 30), 2) - 0.5) * sh;
    cam(ctx, 1 + 0.08 * k, AX, AY, jx, jy, -0.03 * k);
    blit(ctx, spaceNebula('anomaly', 61, [
      { x: 660, y: 190, sx: 300, sy: 160, r: 260, c: [60, 50, 160], a: 0.1, n: 14 },
      { x: 200, y: 400, sx: 300, sy: 200, r: 240, c: [120, 30, 60], a: 0.08, n: 10 },
    ], null, [2, 2, 7], [6, 3, 10]));
    // differentially rotating starfield annuli = lensing swirl
    const stars = starLayer('anomaly-stars', 606, 1700, { pow: 3.2, size: 1.2 });
    ctx.save(); ctx.drawImage(stars, 0, 0, DW, DH); ctx.restore();
    const darkG = ctx.createRadialGradient(AX, AY, 30, AX, AY, 300);
    darkG.addColorStop(0, 'rgba(0,0,0,0.95)'); darkG.addColorStop(0.3, 'rgba(0,0,0,0.6)'); darkG.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = darkG; ctx.fillRect(AX - 300, AY - 300, 600, 600);
    drawSwirl(ctx, t, AX, AY);
    // the dark core + photon ring
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    glowE(ctx, AX, AY, 210, 70, -0.18, [120, 90, 255], 0.22);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(AX, AY, 46, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    const pr = 0.85 + 0.15 * Math.sin(t * 5);
    ctx.strokeStyle = rgba([230, 220, 255], 0.75 * pr); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(AX, AY, 49, 0, TAU); ctx.stroke();
    ctx.strokeStyle = rgba(C.violet, 0.25 * pr); ctx.lineWidth = 8; ctx.stroke();
    // lensed "back" of the disk arcing over the core
    ctx.strokeStyle = rgba([255, 210, 200], 0.35); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(AX, AY - 6, 58, 54, -0.18, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
    ctx.restore();
    drawDebris(ctx, t, AX, AY);
    // gravity ripples contracting inward
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const f = 1 - fract(t * 0.22 + i / 4), rad = 60 + f * 520;
      ctx.strokeStyle = rgba([180, 160, 255], 0.09 * Math.sin(Math.PI * f));
      ctx.lineWidth = 2 + 10 * f; ctx.beginPath(); ctx.ellipse(AX, AY, rad, rad * 0.62, -0.18, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
    // ship being dragged + tilted
    cam(ctx, 1 + 0.05 * k, 480, 270, jx * 2, jy * 2);
    const tilt = -0.06 - 0.32 * k + Math.sin(t * 1.9) * 0.015;
    const shx = 330 + 60 * k, shy = 318 - 40 * k;
    const eng = fract(t * 1.7) < 0.15 ? 0.2 : 0.8;
    drawShip(ctx, shx, shy, 0.6, tilt, t, { engine: eng });
    // hull stress sparks + alarm beacons
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.translate(shx, shy); ctx.rotate(tilt); ctx.scale(0.6, 0.6); ctx.translate(-500, -140);
    const alarm = 0.5 + 0.5 * Math.sin(t * TAU * 0.9);
    for (const [x, y] of [[240, 128], [470, 100], [700, 30], [860, 112], [420, 200]]) glow(ctx, x, y, 26, C.red, 0.55 * alarm);
    for (let i = 0; i < 6; i++) {
      const tt = t * 1.3 + i * 0.37, cyc = Math.floor(tt), age = fract(tt);
      if (age > 0.25) continue;
      const x = 220 + hash(cyc, i) * 600, y = 120 + hash(cyc, i + 9) * 40;
      glow(ctx, x, y, 30 * (1 - age * 4), C.warm, 0.9 * (1 - age * 4));
      for (let s = 0; s < 5; s++) {
        const a = hash(cyc * 7 + s, i) * TAU, d = age * 300;
        glow(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, 3, C.gold, 1 - age * 4);
      }
    }
    ctx.restore();
    ctx.restore();
    // red alarm grade
    const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * TAU * 0.9), 2);
    ctx.fillStyle = `rgba(150,8,16,${0.08 + 0.12 * pulse})`; ctx.fillRect(0, 0, DW, DH);
    vignette(ctx, 0.55 + 0.35 * pulse, [90, 0, 6]);
    vignette(ctx, 0.5);
    grain(ctx, t, 0.4);
  }
  /** Infalling star-streaks along a tilted disk (lifecycle-based so any t is safe). */
  function drawSwirl(ctx, t, AX, AY) {
    const N = 300, PER = 11, RMAX = 560, RMIN = 52, tilt = -0.18, flat = 0.5;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const buckets = [[], [], [], []];
    for (let i = 0; i < N; i++) {
      const life = fract(t / (PER * (0.7 + 0.6 * hash(i, 3))) + hash(i, 1));
      const cyc = Math.floor(t / (PER * (0.7 + 0.6 * hash(i, 3))) + hash(i, 1));
      const r = lerp(RMAX * (0.55 + 0.45 * hash(i, 4)), RMIN, Math.pow(life, 1.6));
      const th = hash(i, 2) * TAU + cyc * 2.1 + 9 * Math.pow(life, 3) + 1.2 * life;
      const om = 0.5 + 27 * life * life; // angular rate grows as it falls in
      const len = Math.min(1.4, om * 0.035 + 0.02);
      const a = sstep(0, 0.12, life) * (1 - sstep(0.9, 1, life));
      const b = Math.min(3, (a * (0.35 + 0.65 * hash(i, 5)) * 4) | 0);
      buckets[b].push([r, th, len]);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const cols = [[150, 170, 255], [190, 200, 255], [230, 220, 255], [255, 230, 220]];
    buckets.forEach((list, b) => {
      ctx.strokeStyle = rgba(cols[b], 0.12 + b * 0.18); ctx.lineWidth = 0.8 + b * 0.35;
      ctx.beginPath();
      for (const [r, th, len] of list) {
        const x0 = Math.cos(th - len) * r, y0 = Math.sin(th - len) * r * flat;
        ctx.moveTo(AX + x0 * ct - y0 * st, AY + x0 * st + y0 * ct);
        ctx.ellipse(AX, AY, r, r * flat, tilt, th - len, th);
      }
      ctx.stroke();
    });
    ctx.restore();
  }
  function drawDebris(ctx, t, AX, AY) {
    for (let i = 0; i < 16; i++) {
      const per = 9 + hash(i, 40) * 6;
      const life = fract(t / per + hash(i, 41));
      const r = lerp(520, 60, Math.pow(life, 1.4));
      const th = hash(i, 42) * TAU + 6 * Math.pow(life, 2.5);
      const x = AX + Math.cos(th) * r, y = AY + Math.sin(th) * r * 0.5;
      const sz = (3 + hash(i, 43) * 7) * (1 - life * 0.6);
      const a = sstep(0, 0.1, life) * (1 - sstep(0.85, 1, life));
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1 + hash(i, 44) * 3) + i);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#2a2e3a';
      ctx.beginPath(); ctx.moveTo(-sz, -sz * 0.4); ctx.lineTo(sz * 0.6, -sz * 0.7); ctx.lineTo(sz, sz * 0.3); ctx.lineTo(-sz * 0.3, sz * 0.6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(200,190,255,0.7)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-sz, -sz * 0.4); ctx.lineTo(sz * 0.6, -sz * 0.7); ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** Close planet limb seen from orbit (cached; used by pod_launch). */
  function limbLayer() {
    return layer('limb', DW, DH, (g) => {
      const cx = 520, cy = 1540, R = 1180;
      g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
      sphereMap(g, planetTex(), cx, cy, R, 0.12, 90);
      g.globalAlpha = 0.9; sphereMap(g, cloudTex(), cx, cy, R, 0.31, 90); g.globalAlpha = 1;
      const sh = g.createLinearGradient(0, cy - R, 0, cy - R + 260);
      sh.addColorStop(0, 'rgba(60,20,30,0)'); sh.addColorStop(1, 'rgba(10,4,12,0.75)');
      g.fillStyle = sh; g.fillRect(0, cy - R, DW, 400);
      const side = g.createLinearGradient(0, 0, DW, 0);
      side.addColorStop(0, 'rgba(6,2,10,0.75)'); side.addColorStop(0.55, 'rgba(6,2,10,0)');
      g.fillStyle = side; g.fillRect(0, 0, DW, DH);
      g.restore();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = rgba(i < 2 ? [255, 220, 180] : [255, 130, 120], [0.75, 0.4, 0.18, 0.1, 0.05, 0.03][i]);
        g.lineWidth = [1.5, 3, 7, 14, 26, 44][i];
        g.beginPath(); g.arc(cx, cy, R + [0, 1, 3, 7, 13, 22][i], -Math.PI * 0.85, -Math.PI * 0.15); g.stroke();
      }
    });
  }

  /** pod_launch — the escape pod blasts away as the hull cracks behind it. */
  function scenePodLaunch(ctx, t) {
    const k = easeInOut(Math.min(t, 12) / 12);
    const boom = [1.6, 3.4, 4.8, 6.6, 8.8];
    let shake = 0;
    for (const b of boom) { const d = t - b; if (d > 0 && d < 0.8) shake += (1 - d / 0.8) * 5; }
    const jx = (hash(Math.floor(t * 40), 11) - 0.5) * shake, jy = (hash(Math.floor(t * 40), 12) - 0.5) * shake;
    cam(ctx, 1 + 0.02 * k, 480, 270, jx * 0.3, jy * 0.3);
    blit(ctx, spaceNebula('pod', 71, [{ x: 200, y: 120, sx: 400, sy: 160, r: 260, c: [60, 30, 120], a: 0.08, n: 10 }]));
    blit(ctx, starLayer('pod-stars', 707, 1200, { pow: 3.2, size: 1.1 }));
    ctx.restore();
    cam(ctx, 1 + 0.04 * k, 480, 400);
    blit(ctx, limbLayer());
    ctx.restore();
    // the ship, cracking
    cam(ctx, 1 + 0.08 * k, 400, 200, jx, jy);
    const crack = sstep(0.3, 5, t);
    const sep = sstep(3.5, 14, t);
    const S = 0.82, R0 = -0.1;
    drawShip(ctx, 380 - 14 * sep, 176 + 6 * sep, S, R0 - 0.025 * sep, t, { part: 'aftcryo', engine: 0.3, crack });
    const fx = 380 + (PART_PIVOT.fore - PART_PIVOT.aftcryo) * S * Math.cos(R0) + 26 * sep;
    const fy = 176 + (PART_PIVOT.fore - PART_PIVOT.aftcryo) * S * Math.sin(R0) - 8 * sep;
    drawShip(ctx, fx, fy, S, R0 + 0.06 * sep, t, { part: 'fore', crack });
    // explosions
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    boom.forEach((b, i) => {
      const d = t - b;
      if (d < 0 || d > 3) return;
      const lx = [338, 610, 470, 620, 330][i], ly = [140, 120, 170, 160, 110][i];
      const x = 380 + (lx - PART_PIVOT.aftcryo) * S * Math.cos(R0) - (ly - 140) * S * Math.sin(R0);
      const y = 176 + (lx - PART_PIVOT.aftcryo) * S * Math.sin(R0) + (ly - 140) * S * Math.cos(R0);
      const f = Math.exp(-d * 2.4);
      glow(ctx, x, y, 40 + d * 90, C.fire, 0.9 * f);
      glow(ctx, x, y, 18 + d * 30, C.white, f);
      for (let p = 0; p < 14; p++) {
        const a = hash(i * 31 + p, 3) * TAU, v = 40 + hash(i * 31 + p, 4) * 120;
        glow(ctx, x + Math.cos(a) * v * d, y + Math.sin(a) * v * d, 3.5, C.gold, f * 1.2);
      }
    });
    ctx.restore();
    ctx.restore();
    // the pod: ejected at 1.0 s, arcs toward camera (lower right)
    const tp = t - 1.0;
    const bayX = 380 + (520 - PART_PIVOT.aftcryo) * S, bayY = 176 + 52 * S;
    if (tp > -0.4) {
      const p = settle(Math.max(0, tp), 2.6);
      const x = bayX + p * 330 + Math.sin(t * 0.7) * 4, y = bayY + p * 160 + Math.sin(t * 0.9) * 3;
      const s = 0.5 + 1.6 * p;
      const rot = 0.48 + Math.PI;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      // exhaust trail back to the bay
      for (let i = 0; i < 20; i++) {
        const u = i / 20, tx = lerp(x, bayX, u), ty = lerp(y, bayY, u);
        glow(ctx, tx, ty, 6 + 22 * u, C.blue, 0.22 * (1 - u) * sstep(0, 0.3, tp));
      }
      if (tp < 0.6 && tp > -0.2) glow(ctx, bayX, bayY, 90, C.white, 0.8 * (1 - Math.abs(tp - 0.1) / 0.5));
      ctx.restore();
      if (tp > 0) drawPod(ctx, x, y, s * 1.2, rot, t, { thrust: 1 });
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glow(ctx, x - Math.cos(rot) * 24 * s, y - Math.sin(rot) * 24 * s, 50 * s, C.plasma, 0.25 * sstep(0, 0.3, tp));
      ctx.restore();
    }
    // debris + sparks drifting past camera
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i++) {
      const life = fract(t * (0.08 + hash(i, 61) * 0.1) + hash(i, 62));
      const x = 380 + (hash(i, 63) - 0.3) * 400 + life * (hash(i, 64) - 0.2) * 900;
      const y = 180 + (hash(i, 65) - 0.5) * 80 + life * (hash(i, 66) - 0.3) * 600;
      glow(ctx, x, y, 2 + life * 5, i % 3 ? C.gold : C.fire, 0.8 * (1 - life) * sstep(1.4, 2.4, t));
    }
    ctx.restore();
    vignette(ctx, 0.7);
    grain(ctx, t, 0.35);
  }

  /** ship_breakup — the hull splits in the upper atmosphere; cryo section falls alone. */
  function sceneBreakup(ctx, t) {
    const k = easeInOut(Math.min(t, 14) / 14);
    const jx = (hash(Math.floor(t * 30), 21) - 0.5) * 2.5, jy = (hash(Math.floor(t * 30), 22) - 0.5) * 2.5;
    cam(ctx, 1 + 0.03 * k, 480, 300);
    blit(ctx, layer('breakup-sky', DW, DH, (g) => {
      vfill(g, 0, DH, [[0, [6, 6, 20]], [0.3, [40, 22, 56]], [0.55, [140, 60, 70]], [0.74, [236, 140, 80]], [0.8, [252, 206, 150]], [1, [180, 110, 80]]]);
      paintStars(g, DW, 200, 818, 300, { pow: 3, size: 1, alpha: 0.6 });
      // curved horizon glow band
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = rgba([255, 200, 150], [0.3, 0.16, 0.08, 0.04, 0.02][i]); g.lineWidth = [2, 6, 14, 30, 60][i];
        g.beginPath(); g.ellipse(480, 2400, 2600, 2000, 0, Math.PI * 1.3, Math.PI * 1.7); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      g.beginPath(); g.ellipse(480, 2400, 2600, 2000, 0, 0, TAU); g.save(); g.clip();
      vfill(g, 400, DH, [[0, [214, 150, 110]], [1, [120, 70, 70]]]);
      g.restore();
    }, 0.75));
    // cloud deck
    for (let i = 0; i < 9; i++) {
      const img = cloudImg('deck' + (i % 3), 460, 120, 900 + (i % 3), [255, 222, 186], [150, 86, 86], 60, true);
      const x = fract(hash(i, 90) + t * 0.004 * (1 + (i % 3))) * 1400 - 300;
      ctx.globalAlpha = 0.85; ctx.drawImage(img, x, 380 + (i % 3) * 30 + hash(i, 91) * 20, 460 + (i % 3) * 60, 120);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // pieces
    cam(ctx, 1 + 0.1 * k, 480, 230, jx, jy);
    const u = settle(t, 7);
    const pieces = [
      { part: 'aft', x: 330 - 150 * u, y: 180 + 70 * u, r: -0.3 - 0.45 * u, len: 300, w: 22, seed: 1 },
      { part: 'fore', x: 640 + 110 * u, y: 150 + 30 * u, r: -0.25 + 0.4 * u, len: 260, w: 20, seed: 2 },
      { part: 'cryo', x: 480 - 20 * u, y: 210 + 150 * u, r: -0.2 + 0.25 * u, len: 360, w: 26, seed: 3 },
    ];
    const dx = 0.5, dy = -0.866;
    for (const p of pieces) {
      ctx.save();
      fireTrail(ctx, p.x - 30, p.y + 30, dx, dy, p.len, p.w, t, p.seed, 0.9);
      ctx.restore();
      drawShip(ctx, p.x, p.y, 0.48, p.r, t, { part: p.part, heat: 1, crack: 1, lights: p.part === 'cryo', engine: 0 });
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glowE(ctx, p.x - 40, p.y + 34, 110, 26, -0.5, C.warm, 0.45 + 0.1 * Math.sin(t * 20 + p.seed));
      glowE(ctx, p.x - 30, p.y + 30, 160, 60, -0.5, C.orange, 0.3);
      ctx.restore();
    }
    // embers + small fragments shedding off
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 50; i++) {
      const p = pieces[i % 3];
      const life = fract(t * (0.25 + hash(i, 71) * 0.4) + hash(i, 72));
      const x = p.x + (hash(i, 73) - 0.5) * 80 + life * 340 * dx + (hash(i, 74) - 0.5) * 60 * life;
      const y = p.y + (hash(i, 75) - 0.5) * 40 + life * 340 * dy;
      glow(ctx, x, y, 2 + 3 * (1 - life), life < 0.3 ? C.warm : C.fire, (1 - life) * 0.9);
    }
    ctx.restore();
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 900, 420, 500, [255, 160, 100], 0.15);
    ctx.restore();
    vignette(ctx, 0.75);
    grain(ctx, t, 0.35);
  }

  /** Tessera's daytime sky with ring arch, moons, horizon (cached; used by descent). */
  function daySky() {
    return layer('day-sky', DW, DH, (g) => {
      vfill(g, 0, DH, [[0, [58, 26, 58]], [0.22, [130, 60, 78]], [0.48, [216, 120, 86]], [0.7, [246, 182, 118]], [0.76, [252, 218, 168]], [1, [200, 140, 96]]]);
      g.globalCompositeOperation = 'lighter';
      const sg = g.createRadialGradient(180, 300, 0, 180, 300, 520);
      sg.addColorStop(0, 'rgba(255,230,190,0.55)'); sg.addColorStop(0.3, 'rgba(255,190,130,0.2)'); sg.addColorStop(1, 'rgba(255,160,100,0)');
      g.fillStyle = sg; g.fillRect(0, 0, DW, DH);
      g.globalCompositeOperation = 'source-over';
      paintSkyRing(g, 600, 940, 1060, 860, -0.18, Math.PI * 1.04, Math.PI * 1.96, 46, [255, 236, 220], 0.38);
      // the ring's shadowed segment
      g.strokeStyle = 'rgba(80,30,50,0.25)'; g.lineWidth = 50;
      g.beginPath(); g.ellipse(600, 940, 1060, 860, -0.18, Math.PI * 1.62, Math.PI * 1.78); g.stroke();
    }, 0.75);
  }
  function dayGround() {
    return layer('day-ground', DW, DH, (g) => {
      paintMesas(g, 396, 41, [180, 112, 100], 18);
      paintHaze(g, 360, 420, [252, 214, 170], 0.5);
      paintDunes(g, DW, DH, { y: 430, amp: 18, seed: 3, top: [214, 146, 98], bottom: [170, 100, 80], rim: [255, 230, 190], rimA: 0.5, freq: 1.8 });
      paintHaze(g, 410, 470, [250, 206, 160], 0.45);
      paintDunes(g, DW, DH, { y: 488, amp: 30, seed: 4, top: [196, 124, 84], bottom: [120, 66, 60], rim: [255, 220, 170], rimA: 0.5, shade: [90, 40, 50], shadeA: 0.25, freq: 1.2 });
    }, 0.75);
  }

  /** descent — the pod falls through Tessera's amber sky; clouds rush past. */
  function sceneDescent(ctx, t) {
    const k = easeInOut(Math.min(t, 16) / 16);
    const bx = Math.sin(t * 7.1) * 1.6 + Math.sin(t * 13.7) * 0.9, by = Math.cos(t * 8.3) * 1.6;
    cam(ctx, 1 + 0.03 * k, 480, 380, bx * 0.3, -14 * k, Math.sin(t * 0.4) * 0.01);
    blit(ctx, daySky());
    drawMoon(ctx, moonImg('dm1', 44, norm3([-0.75, 0.15, 0.6]), [250, 232, 220], 3.1), 772, 128, C.white, 0.18);
    drawMoon(ctx, moonImg('dm2', 13, norm3([-0.7, 0.1, 0.7]), [236, 220, 240], 7.7), 640, 70, C.white, 0.1);
    drawSpire(ctx, 680, 398, 92, 'rgba(110,60,80,0.72)', null, t, 0.7 + 0.3 * Math.sin(t * 2.2), C.cyan);
    blit(ctx, dayGround());
    ctx.restore();
    // far clouds below drifting up slowly
    for (let i = 0; i < 6; i++) {
      const img = cloudImg('dfar' + (i % 3), 300, 90, 300 + (i % 3), [255, 236, 214], [206, 132, 112], 46, true);
      const y = DH + 60 - fract(hash(i, 1) + t * 0.035) * (DH + 200);
      const x = hash(i, 2) * 1000 - 120;
      ctx.globalAlpha = 0.6 * sstep(-60, 80, y) * (1 - sstep(300, 420, y) * 0.5);
      ctx.drawImage(img, x, y, 300, 90);
    }
    ctx.globalAlpha = 1;
    // speed streaks
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(255,240,220,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const x = hash(i, 30) * DW, y = DH + 100 - fract(hash(i, 31) + t * (1.2 + hash(i, 32))) * (DH + 300);
      ctx.moveTo(x, y); ctx.lineTo(x + 6, y + 70 + hash(i, 33) * 80);
    }
    ctx.stroke(); ctx.restore();
    // the pod
    const px = 470 + Math.sin(t * 0.6) * 10 + bx, py = 200 + Math.sin(t * 0.5) * 6 + by;
    const rot = 1.95 + Math.sin(t * 3.1) * 0.05;
    const mx = Math.cos(rot), my = Math.sin(rot);
    ctx.save();
    fireTrail(ctx, px + mx * 14, py + my * 14, -mx, -my, 300, 24, t, 4, 0.95);
    ctx.restore();
    drawPod(ctx, px, py, 1.6, rot, t, { heat: 1, burnt: true });
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; // bow shock
    ctx.strokeStyle = 'rgba(255,230,190,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(px + mx * 30, py + my * 30, 22, 44, rot, -1.2, 1.2); ctx.stroke();
    glowE(ctx, px + mx * 34, py + my * 34, 30, 60, rot, C.warm, 0.5);
    ctx.restore();
    // near clouds sweeping past the lens
    for (let i = 0; i < 4; i++) {
      const img = cloudImg('dnear' + (i % 2), 520, 200, 410 + (i % 2), [255, 240, 225], [214, 150, 130], 70, false);
      const y = DH + 260 - fract(hash(i, 51) + t * 0.12) * (DH + 520);
      const x = hash(i, 52) * 900 - 280;
      ctx.globalAlpha = 0.5 * Math.sin(Math.PI * clamp01((y + 260) / (DH + 520)));
      ctx.drawImage(img, x, y, 760, 290);
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(ctx, 160, 280, 420, [255, 210, 160], 0.14);
    ctx.restore();
    vignette(ctx, 0.6, [60, 20, 30]);
    grain(ctx, t, 0.3);
  }

  /** Dusk desert used by crash (cached). */
  function duskBack() {
    return layer('dusk-back', DW, DH, (g) => {
      vfill(g, 0, DH, [[0, [26, 14, 40]], [0.3, [84, 36, 66]], [0.55, [196, 92, 74]], [0.66, [246, 162, 96]], [0.7, [255, 206, 150]], [1, [120, 60, 50]]]);
      g.globalCompositeOperation = 'lighter';
      const sg = g.createRadialGradient(800, 372, 0, 800, 372, 460);
      sg.addColorStop(0, 'rgba(255,230,180,0.9)'); sg.addColorStop(0.08, 'rgba(255,190,120,0.45)'); sg.addColorStop(0.4, 'rgba(255,120,80,0.12)'); sg.addColorStop(1, 'rgba(255,100,60,0)');
      g.fillStyle = sg; g.fillRect(0, 0, DW, DH);
      g.globalCompositeOperation = 'source-over';
      paintStars(g, DW, 160, 919, 160, { pow: 3, size: 1, alpha: 0.5 });
      paintSkyRing(g, 380, 1000, 1100, 900, 0.14, Math.PI * 1.05, Math.PI * 1.95, 40, [255, 220, 210], 0.28);
      paintMesas(g, 372, 52, [120, 56, 70], 26);
      paintHaze(g, 340, 400, [255, 190, 140], 0.45);
      paintDunes(g, DW, DH, { y: 392, amp: 22, seed: 7, top: [170, 86, 70], bottom: [120, 56, 56], rim: [255, 200, 150], rimA: 0.7, sunRight: true, freq: 1.4 });
      paintHaze(g, 380, 420, [255, 180, 130], 0.3);
      paintDunes(g, DW, DH, { y: 420, amp: 40, seed: 8, top: [140, 64, 58], bottom: [70, 32, 40], rim: [255, 190, 130], rimA: 0.8, shade: [40, 14, 30], shadeA: 0.35, sunRight: true, freq: 1 });
    }, 0.75);
  }
  function duskFront() {
    return layer('dusk-front', DW, DH, (g) => {
      paintDunes(g, DW, DH, { y: 520, amp: 60, seed: 9, top: [86, 36, 40], bottom: [30, 12, 22], rim: [255, 170, 110], rimA: 0.75, rimW: 2, shade: [20, 6, 16], shadeA: 0.4, sunRight: true, freq: 0.8 });
    }, 0.75);
  }
  function dustSprite(i) {
    return cloudImg('dust' + i, 220, 160, 1200 + i, [238, 186, 132], [110, 62, 52], 50, false);
  }

  /** crash — impact, a dust explosion, then the burning pod as dusk falls. */
  function sceneCrash(ctx, t) {
    const IX = 470, IY = 386, T0 = 0.35;
    const ti = t - T0;
    let shake = ti > 0 ? Math.exp(-ti * 2.2) * 12 : 0;
    const jx = (hash(Math.floor(t * 40), 31) - 0.5) * shake, jy = (hash(Math.floor(t * 40), 32) - 0.5) * shake;
    const k = easeInOut(Math.min(t, 16) / 16);
    cam(ctx, 1.06 - 0.05 * k, 480, 360, jx, jy);
    blit(ctx, duskBack());
    drawMoon(ctx, moonImg('cm1', 30, norm3([0.8, 0.1, 0.55]), [250, 220, 210], 3.1), 196, 112, C.rose, 0.1);
    drawMoon(ctx, moonImg('cm2', 9, norm3([0.8, 0.1, 0.55]), [230, 210, 240], 7.7), 300, 70, null, 0);
    drawSpire(ctx, 186, 372, 70, 'rgba(70,30,52,0.8)', null, t, 0.5 + 0.5 * Math.sin(t * 2.2), C.cyan);
    // incoming streak
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    if (t < T0 + 0.1) {
      const p = clamp01(t / T0);
      const sx = lerp(80, IX, p), sy = lerp(40, IY - 6, p);
      for (let i = 0; i < 14; i++) { const u = i / 14; glow(ctx, lerp(sx, 80, u * 0.6), lerp(sy, 40, u * 0.6), 20 * (1 - u) + 4, u < 0.2 ? C.warm : C.orange, 0.6 * (1 - u)); }
      glow(ctx, sx, sy, 40, C.white, 0.9);
    }
    ctx.restore();
    // shockwave along the ground
    if (ti > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const sw = easeOut(ti / 1.4), rx = 30 + sw * 640;
      ctx.strokeStyle = rgba([255, 220, 180], 0.5 * (1 - sw)); ctx.lineWidth = 3 + 10 * (1 - sw);
      ctx.beginPath(); ctx.ellipse(IX, IY + 4, rx, rx * 0.1, 0, Math.PI, TAU); ctx.stroke();
      ctx.restore();
    }
    // the burning pod (revealed as the dust thins)
    if (ti > 0) {
      drawPod(ctx, IX + 6, IY - 4, 1.05, -0.5 + Math.PI, t, { burnt: true });
      ctx.save(); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(60,24,26,0.95)';
      ctx.beginPath(); ctx.ellipse(IX + 4, IY + 6, 46, 9, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    blit(ctx, duskFront());
    // dust explosion: billowing puffs that expand, then settle and drift with the wind
    if (ti > 0) {
      const settleK = sstep(1.5, 8, ti), fadeK = 1 - 0.75 * sstep(3, 14, ti);
      for (let i = 0; i < 30; i++) {
        const a = Math.PI + 0.12 + hash(i, 101) * (Math.PI - 0.24);
        const reach = (60 + hash(i, 102) * 220) * (0.6 + 0.6 * Math.abs(Math.cos(a)));
        const ex = easeOut(ti / (1.1 + hash(i, 103)));
        const x = IX + Math.cos(a) * reach * ex + ti * 9 * settleK;
        const y = IY + Math.sin(a) * reach * ex * 0.55 - ti * 4 * settleK + 10;
        const sz = (50 + hash(i, 104) * 90) * (0.35 + 0.9 * ex + 0.06 * ti);
        ctx.globalAlpha = 0.9 * fadeK * (0.75 + 0.25 * hash(i, 105));
        ctx.drawImage(dustSprite(i % 3), x - sz, y - sz * 0.7, sz * 2, sz * 1.45);
      }
      ctx.globalAlpha = 1;
    }
    // flying debris (ballistic, settles on the sand)
    if (ti > 0) {
      ctx.save();
      for (let i = 0; i < 26; i++) {
        const vx = (hash(i, 111) - 0.5) * 520, vy = -(160 + hash(i, 112) * 360);
        const tt = Math.min(ti, (-2 * vy) / 700 + 0.2);
        const x = IX + vx * tt, y = Math.min(IY + 30 * hash(i, 113), IY + vy * tt + 350 * tt * tt);
        const hot = i % 3 === 0;
        if (hot) { ctx.globalCompositeOperation = 'lighter'; glow(ctx, x, y, 6, C.fire, Math.max(0, 1 - ti * 0.3)); ctx.globalCompositeOperation = 'source-over'; }
        ctx.globalAlpha = 1; ctx.fillStyle = '#2a1a18'; ctx.fillRect(x - 1.5, y - 1.5, 3 + hash(i, 114) * 3, 2.5);
      }
      ctx.restore();
    }
    ctx.restore();
    // dusk falls — the fire stays bright
    ctx.fillStyle = `rgba(6,3,12,${0.62 * sstep(4, 16, t)})`; ctx.fillRect(0, 0, DW, DH);
    cam(ctx, 1.06 - 0.05 * k, 480, 360, jx, jy);
    if (ti > 0) drawPodFire(ctx, t, ti, IX, IY);
    ctx.restore();
    // impact flash
    if (ti > 0 && ti < 1) { ctx.fillStyle = `rgba(255,236,210,${0.9 * Math.exp(-ti * 5)})`; ctx.fillRect(0, 0, DW, DH); }
    vignette(ctx, 0.75);
    grain(ctx, t, 0.35);
  }
  function drawPodFire(ctx, t, ti, IX, IY) {
    const vis = sstep(0.8, 2.6, ti);
    // smoke column bending with the wind
    for (let i = 0; i < 18; i++) {
      const age = fract(t * 0.16 + i / 18);
      const x = IX + 10 + age * age * 210 + Math.sin(t * 0.8 + i) * 8, y = IY - 10 - age * 280;
      puff(ctx, x, y, 14 + age * 70, [36, 26, 30], 0.42 * Math.sin(Math.PI * age) * vis);
    }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const fl = 0.8 + 0.2 * Math.sin(t * 19) * Math.sin(t * 7.3);
    glow(ctx, IX + 8, IY - 8, 140, C.orange, 0.35 * vis * fl);
    glow(ctx, IX + 8, IY - 6, 50, C.fire, 0.6 * vis * fl);
    // flame tongues
    for (let i = 0; i < 9; i++) {
      const age = fract(t * 1.6 + hash(i, 121));
      const x = IX - 14 + hash(i, 122) * 40 + age * 10, y = IY - 4 - age * 46;
      glow(ctx, x, y, 14 * (1 - age) + 4, age < 0.3 ? C.warm : C.fire, 0.7 * (1 - age) * vis);
    }
    // embers
    for (let i = 0; i < 22; i++) {
      const age = fract(t * (0.25 + hash(i, 131) * 0.3) + hash(i, 132));
      const x = IX + (hash(i, 133) - 0.5) * 40 + age * 120 + Math.sin(t * 2 + i) * 8, y = IY - 10 - age * 200;
      glow(ctx, x, y, 2.2, C.gold, (1 - age) * vis);
    }
    ctx.restore();
  }

  /** beacon_on — the Spire fires a colossal column of light; storm clouds part. */
  function sceneBeacon(ctx, t) {
    const TX = 480, TY = 252;
    const fire = sstep(0.3, 1.6, t);
    const open = easeOut((t - 1) / 10);
    const k = easeInOut(Math.min(t, 16) / 16);
    let shake = 0; if (t > 0.3 && t < 2) shake = (1 - (t - 0.3) / 1.7) * 6;
    const jx = (hash(Math.floor(t * 40), 41) - 0.5) * shake, jy = (hash(Math.floor(t * 40), 42) - 0.5) * shake;
    cam(ctx, 1.08 - 0.08 * k, TX, 300, jx, jy);
    blit(ctx, layer('beacon-sky', DW, DH, (g) => {
      vfill(g, 0, DH, [[0, [4, 6, 16]], [0.5, [14, 16, 36]], [0.8, [30, 26, 50]], [1, [10, 8, 18]]]);
      paintNebula(g, 81, [{ x: 480, y: 120, sx: 400, sy: 120, r: 220, c: [40, 60, 130], a: 0.08, n: 10 }]);
      paintStars(g, DW, 330, 828, 700, { pow: 3, size: 1.3 });
    }));
    // storm cloud banks parting around the beam
    const cl = [[0, -1], [1, 1], [2, -1], [3, 1]];
    for (const [i, s] of cl) {
      const img = cloudImg('storm' + i, 620, 220, 1500 + i, [70, 70, 100], [12, 12, 24], 80, false);
      const off = s * (40 + 380 * open) * (i < 2 ? 1 : 0.7);
      const x = (s < 0 ? -120 : 460) + off + Math.sin(t * 0.2 + i) * 6;
      const y = 30 + (i >> 1) * 70;
      ctx.globalAlpha = 0.95; ctx.drawImage(img, x, y, 680, 240);
    }
    ctx.globalAlpha = 1;
    // beam-lit cloud undersides
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glowE(ctx, TX, 230, 420, 120, 0, [120, 220, 255], 0.3 * fire);
    glowE(ctx, TX, 140, 260, 60, 0, C.beam, 0.25 * fire);
    // lightning in the storm
    const lc = Math.floor(t / 2.9), lt = fract(t / 2.9) * 2.9;
    if (lt < 0.18 && hash(lc, 5) > 0.25) {
      const lx = 120 + hash(lc, 6) * 720, f = (1 - lt / 0.18) * (Math.floor(lt * 40) % 2 ? 0.6 : 1);
      glow(ctx, lx, 120, 240, [190, 170, 255], 0.35 * f);
      ctx.strokeStyle = rgba([235, 225, 255], 0.9 * f); ctx.lineWidth = 1.6; ctx.beginPath();
      let bx = lx, by = 90; ctx.moveTo(bx, by);
      for (let s = 0; s < 9; s++) { bx += (hash(lc, 20 + s) - 0.5) * 50; by += 12 + hash(lc, 40 + s) * 14; ctx.lineTo(bx, by); }
      ctx.stroke();
    }
    ctx.restore();
    // ground
    blit(ctx, layer('beacon-ground', DW, DH, (g) => {
      paintMesas(g, 420, 61, [16, 14, 30], 20);
      paintDunes(g, DW, DH, { y: 448, amp: 26, seed: 12, top: [26, 26, 46], bottom: [10, 10, 20], rim: [120, 220, 255], rimA: 0.35, freq: 1.2 });
      paintDunes(g, DW, DH, { y: 520, amp: 50, seed: 13, top: [18, 18, 34], bottom: [6, 6, 12], rim: [120, 220, 255], rimA: 0.25, freq: 0.9 });
    }));
    drawSpire(ctx, TX, 470, 470 - TY, '#05060c', 'rgba(126,249,255,0.25)', t, 0.6 + 0.4 * fire, C.cyan);
    // the column of light
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const top = lerp(TY, -80, easeOut((t - 0.3) / 1.1));
    if (t > 0.3) {
      const h = TY - top, fl = 0.92 + 0.08 * Math.sin(t * 31) * Math.sin(t * 13);
      const g1 = ctx.createLinearGradient(0, top, 0, TY);
      g1.addColorStop(0, rgba(C.beam, 0)); g1.addColorStop(0.15, rgba(C.beam, 0.6 * fl)); g1.addColorStop(1, rgba(C.white, fl));
      ctx.fillStyle = g1; ctx.fillRect(TX - 3, top, 6, h);
      const g2 = ctx.createLinearGradient(TX - 40, 0, TX + 40, 0);
      g2.addColorStop(0, rgba(C.cyan, 0)); g2.addColorStop(0.5, rgba(C.cyan, 0.4 * fl * fire)); g2.addColorStop(1, rgba(C.cyan, 0));
      ctx.fillStyle = g2; ctx.fillRect(TX - 40, top, 80, h);
      const g3 = ctx.createLinearGradient(TX - 140, 0, TX + 140, 0);
      g3.addColorStop(0, rgba(C.cyan, 0)); g3.addColorStop(0.5, rgba([90, 200, 255], 0.16 * fire)); g3.addColorStop(1, rgba(C.cyan, 0));
      ctx.fillStyle = g3; ctx.fillRect(TX - 140, top, 280, h);
      // energy knots racing upward
      for (let i = 0; i < 8; i++) { const y = TY - fract(t * 0.9 + i / 8) * (TY + 60); if (y > top) glowE(ctx, TX, y, 10, 26, 0, C.white, 0.5); }
    }
    glow(ctx, TX, TY, 60 + 50 * fire, C.cyan, 0.5 + 0.4 * fire);
    glow(ctx, TX, TY, 20, C.white, 0.6 + 0.4 * fire);
    glowE(ctx, TX, TY, 300, 6, 0, C.beam, 0.5 * fire);
    // shockwave rings
    for (let c = 0; c < 3; c++) {
      const age = fract((t - 0.4) / 2.4 + c / 3) * 2.4;
      if (t < 0.4 + (c * 2.4) / 3) continue;
      const rx = 20 + Math.pow(age / 2.4, 0.7) * 820, a = Math.pow(1 - age / 2.4, 2);
      ctx.strokeStyle = rgba(C.beam, 0.55 * a); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(TX, TY, rx, rx * 0.16, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(C.cyan, 0.12 * a); ctx.lineWidth = 16; ctx.stroke();
      ctx.strokeStyle = rgba(C.cyan, 0.25 * a); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(TX, 150, rx * 0.9, rx * 0.1, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // wind-blown sand
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = 'rgba(150,220,255,0.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < 40; i++) {
      const x = fract(hash(i, 141) + t * (0.3 + hash(i, 142) * 0.3)) * 1100 - 70, y = 380 + hash(i, 143) * 160;
      ctx.moveTo(x, y); ctx.lineTo(x - 30, y + 3);
    }
    ctx.stroke(); ctx.restore();
    ctx.restore();
    // initial flash
    if (t > 0.3 && t < 1.5) { ctx.fillStyle = `rgba(210,250,255,${0.6 * Math.exp(-(t - 0.3) * 4)})`; ctx.fillRect(0, 0, DW, DH); }
    vignette(ctx, 0.75);
    grain(ctx, t, 0.35);
  }

  /** voice — near-black; a violet glitch silhouette of a woman with short hair forms from static. */
  function silhouetteImg() {
    return layer('voice-sil', 420, 440, (g) => {
      const head = () => {
        g.beginPath();
        // shoulders + neck
        g.moveTo(10, 440); g.bezierCurveTo(30, 360, 120, 340, 170, 322); g.lineTo(178, 286);
        // jaw / face side
        g.bezierCurveTo(160, 270, 150, 240, 148, 214);
        // short bob hair (left) + fringe + crown
        g.bezierCurveTo(130, 220, 122, 190, 128, 150); g.bezierCurveTo(132, 90, 170, 58, 214, 58);
        g.bezierCurveTo(262, 58, 296, 92, 298, 146); g.bezierCurveTo(302, 196, 292, 224, 276, 222);
        g.bezierCurveTo(272, 248, 262, 272, 244, 286); g.lineTo(250, 322);
        g.bezierCurveTo(300, 340, 390, 360, 410, 440); g.closePath();
      };
      head();
      const gr = g.createLinearGradient(0, 60, 0, 440);
      gr.addColorStop(0, '#1b0f2c'); gr.addColorStop(0.5, '#120a20'); gr.addColorStop(1, '#07040d');
      g.fillStyle = gr; g.fill();
      g.save(); head(); g.clip();
      // inner static texture
      const r = G.rng(616);
      for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${150 + r() * 80},${80 + r() * 60},255,${r() * 0.12})`; g.fillRect(r() * 420, r() * 440, 1 + r() * 3, 1); }
      // hair strands
      g.strokeStyle = 'rgba(190,140,255,0.12)'; g.lineWidth = 1;
      for (let i = 0; i < 26; i++) { const x = 140 + r() * 150; g.beginPath(); g.moveTo(x, 70 + r() * 20); g.quadraticCurveTo(x + (r() - 0.5) * 30, 140, x + (r() - 0.5) * 20, 200 + r() * 20); g.stroke(); }
      g.restore();
      // rim light
      head();
      g.strokeStyle = 'rgba(200,150,255,0.85)'; g.lineWidth = 2; g.stroke();
      g.strokeStyle = 'rgba(170,110,255,0.25)'; g.lineWidth = 9; g.stroke();
    }, 1);
  }
  function noiseImg(i) {
    return layer('static' + i, 240, 135, (g, w, h, c) => {
      const id = g.createImageData(c.width, c.height), d = id.data, r = G.rng(700 + i);
      for (let p = 0; p < d.length; p += 4) { const v = r(); const b = v * v * 255; d[p] = b * 0.8; d[p + 1] = b * 0.6; d[p + 2] = b; d[p + 3] = 255; }
      g.putImageData(id, 0, 0);
    }, 1);
  }
  function sceneVoice(ctx, t) {
    ctx.fillStyle = '#030206'; ctx.fillRect(0, 0, DW, DH);
    const f = Math.floor(t * 24);
    // static
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.1 + 0.07 * hash(f, 1) + 0.25 * Math.exp(-t * 1.5);
    ctx.drawImage(noiseImg(f % 4), 0, 0, DW, DH);
    ctx.restore();
    const form = sstep(0.4, 6, t);
    const sil = silhouetteImg();
    const SX = 270, SY = 40;
    const strip = 6, rows = Math.ceil(sil.lh / strip);
    const glitchBurst = fract(t / 2.3) < 0.12 ? 1 : 0;
    ctx.save();
    for (let i = 0; i < rows; i++) {
      const hr = hash(i, f);
      const amp = (1 - form) * 70 + 4 + glitchBurst * 30 * hash(i, f + 3);
      const dx = (hr - 0.5) * amp * (hash(i >> 2, f) > 0.6 ? 1 : 0.25);
      const vis = hash(i, f + 7) < 0.25 + form * 0.8 ? 1 : 0.15;
      const a = vis * (0.15 + 0.85 * form) * (0.85 + 0.15 * Math.sin(t * 3 + i * 0.3));
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      ctx.drawImage(sil, 0, i * strip * (sil.width / sil.lw), sil.width, strip * (sil.width / sil.lw), SX + dx, SY + i * strip, sil.lw, strip);
    }
    // chromatic ghosts
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12 + 0.1 * glitchBurst;
    ctx.drawImage(sil, SX - 5 - glitchBurst * 8, SY, sil.lw, sil.lh);
    ctx.globalAlpha = 0.08;
    ctx.drawImage(sil, SX + 5, SY + 1, sil.lw, sil.lh);
    ctx.restore();
    // eyes — faint, appearing late
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const eyes = sstep(3, 7, t) * (fract(t / 5.3) > 0.97 ? 0.1 : 1);
    glowE(ctx, SX + 186, SY + 168, 10, 3, 0, [200, 160, 255], 0.7 * eyes);
    glowE(ctx, SX + 248, SY + 168, 10, 3, 0, [200, 160, 255], 0.7 * eyes);
    glow(ctx, SX + 217, SY + 200, 220, C.violet, 0.1 * form);
    ctx.restore();
    // the waveform — her voice
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const wy = 330;
    ctx.beginPath();
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const x = (DW * i) / N;
      const env = Math.exp(-Math.pow((x - 480) / 210, 2)) * (0.3 + 0.7 * Math.abs(Math.sin(t * 2.3) * Math.sin(t * 0.9 + 1)));
      const v = Math.sin(x * 0.09 + t * 9) * 0.6 + Math.sin(x * 0.23 - t * 13) * 0.3 + (hash(i, f) - 0.5) * 0.5;
      const y = wy + v * env * 46 * (0.3 + 0.7 * form) + (hash(i >> 3, f) > 0.94 ? (hash(i, f + 1) - 0.5) * 30 : 0);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgba(C.violet, 0.22); ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = rgba([220, 190, 255], 0.9); ctx.lineWidth = 1.4; ctx.stroke();
    glowE(ctx, 480, wy, 340, 26, 0, C.magenta, 0.18);
    ctx.restore();
    // glitch bars
    ctx.save();
    for (let i = 0; i < 5; i++) {
      if (hash(i, f) > 0.35 + glitchBurst * 0.4) continue;
      const y = hash(i, f + 11) * DH, h = 1 + hash(i, f + 12) * 6;
      ctx.fillStyle = i % 2 ? 'rgba(170,110,255,0.25)' : 'rgba(126,249,255,0.12)';
      ctx.fillRect(hash(i, f + 13) * 400, y, 200 + hash(i, f + 14) * 600, h);
    }
    // scanlines
    ctx.globalAlpha = 0.35;
    blit(ctx, layer('scan', DW, DH, (g) => { g.fillStyle = 'rgba(0,0,0,0.6)'; for (let y = 0; y < DH; y += 3) g.fillRect(0, y, DW, 1); }, 1));
    ctx.restore();
    vignette(ctx, 0.9);
  }

  /** Night sky over Tessera (cached): milky band, ring, airglow. */
  function nightSky(key, seed) {
    return layer('night-sky:' + key, DW, DH, (g) => {
      vfill(g, 0, DH, [[0, [2, 3, 10]], [0.55, [10, 12, 30]], [0.75, [34, 24, 52]], [0.82, [60, 36, 60]], [1, [10, 8, 16]]]);
      paintNebula(g, seed, [
        { x: 600, y: 120, sx: 700, sy: 160, r: 170, c: [60, 70, 140], a: 0.07, n: 18 },
        { x: 300, y: 260, sx: 300, sy: 120, r: 160, c: [120, 60, 120], a: 0.05, n: 10 },
      ]);
      paintDustLanes(g, seed + 3, [{ x0: 100, y0: 320, x1: 900, y1: 60, r: 40, a: 0.35, j: 40, n: 22 }]);
      paintStars(g, DW, 440, seed, 2600, { pow: 3.6, size: 1.3, band: { y0: 190, k: -0.3, spread: 70, frac: 0.55 } });
      paintSkyRing(g, 420, 1080, 1120, 960, 0.1, Math.PI * 1.05, Math.PI * 1.95, 40, [200, 210, 240], 0.2);
    });
  }
  function nightGround(key, seed, rim) {
    return layer('night-ground:' + key, DW, DH, (g) => {
      paintMesas(g, 420, seed, [14, 12, 26], 22);
      paintHaze(g, 395, 440, [60, 40, 80], 0.35);
      paintDunes(g, DW, DH, { y: 446, amp: 22, seed: seed + 1, top: [34, 30, 54], bottom: [14, 12, 24], rim: rim, rimA: 0.35, freq: 1.3 });
      paintDunes(g, DW, DH, { y: 528, amp: 56, seed: seed + 2, top: [24, 22, 40], bottom: [6, 6, 12], rim: rim, rimA: 0.3, rimW: 1.8, shade: [4, 4, 10], shadeA: 0.4, freq: 0.8 });
    }, 0.75);
  }

  /** Deterministic wreck layout along three orbital shells. */
  let WRECKS = null;
  function wreckList() {
    if (WRECKS) return WRECKS;
    const r = G.rng(4242), out = [];
    const shells = [
      { cx: 480, cy: 1000, rx: 1100, ry: 900, s0: 0.026, s1: 0.045, n: 24, a: 0.55 },
      { cx: 520, cy: 920, rx: 920, ry: 760, s0: 0.045, s1: 0.075, n: 18, a: 0.8 },
      { cx: 440, cy: 880, rx: 800, ry: 660, s0: 0.075, s1: 0.12, n: 10, a: 1 },
    ];
    shells.forEach((A, si) => {
      const s = (A.cy - 360) / A.ry;
      const p0 = -Math.PI + Math.asin(Math.min(1, s)), p1 = -Math.asin(Math.min(1, s));
      for (let i = 0; i < A.n; i++) {
        const ph = lerp(p0, p1, (i + 0.15 + r() * 0.7) / A.n);
        const x = A.cx + A.rx * Math.cos(ph) + (r() - 0.5) * 50, y = A.cy + A.ry * Math.sin(ph) + (r() - 0.5) * 50;
        if (x < -60 || x > DW + 60 || y > 350) continue;
        const tan = Math.atan2(A.ry * Math.cos(ph), -A.rx * Math.sin(ph));
        const v = r() < 0.25 ? 0 : 1 + ((r() * 3) | 0);
        out.push({ x, y, rot: tan + (r() - 0.5) * 1.4 + (r() < 0.5 ? 0 : Math.PI), s: lerp(A.s0, A.s1, r()), v, a: A.a, flip: r() < 0.4, shell: si, ph: r() * TAU });
      }
    });
    WRECKS = out;
    return out;
  }
  function wreckField() {
    return layer('wreck-field', DW, DH, (g) => {
      g.imageSmoothingQuality = 'high';
      for (const w of wreckList()) {
        g.save(); g.translate(w.x, w.y); g.rotate(w.rot); g.scale(w.s, w.s * (w.flip ? -1 : 1));
        g.globalAlpha = w.a * (w.v ? 0.85 : 1);
        g.drawImage(wreckImg(w.v), -500, -140, SHIP.W, SHIP.H);
        g.restore();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(70,90,150,0.28)'; g.fillRect(0, 0, DW, DH);
      g.globalCompositeOperation = 'source-over';
    }, Math.min(2, res() * 1.35));
  }

  /** wrecks_orbit — the sky clears: dozens of identical «Ковчег-7» wrecks in orbit. */
  function sceneWrecks(ctx, t) {
    const p = easeInOut(Math.min(t, 20) / 20);
    const z = 1.34 - 0.34 * p;
    const fy = lerp(250, 270, p);
    cam(ctx, 1 + (z - 1) * 0.4, 480, fy);
    blit(ctx, nightSky('wrecks', 1313));
    ctx.restore();
    cam(ctx, z, 520, fy);
    blit(ctx, wreckField());
    // glints, nav lights, a fresh one still venting
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    wreckList().forEach((w, i) => {
      if (w.v === 0) {
        const bl = fract(t * 0.7 + w.ph) < 0.08 ? 1 : 0;
        glow(ctx, w.x + Math.cos(w.rot) * 480 * w.s, w.y + Math.sin(w.rot) * 480 * w.s, 4 + w.s * 40, C.red, 0.8 * bl);
        glow(ctx, w.x, w.y, 30 * w.s * 10, C.cyan, 0.05);
      }
      const tw = Math.pow(Math.max(0, Math.sin(t * (0.5 + hash(i, 3) * 0.7) + w.ph)), 24);
      if (tw > 0.02) flare(ctx, w.x + Math.cos(w.rot) * 200 * w.s, w.y + Math.sin(w.rot) * 200 * w.s, 10 + w.s * 90, C.ice, tw * 0.9 * w.a);
    });
    ctx.restore();
    ctx.restore();
    // two big, close wrecks tumbling slowly at the frame edges (scale + parallax)
    cam(ctx, 1 + (z - 1) * 1.4, 480, fy);
    drawShip(ctx, 120 + t * 1.2, 70, 0.34, 0.5 + t * 0.006, t, { img: wreckImg(2), lights: false });
    drawShip(ctx, 880 - t * 0.8, 120, 0.26, -2.6 - t * 0.008, t, { img: wreckImg(3), lights: false });
    ctx.restore();
    // ground, Spire and its (now quieter) beam
    cam(ctx, 1 + (z - 1) * 0.5, 480, 420);
    const BX = 600, BY = 330;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const fl = 0.85 + 0.15 * Math.sin(t * 9);
    const bg = ctx.createLinearGradient(BX - 30, 0, BX + 30, 0);
    bg.addColorStop(0, rgba(C.cyan, 0)); bg.addColorStop(0.5, rgba(C.beam, 0.32 * fl)); bg.addColorStop(1, rgba(C.cyan, 0));
    ctx.fillStyle = bg; ctx.fillRect(BX - 30, -400, 60, BY + 400);
    ctx.fillStyle = rgba(C.white, 0.5 * fl); ctx.fillRect(BX - 1.2, -400, 2.4, BY + 400);
    glow(ctx, BX, BY, 120, C.cyan, 0.35);
    ctx.restore();
    blit(ctx, nightGround('wrecks', 77, [120, 210, 255]));
    drawSpire(ctx, BX, 436, 436 - BY, '#04050a', 'rgba(126,249,255,0.2)', t, 0.9, C.cyan);
    ctx.restore();
    // the clearing: last storm wisps dissolving outward
    const clear = 1 - sstep(0, 6, t);
    if (clear > 0) {
      for (let i = 0; i < 6; i++) {
        const img = cloudImg('storm' + (i % 4), 620, 220, 1500 + (i % 4), [70, 70, 100], [12, 12, 24], 80, false);
        const s = i % 2 ? 1 : -1;
        ctx.globalAlpha = clear * 0.9;
        ctx.drawImage(img, (s < 0 ? -200 : 400) + s * 300 * (1 - clear), -40 + (i >> 1) * 80, 760, 260);
      }
      ctx.globalAlpha = 1;
    }
    vignette(ctx, 0.7);
    grain(ctx, t, 0.3);
  }

  /** credits — calm desert night; ring, moons, the dim Spire, drifting sand. Loops. */
  function sceneCredits(ctx, t) {
    blit(ctx, nightSky('credits', 2424));
    tileX(ctx, starLayer('credits-near', 2525, 90, { pow: 2.2, size: 1.6, wrap: true, alpha: 0.8 }), -t * 1.5);
    drawMoon(ctx, moonImg('nm1', 36, norm3([-0.6, -0.2, 0.75]), [236, 226, 240], 3.1), 210, 120 + Math.sin(t * 0.05) * 6, C.ice, 0.12);
    drawMoon(ctx, moonImg('nm2', 12, norm3([-0.6, -0.2, 0.75]), [240, 210, 200], 7.7), 760, 84, C.rose, 0.08);
    // shooting star
    const sc = Math.floor(t / 11), sp = fract(t / 11) * 11;
    if (sp < 0.9) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const x0 = 200 + hash(sc, 1) * 500, y0 = 40 + hash(sc, 2) * 120, u = sp / 0.9;
      for (let i = 0; i < 10; i++) glow(ctx, x0 + (u - i * 0.02) * 260, y0 + (u - i * 0.02) * 90, 3 - i * 0.2, C.white, (1 - i / 10) * Math.sin(Math.PI * u));
      ctx.restore();
    }
    drawSpire(ctx, 700, 432, 110, 'rgba(14,12,26,0.95)', null, t, 0.35 + 0.15 * Math.sin(t * 1.3), C.cyan);
    blit(ctx, nightGround('credits', 88, [190, 200, 255]));
    // drifting sand ribbons
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(220,200,255,0.07)'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const y = 430 + hash(i, 151) * 110, x = fract(hash(i, 152) + t * (0.02 + hash(i, 153) * 0.03)) * 1300 - 200;
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 60, y - 6 + Math.sin(t + i) * 4, x + 120, y + 4, x + 200, y - 2);
    }
    ctx.stroke();
    for (let i = 0; i < 40; i++) {
      const y = 420 + hash(i, 161) * 120 + Math.sin(t * 1.3 + i) * 4, x = fract(hash(i, 162) + t * (0.03 + hash(i, 163) * 0.05)) * 1000 - 20;
      glow(ctx, x, y, 1.5, C.warm, 0.35);
    }
    ctx.restore();
    vignette(ctx, 0.6);
  }

  /** Fallback for unknown ids: elegant dark gradient with a soft glow. */
  function sceneFallback(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0, '#05060d'); g.addColorStop(0.6, '#0d0b1c'); g.addColorStop(1, '#170d22');
    ctx.fillStyle = g; ctx.fillRect(0, 0, DW, DH);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glowE(ctx, DW / 2, DH * 0.72, 520, 140, 0, [90, 60, 140], 0.25 + 0.05 * Math.sin(t * 0.8));
    ctx.restore();
    vignette(ctx, 0.7);
  }

  const SCENES = {
    title: sceneTitle, space: sceneSpace, signal: sceneSignal, anomaly: sceneAnomaly,
    pod_launch: scenePodLaunch, ship_breakup: sceneBreakup, descent: sceneDescent, crash: sceneCrash,
    beacon_on: sceneBeacon, voice: sceneVoice, wrecks_orbit: sceneWrecks, credits: sceneCredits,
  };
  const failed = {};

  G.Art.Scenes = {
    /** Known scene ids. */
    ids: Object.keys(SCENES),
    /**
     * Draw a full-screen cutscene illustration.
     * @param {CanvasRenderingContext2D} ctx view-space context
     * @param {string} id scene id (unknown → gradient fallback)
     * @param {number} t seconds since the shot started (any value ≥ 0)
     * @param {number} W logical width (960)
     * @param {number} H logical height (540)
     * @param {number} [shotIndex] index of the shot in its cutscene (unused; layouts are per id)
     */
    draw(ctx, id, t, W, H, shotIndex) {
      t = Number.isFinite(t) && t > 0 ? t : 0;
      W = W || DW; H = H || DH;
      const fn = (!failed[id] && SCENES[id]) || sceneFallback;
      ctx.save();
      try {
        if (W !== DW || H !== DH) ctx.scale(W / DW, H / DH);
        ctx.beginPath(); ctx.rect(0, 0, DW, DH); ctx.clip();
        fn(ctx, t, shotIndex | 0);
      } catch (e) {
        if (!failed[id]) { failed[id] = true; console.error('Scene "' + id + '" failed:', e); }
        ctx.restore(); ctx.save();
        try { sceneFallback(ctx, t); } catch (e2) { /* never throw out of a cutscene */ }
      }
      ctx.restore();
    },
    /** Optionally build a scene's caches ahead of time (e.g. during a fade). */
    prewarm(id) {
      const c = document.createElement('canvas'); c.width = 4; c.height = 4;
      try { this.draw(c.getContext('2d'), id, 0, DW, DH, 0); } catch (e) { /* ignore */ }
    },
  };
})();
