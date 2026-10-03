const S = require('./sim'); const { R, show } = require('./dsl');
const g = S.loadLevel('l06');
const lz = (x) => `L.entities.find(e=>e.type==='laser'&&e.tx===${x}&&(${x}!==84||(p.y<400)===(e.ty===3)))`;
const justOff = (x) => `(()=>{const l=${lz(x)}; const ph=(((L.time+l.offset)%l.period)+l.period)%l.period; return ph>=l.onTime && ph<l.onTime+0.05})()`;
const saw = (x) => `L.entities.find(e=>e.type==='saw'&&e.tx===${x})`;
const plat = (x) => `L.entities.find(e=>e.type==='mplatform'&&e.tx===${x})`;
const climb = (g, exitDir, stopRow) => { let jh = true, dir = 1; g.frame({ jump: 1, right: 1 });
  for (let i = 0; i < 500; i++) { const p = g.player; let c = {}; if (!p.onGround && p.wallDir !== 0 && p.vy > -100 && !jh) { c.jump = 1; jh = true; dir = -p.wallDir; } else { jh = jh && p.vy < 0; c.jump = jh ? 1 : 0; }
    if (p.y + p.h < stopRow * 32 && p.vy > -200) dir = exitDir; if (dir > 0) c.right = 1; else c.left = 1; g.frame(c); if (p.dead) break; if (p.onGround && i > 20) break; }
  g.log.push(['climbed', g.tile()]); };
g.run([
  R.runTo(17.3, 'r'), ...R.jump('r', 8), ...R.jump('r', 8), ...R.jump('r', 8), ...R.jump('r', 8, 'in bay'),
  R.runTo(47, 'r'), R.runTo(49.5, 'r'), R.wait('p.onGround', 'hold'),
  // shard 1 detour
  R.runTo(34, 'l'), R.wait(justOff(32)), R.runTo(26, 'l', 'shard1'), R.wait(justOff(32)), R.runTo(53, 'r', 'C2'),
  R.runTo(62, 'r', 'past grating'), R.wait(justOff(64)), R.runTo(66, 'r'), R.wait(justOff(68)), R.runTo(70.8, 'r'),
  ...R.jump('r', 18, 'over coolant'), R.runTo(78.5, 'r'), R.wait(`${saw(81)}.y<=19*32+16 && ${saw(81)}.waitT>0.3`, 'saw up'), R.runTo(90, 'r', 'C3'),
  R.runTo(93.4, 'r'), R.use('cell'), R.runTo(97.6, 'r'),
  R.runTo(98, 'r'), { fn: (g) => climb(g, -1, 14.9) },
  R.runTo(93, 'l'), R.wait('p.onGround', 'corridor'), R.runTo(91.5, 'l'), R.wait(justOff(90)), R.runTo(86, 'l'), R.wait(justOff(84)), R.runTo(81.5, 'l'),
  R.wait(`${saw(79)}.y<=11*32+16 && ${saw(79)}.waitT>0.4`, 'saw79 up'), R.runTo(73, 'l'), R.use('socket'), R.idle(10),
  R.runTo(75, 'r'), R.wait(`${plat(74)}.y>=16*32-1 && ${plat(74)}.waitT>0`), ...R.jump(null, 8, 'on lift'), R.wait(`${plat(74)}.y<=9*32+1`, 'lift top'), R.runTo(80, 'r', 'C4'),
  R.runTo(82, 'r'), R.wait(justOff(84), 'wave'), R.runTo(89.3, 'r'), ...R.jump('r', 8), R.runTo(102.6, 'r', 'end wave'),
  R.runTo(103.5, 'r'), ...R.jump('r', 8, 'X'), ...R.jump('r', 12, 'girder'), R.runTo(112.3, 'r'),
  R.wait(`${saw(114)}.y>=11*32+16 && ${saw(114)}.waitT>0.45`, 'saw down'), ...R.jumpThen('r', 10, 'r', 'strut'),
  R.wait(`${plat(118)}.x<=118*32+1`), R.runTo(119.5, 'r', 'plate'), R.wait(`${plat(118)}.x>=120.5*32`), ...R.jump(null, 20, 'shard3'),
  R.wait(`${plat(118)}.x>=125*32-1`), R.runTo(129, 'r'), R.runTo(146, 'r'), R.use('pipes'), R.runTo(153, 'r', 'C6'),
  R.runTo(156, 'r'), R.wait(justOff(158)), R.runTo(165.5, 'r'), ...R.jump('r', 8, 'X2'), R.runTo(186, 'r', 'exit'),
]);
show(g);
