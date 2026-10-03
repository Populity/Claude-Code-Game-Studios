/** Chapter 2 mechanics (docs/chapter2-spec.md §2) against the real engine code. */
const { makeEngine, makeWorld } = require('../lib/engine');
const { test, assert, report } = require('../lib/harness');
const { G } = makeEngine();
G.CONFIG.health.player = 1; // legacy instant-kill assertions: 1 HP (docs/companions-spec.md §1)
const T = 32;
const D = G.CONFIG.dash;
const lvl = (map, extra = {}) => Object.assign({ id: 'unit', biome: 'ruins', title: 'u', map, entities: [] }, extra);
const FLAT = ['....................', '....................', '....................', '....................', '.P..................', '####################'];
const settle = (g) => { g.run(30); return g; };

test('dash unavailable without ability; available via def.abilities', () => {
  const g = settle(makeWorld(G, lvl(FLAT)));
  const x0 = g.player.x; g.tick({ dashPressed: true }); g.run(5);
  assert(!g.player.canDash && g.player.x === x0, 'dashed without ability');
  const h = settle(makeWorld(G, lvl(FLAT, { abilities: ['dash'] })));
  h.tick({ dashPressed: true });
  assert(h.player.canDash && h.player.state === 'dash', 'no dash state');
  assert.eq(h.player.dashCharges, 0, 'charge spent');
});
test('dash: speed, duration, gravity off, end keep, refill on landing', () => {
  const g = settle(makeWorld(G, lvl(FLAT, { abilities: ['dash'] })));
  g.tick({ jumpPressed: true, jumpHeld: true }); g.run(10, { jumpHeld: true });
  g.tick({ dashPressed: true, right: true });
  assert.near(g.player.vx, D.speed, 1, 'dash vx'); assert.eq(g.player.vy, 0, 'no gravity');
  const y = g.player.y; g.run(Math.floor(D.time * 60) - 2, { right: true });
  assert.near(g.player.y, y, 0.01, 'height kept during dash');
  g.run(3, {});
  assert(g.player.state !== 'dash', 'dash ended');
  assert(Math.abs(g.player.vx) <= D.speed * D.endKeep + 1, 'velocity reduced by endKeep');
  assert.eq(g.player.dashCharges, 0, 'no refill in the air');
  g.run(90);
  assert(g.player.onGround && g.player.dashCharges === D.charges, 'refilled on landing');
});
test('dash: diagonal up-right is normalised', () => {
  const g = settle(makeWorld(G, lvl(FLAT, { abilities: ['dash'] })));
  g.tick({ dashPressed: true, right: true, up: true });
  assert.near(g.player.dashDir.x, Math.SQRT1_2, 1e-6, 'dir x'); assert.near(g.player.dashDir.y, -Math.SQRT1_2, 1e-6, 'dir y');
});
test('trigger grant:dash unlocks the ability', () => {
  const g = settle(makeWorld(G, lvl(FLAT, { triggers: [{ x: 3, y: 3, w: 1, h: 2, grant: 'dash' }] })));
  g.run(40, { right: true });
  assert(g.level.hasAbility('dash') && g.player.canDash, 'not granted');
});
test('dashcrystal refills a spent dash and regrows', () => {
  const g = settle(makeWorld(G, lvl(FLAT, { abilities: ['dash'], entities: [{ type: 'dashcrystal', x: 6, y: 2 }] })));
  const c = g.level.entities.find((e) => e.type === 'dashcrystal');
  g.player.dashCharges = 0; g.player.x = c.cx - g.player.w / 2; g.player.y = c.cy - 10; g.player.onGround = false;
  c.update(1 / 60, g);
  assert(!c.ready && g.player.dashCharges === 1, 'crystal not consumed');
  for (let i = 0; i < 160; i++) c.update(1 / 60, g);
  assert(c.ready, 'crystal did not regrow');
});
test('ice: lower decel → longer stop, and no wall slide on ice walls', () => {
  const stop = (floor) => { const g = makeWorld(G, lvl(['....................', '....................', '.P..................', floor])); g.run(20); g.run(40, { right: true }); const x = g.player.x; g.run(60); return g.player.x - x; };
  assert(stop('IIIIIIIIIIIIIIIIIIII') > stop('####################') * 3, 'ice not slick');
  const g = makeWorld(G, lvl(['.....I....', '.....I....', '.....I....', '.P...I....', '##########']));
  g.run(30, { right: true }); g.tick({ right: true, jumpPressed: true, jumpHeld: true }); g.run(6, { right: true, jumpHeld: true });
  assert(!G.Physics.wallAt(g.player, 1, g.level), 'ice counted as a wall');
});
test('conveyor carries a standing player at conveyorSpeed', () => {
  const g = makeWorld(G, lvl(['....................', '....................', '.P..................', '}}}}}}}}}}}}}}}}}}}}']));
  g.run(20); const x = g.player.x; g.run(60);
  assert.near(g.player.x - x, G.CONFIG.surface.conveyorSpeed, 4, 'belt distance in 1 s');
});
test('momentum: jumping off a moving platform adds its velocity', () => {
  const g = makeWorld(G, lvl(['..............................', '..............................', '..............................', '..............................', '..............................', '..............................', '..P...........................', '..............................', '##############################'], { entities: [{ type: 'mplatform', x: 1, y: 7, w: 3, path: [[20, 7]], speed: 4, pause: 0 }] }));
  g.run(30);
  assert(g.player.groundEntity && g.player.groundEntity.type === 'mplatform', 'not riding');
  g.tick({ jumpPressed: true, jumpHeld: true });
  assert.near(g.player.vx, 4 * T, 3, 'inherited vx');
});
test('crate slides a little after a push (friction) and stops', () => {
  const g = makeWorld(G, lvl(['....................', '....................', '.P..B...............', '####################']));
  g.run(20); g.run(40, { right: true });
  const c = g.level.crates[0]; g.run(1); const x = c.x; g.run(30);
  assert(c.x > x && c.x - x < 12 && c.vx === 0, 'slide ' + (c.x - x));
});
test('wind: up-current stronger than gravity lifts, sideways pushes', () => {
  const g = makeWorld(G, lvl(['..........', '..........', '..........', '..........', '.P........', '##########'], { entities: [{ type: 'wind', x: 0, y: 0, w: 10, h: 5, dir: 'up', strength: 3000 }] }));
  const y = g.player.y; g.run(30);
  assert(g.player.y < y - 20, 'not lifted');
  const h = makeWorld(G, lvl(['..........', '..........', '.P........', '##########'], { entities: [{ type: 'wind', x: 0, y: 0, w: 10, h: 3, dir: 'right' }] }));
  const x = h.player.x; h.run(60);
  assert(h.player.x > x + 30, 'not pushed');
});
test('anchor: attach, pendulum swings through the bottom, release keeps speed', () => {
  const g = makeWorld(G, lvl(['....................', '....................', '....................', '....................', '....................', '....................', '....................', '....................', '....................', '....................', '....................', '.P..................', '####################'], { entities: [{ type: 'anchor', x: 8, y: 2, len: 6 }] }));
  const a = g.level.anchors[0];
  g.player.x = a.cx - 120 - g.player.w / 2; g.player.y = a.cy - 10; g.player.vy = 0; g.player.onGround = false;
  g.tick({ actionPressed: true });
  assert(g.player.rope && a.attached && g.player.state === 'swing', 'not attached');
  let maxX = -1e9; let minA = 0;
  for (let i = 0; i < 40; i++) { g.tick({}); maxX = Math.max(maxX, g.player.cx); minA = Math.min(minA, Math.abs(g.player.rope ? g.player.rope.angle : 9)); }
  assert(maxX > a.cx, 'did not swing past the bottom');
  const r = g.player.rope; const dist = Math.hypot(g.player.cx - r.ax, g.player.y + G.CONFIG.swing.ropeOffsetY - r.ay);
  assert.near(dist, r.len, 1.5, 'rope length kept');
  const v = Math.hypot(g.player.vx, g.player.vy);
  g.tick({ jumpPressed: true, jumpHeld: true });
  assert(!g.player.rope && !a.attached, 'not released');
  assert(Math.hypot(g.player.vx, g.player.vy) > v * 0.8, 'release lost speed');
});
test('anchor: reeling in conserves angular momentum (spins faster)', () => {
  const g = makeWorld(G, lvl(['....................', '....................', '....................', '....................', '....................', '....................', '....................', '....................', '....................', '####################'], { entities: [{ type: 'anchor', x: 8, y: 1, len: 6 }] }));
  const a = g.level.anchors[0];
  g.player.x = a.cx - g.player.w / 2; g.player.y = a.cy + 150 - G.CONFIG.swing.ropeOffsetY; g.player.vx = 200; g.player.onGround = false;
  g.tick({ actionPressed: true });
  const r = g.player.rope; const L0 = r.len, w0 = Math.abs(r.omega);
  g.tick({ upPressed: true }); g.run(12);
  assert(r.len < L0 - 20, 'not reeled');
  assert(Math.abs(r.omega) > w0, 'omega did not increase');
});
test('fallplat: shakes, falls, respawns', () => {
  const F = G.CONFIG.fallplat;
  const g = makeWorld(G, lvl(['..........', '..........', '.P........', '..........', '..........', '..........', '..........', '..........', '..........', '##########'], { entities: [{ type: 'fallplat', x: 1, y: 4, w: 2 }] }));
  const f = g.level.entities.find((e) => e.type === 'fallplat');
  g.run(30);
  assert(f.state === 'shaking', 'not shaking: ' + f.state);
  g.run(Math.ceil(F.shake * 60) + 2);
  assert(f.state === 'falling', 'not falling');
  g.run(Math.ceil((F.fallTime + F.respawn) * 60) + 5);
  assert(f.state === 'idle' && f.y === f.home.y, 'not respawned: ' + f.state);
});
test('sentinel: sees, alerts, chases and kills; laser stuns it', () => {
  const S = G.CONFIG.sentinel;
  const g = makeWorld(G, lvl(['....................', '....................', '....................', '....................', '.P..................', '####################'], { entities: [{ type: 'sentinel', x: 6, y: 3 }] }));
  const s = g.level.entities.find((e) => e.type === 'sentinel');
  g.run(2);
  assert.eq(s.state, 'alert', 'no alert');
  let n = 0; while (!g.player.dead && n++ < 300) g.tick({});
  assert(g.player.dead && g.player.deathCause === 'sentinel', 'not killed by sentinel');
  const h = makeWorld(G, lvl(['.........#..........', '....................', '....................', '....................', '.P..................', '####################'], { entities: [{ type: 'sentinel', x: 9, y: 3 }, { type: 'laser', x: 9, y: 0, dir: 'down' }] }));
  h.run(1);
  const s2 = h.level.entities.find((e) => e.type === 'sentinel');
  assert.eq(s2.state, 'stunned', 'laser did not stun');
  assert(s2.stunT > 0 && s2.stunT <= S.stunTime, 'stunT');
});
test('sentinel: no line of sight through walls', () => {
  const g = makeWorld(G, lvl(['.....#..............', '.....#..............', '.....#..............', '.....#..............', '.P...#..............', '####################'], { entities: [{ type: 'sentinel', x: 8, y: 3 }] }));
  g.run(30);
  assert.eq(g.level.entities.find((e) => e.type === 'sentinel').state, 'patrol', 'saw through wall');
});
test('npc: talk plays dialogue, then _again if it exists', () => {
  const g = makeWorld(G, lvl(FLAT, { entities: [{ type: 'npc', x: 3, y: 4, who: 'echo', dialogue: 'x_meet' }] }));
  const played = []; g.playDialogue = (id) => played.push(id);
  const n = g.level.entities.find((e) => e.type === 'npc');
  G.Script = { x_meet: { lines: [] }, x_meet_again: { lines: [] } };
  n.interact(g); n.interact(g);
  assert.eq(played.join(','), 'x_meet,x_meet_again', 'dialogue ids');
});
report('chapter2');
