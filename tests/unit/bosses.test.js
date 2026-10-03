#!/usr/bin/env node
/**
 * Bosses (src/js/world/bosses.js, tuning src/js/config-bosses.js): for each boss, the win condition
 * is achievable through its designed "exchange", and the losing conditions (projectiles, beams,
 * shockwaves, body contact) kill. Player death resets the boss position but keeps HP/phase.
 * Runs on the real ?level=bossarena definition.
 */
const { makeEngine, makeWorld } = require('../lib/engine');
const { test, assert, report } = require('../lib/harness');
const { G, load } = makeEngine({ extra: ['config-bosses.js', 'world/bosses.js'] });
load('levels/bossarena.js');
const T = G.TILE, FLOOR = 20 * T;
const BC = G.CONFIG.bosses;
const DT = 1 / 60;

function world() {
  const g = makeWorld(G, G.levels.bossarena);
  const bosses = {};
  for (const e of g.level.entities) if (e.type === 'boss') bosses[e.kind] = e;
  return { g, p: g.player, L: g.level, ...bosses };
}
/** Teleport her, feet on the arena floor at pixel x (or at an explicit feet y). */
function place(p, x, feetY = FLOOR) { p.x = x - p.w / 2; p.y = feetY - p.h; p.vx = 0; p.vy = 0; p.onGround = true; }
/** Walk in, wait out the intro. */
function engage(w, boss, x) {
  place(w.p, x);
  w.g.run(2);
  assert.eq(boss.state, 'intro', 'boss wakes when she enters the arena');
  assert(w.p.frozen, 'player frozen during the intro');
  w.g.run(Math.ceil((BC.common.introTime + 0.1) / DT));
  assert.eq(boss.state, 'fight', 'fight after the intro');
  assert(!w.p.frozen, 'player released after the intro');
}
/** Run until pred() or n frames; `hold` re-applied each frame (keeps her pinned). */
function until(w, pred, n, hold, ctl) { for (let i = 0; i < n; i++) { if (hold) hold(); w.g.tick(typeof ctl === 'function' ? ctl(i) : ctl); if (pred()) return i + 1; } return -1; }
/** Real dash from the current position toward (dx,dy). */
function dashInto(w, dx, dy) {
  w.p.dashCharges = G.CONFIG.dash.charges; w.p.dashCooldownT = 0;
  const ctl = { dashPressed: true, right: dx > 0, left: dx < 0, up: dy < 0, down: dy > 0 };
  w.g.tick(ctl);
  for (let i = 0; i < 12; i++) w.g.tick({ right: dx > 0, left: dx < 0, up: dy < 0 });
}
function waitFight(w, boss) { until(w, () => boss.state === 'fight' || boss.state === 'dying' || boss.state === 'dead', 400); }

// ================================================================== Архивариус
function burnPillar(w, a, q) {
  // lure the boss to the other side, hide behind the pillar, bait the laser
  const side = q.cx < a.homeX ? -1 : 1;
  a.bx = q.cx - side * 9 * T;
  const px = side < 0 ? q.x - 16 : q.x + q.w + 16;
  a.atk = { name: 'laser', t: 0, n: 0 }; a.laser.stage = null;
  until(w, () => !a.atk, 600, () => place(w.p, px));
}
function strikeCore(w, a) {
  w.p.x = a.bx - 70 - w.p.w / 2; w.p.y = a.by - w.p.h / 2; w.p.vx = 0; w.p.vy = 0; w.p.onGround = false;
  dashInto(w, 1, 0);
}

test('archivist: hidden behind a pillar, the swept laser burns the pillar and spares her', () => {
  const w = world(), a = w.archivist; engage(w, a, 20 * T);
  const q = a.pillars[0];
  burnPillar(w, a, q);
  assert(!w.p.dead, 'she survives behind the pillar');
  assert.eq(q.state, 'down', 'pillar collapsed from the beam');
  assert(!a.exposed, 'shield still up with 2 pillars');
});
test('archivist: in the open, the laser kills', () => {
  const w = world(), a = w.archivist; engage(w, a, 20 * T);
  a.bx = 30 * T; a.atk = { name: 'laser', t: 0, n: 0 }; a.laser.stage = null;
  const n = until(w, () => w.p.dead, 400, () => { if (!w.p.dead) place(w.p, 20 * T); });
  assert(n > 0, 'laser should kill her standing still in the open');
  assert(n * DT >= BC.archivist.laserTelegraph[0], 'not before the telegraph ends (fair warning)');
});
test('archivist: homing orbs kill; shield kills on touch', () => {
  const w = world(), a = w.archivist; engage(w, a, 20 * T);
  a.atk = { name: 'orbs', t: 0, n: 0 };
  assert(until(w, () => w.p.dead, 900, () => { if (!w.p.dead) place(w.p, 20 * T); }) > 0, 'orbs kill');
  const w2 = world(), a2 = w2.archivist; engage(w2, a2, 20 * T);
  w2.p.x = a2.bx - 10; w2.p.y = a2.by - 20; w2.g.tick();
  assert(w2.p.dead, 'touching the shield kills');
});
test('archivist: death resets position + burnt pillars, keeps HP/phase', () => {
  const w = world(), a = w.archivist; engage(w, a, 20 * T);
  burnPillar(w, a, a.pillars[0]);
  a.hp = 2; a.phase = 1; a.bx = 12 * T;
  w.p.kill('test'); w.g.tick();
  assert.eq(a.bx, a.homeX, 'back at home'); assert.eq(a.hp, 2); assert.eq(a.phase, 1);
  assert(a.pillars[0].state !== 'down', 'pillar regrows');
  assert(!a.pool.some((e) => e.live && e.kind !== 'pillar'), 'projectiles cleared');
});
test('archivist: WIN — 3 phases × (3 pillars → shield down → dash into the core) → active', () => {
  const w = world(), a = w.archivist; engage(w, a, 20 * T);
  for (let phs = 0; phs < 3; phs++) {
    until(w, () => a.pillars.every((q) => q.state === 'up'), 200);
    for (const q of a.pillars) { burnPillar(w, a, q); assert(!w.p.dead, `alive after pillar (phase ${phs})`); }
    w.g.tick(); w.g.tick();
    assert(a.exposed, 'shield drops when all pillars are down');
    assert(a.crystals.length >= 2 && a.crystals.every((c) => c.live), 'dash-crystal path appears');
    until(w, () => Math.abs(a.by - (a.floorY - BC.archivist.exposeHoverTiles * T)) < 12, 300);
    const hp = a.hp; strikeCore(w, a);
    assert.eq(a.hp, hp - 1, `dash strike deals damage (phase ${phs})`);
    assert(!w.p.dead, 'striking the open core is safe');
    waitFight(w, a);
  }
  until(w, () => a.state === 'dead', 400);
  assert(a.active, 'destroyed boss becomes an active source');
  w.L.resolveSignals(); assert(w.L.byId.gA.powered, 'gate opens');
});
test('archivist: a non-dash touch of the open core does nothing; exposure times out', () => {
  const w = world(), a = w.archivist; engage(w, a, 20 * T);
  for (const q of a.pillars) burnPillar(w, a, q);
  w.g.tick(); w.g.tick(); assert(a.exposed);
  const hp = a.hp;
  w.p.x = a.bx - w.p.w / 2; w.p.y = a.by - 10; w.p.vx = 0; w.p.vy = 0; w.g.tick();
  assert.eq(a.hp, hp, 'no damage without the dash'); assert(!w.p.dead, 'and no death');
  until(w, () => !a.exposed, 600);
  assert(!a.exposed, 'shield returns'); until(w, () => a.pillars.every((q) => q.state === 'up'), 200);
  assert(a.pillars.every((q) => q.state === 'up'), 'pillars rebuilt after a missed window');
});

// ================================================================== Колосс Бурь
function prepColossus() {
  const w = world(), c = w.colossus; engage(w, c, 60 * T);
  return { w, c };
}
test('colossus: a lever-powered fan blows its own shell back into the vent during reload', () => {
  const { w, c } = prepColossus();
  w.L.entities.find((e) => e.type === 'lever' && e.targets.includes('fan1')).active = true;
  c.bx = c.homeX; c.facing = -1; c.patIdx = 0;
  c.atk = { name: 'salvo', t: 0, n: 0 };
  const hp = c.hp;
  const n = until(w, () => c.hp < hp || w.p.dead, 1200, () => { if (!w.p.dead) place(w.p, 50 * T + 16); });
  assert(!w.p.dead, 'she survives behind the fan');
  assert(n > 0 && c.hp === hp - 1, 'deflected shell damages it');
});
test('colossus: without the fan its shells kill her', () => {
  const { w, c } = prepColossus();
  c.atk = { name: 'salvo', t: 0, n: 0 };
  assert(until(w, () => w.p.dead, 600, () => { if (!w.p.dead) place(w.p, 58 * T); }) > 0, 'shell kills');
});
test('colossus: stomp shockwave kills a grounded player; body contact kills', () => {
  const { w, c } = prepColossus();
  c.atk = { name: 'stomp', t: 0, n: 0 };
  assert(until(w, () => w.p.dead, 600, () => { if (!w.p.dead) place(w.p, 60 * T); }) > 0, 'shockwave kills');
  const r = prepColossus();
  const b = r.c.bodyBox(); r.w.p.x = b.x + b.w / 2; r.w.p.y = b.y + b.h / 2; r.w.g.tick();
  assert(r.w.p.dead, 'touching the colossus kills');
});
test('colossus: WIN — rip the back valve during each reload (6 hits, 3 phases) → active', () => {
  const { w, c } = prepColossus();
  let guard = 0;
  while (c.alive && guard++ < 10) {
    waitFight(w, c); if (!c.alive) break;
    c.openVent();
    const v = c.ventPos();
    w.p.x = v.x - w.p.w / 2; w.p.y = v.y - w.p.h / 2; w.p.vx = 0; w.p.vy = 0;
    const hp = c.hp; w.g.tick();
    assert.eq(c.hp, hp - 1, 'valve rip deals damage'); assert(!w.p.dead, 'safe while grabbing the valve');
    assert(!c.ventOpen, 'vent shuts after the rip');
  }
  assert.eq(guard, 6, 'exactly 6 hits'); // hp 6
  until(w, () => c.state === 'dead', 400);
  assert(c.active); w.L.resolveSignals(); assert(w.L.byId.gB.powered, 'gate opens');
});
test('colossus: the closed vent is armoured (deflected shell clangs off)', () => {
  const { w, c } = prepColossus();
  const s = c.spawn('shell', { px: c.bx - 200, py: c.by, vx: 0, vy: 0, r: 13, life: 3 });
  c.ventOpen = false; const hp = c.hp; c.shellReturned(s, w.g);
  assert.eq(c.hp, hp, 'no damage when the vent is closed');
});

// ================================================================== Первый Страж
function prepWarden() { const w = world(), d = w.warden; engage(w, d, 100 * T); return { w, d }; }
/** A seeker that wanders into an active beam arm dies and drops a cell. */
function lureSeekerIntoBeam(w, d) {
  d.armState = 'on'; d.armT = 0; d.armK = 1; d.layArms();
  const a = d.arms[0];
  const sx = d.bx + Math.cos(a.ang) * Math.min(a.len, 5 * T), sy = d.by + Math.sin(a.ang) * Math.min(a.len, 5 * T);
  d.spawn('seeker', { px: sx, py: sy, vx: 0, vy: 0, r: BC.warden.seekerR, spawnT: 0, life: 999 });
  w.g.tick();
  return d.cells.find((c) => !c.hidden && !c.taken && !c.delivered);
}
test('warden: beams kill her; seekers kill her; armour kills on touch', () => {
  let { w, d } = prepWarden();
  d.armState = 'on'; d.armK = 1; d.layArms();
  const a = d.arms[0]; w.p.x = d.bx + Math.cos(a.ang) * 3 * T - 10; w.p.y = d.by + Math.sin(a.ang) * 3 * T - 20; w.g.tick();
  assert(w.p.dead, 'beam arm kills');
  ({ w, d } = prepWarden());
  d.armState = 'off'; d.armT = -99;
  d.spawn('seeker', { px: w.p.cx + 60, py: w.p.cy, vx: 0, vy: 0, r: 12, spawnT: 0, life: 999 });
  assert(until(w, () => w.p.dead, 300, () => { if (!w.p.dead) place(w.p, 100 * T); }) > 0, 'seeker kills');
  ({ w, d } = prepWarden());
  d.armState = 'off'; d.armT = -99; w.p.x = d.bx - 10; w.p.y = d.by - 20; w.g.tick();
  assert(w.p.dead, 'closed shell kills');
});
test('warden: WIN — 3 lured seekers → 3 cells → 3 sockets → core opens → dash strike → active', () => {
  const { w, d } = prepWarden();
  const sockets = d.sockets; assert.eq(sockets.length, 3, '3 cell sockets in the arena');
  for (let k = 0; k < 3; k++) {
    waitFight(w, d);
    const cell = lureSeekerIntoBeam(w, d);
    assert(cell, `seeker destroyed by the beam drops a cell (#${k + 1})`);
    w.p.dead = false;
    cell.interact(w.g); assert.eq(w.p.carry, 'cell');
    sockets[k].interact(w.g); w.g.tick();
    assert.eq(d.filled, k + 1, 'socket counted');
    assert.eq(d.hp, d.maxHp - (k + 1), 'each socket = one HP segment');
  }
  waitFight(w, d);
  until(w, () => d.exposed, 900, () => { if (!w.p.dead) place(w.p, 92 * T); });
  assert(d.exposed, 'core opens when all sockets are filled');
  w.p.dead = false; w.p.state = 'idle';
  w.p.x = d.bx - 80; w.p.y = d.by - w.p.h / 2; w.p.vx = 0; w.p.vy = 0; w.p.onGround = false;
  dashInto(w, 1, 0);
  assert(d.state === 'dying' || d.state === 'dead', 'final dash strike destroys it');
  until(w, () => d.state === 'dead', 400);
  assert(d.active); w.L.resolveSignals(); assert(w.L.byId.gC.powered, 'gate opens');
});
test('warden: no surplus cells (drops only while sockets still need one)', () => {
  const { w, d } = prepWarden();
  for (let k = 0; k < 5; k++) lureSeekerIntoBeam(w, d);
  assert.eq(d.cells.filter((c) => !c.hidden).length, 3, 'at most one cell per empty socket');
});

report('bosses');
