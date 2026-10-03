/**
 * TESSERA — cinematic cutscene illustrations (G.Art.Scenes), v2 "key-art" pass.
 *
 * Contract (docs/level-format.md §4, design/game-brief.md, docs/chapter2-spec.md §5):
 *   G.Art.Scenes.draw(ctx, id, t, W, H, shotIndex)
 *     ctx  — 2D context already scaled to the logical view (VIEW space).
 *     id   — scene id; unknown ids draw a dark gradient fallback.
 *     t    — seconds since the shot started. Every motion is periodic, asymptotic
 *            (settle/exp) or clamped, so any t (0 … 120 … ∞) is safe.
 *     W, H — logical size (960×540). Scenes are composed in 960×540 and scaled.
 *   Scenes contain no on-screen text: the cutscene UI owns all lettering. Key subjects
 *   stay inside y ≈ 50…390 (34 px letterbox bars + dialogue box at the bottom).
 *
 * Rendering approach
 *   • Everything is procedural Canvas 2D. Static layers (skies, starfields, hulls, terrain,
 *     planets, figures) are painted once into offscreen canvases, memoised in an LRU
 *     (`layer`). "Rack focus" uses the same builders cached at low resolution (soft layers).
 *   • Per frame: 5–8 parallax layers under a camera (dolly / push / roll / impact shake),
 *     live lights (additive glow sprites, volumetric shaft wedges), deterministic
 *     particle systems (hash of index + time: debris, embers, dust, sparks, rain, frost),
 *     then a cheap frame bloom (threshold by self-multiply on a 192×108 copy + blur),
 *     animated grain and vignette.
 *   • Deterministic (G.rng / integer hash; no Math.random). Never throws: each scene is
 *     wrapped in try/catch with a gradient fallback, and ctx state is always restored.
 *   • Perf: ≤ ~10 ms/frame headless target; bloom disables itself if it averages > 4 ms.
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
  function res() { const s = G.renderScale || 1; return Math.min(2, Math.max(0.5, Math.round(s * 1000) / 1000)); }

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
  /**
   * Layer with an origin: the builder paints in scene coordinates but only the
   * (x0, y0, w, h) box is stored — cropping transparent areas saves fill-rate.
   */
  function layerAt(key, x0, y0, w, h, build, scale) {
    const c = layer(key + '@' + x0 + ',' + y0, w, h, (g, ww, hh, cv) => { g.translate(-x0, -y0); build(g, ww, hh, cv); }, scale);
    c.ox = x0; c.oy = y0;
    return c;
  }
  /**
   * Draw a cached layer at its logical position (+dx, dy). When the current transform is
   * an unrotated, unscaled-relative mapping (layer pixels == device pixels) the draw is
   * snapped to whole device pixels — the 1:1 blit is ~10× cheaper than a resampled one on
   * software canvases. Otherwise it resamples (nearest when `nearest`, for soft layers).
   */
  function blit(ctx, c, dx, dy, nearest) {
    const x = (c.ox || 0) + (dx || 0), y = (c.oy || 0) + (dy || 0);
    const m = ctx.getTransform();
    if (m.b === 0 && m.c === 0 && Math.abs(m.a * c.lw - c.width) < 0.6 && Math.abs(m.d * c.lh - c.height) < 0.6) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(c, Math.round(m.e + m.a * x), Math.round(m.f + m.d * y));
      ctx.restore();
      return;
    }
    if (nearest) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(c, x, y, c.lw, c.lh); ctx.restore(); }
    else ctx.drawImage(c, x, y, c.lw, c.lh);
  }
  /** Bake a static film-grain tooth into a layer (zero per-frame cost). */
  function bakeGrain(g, w, h, a) {
    const n = layer('grain', 160, 160, (gg, ww, hh, c) => {
      const id = gg.createImageData(c.width, c.height), d = id.data, r = G.rng(991);
      for (let i = 0; i < d.length; i += 4) { const v = 128 + (r() + r() - 1) * 120; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      gg.putImageData(id, 0, 0);
    }, 1);
    g.save(); g.globalAlpha = a || 0.12; g.globalCompositeOperation = 'soft-light';
    g.fillStyle = g.createPattern(n, 'repeat'); g.fillRect(0, 0, w + 2000, h + 2000);
    g.restore();
  }

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
        const rr = Math.min(rad, u * w - 1, w - u * w - 1, cy - 1, h - cy - 1);
        if (rr > 2) blobs.push([u * w, cy, rr, clamp01((cy - top) / (h * 0.86 - top + 1))]);
      }
      blobs.sort((a, b) => b[1] - a[1]);
      for (const [x, y, rad, k] of blobs) {
        const c = mixc(lit, shade, Math.pow(k, 0.7));
        const gr = g.createRadialGradient(x, y - rad * 0.25, 0, x, y, rad);
        gr.addColorStop(0, rgba(mixc(c, lit, 0.35), 0.75)); gr.addColorStop(0.55, rgba(c, 0.5)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    });
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
        const steps = 3 + ((r() * 4) | 0);
        g.lineTo(x + w * 0.06, y - hh * 0.55); g.lineTo(x + w * 0.14, y - hh);
        for (let k = 1; k < steps; k++) g.lineTo(x + w * (0.14 + 0.72 * k / steps), y - hh * (0.86 + r() * 0.2));
        g.lineTo(x + w * 0.88, y - hh * 0.95); g.lineTo(x + w * 0.93, y - hh * 0.5); g.lineTo(x + w, y + 2); x += w;
      }
    }
    g.lineTo(DW, y + 4); g.lineTo(DW, y + 30); g.lineTo(0, y + 30); g.closePath(); g.fill();
  }

  // ════════════════════════════════════════════════════════════════════ post
  /**
   * Cinematic vignette (device-resolution cache → 1:1 blit). `col` tints it (alarm red).
   * `inner` (0..1) also darkens a soft central pool — used to keep menus readable.
   */
  function vignette(ctx, a, col, inner) {
    const c = col || [0, 0, 0];
    const v = layer('vig:' + c.join(',') + ':' + (inner || 0), DW, DH, (g) => {
      g.save(); g.scale(DW / 256, DH / 256);
      const gr = g.createRadialGradient(128, 128, 52, 128, 128, 184);
      gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.55, rgba(c, 0.35)); gr.addColorStop(1, rgba(c, 1));
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      g.restore();
      if (inner) {
        const ig = g.createRadialGradient(480, 290, 30, 480, 290, 430);
        ig.addColorStop(0, rgba(c, inner)); ig.addColorStop(0.6, rgba(c, inner * 0.55)); ig.addColorStop(1, rgba(c, 0));
        g.fillStyle = ig; g.fillRect(0, 0, DW, DH);
      }
    });
    ctx.globalAlpha = a; blit(ctx, v); ctx.globalAlpha = 1;
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
  const TEX_W = 1024, TEX_H = 512, TEX_FULL = TEX_W + TEX_W / 2 + 4;
  function wrapCopy(d, w, full, h) {
    for (let y = 0; y < h; y++) d.copyWithin((y * full + w) * 4, (y * full) * 4, (y * full + (full - w)) * 4);
  }
  /**
   * Equirect surface texture with the cloud deck baked in (one opaque pass per frame,
   * no alpha seams): amber ergs, rose highlands, dark canyon networks, frost caps,
   * banded wind-swept clouds.
   */
  function planetTex() {
    return layer('tessera-tex', TEX_FULL, TEX_H, (g, w, h, c) => {
      const [n1, n2, n3, n4] = noises();
      const id = g.createImageData(TEX_FULL, TEX_H), d = id.data;
      const stops = [[0, [58, 22, 34]], [0.22, [104, 40, 52]], [0.38, [160, 74, 74]], [0.5, [204, 122, 80]],
        [0.62, [228, 160, 96]], [0.76, [242, 198, 140]], [1, [252, 228, 194]]];
      const pal = [];
      for (let i = 0; i < 256; i++) {
        const e = i / 255; let j = 0; while (j < stops.length - 2 && e > stops[j + 1][0]) j++;
        pal.push(mixc(stops[j][1], stops[j + 1][1], clamp01((e - stops[j][0]) / (stops[j + 1][0] - stops[j][0]))));
      }
      for (let y = 0; y < TEX_H; y++) {
        const v = y / TEX_H, lat = Math.abs(v - 0.5) * 2;
        for (let x = 0; x < TEX_W; x++) {
          const X = (x / TEX_W) * 16, Y = v * 8;
          const wx = fbm(n2, X * 0.5, Y * 0.5, 2, 8) * 1.6;
          let e = fbm(n1, X + wx, Y + wx * 0.5, 4, 16);
          e = clamp01((e - 0.3) / 0.4) + 0.05 * Math.sin(v * 260 + wx * 9 + X * 0.6);
          const rid = 1 - Math.abs(2 * n3(X * 2.2 + wx, Y * 2.2, 35) - 1);
          let col = pal[(clamp01(e) * 255) | 0];
          if (rid > 0.9) col = mixc(col, [64, 26, 34], (rid - 0.9) * 6);
          const pc = sstep(0.8, 0.92, lat + (wx - 0.8) * 0.08);
          if (pc > 0) col = mixc(col, [250, 234, 220], pc * 0.92);
          // clouds: zonal bands with eddies
          const wv = n2(X * 0.35 + 7, v * 6, 6);
          const cl = fbm(n4, X * 0.8 + wv * 2.2, v * 26 + wv * 5, 4, 13);
          const ca = sstep(0.52, 0.72, cl) * (0.5 + 0.5 * Math.sin(v * Math.PI)) * 0.9;
          if (ca > 0) col = mixc(col, [255, 240, 230], ca);
          const i = (y * TEX_FULL + x) * 4;
          d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
        }
      }
      wrapCopy(d, TEX_W, TEX_FULL, TEX_H);
      g.putImageData(id, 0, 0);
    }, 1);
  }
  /**
   * Map the equirect texture onto a disc as a rotating sphere: N vertical slices,
   * uniform in longitude, placed at x = cx + R·sin(φ).
   */
  function sphereMap(ctx, tex, cx, cy, R, rot, N) {
    N = N || 48;
    const base = fract(rot) * TEX_W;
    const sw = TEX_W / 2 / N;
    for (let i = 0; i < N; i++) {
      const p0 = -Math.PI / 2 + (Math.PI * i) / N, p1 = p0 + Math.PI / N;
      const x0 = cx + R * Math.sin(p0), x1 = cx + R * Math.sin(p1);
      const sx = (base + sw * i) % TEX_W;
      ctx.drawImage(tex, sx, 0, sw, TEX_H, x0, cy - R, x1 - x0 + 0.7, R * 2);
    }
  }
  /** Per-pixel lambert + soft terminator + faint rose scattering, as a dark overlay. */
  function paintShade(g, R, L, ox, oy, s) {
    const S = Math.round(R * 2 * s), id = g.createImageData(S, S), d = id.data;
    const night = [3, 2, 9], term = [110, 40, 60];
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const nx = ((px + 0.5) / S) * 2 - 1, ny = ((py + 0.5) / S) * 2 - 1, d2 = nx * nx + ny * ny;
      if (d2 >= 1) continue;
      const nz = Math.sqrt(1 - d2);
      const lam = nx * L[0] + ny * L[1] + nz * L[2];
      const day = sstep(-0.06, 0.45, lam);
      const tz = Math.exp(-Math.pow((lam - 0.06) / 0.1, 2));
      const col = mixc(night, term, tz * 0.6);
      const a = clamp01((1 - day) * 0.985 + (1 - nz) * 0.3 * day + tz * 0.06);
      const i = (py * S + px) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = a * 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S;
    tmp.getContext('2d').putImageData(id, 0, 0);
    g.drawImage(tmp, ox - R, oy - R, R * 2, R * 2);
  }
  /** Additive-looking atmosphere: thin bright limb + soft outer halo on the sunlit side. */
  function paintAtmo(g, R, L, ox, oy, s, col) {
    const E = R * 1.3, S = Math.round(E * 2 * s), id = g.createImageData(S, S), d = id.data;
    const lx = L[0], ly = L[1], ll = Math.hypot(lx, ly) || 1;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
      const x = (((px + 0.5) / S) * 2 - 1) * 1.3, y = (((py + 0.5) / S) * 2 - 1) * 1.3;
      const rho = Math.hypot(x, y) || 1e-6;
      const lit = clamp01(0.12 + ((x / rho) * lx + (y / rho) * ly) / ll);
      let a;
      if (rho > 1) a = (Math.exp(-(rho - 1) / 0.022) * 0.9 + Math.exp(-(rho - 1) / 0.1) * 0.28) * lit;
      else a = Math.pow(rho, 16) * 0.7 * lit + Math.pow(rho, 5) * 0.1 * lit;
      const cc = mixc([255, 222, 186], col, clamp01((rho - 0.97) * 5));
      const i = (py * S + px) * 4;
      d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = clamp01(a) * 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S;
    tmp.getContext('2d').putImageData(id, 0, 0);
    g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(tmp, ox - E, oy - E, E * 2, E * 2); g.restore();
  }
  /** Dusty ring strands into g, centred at (cx, cy), rotated by tilt; half = 'back'|'front'. */
  function paintRing(g, R, ratio, cx, cy, tilt, half, alpha) {
    const ro = R * 2.0, ri = R * 1.32, N = 120, n = noises()[1];
    g.save(); g.translate(cx, cy); g.rotate(tilt);
    g.beginPath();
    if (half === 'front') g.rect(-ro - 4, 0, ro * 2 + 8, ro); else g.rect(-ro - 4, -ro, ro * 2 + 8, ro);
    g.clip();
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1), rad = lerp(ri, ro, f);
      const gap = f > 0.6 && f < 0.66 ? 0.06 : 1;
      const a = (0.12 + 0.8 * fbm(n, f * 22, 3.3, 3)) * gap * sstep(0, 0.1, f) * (1 - sstep(0.82, 1, f));
      g.strokeStyle = rgba(mixc([240, 212, 190], [200, 140, 136], fract(f * 3.1) * 0.6), a * alpha);
      g.lineWidth = ((ro - ri) / N) * 1.6;
      g.beginPath(); g.ellipse(0, 0, rad, rad * ratio, 0, 0, TAU); g.stroke();
    }
    g.restore();
  }
  /**
   * The planet, split for speed: `back` (ring far half — bake into the backdrop),
   * per-frame rotating surface, and `overlay` (shade, ring shadow, near ring half,
   * atmosphere) cached as one layer and blitted 1:1.
   * p: {x, y, R, L, key, tilt, ratio, rot, ringA}
   */
  function tesseraBack(g, p) { if (p.ratio) paintRing(g, p.R, p.ratio, p.x, p.y, p.tilt, 'back', (p.ringA || 1) * 0.85); }
  function tesseraOverlay(p) {
    const E = p.R * 2.1;
    return layerAt('tess-ov:' + p.key, Math.floor(p.x - E), Math.floor(p.y - E), Math.ceil(E * 2), Math.ceil(E * 2), (g, w, h, c) => {
      const s = c.width / w;
      g.save(); g.beginPath(); g.arc(p.x, p.y, p.R, 0, TAU); g.clip();
      if (p.ratio) {
        g.save(); g.translate(p.x, p.y + p.R * 0.1); g.rotate(p.tilt);
        g.strokeStyle = 'rgba(14,4,14,0.28)'; g.lineWidth = p.R * 0.26;
        g.beginPath(); g.ellipse(0, 0, p.R * 1.62, p.R * 1.62 * p.ratio, 0, 0, Math.PI); g.stroke();
        g.restore();
      }
      paintShade(g, p.R, p.L, p.x, p.y, s);
      g.restore();
      if (p.ratio) paintRing(g, p.R, p.ratio, p.x, p.y, p.tilt, 'front', p.ringA || 1);
      paintAtmo(g, p.R, p.L, p.x, p.y, s, [255, 120, 136]);
    });
  }
  function drawTesseraSurface(ctx, p) {
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, p.R, 0, TAU); ctx.clip();
    sphereMap(ctx, planetTex(), p.x, p.y, p.R, p.rot);
    ctx.restore();
  }
  /** Cratered moon sphere lit from L (painted straight into g at x, y). */
  function paintMoon(g, x, y, R, L, base, seed, haloC, haloA) {
    const s = Math.max(1, res()), S = Math.ceil(R * 2 * s) + 2, id = g.createImageData(S, S), d = id.data;
    const n = noises()[2], n2 = noises()[3], rr = (R * s), cc = S / 2;
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
    if (haloC) { g.save(); g.globalCompositeOperation = 'lighter'; glow(g, x, y, R * 2.8, haloC, haloA); g.restore(); }
    const tmp = document.createElement('canvas'); tmp.width = S; tmp.height = S;
    tmp.getContext('2d').putImageData(id, 0, 0);
    g.drawImage(tmp, x - S / s / 2, y - S / s / 2, S / s, S / s);
  }

  /** A moon as a small cropped layer at (x, y) — blitted 1:1. */
  function moonAt(key, x, y, R, L, base, seed, haloC, haloA) {
    const E = Math.ceil(R * 3);
    return layerAt('moon:' + key, Math.floor(x - E), Math.floor(y - E), E * 2, E * 2, (g) => paintMoon(g, x, y, R, L, base, seed, haloC, haloA));
  }


  // ════════════════════════════════════════════════════════════════════ v2 toolkit
  const SCENES = {};
  let ROOT = null; // device transform at the scene root (bloom/grain work in device space)

  /** Reset to the scene-root transform (escapes any camera). Pair with save/restore. */
  function rootT(ctx) { const m = ROOT; if (m) ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); }

  // ---------------------------------------------------------------- post: bloom
  const BL = { a: null, b: null, c: null, off: false, cost: 0, n: 0 };
  function mkCv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  /**
   * Frame bloom: copy the rendered scene to 192×108, raise to the 4th power (self-multiply —
   * a soft threshold that keeps only highlights), blur a 96×54 copy, add both back.
   * k = strength. Self-disables if it gets expensive on this device.
   */
  function bloom(ctx, k) {
    if (BL.off || !(k > 0) || !ROOT || !ctx.canvas || ctx.canvas.width < 64) return;
    const t0 = performance.now();
    if (!BL.a) { BL.a = mkCv(192, 108); BL.b = mkCv(192, 108); BL.c = mkCv(96, 54); }
    const a = BL.a.getContext('2d'), b = BL.b.getContext('2d'), c = BL.c.getContext('2d'), m = ROOT;
    a.globalCompositeOperation = 'copy';
    a.drawImage(ctx.canvas, m.e, m.f, DW * m.a, DH * m.d, 0, 0, 192, 108);
    b.globalCompositeOperation = 'copy'; b.drawImage(BL.a, 0, 0);
    b.globalCompositeOperation = 'multiply'; b.drawImage(BL.a, 0, 0); b.drawImage(BL.a, 0, 0); b.drawImage(BL.a, 0, 0);
    c.globalCompositeOperation = 'copy'; c.filter = 'blur(3px)'; c.drawImage(BL.b, 0, 0, 96, 54); c.filter = 'none';
    ctx.save(); rootT(ctx);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, k * 0.55); ctx.drawImage(BL.b, 0, 0, DW * 1, DH * 1);
    ctx.globalAlpha = Math.min(1, k); ctx.drawImage(BL.c, 0, 0, DW, DH);
    ctx.restore();
    const dt = performance.now() - t0;
    BL.cost = BL.n ? BL.cost * 0.9 + dt * 0.1 : dt; BL.n++;
    if (BL.n > 40 && BL.cost > 4) BL.off = true;
  }
  /** Animated film grain (24 fps flicker of a cached noise tile, overlay blend). */
  function grain(ctx, t, a) {
    const n = layer('grain2', 256, 256, (g, w, h, c) => {
      const id = g.createImageData(c.width, c.height), d = id.data, r = G.rng(4242);
      for (let i = 0; i < d.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 110; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(id, 0, 0);
    }, 1);
    const f = Math.floor(t * 24), ox = (hash(f, 7) * 256) | 0, oy = (hash(f, 9) * 256) | 0;
    ctx.save(); rootT(ctx);
    ctx.globalAlpha = a || 0.06; ctx.globalCompositeOperation = 'overlay';
    ctx.translate(-ox, -oy); ctx.fillStyle = ctx.createPattern(n, 'repeat'); ctx.fillRect(ox, oy, DW, DH);
    ctx.restore();
  }
  /** Standard finishing stack. */
  function finish(ctx, t, o) {
    o = o || {};
    bloom(ctx, o.bloom != null ? o.bloom : 0.7);
    if (o.tint) { ctx.save(); ctx.globalCompositeOperation = o.tintOp || 'soft-light'; ctx.globalAlpha = o.tintA || 0.25; ctx.fillStyle = o.tint; ctx.fillRect(0, 0, DW, DH); ctx.restore(); }
    vignette(ctx, o.vig != null ? o.vig : 0.9, o.vigC, o.inner);
    grain(ctx, t, o.grain != null ? o.grain : 0.07);
    if (o.flash > 0.003) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, o.flash); ctx.fillStyle = rgba(o.flashC || C.white, 1); ctx.fillRect(0, 0, DW, DH); ctx.restore(); }
    if (o.fade > 0.003) { ctx.save(); ctx.globalAlpha = Math.min(1, o.fade); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, DW, DH); ctx.restore(); }
  }

  // ---------------------------------------------------------------- camera
  /** Impact shake offset [dx, dy, roll] from hits [[t0, amp, decay]] (+ constant `base`). */
  function shake(t, hits, base) {
    let a = base || 0;
    if (hits) for (const h of hits) if (t >= h[0]) a += h[1] * Math.exp(-(t - h[0]) * (h[2] || 4));
    if (a < 0.01) return [0, 0, 0];
    return [a * (Math.sin(t * 53.1) * 0.6 + Math.sin(t * 31.7 + 1) * 0.4), a * (Math.sin(t * 47.3 + 2) * 0.6 + Math.sin(t * 27.9) * 0.4),
      a * 0.0016 * Math.sin(t * 23.3 + 0.5)];
  }
  /** Draw a full-screen layer with parallax offset (dx, dy) and depth scale z about the centre. */
  function par(ctx, img, dx, dy, z) {
    z = z || 1;
    if (z === 1) { blit(ctx, img, dx, dy); return; }
    const w = img.lw * z, h = img.lh * z;
    ctx.drawImage(img, (img.ox || 0) * z + DW / 2 - (DW / 2) * z + (dx || 0), (img.oy || 0) * z + DH / 2 - (DH / 2) * z + (dy || 0), w, h);
  }
  /** Cross-fade between a sharp and a soft (low-res) version of the same layer: rack focus. */
  function focusPair(ctx, key, build, blur, dx, dy, z) {
    if (blur < 0.98) par(ctx, layer(key, DW, DH, build), dx, dy, z);
    if (blur > 0.02) { ctx.save(); ctx.globalAlpha *= blur; par(ctx, layer(key + ':soft', DW, DH, build, 0.22), dx, dy, z); ctx.restore(); }
  }

  // ---------------------------------------------------------------- volumetrics
  /** Cone wedge sprite (apex at left, widening and fading right) for light shafts. */
  function coneImg(c) {
    return layer('cone:' + c.join(','), 256, 128, (g) => {
      const id = g.createImageData(256, 128), d = id.data;
      for (let x = 0; x < 256; x++) {
        const u = x / 255, wdt = 0.04 + 0.96 * u, fall = Math.pow(1 - u, 1.6) * sstep(0, 0.08, u);
        for (let y = 0; y < 128; y++) {
          const v = (y - 63.5) / 63.5 / wdt, a = Math.exp(-v * v * 3.2) * fall;
          const i = (y * 256 + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = clamp01(a) * 255;
        }
      }
      g.putImageData(id, 0, 0);
    }, 1);
  }
  /** Volumetric light shafts from (x, y) along `ang`: n flickering cones of varied width. */
  function shafts(ctx, x, y, ang, spread, len, n, c, a, t, seed, wid) {
    if (!(a > 0.004)) return;
    const img = coneImg(c);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.translate(x, y);
    for (let i = 0; i < n; i++) {
      const h1 = hash(seed, i), h2 = hash(seed + 5, i), h3 = hash(seed + 9, i);
      const da = (h1 - 0.5) * spread + Math.sin(t * 0.13 + i) * spread * 0.04;
      const fl = 0.55 + 0.45 * Math.sin(t * (0.25 + h2 * 0.6) + i * 2.3);
      const L = len * (0.6 + 0.5 * h3), w = L * (wid || 0.18) * (0.3 + h2);
      ctx.save(); ctx.rotate(ang + da); ctx.globalAlpha = Math.min(1, a * fl * (0.4 + 0.6 * h3));
      ctx.drawImage(img, 0, -w / 2, L, w); ctx.restore();
    }
    ctx.restore();
  }
  /** Dust motes drifting in a light volume (box x0..x1, y0..y1), additive. */
  function motes(ctx, t, n, seed, x0, y0, x1, y1, c, a, vx, vy) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const W = x1 - x0, H = y1 - y0;
    for (let i = 0; i < n; i++) {
      const sp = 0.5 + hash(seed, i);
      const x = x0 + fract(hash(seed + 1, i) + (t * (vx || 4) * sp + Math.sin(t * 0.7 + i) * 6) / W) * W;
      const y = y0 + fract(hash(seed + 2, i) + (t * (vy || -3) * sp + Math.cos(t * 0.5 + i * 1.7) * 5) / H) * H;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + sp) + i);
      const r = 0.7 + 2.2 * Math.pow(hash(seed + 3, i), 3);
      glow(ctx, x, y, r * 3, c, a * tw);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- particle systems
  /**
   * Burst/flow particles: each particle i lives `life` s and respawns (periodic → t-safe).
   * fn(i, u, k, h) — u ∈ [0,1) age fraction, k = respawn generation, h = per-particle hash.
   */
  function flow(n, seed, t, life, fn) {
    for (let i = 0; i < n; i++) {
      const h = hash(seed, i), L = life * (0.7 + 0.6 * hash(seed + 1, i));
      const p = t / L + h, k = Math.floor(p);
      fn(i, p - k, k, hash(seed + 2, i * 131 + k));
    }
  }
  /** One-shot debris burst from (x, y) starting at t0: ballistic with drag, tumbling shards. */
  function debrisBurst(ctx, t, t0, x, y, n, seed, spd, grav, col, sz, dirA, dirS) {
    const tt = t - t0; if (tt <= 0) return;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a = (dirA != null ? dirA : 0) + (hash(seed, i) - 0.5) * (dirS != null ? dirS : TAU);
      const v = spd * (0.25 + hash(seed + 1, i)), drag = 0.6 + hash(seed + 2, i);
      const d = (v / drag) * (1 - Math.exp(-drag * tt));
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d + 0.5 * grav * tt * tt * 0.3;
      const s = sz * (0.3 + hash(seed + 3, i) * 1.2), rot = tt * (hash(seed + 4, i) - 0.5) * 8;
      ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-s, -s * 0.4); ctx.lineTo(s * 0.7, -s * 0.6); ctx.lineTo(s, s * 0.3); ctx.lineTo(-s * 0.4, s * 0.6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  /** Sparks: short bright streaks along velocity, additive. */
  function sparks(ctx, t, n, seed, x, y, spd, grav, life, c, a, dirA, dirS) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    flow(n, seed, t, life, (i, u, k, h) => {
      const ang = (dirA || 0) + (h - 0.5) * (dirS != null ? dirS : TAU), v = spd * (0.4 + hash(k, i));
      const tt = u * life, vx = Math.cos(ang) * v, vy = Math.sin(ang) * v + grav * tt;
      const px = x + Math.cos(ang) * v * tt, py = y + Math.sin(ang) * v * tt + 0.5 * grav * tt * tt;
      const al = a * (1 - u) * (1 - u);
      ctx.strokeStyle = rgba(mixc(C.white, c, u), al); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - vx * 0.035, py - vy * 0.035); ctx.stroke();
    });
    ctx.restore();
  }
  /** Embers rising and swirling from a source region. */
  function embers(ctx, t, n, seed, x, y, w, rise, c, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    flow(n, seed, t, 3.2, (i, u, k, h) => {
      const px = x + (h - 0.5) * w + Math.sin(u * 7 + i) * 14 * u + u * 30, py = y - u * rise;
      glow(ctx, px, py, 2 + 3 * (1 - u), c, a * Math.sin(u * Math.PI) * (0.6 + 0.4 * Math.sin(t * 9 + i)));
    });
    ctx.restore();
  }
  /** Billowing smoke column: puffs rising and expanding, wind-bent. */
  function smoke(ctx, t, n, seed, x, y, rise, spread, wind, c, a, life) {
    flow(n, seed, t, life || 6, (i, u, k, h) => {
      const px = x + (h - 0.5) * 20 + u * u * wind + Math.sin(u * 4 + i) * 8, py = y - u * rise;
      const r = 10 + u * spread;
      puff(ctx, px, py, r, c, a * sstep(0, 0.12, u) * (1 - u));
    });
  }
  /** Rain / streaks: slanted lines across the frame. */
  function rain(ctx, t, n, seed, c, a, len, ang, speed) {
    ctx.save(); ctx.strokeStyle = rgba(c, a); ctx.lineWidth = 1; ctx.beginPath();
    const dx = Math.sin(ang) * len, dy = Math.cos(ang) * len;
    for (let i = 0; i < n; i++) {
      const sp = speed * (0.7 + 0.6 * hash(seed, i));
      const x = fract(hash(seed + 1, i) + (t * sp * Math.sin(ang)) / DW) * (DW + 200) - 100;
      const y = fract(hash(seed + 2, i) + (t * sp * Math.cos(ang)) / DH) * (DH + 100) - 50;
      ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy);
    }
    ctx.stroke(); ctx.restore();
  }

  // ---------------------------------------------------------------- hull greebles
  /**
   * Paint sci-fi plating into rect (x,y,w,h): recursive panel subdivision with tonal variation,
   * bevel highlights/shadows, rivets, vents, conduits, small boxes and lit window rows.
   * o: {base, hi, lo, seed, min, win (rgb), winP, stripe (rgb), vents}
   */
  function paintPanels(g, x, y, w, h, o) {
    const r = G.rng(o.seed || 1), min = o.min || 14;
    const base = o.base || [120, 128, 140], hi = o.hi || [220, 230, 245], lo = o.lo || [12, 14, 20];
    const rects = [];
    (function split(rx, ry, rw, rh, d) {
      if (d > 6 || (rw < min * 2 && rh < min * 2) || (d > 2 && r() < 0.22)) { rects.push([rx, ry, rw, rh]); return; }
      if (rw > rh * (0.6 + r())) { const s = rw * (0.25 + r() * 0.5); split(rx, ry, s, rh, d + 1); split(rx + s, ry, rw - s, rh, d + 1); }
      else { const s = rh * (0.25 + r() * 0.5); split(rx, ry, rw, s, d + 1); split(rx, ry + s, rw, rh - s, d + 1); }
    })(x, y, w, h, 0);
    for (const [px, py, pw, ph] of rects) {
      const v = (r() - 0.5) * 0.32;
      g.fillStyle = rgba(base.map((q) => q * (1 + v)), 1); g.fillRect(px, py, pw, ph);
      g.fillStyle = rgba(hi, 0.22); g.fillRect(px, py, pw, 0.8);
      g.fillStyle = rgba(lo, 0.55); g.fillRect(px, py + ph - 0.9, pw, 0.9); g.fillRect(px + pw - 0.7, py, 0.7, ph);
      const q = r();
      if (q < 0.12 && pw > 10 && ph > 6) { // vent slats
        g.fillStyle = rgba(lo, 0.7);
        for (let yy = py + 2; yy < py + ph - 2; yy += 2.6) g.fillRect(px + 2, yy, pw - 4, 1.1);
      } else if (q < 0.22 && pw > 8) { // rivet row
        g.fillStyle = rgba(hi, 0.35);
        for (let xx = px + 2; xx < px + pw - 1; xx += 4) g.fillRect(xx, py + 1.6, 0.9, 0.9);
      } else if (q < 0.3 && pw > 8 && ph > 8) { // greeble box
        const bw = pw * (0.3 + r() * 0.4), bh = ph * (0.3 + r() * 0.4), bx = px + r() * (pw - bw), by = py + r() * (ph - bh);
        g.fillStyle = rgba(base.map((q2) => q2 * 0.7), 1); g.fillRect(bx, by, bw, bh);
        g.fillStyle = rgba(hi, 0.3); g.fillRect(bx, by, bw, 0.8);
        g.fillStyle = rgba(lo, 0.6); g.fillRect(bx, by + bh, bw, 1.2);
      } else if (o.win && q < (o.winP || 0.38) && pw > 12 && ph > 5) { // lit window row
        const wy = py + ph * 0.35, n = Math.floor((pw - 4) / 5);
        for (let k = 0; k < n; k++) if (r() < 0.75) {
          const wc = r() < 0.15 ? C.warm : o.win;
          g.fillStyle = rgba(wc, 0.55 + r() * 0.45); g.fillRect(px + 3 + k * 5, wy, 2.4, 1.6);
        }
      }
    }
    // conduits along the length
    const nc = o.conduits != null ? o.conduits : 2;
    for (let i = 0; i < nc; i++) {
      const cy = y + h * (0.15 + r() * 0.7), cw = 1.2 + r() * 2;
      g.fillStyle = rgba(lo, 0.6); g.fillRect(x, cy + cw * 0.6, w, cw * 0.6);
      g.fillStyle = rgba(base.map((q) => q * 0.9), 1); g.fillRect(x, cy, w, cw);
      g.fillStyle = rgba(hi, 0.3); g.fillRect(x, cy, w, 0.6);
      for (let xx = x + r() * 30; xx < x + w; xx += 30 + r() * 50) { g.fillStyle = rgba(lo, 0.7); g.fillRect(xx, cy - 0.5, 2, cw + 1); }
    }
    if (o.stripe) {
      const sx = x + w * (0.2 + r() * 0.5), sw = Math.min(26, w * 0.2);
      g.save(); g.beginPath(); g.rect(sx, y, sw, h); g.clip();
      g.fillStyle = rgba(o.stripe, 0.85); g.fillRect(sx, y, sw, h);
      g.fillStyle = 'rgba(10,10,14,0.85)';
      for (let k = -h; k < sw + h; k += 7) { g.beginPath(); g.moveTo(sx + k, y); g.lineTo(sx + k + 3.5, y); g.lineTo(sx + k + 3.5 - h, y + h); g.lineTo(sx + k - h, y + h); g.fill(); }
      g.restore();
    }
  }
  /** Cylindrical shading over rect (top-lit), optionally warm under-light: drawn source-atop. */
  function cylShade(g, x, y, w, h, warm, rimC) {
    g.save(); g.globalCompositeOperation = 'source-atop';
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, 'rgba(255,250,240,0.32)'); gr.addColorStop(0.1, 'rgba(255,255,255,0.1)'); gr.addColorStop(0.3, 'rgba(0,0,0,0)');
    gr.addColorStop(0.6, 'rgba(0,0,10,0.4)'); gr.addColorStop(0.85, 'rgba(0,0,10,0.72)'); gr.addColorStop(1, 'rgba(0,0,10,0.9)');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
    if (warm) {
      const wg = g.createLinearGradient(0, y + h * 0.55, 0, y + h);
      wg.addColorStop(0, rgba(warm, 0)); wg.addColorStop(1, rgba(warm, 0.5));
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = wg; g.fillRect(x, y, w, h);
    }
    if (rimC) { g.fillStyle = rgba(rimC, 0.55); g.fillRect(x, y, w, 1.2); }
    g.restore();
  }

  // ---------------------------------------------------------------- «Ковчег-7» v2
  /** Ship-local frame 1600×420, centre line y=210, bow at +x. Cuts for break-up. */
  const SH = { W: 1600, H: 420, CY: 210, CUT_A: 470, CUT_B: 1010, RX: 1090 };
  /** Paint one standalone piece (into its own temp canvas) then composite. */
  function piece(g, x, y, w, h, fn) {
    const s = Math.max(1, res()), c = mkCv(Math.ceil(w * s) + 2, Math.ceil(h * s) + 2), pg = c.getContext('2d');
    pg.setTransform(s, 0, 0, s, -x * s, -y * s); fn(pg);
    g.drawImage(c, x, y, c.width / s, c.height / s);
  }
  function paintShip2(g, warm) {
    const CY = SH.CY, W = SH.W;
    const steel = [96, 102, 116], dark = [58, 62, 74];
    const rim = warm ? [255, 190, 140] : [190, 215, 255];
    // radiator wings (aft): thin dark panels with heat ribs
    for (const sgn of [-1, 1]) {
      piece(g, 120, sgn < 0 ? 10 : CY, 340, CY - 10, (p) => {
        p.beginPath();
        p.moveTo(150, CY + sgn * 40); p.lineTo(200, CY + sgn * 190); p.lineTo(420, CY + sgn * 175); p.lineTo(440, CY + sgn * 40); p.closePath();
        p.fillStyle = '#10121a'; p.fill(); p.save(); p.clip();
        for (let x = 150; x < 450; x += 9) { p.fillStyle = 'rgba(60,66,82,0.9)'; p.fillRect(x, CY - 200, 1.4, 400); }
        for (let y = 0; y < 420; y += 30) { p.fillStyle = 'rgba(0,0,0,0.6)'; p.fillRect(140, y, 320, 2); }
        for (let k = 0; k < 6; k++) { p.fillStyle = 'rgba(255,110,50,0.18)'; p.fillRect(160, CY + sgn * (60 + k * 22), 280, 1.4); }
        const gr = p.createLinearGradient(0, CY + sgn * 40, 0, CY + sgn * 190);
        gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0.05)'); p.fillStyle = gr; p.fillRect(140, 0, 320, 420);
        p.restore(); p.strokeStyle = rgba(rim, 0.35); p.lineWidth = 1; p.stroke();
      });
    }
    // spine truss
    piece(g, 260, CY - 18, 1000, 36, (p) => {
      p.fillStyle = '#20232c'; p.fillRect(260, CY - 12, 1000, 24);
      p.strokeStyle = 'rgba(150,160,180,0.75)'; p.lineWidth = 1.4;
      p.beginPath(); p.moveTo(260, CY - 12); p.lineTo(1260, CY - 12); p.moveTo(260, CY + 12); p.lineTo(1260, CY + 12);
      for (let x = 260; x < 1260; x += 24) { p.moveTo(x, CY - 12); p.lineTo(x + 12, CY + 12); p.lineTo(x + 24, CY - 12); }
      p.stroke();
      p.fillStyle = 'rgba(120,130,150,0.9)'; p.fillRect(260, CY - 3, 1000, 2.4);
      p.fillStyle = 'rgba(255,150,60,0.5)'; p.fillRect(260, CY + 4, 1000, 1);
    });
    // aft: engine bells + reactor
    piece(g, 0, CY - 120, 330, 240, (p) => {
      for (const oy of [-66, 0, 66]) {
        const gr = p.createLinearGradient(0, CY + oy - 34, 0, CY + oy + 34);
        gr.addColorStop(0, '#9aa3b4'); gr.addColorStop(0.4, '#5b6274'); gr.addColorStop(1, '#16181f');
        p.fillStyle = gr; p.beginPath(); p.moveTo(8, CY + oy - 34); p.quadraticCurveTo(50, CY + oy - 20, 92, CY + oy - 16);
        p.lineTo(92, CY + oy + 16); p.quadraticCurveTo(50, CY + oy + 20, 8, CY + oy + 34); p.closePath(); p.fill();
        for (let k = 1; k < 6; k++) { p.strokeStyle = 'rgba(0,0,0,0.35)'; p.lineWidth = 1; p.beginPath(); p.moveTo(8 + k * 15, CY + oy - 33 + k * 3.4); p.lineTo(8 + k * 15, CY + oy + 33 - k * 3.4); p.stroke(); }
        p.fillStyle = '#0b0c10'; p.beginPath(); p.ellipse(9, CY + oy, 5, 33, 0, 0, TAU); p.fill();
      }
      p.fillStyle = rgba(steel, 1); p.fillRect(88, CY - 110, 220, 220);
      paintPanels(p, 88, CY - 110, 220, 220, { seed: 71, base: [104, 110, 124], min: 10, conduits: 3, stripe: [230, 170, 40] });
      cylShade(p, 88, CY - 110, 220, 220, warm, rim);
      // reactor ring bands
      for (const x of [120, 200, 280]) { p.fillStyle = '#2a2e38'; p.fillRect(x, CY - 114, 10, 228); p.fillStyle = rgba(rim, 0.3); p.fillRect(x, CY - 114, 10, 1.4); }
    });
    // cryo section: central drum + clustered capsule modules
    piece(g, 470, CY - 150, 545, 300, (p) => {
      p.fillStyle = rgba(dark, 1); p.fillRect(480, CY - 66, 520, 132);
      paintPanels(p, 480, CY - 66, 520, 132, { seed: 33, base: [96, 104, 118], min: 9, win: C.cyan, winP: 0.3, conduits: 3 });
      cylShade(p, 480, CY - 66, 520, 132, warm, rim);
      const r = G.rng(808);
      for (const ry of [-120, -94, 94, 120]) for (let x = 492; x < 990; x += 104) {
        if (r() < 0.08) continue;
        const mx = x + (r() - 0.5) * 3, my = CY + ry - 11, mw = 96, mh = 22;
        const gr = p.createLinearGradient(0, my, 0, my + mh);
        gr.addColorStop(0, '#b7bfcc'); gr.addColorStop(0.3, '#6c7484'); gr.addColorStop(0.75, '#272b35'); gr.addColorStop(1, '#0e1016');
        p.fillStyle = '#2c313c'; p.fillRect(mx + mw / 2 - 2, ry < 0 ? my + mh : CY + 64, 4, ry < 0 ? CY - 64 - my - mh : my - CY - 64);
        p.fillStyle = gr; p.beginPath(); p.roundRect ? p.roundRect(mx, my, mw, mh, 7) : p.rect(mx, my, mw, mh); p.fill();
        for (let b = mx + 10; b < mx + mw - 6; b += 12) { p.fillStyle = 'rgba(0,0,0,0.45)'; p.fillRect(b, my + 1, 1.2, mh - 2); p.fillStyle = 'rgba(255,255,255,0.12)'; p.fillRect(b + 1.2, my + 1, 0.6, mh - 2); }
        p.fillStyle = 'rgba(0,0,0,0.5)'; p.fillRect(mx + 3, my + mh * 0.62, mw - 6, 1);
        for (let k = 0; k < 6; k++) if (r() < 0.7) { p.fillStyle = rgba(r() < 0.2 ? C.warm : C.cyan, 0.7 + r() * 0.3); p.fillRect(mx + 14 + k * 12, my + mh * 0.4, 3, 1.6); }
        if (r() < 0.3) { p.fillStyle = 'rgba(230,170,40,0.8)'; p.fillRect(mx + mw - 14, my + 2, 5, mh - 4); }
      }
      // grapple frames
      p.strokeStyle = 'rgba(160,170,190,0.6)'; p.lineWidth = 1.2;
      for (let x = 490; x < 1000; x += 88) { p.strokeRect(x, CY - 148, 2, 296); }
    });
    // habitat ring (edge-on torus) + hub
    piece(g, 1030, 0, 130, 420, (p) => {
      const X = SH.RX;
      p.lineWidth = 22; p.strokeStyle = '#3c4250'; p.beginPath(); p.ellipse(X, CY, 40, 192, 0, 0, TAU); p.stroke();
      p.lineWidth = 16; const gr = p.createLinearGradient(X - 50, 0, X + 50, 0);
      gr.addColorStop(0, '#2a2f3a'); gr.addColorStop(0.5, '#a9b2c4'); gr.addColorStop(1, '#3a404c');
      p.strokeStyle = gr; p.beginPath(); p.ellipse(X, CY, 40, 192, 0, 0, TAU); p.stroke();
      p.strokeStyle = 'rgba(0,0,0,0.4)'; p.lineWidth = 1;
      for (let a = 0; a < TAU; a += TAU / 48) { const c = Math.cos(a), s = Math.sin(a); p.beginPath(); p.moveTo(X + 32 * c, CY + 184 * s); p.lineTo(X + 48 * c, CY + 200 * s); p.stroke(); }
      p.strokeStyle = '#596173'; p.lineWidth = 4;
      for (const a of [0.5, 2.1, 3.7, 5.3]) { p.beginPath(); p.moveTo(X, CY); p.lineTo(X + Math.cos(a) * 38, CY + Math.sin(a) * 186); p.stroke(); }
      p.fillStyle = '#6b7384'; p.beginPath(); p.ellipse(X, CY, 16, 34, 0, 0, TAU); p.fill();
      p.fillStyle = rgba(rim, 0.5); p.beginPath(); p.ellipse(X - 2, CY - 8, 6, 18, 0, 0, TAU); p.fill();
    });
    // fore hull: long tapering hull + ogive bow
    piece(g, 1120, CY - 90, 482, 180, (p) => {
      p.beginPath(); p.moveTo(1130, CY - 58); p.lineTo(1470, CY - 58); p.bezierCurveTo(1540, CY - 56, 1590, CY - 22, 1600, CY);
      p.bezierCurveTo(1590, CY + 22, 1540, CY + 56, 1470, CY + 58); p.lineTo(1130, CY + 58); p.closePath();
      p.fillStyle = rgba(steel, 1); p.fill(); p.save(); p.clip();
      paintPanels(p, 1130, CY - 58, 470, 116, { seed: 57, base: [128, 134, 148], min: 9, win: C.warm, winP: 0.42, conduits: 2 });
      p.fillStyle = 'rgba(214,92,40,0.95)'; p.fillRect(1400, CY - 58, 12, 116); p.fillRect(1418, CY - 58, 4, 116);
      p.fillStyle = 'rgba(16,18,24,0.95)'; p.fillRect(1500, CY - 30, 30, 10); // bridge glazing
      for (let k = 0; k < 6; k++) { p.fillStyle = rgba(C.warm, 0.95); p.fillRect(1502 + k * 4.6, CY - 28, 3, 6); }
      cylShade(p, 1130, CY - 58, 470, 116, warm, rim);
      p.restore();
      // dorsal: comms dish + masts
      p.fillStyle = '#4a5160'; p.fillRect(1240, CY - 76, 6, 20); p.fillRect(1330, CY - 88, 2, 32); p.fillRect(1350, CY - 80, 2, 24);
      p.fillStyle = '#9aa3b4'; p.beginPath(); p.ellipse(1243, CY - 80, 22, 8, -0.3, 0, TAU); p.fill();
      p.fillStyle = '#2a2e38'; p.beginPath(); p.ellipse(1245, CY - 78, 16, 4, -0.3, 0, TAU); p.fill();
      p.fillStyle = '#4a5160'; p.fillRect(1200, CY + 56, 40, 12); p.fillRect(1290, CY + 56, 60, 8);
    });
    // aft-to-cryo coupling collar, cryo-to-ring collar
    piece(g, 300, CY - 60, 900, 120, (p) => {
      for (const [x, w, hh] of [[300, 180, 46], [1000, 40, 70], [1125, 20, 76]]) {
        p.fillStyle = '#6a7182'; p.fillRect(x, CY - hh, w, hh * 2);
        paintPanels(p, x, CY - hh, w, hh * 2, { seed: x, base: [100, 106, 120], min: 8, conduits: 1 });
        cylShade(p, x, CY - hh, w, hh * 2, warm, rim);
      }
    });
  }
  const shipImg2 = (warm) => layer('ship2' + (warm ? 'w' : ''), SH.W, SH.H, (g) => paintShip2(g, warm ? [255, 140, 70] : null), 1);
  /** Jagged cut line x(y) for the break-up seams. */
  function jag2(x, y, seed) { return x + (hash(seed, Math.floor(y / 9)) - 0.5) * 26 + Math.sin(y * 0.05 + seed) * 10; }
  const PSPAN = { aft: [0, SH.CUT_A], cryo: [SH.CUT_A, SH.CUT_B], fore: [SH.CUT_B, SH.W], aftcryo: [0, SH.CUT_B] };
  const PPIV = { all: 800, aft: 250, cryo: 740, fore: 1300, aftcryo: 500 };
  function clipPart2(ctx, part) {
    const sp = PSPAN[part]; if (!sp) return;
    ctx.beginPath();
    const L = sp[0], R = sp[1];
    ctx.moveTo(L === 0 ? -10 : jag2(L, -10, L), -10);
    for (let y = -10; y <= SH.H + 10; y += 9) ctx.lineTo(L === 0 ? -10 : jag2(L, y, L), y);
    for (let y = SH.H + 10; y >= -10; y -= 9) ctx.lineTo(R === SH.W ? SH.W + 10 : jag2(R, y, R), y);
    ctx.closePath(); ctx.clip();
  }
  /**
   * Draw the ship (or one break-up part) centred on its pivot at (x, y), scale s, roll rot.
   * o: {part, warm, engine (0..1), alarm (0..1), heat (0..1 cut-edge glow), lights}
   */
  function drawShip2(ctx, x, y, s, rot, t, o) {
    o = o || {};
    const part = o.part || 'all', piv = PPIV[part];
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s); ctx.translate(-piv, -SH.CY);
    ctx.save(); clipPart2(ctx, part); ctx.drawImage(shipImg2(o.warm), 0, 0, SH.W, SH.H); ctx.restore();
    const sp = PSPAN[part] || [0, SH.W], has = (x0) => x0 >= sp[0] && x0 <= sp[1];
    ctx.globalCompositeOperation = 'lighter';
    // engine plumes
    if (o.engine > 0 && has(10)) for (const oy of [-66, 0, 66]) {
      const fl = 0.85 + 0.15 * Math.sin(t * 31 + oy);
      glowE(ctx, 0, SH.CY + oy, 46, 30, 0, C.plasma, 0.5 * o.engine * fl);
      glowE(ctx, -90, SH.CY + oy, 140, 16, 0, C.blue, 0.45 * o.engine * fl);
      glowE(ctx, -40, SH.CY + oy, 60, 6, 0, C.white, 0.7 * o.engine);
    }
    // ring windows sweeping with the rotation (front half)
    if (has(SH.RX) && o.lights !== false) for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + t * 0.18, c = Math.cos(a);
      if (c < 0) continue;
      glow(ctx, SH.RX + 46 * c, SH.CY + 192 * Math.sin(a), 3.2, C.warm, 0.5 * c);
    }
    // nav lights: strobes + running lights
    if (o.lights !== false) {
      const st = Math.pow(Math.max(0, Math.sin(t * 2.4)), 40), st2 = Math.pow(Math.max(0, Math.sin(t * 2.4 + 2)), 40);
      if (has(1598)) { glow(ctx, 1598, SH.CY, 30, C.white, 0.9 * st); flare(ctx, 1598, SH.CY, 40, C.white, 0.6 * st); }
      if (has(200)) { glow(ctx, 200, SH.CY - 188, 14, C.red, 0.4 + 0.5 * st2); glow(ctx, 200, SH.CY + 188, 14, [80, 255, 140], 0.4 + 0.5 * st2); }
      if (has(SH.RX)) glow(ctx, SH.RX, SH.CY - 200, 10, C.red, 0.3 + 0.6 * st);
      if (has(700)) for (let k = 0; k < 6; k++) glow(ctx, 520 + k * 90, SH.CY - 150, 5, C.cyan, 0.35 + 0.3 * Math.sin(t * 1.3 + k));
    }
    if (o.lights !== false) {
      for (const [fx, fy, fw] of [[1200, SH.CY - 40, 60], [1360, SH.CY - 44, 50], [700, SH.CY - 50, 90], [260, SH.CY - 90, 50]]) if (has(fx)) {
        glowE(ctx, fx, fy, fw, fw * 0.35, 0, C.warm, 0.12); glow(ctx, fx - fw * 0.8, fy - 8, 3, C.white, 0.8);
      }
    }
    if (o.alarm > 0) {
      const p = Math.pow(0.5 + 0.5 * Math.sin(t * 6), 2) * o.alarm;
      for (let k = 0; k < 9; k++) if (has(300 + k * 150)) glow(ctx, 300 + k * 150, SH.CY + (k % 2 ? -60 : 60), 40, C.red, 0.35 * p);
    }
    if (o.heat > 0) for (const cut of [SH.CUT_A, SH.CUT_B]) {
      if (!(cut >= sp[0] - 1 && cut <= sp[1] + 1)) continue;
      for (let yy = 30; yy < SH.H - 30; yy += 16) {
        const fl = 0.6 + 0.4 * Math.sin(t * 7 + yy);
        glow(ctx, jag2(cut, yy, cut), yy, 14, C.orange, 0.35 * o.heat * fl);
        glow(ctx, jag2(cut, yy, cut), yy, 4, C.gold, 0.6 * o.heat * fl);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- escape pod
  /** Pod body sprite: blunt capsule, heat shield at +x, thruster at -x; window at (-6,-6). */
  function podImg(warm) {
    return layer('pod2' + (warm ? 'w' : ''), 140, 100, (g) => {
      g.translate(76, 50);
      // body: truncated cone with rounded shoulders
      g.beginPath(); g.moveTo(-58, -20); g.lineTo(26, -42); g.quadraticCurveTo(44, -44, 46, -30); g.lineTo(46, 30); g.quadraticCurveTo(44, 44, 26, 42); g.lineTo(-58, 20); g.closePath();
      g.fillStyle = '#c9ced8'; g.fill(); g.save(); g.clip();
      paintPanels(g, -60, -46, 108, 92, { seed: 9, base: [184, 188, 198], min: 7, conduits: 1 });
      g.fillStyle = 'rgba(214,92,40,0.95)'; g.fillRect(-20, -46, 6, 92); g.fillRect(-10, -46, 2, 92);
      const gr = g.createLinearGradient(0, -44, 0, 44);
      gr.addColorStop(0, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.35, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,10,0.75)');
      g.fillStyle = gr; g.fillRect(-60, -46, 110, 92);
      if (warm) { const wg = g.createLinearGradient(-60, 0, 50, 0); wg.addColorStop(0, 'rgba(255,120,40,0)'); wg.addColorStop(1, 'rgba(255,120,40,0.45)'); g.fillStyle = wg; g.fillRect(-60, -46, 110, 92); }
      g.restore();
      // heat shield
      const hs = g.createLinearGradient(46, 0, 58, 0); hs.addColorStop(0, '#3a2a24'); hs.addColorStop(1, '#120c0a');
      g.fillStyle = hs; g.beginPath(); g.moveTo(44, -44); g.quadraticCurveTo(62, 0, 44, 44); g.closePath(); g.fill();
      // thruster bell
      g.fillStyle = '#4a4f5c'; g.beginPath(); g.moveTo(-58, -12); g.lineTo(-72, -16); g.lineTo(-72, 16); g.lineTo(-58, 12); g.closePath(); g.fill();
      g.fillStyle = '#0c0d12'; g.beginPath(); g.ellipse(-72, 0, 3, 16, 0, 0, TAU); g.fill();
      // RCS quads
      g.fillStyle = '#5a606d'; g.fillRect(4, -44, 8, 4); g.fillRect(4, 40, 8, 4);
      // porthole frame (interior drawn live)
      g.fillStyle = '#2b2f38'; g.beginPath(); g.arc(-6, -6, 14, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(230,236,245,0.6)'; g.lineWidth = 1; g.beginPath(); g.arc(-6, -6, 13.5, 0, TAU); g.stroke();
    }, 3);
  }
  /**
   * Draw the pod at (x,y), scale s, rotation rot. o: {thrust, warm, mira (window life), plasma}
   * The porthole shows Mira's silhouette against the red cabin light.
   */
  function drawPod2(ctx, x, y, s, rot, t, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    if (o.thrust > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fl = 0.8 + 0.2 * Math.sin(t * 40);
      glowE(ctx, -100, 0, 50 * fl, 9, 0, C.plasma, 0.8 * o.thrust);
      glowE(ctx, -82, 0, 22, 5, 0, C.white, 0.95 * o.thrust);
      glow(ctx, -74, 0, 26, C.blue, 0.4 * o.thrust);
      ctx.restore();
    }
    ctx.drawImage(podImg(o.warm), -76, -50, 140, 100);
    // window interior
    ctx.save(); ctx.beginPath(); ctx.arc(-6, -6, 12, 0, TAU); ctx.clip();
    const fl = 0.75 + 0.25 * Math.sin(t * 3.1) * Math.sin(t * 7.7);
    ctx.fillStyle = rgba(mixc([60, 6, 6], [200, 40, 30], fl), 1); ctx.fillRect(-20, -20, 28, 28);
    ctx.globalCompositeOperation = 'lighter'; glow(ctx, -2, -14, 16, [255, 90, 40], 0.6 * fl); ctx.globalCompositeOperation = 'source-over';
    if (o.mira !== false) drawMiraBust(ctx, -6 + Math.sin(t * 0.6) * 0.8, -1, 0.36, t, { hand: o.hand });
    ctx.restore();
    // glass reflection
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(200,230,255,0.35)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(-6, -6, 9, -2.6, -1.7); ctx.stroke();
    glow(ctx, -9, -11, 3, C.white, 0.35);
    if (o.plasma > 0) {
      const p = o.plasma;
      glowE(ctx, 58, 0, 30, 60, 0, C.orange, 0.7 * p); glowE(ctx, 54, 0, 12, 46, 0, C.gold, 0.9 * p);
      glowE(ctx, 54, 0, 6, 40, 0, C.white, 0.7 * p);
    }
    ctx.restore();
    ctx.restore();
  }

  // ---------------------------------------------------------------- figures
  /** Mira, head & shoulders silhouette (pod window), facing camera ¾; hand pressed to glass. */
  function drawMiraBust(ctx, x, y, s, t, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const tilt = Math.sin(t * 0.5) * 0.05; ctx.rotate(tilt);
    ctx.fillStyle = '#0a0406';
    // shoulders / suit collar
    ctx.beginPath(); ctx.moveTo(-34, 40); ctx.quadraticCurveTo(-30, 12, -10, 8); ctx.lineTo(10, 8); ctx.quadraticCurveTo(30, 12, 34, 40); ctx.closePath(); ctx.fill();
    // neck + head
    ctx.fillRect(-5, -2, 10, 12);
    ctx.beginPath(); ctx.ellipse(0, -12, 10.5, 13, 0, 0, TAU); ctx.fill();
    // hair: swept fringe + ponytail mass
    ctx.beginPath(); ctx.moveTo(-11, -14); ctx.quadraticCurveTo(-6, -30, 8, -24); ctx.quadraticCurveTo(14, -18, 12, -8);
    ctx.quadraticCurveTo(22, -6, 20, 10 + Math.sin(t * 1.3) * 1.5); ctx.quadraticCurveTo(14, 2, 10, -2); ctx.closePath(); ctx.fill();
    // rim light from the red cabin lamp
    ctx.strokeStyle = 'rgba(255,120,80,0.55)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(0, -12, 10.5, 13, 0, -1.9, -0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, 8); ctx.quadraticCurveTo(30, 12, 34, 40); ctx.stroke();
    // eye glints (blink)
    const bl = fract(t / 4.3) < 0.03 ? 0 : 1;
    if (bl) { ctx.fillStyle = 'rgba(255,200,170,0.65)'; ctx.fillRect(-5.5, -13, 2.2, 1); ctx.fillRect(3, -13, 2.2, 1); }
    // hand on the glass
    const hk = o.hand != null ? o.hand : sstep(2.2, 3.4, t);
    if (hk > 0.01) {
      ctx.globalAlpha = hk; ctx.fillStyle = '#140608';
      ctx.save(); ctx.translate(-22, 22 - 10 * hk); ctx.rotate(-0.2);
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 9, 0, 0, TAU); ctx.fill();
      for (let f = 0; f < 4; f++) { ctx.beginPath(); ctx.ellipse(-6 + f * 4, -11, 1.6, 5, (f - 1.5) * 0.12, 0, TAU); ctx.fill(); }
      ctx.beginPath(); ctx.ellipse(8, -3, 1.8, 4.5, 0.8, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  /**
   * Mira, full figure silhouette seen from behind (standing), height h px at feet (x, y).
   * rim: rgb rim-light colour (from the light she faces). wind: hair/scarf flutter.
   */
  function drawMiraStand(ctx, x, y, h, t, rim, o) {
    o = o || {};
    const s = h / 100;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const br = Math.sin(t * 1.6) * 0.6, wnd = o.wind || 0;
    ctx.fillStyle = o.fill || '#07060a';
    ctx.beginPath();
    // legs
    ctx.moveTo(-9, 0); ctx.lineTo(-7, -44); ctx.lineTo(-1, -46); ctx.lineTo(-2, 0); ctx.closePath();
    ctx.moveTo(2, 0); ctx.lineTo(1, -46); ctx.lineTo(8, -44); ctx.lineTo(10, 0); ctx.closePath(); ctx.fill();
    // boots
    ctx.fillRect(-11, -4, 10, 4); ctx.fillRect(1, -4, 11, 4);
    // torso (suit with tool belt), arms
    ctx.beginPath(); ctx.moveTo(-10, -44); ctx.lineTo(-12, -72 + br); ctx.quadraticCurveTo(0, -78 + br, 12, -72 + br); ctx.lineTo(10, -44); ctx.closePath(); ctx.fill();
    ctx.fillRect(-12, -48, 24, 5);
    ctx.beginPath(); ctx.moveTo(-12, -71 + br); ctx.lineTo(-17, -50); ctx.lineTo(-15, -36); ctx.lineTo(-11, -38); ctx.lineTo(-11, -52); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(12, -71 + br); ctx.lineTo(17, -50); ctx.lineTo(15, -36); ctx.lineTo(11, -38); ctx.lineTo(11, -52); ctx.closePath(); ctx.fill();
    // head + ponytail
    ctx.beginPath(); ctx.ellipse(0, -83 + br, 7, 8.5, 0, 0, TAU); ctx.fill();
    const pw = Math.sin(t * 2.3) * 2 + wnd * 6;
    ctx.beginPath(); ctx.moveTo(-3, -86 + br); ctx.quadraticCurveTo(4 + pw, -80, 2 + pw * 1.5, -64 + br); ctx.quadraticCurveTo(-1 + pw, -74, -4, -80 + br); ctx.closePath(); ctx.fill();
    if (rim) {
      ctx.strokeStyle = rgba(rim, 0.8); ctx.lineWidth = 1.2 / s * Math.max(0.6, s * 0.9);
      ctx.beginPath(); ctx.ellipse(0, -83 + br, 7, 8.5, 0, -2.6, -0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-12, -72 + br); ctx.quadraticCurveTo(0, -78 + br, 12, -72 + br); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; glow(ctx, 0, -60, 70, rim, 0.12); ctx.globalCompositeOperation = 'source-over';
    }
    if (o.lamp) { ctx.globalCompositeOperation = 'lighter'; glow(ctx, 9, -66, 6, C.cyan, 0.8); glow(ctx, 9, -66, 22, C.cyan, 0.3); ctx.globalCompositeOperation = 'source-over'; }
    ctx.restore();
  }
  /**
   * ЭХО: tall, thin, asymmetric bronze custodian. Feet at (x, y), height h.
   * o: {sil (silhouette only, backlit), ring (0..1 light ring), crack (0..1), look}
   */
  function drawEcho(ctx, x, y, h, t, o) {
    o = o || {};
    const s = h / 200;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const sway = Math.sin(t * 0.7) * 1.2;
    const bronze = o.sil ? '#0b0806' : null;
    const plate = (pts, c1, c2) => {
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath();
      if (bronze) ctx.fillStyle = bronze;
      else { const ys = pts.map((p) => p[1]); const gr = ctx.createLinearGradient(-20, Math.min.apply(null, ys), 20, Math.max.apply(null, ys)); gr.addColorStop(0, c1 || '#d9a35a'); gr.addColorStop(1, c2 || '#4a2c14'); ctx.fillStyle = gr; }
      ctx.fill();
      if (!bronze) { ctx.strokeStyle = 'rgba(255,220,150,0.35)'; ctx.lineWidth = 0.8; ctx.stroke(); }
    };
    // legs: long, jointed, one heavier than the other
    plate([[-14, 0], [-10, -70], [-4, -72], [-6, 0]]);
    plate([[4, 0], [6, -40], [3, -72], [10, -74], [14, -40], [12, 0]], '#b07a3c', '#3a200e');
    plate([[-18, 0], [-4, 0], [-6, 4], [-18, 4]]); plate([[2, 0], [16, 0], [16, 4], [2, 4]]);
    // pelvis + spine column
    plate([[-14, -70], [14, -74], [10, -84], [-12, -82]]);
    plate([[-4 + sway * 0.2, -82], [4 + sway * 0.2, -82], [3 + sway * 0.5, -120], [-3 + sway * 0.5, -120]], '#8a5a2a', '#2a160a');
    for (let k = 0; k < 5; k++) plate([[-7 + sway * 0.3, -88 - k * 7], [7 + sway * 0.3, -88 - k * 7], [5 + sway * 0.3, -92 - k * 7], [-5 + sway * 0.3, -92 - k * 7]], '#c08a48', '#4a2c14');
    // asymmetric chest plates: big pauldron on the left
    const cx = sway * 0.6;
    plate([[-26 + cx, -118], [-6 + cx, -126], [16 + cx, -122], [20 + cx, -106], [8 + cx, -96], [-14 + cx, -98]]);
    plate([[-36 + cx, -124], [-16 + cx, -134], [-8 + cx, -120], [-22 + cx, -108], [-38 + cx, -110]], '#e0ae66', '#5a3618');
    // arms: left long and thin reaching low, right short folded
    plate([[-34 + cx, -112], [-30 + cx, -112], [-36 + cx, -62], [-40 + cx, -62]]);
    plate([[-40 + cx, -62], [-36 + cx, -62], [-34 + cx, -30], [-38 + cx, -28]]);
    for (let f = 0; f < 3; f++) plate([[-38 + cx + f * 2, -28], [-37 + cx + f * 2, -28], [-38 + cx + f * 3, -18], [-39 + cx + f * 3, -18]]);
    plate([[16 + cx, -118], [20 + cx, -118], [26 + cx, -94], [22 + cx, -92]]);
    plate([[22 + cx, -92], [26 + cx, -94], [14 + cx, -84], [12 + cx, -88]]);
    // neck + head: elongated mask
    const hx = sway + 1, hy = -142;
    plate([[-2 + hx, -126], [3 + hx, -126], [2 + hx, -134], [-1 + hx, -134]]);
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(-0.06 + (o.look || 0));
    plate([[-9, -18], [8, -20], [11, -2], [6, 14], [-2, 18], [-9, 8]], '#f0d29a', '#6a4320');
    if (!bronze) {
      // eye slits glowing
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glowE(ctx, -3, -4, 4, 1.4, 0, C.gold, 0.9); glowE(ctx, 5, -5, 3, 1.2, 0, C.gold, 0.7);
      glow(ctx, 0, -4, 14, [255, 200, 110], 0.25);
      ctx.restore();
      // crack line(s)
      const ck = o.crack || 0.25;
      ctx.strokeStyle = 'rgba(30,14,6,0.9)'; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(8, -19); ctx.lineTo(4, -10); ctx.lineTo(6, -2); ctx.lineTo(2, 6 * ck + 2); ctx.stroke();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      glowE(ctx, -3, -4, 3.5, 1.2, 0, C.gold, 0.95); glowE(ctx, 5, -5, 2.6, 1, 0, C.gold, 0.8);
      ctx.restore();
    }
    ctx.restore();
    // ring of light turning around the head
    const rk = o.ring != null ? o.ring : 1;
    if (rk > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const ra = t * 0.9;
      ctx.strokeStyle = rgba(C.gold, 0.55 * rk); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(hx, hy - 2, 22, 6, -0.18, 0, TAU); ctx.stroke();
      for (let i = 0; i < 7; i++) {
        const a = ra + (i / 7) * TAU, px = hx + Math.cos(a) * 22, py = hy - 2 + Math.sin(a) * 6 - Math.cos(a) * 22 * Math.sin(-0.18);
        glow(ctx, px, py, 4, C.gold, (0.5 + 0.5 * Math.sin(a)) * 0.9 * rk);
      }
      glow(ctx, hx, hy - 2, 40, [255, 200, 110], 0.18 * rk);
      ctx.restore();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- the Spire v2
  /**
   * Detailed Architect Spire silhouette layer (cached): terraced stone base with buttresses,
   * a tapering fluted shaft with glyph-light seams, crown petals cradling the Beacon core.
   * Painted in local space: base centre (0,0), up is -y, height h. Lit edge from `lx` side.
   */
  function spireImg(key, h, fill, rim, glyph) {
    const w = h * 0.36;
    return layer('spire:' + key, Math.ceil(w * 2), Math.ceil(h * 1.04), (g) => {
      g.translate(w, h * 1.02);
      const pts = [[1.0, 0], [0.92, -0.03], [0.6, -0.05], [0.56, -0.12], [0.38, -0.14], [0.34, -0.3], [0.3, -0.32], [0.22, -0.34],
        [0.2, -0.56], [0.24, -0.58], [0.14, -0.6], [0.12, -0.78], [0.18, -0.8], [0.22, -0.86], [0.14, -0.88], [0.06, -0.9], [0.03, -0.97], [0, -1]];
      g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(-px * w, py * h) : g.moveTo(-px * w, py * h)));
      for (let i = pts.length - 2; i >= 0; i--) g.lineTo(pts[i][0] * w, pts[i][1] * h);
      g.closePath(); g.fillStyle = fill; g.fill();
      g.save(); g.clip();
      // flutes + terraces
      for (let k = -6; k <= 6; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.2)'; g.fillRect(k * w * 0.03 - w * 0.01, -h, w * 0.012, h); }
      for (const ty of [0.05, 0.14, 0.32, 0.34, 0.58, 0.6, 0.8, 0.88]) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-w, -ty * h, w * 2, Math.max(1, h * 0.004)); }
      if (glyph) {
        const r = G.rng(h | 0);
        g.strokeStyle = rgba(glyph, 0.55); g.lineWidth = Math.max(0.6, h * 0.0018);
        for (let i = 0; i < 70; i++) {
          const yy = -(0.05 + r() * 0.82) * h, xx = (r() - 0.5) * w * 0.4 * (1 - (-yy / h) * 0.8);
          g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx, yy - h * (0.01 + r() * 0.03)); if (r() < 0.6) g.lineTo(xx + (r() - 0.5) * h * 0.02, yy - h * 0.04); g.stroke();
        }
      }
      const sg = g.createLinearGradient(-w * 0.4, 0, w * 0.4, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0.45)'); sg.addColorStop(0.6, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(255,255,255,0.06)');
      g.fillStyle = sg; g.fillRect(-w, -h, w * 2, h);
      g.restore();
      if (rim) {
        g.strokeStyle = rim; g.lineWidth = Math.max(0.8, h * 0.003); g.beginPath();
        for (let i = 0; i < pts.length; i++) (i ? g.lineTo(pts[i][0] * w, pts[i][1] * h) : g.moveTo(pts[i][0] * w, pts[i][1] * h));
        g.stroke();
      }
      // buttresses at the base
      g.fillStyle = fill;
      for (const sg2 of [-1, 1]) { g.beginPath(); g.moveTo(sg2 * w * 0.3, -h * 0.3); g.lineTo(sg2 * w * 1.15, 0); g.lineTo(sg2 * w * 0.9, 0); g.lineTo(sg2 * w * 0.28, -h * 0.2); g.closePath(); g.fill(); }
    });
  }
  /** Draw the Spire at base (x, by), height h, with live floating rings + beacon light. */
  function drawSpire2(ctx, x, by, h, t, o) {
    o = o || {};
    const img = spireImg(o.key || ('h' + Math.round(h)), Math.round(h), o.fill || '#0c0a12', o.rim, o.glyph);
    ctx.drawImage(img, x - img.lw / 2, by - h * 1.02, img.lw, img.lh);
    ctx.save();
    ctx.strokeStyle = o.fill || '#0c0a12'; ctx.lineWidth = Math.max(1, h * 0.01);
    for (let i = 0; i < 3; i++) {
      const yy = by - (0.66 + i * 0.05) * h + Math.sin(t * 0.8 + i) * h * 0.005;
      ctx.beginPath(); ctx.ellipse(x, yy, h * (0.11 - i * 0.025), h * 0.016, 0, 0, TAU); ctx.stroke();
    }
    if (o.light > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const c = o.lightC || C.cyan, L = o.light;
      glow(ctx, x, by - h, h * 0.25, c, L * 0.45); glow(ctx, x, by - h, h * 0.05, C.white, L * 0.9);
      for (let i = 0; i < 3; i++) {
        const yy = by - (0.66 + i * 0.05) * h;
        glowE(ctx, x, yy, h * (0.12 - i * 0.025), h * 0.02, 0, c, L * 0.35);
      }
    }
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════ shared backdrops
  /** Deep-space backdrop: nebula + dust lanes + Milky-Way-banded stars (cached). */
  function deepSpace(key, seed, blobs, lanes, band, extra) {
    return layer('deep:' + key, DW, DH, (g) => {
      vfill(g, 0, DH, [[0, '#020309'], [0.5, '#05060f'], [1, '#080614']]);
      paintNebula(g, seed, blobs);
      paintStars(g, DW, DH, seed + 7, 2400, { pow: 3.6, size: 0.9, alpha: 0.9, band });
      paintDustLanes(g, seed + 3, lanes);
      paintNebula(g, seed + 11, blobs.map((b) => Object.assign({}, b, { r: b.r * 0.35, a: b.a * 1.6, n: 6 })));
      paintStars(g, DW, DH, seed + 13, 260, { pow: 2.2, size: 1.6 });
      if (extra) extra(g);
      bakeGrain(g, DW, DH, 0.08);
    });
  }
  function starTwinkle(ctx, t, n, seed, a, y1) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const x = hash(seed, i) * DW, y = hash(seed + 1, i) * (y1 || DH);
      const tw = Math.pow(0.5 + 0.5 * Math.sin(t * (0.5 + hash(seed + 2, i) * 1.5) + i * 2.1), 4);
      flare(ctx, x, y, 6 + 12 * hash(seed + 3, i), STAR_COLS[i % 6], (0.15 + 0.6 * tw) * a);
    }
    ctx.restore();
  }
  /** Big blurred foreground bokeh discs drifting (depth layer nearest camera). */
  function bokeh2(ctx, t, n, seed, vx, vy, c, a) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const sp = 0.6 + hash(seed, i) * 0.8, r = 10 + 40 * hash(seed + 1, i);
      const x = fract(hash(seed + 2, i) + (t * vx * sp) / (DW + 200)) * (DW + 200) - 100;
      const y = fract(hash(seed + 3, i) + (t * vy * sp) / (DH + 200)) * (DH + 200) - 100;
      puff(ctx, x, y, r, c, a * (0.4 + 0.6 * hash(seed + 4, i)));
    }
    ctx.restore();
  }
  /** Fast near-camera particle streaks (ice/dust) for speed and depth. */
  function streaks(ctx, t, n, seed, vx, vy, c, a, len) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    const l = Math.hypot(vx, vy) || 1, ux = vx / l, uy = vy / l;
    for (let i = 0; i < n; i++) {
      const sp = 0.4 + hash(seed, i) * 1.2, z = hash(seed + 1, i);
      const x = fract(hash(seed + 2, i) + (t * vx * sp) / (DW + 300)) * (DW + 300) - 150;
      const y = fract(hash(seed + 3, i) + (t * vy * sp) / (DH + 300)) * (DH + 300) - 150;
      const L = (len || 30) * sp * (0.3 + z);
      ctx.strokeStyle = rgba(c, a * (0.3 + 0.7 * z)); ctx.lineWidth = 0.6 + z * 1.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * L, y - uy * L); ctx.stroke();
    }
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════════════════ title
  /** title — menu backdrop: Tessera as a backlit crescent under its ring, sunrise on the limb. */
  const TP = { x: 700, y: 650, R: 380, L: norm3([0.42, -0.5, -0.76]), key: 'title3', tilt: -0.24, ratio: 0.36, ringA: 1 };
  SCENES.title = function (ctx, t) {
    const dx = Math.sin(t * 0.05) * 10, dy = Math.cos(t * 0.04) * 5;
    par(ctx, deepSpace('title', 101, [
      { x: 220, y: 160, sx: 500, sy: 200, r: 260, c: [40, 90, 160], a: 0.08, n: 16 },
      { x: 760, y: 120, sx: 400, sy: 160, r: 240, c: [150, 60, 120], a: 0.07, n: 12 },
      { x: 600, y: 300, sx: 600, sy: 120, r: 220, c: [200, 110, 60], a: 0.04, n: 8 },
    ], [{ x0: 0, y0: 330, x1: 700, y1: 90, r: 70, a: 0.35, j: 60, n: 18 }], { y0: 220, k: -0.35, spread: 90, frac: 0.5 }), dx * 0.2 - 10, dy * 0.2 - 6, 1.03);
    starTwinkle(ctx, t, 10, 77, 1, 300);
    // tiny «Ковчег-7» crossing high, catching the sun
    ctx.save(); ctx.globalAlpha = 0.9;
    const kx = 300 + 220 * settle(t, 60), ky = 64 - 8 * settle(t, 60);
    drawShip2(ctx, kx + dx * 0.4, ky, 0.05, -0.05, t, { engine: 1 });
    ctx.restore();
    blit(ctx, moonAt('tt1', 150, 120, 26, norm3([0.6, -0.5, 0.2]), [236, 214, 200], 3.1, C.rose, 0.1), dx * 0.3, dy * 0.3);
    blit(ctx, moonAt('tt2', 860, 70, 9, norm3([0.6, -0.6, 0.3]), [210, 196, 230], 7.7, C.ice, 0.1), dx * 0.3, dy * 0.3);
    // planet (static composite: crescent + ring + atmosphere)
    const P = TP, E = P.R * 2.1;
    const pl = layerAt('title-planet', Math.floor(P.x - E), Math.floor(P.y - E), Math.ceil(E * 2), Math.ceil(E * 2), (g) => {
      tesseraBack(g, P);
      g.save(); g.beginPath(); g.arc(P.x, P.y, P.R, 0, TAU); g.clip(); sphereMap(g, planetTex(), P.x, P.y, P.R, 0.31, 96); g.restore();
      g.drawImage(tesseraOverlay(P), Math.floor(P.x - E), Math.floor(P.y - E), Math.ceil(E * 2), Math.ceil(E * 2));
      // Architect light-network on the night side
      g.globalCompositeOperation = 'lighter';
      const r = G.rng(5150);
      for (let i = 0; i < 260; i++) {
        const a = -Math.PI * (0.15 + r() * 0.7), d = P.R * Math.sqrt(r()) * 0.95;
        const x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
        if (y > 560) continue;
        glow(g, x, y, 1.5 + r() * 3, C.cyan, 0.15 + r() * 0.3);
      }
      g.globalCompositeOperation = 'source-over';
    });
    blit(ctx, pl, dx * 0.5, dy * 0.5);
    // forward-scattering limb + sunrise
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const sa = -1.08, sx = P.x + Math.cos(sa) * P.R + dx * 0.5, sy = P.y + Math.sin(sa) * P.R + dy * 0.5;
    ctx.lineWidth = 3; ctx.strokeStyle = rgba([255, 200, 160], 0.28);
    ctx.beginPath(); ctx.arc(P.x + dx * 0.5, P.y + dy * 0.5, P.R + 1, -2.6, -0.2); ctx.stroke();
    const pulse = 0.85 + 0.15 * Math.sin(t * 0.4);
    glowE(ctx, sx, sy, 520, 26, -0.48, C.warm, 0.35 * pulse);
    glow(ctx, sx, sy, 160, [255, 170, 120], 0.35 * pulse);
    glow(ctx, sx, sy, 34, C.white, 0.9);
    lensFlare(ctx, sx, sy, 0.7);
    shafts(ctx, sx, sy, -1.9, 1.6, 420, 9, [255, 190, 150], 0.06, t, 31);
    // the signal pulse on the night side
    const bx = 560 + dx * 0.5, by = 380 + dy * 0.5, period = 4.2;
    for (let k = 0; k < 3; k++) {
      const age = fract(t / period + k / 3) * period, rad = 6 + age * 120, a = Math.pow(1 - age / period, 2);
      ctx.beginPath(); ctx.ellipse(bx, by, rad, rad * 0.4, -0.1, 0, TAU);
      ctx.strokeStyle = rgba(C.cyan, 0.3 * a); ctx.lineWidth = 1.2; ctx.stroke();
    }
    const beat = Math.exp(-fract(t / (period / 3)) * 6);
    glow(ctx, bx, by, 16 + 18 * beat, C.cyan, 0.4 + 0.5 * beat); glow(ctx, bx, by, 3, C.white, 0.9);
    ctx.restore();
    bokeh2(ctx, t, 8, 5, -6, -2, [120, 150, 200], 0.04);
    motes(ctx, t, 30, 61, 0, 0, DW, DH, C.ice, 0.25, -3, -1);
    finish(ctx, t, { bloom: 0.6, inner: 0.35, vig: 1, grain: 0.06 });
  };

  // ════════════════════════════════════════════════════════════════════ space
  /** space — «Ковчег-7» hero pass: slow lateral dolly along a hull that overfills the frame. */
  SCENES.space = function (ctx, t) {
    const k = settle(t, 14);
    const sunX = 150, sunY = 96;
    par(ctx, deepSpace('space', 41, [
      { x: 700, y: 140, sx: 600, sy: 160, r: 280, c: [30, 110, 150], a: 0.09, n: 18 },
      { x: 280, y: 400, sx: 420, sy: 160, r: 280, c: [100, 40, 150], a: 0.09, n: 14 },
      { x: 880, y: 430, sx: 220, sy: 160, r: 220, c: [190, 100, 50], a: 0.07, n: 10 },
    ], [{ x0: 200, y0: 120, x1: 960, y1: 350, r: 80, a: 0.45, j: 60, n: 22 }], { y0: 270, k: 0.25, spread: 80, frac: 0.55 }, (g) => {
      g.globalCompositeOperation = 'lighter';
      glow(g, sunX, sunY, 340, [255, 190, 140], 0.2); glow(g, sunX, sunY, 70, C.warm, 0.6);
      g.globalCompositeOperation = 'source-over';
    }), -k * 8, 0, 1.02);
    starTwinkle(ctx, t, 8, 12, 0.8);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(ctx, sunX - k * 8, sunY, 24, C.white, 1); lensFlare(ctx, sunX - k * 8, sunY, 0.8);
    shafts(ctx, sunX - k * 8, sunY, 0.35, 0.9, 700, 7, [255, 220, 180], 0.035, t, 3);
    ctx.restore();
    // distant gas giant crescent (depth cue)
    blit(ctx, moonAt('sp-giant', 860, 92, 44, norm3([-0.8, -0.3, 0.1]), [170, 140, 200], 1.7, C.violet, 0.12), -k * 14, 0);
    // the ship: hero scale, dolly from aft toward the bow
    const sx = 560 - 260 * k + Math.sin(t * 0.3) * 4, sy = 250 + Math.sin(t * 0.35) * 3;
    const s = 0.74 + 0.04 * k;
    drawShip2(ctx, sx, sy, s, -0.045, t, { engine: 1 });
    // sun glint sweeping the hull
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gx = sx + (fract(t / 9) * 2 - 1) * 520 * s;
    glowE(ctx, gx, sy - 40 * s, 120, 6, -0.045, C.warm, 0.25 * Math.sin(fract(t / 9) * Math.PI));
    ctx.restore();
    // near ice crystals & dust (fast parallax) + defocused bokeh
    streaks(ctx, t, 50, 21, -240, 18, C.ice, 0.35, 18);
    bokeh2(ctx, t, 10, 9, -80, 6, C.ice, 0.05);
    finish(ctx, t, { bloom: 0.75, grain: 0.07 });
  };

  // ════════════════════════════════════════════════════════════════════ signal
  const SIG_PER = 3.2, SIG_B = [0, 0.26, 0.52, 1.42];
  function sigBeat(t) { let v = 0; const u = fract(t / SIG_PER) * SIG_PER; for (const b of SIG_B) if (u >= b) v = Math.max(v, Math.exp(-(u - b) * 7)); return v; }
  /** Bridge interior silhouette layer: viewport struts, consoles, two empty chairs. */
  function bridgeImg() {
    return layer('bridge2', DW, DH, (g) => {
      // viewport frame (window is transparent)
      g.fillStyle = '#05070b';
      g.beginPath(); g.rect(0, 0, DW, DH);
      g.moveTo(90, 360); g.bezierCurveTo(140, 120, 300, 40, 480, 36); g.bezierCurveTo(660, 40, 820, 120, 870, 360); g.closePath();
      g.fill('evenodd');
      g.strokeStyle = '#0c1018'; g.lineWidth = 18;
      for (const x of [300, 480, 660]) { g.beginPath(); g.moveTo(480 + (x - 480) * 0.2, 36); g.quadraticCurveTo(x, 150, 480 + (x - 480) * 1.3, 360); g.stroke(); }
      g.beginPath(); g.moveTo(110, 220); g.quadraticCurveTo(480, 170, 850, 220); g.stroke();
      g.strokeStyle = 'rgba(126,249,255,0.22)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(90, 360); g.bezierCurveTo(140, 120, 300, 40, 480, 36); g.bezierCurveTo(660, 40, 820, 120, 870, 360); g.stroke();
      // ceiling panels + pipes
      paintPanels(g, 0, 0, 120, 360, { seed: 3, base: [26, 30, 40], hi: [120, 160, 190], min: 10, conduits: 3 });
      paintPanels(g, 840, 0, 120, 360, { seed: 4, base: [26, 30, 40], hi: [120, 160, 190], min: 10, conduits: 3 });
      // console deck
      g.fillStyle = '#080a10'; g.beginPath(); g.moveTo(0, 360); g.lineTo(DW, 360); g.lineTo(DW, DH); g.lineTo(0, DH); g.fill();
      g.fillStyle = '#121722'; g.beginPath(); g.moveTo(40, 372); g.quadraticCurveTo(480, 330, 920, 372); g.lineTo(940, 420); g.quadraticCurveTo(480, 380, 20, 420); g.closePath(); g.fill();
      paintPanels(g, 60, 380, 840, 40, { seed: 8, base: [22, 28, 38], hi: [140, 200, 220], min: 6, win: [90, 200, 255], winP: 0.5, conduits: 0 });
      g.fillStyle = 'rgba(126,249,255,0.25)'; g.fillRect(40, 371, 880, 1);
      // projector pedestal
      g.fillStyle = '#0d121b'; g.beginPath(); g.moveTo(440, 380); g.lineTo(520, 380); g.lineTo(506, 352); g.lineTo(454, 352); g.closePath(); g.fill();
      g.fillStyle = 'rgba(126,249,255,0.6)'; g.fillRect(456, 351, 48, 2);
      // two empty chairs (high backs, headrests)
      for (const cx of [250, 710]) {
        g.fillStyle = '#04050a';
        g.beginPath(); g.moveTo(cx - 34, DH); g.lineTo(cx - 40, 420); g.quadraticCurveTo(cx - 44, 330, cx - 22, 300); g.lineTo(cx + 22, 300);
        g.quadraticCurveTo(cx + 44, 330, cx + 40, 420); g.lineTo(cx + 34, DH); g.closePath(); g.fill();
        g.beginPath(); g.ellipse(cx, 288, 20, 16, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(126,249,255,0.35)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(cx - 22, 300); g.quadraticCurveTo(cx - 44, 330, cx - 40, 420); g.stroke();
        g.beginPath(); g.ellipse(cx, 288, 20, 16, 0, Math.PI, TAU); g.stroke();
      }
      bakeGrain(g, DW, DH, 0.1);
    });
  }
  SCENES.signal = function (ctx, t) {
    const k = settle(t, 12), z = 1 + 0.08 * k, beat = sigBeat(t);
    const SX = 560, SY = 150; // the uncharted system, seen through the glass
    cam(ctx, z, 480, 230, 0, 0, 0);
    // outside: deep field with a tiny reddish system
    par(ctx, deepSpace('signal', 71, [
      { x: 560, y: 150, sx: 220, sy: 90, r: 160, c: [140, 60, 170], a: 0.12, n: 14 },
      { x: 300, y: 260, sx: 400, sy: 160, r: 220, c: [30, 90, 150], a: 0.08, n: 12 },
    ], [{ x0: 100, y0: 300, x1: 900, y1: 200, r: 60, a: 0.4, j: 40, n: 16 }], { y0: 180, k: -0.1, spread: 60, frac: 0.5 }), 0, 0, 1);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glow(ctx, SX, SY, 60 + 50 * beat, C.violet, 0.25 + 0.5 * beat);
    glow(ctx, SX, SY, 6, C.white, 0.7 + 0.3 * beat);
    flare(ctx, SX, SY, 30 + 40 * beat, C.magenta, 0.4 + 0.5 * beat);
    for (let i = 0; i < 4; i++) {
      const age = fract(t / SIG_PER + i / 4) * SIG_PER, rad = 4 + age * 60, a = Math.pow(1 - age / SIG_PER, 2);
      ctx.strokeStyle = rgba(C.magenta, 0.35 * a); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(SX, SY, rad, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // glass reflections
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glowE(ctx, 330, 140, 200, 30, -0.7, [90, 160, 200], 0.05); glowE(ctx, 700, 120, 160, 20, 0.7, [90, 160, 200], 0.04);
    ctx.restore();
    blit(ctx, bridgeImg());
    // hologram: rotating orbits + waveform ring above the projector
    const HX = 480, HY = 262;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    shafts(ctx, HX, 354, -Math.PI / 2, 0.5, 220, 6, C.cyan, 0.08 + 0.1 * beat, t, 17, 0.3);
    glowE(ctx, HX, HY, 150, 70, 0, C.cyan, 0.12 + 0.18 * beat);
    for (let i = 0; i < 5; i++) {
      const rx = 40 + i * 22, ry = rx * (0.22 + 0.05 * Math.sin(t * 0.4 + i)), rot = t * (0.15 + i * 0.05) * (i % 2 ? 1 : -1);
      ctx.strokeStyle = rgba(C.cyan, 0.22 + 0.2 * beat); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(HX, HY, rx, ry, rot * 0.2, 0, TAU); ctx.stroke();
      const a = t * (0.6 + i * 0.2) + i; glow(ctx, HX + Math.cos(a) * rx, HY + Math.sin(a) * ry, 3, C.white, 0.6);
    }
    ctx.strokeStyle = rgba(C.white, 0.5 + 0.4 * beat); ctx.lineWidth = 1.3; ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TAU, sp = beat * 22 * Math.pow(Math.abs(Math.sin(i * 0.7 + t * 2)), 6) + 3 * Math.sin(i * 0.5 + t * 3);
      const r = 66 + sp; const x = HX + Math.cos(a) * r, y = HY + Math.sin(a) * r * 0.3 - sp * 0.4;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    glow(ctx, HX, HY, 10 + 10 * beat, C.white, 0.6 + 0.4 * beat);
    // hologram spill on the chair rims + console blinks in rhythm
    glowE(ctx, 250, 300, 60, 30, 0, C.cyan, 0.05 + 0.1 * beat); glowE(ctx, 710, 300, 60, 30, 0, C.cyan, 0.05 + 0.1 * beat);
    for (let i = 0; i < 40; i++) {
      const x = 70 + hash(31, i) * 820, y = 386 + hash(32, i) * 30, on = Math.sin(t * (1 + hash(33, i) * 3) + i) > 0.4;
      if (on) glow(ctx, x, y, 3, i % 7 ? C.cyan : C.red, 0.5 + 0.4 * beat);
    }
    ctx.restore();
    motes(ctx, t, 50, 91, 360, 120, 600, 360, C.ice, 0.35, 2, -4);
    ctx.restore();
    finish(ctx, t, { bloom: 0.9, grain: 0.08, flash: beat * 0.03, flashC: C.cyan });
  };

  // ════════════════════════════════════════════════════════════════════ anomaly
  const AX = 610, AY = 200, AR = 64;
  /** Lensed starfield + accretion disk (static), Gargantua-like. */
  function anomalyBack() {
    return layer('anom-back', DW, DH, (g) => {
      const src = deepSpace('anom-src', 333, [
        { x: 300, y: 300, sx: 600, sy: 300, r: 260, c: [150, 60, 40], a: 0.08, n: 14 },
        { x: 800, y: 120, sx: 300, sy: 160, r: 200, c: [60, 50, 150], a: 0.08, n: 10 },
      ], [{ x0: 0, y0: 200, x1: 960, y1: 260, r: 70, a: 0.4, j: 50, n: 18 }], { y0: 220, k: 0.1, spread: 90, frac: 0.5 });
      g.drawImage(src, 0, 0, DW, DH);
      // lensing: concentric annuli of the background, magnified and rotated toward the hole
      for (let i = 40; i >= 0; i--) {
        const r0 = AR * (1.0 + i * 0.08), r1 = r0 + AR * 0.09, rm = (r0 + r1) / 2, m = 1 + Math.pow(AR * 1.9 / rm, 2);
        g.save(); g.beginPath(); g.arc(AX, AY, r1, 0, TAU); g.arc(AX, AY, r0, 0, TAU, true); g.clip();
        g.translate(AX, AY); g.rotate(1.4 * Math.pow(AR / rm, 2)); g.scale(m, m); g.translate(-AX, -AY);
        g.drawImage(src, 0, 0, DW, DH); g.restore();
      }
      g.globalCompositeOperation = 'lighter';
      glow(g, AX, AY, AR * 5, [255, 150, 80], 0.18);
      glow(g, AX, AY, AR * 2.4, [255, 190, 120], 0.25);
      // lensed far side of the disk arcing over and under the shadow
      for (let k = 0; k < 18; k++) {
        const f = k / 17;
        g.strokeStyle = rgba(mixc([255, 244, 220], [255, 120, 40], f), 0.3 * (1 - f * 0.8));
        g.lineWidth = 3.2;
        g.beginPath(); g.ellipse(AX, AY, AR * (1.25 + f * 0.9), AR * (1.12 + f * 0.75), 0, Math.PI * 1.02, Math.PI * 1.98); g.stroke();
        g.strokeStyle = rgba(mixc([255, 240, 210], [255, 120, 40], f), 0.16 * (1 - f * 0.8));
        g.beginPath(); g.ellipse(AX, AY, AR * (1.18 + f * 0.6), AR * (1.08 + f * 0.5), 0, Math.PI * 0.08, Math.PI * 0.92); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
      // event-horizon shadow + photon ring
      const sh = g.createRadialGradient(AX, AY, AR * 0.7, AX, AY, AR * 1.1);
      sh.addColorStop(0, '#000'); sh.addColorStop(0.8, '#000'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh; g.beginPath(); g.arc(AX, AY, AR * 1.1, 0, TAU); g.fill();
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,236,210,0.9)'; g.lineWidth = 1.6; g.beginPath(); g.arc(AX, AY, AR * 1.03, 0, TAU); g.stroke();
      g.strokeStyle = 'rgba(255,180,120,0.35)'; g.lineWidth = 5; g.beginPath(); g.arc(AX, AY, AR * 1.07, 0, TAU); g.stroke();
      g.globalCompositeOperation = 'source-over';
      bakeGrain(g, DW, DH, 0.08);
    });
  }
  /** Front half of the accretion disk: thin hot band crossing in front of the shadow. */
  function diskFront() {
    return layer('anom-disk', DW, DH, (g) => {
      const n = noises()[0];
      g.save(); g.translate(AX, AY); g.scale(1, 0.1);
      for (let i = 0; i < 70; i++) {
        const f = i / 69, rad = AR * (1.35 + f * 3.4);
        const a = Math.min(1, (0.25 + 0.9 * fbm(n, f * 30, 1.7, 3)) * (1 - f * 0.9) * sstep(0, 0.04, f));
        g.strokeStyle = rgba(mixc([255, 244, 220], [255, 100, 30], Math.pow(f, 0.6)), a);
        g.lineWidth = AR * 3.4 / 70 * 1.6;
        g.beginPath(); g.ellipse(0, 0, rad, rad, 0, 0, TAU); g.stroke();
      }
      g.restore();
      // re-cut the part of the disk behind the hole (the shadow occludes the far half)
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.rect(AX - AR * 1.05, AY - AR, AR * 2.1, AR); g.clip();
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(AX, AY, AR * 1.04, AR * 1.04, 0, Math.PI, TAU); g.fill();
    });
  }
  SCENES.anomaly = function (ctx, t) {
    const k = settle(t, 10), grip = sstep(0.5, 6, t);
    const [sx, sy, sr] = shake(t, [[1.2, 3, 1.5], [4.5, 5, 2]], 0.6 + 1.6 * grip);
    cam(ctx, 1 + 0.06 * k, AX, AY, sx, sy, sr + 0.02 * Math.sin(t * 0.3));
    par(ctx, anomalyBack(), 0, 0, 1.06);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    // swirling hot spots around the disk
    for (let i = 0; i < 26; i++) {
      const a = t * (0.6 + hash(5, i) * 0.6) + hash(6, i) * TAU, r = AR * (1.4 + hash(7, i) * 2.8);
      const x = AX + Math.cos(a) * r * 1.06, y = AY + Math.sin(a) * r * 0.09;
      const front = Math.sin(a) > 0 || Math.abs(Math.cos(a) * r) > AR * 1.1;
      if (front) glowE(ctx, x, y, 14, 3, 0, Math.cos(a) < 0 ? C.warm : C.gold, 0.25 + 0.3 * Math.max(0, -Math.cos(a)));
    }
    ctx.restore();
    ctx.save(); ctx.globalAlpha = 0.95; par(ctx, diskFront(), 0, 0, 1.06); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    glowE(ctx, AX * 1.06 - DW * 0.03, AY * 1.06 - DH * 0.03, 360, 10, 0, C.warm, 0.25 + 0.05 * Math.sin(t * 2));
    ctx.restore();
    // debris & gas streaming from the hull into the well
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    flow(60, 77, t, 4.5, (i, u, gen, h) => {
      const x0 = 240 + h * 260, y0 = 380 + hash(gen, i) * 60;
      const e = u * u, ang = -0.6 + u * 1.2;
      const x = lerp(x0, AX, e) + Math.sin(ang * 3 + i) * 30 * (1 - e), y = lerp(y0, AY, e) - Math.sin(e * Math.PI) * 50;
      glow(ctx, x, y, 2 + 2 * (1 - u), i % 3 ? C.warm : C.ice, 0.5 * (1 - u) * sstep(0, 0.1, u));
    });
    ctx.restore();
    ctx.restore();
    // the ship in the foreground, rolling, being dragged (separate camera = closer depth)
    const roll = -0.12 - 0.08 * grip + Math.sin(t * 0.8) * 0.02 * grip;
    ctx.save(); ctx.translate(sx * 2, sy * 2);
    drawShip2(ctx, 300 + 30 * k, 410 - 10 * k, 0.56, roll, t, { engine: 1 - grip * 0.6, alarm: grip, warm: true });
    ctx.globalCompositeOperation = 'lighter';
    sparks(ctx, t, 30, 91, 420, 380, 120, 40, 0.7, C.orange, 0.8 * grip, -0.5, 1.2);
    ctx.restore();
    debrisBurst(ctx, fract(t / 6) * 6 + 100, 100, 380, 400, 18, 12, 120, 0, '#1a1c22', 4, -0.4, 0.9);
    streaks(ctx, t, 40, 33, 160, -70, [255, 200, 160], 0.25, 30);
    finish(ctx, t, { bloom: 1.0, vigC: [40, 0, 0], vig: 0.9 + 0.1 * grip, grain: 0.08, flash: 0.25 * Math.exp(-Math.max(0, t - 1.2) * 3) * (t > 1.2 ? 1 : 0) });
  };

  // ════════════════════════════════════════════════════════════════════ registry
  /** Fallback for unknown ids: dark gradient with a soft low glow. */
  function sceneFallback(ctx, t) {
    blit(ctx, layer('fallback', DW, DH, (g) => {
      vfill(g, 0, DH, [[0, '#05060d'], [0.6, '#0d0b1c'], [1, '#170d22']]);
      g.globalCompositeOperation = 'lighter';
      glowE(g, DW / 2, DH * 0.72, 520, 140, 0, [90, 60, 140], 0.28);
      g.globalCompositeOperation = 'source-over';
      bakeGrain(g, DW, DH, 0.1);
    }));
    vignette(ctx, 0.7);
  }
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
     * @param {number} [shotIndex] index of the shot in its cutscene (layouts are per id)
     */
    draw(ctx, id, t, W, H, shotIndex) {
      t = Number.isFinite(t) && t > 0 ? t : 0;
      W = W || DW; H = H || DH;
      const fn = (!failed[id] && SCENES[id]) || sceneFallback;
      ctx.save();
      try {
        if (W !== DW || H !== DH) ctx.scale(W / DW, H / DH);
        ROOT = ctx.getTransform();
        ctx.beginPath(); ctx.rect(0, 0, DW, DH); ctx.clip();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, DW, DH);
        fn(ctx, t, shotIndex | 0);
      } catch (e) {
        if (!failed[id]) { failed[id] = true; console.error('Scene "' + id + '" failed:', e); }
        ctx.restore(); ctx.save();
        try { sceneFallback(ctx, t); } catch (e2) { /* never throw out of a cutscene */ }
      }
      ctx.restore();
      ROOT = null;
    },
    /** Optionally build a scene's caches ahead of time (e.g. during a fade). */
    prewarm(id) {
      const c = document.createElement('canvas'); c.width = 4; c.height = 4;
      try { this.draw(c.getContext('2d'), id, 0, DW, DH, 0); } catch (e) { /* ignore */ }
    },
  };
})();
