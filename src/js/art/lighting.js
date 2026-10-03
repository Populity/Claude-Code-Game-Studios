/**
 * TESSERA dynamic 2D lighting + shadows (lighting artist). Contract: docs/chapter2-spec.md §3.
 *
 *   G.Art.Lighting.draw(ctx, view, level, t, game)   WORLD space, after actors, before front props.
 *   G.Art.Lighting.setQuality('high'|'medium')
 *   G.Art.Lighting.enabled = false                   QA / A-B comparison switch
 *   G.Art.Lighting.stats()                           { ms, lights, shadowed, segs }
 *
 * Pipeline (all in a 0.5x view-sized light map):
 *   1. fill with the biome ambient colour (Palette.lighting)
 *   2. add every visible light ('lighter'): unshadowed sprites for small lights; for the <=6
 *      strongest nearby lights, the sprite is masked by a visibility polygon ray-cast against a
 *      cached, merged, axis-aligned tile-edge segment set (rebuilt only on level.version change).
 *      Static lights cache their polygon.
 *   3. blur (high quality) and composite onto the frame with 'multiply'
 *   4. contact shadows under actors, then a light additive bloom pass at the sources.
 * Skipped entirely when G.lowGfx().
 */
(function () {
  const T = G.TILE, W = G.VIEW_W, H = G.VIEW_H, TAU = Math.PI * 2;
  const Pal = G.Art.Palette;
  const Q = { high: { q: 0.5, maxShadow: 6, blur: 2, rays: 1 }, medium: { q: 0.4, maxShadow: 3, blur: 0, rays: 1 } };
  let quality = 'high';
  const S = {
    level: null, ver: -1, hs: [], vs: [], acid: [], polyCache: new Map(),
    map: null, blurBuf: null, tmp: null, mask: null, ms: 0, nLights: 0, nShadow: 0,
  };

  // ------------------------------------------------------------------ helpers
  function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  const sprites = new Map();
  /** Radial light sprite (premultiplied-looking falloff, tinted). */
  function sprite(col) {
    let c = sprites.get(col);
    if (c) return c;
    const N = 128; c = mk(N, N);
    const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data, rgb = Pal.rgbOf(col);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.sqrt(u * u + v * v);
      const a = r >= 1 ? 0 : Math.pow(1 - r, 1.35) * (0.75 + 0.25 * Math.exp(-r * r * 18));
      const i = (y * N + x) * 4;
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = Math.min(255, a * 255);
    }
    g.putImageData(img, 0, 0);
    sprites.set(col, c);
    return c;
  }
  const hsh = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  /** Flicker multipliers: 'steady' | 'soft' (breathing) | 'fire' | 'neon' (rare dropouts) | 'pulse'. */
  function flick(kind, t, seed) {
    switch (kind) {
      case 'fire': return 0.78 + 0.12 * Math.sin(t * 13 + seed) + 0.1 * Math.sin(t * 29.7 + seed * 3);
      case 'soft': return 0.88 + 0.12 * Math.sin(t * 1.3 + seed);
      case 'neon': { const k = Math.floor(t * 12); return hsh(k, seed | 0) < 0.04 ? 0.35 : 0.96 + 0.04 * Math.sin(t * 50); }
      case 'pulse': return 0.7 + 0.3 * Math.sin(t * 3 + seed);
      default: return 1;
    }
  }

  // ------------------------------------------------------------------ static geometry
  /** Merged axis-aligned edges between solid and open tiles. hs: {y,a,b,up}; vs: {x,a,b,left}. */
  function buildSegments(level) {
    const w = level.w, h = level.h;
    const sol = new Uint8Array(w * h);
    for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) sol[ty * w + tx] = level.isSolidTile(tx, ty) ? 1 : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : sol[y * w + x]);
    const hs = [], vs = [];
    for (let ty = 0; ty <= h; ty++) {
      let run = null;
      for (let tx = 0; tx <= w; tx++) {
        const a = at(tx, ty - 1), b = at(tx, ty);
        const type = tx < w && a !== b ? (b ? 1 : 2) : 0; // 1: top face (solid below), 2: bottom face
        if (run && run.type !== type) { hs.push({ y: ty * T, a: run.x * T, b: tx * T, up: run.type === 1 }); run = null; }
        if (type && !run) run = { type, x: tx };
      }
    }
    for (let tx = 0; tx <= w; tx++) {
      let run = null;
      for (let ty = 0; ty <= h; ty++) {
        const a = at(tx - 1, ty), b = at(tx, ty);
        const type = ty < h && a !== b ? (b ? 1 : 2) : 0; // 1: left face (solid right), 2: right face
        if (run && run.type !== type) { vs.push({ x: tx * T, a: run.y * T, b: ty * T, left: run.type === 1 }); run = null; }
        if (type && !run) run = { type, y: ty };
      }
    }
    S.hs = hs; S.vs = vs; S.sol = sol;
    // acid surface runs (for acid glow lights)
    const AC = G.TILE_CODES.ACID;
    S.acid = [];
    for (let ty = 0; ty < h; ty++) {
      let x0 = -1;
      for (let tx = 0; tx <= w; tx++) {
        const top = tx < w && level.tiles[ty * w + tx] === AC && (ty === 0 || level.tiles[(ty - 1) * w + tx] !== AC);
        if (top && x0 < 0) x0 = tx;
        if (!top && x0 >= 0) { S.acid.push({ x0: x0 * T, x1: tx * T, y: ty * T + 6 }); x0 = -1; }
      }
    }
    S.polyCache.clear();
    S.ver = level.version;
  }
  const solidPx = (x, y) => { const L = S.level, tx = Math.floor(x / T), ty = Math.floor(y / T); return tx >= 0 && ty >= 0 && tx < L.w && ty < L.h && S.sol[ty * L.w + tx] === 1; };

  /**
   * Visibility polygon (world px) for a point light of radius R. Only segments facing the light
   * are considered (the first hit on a closed solid is always a front face).
   * @returns {Float32Array} interleaved x,y sorted by angle
   */
  function visPoly(lx, ly, R) {
    const x0 = lx - R, x1 = lx + R, y0 = ly - R, y1 = ly + R;
    const H_ = [], V_ = [];
    for (const s of S.hs) { if (s.y < y0 || s.y > y1 || s.b < x0 || s.a > x1) continue; if (s.up ? ly < s.y : ly > s.y) H_.push(s); }
    for (const s of S.vs) { if (s.x < x0 || s.x > x1 || s.b < y0 || s.a > y1) continue; if (s.left ? lx < s.x : lx > s.x) V_.push(s); }
    const pts = [x0, y0, x1, y0, x1, y1, x0, y1];
    for (const s of H_) { if (s.a >= x0) pts.push(s.a, s.y); if (s.b <= x1) pts.push(s.b, s.y); }
    for (const s of V_) { if (s.a >= y0) pts.push(s.x, s.a); if (s.b <= y1) pts.push(s.x, s.b); }
    const out = [];
    const cast = (ang) => {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      // bounding box exit
      let tm = Math.min(dx > 1e-9 ? (x1 - lx) / dx : dx < -1e-9 ? (x0 - lx) / dx : 1e9, dy > 1e-9 ? (y1 - ly) / dy : dy < -1e-9 ? (y0 - ly) / dy : 1e9);
      if (Math.abs(dy) > 1e-9) for (const s of H_) { const t = (s.y - ly) / dy; if (t <= 0 || t >= tm) continue; const x = lx + dx * t; if (x >= s.a - 0.01 && x <= s.b + 0.01) tm = t; }
      if (Math.abs(dx) > 1e-9) for (const s of V_) { const t = (s.x - lx) / dx; if (t <= 0 || t >= tm) continue; const y = ly + dy * t; if (y >= s.a - 0.01 && y <= s.b + 0.01) tm = t; }
      out.push(ang, lx + dx * tm, ly + dy * tm);
    };
    const seen = new Set();
    for (let i = 0; i < pts.length; i += 2) {
      const k = pts[i] * 65536 + pts[i + 1];
      if (seen.has(k)) continue; seen.add(k);
      const a = Math.atan2(pts[i + 1] - ly, pts[i] - lx);
      cast(a - 0.0004); cast(a); cast(a + 0.0004);
    }
    const n = out.length / 3, idx = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => out[a * 3] - out[b * 3]);
    const poly = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { poly[i * 2] = out[idx[i] * 3 + 1]; poly[i * 2 + 1] = out[idx[i] * 3 + 2]; }
    return poly;
  }

  // ------------------------------------------------------------------ light gathering
  /** Prop light emitters, in prop-local px (origin bottom-centre, y up negative). */
  const PROP_LIGHTS = {
    lamp: { ox: 0, oy: -64, r: 230, i: 0.95, fl: 'soft', shadow: true, col: (b) => (b === 'ship' || b === 'tower' || b === 'crystal' || b === 'ruins' ? '#bfefff' : '#ffd9a0') },
    glow_moss: { ox: 0, oy: -10, r: 120, i: 0.6, fl: 'soft', col: (b, P) => P.rock.capLight },
    warning_light: { ox: 0, oy: -20, r: 150, i: 0.8, fl: 'pulse', col: () => '#ff4a3a' },
    fire: { ox: 0, oy: -14, r: 240, i: 1, fl: 'fire', shadow: true, col: () => '#ffa04a' },
    beacon_core: { ox: 0, oy: -50, r: 260, i: 0.9, fl: 'pulse', shadow: true, col: (b, P) => P.accent },
    crystal_cluster: { ox: 0, oy: -18, r: 120, i: 0.55, fl: 'soft', col: (b, P) => P.accent },
    crystal_big: { ox: 0, oy: -50, r: 200, i: 0.7, fl: 'soft', shadow: true, col: (b, P) => P.accent2 },
    geode: { ox: 0, oy: -20, r: 140, i: 0.6, fl: 'soft', col: (b, P) => P.accent },
    mushroom: { ox: 0, oy: -20, r: 110, i: 0.55, fl: 'soft', col: (b, P) => P.accent },
    singing_pillar: { ox: 0, oy: -80, r: 140, i: 0.45, fl: 'soft', col: (b, P) => P.accent },
    console: { ox: 0, oy: -34, r: 110, i: 0.55, fl: 'neon', col: (b, P) => (b === 'wreck' ? '#ffb46a' : P.accent) },
    cryo_pod: { ox: 0, oy: -45, r: 130, i: 0.6, fl: 'soft', col: () => '#7ef9ff' },
    window_space: { ox: 0, oy: -50, r: 160, i: 0.45, fl: 'steady', col: () => '#9ab8ff' },
    storm_rod: { ox: 0, oy: -144, r: 90, i: 0.5, fl: 'soft', col: () => '#9ab8ff' },
    antenna: { ox: 0, oy: -90, r: 80, i: 0.45, fl: 'pulse', col: (b, P) => P.accent2 },
    glyph_wall: { ox: 0, oy: -50, r: 120, i: 0.4, fl: 'soft', col: (b, P) => P.rock.detail },
    statue: { ox: 0, oy: -90, r: 90, i: 0.3, fl: 'soft', col: (b, P) => P.accent },
    // Chapter 2 props
    data_pillar: { ox: 0, oy: -60, r: 170, i: 0.75, fl: 'neon', shadow: true, col: (b, P) => P.accent },
    tablet_shelf: { ox: 0, oy: -50, r: 110, i: 0.4, fl: 'soft', col: (b, P) => P.accent },
    echo_statue: { ox: 0, oy: -96, r: 170, i: 0.6, fl: 'soft', col: () => '#ffd27a' },
    ring_machine: { ox: 0, oy: -72, r: 300, i: 1, fl: 'pulse', shadow: true, col: () => '#ffd27a' },
    conduit: { ox: 0, oy: -48, r: 120, i: 0.55, fl: 'neon', col: (b, P) => P.accent },
  };
  const ANIM_LIGHTS = {
    lampc: [80, 0.6, '#bfefff', 'neon'], striplight: [60, 0.45, null, 'neon'], mossglow: [60, 0.35, 'cap', 'soft'], mossw: [50, 0.3, 'cap', 'soft'],
    mushS: [50, 0.4, null, 'soft'], crys: [60, 0.35, null, 'soft'], crysd: [60, 0.3, null, 'soft'], crysw: [55, 0.3, null, 'soft'],
    conduitw: [50, 0.4, null, 'neon'], glyphw: [45, 0.3, 'detail', 'soft'], vineh: [35, 0.3, 'a2', 'soft'],
  };

  function gather(view, level, t, game, amb) {
    const P = Pal.get(level), biome = level.biome, L = [];
    const vx0 = view.x - 60, vx1 = view.x + W + 60, vy0 = view.y - 60, vy1 = view.y + H + 60;
    const add = (o) => { if (o.x + o.r < vx0 || o.x - o.r > vx1 || o.y + o.r < vy0 || o.y - o.r > vy1 || o.i <= 0.01) return; L.push(o); };
    // the player's shoulder lamp + a small personal fill
    const p = game && game.player;
    if (p && !p.dead) {
      const f = p.facing || 1, lx = p.x + p.w / 2 + f * 5, ly = p.y + 14;
      if (amb.lamp > 0.05) {
        add({ x: lx, y: ly, r: 330, i: 0.85 * amb.lamp, col: '#ffe4b8', shadow: true, cone: { dir: f > 0 ? 0.1 : Math.PI - 0.1, half: 0.62 }, prio: 3 });
        add({ x: p.x + p.w / 2, y: p.y + p.h / 2, r: 120, i: 0.45 * amb.lamp, col: '#ffd8b0' });
      }
    }
    const d = game && game.drone;
    if (d && d.enabled) add({ x: d.x, y: d.y, r: 140, i: 0.6, col: '#8af4ff', shadow: true, fl: 'soft', seed: 3, prio: 1.2 });
    for (const e of level.entities) {
      switch (e.type) {
        case 'checkpoint': add({ x: e.x + 16, y: e.y + 14, r: e.lit ? 190 : 70, i: e.lit ? 0.85 : 0.35, col: e.lit ? P.accent : '#ff6a5a', fl: e.lit ? 'soft' : 'pulse', seed: e.x, shadow: !!e.lit, key: 'cp' + e.x + ',' + e.y }); break;
        case 'exit': add({ x: e.x + 16, y: e.y + 40, r: 220, i: e.locked ? 0.4 : 0.85, col: e.locked ? '#ffb04a' : P.accent, fl: 'soft', seed: e.x, shadow: true, key: 'ex' + e.x + ',' + e.y }); break;
        case 'terminal': add({ x: e.x + 16, y: e.y + 18, r: 120, i: 0.6, col: e.solved ? '#6aff9a' : P.accent, fl: 'neon', seed: e.x, key: 'tm' + e.x }); break;
        case 'socket': if (e.active) add({ x: e.x + 16, y: e.y + 20, r: 110, i: 0.5, col: '#6aff9a', fl: 'soft' }); break;
        case 'shard': if (!e.collected) add({ x: e.cx, y: e.cy, r: 80, i: 0.55, col: '#ffe17a', fl: 'soft', seed: e.x }); break;
        case 'jumppad': add({ x: e.cx, y: e.y, r: 60, i: 0.3 + (e.fireT < 0.3 ? 0.6 : 0), col: P.accent }); break;
        case 'laser': {
          if (!e.beam || (e.phase !== 'on' && e.phase !== 'warn')) break;
          const on = e.phase === 'on', k = on ? 0.6 : 0.25 * (Math.sin(t * 30) > 0 ? 1 : 0.3);
          const b = e.beam, horiz = b.w > b.h, len = horiz ? b.w : b.h, n = Math.max(1, Math.round(len / 72));
          add({ x: e.x + 16, y: e.y + 16, r: 110, i: k * 1.2, col: '#ff3a5a' });
          for (let i = 0; i < n; i++) { const u = (i + 0.5) / n; add({ x: horiz ? b.x + b.w * u : b.x + b.w / 2, y: horiz ? b.y + b.h / 2 : b.y + b.h * u, r: 84, i: k, col: '#ff2350' }); }
          break;
        }
        case 'dashcrystal': add({ x: e.cx, y: e.cy, r: e.ready === false ? 50 : 130, i: e.ready === false ? 0.2 : 0.75, col: '#ff8ae0', fl: 'soft', seed: e.x }); break;
        case 'sentinel': {
          const hot = e.state === 'chase' || e.state === 'alert', stun = e.state === 'stunned';
          add({ x: e.cx, y: e.cy, r: hot ? 170 : 120, i: stun ? 0.15 * flick('neon', t, 7) : hot ? 0.85 : 0.5, col: hot ? '#ff3a3a' : '#ffb04a', shadow: hot, prio: 1.5, fl: hot ? 'pulse' : 'steady' });
          break;
        }
        case 'npc': add({ x: e.cx, y: e.cy - 6, r: 190, i: e.talking ? 0.85 : 0.6, col: '#ffd27a', fl: e.talking ? 'pulse' : 'soft', seed: e.x, shadow: true, prio: 1.3 }); break;
        case 'boss': if (!e.dead) add({ x: e.cx, y: e.cy, r: 300 + (e.w || 64), i: 1, col: e.lightColor || e.color || '#ff7a4a', fl: 'pulse', seed: 1, shadow: true, prio: 4 }); break;
        case 'bossproj': if (!e.dead) add({ x: e.cx != null ? e.cx : e.x, y: e.cy != null ? e.cy : e.y, r: 90, i: 0.7, col: e.color || '#ff9a5a' }); break;
        case 'deco': {
          const pl = PROP_LIGHTS[e.kind];
          if (!pl) break;
          const sc = e.scale || 1;
          add({ x: e.x + T / 2 + pl.ox * sc * (e.flip ? -1 : 1), y: e.y + T + pl.oy * sc, r: pl.r * sc, i: pl.i, col: pl.col(biome, P), fl: pl.fl, seed: e.x * 0.37, shadow: !!pl.shadow, key: 'pr' + e.kind + e.x + ',' + e.y });
          break;
        }
      }
    }
    // acid surfaces
    for (const a of S.acid) {
      if (a.x1 < vx0 - 80 || a.x0 > vx1 + 80 || a.y < vy0 - 80 || a.y > vy1 + 80) continue;
      for (let x = a.x0 + 32; x < a.x1; x += 80) add({ x, y: a.y, r: 96, i: 0.45 * flick('soft', t, x * 0.05), col: P.acid.glow });
    }
    // animated tile scatter (strip lights, glow moss, crystals...)
    const ds = G.Art.Decor && G.Art.Decor._state;
    if (ds && ds.anim && ds.level === level) {
      let n = 0;
      for (const s of ds.anim) {
        const al = ANIM_LIGHTS[s.k];
        if (!al || s.x < vx0 || s.x > vx1 || s.y < vy0 || s.y > vy1) continue;
        if (++n > 48) break;
        const col = al[2] === 'cap' ? P.rock.capLight : al[2] === 'detail' ? P.rock.detail : al[2] === 'a2' ? P.accent2 : al[2] || P.accent;
        add({ x: s.x, y: s.y + 4, r: al[0], i: al[1], col, fl: al[3], seed: s.x * 0.1 });
      }
    }
    const gain = amb.gain || 1.3;
    for (const o of L) { if (o.fl) o.i *= flick(o.fl, t, o.seed || 0); o.i *= gain; }
    return L;
  }

  // ------------------------------------------------------------------ rendering
  function ensure(c, w, h) { if (!c || c.width !== w || c.height !== h) return mk(w, h); return c; }
  function ambientColor(amb, t) {
    if (!amb.storm) return amb.amb;
    const D = G.Art.Decor, b = D && D.flash ? D.flash(t) : 0;
    if (b < 0.01) return amb.amb;
    const a = Pal.rgbOf(amb.amb), k = Math.min(1, b * 0.75);
    return `rgb(${(a[0] + (220 - a[0]) * k) | 0},${(a[1] + (230 - a[1]) * k) | 0},${(a[2] + (255 - a[2]) * k) | 0})`;
  }

  function drawShadowed(m, o, view, q) {
    const R = o.r, sz = Math.ceil(R * 2 * q) + 2;
    if (!S.tmp || S.tmp.width < sz) { const n = Math.max(sz, 64); S.tmp = mk(n, n); S.mask = mk(n, n); }
    const tg = S.tmp.getContext('2d'), mg = S.mask.getContext('2d');
    const ox = o.x - R, oy = o.y - R; // world origin of the tmp canvas
    tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.globalAlpha = 1; tg.clearRect(0, 0, sz, sz);
    tg.drawImage(sprite(o.col), 0, 0, R * 2 * q, R * 2 * q);
    if (o.cone) { // soft-edged wedge
      tg.globalCompositeOperation = 'destination-in';
      tg.beginPath(); tg.moveTo(R * q, R * q); tg.arc(R * q, R * q, R * q, o.cone.dir - o.cone.half, o.cone.dir + o.cone.half); tg.closePath(); tg.fill();
    }
    // visibility mask (cached for static lights)
    let poly = null;
    if (o.key) { const c = S.polyCache.get(o.key); if (c && c.x === o.x && c.y === o.y && c.r === R) poly = c.p; }
    if (!poly) { const tp = performance.now(); poly = visPoly(o.x, o.y, R); S.tPoly += performance.now() - tp; if (o.key) S.polyCache.set(o.key, { x: o.x, y: o.y, r: R, p: poly }); }
    mg.setTransform(1, 0, 0, 1, 0, 0); mg.clearRect(0, 0, sz, sz);
    mg.setTransform(q, 0, 0, q, -ox * q, -oy * q);
    mg.beginPath(); mg.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) mg.lineTo(poly[i], poly[i + 1]);
    mg.closePath();
    mg.fillStyle = '#fff'; mg.fill();
    // bleed the light ~9px into the lit faces of the walls, so surfaces facing the light read as lit
    if (!S.dbgNoStroke) mg.strokeStyle = '#fff'; mg.lineJoin = S.dbgJoin || 'round'; mg.lineWidth = S.dbgNoStroke ? 0.01 : 18; mg.globalAlpha = 0.85; mg.stroke(); mg.globalAlpha = 1;
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(S.mask, 0, 0, sz, sz, 0, 0, sz, sz);
    m.globalAlpha = Math.min(1, o.i);
    m.drawImage(S.tmp, 0, 0, sz, sz, (ox - view.x) * q, (oy - view.y) * q, sz, sz);
    if (o.i > 1) { m.globalAlpha = Math.min(1, o.i - 1); m.drawImage(S.tmp, 0, 0, sz, sz, (ox - view.x) * q, (oy - view.y) * q, sz, sz); }
    m.globalAlpha = 1;
  }

  /** Short soft ellipse on the ground under a body (normal blend, clipped to the ground surface). */
  function contactShadow(ctx, level, cx, bottom, w, k) {
    const tx = Math.floor(cx / T);
    let gy = -1;
    for (let ty = Math.floor((bottom - 2) / T); ty < Math.floor(bottom / T) + 5; ty++) {
      const c = level.tileCode(tx, ty);
      if (level.isSolidTile(tx, ty) || c === G.TILE_CODES.ONEWAY) { gy = ty * T; if (gy >= bottom - 3) break; gy = -1; }
    }
    if (gy < 0) return;
    const hgt = Math.max(0, gy - bottom), a = k * Math.max(0, 1 - hgt / 120);
    if (a < 0.02) return;
    const rx = w * (0.75 + hgt / 160), ry = 3.5 + hgt / 40;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - rx - 2, gy - 2.5, rx * 2 + 4, ry + 6); ctx.clip();
    ctx.translate(cx, gy); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.6, `rgba(0,0,0,${a * 0.55})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
    ctx.restore();
  }

  const Lighting = {
    enabled: true,
    /**
     * Lighting pass (WORLD-space ctx).
     * @param {CanvasRenderingContext2D} ctx
     * @param {{x:number,y:number,w:number,h:number}} view
     * @param {G.Level} level
     * @param {number} t level time (s)
     * @param {object} game GameScene (player, drone)
     */
    draw(ctx, view, level, t, game) {
      if (!Lighting.enabled || !level || (G.lowGfx && G.lowGfx())) return;
      const t0 = performance.now();
      const Qs = Q[quality];
      if (S.level !== level || S.ver !== level.version) { S.level = level; buildSegments(level); }
      const amb = Pal.lightingFor(level);
      // 1. contact shadows (under the light map, so they take the light's colour)
      const p = game && game.player;
      if (p && !p.dead) contactShadow(ctx, level, p.x + p.w / 2, p.y + p.h, p.w * 0.9, 0.5);
      for (const c of level.crates || []) contactShadow(ctx, level, c.x + c.w / 2, c.y + c.h, c.w * 0.62, 0.45);
      for (const e of level.entities) {
        if (e.type === 'npc') contactShadow(ctx, level, e.cx, e.y + e.h, (e.w || 24) * 0.8, 0.45);
        else if (e.type === 'sentinel') contactShadow(ctx, level, e.cx, e.y + e.h, (e.w || 28) * 0.8, 0.35);
        else if (e.type === 'boss' && !e.dead) contactShadow(ctx, level, e.cx, e.y + e.h, (e.w || 64) * 0.6, 0.4);
      }
      // 2. light map
      const q = Qs.q, bw = Math.ceil(W * q), bh = Math.ceil(H * q);
      S.map = ensure(S.map, bw, bh);
      const m = S.map.getContext('2d');
      m.globalCompositeOperation = 'source-over'; m.globalAlpha = 1; m.filter = 'none';
      m.fillStyle = ambientColor(amb, t); m.fillRect(0, 0, bw, bh);
      S.tPoly = 0; const tg0 = performance.now();
      const lights = gather(view, level, t, game, amb);
      S.tGather = performance.now() - tg0;
      // shadow budget: strongest lights near the view centre
      const vcx = view.x + W / 2, vcy = view.y + H / 2;
      let cand = [];
      if (amb.shadow) {
        cand = lights.filter((o) => o.shadow && !solidPx(o.x, o.y));
        for (const o of cand) o.score = (o.prio || 1) * o.i * o.r / (1 + Math.hypot(o.x - vcx, o.y - vcy) / 500);
        cand.sort((a, b) => b.score - a.score);
        cand = cand.slice(0, Qs.maxShadow);
      }
      const shadowed = new Set(cand);
      m.globalCompositeOperation = 'lighter';
      for (const o of lights) {
        if (shadowed.has(o)) { drawShadowed(m, o, view, q); continue; }
        if (o.cone) continue; // cones without a shadow slot fall back to the round fill light only
        const sx = (o.x - o.r - view.x) * q, sy = (o.y - o.r - view.y) * q, sw = o.r * 2 * q;
        m.globalAlpha = Math.min(1, o.i); m.drawImage(sprite(o.col), sx, sy, sw, sw);
        if (o.i > 1) { m.globalAlpha = Math.min(1, o.i - 1); m.drawImage(sprite(o.col), sx, sy, sw, sw); }
      }
      m.globalAlpha = 1;
      // 3. composite (multiply), softened by a blur pass at half resolution
      S.tMap = performance.now() - t0;
      const src = S.map;
      if (Qs.blur) {
        // cheap separable-free blur: down-sample 2x and blend back (canvas 'filter' costs ~2 ms in software)
        const hw = Math.ceil(bw / 2), hh = Math.ceil(bh / 2);
        S.blurBuf = ensure(S.blurBuf, hw, hh);
        const b = S.blurBuf.getContext('2d');
        b.globalCompositeOperation = 'copy'; b.imageSmoothingEnabled = true; b.drawImage(S.map, 0, 0, hw, hh);
        m.globalCompositeOperation = 'source-over'; m.imageSmoothingEnabled = true; m.globalAlpha = 0.6;
        m.drawImage(S.blurBuf, 0, 0, hw, hh, 0, 0, bw, bh); m.globalAlpha = 1;
      }
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(src, 0, 0, bw, bh, view.x, view.y, bw / q, bh / q);
      // 4. bloom at the sources (additive, subtle)
      ctx.globalCompositeOperation = 'lighter';
      const gk = amb.glow;
      for (const o of lights) {
        if (o.cone) { // faint volumetric beam
          ctx.globalAlpha = 0.07 * o.i * gk;
          ctx.save(); ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.arc(o.x, o.y, o.r * 0.8, o.cone.dir - o.cone.half * 0.8, o.cone.dir + o.cone.half * 0.8); ctx.closePath(); ctx.clip();
          ctx.drawImage(sprite(o.col), o.x - o.r * 0.8, o.y - o.r * 0.8, o.r * 1.6, o.r * 1.6); ctx.restore();
          continue;
        }
        const rr = Math.min(90, o.r * 0.38);
        ctx.globalAlpha = Math.min(1, 0.16 * o.i * gk);
        ctx.drawImage(sprite(o.col), o.x - rr, o.y - rr, rr * 2, rr * 2);
      }
      ctx.restore();
      S.nLights = lights.length; S.nShadow = cand.length;
      S.ms = performance.now() - t0;
    },
    /** @param {'high'|'medium'} q */
    setQuality(q) { if (Q[q]) quality = q; },
    getQuality() { return quality; },
    /** Vignette multiplier for the decor atmosphere pass (avoids double darkening at the edges). */
    vignetteScale(level) {
      if (!Lighting.enabled) return 1;
      const a = Pal.rgbOf(Pal.lightingFor(level).amb), lum = (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11) / 255;
      return 0.5 + 0.5 * lum;
    },
    /** QA: timing + counts for the last frame. */
    stats() { return { ms: +S.ms.toFixed(2), lights: S.nLights, shadowed: S.nShadow, segs: S.hs.length + S.vs.length, quality, poly: +(S.tPoly || 0).toFixed(2), gather: +(S.tGather || 0).toFixed(2), map: +(S.tMap || 0).toFixed(2) }; },
  };
  Object.defineProperty(Lighting, '_state', { value: S, enumerable: false });
  G.Art.Lighting = Lighting;
})();
