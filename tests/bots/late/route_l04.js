const S = require('./sim'); const { R, show } = require('./dsl');
const g = S.loadLevel('l04');
const laserOff = (x) => `(()=>{const l=L.entities.find(e=>e.type==='laser'&&e.tx===${x}); return l.computePhase(L.time)==='off'})()`;
const laserJustOff = (x) => `(()=>{const l=L.entities.find(e=>e.type==='laser'&&e.tx===${x}); const ph=((L.time+l.offset)%l.period); return ph>=l.onTime && ph<l.onTime+0.1})()`;
g.run([
  R.runTo(13.2, 'r'), ...R.jump('r', 8, 'step'), R.runTo(38, 'r', 'plaza'),
  R.runTo(48.6, 'r', 'on stub'),
  ...R.jump('r', 16, 'X 52-53'),
  ...R.jump('r', 12, 'X 56-57'),
  ...R.jump('r', 14, 'ground 61'),
  R.runTo(64, 'r', 'C1'),
  R.runTo(69, 'r'), R.wait(laserJustOff(71), 'L1 off'),
  R.runTo(73.5, 'r', 'pocket1'), ...R.jump('r', 14, 'on hurdle'), R.runTo(77.6), {f: 10},
  R.wait(laserJustOff(79), 'L2 off'), R.runTo(81.5, 'r'), ...R.jump('r', 10, 'over spikes'), R.runTo(85.5, 'r', 'before L3'),
  R.wait(laserJustOff(87), 'L3 off'), R.runTo(99, 'r', 'courtyard C2'),
  R.runTo(101, 'r'), R.use('Восход'),
  R.runTo(107, 'r'), R.wait('Math.abs(by.zlift.y - 15*32)<2', 'lift bottom'), ...R.jump(null, 10, 'on lift'),
  R.wait('Math.abs(by.zlift.y - 8*32)<2 && by.zlift.waitT>0', 'lift top'), R.runTo(113, 'r'), R.use('Зенит'),
  R.runTo(116.3, 'r'), ...R.jump('r', 20, 'shard perch'),
  R.runTo(124, 'r', 'dropped'), R.runTo(122, 'l'), R.use('Врата'), R.runTo(126, 'r'), R.use('terminal'),
  R.idle(60), R.runTo(134, 'r', 'C3'), R.runTo(138, 'r'), R.use('lights'), R.idle(40),
  R.runTo(152, 'r', 'across bridge'),
  R.wait('by && L.entities.find(e=>e.type==="mplatform"&&e.tx===154).x <= 154*32+2', 'shuttle home'), R.runTo(155.5, 'r'), {f:2},
  R.wait('L.entities.find(e=>e.type==="mplatform"&&e.tx===154).x >= 161*32-1', 'shuttle far'), R.runTo(165,'r', 'pillar'),
  R.runTo(166.3,'r'), R.wait(laserJustOff(168), 'arc off'), ...R.jump('r', 12, 'crumble'), ...R.jump('r', 18, 'terrace'),
  R.runTo(181, 'r', 'C4 passed'),
]);
// chimney shard
g.run([R.runTo(181.5,'r'), {r:1, j:1, f:1}]);
let jh=true, dir=1;
for (let i=0;i<300;i++){ const p=g.player; let c={}; if(!p.onGround&&p.wallDir!==0&&p.vy>-100&&!jh){c.jump=1;jh=true;dir=-p.wallDir;} else {jh=jh&&p.vy<0; c.jump=jh?1:0;} if(dir>0)c.right=1; else c.left=1; g.frame(c); if(p.onGround && i>20) break; }
g.run([R.runTo(196, 'r', 'exit')]);
show(g);
