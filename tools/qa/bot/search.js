// generic jump search: from standing at (tx,ty) with runup, try (runFrames, jumpHold, rightFrames) and report landing tile
const S = require('./sim');
module.exports = function search(id, tx, ty, opts = {}) {
  const res = [];
  for (const back of opts.backs || [0]) for (const hold of opts.holds || [8, 12, 16, 20]) for (const rf of opts.rfs || [10, 15, 20, 25, 30, 40]) {
    const g = S.loadLevel(id); g.tp(tx, ty); g.allowDeath = true;
    if (opts.time != null) g.level.time = opts.time;
    if (opts.setup) opts.setup(g);
    g.run([{ f: 3 }]); if (back) g.run([{ l: 1, f: back }, { f: 6 }]);
    const dir = opts.dir || 'right';
    for (let i = 0; i < 120; i++) { g.frame({ [dir]: i < rf, jump: i < hold }); if (g.player.dead || (g.player.onGround && i > 3)) break; }
    res.push([back, hold, rf, g.player.dead ? 'DEAD ' + g.player.deathCause : g.tile().join(',')]);
  }
  return res;
};
if (require.main === module) {
  const s = module.exports('l07', 119, 23, { backs: [0, 8] });
  s.forEach(r => console.log(r.join(' ')));
}
