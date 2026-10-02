/** Physics / player controller unit tests against the real engine code. */
const { makeEngine, makeWorld } = require('../lib/engine');
const { test, assert, report } = require('../lib/harness');
const { G } = makeEngine();
const T = 32;
const lvl = (map, extra = {}) => Object.assign({ id: 'unit', biome: 'ship', title: 'u', map, entities: [] }, extra);
const FLAT = ['..........', '..........', '..........', '..........', '.P........', '##########'];

test('player falls and lands on solid ground', () => {
  const g = makeWorld(G, lvl(FLAT));
  g.player.y -= 40; g.run(90);
  assert(g.player.onGround, 'not on ground');
  assert.eq(g.player.y, 5 * T - G.CONFIG.player.h, 'feet not on tile top');
  assert.eq(g.player.vy, 0, 'vy after land');
});
test('player cannot walk through a solid wall', () => {
  const g = makeWorld(G, lvl(['..........', '.....#....', '.....#....', '.....#....', '.P...#....', '##########']));
  g.run(120, { right: true });
  assert.eq(g.player.x + g.player.w, 5 * T, 'player not flush with wall');
});
test('wall detection while airborne (wallDir / wallAt)', () => {
  const g = makeWorld(G, lvl(['..........', '.....#....', '.....#....', '.....#....', '.P...#....', '##########']));
  g.run(60, { right: true });
  g.tick({ right: true, jumpPressed: true, jumpHeld: true });
  g.run(6, { right: true, jumpHeld: true });
  assert(!g.player.onGround, 'should be airborne');
  assert.eq(g.player.wallDir, 1, 'wallDir');
  assert(G.Physics.wallAt(g.player, 1, g.level), 'wallAt right');
  assert(!G.Physics.wallAt(g.player, -1, g.level), 'no wall left');
});
test('wall jump pushes player away from the wall', () => {
  const g = makeWorld(G, lvl(['..........', '..........', '.....#....', '.....#....', '.....#....', '.....#....', '.P...#....', '##########']));
  g.run(60, { right: true });
  g.tick({ right: true, jumpPressed: true, jumpHeld: true });
  g.run(20, { right: true, jumpHeld: true });
  g.run(2, { right: true });
  assert(!g.player.onGround && g.player.wallDir === 1, 'should be on the wall');
  g.tick({ right: true, jumpPressed: true, jumpHeld: true });
  assert(g.player.vx < 0, 'vx should point away from wall, got ' + g.player.vx);
  assert(g.player.vy < 0, 'should be moving up');
});
test('one-way platform: jump up through it, land on top', () => {
  const g = makeWorld(G, lvl(['..........', '..........', '..........', '..====....', '..........', '..P.......', '##########']));
  g.tick({ jumpPressed: true, jumpHeld: true });
  g.run(80, { jumpHeld: true });
  assert(g.player.onGround, 'not landed');
  assert.eq(g.player.y + g.player.h, 3 * T, 'should stand on the one-way at row 3');
});
test('one-way platform: down+jump drops through', () => {
  const g = makeWorld(G, lvl(['..........', '..P.......', '..====....', '..........', '..........', '##########']));
  g.run(40);
  assert.eq(g.player.y + g.player.h, 2 * T, 'start on platform');
  g.tick({ down: true, jumpPressed: true, jumpHeld: true });
  g.run(60);
  assert.eq(g.player.y + g.player.h, 5 * T, 'should drop to floor');
});
test('one-way platform is not a wall from the side', () => {
  const g = makeWorld(G, lvl(['..........', '..........', '..........', '..........', '.P...=====', '##########']));
  g.run(90, { right: true });
  assert(g.player.x > 6 * T, 'blocked by one-way from side');
});
test('crate is pushed by a grounded player at pushSpeed', () => {
  const g = makeWorld(G, lvl(['............', '............', '............', '.P..B.......', '############']));
  const c = g.level.entities.find((e) => e.type === 'crate');
  const x0 = c.x; g.run(30);
  g.run(60, { right: true });
  assert(c.x > x0 + T, 'crate moved ' + (c.x - x0));
  assert(Math.abs(g.player.vx) <= G.CONFIG.player.pushSpeed + 1, 'player faster than pushSpeed: ' + g.player.vx);
  assert.eq(g.player.state, 'push', 'push anim state');
});
test('crate stops against a wall', () => {
  const g = makeWorld(G, lvl(['........', '........', '......#.', '.P..B.#.', '########']));
  const c = g.level.entities.find((e) => e.type === 'crate');
  g.run(200, { right: true });
  assert.eq(c.x + c.w, 6 * T, 'crate flush with wall');
});
test('crate falls with gravity and lands', () => {
  const g = makeWorld(G, lvl(['....B...', '........', '........', '.P......', '########']));
  const c = g.level.entities.find((e) => e.type === 'crate');
  g.run(60);
  assert.eq(c.y + c.h, 4 * T, 'crate on floor'); assert(c.onGround);
});
test('spikes kill the player', () => {
  const g = makeWorld(G, lvl(['........', '........', '........', '.P..^...', '########']));
  g.run(120, { right: true });
  assert(g.player.dead && g.player.deathCause === 'spikes', 'cause ' + g.player.deathCause);
});
test('acid kills the player', () => {
  const g = makeWorld(G, lvl(['........', '........', '........', '.P......', '###~~###', '########']));
  g.run(120, { right: true });
  assert(g.player.dead && g.player.deathCause === 'acid', 'cause ' + g.player.deathCause);
});
test('falling out of the map kills', () => {
  const g = makeWorld(G, lvl(['........', '........', '.P......', '##......']));
  g.run(200, { right: true });
  assert(g.player.dead && g.player.deathCause === 'fall');
});
test('crumble block shakes, disappears, and respawns', () => {
  const g = makeWorld(G, lvl(['........', '........', '.P......', '.X......', '........', '........', '########']));
  g.run(5);
  const cr = g.level.crumbleState(1, 3);
  assert(cr.state === 'shaking' || cr.state === 'gone', 'state ' + cr.state);
  g.run(Math.ceil(G.CONFIG.crumble.delay * 60) + 2);
  assert.eq(cr.state, 'gone');
  g.run(Math.ceil(G.CONFIG.crumble.respawn * 60) + 5, { right: true });
  assert.eq(cr.state, 'idle', 'respawned');
});
test('jump height ≈ v²/2g (3 tiles comfortably)', () => {
  const g = makeWorld(G, lvl(['..........', '..........', '..........', '..........', '..........', '..........', '.P........', '##########']));
  const y0 = g.player.y; let minY = y0;
  g.tick({ jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 60; i++) { g.tick({ jumpHeld: true }); minY = Math.min(minY, g.player.y); }
  const h = y0 - minY, P = G.CONFIG.player;
  assert.near(h, P.jumpVelocity ** 2 / (2 * P.gravity), 14, 'jump height');
  assert(h > 3 * T, 'cannot clear 3 tiles');
});
test('closed door is solid, opens when powered by lever', () => {
  const map = ['..........', '..........', '..........', '.P........', '##########'];
  const g = makeWorld(G, lvl(map, { entities: [{ type: 'lever', x: 2, y: 3, targets: ['d'] }, { type: 'door', id: 'd', x: 5, y: 1 }] }));
  g.run(120, { right: true });
  assert.eq(g.player.x + g.player.w, 5 * T, 'door blocks');
  const lever = g.level.entities.find((e) => e.type === 'lever');
  lever.active = true; g.run(60); g.run(60, { right: true });
  assert(g.player.x > 6 * T, 'door did not open');
});
report('physics');
