/** ld47 private headless sim using the REAL engine world code. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = '/home/user/Claude-Code-Game-Studios/src/js';
function makeCtx() {
  const ctx = { console, Math, JSON, Object, Array, Set, Map, Uint8Array, String, Number, Boolean, Error };
  ctx.window = ctx; ctx.localStorage = { getItem: () => null, setItem: () => {} };
  vm.createContext(ctx);
  const ld = (f) => vm.runInContext(fs.readFileSync(f.startsWith('/') ? f : path.join(SRC, f), 'utf8'), ctx, { filename: f });
  ld('config.js'); ld('core/util.js');
  ctx.G.Audio = { play() {}, music() {} };
  ctx.G.fx = { burst() {}, dust() {}, shake() {} };
  ld('world/level.js'); ld('world/physics.js'); ld('world/entities.js'); ld('world/player.js');
  return { ctx, ld };
}
function loadLevel(id, file) {
  const { ctx, ld } = makeCtx();
  const origWarn = console.warn; console.warn = () => {};
  ld(file || `levels/${id}.js`);
  console.warn = origWarn;
  const G = ctx.G;
  const def = G.levels[id];
  const L = new G.Level(def);
  const T = 32;
  const game = {
    G, level: L, def, log: [], deaths: 0, deathT: 0, completed: false, time: 0, quiet: false,
    player: new G.Player(L.spawn.x, L.spawn.y), spawnPoint: { x: L.spawn.x, y: L.spawn.y },
    isNear() { return true; },
    playDialogue(id) { this.log.push(['dlg', id, +this.time.toFixed(2)]); },
    setObjective(t) { this.log.push(['obj', t]); },
    showSign(t) { this.log.push(['sign', t]); },
    openPuzzle(term) { this.log.push(['puzzle', term.puzzle.type]); if (this.autoSolve) term.onSolved(this); },
    collectShard(s) { this.log.push(['SHARD', s.index, this.tile()]); },
    activateCheckpoint(cp) { for (const e of L.entities) if (e.type === 'checkpoint') e.current = false; cp.lit = true; cp.current = true; this.spawnPoint = cp.spawnPoint; this.snapshot(); this.log.push(['cp', cp.tx, cp.ty, +this.time.toFixed(2)]); },
    snapshot() { for (const e of L.entities) if (e.type === 'crate') e.snapshot = { x: e.x, y: e.y }; },
    completeLevel() { this.completed = true; this.log.push(['COMPLETE', +this.time.toFixed(2)]); },
    dialogue: { playInline(lines) { game.log.push(['say', lines[0][2].slice(0, 30)]); }, blocking: false },
    autoSolve: true,
    respawn() { const p = this.player; const cp = p.carryPart; p.reset(this.spawnPoint.x, this.spawnPoint.y); if (cp && !cp.delivered) { cp.taken = false; cp.x = cp.home.x; cp.y = cp.home.y; } for (const e of L.entities) if (e.type === 'crate') e.restore(); },
    findFocus() {
      const p = this.player; let best = null, bd = 1e9; const range = G.CONFIG.player.interactRange;
      for (const e of L.entities) { if (!e.interactable) continue;
        const dx = Math.max(e.x - (p.x + p.w), p.x - (e.x + e.w), 0); const dy = Math.max(e.y - (p.y + p.h), p.y - (e.y + e.h), 0);
        if (dx > range || dy > 16) continue; const d = Math.abs(e.cx - p.cx); const can = !e.canInteract || e.canInteract(this);
        if (!can) continue; if (d < bd) { bd = d; best = e; } }
      return best;
    },
    prevJump: false,
    frame(ctl = {}) {
      const dt = 1 / 60;
      this.time += dt; L.time += dt;
      L._dyn = L.dynamicSolids();
      for (const e of L.entities) if (e.type === 'mplatform' || e.type === 'saw') e.update(dt, this);
      L._dyn = L.dynamicSolids();
      const jp = !!ctl.jump && !this.prevJump; this.prevJump = !!ctl.jump;
      this.player.update(dt, L, { left: !!ctl.left, right: !!ctl.right, down: !!ctl.down, jumpPressed: jp, jumpHeld: !!ctl.jump });
      for (const e of L.entities) if (e.type !== 'mplatform' && e.type !== 'saw') e.update(dt, this);
      L.resolveSignals();
      L.updateCrumbles(dt, [this.player, ...L.entities.filter((e) => e.type === 'crate')]);
      if (ctl.action) { const f = this.findFocus(); if (f) { f.interact(this); this.log.push(['use', f.type, f.tx, f.ty]); } else this.log.push(['USE-NOTHING', this.tile()]); }
      if (this.player.dead) {
        if (this.deathT === 0) { this.deaths++; this.log.push(['DEATH', this.player.deathCause, this.tile(), +this.time.toFixed(2)]); }
        this.deathT += dt;
        if (this.deathT >= 1.0) { this.deathT = 0; this.respawn(); }
      }
    },
    tile() { const p = this.player; return [+(p.x / T).toFixed(2), +((p.y + p.h) / T).toFixed(2)]; },
    tp(tx, ty) { const p = this.player; p.reset(tx * T + (T - p.w) / 2, (ty + 1) * T - p.h); p.state = 'idle'; },
    /** steps: {f, r,l,j,d,a} | {until:'expr', max} | {tp:[x,y]} | {time:t} | {fn} | note */
    run(steps) {
      if (this.aborted) return this;
      for (const s of steps) {
        if (s.tp) { this.tp(s.tp[0], s.tp[1]); continue; }
        if (s.time != null) { L.time = s.time; continue; }
        if (s.fn) { s.fn(this); continue; }
        const ctl = { left: s.l, right: s.r, down: s.d, jump: s.j };
        if (s.until) {
          const f = new Function('g', 'p', 'L', 'by', 'return ' + s.until);
          let n = 0; const max = s.max || 1200;
          while (!f(this, this.player, L, L.byId) && n < max) { this.frame(ctl); n++; if (this.player.dead) break; }
          if (n >= max) this.log.push(['TIMEOUT', s.until]);
        } else {
          const n = s.f || 1;
          for (let i = 0; i < n; i++) this.frame(Object.assign({}, ctl, { action: s.a && i === 0 }));
        }
        if (s.note) this.log.push(['@', s.note, this.tile(), this.player.dead ? 'DEAD' : (this.player.onGround ? 'gnd' : 'air'), +this.time.toFixed(2)]);
        if ((this.player.dead || this.log.some((l) => l[0] === 'TIMEOUT')) && !this.allowDeath) { this.log.push(['ABORT at step', JSON.stringify(s)]); this.aborted = true; break; }
      }
      return this;
    },
  };
  return game;
}
module.exports = { loadLevel };
