// Headless TESSERA physics sim using the real engine files. QA helper for l08-l10 (private).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = '/home/user/Claude-Code-Game-Studios/src/js';
const ctx = { console, Math, JSON, Object, Array, Set, Map, Uint8Array, String, Number, Boolean, Error };
ctx.window = ctx;
ctx.localStorage = { getItem: () => null, setItem: () => {} };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
load('config.js'); load('core/util.js');
ctx.G.Audio = { play() {}, music() {} };
ctx.G.fx = { burst() {}, dust() {}, shake() {} };
load('world/level.js'); load('world/physics.js'); load('world/entities.js'); load('world/player.js');
const G = ctx.G;
const T = 32;
function loadLevelFile(file) { vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }); }

class World {
  constructor(def, spawnTile) {
    this.level = new G.Level(def);
    const sp = spawnTile ? { x: spawnTile[0] * T + 6, y: (spawnTile[1] + 1) * T - 42 } : this.level.spawn;
    this.player = new G.Player(sp.x, sp.y);
    this.player.state = 'idle';
    this.spawnPoint = sp;
    this.cps = []; this.shards = 0; this.complete = false; this.events = [];
    this.dialogue = { playInline: () => {}, play: () => {}, blocking: false };
    this.drone = { cheer() {} };
  }
  isNear() { return false; }
  setObjective(t) { this.events.push('obj:' + t); }
  playDialogue(id) { this.events.push('dlg:' + id); }
  showSign() {}
  openPuzzle(t) { t.onSolved(this); }
  collectShard() { this.shards++; }
  activateCheckpoint(cp) { cp.lit = true; this.cps.push([cp.tx, cp.ty]); this.spawnPoint = cp.spawnPoint; }
  completeLevel() { this.complete = true; }
  tick(ctl, dt = 1 / 60) {
    const L = this.level; L.time += dt;
    L._dyn = L.dynamicSolids();
    for (const e of L.entities) if (e.type === 'mplatform' || e.type === 'saw') e.update(dt, this);
    L._dyn = L.dynamicSolids();
    this.player.update(dt, L, ctl);
    for (const e of L.entities) if (e.type !== 'mplatform' && e.type !== 'saw' && e.type !== 'deco') e.update(dt, this);
    L.resolveSignals();
    L.updateCrumbles(dt, [this.player, ...L.entities.filter((e) => e.type === 'crate')]);
  }
  /** steps: [{k:'RJ', f:20}] letters: L R D J(jump held; pressed on first frame) E(interact on first frame) */
  run(steps) {
    const trace = [];
    for (const s of steps) {
      const k = s.k || '';
      for (let i = 0; i < (s.f || 1); i++) {
        const ctl = { left: k.includes('L'), right: k.includes('R'), down: k.includes('D'), jumpPressed: k.includes('J') && i === 0, jumpHeld: k.includes('J') };
        this.tick(ctl);
        if (k.includes('E') && i === 0) this.interact();
        if (this.player.dead) { trace.push({ dead: this.player.deathCause, at: this.tile() }); return { dead: true, cause: this.player.deathCause, at: this.tile(), trace }; }
      }
      trace.push(this.tile());
    }
    return { dead: false, at: this.tile(), ground: this.player.onGround, trace };
  }
  interact() {
    const p = this.player; let best = null, bd = 1e9;
    for (const e of this.level.entities) {
      if (!e.interactable) continue;
      const d = Math.abs(e.cx - p.cx);
      if (d < 40 + e.w / 2 && Math.abs(e.cy - p.cy) < 64 && d < bd && (!e.canInteract || e.canInteract(this))) { best = e; bd = d; }
    }
    if (best) best.interact(this);
    return best;
  }
  tile() { const p = this.player; return [+(p.cx / T).toFixed(2), +((p.y + p.h) / T).toFixed(2)]; }
  place(tx, feetRow) { this.player.x = tx * T + 6; this.player.y = feetRow * T - 42; this.player.vx = 0; this.player.vy = 0; }
  snap() {
    const prim = (o) => { const r = {}; for (const k in o) { const v = o[k]; if (v === null || (typeof v !== 'object' && typeof v !== 'function')) r[k] = v; } return r; };
    return {
      p: prim(this.player), ge: this.player.groundEntity, carryPart: this.player.carryPart,
      time: this.level.time,
      ents: this.level.entities.filter((e) => e.type !== 'deco').map((e) => [e, prim(e)]),
      cr: [...this.level.crumbles.values()].map((c) => [c, c.state, c.t]),
    };
  }
  restore(s) {
    Object.assign(this.player, s.p); this.player.groundEntity = s.ge; this.player.carryPart = s.carryPart;
    this.level.time = s.time;
    for (const [e, v] of s.ents) Object.assign(e, v);
    for (const [c, st, t] of s.cr) { c.state = st; c.t = t; }
  }
}

/** BFS over macro actions. goal(world) → true. Returns {path, nodes}. */
function search(world, goal, opts = {}) {
  const maxNodes = opts.maxNodes || 300000;
  const macros = [];
  for (const d of ['', 'L', 'R']) {
    for (const f of [3, 8, 16]) macros.push({ k: d, f });
    for (const f of [5, 12, 22]) macros.push({ k: d + 'J', f });
  }
  const seen = new Set();
  const key = (w) => { const p = w.player; return [Math.round(p.x / 6), Math.round(p.y / 6), Math.round(p.vx / 80), Math.round(p.vy / 120), p.onGround ? 1 : 0, opts.timeKey ? Math.round(((w.level.time % opts.timeKey) / opts.timeKey) * 12) : 0].join(','); };
  const start = world.snap();
  let frontier = [{ s: start, path: [] }];
  seen.add(key(world));
  let nodes = 0;
  for (let depth = 0; depth < (opts.maxDepth || 60) && frontier.length; depth++) {
    let next = [];
    for (const n of frontier) {
      for (const m of macros) {
        world.restore(n.s);
        let dead = false, hit = false;
        for (let i = 0; i < m.f; i++) {
          const k = m.k;
          world.tick({ left: k.includes('L'), right: k.includes('R'), down: false, jumpPressed: k.includes('J') && i === 0, jumpHeld: k.includes('J') });
          if (world.player.dead) { dead = true; break; }
          if (goal(world)) { hit = true; break; }
        }
        nodes++;
        if (hit) { const p = n.path.concat([m]); world.restore(start); return { path: p, nodes, depth }; }
        if (dead) continue;
        if (opts.bounds && !opts.bounds(world)) continue;
        const kk = key(world);
        if (seen.has(kk)) continue;
        seen.add(kk);
        next.push({ s: world.snap(), path: n.path.concat([m]) });
        if (nodes > maxNodes) { world.restore(start); return { path: null, nodes, reason: 'budget' }; }
      }
    }
    if (opts.h && next.length > (opts.beam || 3000)) {
      for (const n of next) { world.restore(n.s); n.hv = opts.h(world); }
      next.sort((a, b) => a.hv - b.hv); next = next.slice(0, opts.beam || 3000);
    }
    frontier = next;
  }
  world.restore(start);
  return { path: null, nodes };
}

module.exports = { G, World, loadLevelFile, search, T };
