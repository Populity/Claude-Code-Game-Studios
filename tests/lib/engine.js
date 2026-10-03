/** Load the real TESSERA engine source into a node vm context (no browser). */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', '..', 'src', 'js');
function makeEngine(opts = {}) {
  const store = opts.storage || {};
  const ctx = { console: opts.console || console, Math, JSON, Object, Array, Set, Map, Uint8Array, String, Number, Boolean, Error, Date, Promise, RegExp };
  ctx.window = ctx;
  ctx.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  vm.createContext(ctx);
  const load = (f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  load('config.js'); load('core/util.js');
  const G = ctx.G;
  G.Audio = { play() {}, music() {}, setVolume() {}, update() {}, unlock() {} };
  G.fx = { burst() {}, dust() {}, shake() {}, update() {}, clear() {}, draw() {}, shakeOffset: () => ({ x: 0, y: 0 }) };
  G.input = { pressed: () => false, down: () => false, anyPressed: () => false, reset() {}, pointer: {}, typed: '' };
  for (const f of ['world/level.js', 'world/physics.js', 'world/entities.js', 'world/player.js', ...(opts.extra || [])]) load(f);
  return { G, ctx, load, store };
}
/** Minimal fake GameScene mirroring GameScene.tickWorld order. */
function makeWorld(G, def) {
  const L = new G.Level(def);
  const p = new G.Player(L.spawn.x, L.spawn.y);
  p.state = 'idle';
  const game = { level: L, player: p, dialogue: { blocking: false, playInline() {}, play() {} }, drone: { cheer() {} },
    playDialogue() {}, setObjective() {}, isNear: () => false, showSign() {}, openPuzzle() {}, collectShard() {}, completed: false,
    completeLevel() { this.completed = true; }, activateCheckpoint(cp) { cp.lit = true; },
  };
  game.tick = (ctl = {}, dt = 1 / 60) => {
    L.time += dt; L._dyn = L.dynamicSolids();
    for (const e of L.movers) e.update(dt, game);
    L._dyn = L.dynamicSolids();
    p.update(dt, L, Object.assign({ left: false, right: false, up: false, down: false, jumpPressed: false, jumpHeld: false, dashPressed: false, actionPressed: false, upPressed: false, downPressed: false }, ctl));
    for (const e of L.entities) if (!e.mover) e.update(dt, game);
    L.resolveSignals();
    L.updateCrumbles(dt, [p, ...L.entities.filter((e) => e.type === 'crate')]);
  };
  game.run = (n, ctl) => { for (let i = 0; i < n; i++) game.tick(typeof ctl === 'function' ? ctl(i) : ctl); };
  return game;
}
module.exports = { makeEngine, makeWorld, SRC };
