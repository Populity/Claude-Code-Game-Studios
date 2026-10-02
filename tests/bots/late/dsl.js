// route DSL helpers
const R = {
  runTo: (x, dir = 'r', note) => ({ [dir]: 1, until: dir === 'r' ? `p.cx/32>=${x}` : `p.cx/32<=${x}`, note }),
  // jump holding jump for `hold` frames, moving dir, then keep dir until grounded
  jump: (dir, hold = 18, note) => [{ [dir]: dir ? 1 : 0, j: 1, f: hold }, { [dir]: dir ? 1 : 0, until: 'p.onGround', max: 200, note }],
  jumpThen: (dir, hold, dir2, note) => [{ [dir]: 1, j: 1, f: hold }, { [dir2]: 1, until: 'p.onGround', max: 200, note }],
  wait: (cond, note, max) => ({ until: cond, note, max }),
  idle: (f) => ({ f }),
  use: (note) => ({ a: 1, f: 2, note }),
};
function show(g) {
  for (const l of g.log) console.log(JSON.stringify(l));
  console.log('deaths', g.deaths, 'completed', g.completed, 'time', g.time.toFixed(1));
}
module.exports = { R, show };
