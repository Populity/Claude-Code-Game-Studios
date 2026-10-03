const S = require('./sim'); const { R, show } = require('./dsl');
const g = S.loadLevel('l05');
const lz = (x) => `L.entities.find(e=>e.type==='laser'&&e.tx===${x})`;
const justOff = (x) => `(()=>{const l=${lz(x)}; const ph=(((L.time+l.offset)%l.period)+l.period)%l.period; return ph>=l.onTime && ph<l.onTime+0.05})()`;
const isOn = (x) => `${lz(x)}.computePhase(L.time)==='on'`;
const plat = (x) => `L.entities.find(e=>e.type==='mplatform'&&e.tx===${x})`;
g.run([
  R.runTo(9.5, 'r'), R.wait('p.onGround'), R.runTo(13.5,'r'), R.wait('p.onGround', 'floor'),
  R.runTo(21, 'r'), ...R.jump('r', 10, 'ch1'), R.runTo(27, 'r'), ...R.jump('r', 10, 'stone'), ...R.jump('r', 10, 'far bank'),
  R.runTo(43, 'r', 'C1'), R.wait(justOff(46), 'wave'), R.runTo(70, 'r', 'through wave'),
  R.runTo(79, 'r', 'C2'),
  R.runTo(86.3, 'r', 'crate on A?'), R.idle(5),
  { fn: (g) => g.log.push(['pA', g.level.byId.pA.active]) },
  R.runTo(85, 'l'), R.idle(3), ...R.jump('r', 12, 'over kerb'), R.runTo(90.4, 'r'), R.idle(1),
  R.wait('by.pB.active', 'on B'), R.idle(60),
  { fn: (g) => { const c = g.level.entities.filter(e=>e.type==='crate'); g.log.push(['crates', c.map(e=>[(e.x/32).toFixed(2),(e.y/32).toFixed(2)])]); } },
  R.runTo(93, 'r'), R.idle(30),
  { fn: (g) => { const c = g.level.entities.filter(e=>e.type==='crate'); g.log.push(['crates', c.map(e=>[(e.x/32).toFixed(2),(e.y/32).toFixed(2)]), 'pB', g.level.byId.pB.active, 'lock', g.level.byId.lock.openT]); } },
  R.runTo(104, 'r', 'C3'), R.runTo(112.4, 'r'),
  R.wait(justOff(114), 'arc1 off'), ...R.jump('r', 10, 'pillar1'), R.runTo(117.3,'r'),
  R.wait(justOff(119), 'arc2 off'), ...R.jump('r', 10, 'pillar2'), R.runTo(122.3,'r'),
  R.wait(justOff(124), 'arc3 off'), ...R.jump('r', 18, 'pillar3'), R.runTo(127.3,'r'),
  R.wait(justOff(129), 'arc4 off'), ...R.jump('r', 10, 'ledge'), R.runTo(134,'r','C4'),
  R.wait(`${plat(136)}.x<=136*32+1`, 'shuttle home'), R.runTo(136.8,'r'), ...R.jump(null, 6, 'on shuttle'),
  R.wait(`${plat(136)}.x>=142*32-1`, 'shuttle far'), R.runTo(144.2,'r'),
  {fn:(g)=>{const lift=g.level.entities.find(e=>e.type==='mplatform'&&e.tx===147);const o=[];for(let i=0;i<45;i++){g.frame({right:i<14,jump:i<8});const p=g.player;o.push([(p.x/32).toFixed(2),((p.y+42)/32).toFixed(2),(lift.y/32).toFixed(2),p.onGround?'G':'']);if(p.dead||(p.onGround&&i>5))break;}console.log(o.map(x=>x.join(',')).join(' | '));}}, R.runTo(148,'r','on lift'),
  R.wait(`${plat(147)}.y<=12*32+1`, 'lift top'), ...R.jump(null, 20, 'shard jump'), R.runTo(152, "r", "ledge L2"),
  R.runTo(175, 'r', 'C6'), R.runTo(179, 'r', 'in chimney'),
  R.wait(isOn(181), 'arc on'), R.wait('!(' + isOn(181) + ')', 'arc off now'),
]);
// chimney climb bot
let jh = true, dir = -1; g.frame({ jump: 1, left: 1 });
for (let i = 0; i < 400; i++) { const p = g.player; let c = {}; if (!p.onGround && p.wallDir !== 0 && p.vy > -100 && !jh) { c.jump = 1; jh = true; dir = -p.wallDir; } else { jh = jh && p.vy < 0; c.jump = jh ? 1 : 0; } if (p.y + p.h < 3 * 32 + 5 && p.vy > 0) dir = 1; if (dir > 0) c.right = 1; else c.left = 1; g.frame(c); if (p.dead) break; if (p.onGround && i > 20) break; }
g.log.push(['after climb', g.tile(), g.player.dead]);
g.run([R.runTo(196.5, 'r', 'exit')]);
show(g);
