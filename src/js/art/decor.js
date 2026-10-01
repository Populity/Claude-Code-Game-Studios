/**
 * TESSERA environment art: G.Art.Decor (backgrounds, tiles, props, foreground, atmosphere).
 *
 * Everything is procedural Canvas 2D. Static content is cached:
 *   - a tileable material texture per biome (pattern fill for solid ground),
 *   - solid / one-way / spike tiles + static auto-scatter in 16x16-tile chunks (built lazily,
 *     rendered at 2x on HiDPI, LRU-capped so memory stays bounded),
 *   - parallax background strips (horizontally tileable, some also vertically),
 *   - a grade + vignette overlay, glow / light-shaft sprites, prop sprites.
 * Per frame we only blit caches and draw the animated bits (acid, crumble, glows, particles).
 *
 * Determinism: layout uses G.rng / coordinate hashes. Ambient motion is a pure function of time.
 * See docs/level-format.md §3-4 for the interface contract.
 */
(function () {
  'use strict';
  const T = G.TILE, W = G.VIEW_W, H = G.VIEW_H;
  const Pal = G.Art.Palette;
  const TAU = Math.PI * 2;
  const CHUNK = 16, CPX = CHUNK * T, PAD = 2, MAX_CHUNKS = 16;
  const SW = 1536; // background strip width (logical px), all layer content wraps at SW
  let TC = null;   // G.TILE_CODES (resolved lazily; level.js defines it)

  // ================================================================== math / noise
  /** Coordinate hash -> [0,1). */
  const h2 = (x, y, s) => {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const frac = (v) => v - Math.floor(v);
  const smooth = (a, b, v) => { const t = G.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mod = (a, n) => ((a % n) + n) % n;

  /** Periodic value noise (periods px, py in cells). */
  function pvn(x, y, px, py, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = mod(xi, px), x1 = mod(xi + 1, px), y0 = mod(yi, py), y1 = mod(yi + 1, py);
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(x0, y0, s), b = h2(x1, y0, s), c = h2(x0, y1, s), d = h2(x1, y1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  /** Periodic fBm over the unit square (u,v in 0..1), base period P cells. */
  function pfbm(u, v, P, s, oct, Py) {
    let a = 0.5, sum = 0, norm = 0, px = P, py = Py || P;
    for (let o = 0; o < oct; o++) {
      sum += a * pvn(u * px, v * py, px, py, s + o * 31);
      norm += a; a *= 0.5; px *= 2; py *= 2;
    }
    return sum / norm;
  }
  /** Periodic 1D function over SW built from integer harmonics: returns f(x) in about [-amp, amp]. */
  function wave1(seed, ks, amp) {
    const R = G.rng(seed);
    const comps = ks.map((k, i) => [k, R() * TAU, amp / (1 + i * 0.7)]);
    let norm = 0; for (const c of comps) norm += c[2];
    return (x) => {
      let s = 0;
      for (const c of comps) s += c[2] * Math.sin((TAU * c[0] * x) / SW + c[1]);
      return (s / norm) * amp;
    };
  }

  // ================================================================== canvas helpers
  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  const mix = (a, b, t) => Pal.mix(a, b, t);
  const shade = (c, k) => Pal.shade(c, k);
  const rgba = (c, a) => Pal.alpha(c, a);

  const glowCache = new Map();
  /** Soft radial glow sprite (64x64) for a colour. */
  function glowSprite(col) {
    let c = glowCache.get(col);
    if (c) return c;
    c = mk(64, 64);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(col, 1)); gr.addColorStop(0.22, rgba(col, 0.5));
    gr.addColorStop(0.55, rgba(col, 0.14)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache.set(col, c);
    return c;
  }
  /** Draw a glow (caller sets 'lighter' composite). */
  function glow(ctx, col, x, y, r, a) {
    if (a <= 0.004 || r <= 0.5) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2);
  }
  const vgradCache = new Map();
  /** Vertical fade sprite (1x64): colour at the bottom fading to transparent at the top. */
  function vfade(col) {
    let c = vgradCache.get(col);
    if (c) return c;
    c = mk(4, 64);
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, rgba(col, 0)); gr.addColorStop(0.7, rgba(col, 0.35)); gr.addColorStop(1, rgba(col, 0.9));
    g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
    vgradCache.set(col, c);
    return c;
  }

  // ================================================================== per-biome tile styles
  const STYLES = {
    ship:    { mat: 'metal',   edge: 'chamfer', r: 5, jag: 0,   cap: 'plate',   under: 'strip',   body: 'panel',  plat: 'girder', spike: 'steel' },
    wreck:   { mat: 'rust',    edge: 'chamfer', r: 6, jag: 1.2, cap: 'sand',    under: 'rust',    body: 'tilt',   plat: 'girder', spike: 'shard' },
    desert:  { mat: 'sandstone', edge: 'round', r: 9, jag: 2.2, cap: 'sand',    under: 'rock',    body: 'cracks', plat: 'slab',   spike: 'thorn' },
    canyon:  { mat: 'redrock', edge: 'round',   r: 8, jag: 2.6, cap: 'dust',    under: 'rock',    body: 'fracture', plat: 'slab', spike: 'thorn' },
    ruins:   { mat: 'stone',   edge: 'bevel',   r: 4, jag: 0.8, cap: 'moss',    under: 'roots',   body: 'bricks', plat: 'beam',   spike: 'bronze' },
    caves:   { mat: 'cave',    edge: 'round',   r: 10, jag: 2.8, cap: 'wet',    under: 'drip',    body: 'cracks', plat: 'grate',  spike: 'stalag' },
    crystal: { mat: 'crystalrock', edge: 'round', r: 8, jag: 2, cap: 'crystal', under: 'crystal', body: 'veins',  plat: 'crystal', spike: 'crystal' },
    tower:   { mat: 'metal',   edge: 'chamfer', r: 5, jag: 0,   cap: 'trim',    under: 'conduit', body: 'blocks', plat: 'grate',  spike: 'steel' },
  };

  // ================================================================== state
  const S = {
    level: null, pal: null, st: STYLES.desert, biome: 'desert', variant: '', key: 'desert', seed: 1,
    w: 0, h: 0, grid: null, depth: null, cs: 2,
    chunks: new Map(), useTick: 0,
    mat: null, pattern: null,
    scatter: [], anim: [], fg: [], motes: [], shafts: [],
    layers: [], sky: null, overlay: null,
    crumbleSpr: [], gone: new Set(), lastRS: 0,
    acidGrad: new Map(),
  };
  const matCache = new Map();

  // ================================================================== material textures
  /**
   * Build a 256x256 tileable material texture for the current biome (pattern fill for solids).
   */
  function buildMaterial(style, pal, key) {
    const ck = key + ':' + style;
    if (matCache.has(ck)) return matCache.get(ck);
    const N = 256;
    const c = mk(N, N), g = c.getContext('2d');
    const img = g.createImageData(N, N), d = img.data;
    const R = pal.rock;
    const cDeep = Pal.rgbOf(R.deep), cDark = Pal.rgbOf(R.dark), cBase = Pal.rgbOf(R.base), cLight = Pal.rgbOf(R.light);
    const cDet = Pal.rgbOf(R.detail), cCap = Pal.rgbOf(R.cap);
    const ramp = (t, out) => {
      t = G.clamp(t, 0, 1);
      let a, b, k;
      if (t < 0.3) { a = cDeep; b = cDark; k = t / 0.3; } else if (t < 0.6) { a = cDark; b = cBase; k = (t - 0.3) / 0.3; } else { a = cBase; b = cLight; k = (t - 0.6) / 0.4; }
      out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
    };
    const o = [0, 0, 0];
    const strataTone = [0.0, 0.07, -0.05, 0.1, -0.02, 0.05, -0.08, 0.03];
    for (let py = 0; py < N; py++) {
      const v = py / N;
      for (let px = 0; px < N; px++) {
        const u = px / N;
        let t = 0.6, mixC = null, mixK = 0;
        const grain = h2(px, py, 77) - 0.5;
        switch (style) {
          case 'metal': {
            const big = pfbm(u, v, 3, 5, 3);
            const brushed = pvn(u * 6, v * 128, 6, 128, 9);
            t = 0.6 + (big - 0.5) * 0.25 + (brushed - 0.5) * 0.08 + grain * 0.04;
            const grime = pfbm(u, v, 5, 13, 3);
            if (grime > 0.58) t -= (grime - 0.58) * 0.9;
            break;
          }
          case 'rust': {
            const big = pfbm(u, v, 3, 5, 3);
            t = 0.58 + (big - 0.5) * 0.3 + grain * 0.05;
            const r = pfbm(u, v, 5, 21, 4);
            if (r > 0.52) { mixC = cDet; mixK = Math.min(0.75, (r - 0.52) * 3.2); }
            const pit = h2(px >> 1, py >> 1, 5);
            if (pit > 0.985) t -= 0.25;
            break;
          }
          case 'sandstone': case 'redrock': {
            const warp = (pfbm(u, v, 4, 3, 3) - 0.5) * (style === 'redrock' ? 22 : 16);
            const s = v * N + warp;
            const band = Math.floor(s / 8);
            const bf = frac(s / 8);
            t = 0.6 + strataTone[mod(band, 8)] * (style === 'redrock' ? 1.6 : 1.2) + grain * 0.07 + (pfbm(u, v, 8, 41, 2) - 0.5) * 0.12;
            if (bf < 0.1) t -= 0.12;
            if (style === 'redrock') {
              const fr = pvn(u * 16, v * 2, 16, 2, 61);
              if (fr > 0.82) t -= (fr - 0.82) * 1.6;
            }
            break;
          }
          case 'stone': {
            const f = pfbm(u, v, 4, 7, 4);
            t = 0.58 + (f - 0.5) * 0.45 + grain * 0.06;
            const l = pfbm(u, v, 6, 19, 3);
            if (l > 0.6) { mixC = cCap; mixK = Math.min(0.45, (l - 0.6) * 2.5); }
            break;
          }
          case 'cave': {
            const f = pfbm(u, v, 4, 11, 4);
            t = 0.5 + (f - 0.5) * 0.7 + grain * 0.05;
            const wet = pfbm(u, v, 8, 23, 2);
            if (wet > 0.66) t += (wet - 0.66) * 1.2;
            break;
          }
          case 'crystalrock': {
            const f = pfbm(u, v, 4, 17, 4);
            t = 0.5 + (f - 0.5) * 0.55 + grain * 0.05;
            const r = 1 - Math.abs(pfbm(u, v, 3, 29, 3) * 2 - 1);
            if (r > 0.9) { mixC = cDet; mixK = (r - 0.9) * 6; }
            break;
          }
        }
        ramp(t, o);
        if (mixC) { o[0] += (mixC[0] - o[0]) * mixK; o[1] += (mixC[1] - o[1]) * mixK; o[2] += (mixC[2] - o[2]) * mixK; }
        const i = (py * N + px) * 4;
        d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    matCache.set(ck, c);
    return c;
  }

  // ================================================================== level analysis
  function codeAt(tx, ty) {
    if (tx < 0 || tx >= S.w) return TC.SOLID;
    if (ty < 0 || ty >= S.h) return ty < 0 ? TC.SOLID : TC.SOLID;
    return S.grid[ty * S.w + tx];
  }
  const solidAt = (tx, ty) => codeAt(tx, ty) === TC.SOLID;
  /** Empty for decoration purposes: nothing static there (crumble counts as empty). */
  const openAt = (tx, ty) => { const c = codeAt(tx, ty); return c === TC.EMPTY || c === TC.CRUMBLE; };

  function nbOf(tx, ty) {
    return {
      u: solidAt(tx, ty - 1), d: solidAt(tx, ty + 1), l: solidAt(tx - 1, ty), r: solidAt(tx + 1, ty),
      ul: solidAt(tx - 1, ty - 1), ur: solidAt(tx + 1, ty - 1), dl: solidAt(tx - 1, ty + 1), dr: solidAt(tx + 1, ty + 1),
    };
  }

  function buildDepth() {
    const w = S.w, h = S.h, N = w * h;
    const dep = new Uint8Array(N), q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let i = 0; i < N; i++) {
      if (S.grid[i] === TC.SOLID) dep[i] = 255; else { dep[i] = 0; q[qt++] = i; }
    }
    while (qh < qt) {
      const i = q[qh++], x = i % w, y = (i / w) | 0, dn = dep[i] + 1;
      if (dn > 6) continue;
      if (x > 0 && dep[i - 1] === 255) { dep[i - 1] = dn; q[qt++] = i - 1; }
      if (x < w - 1 && dep[i + 1] === 255) { dep[i + 1] = dn; q[qt++] = i + 1; }
      if (y > 0 && dep[i - w] === 255) { dep[i - w] = dn; q[qt++] = i - w; }
      if (y < h - 1 && dep[i + w] === 255) { dep[i + w] = dn; q[qt++] = i + w; }
    }
    S.depth = dep;
  }
  const depthAt = (tx, ty) => {
    if (tx < 0 || tx >= S.w || ty < 0 || ty >= S.h) return 7;
    const d = S.depth[ty * S.w + tx];
    return d === 255 ? 7 : d;
  };

  // ================================================================== tile shape
  /** Path for one solid tile: rounded / chamfered outer corners, jagged exposed sides (never the top). */
  function tilePath(g, tx, ty, nb, st, grow) {
    const x = tx * T, y = ty * T, x2 = x + T, y2 = y + T, r = st.r, j = st.jag;
    const e = grow || 0;
    const tl = !nb.u && !nb.l, tr = !nb.u && !nb.r, bl = !nb.d && !nb.l, br = !nb.d && !nb.r;
    const corner = (cx, cy, ex, ey) => { if (st.edge === 'round') g.quadraticCurveTo(cx, cy, ex, ey); else g.lineTo(ex, ey); };
    const xl = x - (nb.l ? 0 : e), xr = x2 + (nb.r ? 0 : e), yt = y - (nb.u ? 0 : e), yb = y2 + (nb.d ? 0 : e);
    g.moveTo(tl ? xl + r : xl, yt);
    if (tr) { g.lineTo(xr - r, yt); corner(xr, yt, xr, yt + r); } else g.lineTo(xr, yt);
    if (!nb.r && j) for (let k = 8; k < T; k += 8) if (!(tr && k < r) && !(br && k > T - r)) g.lineTo(xr - j * h2(x2, y + k, 11), y + k);
    if (br) { g.lineTo(xr, yb - r); corner(xr, yb, xr - r, yb); } else g.lineTo(xr, yb);
    if (!nb.d && j) for (let k = 8; k < T; k += 8) if (!(br && k < r) && !(bl && k > T - r)) g.lineTo(x2 - k, yb - j * h2(x2 - k, y2, 12));
    if (bl) { g.lineTo(xl + r, yb); corner(xl, yb, xl, yb - r); } else g.lineTo(xl, yb);
    if (!nb.l && j) for (let k = 8; k < T; k += 8) if (!(bl && k < r) && !(tl && k > T - r)) g.lineTo(xl + j * h2(x, y2 - k, 13), y2 - k);
    if (tl) { g.lineTo(xl, yt + r); corner(xl, yt, xl + r, yt); } else g.lineTo(xl, yt);
    g.closePath();
  }

  // ================================================================== tile body details (clipped to the tile)
  function rivet(g, x, y, R) {
    g.fillStyle = R.line; g.beginPath(); g.arc(x + 0.4, y + 0.5, 1.7, 0, TAU); g.fill();
    g.fillStyle = R.light; g.beginPath(); g.arc(x, y, 1.3, 0, TAU); g.fill();
    g.fillStyle = rgba(R.rim, 0.8); g.fillRect(x - 0.6, y - 0.8, 0.9, 0.7);
  }
  function crack(g, x, y, seed, len, R, dir) {
    const r = G.rng(seed);
    let cx = x, cy = y, a = dir != null ? dir : r() * TAU;
    g.beginPath(); g.moveTo(cx, cy);
    const pts = [[cx, cy]];
    for (let i = 0; i < len; i++) {
      a += (r() - 0.5) * 1.3;
      cx += Math.cos(a) * (3 + r() * 4); cy += Math.sin(a) * (3 + r() * 4);
      g.lineTo(cx, cy); pts.push([cx, cy]);
    }
    g.strokeStyle = rgba(R.line, 0.75); g.lineWidth = 1.1; g.stroke();
    g.beginPath(); g.moveTo(pts[0][0] + 0.8, pts[0][1] + 0.9);
    for (const p of pts) g.lineTo(p[0] + 0.8, p[1] + 0.9);
    g.strokeStyle = rgba(R.light, 0.3); g.lineWidth = 0.7; g.stroke();
  }
  function glyphMark(g, cx, cy, seed, col, s) {
    const r = G.rng(seed);
    s = s || 1;
    g.beginPath();
    const n = 3 + ((r() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const x0 = cx + (r() - 0.5) * 12 * s, y0 = cy + (r() - 0.5) * 8 * s;
      g.moveTo(x0, y0);
      if (r() < 0.5) g.lineTo(x0 + (r() < 0.5 ? -1 : 1) * (3 + r() * 5) * s, y0);
      else g.lineTo(x0, y0 + (r() < 0.5 ? -1 : 1) * (3 + r() * 4) * s);
      if (r() < 0.4) g.lineTo(x0 + 3 * s, y0 + 3 * s);
    }
    g.lineCap = 'round';
    g.strokeStyle = rgba(col, 0.18); g.lineWidth = 4; g.stroke();
    g.strokeStyle = rgba(col, 0.9); g.lineWidth = 1.2; g.stroke();
    g.lineCap = 'butt';
  }

  function drawBodyDetail(g, tx, ty, nb, dep) {
    const x = tx * T, y = ty * T, R = S.pal.rock, st = S.st;
    const hv = h2(tx, ty, 3), hv2 = h2(tx, ty, 4);
    switch (st.body) {
      case 'panel': case 'tilt': {
        const tilt = st.body === 'tilt' ? (h2(tx >> 1, ty >> 1, 8) - 0.5) * 0.35 : 0;
        g.lineWidth = 1;
        if (tx % 2 === 0 && nb.l) { g.strokeStyle = rgba(R.line, 0.85); g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5 + tilt * T, y + T); g.stroke(); g.strokeStyle = rgba(R.light, 0.35); g.beginPath(); g.moveTo(x + 1.5, y); g.lineTo(x + 1.5 + tilt * T, y + T); g.stroke(); }
        if (ty % 2 === 0 && nb.u) { g.strokeStyle = rgba(R.line, 0.85); g.beginPath(); g.moveTo(x, y + 0.5); g.lineTo(x + T, y + 0.5 + tilt * T); g.stroke(); g.strokeStyle = rgba(R.light, 0.35); g.beginPath(); g.moveTo(x, y + 1.5); g.lineTo(x + T, y + 1.5 + tilt * T); g.stroke(); }
        const rx = tx % 2 === 0 ? x + 5 : x + T - 5, ry = ty % 2 === 0 ? y + 5 : y + T - 5;
        if (dep <= 3) rivet(g, rx, ry, R);
        if (hv < 0.13) { // vent grille
          g.fillStyle = rgba(R.line, 0.85);
          for (let i = 0; i < 4; i++) g.fillRect(x + 8, y + 9 + i * 4, 16, 2);
          g.fillStyle = rgba(R.light, 0.35);
          for (let i = 0; i < 4; i++) g.fillRect(x + 8, y + 11 + i * 4, 16, 0.8);
        } else if (hv < 0.2 && dep <= 2) { // status light
          g.fillStyle = R.line; g.fillRect(x + 12, y + 13, 8, 5);
          g.fillStyle = hv2 < 0.5 ? S.pal.accent : S.pal.accent2; g.fillRect(x + 13, y + 14, 2, 3);
          g.fillStyle = rgba(R.light, 0.5); g.fillRect(x + 16, y + 15, 3, 1);
        } else if (hv < 0.3) { // scratches
          g.strokeStyle = rgba(R.rim, 0.18); g.lineWidth = 0.7; g.beginPath();
          g.moveTo(x + 4 + hv2 * 10, y + 8); g.lineTo(x + 20 + hv2 * 8, y + 14 + hv * 20); g.stroke();
        }
        if (st.body === 'tilt') {
          if (hv2 < 0.3) { // rust streak running down from the seam
            const gr = g.createLinearGradient(0, y, 0, y + T);
            gr.addColorStop(0, rgba(R.detail, 0.55)); gr.addColorStop(1, rgba(R.detail, 0));
            g.fillStyle = gr; g.fillRect(x + 6 + hv * 18, y, 2 + hv2 * 6, T);
          }
          if (hv > 0.85) { // dent
            g.fillStyle = rgba(R.line, 0.35); g.beginPath(); g.ellipse(x + 16, y + 17, 7, 4, 0.3, 0, TAU); g.fill();
            g.fillStyle = rgba(R.rim, 0.18); g.beginPath(); g.ellipse(x + 15, y + 15, 6, 2.5, 0.3, Math.PI, TAU); g.fill();
          }
        }
        break;
      }
      case 'blocks': {
        g.lineWidth = 1;
        const off = ty % 2;
        if (nb.u) { g.fillStyle = rgba(R.line, 0.8); g.fillRect(x, y, T, 1.2); g.fillStyle = rgba(R.light, 0.25); g.fillRect(x, y + 1.2, T, 1); }
        if ((tx + off) % 2 === 0 && nb.l) { g.fillStyle = rgba(R.line, 0.8); g.fillRect(x, y, 1.2, T); g.fillStyle = rgba(R.light, 0.2); g.fillRect(x + 1.2, y, 1, T); }
        if (h2(tx, 0, 5) < 0.14 && dep >= 1) { // vertical conduit channel
          g.fillStyle = rgba(R.line, 0.9); g.fillRect(x + 12, y, 8, T);
          g.fillStyle = rgba(S.pal.accent, 0.25); g.fillRect(x + 14, y, 4, T);
          g.fillStyle = rgba(S.pal.accent, 0.85); g.fillRect(x + 15.4, y, 1.2, T);
        } else if (hv < 0.1 && dep <= 2) rivet(g, x + 6, y + 6, R);
        if (hv2 < 0.18) { // rain wet streak
          g.fillStyle = rgba(R.rim, 0.12); g.fillRect(x + hv * 26, y, 1.2, T);
        }
        break;
      }
      case 'bricks': {
        // 32x16 staggered masonry in world coordinates
        for (let k = 0; k < 2; k++) {
          const by = y + k * 16, row = ty * 2 + k, off = (row % 2) * 16;
          const segs = off ? [[x - 16, x + 16], [x + 16, x + 48]] : [[x, x + 32]];
          for (const sgm of segs) {
            const bh = h2(sgm[0], by, 21);
            g.fillStyle = bh < 0.5 ? rgba(R.deep, 0.18 * (1 - bh * 2)) : rgba(R.light, 0.12 * (bh - 0.5) * 2);
            g.fillRect(sgm[0] + 1, by + 1, 30, 14);
            g.fillStyle = rgba(R.rim, 0.16); g.fillRect(sgm[0] + 1.5, by + 1, 29, 1);
            if (h2(sgm[0], by, 22) < 0.25) { g.fillStyle = rgba(R.line, 0.4); g.beginPath(); g.moveTo(sgm[0] + 1, by + 1); g.lineTo(sgm[0] + 6, by + 1); g.lineTo(sgm[0] + 1, by + 5); g.fill(); }
            if (dep <= 3 && h2(sgm[0], by, 23) < (S.variant === 'overgrown' ? 0.06 : 0.1)) glyphMark(g, sgm[0] + 16, by + 8, h2(sgm[0], by, 24) * 1e9, R.detail, 0.8);
          }
          if (!(k === 0 && !nb.u)) { g.fillStyle = rgba(R.line, 0.75); g.fillRect(x, by - 0.5, T, 1.2); }
          g.fillStyle = rgba(R.line, 0.75);
          if (off) g.fillRect(x + 15.5, by, 1.2, 16); else if (nb.l || x === 0) g.fillRect(x - 0.5, by, 1.2, 16);
        }
        break;
      }
      case 'cracks': {
        if (hv < 0.28) crack(g, x + 4 + hv2 * 24, y + 4 + hv * 30, (tx * 7919 + ty * 104729) >>> 0, 4, R);
        if (S.biome === 'desert' && hv2 > 0.6) { // embedded pebbles
          for (let i = 0; i < 2; i++) {
            const px = x + 5 + h2(tx, ty, 40 + i) * 22, py = y + 6 + h2(tx, ty, 50 + i) * 22, pr = 1.5 + h2(tx, ty, 60 + i) * 2.5;
            g.fillStyle = rgba(R.dark, 0.8); g.beginPath(); g.ellipse(px, py, pr * 1.3, pr, 0, 0, TAU); g.fill();
            g.fillStyle = rgba(R.light, 0.6); g.beginPath(); g.ellipse(px - 0.4, py - 0.6, pr, pr * 0.55, 0, Math.PI, TAU); g.fill();
          }
        }
        if (S.biome === 'caves' && hv2 > 0.72) { // wet glints
          g.strokeStyle = rgba(R.rim, 0.35); g.lineWidth = 0.8; g.beginPath();
          g.moveTo(x + 6 + hv * 16, y + 8); g.lineTo(x + 10 + hv * 16, y + 20); g.stroke();
          g.fillStyle = rgba(S.pal.accent, 0.35); g.fillRect(x + 20 - hv * 10, y + 22, 1.5, 1.5);
        }
        break;
      }
      case 'fracture': {
        if (hv < 0.35) {
          const cx = x + 6 + hv2 * 20;
          g.beginPath(); g.moveTo(cx, y);
          for (let k = 4; k <= T; k += 4) g.lineTo(cx + (h2(tx, ty * 9 + k, 31) - 0.5) * 3, y + k);
          g.strokeStyle = rgba(R.line, 0.55); g.lineWidth = 1.1; g.stroke();
        }
        if (hv2 < 0.3) { g.fillStyle = rgba(R.rim, 0.13); g.fillRect(x, y + 6 + hv * 20, T, 1); }
        break;
      }
      case 'veins': {
        if (hv < 0.22 && dep <= 3) crystalCluster(g, x + 8 + hv2 * 16, y + 12 + hv * 30, (tx * 31 + ty * 17) >>> 0, 0.55 + hv2 * 0.35, h2(tx, ty, 6) * TAU);
        else if (hv < 0.45) {
          g.strokeStyle = rgba(R.detail, 0.35); g.lineWidth = 0.8; g.beginPath();
          g.moveTo(x, y + hv2 * T); g.quadraticCurveTo(x + 16, y + hv * T * 2, x + T, y + (1 - hv2) * T); g.stroke();
        }
        break;
      }
    }
  }

  /** Small faceted crystal cluster (used in crystal tiles, scatter and props). */
  function crystalCluster(g, x, y, seed, s, baseAng, cols) {
    const r = G.rng(seed);
    const n = 2 + ((r() * 3) | 0);
    const P = S.pal;
    const cA = cols ? cols[0] : P.rock.cap, cB = cols ? cols[1] : P.rock.detail;
    for (let i = 0; i < n; i++) {
      const a = (baseAng != null ? baseAng : -Math.PI / 2) + (r() - 0.5) * 1.3;
      const len = (8 + r() * 12) * s, wd = (2.5 + r() * 2.5) * s;
      const col = r() < 0.6 ? cA : cB;
      g.save(); g.translate(x, y); g.rotate(a);
      g.beginPath(); g.moveTo(0, -wd); g.lineTo(len * 0.8, -wd); g.lineTo(len, 0); g.lineTo(len * 0.8, wd); g.lineTo(0, wd); g.closePath();
      g.fillStyle = shade(col, -0.25); g.fill();
      g.beginPath(); g.moveTo(0, -wd); g.lineTo(len * 0.8, -wd); g.lineTo(len, 0); g.lineTo(0, 0); g.closePath();
      g.fillStyle = shade(col, 0.25); g.fill();
      g.strokeStyle = rgba(shade(col, 0.7), 0.9); g.lineWidth = 0.7;
      g.beginPath(); g.moveTo(0, -wd); g.lineTo(len * 0.8, -wd); g.lineTo(len, 0); g.stroke();
      g.restore();
    }
  }

  // ================================================================== caps (top surfaces) and undersides
  function hazardStripes(g, x, y, w, h) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = '#1a1612'; g.fillRect(x, y, w, h);
    g.fillStyle = '#f2b33a';
    for (let k = -h; k < w + h; k += 6) { g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + 3, y + h); g.lineTo(x + k + 3 + h, y); g.lineTo(x + k + h, y); g.fill(); }
    g.restore();
  }

  function drawCap(g, tx, ty, nb) {
    const x = tx * T, y = ty * T, R = S.pal.rock, st = S.st;
    const hv = h2(tx, ty, 70);
    switch (st.cap) {
      case 'plate': {
        const gr = g.createLinearGradient(0, y, 0, y + 6);
        gr.addColorStop(0, R.capLight); gr.addColorStop(0.3, R.cap); gr.addColorStop(1, R.capDark);
        g.fillStyle = gr; g.fillRect(x, y, T, 6);
        g.fillStyle = R.line; g.fillRect(x, y + 6, T, 1.2);
        g.fillStyle = rgba(R.line, 0.6); g.fillRect(x + (tx % 2 ? 0 : 0), y, 0.8, 6);
        for (let k = 8; k < T; k += 16) { g.fillStyle = R.line; g.fillRect(x + k - 1, y + 2.5, 2, 2); g.fillStyle = rgba(R.capLight, 0.8); g.fillRect(x + k - 1, y + 2.5, 1, 1); }
        if (!nb.l) hazardStripes(g, x, y + 1, 12, 4);
        if (!nb.r) hazardStripes(g, x + T - 12, y + 1, 12, 4);
        break;
      }
      case 'trim': {
        const gr = g.createLinearGradient(0, y, 0, y + 5);
        gr.addColorStop(0, R.capLight); gr.addColorStop(0.35, R.cap); gr.addColorStop(1, R.capDark);
        g.fillStyle = gr; g.fillRect(x, y, T, 5);
        g.fillStyle = R.line; g.fillRect(x, y + 5, T, 1);
        if (hv < 0.3) { g.fillStyle = S.pal.accent; g.fillRect(x + 6 + hv * 40, y + 2, 5, 1.2); }
        if (hv > 0.6) { g.fillStyle = rgba('#ffffff', 0.5); g.fillRect(x + (hv - 0.6) * 60, y + 0.6, 4, 0.8); }
        break;
      }
      case 'sand': {
        const thick = S.biome === 'wreck' ? 6 : 7;
        g.beginPath();
        g.moveTo(x, y + 2);
        for (let k = 0; k <= T; k += 4) { const wx = x + k; g.lineTo(wx, y - 0.6 - 1.1 * (0.5 + 0.5 * Math.sin(wx * 0.045 + ty))); }
        for (let k = T; k >= 0; k -= 4) { const wx = x + k; g.lineTo(wx, y + thick + 2.2 * Math.sin(wx * 0.11 + ty * 1.7) + h2(wx, ty, 71) * 1.6); }
        g.closePath();
        const gr = g.createLinearGradient(0, y - 2, 0, y + thick + 3);
        gr.addColorStop(0, R.capLight); gr.addColorStop(0.35, R.cap); gr.addColorStop(1, R.capDark);
        g.fillStyle = gr; g.fill();
        if (!nb.l) { g.beginPath(); g.moveTo(x + 6, y); g.quadraticCurveTo(x - 3, y + 1, x - 2.5, y + 10 + hv * 8); g.lineTo(x + 2, y + thick); g.closePath(); g.fill(); }
        if (!nb.r) { g.beginPath(); g.moveTo(x + T - 6, y); g.quadraticCurveTo(x + T + 3, y + 1, x + T + 2.5, y + 10 + (1 - hv) * 8); g.lineTo(x + T - 2, y + thick); g.closePath(); g.fill(); }
        g.strokeStyle = rgba(R.capLight, 0.9); g.lineWidth = 1;
        g.beginPath(); for (let k = 0; k <= T; k += 4) { const wx = x + k; const yy = y - 0.6 - 1.1 * (0.5 + 0.5 * Math.sin(wx * 0.045 + ty)); if (k === 0) g.moveTo(wx, yy); else g.lineTo(wx, yy); } g.stroke();
        g.strokeStyle = rgba(R.capDark, 0.45); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x + 4 + hv * 8, y + 3); g.quadraticCurveTo(x + 12 + hv * 8, y + 1.8, x + 20 + hv * 8, y + 3.4); g.stroke();
        break;
      }
      case 'dust': {
        g.beginPath(); g.moveTo(x, y - 0.5);
        g.lineTo(x + T, y - 0.5);
        for (let k = T; k >= 0; k -= 4) g.lineTo(x + k, y + 3.5 + h2(x + k, ty, 72) * 2.2);
        g.closePath();
        g.fillStyle = R.cap; g.fill();
        g.fillStyle = rgba(R.capLight, 0.9); g.fillRect(x, y - 0.5, T, 1.2);
        if (!nb.l) { g.fillStyle = R.cap; g.beginPath(); g.moveTo(x + 3, y); g.lineTo(x - 1.5, y + 6 + hv * 6); g.lineTo(x + 1, y + 3); g.fill(); }
        if (!nb.r) { g.fillStyle = R.cap; g.beginPath(); g.moveTo(x + T - 3, y); g.lineTo(x + T + 1.5, y + 6 + hv * 6); g.lineTo(x + T - 1, y + 3); g.fill(); }
        break;
      }
      case 'moss': {
        const over = S.variant === 'overgrown';
        const th = over ? 6 : 4;
        g.beginPath(); g.moveTo(x - (nb.l ? 0 : 1.5), y - 1);
        g.lineTo(x + T + (nb.r ? 0 : 1.5), y - 1);
        for (let k = T; k >= 0; k -= 3) g.lineTo(x + k, y + th + h2(x + k, ty, 73) * (over ? 6 : 3.5));
        g.closePath();
        const gr = g.createLinearGradient(0, y - 1, 0, y + th + 5);
        gr.addColorStop(0, R.capLight); gr.addColorStop(0.4, R.cap); gr.addColorStop(1, R.capDark);
        g.fillStyle = gr; g.fill();
        // grass blades
        g.strokeStyle = R.cap; g.lineWidth = 1;
        g.beginPath();
        const nBl = over ? 9 : 5;
        for (let i = 0; i < nBl; i++) {
          const bx = x + h2(tx, ty, 80 + i) * T, bh = 2 + h2(tx, ty, 90 + i) * (over ? 7 : 5), lean = (h2(tx, ty, 100 + i) - 0.5) * 4;
          g.moveTo(bx, y); g.quadraticCurveTo(bx + lean * 0.3, y - bh * 0.6, bx + lean, y - bh);
        }
        g.stroke();
        g.strokeStyle = rgba(R.capLight, 0.8); g.lineWidth = 0.7; g.beginPath();
        for (let i = 0; i < 3; i++) { const bx = x + h2(tx, ty, 110 + i) * T, bh = 2 + h2(tx, ty, 120 + i) * 4; g.moveTo(bx, y); g.lineTo(bx + 1, y - bh); }
        g.stroke();
        if (!nb.l && over) { g.fillStyle = R.cap; g.fillRect(x - 1.5, y, 2.5, 6 + hv * 10); }
        if (!nb.r && over) { g.fillStyle = R.cap; g.fillRect(x + T - 1, y, 2.5, 6 + (1 - hv) * 10); }
        break;
      }
      case 'wet': {
        g.fillStyle = rgba(R.rim, 0.55); g.fillRect(x, y + 0.5, T, 1.3);
        g.fillStyle = rgba(R.rim, 0.15); g.fillRect(x, y + 1.8, T, 2.5);
        if (hv < 0.45) {
          const mx = x + hv * 30, mw = 10 + hv * 22;
          g.fillStyle = R.cap; g.beginPath(); g.ellipse(mx + mw / 2, y + 1, mw / 2, 3, 0, 0, TAU); g.fill();
          g.fillStyle = rgba(R.capLight, 0.8);
          for (let i = 0; i < 4; i++) g.fillRect(mx + h2(tx, ty, 130 + i) * mw, y - 0.5 + h2(tx, ty, 140 + i) * 2.5, 1.3, 1.3);
        }
        break;
      }
      case 'crystal': {
        g.fillStyle = rgba(R.rim, 0.5); g.fillRect(x, y + 0.5, T, 1.2);
        g.fillStyle = rgba(R.cap, 0.25); g.fillRect(x, y + 1.7, T, 2);
        if (hv < 0.3) crystalCluster(g, x + 6 + hv * 60, y + 2, (tx * 13 + ty * 7) >>> 0, 0.42, -Math.PI / 2);
        break;
      }
    }
  }

  function drawUnder(g, tx, ty, nb) {
    const x = tx * T, y = ty * T + T, R = S.pal.rock, st = S.st;
    const hv = h2(tx, ty, 75);
    const gr = g.createLinearGradient(0, y - 7, 0, y);
    gr.addColorStop(0, rgba(R.deep, 0)); gr.addColorStop(1, rgba(R.deep, 0.75));
    g.fillStyle = gr; g.fillRect(x, y - 7, T, 7);
    switch (st.under) {
      case 'strip': {
        g.fillStyle = R.line; g.fillRect(x, y - 3, T, 3);
        if (tx % 3 === 0) {
          g.fillStyle = rgba(S.pal.accent, 0.25); g.fillRect(x + 2, y - 1, T - 4, 4);
          g.fillStyle = S.pal.accent; g.fillRect(x + 3, y - 0.5, T - 6, 1.6);
        }
        break;
      }
      case 'rust': {
        if (hv < 0.4) { g.fillStyle = R.dark; g.beginPath(); g.moveTo(x + 4 + hv * 20, y - 1); g.lineTo(x + 9 + hv * 20, y + 4 + hv * 8); g.lineTo(x + 12 + hv * 20, y - 1); g.fill(); }
        if (hv > 0.7) { g.strokeStyle = rgba(R.detail, 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(x + hv * 28, y); g.lineTo(x + hv * 28, y + 3 + hv * 3); g.stroke(); }
        break;
      }
      case 'rock': case 'drip': {
        const n = st.under === 'drip' ? 2 : 1;
        for (let i = 0; i < n; i++) {
          if (h2(tx, ty, 150 + i) < 0.55) {
            const sx = x + 4 + h2(tx, ty, 160 + i) * 24, sl = 3 + h2(tx, ty, 170 + i) * (st.under === 'drip' ? 9 : 5), sw = 2 + h2(tx, ty, 180 + i) * 3;
            g.fillStyle = R.dark; g.beginPath(); g.moveTo(sx - sw, y - 1); g.lineTo(sx, y + sl); g.lineTo(sx + sw, y - 1); g.fill();
            g.fillStyle = rgba(R.rim, 0.35); g.beginPath(); g.moveTo(sx - sw * 0.6, y - 1); g.lineTo(sx, y + sl - 1); g.lineTo(sx - sw * 0.1, y - 1); g.fill();
          }
        }
        break;
      }
      case 'roots': {
        const over = S.variant === 'overgrown';
        g.strokeStyle = over ? S.pal.rock.cap : rgba(R.dark, 0.9); g.lineWidth = 1;
        g.beginPath();
        const n = over ? 3 : 2;
        for (let i = 0; i < n; i++) {
          if (h2(tx, ty, 190 + i) < 0.55) {
            const sx = x + h2(tx, ty, 200 + i) * T, l = 4 + h2(tx, ty, 210 + i) * (over ? 14 : 8);
            g.moveTo(sx, y - 1); g.quadraticCurveTo(sx + 3, y + l * 0.5, sx - 1, y + l);
          }
        }
        g.stroke();
        break;
      }
      case 'crystal': {
        if (hv < 0.25) crystalCluster(g, x + 8 + hv * 60, y - 1, (tx * 5 + ty * 11) >>> 0, 0.42, Math.PI / 2);
        break;
      }
      case 'conduit': {
        g.fillStyle = R.line; g.fillRect(x, y - 2.5, T, 2.5);
        if (hv < 0.18) { g.fillStyle = S.pal.accent2; g.fillRect(x + 14, y - 1.5, 4, 2); }
        break;
      }
    }
  }

  function drawSides(g, tx, ty, nb) {
    const x = tx * T, y = ty * T, R = S.pal.rock;
    if (!nb.l) { const gr = g.createLinearGradient(x, 0, x + 6, 0); gr.addColorStop(0, rgba(R.rim, 0.35)); gr.addColorStop(1, rgba(R.rim, 0)); g.fillStyle = gr; g.fillRect(x, y, 6, T); }
    if (!nb.r) { const gr = g.createLinearGradient(x + T - 8, 0, x + T, 0); gr.addColorStop(0, rgba(R.deep, 0)); gr.addColorStop(1, rgba(R.deep, 0.55)); g.fillStyle = gr; g.fillRect(x + T - 8, y, 8, T); }
    if (!nb.u) { g.fillStyle = rgba(R.rim, 0.55); g.fillRect(x, y, T, 1.4); }
  }

  // ================================================================== one-way platforms
  function drawOneWay(g, tx, ty) {
    const x = tx * T, y = ty * T, P = S.pal.plat, R = S.pal.rock;
    const lOW = codeAt(tx - 1, ty) === TC.ONEWAY, rOW = codeAt(tx + 1, ty) === TC.ONEWAY;
    const lS = solidAt(tx - 1, ty), rS = solidAt(tx + 1, ty);
    const hv = h2(tx, ty, 300);
    switch (S.st.plat) {
      case 'girder': {
        // top plate
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + 16, T, 4);
        const gr = g.createLinearGradient(0, y, 0, y + 5);
        gr.addColorStop(0, shade(P.top, 0.35)); gr.addColorStop(1, P.top);
        g.fillStyle = gr; g.fillRect(x, y, T, 5);
        g.fillStyle = P.dark; g.fillRect(x, y + 5, T, 1);
        // truss
        g.fillStyle = P.body; g.fillRect(x, y + 13, T, 3);
        g.strokeStyle = P.body; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + 16, y + 14); g.lineTo(x + 32, y + 6); g.moveTo(x, y + 14); g.lineTo(x + 16, y + 6); g.lineTo(x + 32, y + 14); g.stroke();
        g.strokeStyle = rgba(P.top, 0.35); g.lineWidth = 0.7;
        g.beginPath(); g.moveTo(x, y + 6.5); g.lineTo(x + 16, y + 14.5); g.stroke();
        g.fillStyle = P.dark; g.fillRect(x, y + 16, T, 1);
        g.fillStyle = shade(P.top, 0.5); g.fillRect(x + 15, y + 9, 2, 2);
        if (S.biome === 'wreck' && hv < 0.4) { const grr = g.createLinearGradient(0, y, 0, y + 16); grr.addColorStop(0, rgba(R.detail, 0.5)); grr.addColorStop(1, rgba(R.detail, 0)); g.fillStyle = grr; g.fillRect(x + hv * 50, y + 5, 6, 11); }
        if (!lOW) { g.fillStyle = P.dark; g.fillRect(x, y, 3, 17); if (!lS) hazardStripes(g, x + 3, y + 1, 8, 3); }
        if (!rOW) { g.fillStyle = P.dark; g.fillRect(x + T - 3, y, 3, 17); if (!rS) hazardStripes(g, x + T - 11, y + 1, 8, 3); }
        g.fillStyle = S.pal.accent; if (tx % 4 === 0) g.fillRect(x + 4, y + 2, 3, 1.2);
        break;
      }
      case 'slab': {
        const thick = 11;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + (lOW ? 0 : 3), y + thick, T - (lOW ? 0 : 3) - (rOW ? 0 : 3), 4);
        g.beginPath();
        const l = lOW ? x : x + 2, r = rOW ? x + T : x + T - 2;
        g.moveTo(l, y); g.lineTo(r, y);
        if (rOW) g.lineTo(r, y + thick); else { g.quadraticCurveTo(r + 2, y + 2, r, y + thick - 1); }
        for (let k = T; k >= 0; k -= 6) g.lineTo(x + k, y + thick - 1 + h2(x + k, ty, 301) * 3);
        if (!lOW) g.quadraticCurveTo(l - 2, y + 2, l, y);
        g.closePath();
        g.fillStyle = P.body; g.fill();
        const gr = g.createLinearGradient(0, y, 0, y + thick);
        gr.addColorStop(0, rgba(P.top, 0.0)); gr.addColorStop(1, rgba(P.dark, 0.6));
        g.fillStyle = gr; g.fill();
        g.fillStyle = P.top; g.fillRect(l, y, r - l, 2.5);
        g.fillStyle = rgba('#ffffff', 0.35); g.fillRect(l, y, r - l, 0.8);
        g.fillStyle = rgba(P.dark, 0.6); g.fillRect(l, y + 5 + hv * 2, r - l, 0.8);
        if (!lOW) { g.fillStyle = rgba(P.dark, 0.5); g.fillRect(l, y + 2, 1.2, thick - 3); }
        break;
      }
      case 'beam': {
        const thick = 12;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + thick, T, 4);
        g.fillStyle = P.body; g.fillRect(x, y, T, thick);
        g.fillStyle = shade(P.top, 0.1); g.fillRect(x, y, T, 3);
        g.fillStyle = rgba(P.dark, 0.8); g.fillRect(x, y + 3, T, 1); g.fillRect(x, y + thick - 2, T, 2);
        g.fillStyle = rgba(P.top, 0.25); g.fillRect(x, y + 4, T, 1);
        if (tx % 2 === 0) { g.fillStyle = rgba(P.accent, 0.25); g.fillRect(x + 12, y + 5.5, 8, 3.5); g.fillStyle = P.accent; g.fillRect(x + 13, y + 6.5, 6, 1.4); }
        if (!lOW) { g.fillStyle = P.dark; g.fillRect(x, y, 2, thick); g.fillStyle = shade(P.top, 0.2); g.fillRect(x + 2, y, 1, thick); }
        if (!rOW) { g.fillStyle = P.dark; g.fillRect(x + T - 2, y, 2, thick); }
        // moss tufts
        g.fillStyle = R.cap;
        if (hv < 0.5) { g.beginPath(); g.ellipse(x + 6 + hv * 30, y + 0.5, 6, 2, 0, 0, TAU); g.fill(); }
        if (S.variant === 'overgrown' && hv < 0.7) { g.strokeStyle = R.cap; g.lineWidth = 1; g.beginPath(); const vx = x + 8 + hv * 20; g.moveTo(vx, y + thick); g.quadraticCurveTo(vx + 3, y + thick + 6, vx, y + thick + 10 + hv * 10); g.stroke(); }
        break;
      }
      case 'grate': {
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + 10, T, 4);
        g.fillStyle = shade(P.top, 0.15); g.fillRect(x, y, T, 3);
        g.fillStyle = P.dark; g.fillRect(x, y + 3, T, 6);
        g.fillStyle = P.body; for (let k = 1; k < T; k += 4) g.fillRect(x + k, y + 3, 1.6, 6);
        g.fillStyle = P.body; g.fillRect(x, y + 8, T, 2.5);
        g.fillStyle = P.dark; g.fillRect(x, y + 10.5, T, 0.8);
        g.fillStyle = rgba('#ffffff', 0.25); g.fillRect(x, y, T, 0.8);
        if (!lOW) { g.fillStyle = P.dark; g.fillRect(x, y, 2.5, 11); }
        if (!rOW) { g.fillStyle = P.dark; g.fillRect(x + T - 2.5, y, 2.5, 11); }
        if (S.biome === 'caves' && hv < 0.45) { g.fillStyle = R.cap; g.beginPath(); g.ellipse(x + 8 + hv * 30, y + 1, 7, 2.2, 0, 0, TAU); g.fill(); g.strokeStyle = R.cap; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 10 + hv * 20, y + 10); g.lineTo(x + 11 + hv * 20, y + 16 + hv * 12); g.stroke(); }
        if (S.biome === 'tower' && tx % 3 === 0) { g.fillStyle = S.pal.accent; g.fillRect(x + 14, y + 1, 4, 1.2); }
        break;
      }
      case 'crystal': {
        const thick = 10;
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + thick, T, 4);
        const gr = g.createLinearGradient(0, y, 0, y + thick);
        gr.addColorStop(0, rgba(P.top, 0.95)); gr.addColorStop(0.4, rgba(P.body, 0.85)); gr.addColorStop(1, rgba(P.dark, 0.9));
        g.fillStyle = gr;
        g.beginPath();
        const l = lOW ? x : x + 3, r = rOW ? x + T : x + T - 3;
        g.moveTo(lOW ? x : x - 1, y); g.lineTo(rOW ? x + T : x + T + 1, y); g.lineTo(r, y + thick); g.lineTo(l, y + thick); g.closePath(); g.fill();
        g.strokeStyle = rgba(P.accent, 0.6); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x + 6 + hv * 10, y + 2); g.lineTo(x + 14 + hv * 10, y + thick - 1); g.moveTo(x + 22 - hv * 6, y + 2); g.lineTo(x + 18 - hv * 6, y + thick - 1); g.stroke();
        g.fillStyle = '#ffffff'; g.fillRect(x, y, T, 1.2);
        break;
      }
    }
  }

  // ================================================================== spikes
  function drawSpikes(g, tx, ty, down) {
    const x = tx * T, y = ty * T, P = S.pal.spike;
    g.save();
    if (down) { g.translate(0, y * 2 + T); g.scale(1, -1); }
    const base = y + T;
    const style = S.st.spike;
    // base plate
    if (style === 'steel' || style === 'bronze') {
      g.fillStyle = P.dark; g.fillRect(x, base - 5, T, 5);
      g.fillStyle = rgba(P.light, 0.35); g.fillRect(x, base - 5, T, 1);
      if (style === 'steel') { g.fillStyle = 'rgba(255,60,60,0.55)'; for (let k = 2; k < T; k += 8) g.fillRect(x + k, base - 3, 4, 1.4); }
      else { g.fillStyle = rgba(S.pal.accent, 0.8); g.fillRect(x + 10, base - 3, 12, 1.2); }
    } else {
      g.fillStyle = P.dark; g.beginPath(); g.ellipse(x + 16, base, 17, 4, 0, Math.PI, TAU); g.fill();
    }
    const n = 4;
    for (let i = 0; i < n; i++) {
      const jitter = style === 'steel' || style === 'bronze' ? 0 : (h2(tx, ty, 310 + i) - 0.5);
      const cx = x + 4 + i * 8 + jitter * 2;
      const hgt = (style === 'steel' || style === 'bronze' ? 18 : 15 + h2(tx, ty, 320 + i) * 6) + (style === 'shard' ? h2(tx, ty, 330 + i) * 4 : 0);
      const wd = style === 'crystal' ? 3.6 : 4;
      const top = base - (style === 'steel' || style === 'bronze' ? 5 : 1) - hgt;
      const lean = style === 'thorn' ? jitter * 4 : style === 'shard' ? jitter * 6 : 0;
      const tipX = cx + lean, b0 = base - (style === 'steel' || style === 'bronze' ? 5 : 1);
      // outline for readability
      g.beginPath(); g.moveTo(cx - wd - 0.8, b0 + 0.5); g.lineTo(tipX, top - 1.2); g.lineTo(cx + wd + 0.8, b0 + 0.5); g.closePath();
      g.fillStyle = P.dark; g.fill();
      // dark half
      g.beginPath(); g.moveTo(cx, b0); g.lineTo(tipX, top); g.lineTo(cx + wd, b0); g.closePath();
      g.fillStyle = style === 'crystal' ? shade(P.base, -0.1) : P.base; g.fill();
      // lit half
      g.beginPath(); g.moveTo(cx - wd, b0); g.lineTo(tipX, top); g.lineTo(cx, b0); g.closePath();
      g.fillStyle = mix(P.base, P.light, style === 'crystal' ? 0.55 : 0.45); g.fill();
      // red danger tip
      const tipH = hgt * 0.42;
      g.beginPath(); g.moveTo(tipX + (cx - wd - tipX) * 0.42, top + tipH); g.lineTo(tipX, top); g.lineTo(tipX + (cx + wd - tipX) * 0.42, top + tipH); g.closePath();
      const gr = g.createLinearGradient(0, top, 0, top + tipH);
      gr.addColorStop(0, P.tip); gr.addColorStop(1, rgba(P.tip, 0));
      g.fillStyle = gr; g.fill();
      g.strokeStyle = rgba('#ffffff', 0.85); g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(tipX, top + 0.5); g.lineTo(tipX - wd * 0.4, top + hgt * 0.4); g.stroke();
    }
    g.restore();
  }

  // ================================================================== chunk cache
  function chunkHasContent(cx, cy) {
    const tx0 = cx * CHUNK - 1, ty0 = cy * CHUNK - 1;
    for (let ty = Math.max(0, ty0); ty <= Math.min(S.h - 1, ty0 + CHUNK + 1); ty++) {
      for (let tx = Math.max(0, tx0); tx <= Math.min(S.w - 1, tx0 + CHUNK + 1); tx++) {
        const c = S.grid[ty * S.w + tx];
        if (c === TC.SOLID || c === TC.ONEWAY || c === TC.SPIKE_UP || c === TC.SPIKE_DOWN) return true;
      }
    }
    return false;
  }

  function buildChunk(cx, cy) {
    const tx0 = cx * CHUNK, ty0 = cy * CHUNK;
    const X0 = tx0 * T - PAD, Y0 = ty0 * T - PAD, SZ = CPX + PAD * 2;
    const scat = S.scatter.filter((s) => s.x1 > X0 && s.x0 < X0 + SZ && s.y1 > Y0 && s.y0 < Y0 + SZ);
    if (!scat.length && !chunkHasContent(cx, cy)) return null;
    const cs = S.cs;
    const c = mk(SZ * cs, SZ * cs), g = c.getContext('2d');
    g.scale(cs, cs); g.translate(-X0, -Y0);
    g.beginPath(); g.rect(X0, Y0, SZ, SZ); g.clip();
    const st = S.st, R = S.pal.rock;
    const sol = [], misc = [];
    const mx0 = Math.max(0, tx0 - 1), mx1 = Math.min(S.w - 1, tx0 + CHUNK), my0 = Math.max(0, ty0 - 1), my1 = Math.min(S.h - 1, ty0 + CHUNK);
    for (let ty = my0; ty <= my1; ty++) {
      for (let tx = mx0; tx <= mx1; tx++) {
        const code = S.grid[ty * S.w + tx];
        if (code === TC.SOLID) sol.push([tx, ty, nbOf(tx, ty), depthAt(tx, ty)]);
        else if (code === TC.ONEWAY || code === TC.SPIKE_UP || code === TC.SPIKE_DOWN) misc.push([tx, ty, code]);
      }
    }
    // A: soft dark halo + outline (internal edges get covered by bodies)
    g.lineJoin = 'round';
    for (const s of sol) {
      if (s[3] > 1) continue;
      g.beginPath(); tilePath(g, s[0], s[1], s[2], st, 0);
      g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 9; g.stroke();
      g.strokeStyle = R.line; g.lineWidth = 3.2; g.stroke();
    }
    // B: bodies (material pattern, world aligned)
    g.fillStyle = S.pattern || R.base;
    for (const s of sol) { g.beginPath(); tilePath(g, s[0], s[1], s[2], st, 0); g.fill(); }
    // depth darkening: tiny per-tile alpha map scaled up with bilinear smoothing (source-atop = only on solids)
    if (sol.length) {
      const dw = CHUNK + 2;
      const dc = mk(dw, dw), dg = dc.getContext('2d');
      const im = dg.createImageData(dw, dw);
      const deep = Pal.rgbOf(R.deep);
      for (let j = 0; j < dw; j++) for (let i = 0; i < dw; i++) {
        const d = depthAt(tx0 - 1 + i, ty0 - 1 + j);
        const tx = tx0 - 1 + i, ty = ty0 - 1 + j;
        const solid = tx >= 0 && tx < S.w && ty >= 0 && ty < S.h ? S.grid[ty * S.w + tx] === TC.SOLID : true;
        const a = !solid ? 0 : d <= 1 ? 0 : d === 2 ? 0.42 : d === 3 ? 0.66 : 0.8;
        const k = (j * dw + i) * 4;
        im.data[k] = deep[0]; im.data[k + 1] = deep[1]; im.data[k + 2] = deep[2]; im.data[k + 3] = a * 255;
      }
      dg.putImageData(im, 0, 0);
      g.save();
      g.globalCompositeOperation = 'source-atop';
      g.imageSmoothingEnabled = true;
      g.drawImage(dc, (tx0 - 1) * T + T / 2 - T / 2, (ty0 - 1) * T, dw * T, dw * T);
      g.restore();
    }
    // C: per-tile detail, clipped
    for (const s of sol) {
      if (s[3] > 3) continue;
      g.save(); g.beginPath(); tilePath(g, s[0], s[1], s[2], st, 0); g.clip();
      drawBodyDetail(g, s[0], s[1], s[2], s[3]);
      drawSides(g, s[0], s[1], s[2]);
      g.restore();
    }
    // D: caps + undersides (may overhang into empty neighbours)
    for (const s of sol) {
      const nb = s[2];
      if (!nb.u && openAt(s[0], s[1] - 1) !== false && codeAt(s[0], s[1] - 1) !== TC.SOLID) drawCap(g, s[0], s[1], nb);
      if (!nb.d && s[1] < S.h - 1) drawUnder(g, s[0], s[1], nb);
    }
    // E: one-ways and spikes
    for (const m of misc) {
      if (m[2] === TC.ONEWAY) drawOneWay(g, m[0], m[1]);
      else drawSpikes(g, m[0], m[1], m[2] === TC.SPIKE_DOWN);
    }
    // F: static scatter
    for (const s of scat) drawScatterStatic(g, s);
    return c;
  }

  function getChunk(cx, cy) {
    const key = cx + ',' + cy;
    let e = S.chunks.get(key);
    if (!e) {
      e = { c: buildChunk(cx, cy), used: 0 };
      S.chunks.set(key, e);
      if (S.chunks.size > MAX_CHUNKS * 2) evict();
    }
    e.used = ++S.useTick;
    return e.c;
  }
  function evict() {
    // keep empty (null) entries cheap; evict least-recently-used canvases beyond the cap
    const withCanvas = [...S.chunks.entries()].filter((kv) => kv[1].c);
    if (withCanvas.length <= MAX_CHUNKS && S.chunks.size < 400) return;
    withCanvas.sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < withCanvas.length - MAX_CHUNKS; i++) S.chunks.delete(withCanvas[i][0]);
  }

  // ================================================================== crumble sprites
  function buildCrumbleSprites() {
    S.crumbleSpr = [];
    const cs = S.cs, P = S.pal.crumble, R = S.pal.rock;
    for (let v = 0; v < 2; v++) {
      const c = mk((T + 8) * cs, (T + 8) * cs), g = c.getContext('2d');
      g.scale(cs, cs); g.translate(4, 4);
      const pieces = v === 0 ? [[0, 0, 15, 32], [15, 0, 17, 17], [15, 17, 17, 15]] : [[0, 0, 18, 15], [0, 15, 13, 17], [13, 15, 19, 17], [18, 0, 14, 15]];
      for (const p of pieces) {
        const [px, py, pw, ph] = p;
        g.beginPath();
        const ch = 2.5;
        g.moveTo(px + ch, py + 0.6); g.lineTo(px + pw - 0.6, py + 0.6); g.lineTo(px + pw - 0.6, py + ph - ch); g.lineTo(px + pw - ch, py + ph - 0.6); g.lineTo(px + 0.6, py + ph - 0.6); g.lineTo(px + 0.6, py + ch); g.closePath();
        g.save();
        g.strokeStyle = P.crack; g.lineWidth = 2.4; g.stroke();
        if (S.pattern) { g.fillStyle = S.pattern; g.fill(); }
        g.fillStyle = rgba(P.base, 0.62); g.fill();
        g.clip();
        const gr = g.createLinearGradient(0, py, 0, py + ph);
        gr.addColorStop(0, rgba(P.light, 0.55)); gr.addColorStop(0.35, rgba(P.light, 0)); gr.addColorStop(1, rgba(P.dark, 0.5));
        g.fillStyle = gr; g.fillRect(px, py, pw, ph);
        g.fillStyle = rgba(P.light, 0.7); g.fillRect(px, py, pw, 1.2); g.fillRect(px, py, 1.2, ph);
        g.restore();
      }
      // cracks
      g.strokeStyle = P.crack; g.lineWidth = 1.1;
      const r = G.rng(901 + v);
      for (let k = 0; k < 3; k++) {
        g.beginPath(); let cx = 4 + r() * 24, cy = 2 + r() * 8; g.moveTo(cx, cy);
        for (let i = 0; i < 4; i++) { cx += (r() - 0.5) * 9; cy += 3 + r() * 5; g.lineTo(cx, cy); }
        g.stroke();
      }
      // top cap hint so the block reads as standable but distinct (dashed warning edge)
      g.fillStyle = R.cap; g.fillRect(0, -0.5, T, 2.4);
      g.fillStyle = rgba(P.crack, 0.9);
      for (let k = 3; k < T; k += 8) g.fillRect(k, -0.5, 3, 2.4);
      // chipped corner
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); if (v === 0) { g.moveTo(T - 7, T); g.lineTo(T, T - 6); g.lineTo(T, T); } else { g.moveTo(0, T - 6); g.lineTo(6, T); g.lineTo(0, T); } g.fill();
      g.globalCompositeOperation = 'source-over';
      S.crumbleSpr.push(c);
    }
  }

  // ================================================================== auto scatter (init)
  const SCATTER = {
    ship:    { top: [['bolts', 0.10], ['cablef', 0.05], ['boxs', 0.04]], under: [['cableh', 0.07], ['lampc', 0.06]], side: [['striplight', 0.09]] },
    wreck:   { top: [['sandpile', 0.12], ['shard', 0.08], ['cablef', 0.04]], under: [['cableh', 0.08], ['sanddrip', 0.05]], side: [['striplight', 0.03]] },
    desert:  { top: [['pebbles', 0.14], ['drygrass', 0.10], ['bone', 0.015]], under: [['roots', 0.05]], side: [] },
    canyon:  { top: [['pebbles', 0.14], ['drygrass', 0.09], ['shrub', 0.05]], under: [['roots', 0.08]], side: [] },
    ruins:   { top: [['grass', 0.16], ['rubble', 0.07], ['flower', 0.04]], under: [['roots', 0.08]], side: [['glyphw', 0.05]] },
    ruins_overgrown: { top: [['fern', 0.16], ['flower', 0.12], ['grass', 0.14], ['mushS', 0.05]], under: [['vineh', 0.22]], side: [['glyphw', 0.04], ['mossw', 0.06]] },
    caves:   { top: [['pebbles', 0.10], ['stalagS', 0.08], ['mossglow', 0.08], ['mushS', 0.05]], under: [['stalac', 0.22]], side: [['mossw', 0.06]] },
    crystal: { top: [['crys', 0.14], ['pebbles', 0.06]], under: [['crysd', 0.14]], side: [['crysw', 0.06]] },
    tower:   { top: [['bolts', 0.08], ['puddle', 0.06]], under: [['chain', 0.05], ['drip', 0.08]], side: [['conduitw', 0.05]] },
  };
  const ANIM_KINDS = new Set(['lampc', 'striplight', 'flower', 'glyphw', 'mossglow', 'mushS', 'mossw', 'stalac', 'crys', 'crysd', 'crysw', 'conduitw', 'drip', 'cableh', 'sanddrip', 'vineh', 'puddle']);

  function buildScatter(level) {
    S.scatter = []; S.anim = [];
    const blocked = new Uint8Array(S.w * S.h);
    const block = (x0, y0, x1, y1) => {
      for (let ty = Math.max(0, y0); ty <= Math.min(S.h - 1, y1); ty++) for (let tx = Math.max(0, x0); tx <= Math.min(S.w - 1, x1); tx++) blocked[ty * S.w + tx] = 1;
    };
    for (const e of level.entities) {
      if (e.type === 'deco' || e.type === 'trigger' || e.type === 'hint') continue;
      const x0 = Math.floor(e.x / T), y0 = Math.floor(e.y / T), x1 = Math.floor((e.x + Math.max(1, e.w) - 1) / T), y1 = Math.floor((e.y + Math.max(1, e.h) - 1) / T);
      block(x0 - 1, y0 - 1, x1 + 1, y1 + 1);
      if (e.path) for (const p of e.path) block(p[0] - 1, p[1] - 1, p[0] + (e.w || 1), p[1] + 1);
    }
    for (let ty = 0; ty < S.h; ty++) for (let tx = 0; tx < S.w; tx++) {
      const ch = level.charAt(tx, ty);
      if ('PCEBJ*'.includes(ch)) block(tx - 1, ty - 1, tx + 1, ty + 1);
    }
    const R = G.rng(S.seed ^ 0x5eed);
    const cfg = SCATTER[S.key] || SCATTER[S.biome] || SCATTER.desert;
    const pick = (list) => { for (const [k, p] of list) if (R() < p) return k; return null; };
    for (let ty = 0; ty < S.h; ty++) {
      for (let tx = 0; tx < S.w; tx++) {
        if (S.grid[ty * S.w + tx] !== TC.SOLID) continue;
        // top surface
        if (ty > 0 && S.grid[(ty - 1) * S.w + tx] === TC.EMPTY && level.charAt(tx, ty - 1) === '.' && !blocked[(ty - 1) * S.w + tx]) {
          const k = pick(cfg.top);
          if (k) addScatter(k, tx * T + 4 + R() * 24, ty * T, R(), 'top');
        }
        // underside
        if (ty < S.h - 1 && S.grid[(ty + 1) * S.w + tx] === TC.EMPTY && !blocked[(ty + 1) * S.w + tx] && (ty + 2 >= S.h || S.grid[(ty + 2) * S.w + tx] !== TC.SOLID || R() < 0.3)) {
          const k = pick(cfg.under);
          if (k) addScatter(k, tx * T + 6 + R() * 20, ty * T + T, R(), 'under');
        }
        // walls
        for (const dir of [-1, 1]) {
          const nx = tx + dir;
          if (nx < 0 || nx >= S.w || S.grid[ty * S.w + nx] !== TC.EMPTY || blocked[ty * S.w + nx]) continue;
          if (!solidAt(tx, ty - 1) || !solidAt(tx, ty + 1)) continue;
          const k = pick(cfg.side);
          if (k) addScatter(k, dir > 0 ? tx * T + T : tx * T, ty * T + 6 + R() * 20, R(), 'side', dir);
        }
      }
    }
  }

  function addScatter(k, x, y, r, where, dir) {
    const s = { k, x, y, r, where, dir: dir || 0, x0: x - 24, x1: x + 24, y0: y - 30, y1: y + 30 };
    if (k === 'stalac') { s.len = 14 + r * 30; s.y1 = y + s.len + 4; }
    if (k === 'vineh') { s.len = 22 + r * 60; s.y1 = y + s.len + 6; }
    if (k === 'cableh') { s.len = 10 + r * 26; s.y1 = y + s.len + 6; }
    if (k === 'chain') { s.len = 16 + r * 40; s.y1 = y + s.len + 6; }
    S.scatter.push(s);
    if (ANIM_KINDS.has(k)) S.anim.push(s);
  }

  /** Static part of a scatter item (baked into the chunk). */
  function drawScatterStatic(g, s) {
    const P = S.pal, R = P.rock, x = s.x, y = s.y, r = s.r;
    switch (s.k) {
      case 'bolts': g.fillStyle = R.line; g.fillRect(x - 5, y - 2, 10, 2); g.fillStyle = R.light; g.fillRect(x - 4, y - 3, 3, 1.5); g.fillRect(x + 1, y - 3, 3, 1.5); break;
      case 'boxs': g.fillStyle = R.line; g.fillRect(x - 7, y - 9, 14, 9); g.fillStyle = mix(R.cap, R.dark, 0.3); g.fillRect(x - 6, y - 8, 12, 7); g.fillStyle = rgba(R.capLight, 0.6); g.fillRect(x - 6, y - 8, 12, 1); g.fillStyle = r < 0.5 ? P.accent : '#f2b33a'; g.fillRect(x - 4, y - 6, 3, 1.2); break;
      case 'cablef': g.strokeStyle = '#111418'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x - 16, y - 1); g.bezierCurveTo(x - 8, y - 6, x + 2, y + 1, x + 14, y - 3); g.stroke(); g.strokeStyle = r < 0.5 ? '#c03a2a' : '#2a6ac0'; g.lineWidth = 0.8; g.stroke(); break;
      case 'sandpile': { g.fillStyle = R.cap; g.beginPath(); g.moveTo(x - 14 - r * 6, y + 1); g.quadraticCurveTo(x, y - 6 - r * 6, x + 14 + r * 6, y + 1); g.fill(); g.strokeStyle = rgba(R.capLight, 0.8); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x - 8, y - 2); g.quadraticCurveTo(x, y - 5 - r * 6, x + 6, y - 2.5); g.stroke(); break; }
      case 'shard': g.fillStyle = r < 0.5 ? rgba('#bfe8ff', 0.6) : R.light; g.beginPath(); g.moveTo(x - 4, y); g.lineTo(x - 1, y - 6 - r * 4); g.lineTo(x + 3, y); g.fill(); g.fillStyle = R.dark; g.fillRect(x + 4, y - 2, 6, 2); break;
      case 'pebbles': for (let i = 0; i < 3; i++) { const px = x - 8 + h2(x | 0, i, 5) * 16, pr = 1.2 + h2(x | 0, i, 6) * 2.4; g.fillStyle = R.dark; g.beginPath(); g.ellipse(px, y - pr * 0.6, pr * 1.3, pr, 0, 0, TAU); g.fill(); g.fillStyle = rgba(R.rim, 0.6); g.beginPath(); g.ellipse(px - 0.3, y - pr * 0.9, pr * 0.8, pr * 0.4, 0, 0, TAU); g.fill(); } break;
      case 'drygrass': case 'grass': case 'fern': {
        const dry = s.k === 'drygrass';
        const n = s.k === 'fern' ? 7 : 6, hgt = s.k === 'fern' ? 12 + r * 10 : 5 + r * 7;
        g.strokeStyle = dry ? mix(R.capDark, '#e8c890', 0.4) : R.cap; g.lineWidth = s.k === 'fern' ? 1.4 : 1;
        g.beginPath();
        for (let i = 0; i < n; i++) { const a = (i / (n - 1) - 0.5) * (dry ? 1.6 : 1.2); g.moveTo(x, y); g.quadraticCurveTo(x + Math.sin(a) * hgt * 0.4, y - hgt * 0.7, x + Math.sin(a) * hgt, y - Math.cos(a) * hgt); }
        g.stroke();
        if (!dry) { g.strokeStyle = rgba(R.capLight, 0.8); g.lineWidth = 0.7; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 1, y - hgt * 0.6, x + 2, y - hgt); g.stroke(); }
        break;
      }
      case 'bone': g.strokeStyle = '#f0e0c8'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x - 7, y - 1); g.quadraticCurveTo(x, y - 6, x + 7, y - 1); g.stroke(); g.fillStyle = '#f0e0c8'; g.beginPath(); g.arc(x - 7, y - 1, 1.6, 0, TAU); g.arc(x + 7, y - 1, 1.6, 0, TAU); g.fill(); break;
      case 'shrub': g.strokeStyle = mix(R.capDark, '#3a2010', 0.4); g.lineWidth = 1; g.beginPath(); for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i / 5 - 0.5) * 2.2; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (6 + r * 6), y + Math.sin(a) * (6 + r * 6)); } g.stroke(); break;
      case 'rubble': g.fillStyle = R.dark; g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x - 5, y - 5); g.lineTo(x + 1, y - 4); g.lineTo(x + 3, y); g.fill(); g.fillStyle = R.light; g.beginPath(); g.moveTo(x - 5, y - 5); g.lineTo(x + 1, y - 4); g.lineTo(x - 2, y - 2); g.fill(); g.fillStyle = R.base; g.fillRect(x + 4, y - 3, 4, 3); break;
      case 'flower': case 'mushS': {
        if (s.k === 'flower') { g.strokeStyle = R.cap; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 2, y - 5, x + (r - 0.5) * 4, y - 8 - r * 4); g.stroke(); }
        else { for (let i = 0; i < 3; i++) { const mx = x - 5 + i * 5, mh = 3 + h2(x | 0, i, 9) * 5; g.fillStyle = '#c8d8c8'; g.fillRect(mx - 0.6, y - mh, 1.2, mh); g.fillStyle = S.key === 'caves' ? '#2a6a6a' : '#4a3a6a'; g.beginPath(); g.ellipse(mx, y - mh, 2.6, 1.6, 0, Math.PI, TAU); g.fill(); } }
        break;
      }
      case 'stalagS': g.fillStyle = R.dark; g.beginPath(); g.moveTo(x - 4 - r * 2, y + 1); g.lineTo(x, y - 6 - r * 10); g.lineTo(x + 4 + r * 2, y + 1); g.fill(); g.fillStyle = rgba(R.rim, 0.35); g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x, y - 5 - r * 10); g.lineTo(x - 0.5, y); g.fill(); break;
      case 'stalac': {
        const w = 4 + r * 5;
        g.fillStyle = R.dark; g.beginPath(); g.moveTo(x - w, y - 1); g.quadraticCurveTo(x - w * 0.3, y + s.len * 0.6, x, y + s.len); g.quadraticCurveTo(x + w * 0.3, y + s.len * 0.6, x + w, y - 1); g.fill();
        g.fillStyle = rgba(R.rim, 0.32); g.beginPath(); g.moveTo(x - w * 0.6, y - 1); g.quadraticCurveTo(x - w * 0.2, y + s.len * 0.5, x - 0.3, y + s.len - 2); g.lineTo(x - w * 0.1, y - 1); g.fill();
        g.strokeStyle = R.line; g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + w, y - 1); g.quadraticCurveTo(x + w * 0.3, y + s.len * 0.6, x, y + s.len); g.stroke();
        break;
      }
      case 'crys': crystalCluster(g, x, y + 1, (x * 7 + y) >>> 0, 0.55 + r * 0.5, -Math.PI / 2); break;
      case 'crysd': crystalCluster(g, x, y - 1, (x * 3 + y) >>> 0, 0.55 + r * 0.5, Math.PI / 2); break;
      case 'crysw': crystalCluster(g, x, y, (x * 5 + y) >>> 0, 0.5 + r * 0.4, s.dir > 0 ? 0 : Math.PI); break;
      case 'roots': g.strokeStyle = rgba(R.dark, 0.9); g.lineWidth = 1.2; g.beginPath(); for (let i = 0; i < 3; i++) { const rx = x - 6 + i * 6; const l = 6 + h2(x | 0, i, 3) * 14; g.moveTo(rx, y); g.bezierCurveTo(rx + 3, y + l * 0.3, rx - 3, y + l * 0.7, rx + 1, y + l); } g.stroke(); break;
      case 'vineh': case 'cableh': case 'chain': {
        g.strokeStyle = s.k === 'vineh' ? R.cap : s.k === 'chain' ? '#3a4048' : '#121418';
        g.lineWidth = s.k === 'vineh' ? 1.6 : s.k === 'chain' ? 1.8 : 2.2;
        g.beginPath();
        if (s.k === 'cableh') { g.moveTo(x - 6, y); g.bezierCurveTo(x - 6, y + s.len, x + 8, y + s.len, x + 8, y); }
        else { g.moveTo(x, y); g.bezierCurveTo(x + 4, y + s.len * 0.3, x - 4, y + s.len * 0.6, x + (r - 0.5) * 6, y + s.len); }
        g.stroke();
        if (s.k === 'vineh') { g.fillStyle = R.capLight; for (let k = 8; k < s.len; k += 9) { g.beginPath(); g.ellipse(x + Math.sin(k) * 2.5, y + k, 2.4, 1.2, k, 0, TAU); g.fill(); } }
        if (s.k === 'chain') { g.strokeStyle = '#6a7480'; g.lineWidth = 0.8; for (let k = 3; k < s.len; k += 5) { g.beginPath(); g.ellipse(x + (r - 0.5) * 6 * (k / s.len), y + k, 1.4, 2.2, 0, 0, TAU); g.stroke(); } }
        break;
      }
      case 'lampc': g.fillStyle = R.line; g.fillRect(x - 7, y - 1, 14, 4); g.fillStyle = '#d8f4ff'; g.fillRect(x - 5, y + 2, 10, 1.6); break;
      case 'striplight': { const yy = y - 4; const xx = s.dir > 0 ? x + 1 : x - 3; g.fillStyle = R.line; g.fillRect(xx - 1, yy - 1, 4, 18); g.fillStyle = P.accent; g.fillRect(xx, yy, 2, 16); break; }
      case 'glyphw': glyphMark(g, x + s.dir * -7, y + 4, (x * 13 + y) >>> 0, R.detail, 0.9); break;
      case 'conduitw': { const xx = s.dir > 0 ? x : x - 4; g.fillStyle = R.line; g.fillRect(xx, y - 10, 4, 24); g.fillStyle = P.accent; g.fillRect(xx + 1.4, y - 9, 1.2, 22); break; }
      case 'mossglow': case 'mossw': { const mx = s.k === 'mossw' ? x - s.dir * 2 : x; g.fillStyle = R.cap; g.beginPath(); g.ellipse(mx, y, s.k === 'mossw' ? 3 : 9, s.k === 'mossw' ? 8 : 2.6, 0, 0, TAU); g.fill(); break; }
      case 'puddle': g.fillStyle = rgba('#8aa8d0', 0.35); g.beginPath(); g.ellipse(x, y + 0.5, 10 + r * 6, 1.6, 0, 0, TAU); g.fill(); break;
      case 'sanddrip': g.fillStyle = R.cap; g.beginPath(); g.ellipse(x, y + 1, 4, 2, 0, 0, TAU); g.fill(); break;
      case 'drip': g.fillStyle = rgba(R.rim, 0.5); g.beginPath(); g.arc(x, y + 1.5, 1.2, 0, TAU); g.fill(); break;
    }
  }

  /** Animated overlay for scatter items (per frame, additive where glowing). */
  function drawScatterAnim(ctx, s, t) {
    const P = S.pal, x = s.x, y = s.y, ph = s.r * 37.7;
    switch (s.k) {
      case 'lampc': glow(ctx, '#bfefff', x, y + 4, 26, 0.32 + 0.04 * Math.sin(t * 7 + ph)); break;
      case 'striplight': { const fl = frac(t * 0.13 + s.r) < 0.02 ? 0.1 : 1; glow(ctx, P.accent, x + (s.dir > 0 ? 2 : -2), y + 4, 18, 0.35 * fl); break; }
      case 'flower': { const a = 0.55 + 0.35 * Math.sin(t * 1.6 + ph); const col = s.r < 0.5 ? P.accent2 : P.accent; const fx = x + (s.r - 0.5) * 4 + Math.sin(t * 1.3 + ph) * 0.8, fy = y - 8 - s.r * 4; glow(ctx, col, fx, fy, 9, a * 0.7); ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff'; ctx.fillRect(fx - 0.8, fy - 0.8, 1.6, 1.6); break; }
      case 'glyphw': glow(ctx, P.rock.detail, x + s.dir * -7, y + 4, 16, 0.25 + 0.2 * Math.sin(t * 1.2 + ph)); break;
      case 'mossglow': case 'mossw': { const a = 0.3 + 0.2 * Math.sin(t * 0.9 + ph); glow(ctx, P.rock.capLight, s.k === 'mossw' ? x - s.dir * 2 : x, y, 14, a); break; }
      case 'mushS': glow(ctx, P.accent, x, y - 5, 12, 0.35 + 0.2 * Math.sin(t * 1.4 + ph)); break;
      case 'crys': case 'crysd': case 'crysw': {
        const k = Math.pow(Math.max(0, Math.sin(t * 0.7 + ph)), 18);
        if (k > 0.02) { const gy = s.k === 'crysd' ? y + 8 : s.k === 'crys' ? y - 8 : y; glow(ctx, '#ffffff', x, gy, 10, k); ctx.globalAlpha = k; ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 5 * k, gy - 0.5, 10 * k, 1); ctx.fillRect(x - 0.5, gy - 5 * k, 1, 10 * k); }
        glow(ctx, P.rock.cap, x, s.k === 'crysd' ? y + 6 : y - 6, 12, 0.18);
        break;
      }
      case 'conduitw': { const p = frac(t * 0.6 + s.r); glow(ctx, P.accent, x + (s.dir > 0 ? 2 : -2), y - 10 + p * 24, 8, 0.6); break; }
      case 'stalac': case 'drip': {
        const tipY = s.k === 'stalac' ? y + s.len : y + 2;
        const period = 2.2 + s.r * 3.5, p = frac(t / period + s.r * 3.1);
        const fallT = 0.55;
        const col = S.biome === 'caves' ? '#bfeff0' : '#c8d8f0';
        if (p < 0.6) { const sz = 1 + p * 1.6; ctx.globalAlpha = 0.85; ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, tipY + sz, sz * 0.8, sz, 0, 0, TAU); ctx.fill(); }
        else { const ft = (p - 0.6) * period; if (ft < fallT) { const dy = 0.5 * 1400 * ft * ft; ctx.globalAlpha = 0.8; ctx.fillStyle = col; ctx.fillRect(x - 0.8, tipY + dy, 1.6, 4); } }
        break;
      }
      case 'cableh': {
        if (S.biome !== 'wreck' && s.r > 0.3) break;
        const p = frac(t * 0.35 + s.r * 7);
        if (p < 0.06) {
          const sx = x + 8, sy = y;
          glow(ctx, '#ffd36a', sx, sy + 2, 14, 0.9 - p * 10);
          ctx.globalAlpha = 1; ctx.strokeStyle = '#fff2c0'; ctx.lineWidth = 1; ctx.beginPath();
          const k = Math.floor(t * 30);
          for (let i = 0; i < 4; i++) { const a = h2(k, i, 3) * Math.PI, l = 4 + h2(k, i, 4) * 10; ctx.moveTo(sx, sy + 2); ctx.lineTo(sx + Math.cos(a) * l, sy + 2 + Math.sin(a) * l); }
          ctx.stroke();
        }
        break;
      }
      case 'sanddrip': {
        ctx.globalAlpha = 0.6; ctx.fillStyle = P.rock.capLight;
        for (let i = 0; i < 5; i++) { const p = frac(t * 0.9 + i / 5 + s.r); ctx.fillRect(x - 0.6 + Math.sin(i * 3 + t) * 0.6, y + p * 70, 1.2, 2.5); }
        break;
      }
      case 'vineh': { glow(ctx, P.accent2, x + (s.r - 0.5) * 6, y + s.len, 8, 0.5 + 0.3 * Math.sin(t * 1.5 + ph)); break; }
      case 'puddle': { const p = frac(t * 1.7 + s.r * 5); ctx.globalAlpha = 0.5 * (1 - p); ctx.strokeStyle = '#c8d8f0'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.ellipse(x + (s.r - 0.5) * 10, y, 1 + p * 6, 0.5 + p * 1.2, 0, 0, TAU); ctx.stroke(); break; }
    }
  }

  // ================================================================== backgrounds
  function strip(h) { const c = mk(SW, h); return { c, g: c.getContext('2d'), h }; }
  /** Call fn(x) and its wrapped twins so content tiles seamlessly at SW. */
  function wrapX(x, half, fn) { fn(x); if (x + half > SW) fn(x - SW); if (x - half < 0) fn(x + SW); }
  function fillProfile(g, h, f, fill, fromTop) {
    g.beginPath();
    g.moveTo(0, fromTop ? 0 : h);
    for (let x = 0; x <= SW; x += 4) g.lineTo(x, f(x));
    g.lineTo(SW, fromTop ? 0 : h);
    g.closePath();
    g.fillStyle = fill; g.fill();
  }
  function hazeOver(g, w, h, col, a0, a1, y0, y1) {
    g.save(); g.globalCompositeOperation = 'source-atop';
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, rgba(col, a0)); gr.addColorStop(1, rgba(col, a1));
    g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1) - 1, w, Math.abs(y1 - y0) + 2);
    if (y1 < h) { g.fillStyle = rgba(col, a1); g.fillRect(0, y1, w, h - y1); }
    g.restore();
  }
  function rimLight(g, f, col, a, w, from, to) {
    g.beginPath();
    for (let x = from || 0; x <= (to || SW); x += 4) { if (x === (from || 0)) g.moveTo(x, f(x)); else g.lineTo(x, f(x)); }
    g.strokeStyle = rgba(col, a); g.lineWidth = w || 1.5; g.stroke();
  }
  function stars(g, w, h, n, seed, maxY, col) {
    const r = G.rng(seed);
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = r() * maxY, s = r();
      const a = (0.25 + s * 0.75) * (1 - y / maxY) ** 0.6;
      g.fillStyle = rgba(col || '#ffffff', a);
      const sz = s > 0.96 ? 2 : s > 0.75 ? 1.4 : 1;
      g.fillRect(x, y, sz, sz);
      if (s > 0.985) { g.fillStyle = rgba(col || '#ffffff', a * 0.4); g.fillRect(x - 2, y + 0.5, 5, 0.6); g.fillRect(x + 0.5, y - 2, 0.6, 5); }
    }
  }
  function skyGradient(g, w, h, stops) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  function softBlob(g, x, y, rx, ry, col, a) {
    g.save(); g.translate(x, y); g.scale(rx / 50, ry / 50);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 50);
    gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(-50, -50, 100, 100);
    g.restore();
  }

  const SKY_W = W + 260, SKY_H = H + 180;
  function makeSky(paint) {
    const c = mk(SKY_W, SKY_H), g = c.getContext('2d');
    paint(g, SKY_W, SKY_H);
    return c;
  }

  // ---- biome background builders. Each returns { sky, layers:[{c, fx, fy, y0, tileY, below, above, meta}] }
  const BG = {};

  BG.desert = (P, rnd) => {
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, P.sky);
      stars(g, w, h, 220, 11, h * 0.5);
      // sun glow below the horizon
      softBlob(g, w * 0.42, h * 0.98, 520, 200, '#ffcf8a', 0.55);
      softBlob(g, w * 0.42, h * 0.9, 260, 90, '#fff0c0', 0.35);
      // ringed planet
      const px = w * 0.7, py = h * 0.34, pr = 118;
      g.save(); g.translate(px, py); g.rotate(-0.32);
      const ring = (front) => {
        g.save();
        if (front) { g.beginPath(); g.rect(-400, 0, 800, 200); g.clip(); }
        for (let i = 0; i < 7; i++) {
          g.beginPath(); g.ellipse(0, 0, 175 + i * 11, 34 + i * 2.3, 0, 0, TAU);
          g.strokeStyle = rgba(i % 3 === 1 ? '#f6d8c0' : '#d8b0b8', 0.12 + (i % 2) * 0.12); g.lineWidth = i % 3 === 1 ? 7 : 4; g.stroke();
        }
        g.restore();
      };
      ring(false);
      g.rotate(0.32);
      g.save(); g.beginPath(); g.arc(0, 0, pr, 0, TAU); g.clip();
      const bands = ['#b39ab8', '#c8a8b8', '#a88ca8', '#d6b8b8', '#9e88a8', '#c4a4b0', '#b096b0'];
      g.rotate(-0.32);
      for (let i = -8; i < 8; i++) { g.fillStyle = bands[mod(i, bands.length)]; g.fillRect(-pr * 1.5, i * 17 + Math.sin(i) * 4, pr * 3, 18); }
      g.rotate(0.32);
      const sh = g.createRadialGradient(-pr * 0.55, pr * 0.45, pr * 0.2, -pr * 0.2, pr * 0.15, pr * 1.45);
      sh.addColorStop(0, 'rgba(255,190,140,0.15)'); sh.addColorStop(0.5, 'rgba(40,20,60,0.2)'); sh.addColorStop(1, 'rgba(20,10,40,0.92)');
      g.fillStyle = sh; g.fillRect(-pr, -pr, pr * 2, pr * 2);
      g.restore();
      g.beginPath(); g.arc(0, 0, pr + 1, 0.9, 2.9); g.strokeStyle = 'rgba(255,200,170,0.5)'; g.lineWidth = 2; g.stroke();
      softBlob(g, 0, 0, pr * 1.5, pr * 1.5, '#e8a8c0', 0.12);
      g.rotate(-0.32);
      ring(true);
      g.restore();
      // moons
      const moon = (x, y, r, col, phase) => {
        softBlob(g, x, y, r * 3, r * 3, col, 0.18);
        g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        g.fillStyle = 'rgba(30,15,50,0.75)'; g.beginPath(); g.arc(x + r * phase, y - r * 0.3, r * 0.95, 0, TAU); g.fill();
        g.fillStyle = rgba('#ffffff', 0.12); g.beginPath(); g.arc(x - r * 0.3, y + r * 0.2, r * 0.25, 0, TAU); g.fill();
      };
      moon(w * 0.2, h * 0.17, 24, '#ffe8e0', 0.55);
      moon(w * 0.31, h * 0.28, 11, '#c8e0ff', 0.6);
      // thin clouds
      const r = G.rng(71);
      for (let i = 0; i < 9; i++) {
        const cy = h * (0.55 + r() * 0.22), cx = r() * w;
        softBlob(g, cx, cy, 160 + r() * 200, 6 + r() * 8, i % 2 ? '#ffb48a' : '#e87a8a', 0.35);
      }
    });
    // far mesas + the Spire
    const far = strip(380);
    {
      const { g, h } = far;
      const base = wave1(101, [2, 5, 11], 14);
      const hts = new Float32Array(SW / 2 + 1);
      for (let i = 0; i <= SW / 2; i++) hts[i] = 300 + base(i * 2);
      const r = G.rng(103);
      for (let m = 0; m < 7; m++) {
        const cx = r() * SW, hw = 50 + r() * 120, top = 170 + r() * 90;
        for (let dx = -hw - 40; dx <= hw + 40; dx += 2) {
          const x = mod(cx + dx, SW), i = Math.round(x / 2);
          const edge = Math.abs(dx) - hw;
          let y = edge < 0 ? top + h2(Math.round(x), m, 3) * 3 : top + (edge / 40) ** 1.6 * (300 - top);
          if (edge > 40) continue;
          if (y < hts[i]) hts[i] = y;
        }
      }
      const f = (x) => hts[Math.min(SW / 2, Math.round(x / 2))];
      const col = mix(P.far, P.haze, 0.42);
      fillProfile(g, h, f, col);
      rimLight(g, f, '#ffd2a0', 0.35, 1.5);
      // the Spire
      const sx = SW * 0.63, sb = 300;
      g.fillStyle = mix(P.far, P.haze, 0.25);
      g.beginPath(); g.moveTo(sx - 16, sb); g.lineTo(sx - 5, 40); g.lineTo(sx, 4); g.lineTo(sx + 5, 40); g.lineTo(sx + 16, sb); g.fill();
      for (let k = 0; k < 4; k++) { const yy = 90 + k * 50; g.fillRect(sx - 7 - k * 1.5, yy, 14 + k * 3, 4); }
      g.fillStyle = 'rgba(255,220,180,0.35)'; g.fillRect(sx - 1, 30, 1.5, 260);
      hazeOver(g, SW, h, P.haze, 0, 0.55, 200, 330);
      far.meta = { spire: [sx, 4] };
    }
    const mid = strip(300);
    {
      const { g, h } = mid;
      const f1 = wave1(201, [3, 4, 7, 13], 46);
      const f = (x) => 150 + f1(x) + Math.abs(Math.sin((x / SW) * TAU * 6)) * -10;
      const col = mix(P.mid, P.haze, 0.28);
      fillProfile(g, h, f, col);
      // sun-facing dune faces
      g.save(); g.globalCompositeOperation = 'source-atop';
      for (let x = 0; x < SW; x += 3) { const d = f(x + 3) - f(x); if (d > 0) { g.fillStyle = rgba('#ffb088', Math.min(0.25, d * 0.12)); g.fillRect(x, f(x), 3, 60); } }
      g.restore();
      rimLight(g, f, '#ffcc99', 0.55, 1.4);
      hazeOver(g, SW, h, P.haze, 0, 0.35, 160, 280);
    }
    const near = strip(260);
    {
      const { g, h } = near;
      const f1 = wave1(301, [2, 5, 9, 17], 38);
      const f = (x) => 120 + f1(x);
      const col = P.near;
      fillProfile(g, h, f, col);
      const r = G.rng(303);
      for (let i = 0; i < 6; i++) {
        const rx = r() * SW, rw = 20 + r() * 50, rh = 20 + r() * 60;
        wrapX(rx, rw, (xx) => { g.fillStyle = col; g.beginPath(); g.moveTo(xx - rw, f(mod(xx, SW)) + 10); g.lineTo(xx - rw * 0.6, f(mod(xx, SW)) - rh); g.lineTo(xx + rw * 0.2, f(mod(xx, SW)) - rh * 0.8); g.lineTo(xx + rw, f(mod(xx, SW)) + 10); g.fill(); g.strokeStyle = 'rgba(255,170,110,0.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(xx - rw, f(mod(xx, SW)) + 10); g.lineTo(xx - rw * 0.6, f(mod(xx, SW)) - rh); g.lineTo(xx + rw * 0.2, f(mod(xx, SW)) - rh * 0.8); g.stroke(); });
      }
      rimLight(g, f, '#ff9a6a', 0.45, 1.2);
    }
    return {
      sky,
      layers: [
        { c: far.c, fx: 0.06, fy: 0.05, y0: 160, below: mix(mix(P.far, P.haze, 0.42), P.haze, 0.55), meta: far.meta },
        { c: mid.c, fx: 0.18, fy: 0.14, y0: 270, below: mix(mix(P.mid, P.haze, 0.28), P.haze, 0.35) },
        { c: near.c, fx: 0.4, fy: 0.3, y0: 360, below: P.near },
      ],
    };
  };

  BG.canyon = (P) => {
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, P.sky);
      softBlob(g, w * 0.55, -20, 520, 260, '#fff4d8', 0.7);
      const r = G.rng(91);
      for (let i = 0; i < 6; i++) softBlob(g, r() * w, h * (0.08 + r() * 0.2), 200, 10, '#ffffff', 0.25);
    });
    const far = strip(760);
    {
      const { g, h } = far;
      const top = wave1(401, [3, 5, 8, 19, 37], 60);
      const f = (x) => 110 + top(x) + (Math.abs(Math.sin(x * 0.011)) > 0.97 ? 20 : 0);
      const col = mix(P.far, P.haze, 0.5);
      fillProfile(g, h, f, col);
      g.save(); g.globalCompositeOperation = 'source-atop';
      const r = G.rng(402);
      for (let y = 100; y < h; y += 6) { g.fillStyle = rgba(r() < 0.5 ? '#ffd0a8' : '#7a2a20', 0.06 + r() * 0.06); g.fillRect(0, y, SW, 3 + r() * 4); }
      for (let i = 0; i < 160; i++) { const x = r() * SW, y0 = 120 + r() * 300, l = 40 + r() * 260; g.fillStyle = rgba('#5a1a14', 0.08 + r() * 0.1); g.fillRect(x, y0, 1.5 + r() * 2.5, l); g.fillStyle = rgba('#ffd8b0', 0.07); g.fillRect(x - 2, y0, 1.2, l); }
      for (let i = 0; i < 5; i++) { const x = r() * SW, y = 260 + r() * 200, rw = 30 + r() * 40; g.fillStyle = rgba('#4a1612', 0.35); g.beginPath(); g.ellipse(x, y, rw, rw * 1.4, 0, Math.PI, TAU); g.fillRect(x - rw, y, rw * 2, rw * 0.6); g.fill(); }
      g.restore();
      rimLight(g, f, '#fff0d0', 0.7, 2);
      hazeOver(g, SW, h, P.haze, 0, 0.6, 140, 640);
    }
    const mid = strip(700);
    {
      const { g, h } = mid;
      const r = G.rng(501);
      const col = mix(P.mid, P.haze, 0.25);
      for (let i = 0; i < 9; i++) {
        const cx = r() * SW, hw = 30 + r() * 70, top = 140 + r() * 260;
        wrapX(cx, hw + 30, (x) => {
          g.fillStyle = col;
          g.beginPath(); g.moveTo(x - hw - 30, h);
          let yy = top;
          for (let k = -hw; k <= hw; k += 10) { yy = top + h2(Math.round(cx + k), i, 7) * 18 + (Math.abs(k) > hw * 0.7 ? 12 : 0); g.lineTo(x + k, yy); }
          g.lineTo(x + hw + 30, h); g.fill();
          g.save(); g.beginPath(); g.rect(x - hw - 30, top - 30, hw * 0.7, h); g.clip();
          g.fillStyle = 'rgba(255,190,140,0.12)'; g.fillRect(x - hw - 30, top - 30, hw * 2, h);
          g.restore();
          g.strokeStyle = 'rgba(255,200,150,0.4)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - hw, top + 6); g.lineTo(x - hw * 0.3, top); g.stroke();
          for (let s = 0; s < 4; s++) { g.fillStyle = 'rgba(60,10,8,0.25)'; g.fillRect(x - hw * 0.8, top + 40 + s * 60 + h2(i, s, 9) * 20, hw * 1.6, 3); }
        });
      }
      hazeOver(g, SW, h, P.haze, 0.05, 0.5, 200, 640);
    }
    const near = strip(640);
    {
      const { g, h } = near;
      const r = G.rng(601);
      for (let i = 0; i < 4; i++) {
        const cx = r() * SW, hw = 40 + r() * 60;
        wrapX(cx, hw + 40, (x) => {
          g.fillStyle = P.near;
          g.beginPath(); g.moveTo(x - hw - 40, h);
          for (let k = h; k >= 0; k -= 20) g.lineTo(x - hw + Math.sin(k * 0.02 + i) * 14 + h2(i, k, 2) * 10, k);
          for (let k = 0; k <= h; k += 20) g.lineTo(x + hw + Math.sin(k * 0.025 + i * 2) * 14 + h2(i, k, 3) * 10, k);
          g.lineTo(x + hw + 40, h); g.fill();
          g.strokeStyle = 'rgba(255,170,120,0.35)'; g.lineWidth = 1.5; g.beginPath();
          for (let k = h; k >= 0; k -= 20) g.lineTo(x - hw + Math.sin(k * 0.02 + i) * 14 + h2(i, k, 2) * 10, k);
          g.stroke();
        });
      }
      const f1 = wave1(602, [3, 7, 13], 30);
      fillProfile(g, h, (x) => h - 70 + f1(x), P.near);
    }
    return {
      sky,
      layers: [
        { c: far.c, fx: 0.07, fy: 0.05, y0: -60, below: mix(mix(P.far, P.haze, 0.5), P.haze, 0.6) },
        { c: mid.c, fx: 0.2, fy: 0.12, y0: -40, below: mix(mix(P.mid, P.haze, 0.25), P.haze, 0.5) },
        { c: near.c, fx: 0.45, fy: 0.3, y0: -20, below: P.near },
      ],
    };
  };

  function statue(g, x, base, hgt, col, glowCol, seed) {
    const r = G.rng(seed);
    const w = hgt * 0.2;
    g.fillStyle = col;
    // plinth
    g.fillRect(x - w * 0.9, base - hgt * 0.06, w * 1.8, hgt * 0.06 + 2);
    // robe
    g.beginPath();
    g.moveTo(x - w * 0.8, base - hgt * 0.06);
    g.quadraticCurveTo(x - w * 0.55, base - hgt * 0.5, x - w * 0.5, base - hgt * 0.72);
    g.lineTo(x - w * 0.35, base - hgt * 0.8);
    g.lineTo(x + w * 0.35, base - hgt * 0.8);
    g.lineTo(x + w * 0.5, base - hgt * 0.72);
    g.quadraticCurveTo(x + w * 0.55, base - hgt * 0.5, x + w * 0.8, base - hgt * 0.06);
    g.fill();
    // hood / head (tall, faceless)
    g.beginPath(); g.ellipse(x, base - hgt * 0.87, w * 0.2, hgt * 0.085, 0, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(x - w * 0.3, base - hgt * 0.8); g.quadraticCurveTo(x, base - hgt * 1.02, x + w * 0.3, base - hgt * 0.8); g.fill();
    // staff / held orb
    const side = r() < 0.5 ? -1 : 1;
    g.fillRect(x + side * w * 0.62 - 3, base - hgt * 0.95, 6, hgt * 0.9);
    g.beginPath(); g.arc(x + side * w * 0.62, base - hgt * 0.96, w * 0.11, 0, TAU); g.fill();
    // arm
    g.beginPath(); g.moveTo(x + side * w * 0.35, base - hgt * 0.72); g.lineTo(x + side * w * 0.65, base - hgt * 0.55); g.lineTo(x + side * w * 0.6, base - hgt * 0.5); g.lineTo(x + side * w * 0.3, base - hgt * 0.62); g.fill();
    // robe folds (darker lines)
    g.strokeStyle = rgba('#000000', 0.12); g.lineWidth = 2;
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + k * w * 0.12, base - hgt * 0.7); g.quadraticCurveTo(x + k * w * 0.2, base - hgt * 0.4, x + k * w * 0.28, base - hgt * 0.07); g.stroke(); }
    // glowing glyphs: face slit + chest sigil + orb
    g.save(); g.globalCompositeOperation = 'lighter';
    softBlob(g, x, base - hgt * 0.87, w * 0.4, w * 0.4, glowCol, 0.35);
    g.fillStyle = rgba(glowCol, 0.9); g.fillRect(x - w * 0.09, base - hgt * 0.875, w * 0.18, 2);
    softBlob(g, x + side * w * 0.62, base - hgt * 0.96, w * 0.5, w * 0.5, glowCol, 0.4);
    g.strokeStyle = rgba(glowCol, 0.5); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, base - hgt * 0.68); g.lineTo(x, base - hgt * 0.56); g.moveTo(x - w * 0.12, base - hgt * 0.62); g.lineTo(x + w * 0.12, base - hgt * 0.62); g.stroke();
    g.restore();
  }

  function mechTree(g, x, base, hgt, col, glowA, glowB, seed) {
    const r = G.rng(seed);
    g.fillStyle = col; g.strokeStyle = col;
    const tw = 10 + r() * 8;
    g.beginPath(); g.moveTo(x - tw * 1.6, base); g.quadraticCurveTo(x - tw * 0.6, base - 30, x - tw * 0.5, base - hgt); g.lineTo(x + tw * 0.5, base - hgt); g.quadraticCurveTo(x + tw * 0.6, base - 30, x + tw * 1.6, base); g.fill();
    // joints / rings
    for (let k = 1; k < 6; k++) g.fillRect(x - tw * 0.75, base - hgt * (k / 6), tw * 1.5, 4);
    // branches (angled segments)
    const branches = [];
    for (let i = 0; i < 6; i++) {
      const by = base - hgt * (0.45 + r() * 0.5), dir = i % 2 ? 1 : -1, len = 30 + r() * 60;
      const ex = x + dir * len, ey = by - 20 - r() * 40;
      g.lineWidth = 4 - i * 0.3; g.beginPath(); g.moveTo(x, by); g.lineTo(x + dir * len * 0.5, by - 6); g.lineTo(ex, ey); g.stroke();
      branches.push([ex, ey]);
    }
    // canopy: hanging cable-vines with glowing pods
    g.lineWidth = 1.2;
    for (const [bx, by] of branches) {
      g.beginPath(); g.ellipse(bx, by, 26 + r() * 20, 12 + r() * 8, 0, 0, TAU); g.fill();
      for (let k = 0; k < 4; k++) { const vx = bx - 20 + r() * 40, l = 20 + r() * 70; g.beginPath(); g.moveTo(vx, by); g.quadraticCurveTo(vx + 4, by + l * 0.5, vx, by + l); g.stroke(); }
    }
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const [bx, by] of branches) {
      for (let k = 0; k < 5; k++) {
        const px = bx - 24 + r() * 48, py = by - 6 + r() * 60, c = r() < 0.7 ? glowA : glowB;
        softBlob(g, px, py, 8, 8, c, 0.5); g.fillStyle = rgba(c, 0.95); g.fillRect(px - 1, py - 1, 2, 2);
      }
    }
    g.restore();
  }

  BG.ruins = (P) => {
    const over = S.variant === 'overgrown';
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, P.sky);
      if (over) stars(g, w, h, 120, 13, h * 0.4, '#c8ffe8');
      softBlob(g, w * 0.36, h * 0.78, 300, 300, over ? '#7affc8' : '#fff4d0', over ? 0.12 : 0.35);
      g.fillStyle = rgba(over ? '#c8ffe8' : '#fff8e0', over ? 0.25 : 0.55); g.beginPath(); g.arc(w * 0.36, h * 0.74, 46, 0, TAU); g.fill();
      const r = G.rng(83);
      for (let i = 0; i < 8; i++) softBlob(g, r() * w, h * (0.55 + r() * 0.3), 260, 14, P.haze, 0.35);
    });
    const far = strip(560);
    {
      const { g, h } = far;
      const col = mix(P.far, P.haze, 0.42);
      const r = G.rng(701);
      // distant stepped towers
      for (let i = 0; i < 7; i++) {
        const x = r() * SW, tw = 20 + r() * 40, th = 120 + r() * 160;
        wrapX(x, tw * 2, (xx) => { g.fillStyle = mix(col, P.haze, 0.3); for (let k = 0; k < 4; k++) g.fillRect(xx - tw * (1 - k * 0.2), h - th * (k + 1) / 4 - 20, tw * 2 * (1 - k * 0.2), th / 4 + 1); });
      }
      const f1 = wave1(702, [2, 5, 9], 16);
      fillProfile(g, h, (x) => h - 50 + f1(x), col);
      for (let i = 0; i < 3; i++) {
        const x = (i + 0.2 + r() * 0.5) * (SW / 3), hgt = 380 + r() * 140;
        wrapX(x, 120, (xx) => statue(g, xx, h - 40, hgt, col, P.accent, 710 + i));
      }
      hazeOver(g, SW, h, P.haze, 0.05, 0.6, 200, h);
    }
    const mid = strip(420);
    {
      const { g, h } = mid;
      const col = mix(P.mid, P.haze, over ? 0.2 : 0.25);
      if (over) {
        const r = G.rng(801);
        for (let i = 0; i < 6; i++) { const x = (i + r() * 0.6) * (SW / 6); wrapX(x, 140, (xx) => mechTree(g, xx, h - 30, 220 + r() * 140, col, P.accent, P.accent2, 810 + i)); }
      } else {
        // colonnade with architraves and arches, partially collapsed
        const r = G.rng(801);
        let x = 0;
        while (x < SW) {
          const span = 60 + r() * 30, broken = r() < 0.35, ph = broken ? 60 + r() * 120 : 210;
          g.fillStyle = col;
          g.fillRect(x - 9, h - 30 - ph, 18, ph);
          g.fillRect(x - 13, h - 30 - ph, 26, 7);
          g.fillRect(x - 13, h - 36, 26, 8);
          if (!broken) {
            g.fillRect(x - 13, h - 30 - ph - 16, span + 26, 16);
            g.beginPath(); g.arc(x + span / 2, h - 30 - ph + 20, span / 2 - 6, Math.PI, TAU); g.lineTo(x + span - 9, h - 30 - ph); g.lineTo(x + 9, h - 30 - ph); g.fill();
          } else {
            g.beginPath(); g.moveTo(x - 9, h - 30 - ph); g.lineTo(x - 3, h - 30 - ph - 10); g.lineTo(x + 4, h - 30 - ph - 3); g.lineTo(x + 9, h - 30 - ph - 12); g.lineTo(x + 9, h - 30 - ph); g.fill();
          }
          g.fillStyle = rgba('#ffffff', 0.06); g.fillRect(x - 9, h - 30 - ph, 4, ph);
          if (r() < 0.3) { g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = rgba(P.accent, 0.35); g.fillRect(x - 1, h - 30 - ph + 20, 2, ph * 0.5); g.restore(); }
          x += span;
        }
      }
      const f1 = wave1(803, [3, 7, 15], 14);
      fillProfile(g, h, (x) => h - 34 + f1(x), col);
      hazeOver(g, SW, h, P.haze, 0.0, 0.4, 120, h);
    }
    const near = strip(340);
    {
      const { g, h } = near;
      const col = P.near;
      const r = G.rng(901);
      const f1 = wave1(902, [2, 5, 11, 23], 22);
      const f = (x) => h - 46 + f1(x);
      for (let i = 0; i < 7; i++) {
        const x = r() * SW, pw = 16 + r() * 16, ph = 50 + r() * 140;
        wrapX(x, pw + 10, (xx) => {
          g.fillStyle = col; g.beginPath(); g.moveTo(xx - pw, h); g.lineTo(xx - pw, h - ph); g.lineTo(xx - pw * 0.2, h - ph - 14 * r()); g.lineTo(xx + pw * 0.4, h - ph + 6); g.lineTo(xx + pw, h - ph - 8); g.lineTo(xx + pw, h); g.fill();
          g.fillStyle = rgba(P.light, 0.08); g.fillRect(xx - pw, h - ph, 3, ph);
        });
      }
      fillProfile(g, h, f, col);
      // foliage clumps
      for (let i = 0; i < 40; i++) {
        const x = r() * SW, s = 6 + r() * (over ? 20 : 12);
        wrapX(x, s * 2, (xx) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + (k / 5 - 0.5) * 2.4; g.moveTo(xx, f(mod(xx, SW)) + 4); g.quadraticCurveTo(xx + Math.cos(a) * s * 0.5, f(mod(xx, SW)) - s * 0.6, xx + Math.cos(a) * s * 1.6, f(mod(xx, SW)) + Math.sin(a) * s * 1.6); } g.stroke(); });
      }
      if (over) {
        g.save(); g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 26; i++) { const x = r() * SW, y = f(x) - r() * 20, c = r() < 0.6 ? P.accent : P.accent2; softBlob(g, x, y, 10, 10, c, 0.45); g.fillStyle = c; g.fillRect(x - 1, y - 1, 2, 2); }
        g.restore();
      }
    }
    const layers = [
      { c: far.c, fx: 0.05, fy: 0.04, y0: -20, below: mix(mix(P.far, P.haze, 0.42), P.haze, 0.6) },
      { c: mid.c, fx: 0.18, fy: 0.12, y0: 150, below: mix(mix(P.mid, P.haze, 0.25), P.haze, 0.4) },
      { c: near.c, fx: 0.42, fy: 0.3, y0: 230, below: P.near },
    ];
    if (over) {
      const hang = strip(220);
      const { g } = hang;
      const r = G.rng(951);
      g.strokeStyle = P.near; g.fillStyle = P.near;
      for (let i = 0; i < 46; i++) {
        const x = r() * SW, l = 40 + r() * 170;
        wrapX(x, 10, (xx) => { g.lineWidth = 1.5 + r() * 2; g.beginPath(); g.moveTo(xx, 0); g.bezierCurveTo(xx + 8, l * 0.3, xx - 8, l * 0.7, xx + 2, l); g.stroke(); g.beginPath(); g.ellipse(xx + 2, l, 3, 5, 0, 0, TAU); g.fill(); });
      }
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) { const x = r() * SW, y = 40 + r() * 160, c = r() < 0.5 ? P.accent : P.accent2; softBlob(g, x, y, 7, 7, c, 0.5); }
      g.restore();
      layers.push({ c: hang.c, fx: 0.6, fy: 0, y0: -10, topAnchor: true });
    }
    return { sky, layers };
  };

  function caveBand(g, h, seed, col, rimCol, topH, botH, spikes) {
    const r = G.rng(seed);
    const ft = wave1(seed + 1, [3, 7, 13, 29], topH * 0.35);
    const fb = wave1(seed + 2, [2, 5, 11, 23], botH * 0.35);
    // ceiling with stalactites
    g.fillStyle = col;
    g.beginPath(); g.moveTo(0, 0);
    for (let x = 0; x <= SW; x += 6) g.lineTo(x, topH + ft(x));
    g.lineTo(SW, 0); g.fill();
    for (let i = 0; i < spikes; i++) {
      const x = r() * SW, w = 8 + r() * 26, l = 30 + r() * 140;
      wrapX(x, w, (xx) => { const y = topH + ft(mod(xx, SW)) - 4; g.beginPath(); g.moveTo(xx - w, y); g.quadraticCurveTo(xx - w * 0.2, y + l * 0.6, xx, y + l); g.quadraticCurveTo(xx + w * 0.25, y + l * 0.6, xx + w, y); g.fill(); if (rimCol) { g.strokeStyle = rimCol; g.lineWidth = 1; g.beginPath(); g.moveTo(xx - w, y); g.quadraticCurveTo(xx - w * 0.2, y + l * 0.6, xx, y + l); g.stroke(); } });
    }
    // floor with stalagmites
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= SW; x += 6) g.lineTo(x, h - botH + fb(x));
    g.lineTo(SW, h); g.fill();
    for (let i = 0; i < spikes * 0.7; i++) {
      const x = r() * SW, w = 10 + r() * 24, l = 30 + r() * 110;
      wrapX(x, w, (xx) => { const y = h - botH + fb(mod(xx, SW)) + 4; g.beginPath(); g.moveTo(xx - w, y); g.quadraticCurveTo(xx - w * 0.25, y - l * 0.6, xx, y - l); g.quadraticCurveTo(xx + w * 0.2, y - l * 0.6, xx + w, y); g.fill(); if (rimCol) { g.strokeStyle = rimCol; g.lineWidth = 1; g.beginPath(); g.moveTo(xx - w, y); g.quadraticCurveTo(xx - w * 0.25, y - l * 0.6, xx, y - l); g.stroke(); } });
    }
    if (rimCol) { g.strokeStyle = rimCol; g.lineWidth = 1.2; g.beginPath(); for (let x = 0; x <= SW; x += 6) { const y = h - botH + fb(x); if (!x) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
  }

  BG.caves = (P) => {
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, P.sky);
      const r = G.rng(61);
      for (let i = 0; i < 6; i++) softBlob(g, r() * w, h * (0.3 + r() * 0.5), 200 + r() * 200, 120, i % 2 ? '#1a4a40' : '#103a3a', 0.35);
    });
    const LH = 720;
    const far = strip(LH);
    {
      const { g, h } = far;
      const col = mix(P.far, P.haze, 0.35);
      caveBand(g, h, 1001, col, rgba(P.accent, 0.12), 110, 120, 40);
      g.save(); g.globalCompositeOperation = 'lighter';
      const r = G.rng(1005);
      for (let i = 0; i < 70; i++) { const x = r() * SW, y = r() < 0.5 ? r() * 150 : h - r() * 150; g.fillStyle = rgba(r() < 0.7 ? P.accent : P.accent2, 0.25 + r() * 0.35); g.fillRect(x, y, 1.5, 1.5); }
      // distant underground waterfall
      const wx = SW * 0.3; const gr = g.createLinearGradient(0, 100, 0, h - 100); gr.addColorStop(0, rgba('#9affe0', 0.0)); gr.addColorStop(0.2, rgba('#9affe0', 0.14)); gr.addColorStop(1, rgba('#9affe0', 0.04));
      g.fillStyle = gr; g.fillRect(wx, 100, 14, h - 200); softBlob(g, wx + 7, h - 120, 60, 20, '#9affe0', 0.2);
      g.restore();
    }
    const mid = strip(LH);
    {
      const { g, h } = mid;
      const col = mix(P.mid, P.haze, 0.18);
      caveBand(g, h, 1101, col, rgba(P.rock.rim, 0.12), 60, 70, 22);
      const r = G.rng(1102);
      for (let i = 0; i < 4; i++) {
        const x = r() * SW, w = 24 + r() * 26;
        wrapX(x, w * 2, (xx) => { g.fillStyle = col; g.beginPath(); g.moveTo(xx - w * 1.8, 0); g.quadraticCurveTo(xx - w * 0.4, h * 0.5, xx - w * 1.6, h); g.lineTo(xx + w * 1.6, h); g.quadraticCurveTo(xx + w * 0.4, h * 0.5, xx + w * 1.8, 0); g.fill(); g.strokeStyle = rgba(P.rock.rim, 0.12); g.lineWidth = 1.5; g.beginPath(); g.moveTo(xx - w * 1.8, 0); g.quadraticCurveTo(xx - w * 0.4, h * 0.5, xx - w * 1.6, h); g.stroke(); });
      }
    }
    const near = strip(LH);
    {
      const { g, h } = near;
      caveBand(g, h, 1201, P.near, null, 26, 30, 9);
    }
    return {
      sky,
      layers: [
        { c: far.c, fx: 0.07, fy: 0.07, y0: -90, tileY: true },
        { c: mid.c, fx: 0.2, fy: 0.2, y0: -90, tileY: true },
        { c: near.c, fx: 0.45, fy: 0.45, y0: -90, tileY: true },
      ],
    };
  };

  function prism(g, x, y, ang, len, wd, col, lightCol, alpha) {
    g.save(); g.translate(x, y); g.rotate(ang);
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.beginPath(); g.moveTo(-wd, 0); g.lineTo(-wd, -len * 0.85); g.lineTo(0, -len); g.lineTo(wd, -len * 0.85); g.lineTo(wd, 0); g.closePath();
    g.fillStyle = col; g.fill();
    g.beginPath(); g.moveTo(-wd, 0); g.lineTo(-wd, -len * 0.85); g.lineTo(0, -len); g.lineTo(wd * 0.1, 0); g.closePath();
    g.fillStyle = rgba(lightCol, 0.22); g.fill();
    g.strokeStyle = rgba(lightCol, 0.55); g.lineWidth = 1;
    g.beginPath(); g.moveTo(-wd, 0); g.lineTo(-wd, -len * 0.85); g.lineTo(0, -len); g.lineTo(wd, -len * 0.85); g.stroke();
    g.beginPath(); g.moveTo(0, -len); g.lineTo(wd * 0.1, 0); g.strokeStyle = rgba(lightCol, 0.25); g.stroke();
    g.restore();
  }

  BG.crystal = (P) => {
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, P.sky);
      const r = G.rng(51);
      for (let i = 0; i < 8; i++) softBlob(g, r() * w, r() * h, 180 + r() * 220, 140, i % 2 ? '#3a1a7a' : '#0a4a5a', 0.4);
      stars(g, w, h, 90, 52, h, '#e0d0ff');
    });
    const LH = 720;
    const mkLayer = (seed, col, light, nT, nB, sMin, sMax, glowA) => {
      const L = strip(LH), g = L.g, h = LH;
      caveBand(g, h, seed, col, rgba(light, 0.25), 40, 50, 0);
      const r = G.rng(seed + 7);
      const cluster = (x, y, up) => {
        const n = 3 + ((r() * 4) | 0), base = up ? 0 : Math.PI;
        for (let k = 0; k < n; k++) { const len = sMin + r() * (sMax - sMin), wd = len * (0.08 + r() * 0.06); prism(g, x + (r() - 0.5) * 30, y, base + (r() - 0.5) * 0.9, len, wd, col, light); }
        if (glowA) { g.save(); g.globalCompositeOperation = 'lighter'; softBlob(g, x, y + (up ? -sMax * 0.4 : sMax * 0.4), sMax * 0.6, sMax * 0.6, r() < 0.5 ? P.accent : P.accent2, glowA); g.restore(); }
      };
      for (let i = 0; i < nB; i++) { const x = r() * SW; wrapX(x, sMax, (xx) => cluster(xx, h - 40, true)); }
      for (let i = 0; i < nT; i++) { const x = r() * SW; wrapX(x, sMax, (xx) => cluster(xx, 36, false)); }
      return L.c;
    };
    return {
      sky,
      layers: [
        { c: mkLayer(1301, mix(P.far, P.haze, 0.3), '#9ae8ff', 10, 12, 60, 200, 0.18), fx: 0.07, fy: 0.07, y0: -90, tileY: true },
        { c: mkLayer(1401, mix(P.mid, P.haze, 0.12), '#d8b8ff', 6, 7, 70, 230, 0.22), fx: 0.22, fy: 0.22, y0: -90, tileY: true },
        { c: mkLayer(1501, P.near, '#6ae0e8', 3, 4, 60, 160, 0), fx: 0.5, fy: 0.5, y0: -90, tileY: true },
      ],
    };
  };

  BG.ship = (P) => {
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, [[0, '#02030a'], [0.6, '#060a1a'], [1, '#0a0e22']]);
      const r = G.rng(41);
      for (let i = 0; i < 7; i++) softBlob(g, w * (0.2 + r() * 0.6), h * (0.2 + r() * 0.6), 220 + r() * 220, 90 + r() * 90, i % 2 ? '#5a2a7a' : '#1a5a7a', 0.25);
      stars(g, w, h, 520, 42, h, '#e8f0ff');
      softBlob(g, w * 0.75, h * 0.35, 60, 60, '#ffe8c0', 0.5);
    });
    const LH = 540;
    // back wall with windows
    const wall = strip(LH);
    {
      const { g, h } = wall;
      const col = mix(P.far, P.haze, 0.1);
      g.fillStyle = col; g.fillRect(0, 0, SW, h);
      for (let x = 0; x < SW; x += 96) for (let y = 0; y < h; y += 60) {
        g.fillStyle = rgba(h2(x, y, 1) < 0.5 ? '#000000' : '#8ab0d0', 0.05 + h2(x, y, 2) * 0.05); g.fillRect(x + 2, y + 2, 92, 56);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y, 96, 2); g.fillRect(x, y, 2, 60);
        g.fillStyle = 'rgba(160,200,230,0.06)'; g.fillRect(x + 2, y + 2, 92, 1);
      }
      // horizontal strip lights
      for (const sy of [96, 412]) {
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, sy - 4, SW, 9);
        g.save(); g.globalCompositeOperation = 'lighter';
        const gr = g.createLinearGradient(0, sy - 18, 0, sy + 18); gr.addColorStop(0, rgba(P.accent, 0)); gr.addColorStop(0.5, rgba(P.accent, 0.18)); gr.addColorStop(1, rgba(P.accent, 0));
        g.fillStyle = gr; g.fillRect(0, sy - 18, SW, 36);
        g.fillStyle = rgba(P.accent, 0.6); for (let x = 0; x < SW; x += 48) g.fillRect(x + 4, sy - 1, 36, 2);
        g.restore();
      }
      // windows
      const wins = [];
      for (let i = 0; i < 3; i++) wins.push([i * 512 + 120, 150, 260, 200]);
      for (const [wx, wy, ww, wh] of wins) {
        G.roundRect(g, wx - 14, wy - 14, ww + 28, wh + 28, 30); g.fillStyle = mix(col, '#000000', 0.45); g.fill();
        G.roundRect(g, wx - 8, wy - 8, ww + 16, wh + 16, 26); g.fillStyle = mix(col, '#9ab4c8', 0.18); g.fill();
        g.save(); g.globalCompositeOperation = 'destination-out';
        G.roundRect(g, wx, wy, ww, wh, 20); g.fill();
        g.restore();
        g.fillStyle = mix(col, '#000000', 0.3); g.fillRect(wx + ww / 2 - 4, wy, 8, wh); g.fillRect(wx, wy + wh / 2 - 3, ww, 6);
        g.strokeStyle = 'rgba(180,220,255,0.18)'; g.lineWidth = 1.5; G.roundRect(g, wx + 1, wy + 1, ww - 2, wh - 2, 19); g.stroke();
        // red alarm lamps either side
        g.fillStyle = '#3a0a10'; g.fillRect(wx - 30, wy + wh / 2 - 6, 8, 12); g.fillRect(wx + ww + 22, wy + wh / 2 - 6, 8, 12);
      }
      wall.meta = { alarms: wins.flatMap(([wx, wy, ww, wh]) => [[wx - 26, wy + wh / 2], [wx + ww + 26, wy + wh / 2]]) };
    }
    const mid = strip(LH);
    {
      const { g, h } = mid;
      const col = P.mid;
      const r = G.rng(1601);
      // pipe bundles
      for (const py of [40, 470]) {
        for (let k = 0; k < 3; k++) {
          const y = py + k * 15, th = 9 + k * 2;
          const gr = g.createLinearGradient(0, y, 0, y + th); gr.addColorStop(0, mix(col, '#8aa0b8', 0.25)); gr.addColorStop(0.5, col); gr.addColorStop(1, mix(col, '#000000', 0.5));
          g.fillStyle = gr; g.fillRect(0, y, SW, th);
        }
        for (let x = 20; x < SW; x += 128) { g.fillStyle = mix(col, '#000000', 0.4); g.fillRect(x, py - 4, 10, 52); g.fillStyle = mix(col, '#9ab', 0.2); g.fillRect(x, py - 4, 10, 2); }
      }
      // structural pillars with light strips
      for (let i = 0; i < 5; i++) {
        const x = i * (SW / 5) + 60 + r() * 80;
        g.fillStyle = col; g.fillRect(x - 22, 0, 44, h);
        g.fillStyle = mix(col, '#000000', 0.4); g.fillRect(x + 12, 0, 10, h);
        g.fillStyle = mix(col, '#9ab4c8', 0.12); g.fillRect(x - 22, 0, 4, h);
        for (let y = 0; y < h; y += 90) { g.fillStyle = mix(col, '#000000', 0.5); g.fillRect(x - 26, y, 52, 8); }
        g.save(); g.globalCompositeOperation = 'lighter';
        g.fillStyle = rgba(P.accent, 0.55); g.fillRect(x - 2, 30, 3, h - 60);
        const gr = g.createLinearGradient(x - 14, 0, x + 14, 0); gr.addColorStop(0, rgba(P.accent, 0)); gr.addColorStop(0.5, rgba(P.accent, 0.12)); gr.addColorStop(1, rgba(P.accent, 0));
        g.fillStyle = gr; g.fillRect(x - 14, 30, 28, h - 60);
        g.restore();
      }
      // catwalk
      g.fillStyle = col; g.fillRect(0, 300, SW, 6);
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 278); g.lineTo(SW, 278); g.stroke();
      for (let x = 0; x < SW; x += 32) { g.fillRect(x, 278, 2, 24); }
    }
    const near = strip(LH);
    {
      const { g, h } = near;
      const r = G.rng(1701);
      for (let i = 0; i < 3; i++) {
        const x = r() * SW, w = 26 + r() * 20;
        wrapX(x, w + 10, (xx) => {
          const gr = g.createLinearGradient(xx - w, 0, xx + w, 0); gr.addColorStop(0, '#05070b'); gr.addColorStop(0.3, '#161c26'); gr.addColorStop(1, '#030407');
          g.fillStyle = gr; g.fillRect(xx - w, 0, w * 2, h);
          for (let y = 30; y < h; y += 140) { g.fillStyle = '#030406'; g.fillRect(xx - w - 6, y, w * 2 + 12, 14); g.fillStyle = 'rgba(120,160,200,0.15)'; g.fillRect(xx - w - 6, y, w * 2 + 12, 1.5); }
        });
      }
    }
    return {
      sky,
      layers: [
        { c: wall.c, fx: 0.12, fy: 0.12, y0: 0, tileY: true, meta: wall.meta },
        { c: mid.c, fx: 0.3, fy: 0.3, y0: 0, tileY: true },
        { c: near.c, fx: 0.62, fy: 0.62, y0: 0, tileY: true },
      ],
    };
  };

  BG.wreck = (P) => {
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, P.sky);
      softBlob(g, w * 0.72, h * 0.18, 260, 260, '#fff4d0', 0.6);
      g.fillStyle = 'rgba(255,250,235,0.9)'; g.beginPath(); g.arc(w * 0.72, h * 0.18, 28, 0, TAU); g.fill();
      const r = G.rng(31);
      for (let i = 0; i < 8; i++) softBlob(g, r() * w, h * (0.4 + r() * 0.4), 300, 16, '#ffe0b0', 0.3);
    });
    const far = strip(300);
    {
      const { g, h } = far;
      const f1 = wave1(1801, [2, 4, 9], 30);
      const col = mix(P.far, P.haze, 0.45);
      fillProfile(g, h, (x) => 150 + f1(x), col);
      rimLight(g, (x) => 150 + f1(x), '#fff0c8', 0.5, 1.5);
      // a broken fin of the ship sticking out of the sand far away
      g.fillStyle = mix(P.far, P.haze, 0.3);
      const fx = SW * 0.4; g.beginPath(); g.moveTo(fx - 60, 170 + f1(fx)); g.lineTo(fx - 10, 40); g.lineTo(fx + 30, 52); g.lineTo(fx + 50, 170 + f1(fx)); g.fill();
      hazeOver(g, SW, h, P.haze, 0, 0.5, 120, 260);
    }
    // tilted hull wall with breaches
    const LH = 640;
    const hull = strip(LH);
    {
      const { g, h } = hull;
      const col = P.mid;
      g.save(); g.translate(SW / 2, h / 2); g.rotate(-0.07); g.translate(-SW / 2, -h / 2);
      g.fillStyle = col; g.fillRect(-100, -100, SW + 200, h + 200);
      for (let x = -100; x < SW + 100; x += 110) {
        g.fillStyle = mix(col, '#000000', 0.35); g.fillRect(x, -100, 14, h + 200);
        g.fillStyle = mix(col, P.light, 0.12); g.fillRect(x + 14, -100, 2, h + 200);
      }
      for (let y = -100; y < h + 100; y += 70) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-100, y, SW + 200, 2); g.fillStyle = rgba(P.light, 0.05); g.fillRect(-100, y + 2, SW + 200, 1); }
      g.restore();
      // wrap-safe: the rotated wall covers the whole strip; edges are solid fill so seams are invisible
      const r = G.rng(1901);
      const breaches = [];
      for (let i = 0; i < 3; i++) {
        const bx = (i + 0.25 + r() * 0.5) * (SW / 3), by = 140 + r() * 160, br = 90 + r() * 70;
        breaches.push([bx, by, br]);
        const pts = [];
        for (let k = 0; k < 18; k++) { const a = (k / 18) * TAU; const rr = br * (0.65 + r() * 0.5); pts.push([Math.cos(a) * rr * 1.25, Math.sin(a) * rr * 0.9]); }
        wrapX(bx, br * 1.6, (xx) => {
          g.save(); g.translate(xx, by);
          g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p[0] * 1.12, p[1] * 1.12) : g.moveTo(p[0] * 1.12, p[1] * 1.12))); g.closePath();
          g.fillStyle = mix(col, '#000000', 0.5); g.fill();
          g.globalCompositeOperation = 'destination-out';
          g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill();
          g.globalCompositeOperation = 'source-over';
          g.strokeStyle = rgba('#ffd9a0', 0.55); g.lineWidth = 1.5;
          g.beginPath(); pts.slice(9, 18).forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
          // bent ribs crossing the hole
          g.strokeStyle = mix(col, '#000000', 0.3); g.lineWidth = 6;
          g.beginPath(); g.moveTo(-br * 0.6, -br * 0.9); g.quadraticCurveTo(-br * 0.2, 0, -br * 0.5, br * 0.9); g.stroke();
          g.restore();
        });
      }
      // sand piling up against the wall
      const f1 = wave1(1903, [2, 5, 11], 50);
      const sandF = (x) => h - 120 + f1(x);
      fillProfile(g, h, sandF, mix(P.rock.cap, P.mid, 0.45));
      rimLight(g, sandF, P.rock.capLight, 0.55, 1.5);
      hull.meta = { breaches };
    }
    const near = strip(LH);
    {
      const { g, h } = near;
      const r = G.rng(2001);
      for (let i = 0; i < 4; i++) {
        const x = r() * SW, w = 18 + r() * 14, lean = (r() - 0.5) * 160;
        wrapX(x, w + Math.abs(lean) + 20, (xx) => {
          g.fillStyle = P.near; g.beginPath(); g.moveTo(xx - w, h); g.lineTo(xx - w + lean, 0); g.lineTo(xx + w + lean, 0); g.lineTo(xx + w, h); g.fill();
          g.strokeStyle = rgba('#ffcf9a', 0.25); g.lineWidth = 1.5; g.beginPath(); g.moveTo(xx - w, h); g.lineTo(xx - w + lean, 0); g.stroke();
        });
      }
      g.strokeStyle = '#0a0706'; g.lineWidth = 2.5;
      for (let i = 0; i < 10; i++) { const x = r() * SW, l = 60 + r() * 160, s = 30 + r() * 60; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + s * 0.3, l, x + s * 0.7, l, x + s, 0); g.stroke(); }
      const f1 = wave1(2003, [3, 7, 13], 30);
      fillProfile(g, h, (x) => h - 50 + f1(x), mix(P.near, P.rock.capDark, 0.25));
    }
    return {
      sky,
      layers: [
        { c: far.c, fx: 0.05, fy: 0.04, y0: 220, below: mix(mix(P.far, P.haze, 0.45), P.haze, 0.5) },
        { c: hull.c, fx: 0.16, fy: 0.1, y0: -60, below: mix(P.rock.cap, P.mid, 0.45), above: P.mid, meta: hull.meta },
        { c: near.c, fx: 0.42, fy: 0.3, y0: -40, below: mix(P.near, P.rock.capDark, 0.25) },
      ],
    };
  };

  BG.tower = (P) => {
    const sky = makeSky((g, w, h) => {
      skyGradient(g, w, h, P.sky);
      softBlob(g, w * 0.3, h * 0.2, 160, 120, '#8aa8e0', 0.18);
      const r = G.rng(21);
      for (let i = 0; i < 40; i++) {
        const cx = r() * w, cy = r() * h * 0.8, rx = 80 + r() * 200, ry = 30 + r() * 60;
        softBlob(g, cx, cy, rx, ry, i % 3 ? '#0a0f1e' : '#2a3450', 0.5 + r() * 0.4);
      }
    });
    const clouds = strip(320);
    {
      const { g, h } = clouds;
      const r = G.rng(2101);
      for (let i = 0; i < 70; i++) {
        const x = r() * SW, y = 100 + r() * 160, rx = 60 + r() * 140;
        wrapX(x, rx, (xx) => softBlob(g, xx, y, rx, 40 + r() * 30, i % 2 ? '#1a2238' : '#2a3452', 0.7));
      }
      g.fillStyle = '#121a2e'; g.fillRect(0, 260, SW, 60);
    }
    const sea = strip(260);
    {
      const { g, h } = sea;
      const r = G.rng(2201);
      const f1 = wave1(2202, [5, 9, 17, 31], 18);
      fillProfile(g, h, (x) => 60 + f1(x), '#1c2440');
      for (let i = 0; i < 90; i++) { const x = r() * SW, y = 60 + r() * 60; wrapX(x, 80, (xx) => softBlob(g, xx, y + f1(mod(xx, SW)), 50 + r() * 60, 20 + r() * 14, i % 2 ? '#3a4668' : '#26304e', 0.55)); }
      rimLight(g, (x) => 60 + f1(x), '#8aa4d8', 0.25, 2);
    }
    const LH = 512;
    const frame = strip(LH);
    {
      const { g, h } = frame;
      const col = mix(P.mid, P.haze, 0.15);
      const r = G.rng(2301);
      for (let i = 0; i < 4; i++) {
        const x = i * (SW / 4) + 60 + r() * 120, w = 26 + r() * 20;
        g.fillStyle = col; g.fillRect(x - w, 0, w * 2, h);
        g.fillStyle = mix(col, '#000000', 0.4); g.fillRect(x + w * 0.4, 0, w * 0.6, h);
        g.fillStyle = mix(col, '#9ab0d0', 0.12); g.fillRect(x - w, 0, 3, h);
        for (let y = 0; y < h; y += 128) { g.fillStyle = mix(col, '#000000', 0.3); g.fillRect(x - w - 8, y, w * 2 + 16, 14); }
        g.save(); g.globalCompositeOperation = 'lighter';
        g.fillStyle = rgba(P.accent, 0.5); g.fillRect(x - 3, 0, 2, h);
        g.fillStyle = rgba(P.accent, 0.1); g.fillRect(x - 9, 0, 14, h);
        for (let y = 40; y < h; y += 128) { softBlob(g, x + w * 0.6, y, 10, 10, P.accent2, 0.6); }
        g.restore();
        // diagonal braces to the next pillar
        const nx = x + SW / 4;
        g.strokeStyle = col; g.lineWidth = 7;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(nx, h / 2); g.lineTo(x, h); g.stroke();
        g.beginPath(); g.moveTo(x - SW, 0); g.lineTo(nx - SW, h / 2); g.lineTo(x - SW, h); g.stroke();
      }
    }
    const near = strip(LH);
    {
      const { g, h } = near;
      const r = G.rng(2401);
      for (let i = 0; i < 2; i++) {
        const x = r() * SW, w = 30 + r() * 20;
        wrapX(x, w + 10, (xx) => {
          g.fillStyle = '#05060a'; g.fillRect(xx - w, 0, w * 2, h);
          g.fillStyle = 'rgba(150,180,230,0.12)'; g.fillRect(xx - w, 0, 2, h);
          for (let y = 60; y < h; y += 170) { g.fillStyle = '#020306'; g.fillRect(xx - w - 10, y, w * 2 + 20, 16); }
        });
      }
      g.strokeStyle = '#0a0c12'; g.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const x = r() * SW; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 30, h); g.stroke(); }
    }
    return {
      sky,
      layers: [
        { c: clouds.c, fx: 0.04, fy: 0.03, y0: 250, below: '#121a2e' },
        { c: frame.c, fx: 0.25, fy: 0.25, y0: 0, tileY: true },
        { c: sea.c, fx: 0.1, fy: 0, y0: 0, sea: true, below: '#1c2440' },
        { c: near.c, fx: 0.62, fy: 0.62, y0: 0, tileY: true },
      ],
    };
  };

  // ================================================================== atmosphere setup
  function buildOverlay() {
    const P = S.pal;
    const c = mk(480, 270), g = c.getContext('2d');
    g.scale(0.5, 0.5);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, P.grade.top); gr.addColorStop(1, P.grade.bottom);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H * 0.48, H * 0.35, W / 2, H * 0.5, W * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${P.vignette})`);
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    S.overlay = c;
  }

  const shaftCache = new Map();
  function shaftSprite(col) {
    let c = shaftCache.get(col);
    if (c) return c;
    c = mk(64, 256);
    const g = c.getContext('2d');
    const img = g.createImageData(64, 256), d = img.data, rgb = Pal.rgbOf(col);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
      const u = (x - 31.5) / 32, v = y / 256;
      const a = Math.exp(-u * u * 4.5) * (1 - u * u) * Math.pow(1 - v, 1.4) * (0.75 + 0.25 * Math.sin(v * 9 + x * 0.3));
      const i = (y * 64 + x) * 4;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = Math.max(0, a) * 255;
    }
    g.putImageData(img, 0, 0);
    shaftCache.set(col, c);
    return c;
  }

  function buildShafts() {
    const P = S.pal, r = G.rng(S.seed ^ 0xa11);
    S.shafts = [];
    const add = (n, opt) => { for (let i = 0; i < n; i++) S.shafts.push(Object.assign({ x: r() * SW, w: opt.w0 + r() * (opt.w1 - opt.w0), a: opt.a * (0.6 + r() * 0.4), ph: r() * TAU }, opt, opt.cols ? { col: opt.cols[i % opt.cols.length] } : {})); };
    switch (S.biome) {
      case 'canyon': add(5, { fx: 0.3, w0: 50, w1: 150, a: 0.2, ang: 0.12, col: P.light }); break;
      case 'ruins': add(S.variant === 'overgrown' ? 4 : 3, { fx: 0.2, w0: 70, w1: 180, a: S.variant === 'overgrown' ? 0.14 : 0.16, ang: 0.42, col: P.light }); break;
      case 'crystal': add(5, { fx: 0.25, w0: 40, w1: 110, a: 0.13, ang: -0.22, cols: [P.accent, P.accent2, '#ff9ad8', '#9ab8ff', P.accent] }); break;
      case 'caves': add(2, { fx: 0.22, w0: 30, w1: 60, a: 0.1, ang: 0.08, col: '#a8ffe8' }); break;
      case 'wreck': {
        const hull = S.layers[1] && S.layers[1].meta;
        if (hull) for (const b of hull.breaches) S.shafts.push({ x: b[0], fx: hull ? S.layers[1].fx : 0.16, w: b[2] * 1.2, a: 0.22, ang: 0.38, col: P.light, ph: r() * TAU, layerY: b[1] });
        break;
      }
      case 'desert': add(2, { fx: 0.1, w0: 160, w1: 260, a: 0.07, ang: -0.55, col: '#ffcf9a' }); break;
    }
  }

  function buildMotes() {
    const r = G.rng(S.seed ^ 0x3017);
    S.motes = [];
    for (const m of S.pal.motes) {
      const arr = [];
      for (let i = 0; i < m.n; i++) arr.push({ x: r() * (W + 120), y: r() * (H + 120), d: m.depth * (0.6 + r() * 0.6), s: m.size * (0.6 + r() * 0.8), sp: 0.6 + r() * 0.8, ph: r() * TAU, f: 0.5 + r() * 1.5, l: r() });
      S.motes.push({ m, arr });
    }
  }

  // ================================================================== foreground silhouettes
  function buildForeground() {
    S.fg = [];
    const P = S.pal, r = G.rng(S.seed ^ 0xf06);
    const col = mix(P.near, '#000000', 0.45);
    const kinds = {
      ship: ['cables', 'pipe'], wreck: ['cables', 'debris'], desert: ['rocks', 'grass'], canyon: ['rocks', 'roots'],
      ruins: S.variant === 'overgrown' ? ['vines', 'ferns'] : ['vines', 'rocks'], caves: ['stalac', 'rocks'], crystal: ['crystals', 'crystalsUp'], tower: ['chains', 'beam'],
    }[S.biome] || ['rocks'];
    const sprites = [];
    for (let v = 0; v < 4; v++) {
      const kind = kinds[v % kinds.length];
      const top = ['cables', 'vines', 'stalac', 'crystals', 'chains', 'roots'].includes(kind);
      const w = 180 + r() * 120, h = top ? 90 + r() * 50 : 60 + r() * 20;
      const c = mk(w, h), g = c.getContext('2d');
      try { g.filter = 'blur(1.5px)'; } catch (e) { /* unsupported */ }
      g.fillStyle = col; g.strokeStyle = col;
      const rr = G.rng(5000 + v);
      switch (kind) {
        case 'cables': case 'chains': case 'vines': case 'roots':
          for (let k = 0; k < 7; k++) { const x0 = 10 + rr() * (w - 20), l = h * (0.4 + rr() * 0.55), s = (rr() - 0.5) * 60; g.lineWidth = kind === 'vines' ? 3 + rr() * 3 : 4 + rr() * 4; g.beginPath(); g.moveTo(x0, 0); if (kind === 'cables') g.bezierCurveTo(x0, l, x0 + s, l, x0 + s, 0); else g.bezierCurveTo(x0 + 10, l * 0.4, x0 - 10, l * 0.7, x0 + s * 0.2, l); g.stroke(); if (kind === 'vines') { for (let q = 10; q < l; q += 14) { g.beginPath(); g.ellipse(x0 + Math.sin(q) * 6, q, 6, 3, q, 0, TAU); g.fill(); } } }
          break;
        case 'stalac': case 'crystals':
          g.fillRect(0, 0, w, 14);
          for (let k = 0; k < 6; k++) { const x0 = 10 + rr() * (w - 20), l = h * (0.4 + rr() * 0.6), sw = 8 + rr() * 16; g.beginPath(); g.moveTo(x0 - sw, 0); g.lineTo(x0 + (kind === 'crystals' ? (rr() - 0.5) * 20 : 0), l); g.lineTo(x0 + sw, 0); g.fill(); }
          break;
        case 'rocks': case 'debris': case 'crystalsUp':
          g.beginPath(); g.moveTo(0, h);
          for (let x = 0; x <= w; x += 10) g.lineTo(x, h - (Math.sin((x / w) * Math.PI) * h * 0.7 + rr() * 10) * (kind === 'crystalsUp' && x % 30 === 0 ? 1.4 : 1));
          g.lineTo(w, h); g.fill();
          break;
        case 'grass': case 'ferns':
          g.lineWidth = 3;
          for (let k = 0; k < 26; k++) { const x0 = rr() * w, l = h * (0.4 + rr() * 0.6), lean = (rr() - 0.5) * 40; g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + lean * 0.3, h - l * 0.6, x0 + lean, h - l); g.stroke(); }
          break;
        case 'pipe': case 'beam':
          g.fillRect(0, h * 0.35, w, h * 0.4); g.fillRect(w * 0.2, h * 0.2, 16, h); g.fillRect(w * 0.7, h * 0.2, 16, h);
          break;
      }
      sprites.push({ c, top, w, h });
    }
    const span = (S.w * T) * 1.35 + W;
    let x = 200 + r() * 400;
    while (x < span) {
      const sp = sprites[(r() * sprites.length) | 0];
      S.fg.push({ x, sp, flip: r() < 0.5 });
      x += 700 + r() * 900;
    }
  }

  // ================================================================== public API
  const Decor = {
    /** One-time startup hook: pre-build biome-independent sprites. */
    boot() {
      for (const c of ['#ffffff', '#ffd36a', '#bfefff']) glowSprite(c);
    },

    /**
     * Prepare caches for a level: static grid, depth field, material, scatter, backgrounds,
     * atmosphere and foreground. Called by GameScene when a level loads.
     * @param {G.Level} level
     */
    init(level) {
      TC = G.TILE_CODES;
      const t0 = performance.now();
      S.level = level;
      S.pal = Pal.get(level);
      S.biome = STYLES[level.biome] ? level.biome : 'desert';
      S.variant = (level.def && level.def.variant) || '';
      S.key = S.variant ? S.biome + '_' + S.variant : S.biome;
      S.st = STYLES[S.biome];
      S.seed = G.hash(level.id);
      S.cs = (G.renderScale || 1) > 1.15 ? 2 : 1;
      S.lastRS = G.renderScale || 1;
      S.w = level.w; S.h = level.h;
      S.grid = new Uint8Array(level.tiles);
      S.chunks.clear(); S.gone.clear(); S.acidGrad.clear();
      buildDepth();
      S.mat = buildMaterial(S.st.mat, S.pal, S.key);
      try {
        const g = S.mat.getContext('2d');
        S.pattern = g.createPattern(S.mat, 'repeat');
      } catch (e) { S.pattern = null; }
      buildScatter(level);
      buildCrumbleSprites();
      const bg = (BG[S.biome] || BG.desert)(S.pal);
      S.sky = bg.sky; S.layers = bg.layers;
      buildOverlay();
      buildShafts();
      buildMotes();
      buildForeground();
      S.propSprites = new Map();
      S.initMs = performance.now() - t0;
    },

    /**
     * Sky + parallax layers (VIEW space). Fills the whole 960x540.
     * @param {CanvasRenderingContext2D} ctx
     * @param {{x:number,y:number,w:number,h:number}} view camera rect in world px
     * @param {G.Level} level
     * @param {number} t level time (s)
     */
    drawBackground(ctx, view, level, t) {
      if (S.level !== level) Decor.init(level);
      const rs = G.renderScale || 1;
      const snap = (v) => Math.round(v * rs) / rs;
      const refY = Math.max(0, level.pxH - H);
      const dY = refY - view.y; // >= 0, grows as the camera climbs
      const maxX = Math.max(1, level.pxW - W);
      // sky (non-tiled, tiny parallax)
      const sx = -((view.x / maxX) * (SKY_W - W));
      const sy = -(SKY_H - H) + G.clamp(dY * 0.03, 0, SKY_H - H);
      ctx.drawImage(S.sky, snap(sx), snap(sy));
      if (S.biome === 'tower') drawLightningSky(ctx, t);
      for (const L of S.layers) {
        const lw = L.c.width, lh = L.c.height;
        let x = -mod(view.x * L.fx, lw);
        x = snap(x);
        if (L.sea) {
          const hk = G.clamp(dY / 1400, 0, 1);
          const y = snap(H + 40 - hk * 300);
          if (y >= H) continue;
          for (let xx = x; xx < W; xx += lw) ctx.drawImage(L.c, xx, y);
          if (y + lh < H) { ctx.fillStyle = L.below; ctx.fillRect(0, y + lh - 1, W, H - y - lh + 1); }
          continue;
        }
        if (L.tileY) {
          const y = snap(-mod(-(L.y0 + dY * L.fy), lh));
          for (let yy = y; yy < H; yy += lh) for (let xx = x; xx < W; xx += lw) ctx.drawImage(L.c, xx, yy);
        } else {
          const y = snap(L.y0 + (L.topAnchor ? 0 : dY * L.fy));
          if (y < H) {
            for (let xx = x; xx < W; xx += lw) ctx.drawImage(L.c, xx, y);
            if (L.below && y + lh < H) { ctx.fillStyle = L.below; ctx.fillRect(0, y + lh - 1, W, H - (y + lh) + 1); }
          }
          if (L.above && y > 0) { ctx.fillStyle = L.above; ctx.fillRect(0, 0, W, y + 1); }
        }
        // per-layer animated accents
        if (L.meta && L.meta.spire) {
          const [px, py] = L.meta.spire;
          const y = snap(L.y0 + dY * L.fy) + py;
          const a = 0.55 + 0.45 * Math.sin(t * 2.4);
          ctx.globalCompositeOperation = 'lighter';
          for (let xx = x + px; xx < W + 40; xx += lw) if (xx > -40) { glow(ctx, '#7ef9ff', xx, y, 22, a * 0.8); glow(ctx, '#ffffff', xx, y, 5, a); }
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        }
        if (L.meta && L.meta.alarms) {
          const a = Math.max(0, Math.sin(t * 2.6)) ** 2;
          if (a > 0.02) {
            const y0 = -mod(-(L.y0 + dY * L.fy), lh);
            ctx.globalCompositeOperation = 'lighter';
            for (const [ax, ay] of L.meta.alarms) for (let xx = x + ax; xx < W + 60; xx += lw) for (let yy = y0 + ay; yy < H + 60; yy += lh) if (xx > -60) { glow(ctx, P0().accent2, xx, yy, 40, a * 0.6); glow(ctx, '#ffc0c0', xx, yy, 6, a); }
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          }
        }
      }
      ctx.globalAlpha = 1;
    },

    /**
     * Tiles (WORLD space): cached static chunks + per-frame acid, crumble and animated details.
     */
    drawTiles(ctx, view, level, t) {
      if (S.level !== level) Decor.init(level);
      const rs = G.renderScale || 1;
      if (Math.abs(rs - S.lastRS) > 0.01) { S.lastRS = rs; const ncs = rs > 1.15 ? 2 : 1; if (ncs !== S.cs) { S.cs = ncs; S.chunks.clear(); buildCrumbleSprites(); } }
      const cx0 = Math.max(0, Math.floor(view.x / CPX)), cx1 = Math.floor((view.x + W) / CPX);
      const cy0 = Math.max(0, Math.floor(view.y / CPX)), cy1 = Math.floor((view.y + H) / CPX);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (cx * CHUNK >= S.w + 1 || cy * CHUNK >= S.h + 1) continue;
          const c = getChunk(cx, cy);
          if (c) ctx.drawImage(c, cx * CPX - PAD, cy * CPX - PAD, CPX + PAD * 2, CPX + PAD * 2);
        }
      }
      const tx0 = Math.max(0, Math.floor(view.x / T) - 1), tx1 = Math.min(S.w - 1, Math.floor((view.x + W) / T) + 1);
      const ty0 = Math.max(0, Math.floor(view.y / T) - 1), ty1 = Math.min(S.h - 1, Math.floor((view.y + H) / T) + 1);
      drawAcid(ctx, level, tx0, tx1, Math.max(0, ty0 - 3), ty1, t);
      drawCrumbles(ctx, level, tx0, tx1, ty0, ty1, t);
      // animated scatter
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const vx0 = view.x - 40, vx1 = view.x + W + 40, vy0 = view.y - 80, vy1 = view.y + H + 80;
      for (const s of S.anim) {
        if (s.x < vx0 || s.x > vx1 || s.y < vy0 || s.y > vy1) continue;
        const additive = !(s.k === 'stalac' || s.k === 'drip' || s.k === 'sanddrip' || s.k === 'puddle');
        ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
        drawScatterAnim(ctx, s, t);
      }
      ctx.restore();
      // pre-build one neighbouring chunk ahead of the camera when the frame is cheap
      prefetch(view);
    },

    /**
     * Decor prop (WORLD space). Bottom-centre at tile (e.x, e.y); honours e.flip and e.scale.
     */
    drawProp(ctx, e, t, level) {
      if (S.level !== level && level) Decor.init(level);
      drawPropImpl(ctx, e, t);
    },

    /**
     * Sparse foreground silhouettes (WORLD space ctx, positioned with 1.35x parallax and
     * anchored to the screen edges so they never sit over the player for long).
     */
    drawForeground(ctx, view, level, t) {
      if (!S.fg.length) return;
      const k = 1.35;
      for (const f of S.fg) {
        const sx = f.x - view.x * k;
        const sp = f.sp;
        if (sx > W + 20 || sx + sp.w < -20) continue;
        const wx = view.x + sx;
        const wy = sp.top ? view.y - 6 : view.y + H - sp.h + 8;
        ctx.globalAlpha = sp.top ? 0.92 : 0.8;
        if (f.flip) { ctx.save(); ctx.translate(wx + sp.w, wy); ctx.scale(-1, 1); ctx.drawImage(sp.c, 0, 0); ctx.restore(); }
        else ctx.drawImage(sp.c, wx, wy);
      }
      ctx.globalAlpha = 1;
    },

    /**
     * Atmosphere (VIEW space): light shafts, ambient particles, weather, alarm / lightning,
     * colour grade and vignette.
     */
    drawAtmosphere(ctx, view, level, t) {
      if (S.level !== level) return;
      ctx.save();
      // light shafts
      if (S.shafts.length) {
        ctx.globalCompositeOperation = 'lighter';
        const refY = Math.max(0, level.pxH - H), dY = refY - view.y;
        for (const s of S.shafts) {
          let x = mod(s.x - view.x * s.fx + 200, SW) - 200;
          for (; x < W + 300; x += SW) {
            if (x < -300) continue;
            const a = s.a * (0.75 + 0.25 * Math.sin(t * 0.5 + s.ph));
            const top = s.layerY != null ? s.layerY - 60 + (S.layers[1].y0 + dY * S.layers[1].fy) : -40;
            ctx.save(); ctx.translate(x, top); ctx.transform(1, 0, Math.tan(s.ang), 1, 0, 0);
            ctx.globalAlpha = a;
            ctx.drawImage(shaftSprite(s.col), -s.w / 2, 0, s.w, H + 120 - Math.min(0, top));
            ctx.restore();
          }
        }
      }
      // ambient particles
      drawMotes(ctx, view, t);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      // biome specials
      if (S.biome === 'ship') {
        const a = Math.max(0, Math.sin(t * 2.6)) ** 2 * 0.16;
        if (a > 0.005) {
          const gr = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
          gr.addColorStop(0, 'rgba(255,30,50,0)'); gr.addColorStop(1, `rgba(255,30,50,${a})`);
          ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        }
      } else if (S.biome === 'caves') {
        ctx.drawImage(vfade('#7aff4a'), 0, H - 90, W, 90);
      } else if (S.biome === 'tower') {
        const b = lightning(t).b;
        if (b > 0.01) { ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(170,190,255,${0.16 * b})`; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
      } else if (S.biome === 'desert' || S.biome === 'wreck') {
        ctx.globalAlpha = 0.5; ctx.drawImage(vfade(S.pal.haze), 0, H - 70, W, 70); ctx.globalAlpha = 1;
      }
      // grade + vignette
      ctx.drawImage(S.overlay, 0, 0, W, H);
      ctx.restore();
    },

    /** CSS colour for footstep / landing dust. */
    dustColor(level) { return Pal.get(level).dust; },
    /** CSS colour for crumble debris. */
    debrisColor(level) { return Pal.get(level).debris; },

    /** Debug / QA: cache statistics. */
    stats() { return { chunks: [...S.chunks.values()].filter((e) => e.c).length, scatter: S.scatter.length, anim: S.anim.length, initMs: S.initMs, cs: S.cs }; },
  };
  const P0 = () => S.pal;

  function prefetch(view) {
    const t0 = performance.now();
    const cxs = [Math.floor((view.x + W + 200) / CPX), Math.floor((view.x - 200) / CPX)];
    const cys = [Math.floor((view.y + H / 2) / CPX), Math.floor((view.y - 150) / CPX), Math.floor((view.y + H + 150) / CPX)];
    for (const cx of cxs) for (const cy of cys) {
      if (cx < 0 || cy < 0 || cx * CHUNK > S.w || cy * CHUNK > S.h) continue;
      if (S.chunks.has(cx + ',' + cy)) continue;
      if (performance.now() - t0 > 1) return;
      getChunk(cx, cy);
      return; // at most one per frame
    }
  }

  // ================================================================== acid
  function acidGradient(ctx, depthPx) {
    let gr = S.acidGrad.get(depthPx);
    if (gr) return gr;
    const A = S.pal.acid;
    gr = ctx.createLinearGradient(0, 0, 0, depthPx);
    gr.addColorStop(0, A.top); gr.addColorStop(0.12, A.body); gr.addColorStop(0.6, mix(A.body, A.deep, 0.6)); gr.addColorStop(1, A.deep);
    S.acidGrad.set(depthPx, gr);
    return gr;
  }
  function drawAcid(ctx, level, x0, x1, y0, y1, t) {
    const A = S.pal.acid;
    for (let ty = y0; ty <= y1; ty++) {
      let tx = x0;
      while (tx <= x1) {
        if (S.grid[ty * S.w + tx] !== TC.ACID || (ty > 0 && S.grid[(ty - 1) * S.w + tx] === TC.ACID)) { tx++; continue; }
        let d = 1; while (ty + d < S.h && S.grid[(ty + d) * S.w + tx] === TC.ACID && d < 6) d++;
        let ex = tx;
        while (ex + 1 <= x1 && S.grid[ty * S.w + ex + 1] === TC.ACID && !(ty > 0 && S.grid[(ty - 1) * S.w + ex + 1] === TC.ACID)) {
          let d2 = 1; while (ty + d2 < S.h && S.grid[(ty + d2) * S.w + ex + 1] === TC.ACID && d2 < 6) d2++;
          if (d2 !== d) break;
          ex++;
        }
        drawAcidRun(ctx, tx, ex, ty, d, t, A);
        tx = ex + 1;
      }
    }
  }
  function drawAcidRun(ctx, sx, ex, ty, depth, t, A) {
    const X0 = sx * T, X1 = (ex + 1) * T, top = ty * T + 8, bot = (ty + depth) * T;
    const wave = (x) => Math.sin(x * 0.075 + t * 2.3) * 1.5 + Math.sin(x * 0.19 - t * 3.4) * 0.8;
    ctx.save();
    // glow above the surface
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 + 0.1 * Math.sin(t * 2);
    ctx.drawImage(vfade(A.glow), X0 - 4, top - 34, X1 - X0 + 8, 36);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // body
    ctx.beginPath(); ctx.moveTo(X0, bot);
    for (let x = X0; x <= X1; x += 4) ctx.lineTo(x, top + wave(x));
    ctx.lineTo(X1, bot); ctx.closePath();
    ctx.translate(0, ty * T);
    ctx.fillStyle = acidGradient(ctx, depth * T);
    ctx.fill();
    ctx.translate(0, -ty * T);
    // surface highlight
    ctx.beginPath();
    for (let x = X0; x <= X1; x += 4) { const y = top + wave(x); if (x === X0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.strokeStyle = A.top; ctx.lineWidth = 2; ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(A.glow, 0.5); ctx.lineWidth = 4; ctx.stroke();
    // caustic streaks + bubbles
    ctx.fillStyle = rgba(A.top, 0.35);
    for (let x = X0 + mod(t * 18, 24); x < X1 - 6; x += 24) ctx.fillRect(x, top + 5 + wave(x) * 0.5, 7, 1.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(A.bubble, 0.85); ctx.lineWidth = 1;
    for (let tx = sx; tx <= ex; tx++) {
      for (let k = 0; k < 2; k++) {
        const ph = h2(tx, ty, 900 + k), p = frac(t * (0.35 + ph * 0.4) + ph);
        const bx = tx * T + 5 + h2(tx, ty, 910 + k) * 22 + Math.sin(t * 3 + ph * 9) * 1.5;
        const by = bot - 3 - p * (bot - top - 4);
        const br = 1 + ph * 1.8;
        if (p > 0.92) { const q = (p - 0.92) / 0.08; ctx.globalAlpha = 1 - q; ctx.beginPath(); ctx.ellipse(bx, top + wave(bx), br + q * 5, 1 + q, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
        else { ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.stroke(); }
      }
    }
    ctx.restore();
  }

  // ================================================================== crumble
  function drawCrumbles(ctx, level, x0, x1, y0, y1, t) {
    if (!level.crumbles.size) return;
    const cs = S.cs;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (S.grid[ty * S.w + tx] !== TC.CRUMBLE) continue;
        const cr = level.crumbleState(tx, ty);
        if (!cr) continue;
        const idx = ty * S.w + tx;
        if (cr.state === 'gone') { S.gone.add(idx); continue; }
        let a = 1, ox = 0, oy = 0, sc = 1;
        if (S.gone.has(idx)) { if (cr.state === 'idle' && cr.t < 0.35) { a = cr.t / 0.35; sc = 0.85 + 0.15 * a; } else S.gone.delete(idx); }
        if (cr.state === 'shaking') {
          const k = G.clamp(cr.t / 0.45, 0, 1);
          ox = Math.sin(t * 75 + tx * 1.7) * (0.8 + k * 1.6);
          oy = Math.sin(t * 61 + ty) * 0.6 + k * 1.2;
        }
        const spr = S.crumbleSpr[(tx + ty) & 1];
        ctx.globalAlpha = a;
        const x = tx * T + ox, y = ty * T + oy;
        if (sc !== 1) { ctx.save(); ctx.translate(x + T / 2, y + T / 2); ctx.scale(sc, sc); ctx.drawImage(spr, -T / 2 - 4, -T / 2 - 4, T + 8, T + 8); ctx.restore(); }
        else ctx.drawImage(spr, x - 4, y - 4, T + 8, T + 8);
        if (cr.state === 'shaking') {
          const k = G.clamp(cr.t / 0.45, 0, 1);
          ctx.fillStyle = `rgba(255,220,180,${0.12 * k})`; ctx.fillRect(x, y, T, T);
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = S.pal.debris;
          for (let i = 0; i < 3; i++) { const p = frac(t * 2.2 + i / 3 + tx * 0.13); ctx.fillRect(tx * T + 6 + i * 9, ty * T + T + p * 18, 2, 2); }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // ================================================================== lightning (tower)
  /** Deterministic storm schedule: at most one flash per 5.5 s slot (always >= 4 s apart). */
  function lightning(t) {
    const slot = Math.floor(t / 5.5);
    if (h2(slot, 7, 1) < 0.3) return { b: 0, slot };
    const tf = slot * 5.5 + 0.3 + h2(slot, 7, 2) * 1.2;
    const dt = t - tf;
    if (dt < 0 || dt > 0.6) return { b: 0, slot };
    const b = dt < 0.06 ? dt / 0.06 : Math.exp(-(dt - 0.06) * 7);
    return { b, slot, dt };
  }
  function drawLightningSky(ctx, t) {
    const L = lightning(t);
    if (L.b <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bx = 120 + h2(L.slot, 3, 4) * (W - 240);
    glow(ctx, '#9ab4ff', bx, 120, 360, 0.5 * L.b);
    if (L.dt < 0.22) {
      const r = G.rng(L.slot * 977 + 1);
      ctx.globalAlpha = Math.min(1, L.b * 1.2);
      ctx.strokeStyle = '#e8eeff'; ctx.lineWidth = 2;
      ctx.beginPath(); let x = bx, y = 0; ctx.moveTo(x, y);
      while (y < 330) { x += (r() - 0.5) * 40; y += 14 + r() * 26; ctx.lineTo(x, y); if (r() < 0.2) { ctx.lineTo(x + (r() - 0.5) * 60, y + 30); ctx.moveTo(x, y); } }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(160,180,255,0.4)'; ctx.lineWidth = 6; ctx.stroke();
    }
    ctx.restore();
  }

  // ================================================================== ambient particles
  function drawMotes(ctx, view, t) {
    const SPX = W + 120, SPY = H + 120;
    for (const { m, arr } of S.motes) {
      ctx.globalCompositeOperation = m.glow ? 'lighter' : 'source-over';
      if (m.kind === 'rain' || m.kind === 'streak') {
        ctx.beginPath();
        for (const p of arr) {
          const x = mod(p.x + m.vx * p.sp * t - view.x * p.d, SPX) - 60, y = mod(p.y + m.vy * p.sp * t - view.y * p.d, SPY) - 60;
          if (m.kind === 'rain') { ctx.moveTo(x, y); ctx.lineTo(x + m.vx * 0.022, y + m.vy * 0.022 * p.sp); }
          else { const len = 50 + p.l * 120; ctx.moveTo(x, y); ctx.lineTo(x + len, y + 2); }
        }
        ctx.strokeStyle = rgba(m.color, m.alpha); ctx.lineWidth = m.size; ctx.globalAlpha = 1; ctx.stroke();
        continue;
      }
      ctx.fillStyle = m.color;
      for (const p of arr) {
        let x = mod(p.x + m.vx * p.sp * t - view.x * p.d, SPX) - 60, y = mod(p.y + m.vy * p.sp * t - view.y * p.d, SPY) - 60;
        if (m.kind === 'mote' || m.kind === 'spore') { x += Math.sin(t * 0.7 * p.f + p.ph) * 10; y += Math.cos(t * 0.5 * p.f + p.ph) * 6; }
        if (m.kind === 'sand') y += Math.sin(t * 3 + p.ph) * 3;
        if (m.kind === 'glint') {
          const k = Math.pow(Math.max(0, Math.sin(t * p.f + p.ph)), 16);
          if (k < 0.03) continue;
          glow(ctx, m.color, x, y, p.s * 4, k * 0.7);
          ctx.globalAlpha = k * m.alpha; ctx.fillRect(x - p.s * 2 * k, y - 0.5, p.s * 4 * k, 1); ctx.fillRect(x - 0.5, y - p.s * 2 * k, 1, p.s * 4 * k);
          continue;
        }
        const a = m.alpha * (m.kind === 'sand' ? 1 : 0.55 + 0.45 * Math.sin(t * p.f + p.ph));
        if (m.kind === 'spore') { glow(ctx, m.color, x, y, p.s * 3, a * 0.6); ctx.fillStyle = m.color; }
        ctx.globalAlpha = a;
        if (m.kind === 'sand') ctx.fillRect(x, y, p.s * 3, p.s * 0.8);
        else ctx.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ================================================================== props
  /* PROPS-BEGIN */
  function drawPropImpl(ctx, e, t) { /* filled in below */ }
  /* PROPS-END */

  G.Art.Decor = Decor;
})();
