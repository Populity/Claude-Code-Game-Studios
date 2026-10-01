const S = require('./sim'); const { R, show } = require('./dsl');
const plat = (x) => `L.entities.find(e=>e.type==='mplatform'&&e.tx===${x})`;
// shuttle -> lift handoff at several arrival times
for (const delay of [0, 60, 150, 250, 330]) {
  const g = S.loadLevel('l05'); g.tp(134, 17); g.run([{ f: 30 + delay }, R.wait(`${plat(136)}.x<=136*32+1`), R.runTo(137, 'r'), ...R.jump(null, 4),
    R.wait(`${plat(136)}.x>=142*32-1`), R.runTo(144.3, 'r'), ...R.jump('r', 8, 'lift?'), R.runTo(148, 'r'),
    R.wait(`${plat(147)}.y<=12*32+1`), R.runTo(151, 'r'), R.wait('p.onGround', 'L2')]);
  console.log(delay, JSON.stringify(g.log.filter(l => l[0] !== 'say')));
}
// chimney top shard
const g = S.loadLevel('l05'); g.tp(183, 2); g.run([{ f: 10 }, R.runTo(181.6, 'l'), ...R.jumpThen('l', 18, 'l', 'perch'), { f: 20, note: 'stay' }]);
console.log(JSON.stringify(g.log));
