/** Signal graph: ALL (default) / ANY / invert, exit locking, plates, sockets, terminals. */
const { makeEngine, makeWorld } = require('../lib/engine');
const { test, assert, report } = require('../lib/harness');
const { G } = makeEngine();
const map = ['....................', '....................', '....................', '.P..................', '####################'];
const mk = (entities) => makeWorld(G, { id: 'sig', biome: 'ship', title: 's', map, entities });
const levers = (n, tgt) => Array.from({ length: n }, (_, i) => ({ type: 'lever', x: 10 + i, y: 3, targets: [tgt] }));
const set = (g, vals) => g.level.entities.filter((e) => e.type === 'lever').forEach((l, i) => { l.active = !!vals[i]; });

test('ALL (default): door powered only when every source active', () => {
  const g = mk([...levers(3, 'd'), { type: 'door', id: 'd', x: 18, y: 1 }]);
  const d = g.level.byId.d;
  for (let m = 0; m < 8; m++) { set(g, [m & 1, m & 2, m & 4]); g.level.resolveSignals(); assert.eq(d.powered, m === 7, 'mask ' + m); }
});
test("ANY: powered when at least one source active", () => {
  const g = mk([...levers(3, 'd'), { type: 'door', id: 'd', x: 18, y: 1, need: 'any' }]);
  const d = g.level.byId.d;
  for (let m = 0; m < 8; m++) { set(g, [m & 1, m & 2, m & 4]); g.level.resolveSignals(); assert.eq(d.powered, m !== 0, 'mask ' + m); }
});
test('invert: ALL inverted', () => {
  const g = mk([...levers(2, 'd'), { type: 'door', id: 'd', x: 18, y: 1, invert: true }]);
  const d = g.level.byId.d;
  for (let m = 0; m < 4; m++) { set(g, [m & 1, m & 2]); g.level.resolveSignals(); assert.eq(d.powered, m !== 3, 'mask ' + m); }
});
test('invert + ANY', () => {
  const g = mk([...levers(2, 'd'), { type: 'door', id: 'd', x: 18, y: 1, invert: true, need: 'any' }]);
  const d = g.level.byId.d;
  for (let m = 0; m < 4; m++) { set(g, [m & 1, m & 2]); g.level.resolveSignals(); assert.eq(d.powered, m === 0, 'mask ' + m); }
});
test('one source fans out to multiple targets (targets[] and legacy target)', () => {
  const g = mk([{ type: 'lever', x: 3, y: 3, targets: ['a', 'b'] }, { type: 'lever', x: 4, y: 3, target: 'c' }, { type: 'door', id: 'a', x: 15, y: 1 }, { type: 'bridge', id: 'b', x: 6, y: 2 }, { type: 'door', id: 'c', x: 17, y: 1 }]);
  const [l1, l2] = g.level.entities.filter((e) => e.type === 'lever');
  l1.active = true; g.level.resolveSignals();
  assert(g.level.byId.a.powered && g.level.byId.b.powered && !g.level.byId.c.powered);
  l2.active = true; g.level.resolveSignals(); assert(g.level.byId.c.powered);
});
test('exit wired to a source is locked until powered; unwired exit always open', () => {
  const g2 = makeWorld(G, { id: 'ex', biome: 'ship', title: 'e', map: ['..........', '..........', '..........', '.P......E.', '##########'], entities: [{ type: 'lever', x: 3, y: 3, targets: ['exit'] }] });
  const ex = g2.level.entities.find((e) => e.type === 'exit');
  g2.run(5); assert(ex.locked, 'should be locked');
  g2.run(200, { right: true }); assert(!g2.completed, 'completed through locked exit');
  g2.level.entities.find((e) => e.type === 'lever').active = true; g2.run(2);
  assert(!ex.locked); g2.run(60, { right: true }); g2.run(60, { left: true }); assert(g2.completed, 'exit should complete');
  const g3 = makeWorld(G, { id: 'ex2', biome: 'ship', title: 'e', map: ['..........', '..........', '..........', '.P......E.', '##########'], entities: [] });
  g3.run(200, { right: true }); assert(g3.completed, 'unwired exit');
});
test('pressure plate is active while player stands on it, and with a crate', () => {
  const g = makeWorld(G, { id: 'pl', biome: 'ship', title: 'p', map: ['..........', '..........', '..........', '.P........', '##########'], entities: [{ type: 'plate', x: 4, y: 3, targets: ['d'] }, { type: 'door', id: 'd', x: 8, y: 1 }] });
  const pl = g.level.entities.find((e) => e.type === 'plate');
  g.run(5); assert(!pl.active);
  g.run(200, { right: true }); g.run(10);
  // player is now walled by door at x8 -> walk back onto plate
  while (g.player.cx > 4.5 * 32) g.tick({ left: true }); g.run(20);
  assert(pl.active && g.level.byId.d.powered, 'plate not active under player');
  g.run(60, { left: true }); g.run(5);
  assert(!pl.active, 'plate should release');
});
test('socket accepts matching part only, then powers target', () => {
  const g = makeWorld(G, { id: 'so', biome: 'ship', title: 's', map: ['..........', '..........', '..........', '.P........', '##########'], entities: [{ type: 'part', item: 'fuse', x: 2, y: 3 }, { type: 'socket', needs: 'fuse', x: 6, y: 3, targets: ['d'] }, { type: 'door', id: 'd', x: 8, y: 1 }] });
  const part = g.level.entities.find((e) => e.type === 'part'), sock = g.level.entities.find((e) => e.type === 'socket');
  assert(!sock.canInteract(g), 'socket usable without part');
  assert(part.canInteract(g)); part.interact(g);
  assert.eq(g.player.carry, 'fuse'); assert(sock.canInteract(g));
  sock.interact(g); g.run(1);
  assert(sock.active && part.delivered && !g.player.carry && g.level.byId.d.powered);
});
test('terminal onSolved activates its targets', () => {
  const g = mk([{ type: 'terminal', x: 5, y: 3, targets: ['d'], puzzle: { type: 'code', code: '12' } }, { type: 'door', id: 'd', x: 18, y: 1 }]);
  const t = g.level.entities.find((e) => e.type === 'terminal');
  g.run(1); assert(!g.level.byId.d.powered);
  t.onSolved(g); g.run(1); assert(g.level.byId.d.powered && !t.canInteract());
});
test('wired mplatform runs only when powered; laser disabled when powered', () => {
  const g = mk([{ type: 'lever', x: 3, y: 3, targets: ['m', 'lz'] }, { type: 'mplatform', id: 'm', x: 6, y: 2, path: [[6, 2], [12, 2]] }, { type: 'laser', id: 'lz', x: 15, y: 0, dir: 'down' }]);
  const m = g.level.byId.m, lz = g.level.byId.lz; const x0 = m.x;
  g.run(60); assert.eq(m.x, x0, 'moved while unpowered'); assert.eq(lz.phase, 'on');
  g.level.entities.find((e) => e.type === 'lever').active = true; g.run(60);
  assert(m.x > x0, 'did not move when powered'); assert.eq(lz.phase, 'disabled');
});
report('signals');
