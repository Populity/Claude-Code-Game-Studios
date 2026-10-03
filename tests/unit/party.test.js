#!/usr/bin/env node
/**
 * Health, pickups, sudden hazards and party (docs/companions-spec.md §1–4) on ?level=sandbox3.
 */
const { makeEngine, makeWorld } = require('../lib/engine');
const { test, assert, report } = require('../lib/harness');
const { G, load } = makeEngine({ extra: ['world/drone.js', 'world/party.js'] });
load('levels/sandbox3.js');
const T = G.TILE, DT = 1 / 60, FLOOR = 12 * T;
G.save = { party: ['lum'] }; G.persist = () => {};

function world() {
  const g = makeWorld(G, G.levels.sandbox3);
  g.drone = new G.Drone(g.level, g.player);
  g.dialogue = { blocking: false, active: null, play(id, cb) { if (cb) cb(); }, playInline() {} };
  g.completeT = -1;
  g.playDialogue = (id, cb) => { if (cb) cb(); };
  g.party = new G.Party(g, {});
  g.actors = () => g.party.actors();
  g.recruit = (npc) => { npc.gone = true; g.party.addRex(npc.cx, npc.y + npc.h); };
  G.game = g;
  const base = g.tick;
  g.tick = (ctl = {}) => { base(g.controlled !== g.player ? {} : ctl); g.drone.update(DT, g); g.party.update(DT, ctl); };
  return g;
}
const place = (a, x, feet = FLOOR) => { a.x = x - a.w / 2; a.y = feet - a.h; a.vx = 0; a.vy = 0; a.onGround = true; };
const byType = (g, t, k) => g.level.entities.find((e) => e.type === t && (!k || e.kind === k));

test('hurt: damage, i-frames, knockback; instant causes kill', () => {
  const g = world(), p = g.player; place(p, 3 * T); g.run(2);
  assert.eq(p.hp, G.CONFIG.health.player, 'full HP');
  assert(p.hurt(2, 'laser', p.cx + 10), 'hit lands');
  assert.eq(p.hp, 4); assert(p.vx < 0, 'knocked away from source'); assert(p.invulnT > 0);
  assert(!p.hurt(2, 'laser'), 'i-frames block'); assert.eq(p.hp, 4);
  p.invulnT = 0; p.hurt(Infinity, 'acid'); assert(p.dead && p.deathCause === 'acid');
});
test('spikes damage + bounce instead of killing', () => {
  const g = world(), p = g.player; place(p, 50 * T, 13 * T); p.y -= 10; p.onGround = false;
  g.run(3);
  assert(!p.dead, 'alive'); assert(p.hp < G.CONFIG.health.player, 'hurt'); assert(p.vy < 0, 'bounced up');
});
test('pickups: medkit stays at full HP, heals when hurt; heart, shield, boots', () => {
  const g = world(), p = g.player, mk = byType(g, 'pickup', 'medkit');
  place(p, mk.cx); g.run(2); assert(!mk.taken, 'medkit stays at full HP');
  p.hp = 2; g.run(2); assert(mk.taken && p.hp === 5, 'medkit +3');
  assert(G.applyPickup(p, 'heart') && p.maxHp === 7);
  G.applyPickup(p, 'shield'); p.invulnT = 0; p.hurt(3, 'saw'); assert.eq(p.buffs.shield.hits, 1, 'shield absorbs'); assert.eq(p.hp, 6);
  G.applyPickup(p, 'boots'); place(p, 3 * T); g.tick({ jumpPressed: true, jumpHeld: true });
  for (let i = 0; i < 20; i++) g.tick({ jumpHeld: true });
  const vy0 = p.vy; g.tick({ jumpPressed: true, jumpHeld: true }); assert(p.vy < vy0 - 300 && p.airJumpUsed, 'double jump');
});
test('glider slows the fall; jetpack lifts and runs dry', () => {
  const g = world(), p = g.player; place(p, 3 * T, 6 * T); p.onGround = false;
  G.applyPickup(p, 'glider'); for (let i = 0; i < 40; i++) g.tick({ jumpHeld: true });
  assert(p.vy <= G.CONFIG.pickups.glider.fall + 1 && p.gliding, 'glide fall cap');
  const g2 = world(), q = g2.player; place(q, 3 * T, 8 * T); q.onGround = false; G.applyPickup(q, 'jetpack');
  for (let i = 0; i < 30; i++) g2.tick({ jumpHeld: true });
  assert(q.vy < 0 && q.jetting, 'thrust up');
  for (let i = 0; i < 200; i++) g2.tick({ jumpHeld: true });
  assert(!q.buffs.jetpack, 'fuel spent');
});
test('stalactite telegraphs >= 0.35 s, then falls and hurts', () => {
  const g = world(), p = g.player, s = byType(g, 'stalactite'); place(p, s.cx);
  let n = 0; while (s.state !== 'fall' && n++ < 120) { g.tick(); place(p, s.cx); }
  assert(n * DT >= 0.35, 'telegraph ' + n * DT);
  n = 0; while (p.hp === G.CONFIG.health.player && n++ < 120) { g.tick(); }
  assert.eq(p.hp, G.CONFIG.health.player - 3, 'stalactite 3 dmg');
});
test('mine: beep then 4 dmg; jumping away in time avoids it', () => {
  const g = world(), p = g.player, m = byType(g, 'mine'); place(p, m.cx); g.run(3);
  assert.eq(m.state, 'beep'); g.run(40); assert.eq(p.hp, G.CONFIG.health.player - 4);
  const g2 = world(), q = g2.player, m2 = byType(g2, 'mine'); place(q, m2.cx); g2.run(2);
  for (let i = 0; i < 30; i++) g2.tick({ left: true, jumpPressed: i === 0, jumpHeld: true });
  assert.eq(q.hp, G.CONFIG.health.player, 'escaped');
});
test('geyser: warns, then 1 dmg + launch', () => {
  const g = world(), p = g.player, ge = byType(g, 'geyser'); place(p, ge.cx);
  let warned = false, n = 0; g.tick(); while (ge.phase !== 'idle' && n++ < 400) g.tick(); p.hp = p.maxHp; p.invulnT = 0; n = 0; while (ge.phase !== 'on' && n++ < 400) { g.tick(); place(p, ge.cx); if (ge.phase === 'warn') warned = true; }
  g.tick(); assert(warned, 'warn first'); assert(p.vy < -600, 'launched'); assert.eq(p.hp, G.CONFIG.health.player - 1);
});
test('collapse: drops once, hurts 3, becomes solid floor', () => {
  const g = world(), p = g.player, c = byType(g, 'collapse'); place(p, c.cx);
  for (let i = 0; i < 200 && c.state !== 'landed'; i++) g.tick();
  assert.eq(c.state, 'landed'); assert(c.isSolid()); assert(!G.overlap(p, c), 'never inside the block');
  assert.eq(p.hp, G.CONFIG.health.player - 3);
});
test('recruit Rex, swap cycles Mira→ЛЮМ→Рекс, blocked in dialogue', () => {
  const g = world(), npc = byType(g, 'npc'); npc.interact(g);
  assert(g.party.rex && npc.gone, 'Rex joined');
  assert(g.party.swap() && g.controlled === g.drone && g.drone.state === 'controlled');
  assert(g.party.swap() && g.controlled === g.party.rex);
  assert(g.party.swap() && g.controlled === g.player);
  g.dialogue.blocking = true; assert(!g.party.swap(), 'blocked'); g.dialogue.blocking = false;
});
test('ЛЮМ controlled flies 8-way at ~220 px/s; pulse stuns a sentinel', () => {
  const g = world(), d = g.drone, s = byType(g, 'sentinel');
  g.party.setControlled(d); d.x = 20 * T; d.y = 6 * T;
  for (let i = 0; i < 60; i++) g.tick({ right: true });
  assert.near(d.vx, G.CONFIG.party.lum.speed, 5, 'speed'); assert.eq(g.player.vx, 0, 'Mira stands still');
  d.x = s.cx; d.y = s.cy - 40; g.party.help(); assert.eq(s.state, 'stunned');
});
test('Рекс throws Mira ~9 tiles; grabs + throws a sentinel (destroyed)', () => {
  const g = world(); g.party.addRex(0, 0); const r = g.party.rex, p = g.player;
  place(p, 3 * T); place(r, 3 * T + 20); g.run(2); p.facing = 1;
  const x0 = p.cx; g.party.help();
  let n = 0; do { g.tick(); } while (!p.onGround && n++ < 200);
  assert((p.cx - x0) / T > 7.5, 'flew ' + ((p.cx - x0) / T).toFixed(1) + ' tiles');
  const s = byType(g, 'sentinel'); place(r, s.cx - 20, s.y + s.h + 20); r.facing = 1; place(p, 3 * T);
  g.party.setControlled(r); r.helpCd = 0; g.party.help();
  assert.eq(s.state, 'thrown'); for (let i = 0; i < 150 && !s.destroyed; i++) g.tick(); assert(s.destroyed, 'destroyed on impact');
});
test('companion goes down at 0 HP, revives at 50% after 10 s; AI teleports when far', () => {
  const g = world(); g.party.addRex(0, 0); const r = g.party.rex; place(g.player, 3 * T); place(r, 5 * T);
  g.party.setControlled(r); r.hurt(Infinity, 'acid');
  assert.eq(r.state, 'down'); assert(g.controlled === g.player, 'control back to Mira');
  g.run(Math.ceil(G.CONFIG.party.downTime / DT) + 2);
  assert.eq(r.hp, Math.ceil(r.maxHp * 0.5)); assert(r.state !== 'down');
  place(r, 60 * T); g.run(2); assert(Math.abs(r.cx - g.player.cx) < 3 * T, 'teleported');
});
report('party');
