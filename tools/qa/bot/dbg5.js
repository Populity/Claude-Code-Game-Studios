const S = require('./sim'); const { R, show } = require('./dsl');
const plat = (x) => `L.entities.find(e=>e.type==='mplatform'&&e.tx===${x})`;
const g = S.loadLevel('l05'); g.tp(134, 17);
g.run([{time: 28.32-0.02},{f:1}, R.wait(`${plat(136)}.x<=136*32+1`), R.runTo(137.58,'r'), {f:1}, ...R.jump(null, 6),R.wait(`${plat(136)}.x>=142*32-1`), R.runTo(143.91,'r')]);
const lift = g.level.entities.find(e=>e.type==='mplatform'&&e.tx===147);
const out=[]; for(let i=0;i<50;i++){ g.frame({right:1,jump:i<10}); const p=g.player; out.push([(p.x/32).toFixed(2),((p.y+42)/32).toFixed(2),(lift.y/32).toFixed(2), p.onGround?'G':'', p.groundEntity===lift?'L':'']); if(p.dead)break;}
console.log(out.map(o=>o.join(',')).join(' | '));
show(g);
