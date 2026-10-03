/**
 * Headless world for the planned routes (l08–l10): real engine code via tests/lib/engine, tick order
 * mirrors GameScene.tickWorld, real findFocus() interaction rule, death → respawn at checkpoint.
 * Includes snapshot/restore + best-first search over input macros (adapted from tools/qa/bot-late/bfs.js).
 */
const { makeEngine } = require('../../lib/engine');
const T = 32;
const DYN = new Set(['crate', 'mplatform', 'saw', 'plate', 'door', 'bridge', 'lever', 'terminal', 'part', 'socket', 'trigger', 'checkpoint', 'shard', 'laser', 'jumppad', 'exit']);
class World {
  constructor(id) {
    const { G, load } = makeEngine({ console: { log() {}, warn() {}, error: console.error } });
    load('levels/' + id + '.js');
    this.G = G; this.level = new G.Level(G.levels[id]);
    this.player = new G.Player(this.level.spawn.x, this.level.spawn.y); this.player.state = 'idle';
    this.spawnPoint = { ...this.level.spawn };
    this.deaths = 0; this.shards = []; this.completed = false; this.frame = 0; this.log = [];
    this.dialogue = { blocking: false, playInline() {}, play() {} }; this.drone = { cheer() {} };
    this.dyn = this.level.entities.filter((e) => DYN.has(e.type));
  }
  isNear() { return false; } playDialogue(d) { this.log.push('dlg ' + d); } setObjective() {} showSign() {}
  openPuzzle(t) { this.log.push('puzzle ' + t.puzzle.type + ' (solved; UI solving covered by browser smoke)'); t.onSolved(this); }
  collectShard(s) { this.shards.push(s.index); this.log.push(`SHARD ${s.index} @${s.tx},${s.ty}`); }
  activateCheckpoint(cp) { cp.lit = true; this.spawnPoint = cp.spawnPoint; for (const c of this.level.crates) c.snapshot = { x: c.x, y: c.y }; }
  completeLevel() { this.completed = true; this.player.frozen = true; }
  tick(ctl, dt = 1 / 60) {
    const L = this.level, p = this.player; this.frame++;
    L.time += dt; L._dyn = L.dynamicSolids();
    for (const e of L.entities) if (e.type === 'mplatform' || e.type === 'saw') e.update(dt, this);
    L._dyn = L.dynamicSolids();
    p.update(dt, L, ctl);
    for (const e of L.entities) if (e.type !== 'mplatform' && e.type !== 'saw' && e.type !== 'deco') e.update(dt, this);
    L.resolveSignals();
    L.updateCrumbles(dt, [p, ...L.crates]);
    if (ctl.action) { const f = this.focus(); if (f) { f.interact(this); this.log.push(`use ${f.type}@${f.tx},${f.ty}`); } }
    if (p.dead) {
      if (!this.deathT) { this.deaths++; this.log.push(`DEATH ${p.deathCause} @${this.tile()}`); }
      this.deathT = (this.deathT || 0) + dt;
      if (this.deathT >= 1) { this.deathT = 0; const cp = p.carryPart; p.reset(this.spawnPoint.x, this.spawnPoint.y); if (cp && !cp.delivered) { cp.taken = false; cp.x = cp.home.x; cp.y = cp.home.y; } for (const c of this.level.crates) c.restore(); }
    }
  }
  /** Same rule as GameScene.findFocus. */
  focus() {
    const p = this.player; let best = null, bd = 1e9;
    for (const e of this.level.entities) {
      if (!e.interactable) continue;
      const dx = Math.max(e.x - (p.x + p.w), p.x - (e.x + e.w), 0), dy = Math.max(e.y - (p.y + p.h), p.y - (e.y + e.h), 0);
      if (dx > 40 || dy > 16) continue;
      if (e.canInteract && !e.canInteract(this)) continue;
      const d = Math.abs(e.cx - p.cx); if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  tile() { const p = this.player; return [+(p.cx / T).toFixed(2), +((p.y + p.h) / T).toFixed(2)]; }
  applyMacro(m, stopAt) {
    for (let i = 0; i < m.f; i++) {
      const k = m.k;
      this.tick({ left: k.includes('L'), right: k.includes('R'), down: k.includes('D'), jumpPressed: k.includes('J') && i === 0, jumpHeld: k.includes('J'), action: k.includes('E') && i === 0 });
      if (this.player.dead) return 'dead';
      if (stopAt && stopAt(this)) return 'hit';
    }
    return 'ok';
  }
  snap() {
    const prim = (o) => { const r = {}; for (const k in o) { const v = o[k]; if (v === null || (typeof v !== 'object' && typeof v !== 'function')) r[k] = v; } return r; };
    return { p: prim(this.player), ge: this.player.groundEntity, cp: this.player.carryPart, time: this.level.time, ents: this.dyn.map(prim), cr: [...this.level.crumbles.values()].map((c) => [c, c.state, c.t]), sp: this.spawnPoint, sh: this.shards.slice(), done: this.completed, frame: this.frame, logn: this.log.length, deaths: this.deaths, deathT: this.deathT || 0 };
  }
  restore(s) {
    Object.assign(this.player, s.p); this.player.groundEntity = s.ge; this.player.carryPart = s.cp; this.level.time = s.time;
    this.dyn.forEach((e, i) => Object.assign(e, s.ents[i]));
    for (const [c, st, t] of s.cr) { c.state = st; c.t = t; }
    this.spawnPoint = s.sp; this.shards = s.sh.slice(); this.completed = s.done; this.frame = s.frame; this.log.length = s.logn; this.deaths = s.deaths; this.deathT = s.deathT;
  }
}
class Heap { constructor() { this.a = []; } push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } } pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; } get size() { return this.a.length; } }
/** Best-first search from the current state for a macro path reaching goal() without dying. */
function search(w, goal, h, opts = {}) {
  const macros = [];
  for (const d of ['', 'L', 'R']) { for (const f of [4, 10, 18]) macros.push({ k: d, f }); for (const f of [6, 12, 22]) macros.push({ k: d + 'J', f }); }
  if (opts.extra) macros.push(...opts.extra);
  const tk = opts.timeKey || 0;
  const key = () => { const p = w.player; return [Math.round(p.x / 5), Math.round(p.y / 5), Math.round(p.vx / 70), Math.round(p.vy / 100), p.onGround ? 1 : 0, tk ? Math.round(((w.level.time % tk) / tk) * 16) : 0, w.player.carry || '', opts.key ? opts.key(w) : ''].join(','); };
  const start = w.snap(); const heap = new Heap(); const seen = new Set([key()]);
  heap.push({ f: h(w), s: start, path: [], g: 0 });
  let nodes = 0; const max = opts.maxNodes || 120000;
  while (heap.size) {
    const n = heap.pop();
    for (const m of macros) {
      w.restore(n.s); const r = w.applyMacro(m, goal); nodes++;
      if (r === 'hit') { const path = n.path.concat([m]); w.restore(start); return { path, nodes }; }
      if (r === 'dead') continue;
      const kk = key(); if (seen.has(kk)) continue; seen.add(kk);
      const g = n.g + m.f / 60;
      heap.push({ f: h(w) + g * (opts.gw || 0.5), s: w.snap(), path: n.path.concat([m]), g });
    }
    if (nodes > max) break;
  }
  w.restore(start); return { path: null, nodes };
}
module.exports = { World, search, T };
