const S = require('./sim'); const { R, show } = require('./dsl');
for (const jx of [42.5, 43, 43.5, 44]) {
  const g = S.loadLevel('l04'); g.allowDeath = false;
  g.tp(38, 15); g.run([{ f: 5 }, R.runTo(jx), ...R.jump('r', 20, 'land'), R.runTo(49.5, 'r', 'stub')]);
  console.log(jx, JSON.stringify(g.log.filter(l => l[0] !== 'say' && l[0] !== 'obj')));
}
