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
  /** Per-overlay UI state: whether the player is steering with the mouse (hover) or a cursor. */
  const ui = { mouse: false };
  const showCursor = () => !ui.mouse && G.input.lastDevice !== 'touch';
  const CLOSE = { x: PX + PW - 58, y: PY + 6, w: 52, h: 52 }; // generous hit area (phones)

  /**
   * Panel frame. `sub` is the top line (flavour or rules); `rules` (optional) is a
   * second rules line pinned above the footer; `footer` is the controls line.
   */
  function panel(ctx, title, sub, rules, footer, t, solvedT) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.shadowColor = solvedT > 0 ? GREEN : CYAN; ctx.shadowBlur = 24;
    const bg = ctx.createLinearGradient(0, PY, 0, PY + PH);
    bg.addColorStop(0, 'rgba(8,20,34,0.97)'); bg.addColorStop(1, 'rgba(4,10,20,0.97)');
    ctx.fillStyle = bg;
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
    if (sub) {
      ctx.fillStyle = 'rgba(210,235,255,0.8)'; ctx.font = `400 14px ${FONT}`;
      const n = G.wrapText(ctx, sub, PX + 26, PY + 46, PW - 96, 18, sub);
      // header rule (only when the subtitle is a single line; two lines use the space)
      if (n === 1) { ctx.fillStyle = 'rgba(126,249,255,0.12)'; ctx.fillRect(PX + 26, PY + 72, PW - 52, 1); }
    }
    if (rules) {
      ctx.fillStyle = 'rgba(126,249,255,0.75)'; ctx.font = `500 13px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(rules, W / 2, PY + PH - 52);
      ctx.textAlign = 'left';
    }
    // footer controls
    ctx.fillStyle = 'rgba(200,230,255,0.55)'; ctx.font = `400 12px ${FONT}`;
    ctx.fillText(footer, PX + 26, PY + PH - 26);
    // close button (drawn as a round chip, hit area is CLOSE)
    const hov = ui.mouse && inRect(G.input.pointer, CLOSE);
    const cx = CLOSE.x + CLOSE.w / 2, cy = CLOSE.y + CLOSE.h / 2;
    ctx.fillStyle = hov ? 'rgba(255,93,108,0.25)' : 'rgba(126,249,255,0.08)';
    ctx.beginPath(); ctx.arc(cx, cy, 17, 0, 7); ctx.fill();
    ctx.strokeStyle = hov ? RED : 'rgba(200,230,255,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 6, cy - 6); ctx.lineTo(cx + 6, cy + 6); ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx - 6, cy + 6); ctx.stroke();
    return CLOSE;
  }

  /** "System restored" banner drawn over the solved puzzle. */
  function solvedBanner(ctx, solvedT) {
    const a = Math.min(1, solvedT * 4);
    const k = G.easeOutBack(Math.min(1, solvedT * 3));
    ctx.save();
    ctx.globalAlpha = a * 0.75; ctx.fillStyle = 'rgba(2,10,8,1)';
    G.roundRect(ctx, PX + 2, PY + 76, PW - 4, PH - 110, 0); ctx.fill();
    ctx.globalAlpha = a;
    const bh = 84, by = H / 2 - bh / 2 + 10;
    ctx.fillStyle = 'rgba(125,255,168,0.10)'; ctx.fillRect(PX + 2, by, PW - 4, bh);
    ctx.fillStyle = GREEN; ctx.fillRect(PX + 2, by, PW - 4, 2); ctx.fillRect(PX + 2, by + bh - 2, PW - 4, 2);
    ctx.translate(W / 2, by + bh / 2); ctx.scale(k, k);
    ctx.shadowColor = GREEN; ctx.shadowBlur = 18;
    ctx.fillStyle = GREEN; ctx.font = `800 30px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('СИСТЕМА ВОССТАНОВЛЕНА', 0, 0);
    ctx.restore();
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
    cellAt(st, p) {
      const L = Pipes.layout(st);
      const cx = Math.floor((p.x - L.gx) / L.size), cy = Math.floor((p.y - L.gy) / L.size);
      return cx >= 0 && cy >= 0 && cx < st.w && cy < st.h ? { x: cx, y: cy } : null;
    },
    input(st, inp) {
      let rotate = -1;
      if (inp.pointer.clicked) {
        const c = Pipes.cellAt(st, inp.pointer);
        if (c) { st.cursor = c; rotate = c.y * st.w + c.x; }
      }
      if (inp.pressed('left')) st.cursor.x = (st.cursor.x + st.w - 1) % st.w;
      if (inp.pressed('right')) st.cursor.x = (st.cursor.x + 1) % st.w;
      if (inp.pressed('up')) st.cursor.y = (st.cursor.y + st.h - 1) % st.h;
      if (inp.pressed('down')) st.cursor.y = (st.cursor.y + 1) % st.h;
      if (inp.pressed('jump') || inp.pressed('action')) rotate = st.cursor.y * st.w + st.cursor.x;
      if (rotate >= 0) { st.cells[rotate].rot = (st.cells[rotate].rot + 1) % 4; st.anim[rotate] = 1; G.Audio.play('rotate'); }
      return Pipes.check(st).solved;
    },
    tick(st, dt) { for (let i = 0; i < st.anim.length; i++) st.anim[i] = Math.max(0, st.anim[i] - dt * 7); },
    draw(ctx, st, t) {
      const L = Pipes.layout(st);
      const { powered, solved } = Pipes.check(st);
      const hover = ui.mouse ? Pipes.cellAt(st, G.input.pointer) : null;
      // source / sink
      const srcY = L.gy + st.sr * L.size + L.size / 2, snkY = L.gy + st.kr * L.size + L.size / 2;
      const srcX = L.gx - 30, snkX = L.gx + L.size * st.w + 30;
      ctx.save();
      ctx.shadowColor = AMBER; ctx.shadowBlur = 16;
      ctx.fillStyle = AMBER;
      ctx.fillRect(srcX, srcY - 4, L.gx - srcX + 4, 8);
      ctx.beginPath(); ctx.arc(srcX, srcY, 13 + Math.sin(t * 5) * 2, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = solved ? GREEN : 'rgba(126,249,255,0.22)';
      ctx.fillRect(L.gx + L.size * st.w - 4, snkY - 4, snkX - (L.gx + L.size * st.w) + 4, 8);
      ctx.save();
      if (solved) { ctx.shadowColor = GREEN; ctx.shadowBlur = 20 + Math.sin(t * 8) * 6; }
      ctx.beginPath(); ctx.arc(snkX, snkY, 14, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = solved ? GREEN : 'rgba(126,249,255,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(snkX, snkY, 14, 0, 7); ctx.stroke();
      ctx.font = `700 10px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = AMBER; ctx.fillText('ИСТОЧНИК', srcX, srcY + 20);
      ctx.fillStyle = solved ? GREEN : CYAN; ctx.fillText('ПРИЁМНИК', snkX, snkY + 20);
      ctx.textAlign = 'left';
      for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
        const i = y * st.w + x, c = st.cells[i];
        const cx = L.gx + x * L.size, cy = L.gy + y * L.size;
        const isHover = hover && hover.x === x && hover.y === y;
        ctx.fillStyle = isHover ? 'rgba(126,249,255,0.14)' : 'rgba(126,249,255,0.06)';
        G.roundRect(ctx, cx + 3, cy + 3, L.size - 6, L.size - 6, 8); ctx.fill();
        if (st.cursor.x === x && st.cursor.y === y && showCursor()) {
          ctx.strokeStyle = AMBER; ctx.lineWidth = 2.5; G.roundRect(ctx, cx + 2, cy + 2, L.size - 4, L.size - 4, 9); ctx.stroke();
        } else if (isHover) {
          ctx.strokeStyle = 'rgba(126,249,255,0.5)'; ctx.lineWidth = 1.5; G.roundRect(ctx, cx + 3, cy + 3, L.size - 6, L.size - 6, 8); ctx.stroke();
        }
        const m = Pipes.mask(c);
        const on = powered.has(i);
        // eased quarter-turn: the piece swings from its previous orientation into the new one
        const e = st.anim[i];
        const rotA = -(e * e * (3 - 2 * e)) * Math.PI / 2;
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
        if (on) { ctx.shadowColor = solved ? GREEN : AMBER; ctx.shadowBlur = 14; }
        drawArms(L.size * 0.26, on ? (solved ? '#124a2a' : '#5a3b10') : '#1c2c3c');
        ctx.shadowBlur = 0;
        drawArms(L.size * 0.12, on ? (solved ? GREEN : AMBER) : '#5d7d94');
        if (on && e === 0) {
          // flowing energy dots
          ctx.fillStyle = '#fff';
          const ph = (t * 1.6) % 1;
          for (const [bit, dx, dy] of [[N, 0, -1], [E, 1, 0], [S, 0, 1], [Wd, -1, 0]]) {
            if (!(m & bit)) continue;
            const d = arm * ph;
            ctx.beginPath(); ctx.arc(dx * d, dy * d, 2.2, 0, 7); ctx.fill();
          }
        }
        ctx.fillStyle = on ? (solved ? GREEN : AMBER) : '#5d7d94';
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
      const size = Math.min(84, Math.floor((PH - 180) / st.n));
      return { size, gx: PX + (PW - size * st.n) / 2, gy: PY + 88 };
    },
    cellAt(st, p) {
      const L = Lights.layout(st);
      const cx = Math.floor((p.x - L.gx) / L.size), cy = Math.floor((p.y - L.gy) / L.size);
      return cx >= 0 && cy >= 0 && cx < st.n && cy < st.n ? { x: cx, y: cy } : null;
    },
    input(st, inp) {
      if (inp.pointer.clicked) {
        const c = Lights.cellAt(st, inp.pointer);
        if (c) { st.cursor = c; Lights.press(st, c.y * st.n + c.x); }
      }
      if (inp.pressed('left')) st.cursor.x = (st.cursor.x + st.n - 1) % st.n;
      if (inp.pressed('right')) st.cursor.x = (st.cursor.x + 1) % st.n;
      if (inp.pressed('up')) st.cursor.y = (st.cursor.y + st.n - 1) % st.n;
      if (inp.pressed('down')) st.cursor.y = (st.cursor.y + 1) % st.n;
      if (inp.pressed('jump') || inp.pressed('action')) Lights.press(st, st.cursor.y * st.n + st.cursor.x);
      if (inp.pressed('restart')) { st.on = st.initial.slice(); st.moves = 0; G.Audio.play('ui'); }
      return st.on.every(Boolean);
    },
    tick(st, dt) { for (let i = 0; i < st.flash.length; i++) st.flash[i] = Math.max(0, st.flash[i] - dt * 4.8); },
    draw(ctx, st, t) {
      const L = Lights.layout(st);
      // which cell would a press affect? (mouse hover, or the keyboard/gamepad cursor)
      const target = ui.mouse ? Lights.cellAt(st, G.input.pointer) : (G.input.lastDevice !== 'touch' ? st.cursor : null);
      const affected = new Set();
      if (target) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = target.x + dx, ny = target.y + dy;
        if (nx >= 0 && ny >= 0 && nx < st.n && ny < st.n) affected.add(ny * st.n + nx);
      }
      for (let y = 0; y < st.n; y++) for (let x = 0; x < st.n; x++) {
        const i = y * st.n + x;
        const cx = L.gx + x * L.size + L.size / 2, cy = L.gy + y * L.size + L.size / 2;
        const r = L.size * 0.36;
        const hex = (rr) => { ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3; ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } ctx.closePath(); };
        // preview halo on the cells this press will flip
        if (affected.has(i)) {
          ctx.fillStyle = 'rgba(126,249,255,0.10)';
          G.roundRect(ctx, cx - L.size / 2 + 4, cy - L.size / 2 + 4, L.size - 8, L.size - 8, 10); ctx.fill();
        }
        ctx.save();
        if (st.on[i]) { ctx.shadowColor = AMBER; ctx.shadowBlur = 22; }
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r);
        g.addColorStop(0, st.on[i] ? '#fff6d0' : '#2a3a4c');
        g.addColorStop(1, st.on[i] ? '#d98a1c' : '#121c28');
        ctx.fillStyle = g;
        hex(r); ctx.fill();
        ctx.restore();
        hex(r);
        ctx.strokeStyle = st.flash[i] > 0 ? `rgba(255,255,255,${st.flash[i]})` : affected.has(i) ? 'rgba(126,249,255,0.85)' : 'rgba(126,249,255,0.35)';
        ctx.lineWidth = affected.has(i) ? 2.5 : 2; ctx.stroke();
        if (affected.has(i)) {
          // small "will flip" marker: the cell's future state as a dot
          ctx.fillStyle = st.on[i] ? '#2a3a4c' : AMBER;
          ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, r * 0.16), 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.stroke();
        }
        if (target && st.cursor.x === x && st.cursor.y === y && showCursor()) {
          ctx.strokeStyle = AMBER; ctx.lineWidth = 2.5;
          G.roundRect(ctx, cx - L.size / 2 + 3, cy - L.size / 2 + 3, L.size - 6, L.size - 6, 10); ctx.stroke();
        }
      }
      const lit = st.on.filter(Boolean).length;
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(200,230,255,0.75)'; ctx.font = `500 14px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillText('Ходов: ' + st.moves, PX + PW - 30, PY + 84);
      ctx.fillStyle = lit === st.on.length ? GREEN : AMBER;
      ctx.fillText(`Горит: ${lit} / ${st.on.length}`, PX + PW - 30, PY + 104);
      ctx.textAlign = 'left';
    },
  };

  // ======================================================================= CODE
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
  const Code = {
    create(def) {
      return { type: 'code', code: String(def.code), entry: '', err: 0, cursor: 0, hint: def.hint || '', pressT: new Array(12).fill(0) };
    },
    layout() {
      const s = 76, h = 48, gap = 8;
      return { s, h, gap, gx: PX + PW / 2 - (s * 3 + gap * 2) / 2, gy: PY + 176 };
    },
    keyRect(L, i) { return { x: L.gx + (i % 3) * (L.s + L.gap), y: L.gy + Math.floor(i / 3) * (L.h + L.gap), w: L.s, h: L.h }; },
    keyPress(st, k) {
      const ki = KEYS.indexOf(k);
      if (ki >= 0 && st.pressT) st.pressT[ki] = 1;
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
          if (inRect(inp.pointer, Code.keyRect(L, i))) { st.cursor = i; if (Code.keyPress(st, KEYS[i])) return true; }
        }
      }
      if (inp.typed) for (const ch of inp.typed) { if (/[0-9]/.test(ch) && Code.keyPress(st, ch)) return true; }
      if (inp.pressed('left')) st.cursor = (st.cursor + 11) % 12;
      if (inp.pressed('right')) st.cursor = (st.cursor + 1) % 12;
      if (inp.pressed('up')) st.cursor = (st.cursor + 9) % 12;
      if (inp.pressed('down')) st.cursor = (st.cursor + 3) % 12;
      // Enter (confirm without jump) submits; Space / E / pad-A press the highlighted key
      if (inp.pressed('confirm') && !inp.pressed('jump')) {
        if (st.entry.length) return Code.keyPress(st, 'OK');
        return false;
      }
      if (inp.pressed('jump') || inp.pressed('action')) { if (Code.keyPress(st, KEYS[st.cursor])) return true; }
      return false;
    },
    /** Backspace: delete the last digit. Returns false when there is nothing to delete. */
    backspace(st) {
      if (!st.entry.length) return false;
      st.entry = st.entry.slice(0, -1); G.Audio.play('ui'); return true;
    },
    tick(st, dt) {
      st.err = Math.max(0, st.err - dt * 2.4);
      if (st.pressT) for (let i = 0; i < 12; i++) st.pressT[i] = Math.max(0, st.pressT[i] - dt * 6);
    },
    draw(ctx, st, t) {
      const L = Code.layout();
      const shake = st.err > 0 ? Math.sin(t * 80) * 8 * st.err : 0;
      // digit slots
      const n = st.code.length, sw = 44, sg = 12;
      const total = n * sw + (n - 1) * sg;
      const dx0 = PX + PW / 2 - total / 2 + shake, dy = PY + 96;
      ctx.fillStyle = '#02070d'; G.roundRect(ctx, dx0 - 16, dy - 8, total + 32, 64, 10); ctx.fill();
      ctx.strokeStyle = st.err > 0 ? RED : 'rgba(126,249,255,0.55)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `700 32px "Share Tech Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < n; i++) {
        const x = dx0 + i * (sw + sg);
        const filled = i < st.entry.length, next = i === st.entry.length;
        ctx.fillStyle = filled ? 'rgba(255,207,107,0.10)' : 'rgba(126,249,255,0.05)';
        G.roundRect(ctx, x, dy, sw, 48, 6); ctx.fill();
        ctx.fillStyle = st.err > 0 ? RED : next && Math.sin(t * 8) > 0 ? CYAN : 'rgba(126,249,255,0.35)';
        ctx.fillRect(x + 8, dy + 40, sw - 16, 3);
        if (filled) { ctx.fillStyle = AMBER; ctx.fillText(st.entry[i], x + sw / 2, dy + 23); }
      }
      // riddle hint card (left of the keypad)
      if (st.hint) {
        const cx = PX + 30, cw = L.gx - PX - 60, cy = L.gy;
        ctx.font = `400 14px ${FONT}`;
        const lines = G.splitLines(ctx, st.hint, cw - 24);
        const ch = 40 + lines.length * 19;
        ctx.fillStyle = 'rgba(255,207,107,0.07)'; G.roundRect(ctx, cx, cy, cw, ch, 10); ctx.fill();
        ctx.strokeStyle = 'rgba(255,207,107,0.45)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = AMBER; ctx.fillRect(cx, cy + 10, 3, ch - 20);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.font = `700 11px ${FONT}`; ctx.fillText('ПОДСКАЗКА', cx + 14, cy + 12);
        ctx.fillStyle = '#f4ead8'; ctx.font = `400 14px ${FONT}`;
        lines.forEach((l, i) => ctx.fillText(l, cx + 14, cy + 32 + i * 19));
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      }
      // keypad
      for (let i = 0; i < 12; i++) {
        const r = Code.keyRect(L, i);
        const hover = ui.mouse && inRect(G.input.pointer, r);
        const pk = st.pressT ? st.pressT[i] : 0;
        ctx.fillStyle = pk > 0 ? `rgba(126,249,255,${0.12 + 0.3 * pk})` : hover ? 'rgba(126,249,255,0.18)' : 'rgba(126,249,255,0.07)';
        G.roundRect(ctx, r.x, r.y + pk * 2, r.w, r.h, 8); ctx.fill();
        const sel = st.cursor === i && showCursor();
        ctx.strokeStyle = sel ? AMBER : 'rgba(126,249,255,0.3)'; ctx.lineWidth = sel ? 2.5 : 1; ctx.stroke();
        ctx.fillStyle = KEYS[i] === 'OK' ? GREEN : KEYS[i] === 'C' ? RED : '#dff6ff';
        ctx.font = KEYS[i] === 'C' ? `700 13px ${FONT}` : `600 20px ${FONT}`;
        ctx.fillText(KEYS[i] === 'C' ? 'СБРОС' : KEYS[i], r.x + r.w / 2, r.y + r.h / 2 + 1 + pk * 2);
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
  /** Per-variable colours so each switch can be traced into the expressions. */
  const VAR_COL = ['#7ef9ff', '#ff9ad5', '#b4ff8a', '#c8a8ff', '#ffd28a', '#8ab4ff'];
  /** Russian ЙЦУКЕН keys that sit where A–F are, so letters work without switching layout. */
  const RU_LAT = { 'ф': 'A', 'и': 'B', 'с': 'C', 'в': 'D', 'у': 'E', 'а': 'F' };
  /** Tokenise an expression for coloured rendering: [{t:'var'|'op'|'paren', s}]. */
  function tokens(src) {
    const out = [];
    for (const ch of src.replace(/\s+/g, '')) {
      if (/[A-Z]/.test(ch)) out.push({ t: 'var', s: ch });
      else if (ch === '(' || ch === ')') out.push({ t: 'paren', s: ch });
      else out.push({ t: 'op', s: { '&': 'И', '|': 'ИЛИ', '^': 'ИСКЛ-ИЛИ', '!': 'НЕ' }[ch] || ch });
    }
    return out;
  }
  const Logic = {
    create(def, seed) {
      const inputs = def.inputs || ['A', 'B', 'C'];
      const outputs = (def.outputs || [{ label: 'Выход', expr: def.expr || 'A&B' }]).map((o) => ({ label: o.label, expr: o.expr, fn: parseExpr(o.expr), text: prettyExpr(o.expr), tokens: tokens(o.expr) }));
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
      const sw = 78, gap = 16, sh = 92;
      const total = n * sw + (n - 1) * gap;
      return { sw, sh, gap, gx: PX + (PW - total) / 2, gy: PY + PH - 168 };
    },
    toggle(st, i) { const k = st.inputs[i]; st.env[k] = !st.env[k]; st.flash[k] = 1; G.Audio.play('toggle'); },
    input(st, inp) {
      const L = Logic.layout(st);
      // typed letters first: A/D/E are also move/action keys, so a matched letter consumes the frame
      if (inp.typed) {
        let hit = false;
        for (const raw of inp.typed) {
          const ch = RU_LAT[raw.toLowerCase()] || raw.toUpperCase();
          const i = st.inputs.indexOf(ch);
          if (i >= 0) { st.cursor = i; Logic.toggle(st, i); hit = true; }
        }
        if (hit) return Logic.solved(st);
      }
      if (inp.pointer.clicked) {
        st.inputs.forEach((k, i) => {
          const r = { x: L.gx + i * (L.sw + L.gap), y: L.gy, w: L.sw, h: L.sh };
          if (inRect(inp.pointer, r)) { st.cursor = i; Logic.toggle(st, i); }
        });
      }
      if (inp.pressed('left')) st.cursor = (st.cursor + st.inputs.length - 1) % st.inputs.length;
      if (inp.pressed('right')) st.cursor = (st.cursor + 1) % st.inputs.length;
      if (inp.pressed('jump') || inp.pressed('action')) Logic.toggle(st, st.cursor);
      return Logic.solved(st);
    },
    tick(st, dt) { for (const k of st.inputs) st.flash[k] = Math.max(0, (st.flash[k] || 0) - dt * 3.6); },
    draw(ctx, st, t) {
      const L = Logic.layout(st);
      const col = (k) => VAR_COL[Math.max(0, st.inputs.indexOf(k)) % VAR_COL.length];
      // outputs
      let y = PY + 104;
      const rowH = st.outputs.length > 3 ? 42 : 52;
      ctx.textBaseline = 'middle';
      for (const o of st.outputs) {
        const on = o.fn(st.env);
        ctx.fillStyle = on ? 'rgba(125,255,168,0.07)' : 'rgba(126,249,255,0.05)';
        G.roundRect(ctx, PX + 30, y - 20, PW - 60, 40, 10); ctx.fill();
        ctx.strokeStyle = on ? 'rgba(125,255,168,0.35)' : 'rgba(255,93,108,0.25)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = on ? GREEN : RED;
        ctx.save(); if (on) { ctx.shadowColor = GREEN; ctx.shadowBlur = 14; }
        ctx.beginPath(); ctx.arc(PX + 54, y, 9, 0, 7); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#e8f6ff'; ctx.textAlign = 'left'; ctx.font = `600 17px ${FONT}`;
        ctx.fillText(o.label, PX + 74, y);
        // expression, right of a fixed label column, each variable in its switch colour
        let x = PX + 74 + Math.max(130, ctx.measureText(o.label).width + 18);
        const maxX = PX + PW - 84;
        let fs = 17;
        const fontOf = (tk, f) => tk.t === 'op' ? `400 ${f - 2}px "Share Tech Mono", monospace` : `700 ${f}px "Share Tech Mono", monospace`;
        const gapBefore = (i) => i === 0 || o.tokens[i - 1].s === '(' || o.tokens[i].s === ')' ? 0 : (o.tokens[i - 1].t === 'op' && o.tokens[i - 1].s === 'НЕ' ? 6 : 9);
        const widthAt = (f) => { let w = 0; o.tokens.forEach((tk, i) => { ctx.font = fontOf(tk, f); w += gapBefore(i) + ctx.measureText(tk.s).width; }); return w; };
        while (fs > 11 && x + widthAt(fs) > maxX) fs--;
        o.tokens.forEach((tk, i) => {
          x += gapBefore(i);
          ctx.font = fontOf(tk, fs);
          ctx.fillStyle = tk.t === 'var' ? col(tk.s) : tk.t === 'paren' ? 'rgba(200,230,255,0.5)' : 'rgba(200,230,255,0.72)';
          ctx.fillText(tk.s, x, y + 0.5);
          x += ctx.measureText(tk.s).width;
        });
        // live verdict
        ctx.font = `700 13px "Share Tech Mono", monospace`; ctx.textAlign = 'right';
        ctx.fillStyle = on ? GREEN : RED;
        ctx.fillText(on ? 'ВКЛ' : 'ВЫКЛ', PX + PW - 46, y + 0.5);
        ctx.textAlign = 'left';
        y += rowH;
      }
      // switches
      st.inputs.forEach((k, i) => {
        const x = L.gx + i * (L.sw + L.gap);
        const on = st.env[k];
        const c = col(k);
        const r = { x, y: L.gy, w: L.sw, h: L.sh };
        const hover = ui.mouse && inRect(G.input.pointer, r);
        const fl = st.flash[k] || 0;
        ctx.fillStyle = hover ? 'rgba(126,249,255,0.14)' : `rgba(126,249,255,${0.07 + fl * 0.15})`;
        G.roundRect(ctx, x, L.gy, L.sw, L.sh, 10); ctx.fill();
        const sel = st.cursor === i && showCursor();
        ctx.strokeStyle = sel ? AMBER : on ? c : 'rgba(126,249,255,0.3)'; ctx.lineWidth = sel ? 2.5 : 1; ctx.stroke();
        // toggle body
        const tx = x + L.sw / 2 - 13, ty = L.gy + 10;
        ctx.fillStyle = '#0b1622'; G.roundRect(ctx, tx, ty, 26, 48, 13); ctx.fill();
        ctx.strokeStyle = 'rgba(126,249,255,0.2)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = on ? c : '#46596b';
        ctx.save(); if (on) { ctx.shadowColor = c; ctx.shadowBlur = 12; }
        ctx.beginPath(); ctx.arc(tx + 13, on ? ty + 13 : ty + 35, 10, 0, 7); ctx.fill(); ctx.restore();
        ctx.textAlign = 'center';
        ctx.font = `700 17px "Share Tech Mono", monospace`; ctx.fillStyle = c;
        const lab = k, val = on ? '1' : '0';
        const lw = ctx.measureText(lab + ' = ' + val).width;
        ctx.textAlign = 'left';
        ctx.fillText(lab, x + L.sw / 2 - lw / 2, L.gy + 76);
        ctx.fillStyle = on ? '#ffffff' : 'rgba(200,230,255,0.6)';
        ctx.fillText(' = ' + val, x + L.sw / 2 - lw / 2 + ctx.measureText(lab).width, L.gy + 76);
      });
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    },
  };

  const Kinds = { pipes: Pipes, lights: Lights, code: Code, logic: Logic };
  const TITLES = { pipes: 'Силовая магистраль', lights: 'Кристаллическая матрица', code: 'Кодовый замок', logic: 'Логический контур' };
  /** Rules line per type (shown on top, or above the footer when the level supplies flavour text). */
  const SUBS = {
    pipes: 'Поворачивайте сегменты, чтобы провести энергию от источника к приёмнику.',
    lights: 'Кристалл переключает себя и соседей крестом. Зажгите все кристаллы.',
    code: 'Введите код доступа.',
    logic: 'Выставьте переключатели так, чтобы ВСЕ выходы загорелись зелёным.',
  };

  /** Controls footer, per puzzle type and the device the player is using right now. */
  function footerText(type) {
    const dev = G.input.lastDevice;
    if (dev === 'touch' || G.input.touchActive && !ui.mouse && dev !== 'keyboard' && dev !== 'gamepad') {
      return { pipes: 'Касайтесь сегментов, чтобы повернуть', lights: 'Касайтесь кристаллов', code: 'Касайтесь цифр · ОК — ввод', logic: 'Касайтесь переключателей' }[type] + ' · ✕ — выйти';
    }
    if (dev === 'gamepad') {
      return { pipes: 'Крестовина — выбор · A — повернуть', lights: 'Крестовина — выбор · A — нажать · Y — сброс', code: 'Крестовина — выбор · A — нажать', logic: 'Крестовина — выбор · A — переключить' }[type] + ' · B — выйти';
    }
    if (ui.mouse) {
      return { pipes: 'Клик — повернуть сегмент', lights: 'Клик — нажать кристалл · R — сброс', code: 'Клик по клавишам или цифры с клавиатуры', logic: 'Клик — переключить' }[type] + ' · Esc — выйти';
    }
    return {
      pipes: 'Стрелки — выбор · Пробел / E — повернуть',
      lights: 'Стрелки — выбор · Пробел / E — нажать · R — сброс',
      code: 'Цифры 0–9 · Enter — ввод · Backspace — стереть',
      logic: 'Клавиши-буквы или стрелки + Пробел — переключить',
    }[type] + ' · Esc — выйти';
  }

  /** Modal puzzle overlay controller used by the game scene. */
  class PuzzleOverlay {
    constructor(terminal, game) {
      this.terminal = terminal;
      this.game = game;
      const def = terminal.puzzle || { type: 'pipes' };
      this.def = def;
      this.kind = Kinds[def.type];
      if (!this.kind) { console.warn('Unknown puzzle type', def.type); this.kind = Pipes; }
      this.type = Kinds[def.type] ? def.type : 'pipes';
      const seed = def.seed != null ? def.seed : G.hash(game.level.id + ':' + (terminal.id || terminal.tx + ',' + terminal.ty));
      if (!terminal.puzzleState) terminal.puzzleState = this.kind.create(def, seed);
      this.st = terminal.puzzleState;
      this.t = 0; this.openT = 0; this.solvedT = 0;
      this.closeBtn = CLOSE;
      ui.mouse = G.input.lastDevice === 'mouse';
      G.Audio.play('terminalOpen');
    }
    update(dt) {
      this.t += dt;
      this.openT = Math.min(1, this.openT + dt * 5);
      const inp = G.input;
      // track mouse vs cursor steering (hover previews vs highlighted cursor)
      if (inp.pointer.moved && G.input.lastDevice !== 'touch') ui.mouse = true;
      if (inp.pressed('left') || inp.pressed('right') || inp.pressed('up') || inp.pressed('down')) ui.mouse = false;
      if (inp.pointer.clicked) ui.mouse = G.input.lastDevice === 'mouse';
      if (this.kind.tick) this.kind.tick(this.st, dt);
      if (this.solvedT > 0) {
        this.solvedT += dt;
        if (this.solvedT > 1.3 || (this.solvedT > 0.4 && (inp.anyPressed() || inp.pointer.clicked))) return 'close';
        return null;
      }
      if (this.openT < 0.6) return null; // ignore the press that opened the terminal
      // Backspace ('back' alone) edits the code entry before it closes the panel.
      // Esc sends back+pause, gamepad B sends back+action: both always close.
      if (inp.pressed('back') && !inp.pressed('pause') && !inp.pressed('action') && this.kind.backspace && this.kind.backspace(this.st)) return null;
      if (inp.pressed('back') || inp.pressed('pause')) return 'close';
      if (inp.pointer.clicked && inRect(inp.pointer, CLOSE)) return 'close';
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
      const d = this.def;
      // flavour text (subtitle) on top; rules move above the footer so they're never lost.
      // A code puzzle's hint is drawn as its own card by Code.draw.
      const flavour = d.subtitle || (this.type !== 'code' ? d.hint : null);
      const top = flavour || SUBS[this.type];
      const rules = flavour && this.type !== 'code' ? SUBS[this.type] : null;
      panel(ctx, d.title || TITLES[this.type] || 'Терминал', top, rules, footerText(this.type), this.t, this.solvedT);
      this.kind.draw(ctx, this.st, this.t);
      if (this.solvedT > 0) solvedBanner(ctx, this.solvedT);
      ctx.restore();
    }
  }

  G.Puzzles = { Pipes, Lights, Code, Logic, parseExpr, PuzzleOverlay };
})();
