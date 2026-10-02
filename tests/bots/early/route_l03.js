const { Sim } = require('./sim');
const s = new Sim('l03', { verbose: process.argv.includes('-v') });
const T = 32;
const plats = s.level.entities.filter((e) => e.type === 'mplatform');
const saws = s.level.entities.filter((e) => e.type === 'saw');
const at = (e, x, y) => Math.abs(e.x - x * T) < 2 && Math.abs(e.y - y * T) < 2;
// run toward dir and jump over the saw when it is close ahead
s._jumpOver = function (saw, dir, hold = 22, air = 40) {
  this._until((s) => dir * (saw.x / T - s.tx) < 1.9, dir > 0 ? { r: 1 } : { l: 1 }, 600);
  this._jump(dir, hold, air);
};
s._transfer = function () {
  for (let tries = 0; tries < 8; tries++) {
    this._until(() => at(plats[4], 167, 7) && plats[4].waitT > 0);
    this._until(() => !(plats[4].waitT > 0.05) || (plats[5].y <= 10 * T && plats[5].y >= 5 * T));
    if (plats[4].waitT > 0.05) { const up = plats[5].y < 7 * T; this._jump(1, up ? 30 : 12, up ? 26 : 20); this.note('transfer jump M6 row ' + (plats[5].y / T).toFixed(1) + ' -> ' + this.pos() + ' on M6=' + (this.p.groundEntity === plats[5])); return; }
    this._until(() => at(plats[4], 161, 7));
  }
  throw new Error('transfer failed');
};
// reactive wall-jump climb (jumps the moment a wall is touched while falling); used for the upper shaft
s._climb2 = function (firstDir, exitDir, stopFeetRow, max = 900) {
  let jh = true, dir = firstDir; this.tick({ j: 1, [firstDir > 0 ? 'r' : 'l']: 1 });
  for (let i = 0; i < max; i++) {
    const p = this.p; const k = {};
    const w = p.wallDir || p.nearWall(this.level);
    if (!p.onGround && w !== 0 && p.vy > -100 && !jh) { k.j = 1; jh = true; dir = -w; } else { jh = jh && p.vy < 0; if (jh) k.j = 1; }
    if (this.ty < stopFeetRow && p.vy > -250) dir = exitDir;
    k[dir > 0 ? 'r' : 'l'] = 1; this.tick(k);
    if (p.dead) return; if (p.onGround && i > 20) { if (this.ty - 1 <= stopFeetRow) return; throw new Error('climb2 landed early at ' + this.pos()); }
  }
  throw new Error('climb2 timeout at ' + this.pos());
};
const steps = {
  A: [['walk', 6], ['until', () => at(plats[0], 8, 26)], ['jump', 1, 8, 10], ['walk', 9], ['until', () => at(plats[0], 8, 22)], ['walk', 18],
      ['until', () => at(plats[1], 21, 22)], ['walk', 22], ['until', () => at(plats[1], 33, 22)], ['walk', 39]],
  C: [['walk', 42], ['until', () => saws[0].y < 15 * T && saws[0].waitT > 0], ['walk', 49], ['until', () => saws[1].x < 52 * T], ['jumpOver', saws[1], 1], ['walk', 60]],
  D: [['walk', 66], ['wallclimb', 9, 1, 900, 1], ['walk', 79]],
  E: [['until', () => at(plats[2], 80, 10)], ['walk', 81], ['until', () => at(plats[2], 80, 17)],
      ['until', () => saws[2].x < 84 * T], ['jumpOver', saws[2], 1, 20, 30], ['walk', 88], ['act'], ['check', () => s.level.byId.lift3.powered, 'lift3 powered'],
      ['wait', 30], ['until', () => at(plats[3], 90, 17) && plats[3].waitT > 0.3], ['walk', 91], ['until', () => at(plats[3], 97, 10)], ['walk', 104]],
  F: [['walk', 110], ['walk', 113], ['walk', 123], ['wallclimb', 15, 1, 900, 1], ['walk', 126], ['climb2', -1, 1, 7.2], ['walk', 135]],
  G: [['walk', 159], ['until', () => at(plats[4], 161, 7)], ['walk', 163], ['transfer'], ['until', () => at(plats[5], 172, 5)], ['walk', 186]],
};
const order = Object.keys(steps);
const from = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
if (from === 'E') s._tp(78, 9); if (from === 'F') s._tp(104, 9); if (from === 'G') s._tp(135, 6); if (from === 'D') s._tp(60, 21); if (from === 'C') s._tp(39, 21);
for (const k of order.slice(from ? order.indexOf(from) : 0)) { s.note('== ' + k); s.run(steps[k]); }
s.report();
