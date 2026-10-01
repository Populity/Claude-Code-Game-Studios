/**
 * Terminal puzzles ("repair" mini-games). Opened from a terminal entity.
 * All puzzles are generated deterministically from a seed and are solvable by construction.
 *
 * Puzzle defs (terminal.puzzle):
 *   { type:'pipes',  w:5, h:4 }                 — rotate conduit pieces to route power source → sink
 *   { type:'lights', n:3, presses:3 }           — "lights out": light every cell (toggle cross pattern)
 *   { type:'code',   code:'417', hint:'...' }    — enter a code; clues are placed on signs in the level
 *   { type:'logic',  inputs:['A','B','C'], outputs:[{label:'Шлюз', expr:'A & !B'}, ...] }
 *                                                — set switches so every output is ON (& | ! ^ and parens)
 * Optional: title, seed.
 */
(function () {
  const W = G.VIEW_W, H = G.VIEW_H;
  const PW = 700, PH = 440;
  const PX = (W - PW) / 2, PY = (H - PH) / 2;
  const CYAN = '#7ef9ff', AMBER = '#ffcf6b', RED = '#ff5d6c', GREEN = '#7dffa8';
  const FONT = '"Exo 2", "Segoe UI", sans-serif';

  // ----- shared panel chrome -----
  function panel(ctx, title, subtitle, t, solvedT) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.shadowColor = CYAN; ctx.shadowBlur = 24;
    ctx.fillStyle = 'rgba(6,14,26,0.96)';
    G.roundRect(ctx, PX, PY, PW, PH, 18); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = solvedT > 0 ? GREEN : CYAN; ctx.lineWidth = 2;
    G.roundRect(ctx, PX, PY, PW, PH, 18); ctx.stroke();
    // scanlines
    ctx.save();
    G.roundRect(ctx, PX, PY, PW, PH, 18); ctx.clip();
    ctx.globalAlpha = 0.05; ctx.fillStyle = CYAN;
    for (let y = PY + ((t * 30) % 4); y < PY + PH; y += 4) ctx.fillRect(PX, y, PW, 1);
    ctx.restore();
    ctx.fillStyle = CYAN; ctx.font = `700 20px ${FONT}`; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillText(title, PX + 26, PY + 18);
    if (subtitle) {
      ctx.fillStyle = 'rgba(200,230,255,0.75)'; ctx.font = `400 14px ${FONT}`;
      G.wrapText(ctx, subtitle, PX + 26, PY + 46, PW - 52, 18, subtitle);
    }
    // footer controls
    ctx.fillStyle = 'rgba(200,230,255,0.5)'; ctx.font = `400 12px ${FONT}`;
    const touch = G.input.touchActive;
    ctx.fillText(touch ? 'Нажимайте на элементы · ✕ — выйти' : 'Мышь или стрелки + Пробел · R — сброс · Esc — выйти', PX + 26, PY + PH - 26);
    // close button
    const cb = { x: PX + PW - 44, y: PY + 14, w: 30, h: 30 };
    ctx.strokeStyle = 'rgba(200,230,255,0.6)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cb.x + 9, cb.y + 9); ctx.lineTo(cb.x + 21, cb.y + 21); ctx.moveTo(cb.x + 21, cb.y + 9); ctx.lineTo(cb.x + 9, cb.y + 21); ctx.stroke();
    if (solvedT > 0) {
      const a = Math.min(1, solvedT * 3);
      ctx.globalAlpha = a;
      ctx.fillStyle = GREEN; ctx.font = `800 30px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText('СИСТЕМА ВОССТАНОВЛЕНА', W / 2, PY + PH - 70);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
    return cb;
  }
  const inRect = (p, r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ======================================================================= PIPES
  const N = 1, E = 2, S = 4, Wd = 8;
  const DIRS = [[0, -1, N, S], [1, 0, E, Wd], [0, 1, S, N], [-1, 0, Wd, E]];
  const rotMask = (m, r) => { for (let i = 0; i < r; i++) m = ((m << 1) | (m >> 3)) & 15; return m; };

  const Pipes = {
    create(def, seed) {
      const w = def.w || 5, h = def.h || 4;
      const rnd = G.rng(seed);
      const sr = Math.floor(rnd() * h), kr = Math.floor(rnd() * h);
      // randomized DFS path from (0,sr) to (w-1,kr)
      let path = null;
      for (let attempt = 0; attempt < 200 && !path; attempt++) {
        const seen = new Set([`0,${sr}`]);
        const stack = [[0, sr]];
        const dfs = () => {
          const [x, y] = stack[stack.length - 1];
          if (x === w - 1 && y === kr) return true;
          const opts = DIRS.map((d) => [x + d[0], y + d[1]]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < w && ny < h && !seen.has(`${nx},${ny}`));
          // bias toward the sink so paths aren't absurd, but keep variety
          opts.sort(() => rnd() - 0.5);
          if (rnd() < 0.55) opts.sort((a, b) => (a[0] === b[0] ? 0 : b[0] - a[0]));
          for (const o of opts) {
            seen.add(`${o[0]},${o[1]}`); stack.push(o);
            if (stack.length > w * h * 0.75) { stack.pop(); continue; }
            if (dfs()) return true;
            stack.pop();
          }
          return false;
        };
        if (dfs()) path = stack.slice();
      }
      if (!path) {
        // fallback: straight along the source row, then vertical to the sink row
        path = [];
        for (let x = 0; x < w; x++) path.push([x, sr]);
        const step = kr > sr ? 1 : -1;
        for (let y = sr + step; kr !== sr && y !== kr + step; y += step) path.push([w - 1, y]);
      }
      const cells = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const r = rnd();
        cells.push({ base: r < 0.4 ? (N | S) : r < 0.8 ? (N | E) : (N | E | S), rot: 0, onPath: false });
      }
      const dirBetween = (a, b) => DIRS.findIndex((d) => a[0] + d[0] === b[0] && a[1] + d[1] === b[1]);
      for (let i = 0; i < path.length; i++) {
        const [x, y] = path[i];
        const inDir = i === 0 ? 3 : (dirBetween(path[i], path[i - 1]));
        const outDir = i === path.length - 1 ? 1 : dirBetween(path[i], path[i + 1]);
        const mask = DIRS[inDir][2] | DIRS[outDir][2];
        const c = cells[y * w + x];
        c.onPath = true;
        c.base = (mask === (N | S) || mask === (E | Wd)) ? (N | S) : (N | E);
        c.target = mask;
      }
      // scramble
      for (const c of cells) c.rot = Math.floor(rnd() * 4);
      const st = { type: 'pipes', w, h, sr, kr, cells, cursor: { x: 0, y: sr }, anim: cells.map(() => 0) };
      if (Pipes.check(st).solved) cells[path[0][1] * w + path[0][0]].rot = (cells[path[0][1] * w + path[0][0]].rot + 1) % 4;
      return st;
    },
    mask(c) { return rotMask(c.base, c.rot); },
    check(st) {
      const { w, h, cells } = st;
      const powered = new Set();
      const start = st.sr * w;
      if (!(Pipes.mask(cells[start]) & Wd)) return { solved: false, powered };
      const q = [[0, st.sr]]; powered.add(start);
      let solved = false;
      while (q.length) {
        const [x, y] = q.shift();
        const m = Pipes.mask(cells[y * w + x]);
        if (x === w - 1 && y === st.kr && (m & E)) solved = true;
        for (const [dx, dy, bit, opp] of DIRS) {
          if (!(m & bit)) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (powered.has(ni)) continue;
          if (Pipes.mask(cells[ni]) & opp) { powered.add(ni); q.push([nx, ny]); }
        }
      }
      return { solved, powered };
    },
    layout(st) {
      const size = Math.min(76, Math.floor(Math.min((PW - 160) / st.w, (PH - 150) / st.h)));
      const gx = PX + (PW - size * st.w) / 2, gy = PY + 92 + (PH - 150 - size * st.h) / 2;
      return { size, gx, gy };
    },
    input(st, inp) {
      const L = Pipes.layout(st);
      let rotate = -1;
      if (inp.pointer.clicked) {
        const cx = Math.floor((inp.pointer.x - L.gx) / L.size), cy = Math.floor((inp.pointer.y - L.gy) / L.size);
        if (cx >= 0 && cy >= 0 && cx < st.w && cy < st.h) { st.cursor = { x: cx, y: cy }; rotate = cy * st.w + cx; }
      }
      if (inp.pressed('left')) st.cursor.x = (st.cursor.x + st.w - 1) % st.w;
      if (inp.pressed('right')) st.cursor.x = (st.cursor.x + 1) % st.w;
      if (inp.pressed('up')) st.cursor.y = (st.cursor.y + st.h - 1) % st.h;
      if (inp.pressed('down')) st.cursor.y = (st.cursor.y + 1) % st.h;
      if (inp.pressed('jump') || inp.pressed('action')) rotate = st.cursor.y * st.w + st.cursor.x;
      if (rotate >= 0) { st.cells[rotate].rot = (st.cells[rotate].rot + 1) % 4; st.anim[rotate] = 1; G.Audio.play('rotate'); }
      return Pipes.check(st).solved;
    },
    draw(ctx, st, t) {
      const L = Pipes.layout(st);
      const { powered } = Pipes.check(st);
      for (let i = 0; i < st.anim.length; i++) st.anim[i] = Math.max(0, st.anim[i] - 0.12);
      // source / sink
      const srcY = L.gy + st.sr * L.size + L.size / 2, snkY = L.gy + st.kr * L.size + L.size / 2;
      ctx.fillStyle = AMBER;
      ctx.beginPath(); ctx.arc(L.gx - 26, srcY, 12 + Math.sin(t * 5) * 2, 0, 7); ctx.fill();
      ctx.fillRect(L.gx - 26, srcY - 4, 26, 8);
      ctx.fillStyle = CYAN; ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText('ИСТОЧНИК', L.gx - 30, srcY + 18);
      const sinkLit = Pipes.check(st).solved;
      ctx.fillStyle = sinkLit ? GREEN : 'rgba(126,249,255,0.25)';
      ctx.fillRect(L.gx + L.size * st.w, snkY - 4, 26, 8);
      ctx.beginPath(); ctx.arc(L.gx + L.size * st.w + 26, snkY, 13, 0, 7); ctx.fill();
      ctx.fillStyle = CYAN; ctx.fillText('ПРИЁМНИК', L.gx + L.size * st.w + 30, snkY + 18);
      ctx.textAlign = 'left';
      for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
        const i = y * st.w + x, c = st.cells[i];
        const cx = L.gx + x * L.size, cy = L.gy + y * L.size;
        ctx.fillStyle = 'rgba(126,249,255,0.06)';
        G.roundRect(ctx, cx + 3, cy + 3, L.size - 6, L.size - 6, 8); ctx.fill();
        if (st.cursor.x === x && st.cursor.y === y && G.input.lastDevice !== 'mouse' && G.input.lastDevice !== 'touch') {
          ctx.strokeStyle = AMBER; ctx.lineWidth = 2; G.roundRect(ctx, cx + 2, cy + 2, L.size - 4, L.size - 4, 8); ctx.stroke();
        }
        const m = Pipes.mask(c);
        const on = powered.has(i);
        const rotA = -st.anim[i] * Math.PI / 2;
        ctx.save();
        ctx.translate(cx + L.size / 2, cy + L.size / 2); ctx.rotate(rotA);
        ctx.lineCap = 'round';
        const arm = L.size / 2 - 4;
        const drawArms = (lw, col) => {
          ctx.strokeStyle = col; ctx.lineWidth = lw;
          ctx.beginPath();
          if (m & N) { ctx.moveTo(0, 0); ctx.lineTo(0, -arm); }
          if (m & E) { ctx.moveTo(0, 0); ctx.lineTo(arm, 0); }
          if (m & S) { ctx.moveTo(0, 0); ctx.lineTo(0, arm); }
          if (m & Wd) { ctx.moveTo(0, 0); ctx.lineTo(-arm, 0); }
          ctx.stroke();
        };
        if (on) { ctx.shadowColor = AMBER; ctx.shadowBlur = 14; }
        drawArms(L.size * 0.26, on ? '#5a3b10' : '#1c2c3c');
        ctx.shadowBlur = 0;
        drawArms(L.size * 0.12, on ? AMBER : '#4c6a80');
        if (on) {
          // flowing energy dots
          ctx.fillStyle = '#fff';
          const ph = (t * 1.6) % 1;
          for (const [bit, dx, dy] of [[N, 0, -1], [E, 1, 0], [S, 0, 1], [Wd, -1, 0]]) {
            if (!(m & bit)) continue;
            const d = arm * ph;
            ctx.beginPath(); ctx.arc(dx * d, dy * d, 2.2, 0, 7); ctx.fill();
          }
        }
        ctx.fillStyle = on ? AMBER : '#4c6a80';
        ctx.beginPath(); ctx.arc(0, 0, L.size * 0.1, 0, 7); ctx.fill();
        ctx.restore();
      }
    },
  };

  // ======================================================================= LIGHTS
  const Lights = {
    create(def, seed) {
      const n = def.n || 3;
      const rnd = G.rng(seed);
      const on = new Array(n * n).fill(true);
      const presses = Math.max(1, def.presses || n);
      const used = new Set();
      while (used.size < Math.min(presses, n * n)) used.add(Math.floor(rnd() * n * n));
      const st = { type: 'lights', n, on, moves: 0, cursor: { x: 0, y: 0 }, flash: new Array(n * n).fill(0) };
      for (const i of used) Lights.press(st, i, true);
      if (on.every(Boolean)) Lights.press(st, 0, true);
      st.initial = st.on.slice();
      return st;
    },
    press(st, i, silent) {
      const n = st.n, x = i % n, y = Math.floor(i / n);
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        st.on[ny * n + nx] = !st.on[ny * n + nx];
        if (!silent) st.flash[ny * n + nx] = 1;
      }
      if (!silent) { st.moves++; G.Audio.play('toggle'); }
    },
    layout(st) {
      const size = Math.min(84, Math.floor((PH - 170) / st.n));
      return { size, gx: PX + (PW - size * st.n) / 2, gy: PY + 100 };
    },
    input(st, inp) {
      const L = Lights.layout(st);
      if (inp.pointer.clicked) {
        const cx = Math.floor((inp.pointer.x - L.gx) / L.size), cy = Math.floor((inp.pointer.y - L.gy) / L.size);
        if (cx >= 0 && cy >= 0 && cx < st.n && cy < st.n) { st.cursor = { x: cx, y: cy }; Lights.press(st, cy * st.n + cx); }
      }
      if (inp.pressed('left')) st.cursor.x = (st.cursor.x + st.n - 1) % st.n;
      if (inp.pressed('right')) st.cursor.x = (st.cursor.x + 1) % st.n;
      if (inp.pressed('up')) st.cursor.y = (st.cursor.y + st.n - 1) % st.n;
      if (inp.pressed('down')) st.cursor.y = (st.cursor.y + 1) % st.n;
      if (inp.pressed('jump') || inp.pressed('action')) Lights.press(st, st.cursor.y * st.n + st.cursor.x);
      if (inp.pressed('restart')) { st.on = st.initial.slice(); st.moves = 0; G.Audio.play('ui'); }
      return st.on.every(Boolean);
    },
    draw(ctx, st, t) {
      const L = Lights.layout(st);
      for (let i = 0; i < st.flash.length; i++) st.flash[i] = Math.max(0, st.flash[i] - 0.08);
      for (let y = 0; y < st.n; y++) for (let x = 0; x < st.n; x++) {
        const i = y * st.n + x;
        const cx = L.gx + x * L.size + L.size / 2, cy = L.gy + y * L.size + L.size / 2;
        const r = L.size * 0.36;
        ctx.save();
        if (st.on[i]) { ctx.shadowColor = AMBER; ctx.shadowBlur = 22; }
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r);
        g.addColorStop(0, st.on[i] ? '#fff6d0' : '#2a3a4c');
        g.addColorStop(1, st.on[i] ? '#d98a1c' : '#121c28');
        ctx.fillStyle = g;
        // hexagonal crystal cell (Architect glyph look)
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = st.flash[i] > 0 ? `rgba(255,255,255,${st.flash[i]})` : 'rgba(126,249,255,0.35)';
        ctx.lineWidth = 2; ctx.stroke();
        if (st.cursor.x === x && st.cursor.y === y && G.input.lastDevice !== 'mouse' && G.input.lastDevice !== 'touch') {
          ctx.strokeStyle = CYAN; ctx.lineWidth = 2;
          ctx.strokeRect(cx - L.size / 2 + 3, cy - L.size / 2 + 3, L.size - 6, L.size - 6);
        }
      }
      ctx.fillStyle = 'rgba(200,230,255,0.7)'; ctx.font = `500 14px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillText('Ходов: ' + st.moves, PX + PW - 30, PY + 60);
      ctx.textAlign = 'left';
    },
  };

  // ======================================================================= CODE
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
  const Code = {
    create(def) {
      return { type: 'code', code: String(def.code), entry: '', err: 0, cursor: 0, hint: def.hint || '' };
    },
    layout() { const s = 58; return { s, gx: PX + PW / 2 - s * 1.5 - 8, gy: PY + 170 }; },
    keyPress(st, k) {
      if (k === 'C') { st.entry = ''; G.Audio.play('ui'); return false; }
      if (k === 'OK') {
        if (st.entry === st.code) return true;
        st.err = 1; st.entry = ''; G.Audio.play('error'); return false;
      }
      if (st.entry.length < st.code.length) { st.entry += k; G.Audio.play('key'); }
      if (st.entry.length === st.code.length) {
        if (st.entry === st.code) return true;
        st.err = 1; G.Audio.play('error'); st.entry = '';
      }
      return false;
    },
    input(st, inp) {
      const L = Code.layout();
      if (inp.pointer.clicked) {
        for (let i = 0; i < 12; i++) {
          const r = { x: L.gx + (i % 3) * (L.s + 8), y: L.gy + Math.floor(i / 3) * (L.s * 0.72 + 8), w: L.s, h: L.s * 0.72 };
          if (inRect(inp.pointer, r)) { st.cursor = i; if (Code.keyPress(st, KEYS[i])) return true; }
        }
      }
      if (inp.pressed('left')) st.cursor = (st.cursor + 11) % 12;
      if (inp.pressed('right')) st.cursor = (st.cursor + 1) % 12;
      if (inp.pressed('up')) st.cursor = (st.cursor + 9) % 12;
      if (inp.pressed('down')) st.cursor = (st.cursor + 3) % 12;
      if (inp.pressed('jump') || inp.pressed('action')) { if (Code.keyPress(st, KEYS[st.cursor])) return true; }
      if (inp.typed) for (const ch of inp.typed) { if (/[0-9]/.test(ch) && Code.keyPress(st, ch)) return true; }
      return false;
    },
    draw(ctx, st, t) {
      st.err = Math.max(0, st.err - 0.04);
      const L = Code.layout();
      const shake = st.err > 0 ? Math.sin(t * 80) * 8 * st.err : 0;
      // display
      const dw = 260, dx = PX + PW / 2 - dw / 2 + shake, dy = PY + 108;
      ctx.fillStyle = '#02070d'; G.roundRect(ctx, dx, dy, dw, 48, 8); ctx.fill();
      ctx.strokeStyle = st.err > 0 ? RED : CYAN; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `700 30px "Share Tech Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let s = '';
      for (let i = 0; i < st.code.length; i++) s += (st.entry[i] || '_') + (i < st.code.length - 1 ? ' ' : '');
      ctx.fillStyle = st.err > 0 ? RED : AMBER;
      ctx.fillText(s, PX + PW / 2 + shake, dy + 25);
      ctx.font = `600 18px ${FONT}`;
      for (let i = 0; i < 12; i++) {
        const r = { x: L.gx + (i % 3) * (L.s + 8), y: L.gy + Math.floor(i / 3) * (L.s * 0.72 + 8), w: L.s, h: L.s * 0.72 };
        const hover = inRect(G.input.pointer, r);
        ctx.fillStyle = hover ? 'rgba(126,249,255,0.18)' : 'rgba(126,249,255,0.07)';
        G.roundRect(ctx, r.x, r.y, r.w, r.h, 8); ctx.fill();
        const sel = st.cursor === i && G.input.lastDevice !== 'mouse' && G.input.lastDevice !== 'touch';
        ctx.strokeStyle = sel ? AMBER : 'rgba(126,249,255,0.3)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
        ctx.fillStyle = KEYS[i] === 'OK' ? GREEN : KEYS[i] === 'C' ? RED : '#dff6ff';
        ctx.fillText(KEYS[i], r.x + r.w / 2, r.y + r.h / 2 + 1);
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    },
  };

  // ======================================================================= LOGIC GATES
  /** Tiny boolean expression parser: identifiers A-Z, ! & | ^ ( ) — returns evaluator. */
  function parseExpr(src) {
    let i = 0;
    const s = src.replace(/\s+/g, '');
    const peek = () => s[i];
    function primary() {
      if (peek() === '!') { i++; const v = primary(); return (env) => !v(env); }
      if (peek() === '(') { i++; const v = orE(); i++; return v; }
      const id = s[i++];
      return (env) => !!env[id];
    }
    function andE() { let l = primary(); while (peek() === '&') { i++; const a = l, b = primary(); l = (e) => a(e) && b(e); } return l; }
    function xorE() { let l = andE(); while (peek() === '^') { i++; const a = l, b = andE(); l = (e) => a(e) !== b(e); } return l; }
    function orE() { let l = xorE(); while (peek() === '|') { i++; const a = l, b = xorE(); l = (e) => a(e) || b(e); } return l; }
    return orE();
  }
  function prettyExpr(src) {
    return src.replace(/\s+/g, '').replace(/&/g, ' И ').replace(/\|/g, ' ИЛИ ').replace(/\^/g, ' ИСКЛ-ИЛИ ').replace(/!/g, 'НЕ ');
  }
  const Logic = {
    create(def, seed) {
      const inputs = def.inputs || ['A', 'B', 'C'];
      const outputs = (def.outputs || [{ label: 'Выход', expr: def.expr || 'A&B' }]).map((o) => ({ label: o.label, expr: o.expr, fn: parseExpr(o.expr), text: prettyExpr(o.expr) }));
      const rnd = G.rng(seed);
      const env = {};
      for (const k of inputs) env[k] = rnd() < 0.5;
      const st = { type: 'logic', inputs, outputs, env, cursor: 0, flash: {} };
      // make sure the start state is not already solved
      let guard = 0;
      while (Logic.solved(st) && guard++ < 20) env[inputs[guard % inputs.length]] = !env[inputs[guard % inputs.length]];
      return st;
    },
    solved(st) { return st.outputs.every((o) => o.fn(st.env)); },
    layout(st) {
      const n = st.inputs.length;
      const sw = 70, gap = 14;
      const total = n * sw + (n - 1) * gap;
      return { sw, gap, gx: PX + (PW - total) / 2, gy: PY + PH - 150 };
    },
    toggle(st, i) { const k = st.inputs[i]; st.env[k] = !st.env[k]; st.flash[k] = 1; G.Audio.play('toggle'); },
    input(st, inp) {
      const L = Logic.layout(st);
      if (inp.pointer.clicked) {
        st.inputs.forEach((k, i) => {
          const r = { x: L.gx + i * (L.sw + L.gap), y: L.gy, w: L.sw, h: 86 };
          if (inRect(inp.pointer, r)) { st.cursor = i; Logic.toggle(st, i); }
        });
      }
      if (inp.pressed('left')) st.cursor = (st.cursor + st.inputs.length - 1) % st.inputs.length;
      if (inp.pressed('right')) st.cursor = (st.cursor + 1) % st.inputs.length;
      if (inp.pressed('jump') || inp.pressed('action')) Logic.toggle(st, st.cursor);
      if (inp.typed) for (const ch of inp.typed) {
        const i = st.inputs.indexOf(ch.toUpperCase());
        if (i >= 0) { st.cursor = i; Logic.toggle(st, i); }
      }
      return Logic.solved(st);
    },
    draw(ctx, st, t) {
      const L = Logic.layout(st);
      // outputs
      let y = PY + 100;
      ctx.font = `600 17px ${FONT}`; ctx.textBaseline = 'middle';
      for (const o of st.outputs) {
        const on = o.fn(st.env);
        ctx.fillStyle = 'rgba(126,249,255,0.06)'; G.roundRect(ctx, PX + 30, y - 22, PW - 60, 44, 10); ctx.fill();
        ctx.fillStyle = on ? GREEN : RED;
        ctx.save(); if (on) { ctx.shadowColor = GREEN; ctx.shadowBlur = 14; }
        ctx.beginPath(); ctx.arc(PX + 56, y, 10, 0, 7); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#e8f6ff'; ctx.textAlign = 'left';
        ctx.fillText(o.label + ':', PX + 78, y);
        const lw = ctx.measureText(o.label + ': ').width;
        ctx.fillStyle = AMBER; ctx.font = `500 16px "Share Tech Mono", monospace`;
        ctx.fillText(o.text, PX + 78 + lw, y);
        ctx.font = `600 17px ${FONT}`;
        y += 52;
      }
      // switches
      st.inputs.forEach((k, i) => {
        st.flash[k] = Math.max(0, (st.flash[k] || 0) - 0.06);
        const x = L.gx + i * (L.sw + L.gap);
        const on = st.env[k];
        ctx.fillStyle = 'rgba(126,249,255,0.07)'; G.roundRect(ctx, x, L.gy, L.sw, 86, 10); ctx.fill();
        const sel = st.cursor === i && G.input.lastDevice !== 'mouse' && G.input.lastDevice !== 'touch';
        ctx.strokeStyle = sel ? AMBER : 'rgba(126,249,255,0.3)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
        // toggle body
        const tx = x + L.sw / 2 - 12, ty = L.gy + 12;
        ctx.fillStyle = '#0b1622'; G.roundRect(ctx, tx, ty, 24, 46, 12); ctx.fill();
        ctx.fillStyle = on ? CYAN : '#46596b';
        ctx.save(); if (on) { ctx.shadowColor = CYAN; ctx.shadowBlur = 12; }
        ctx.beginPath(); ctx.arc(tx + 12, on ? ty + 12 : ty + 34, 9, 0, 7); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#e8f6ff'; ctx.textAlign = 'center'; ctx.font = `700 15px ${FONT}`;
        ctx.fillText(k + (on ? ' = 1' : ' = 0'), x + L.sw / 2, L.gy + 74);
      });
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    },
  };

  const Kinds = { pipes: Pipes, lights: Lights, code: Code, logic: Logic };
  const TITLES = { pipes: 'Силовая магистраль', lights: 'Кристаллическая матрица', code: 'Кодовый замок', logic: 'Логический контур' };
  const SUBS = {
    pipes: 'Поворачивайте сегменты, чтобы провести энергию от источника к приёмнику.',
    lights: 'Каждый кристалл переключает себя и соседей крестом. Зажгите все кристаллы.',
    code: 'Введите код доступа.',
    logic: 'Выставьте переключатели так, чтобы ВСЕ выходы загорелись зелёным.',
  };

  /** Modal puzzle overlay controller used by the game scene. */
  class PuzzleOverlay {
    constructor(terminal, game) {
      this.terminal = terminal;
      this.game = game;
      const def = terminal.puzzle || { type: 'pipes' };
      this.def = def;
      this.kind = Kinds[def.type];
      if (!this.kind) { console.warn('Unknown puzzle type', def.type); this.kind = Pipes; }
      const seed = def.seed != null ? def.seed : G.hash(game.level.id + ':' + (terminal.id || terminal.tx + ',' + terminal.ty));
      if (!terminal.puzzleState) terminal.puzzleState = this.kind.create(def, seed);
      this.st = terminal.puzzleState;
      this.t = 0; this.openT = 0; this.solvedT = 0;
      this.closeBtn = null;
      G.Audio.play('terminalOpen');
    }
    update(dt) {
      this.t += dt;
      this.openT = Math.min(1, this.openT + dt * 5);
      const inp = G.input;
      if (this.solvedT > 0) {
        this.solvedT += dt;
        if (this.solvedT > 1.3 || (this.solvedT > 0.4 && inp.anyPressed())) return 'close';
        return null;
      }
      if (inp.pressed('back') || inp.pressed('pause')) return 'close';
      if (inp.pointer.clicked && this.closeBtn && inRect(inp.pointer, this.closeBtn)) return 'close';
      if (inp.pressed('restart') && this.st.type === 'pipes') { /* pipes: no reset needed */ }
      if (this.kind.input(this.st, inp)) {
        this.solvedT = 0.0001;
        this.terminal.onSolved(this.game);
      }
      return null;
    }
    draw(ctx, t) {
      ctx.save();
      const k = G.easeOutBack(this.openT);
      ctx.translate(W / 2, H / 2); ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k); ctx.translate(-W / 2, -H / 2);
      ctx.globalAlpha = Math.min(1, this.openT * 2);
      const sub = this.def.hint || this.def.subtitle || SUBS[this.def.type];
      this.closeBtn = panel(ctx, this.def.title || TITLES[this.def.type] || 'Терминал', sub, this.t, this.solvedT);
      this.kind.draw(ctx, this.st, this.t);
      ctx.restore();
    }
  }

  G.Puzzles = { Pipes, Lights, Code, Logic, parseExpr, PuzzleOverlay };
})();
