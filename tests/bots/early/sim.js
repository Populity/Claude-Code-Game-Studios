// Headless simulator running the REAL engine world code (level/physics/entities/player)
// with a fake GameScene that mirrors GameScene.tickWorld ordering. Plus a tiny bot DSL.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = require('path').join(__dirname, '..', '..', '..', 'src', 'js');

function makeCtx() {
  const ctx = { console, Math, JSON, Object, Array, Set, Map, Uint8Array, String, Number, Boolean, Error };
  ctx.window = ctx;
  vm.createContext(ctx);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  load('config.js'); load('core/util.js');
  ctx.G.Audio = { play() {}, music() {} };
  ctx.G.fx = { burst() {}, dust() {}, shake() {}, update() {} };
  load('world/level.js'); load('world/physics.js'); load('world/entities.js'); load('world/player.js');
  ctx.G.registerLevel = ctx.G.registerLevel || ((d) => { ctx.G.levels[d.id] = d; });
  return { ctx, load };
}

const T = 32;
class Sim {
  constructor(id, opts = {}) {
    const { ctx, load } = makeCtx();
    if (opts.def) ctx.G.levels[id] = opts.def; else load('levels/' + id + '.js');
    const G = this.G = ctx.G;
    const def = G.levels[id];
    this.def = def;
    this.level = new G.Level(def);
    this.player = new G.Player(this.level.spawn.x, this.level.spawn.y);
    this.spawnPoint = { ...this.level.spawn };
    this.log = [];
    this.frame = 0; this.deaths = 0; this.deathT = 0; this.done = false;
    this.prevKeys = {};
    this.verbose = opts.verbose;
    const sim = this;
    this.game = {
      level: this.level, player: this.player,
      drone: { cheer() {} },
      dialogue: { blocking: false, playInline(l) { sim.note('say ' + l.map((x) => x[2]).join(' / ')); }, play() {} },
      playDialogue(id) { sim.note('dialogue ' + id); },
      setObjective(t) { sim.note('objective ' + t); },
      isNear() { return false; },
      showSign(t) { sim.note('sign ' + t); },
      openPuzzle(term) { sim.note('puzzle ' + term.puzzle.type + ' (auto-solved)'); term.onSolved(sim.game); },
      collectShard(s) { sim.note('shard #' + s.index); },
      completeLevel() { sim.done = true; sim.note('LEVEL COMPLETE'); },
      activateCheckpoint(cp) {
        for (const e of sim.level.entities) if (e.type === 'checkpoint' && e !== cp) e.current = false;
        cp.lit = true; cp.current = true; cp.litT = 0;
        sim.spawnPoint = cp.spawnPoint;
        for (const e of sim.level.entities) if (e.type === 'crate') e.snapshot = { x: e.x, y: e.y };
        sim.note(`checkpoint ${cp.tx},${cp.ty}`);
      },
    };
    this.G.game = this.game;
  }
  note(m) { this.log.push(`[${(this.frame / 60).toFixed(2)}s] ${m}`); if (this.verbose) console.log(this.log[this.log.length - 1]); }
  get p() { return this.player; }
  get tx() { return (this.p.x + this.p.w / 2) / T; }
  get ty() { return (this.p.y + this.p.h) / T; } // feet, in tiles (standing on row r => ty == r+1)
  pos() { return `(${this.tx.toFixed(2)}, ${(this.ty - 1).toFixed(2)})`; }

  /** keys: {l,r,d,j,a} held this frame */
  tick(keys = {}) {
    const dt = 1 / 60;
    const L = this.level, p = this.player, game = this.game;
    const pressed = (k) => keys[k] && !this.prevKeys[k];
    this.frame++;
    L.time += dt;
    L._dyn = L.dynamicSolids();
    for (const e of L.entities) if (e.type === 'mplatform' || e.type === 'saw') e.update(dt, game);
    L._dyn = L.dynamicSolids();
    const ctl = { left: !!keys.l, right: !!keys.r, down: !!keys.d, jumpPressed: pressed('j'), jumpHeld: !!keys.j };
    const wasDead = p.dead;
    p.update(dt, L, ctl);
    for (const e of L.entities) if (e.type !== 'mplatform' && e.type !== 'saw') e.update(dt, game);
    L.resolveSignals();
    L.updateCrumbles(dt, [p, ...L.entities.filter((e) => e.type === 'crate')]);
    if (pressed('a') && !p.dead) {
      const f = this.findFocus();
      if (f && f.can) { f.e.interact(game); this.note(`interact ${f.e.type} ${f.e.tx},${f.e.ty}`); } else this.note('interact: nothing in reach at ' + this.pos());
    }
    if (p.dead) {
      if (!wasDead) { this.deaths++; this.note(`DEATH (${p.deathCause}) at ${this.pos()}`); }
      this.deathT += dt;
      if (this.deathT >= 1.0) {
        this.deathT = 0;
        const cp = p.carryPart;
        p.reset(this.spawnPoint.x, this.spawnPoint.y);
        if (cp && !cp.delivered) { cp.taken = false; cp.x = cp.home.x; cp.y = cp.home.y; }
        for (const e of L.entities) if (e.type === 'crate') e.restore();
      }
    }
    this.prevKeys = keys;
  }
  findFocus() {
    const p = this.player; let best = null, bd = 1e9;
    for (const e of this.level.entities) {
      if (!e.interactable) continue;
      const dx = Math.max(e.x - (p.x + p.w), p.x - (e.x + e.w), 0);
      const dy = Math.max(e.y - (p.y + p.h), p.y - (e.y + e.h), 0);
      if (dx > 40 || dy > 16) continue;
      const d = Math.abs(e.cx - p.cx);
      const can = !e.canInteract || e.canInteract(this.game);
      if (!can) continue;
      if (d < bd) { bd = d; best = { e, can }; }
    }
    return best;
  }
  teleport(tx, ty) { // stand at tile (tx, ty)
    this.p.reset(tx * T + (T - this.p.w) / 2, (ty + 1) * T - this.p.h);
    this.p.state = 'idle';
  }

  // ---------------- bot DSL ----------------
  /** Run a list of steps. Each step: [name, ...args]. Throws on timeout. Returns this. */
  run(steps, label = '') {
    for (const st of steps) {
      const [name, ...a] = st;
      const before = this.deaths;
      const f0 = this.frame;
      this['_' + name](...a);
      if (this.verbose) console.log(`  ${name}(${a.map((x) => typeof x === 'function' ? 'fn' : (x && typeof x === 'object' && x.level) ? x.type : JSON.stringify(x)).join(',')}) -> ${this.pos()} ground=${this.p.onGround} f=${this.frame - f0}`);
      if (this.deaths > before && !st.allowDeath) { this.note(`!! died during ${name}(${JSON.stringify(a)})`); }
    }
    return this;
  }
  _wait(n) { for (let i = 0; i < n; i++) this.tick({}); }
  _hold(keys, n) { for (let i = 0; i < n; i++) this.tick(keys); }
  _until(fn, keys = {}, max = 1200) { let i = 0; while (!fn(this)) { this.tick(typeof keys === 'function' ? keys(this) : keys); if (++i > max) throw new Error('until timeout at ' + this.pos()); } }
  _land(keys = {}, max = 300) { this._hold(keys, 2); this._until((s) => s.p.onGround || s.p.dead, keys, max); }
  /** walk to tile column x centre (on ground), stop */
  _walk(x, max = 900) {
    let i = 0;
    for (;;) {
      const d = x + 0.5 - this.tx;
      if (Math.abs(d) < 0.12 && Math.abs(this.p.vx) < 30) break;
      const k = Math.abs(d) < 0.12 ? {} : d > 0 ? { r: 1 } : { l: 1 };
      // brake early
      if (Math.abs(d) < Math.abs(this.p.vx) * Math.abs(this.p.vx) / (2 * 2800) / T + 0.05 && Math.sign(this.p.vx) === Math.sign(d)) this.tick({}); else this.tick(k);
      if (++i > max) throw new Error('walk timeout at ' + this.pos() + ' target ' + x);
      if (this.p.dead) return;
    }
  }
  /** run in dir until tile x reached (no stop) then jump holding `hold` frames, keep dir held `air` frames (or till landing) */
  _runjump(x, dir, hold = 30, air = 999, then = null) {
    const k = dir > 0 ? { r: 1 } : { l: 1 };
    let i = 0;
    while (dir > 0 ? this.tx < x : this.tx > x) { this.tick(k); if (++i > 900) throw new Error('runjump approach timeout ' + this.pos()); if (this.p.dead) return; }
    this._jump(dir, hold, air);
  }
  /** jump from current state: jump held `hold` frames; dir held for `air` frames; then wait till landing */
  _jump(dir, hold = 30, air = 999) {
    const k = (f) => ({ ...(f < air ? (dir > 0 ? { r: 1 } : dir < 0 ? { l: 1 } : {}) : {}), ...(f < hold ? { j: 1 } : {}) });
    let f = 0;
    this.tick({}); // ensure fresh press edge
    do { this.tick(k(f)); f++; } while (f < 3 || (!this.p.onGround && !this.p.dead && f < 400));
  }
  /** wall-jump climb: zig-zag until feet above row y (tile) and grounded or reached; startDir = first jump direction */
  _wallclimb(targetRow, firstDir, max = 900, exitDir = 0) {
    let dir = firstDir, i = 0, held = true, cool = 0;
    this.tick({});
    // initial jump from ground
    for (let f = 0; f < 4; f++) this.tick({ j: 1, ...(dir > 0 ? { r: 1 } : { l: 1 }) });
    while (!(this.p.onGround && this.ty - 1 <= targetRow)) {
      if (this.p.dead) return;
      if (exitDir && this.ty - 1 <= targetRow + 0.3) dir = exitDir;
      const k = dir > 0 ? { r: 1 } : { l: 1 };
      const wall = this.p.wallDir || (cool <= 0 ? this.p.nearWall(this.level) : 0);
      if (!this.p.onGround && wall && wall === dir && this.p.vy > -120 && cool <= 0) {
        // press jump fresh
        this.tick({ ...k }); dir = -dir; cool = 10;
        for (let f = 0; f < 14; f++) this.tick({ j: 1, ...(dir > 0 ? { r: 1 } : { l: 1 }) });
      } else { this.tick({ ...k, j: 1 }); cool--; }
      if (++i > max) throw new Error('wallclimb timeout at ' + this.pos());
    }
  }
  /** wait until laser at tile column x stays off (not 'on') for the next `secs` seconds (from now+delay) */
  _laserGap(x, secs = 0.7, delay = 0) {
    const lz = this.level.entities.find((e) => e.type === 'laser' && e.tx === x);
    if (!lz) throw new Error('no laser at x=' + x);
    const ok = () => { for (let t = delay; t <= delay + secs; t += 1 / 60) if (lz.computePhase(this.level.time + t) === 'on') return false; return true; };
    this._until(ok, {}, 600);
  }
  _act() { this.tick({}); this.tick({ a: 1 }); this.tick({}); }
  _check(fn, msg) { const r = fn(this); if (!r) this.note('CHECK FAILED: ' + msg + ' at ' + this.pos()); else this.note('ok: ' + msg); }
  _tp(x, y) { this.teleport(x, y); this.tick({}); }
  _say(m) { this.note('— ' + m); }
  report() {
    console.log(this.log.join('\n'));
    console.log(`frames=${this.frame} (${(this.frame / 60).toFixed(1)}s) deaths=${this.deaths} done=${this.done} pos=${this.pos()}`);
  }
}
module.exports = { Sim };
