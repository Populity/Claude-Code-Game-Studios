const S = require('./sim'); const { R, show } = require('./dsl');
const g = S.loadLevel('l07');
const saw = (x) => `L.entities.find(e=>e.type==='saw'&&e.tx===${x})`;
const plat = (x) => `L.entities.find(e=>e.type==='mplatform'&&e.tx===${x})`;
const T = 32, c = (t) => t * T + 16;
const climb = (g, firstDir, exitDir, stopFeetRow) => { let jh = true, dir = firstDir; g.frame({ jump: 1, [firstDir > 0 ? 'right' : 'left']: 1 });
  for (let i = 0; i < 600; i++) { const p = g.player; let k = {}; if (!p.onGround && p.wallDir !== 0 && p.vy > -100 && !jh) { k.jump = 1; jh = true; dir = -p.wallDir; } else { jh = jh && p.vy < 0; k.jump = jh ? 1 : 0; }
    if (p.y + p.h < stopFeetRow * 32 && p.vy > -250) dir = exitDir; if (dir > 0) k.right = 1; else k.left = 1; g.frame(k); if (p.dead) break; if (p.onGround && i > 20) break; }
  g.log.push(['climbed', g.tile()]); };
const steps1 = [
  R.runTo(28, 'r'), R.use('lever'), R.runTo(30, 'r'), R.wait(`${plat(31)}.y>=25*32-1 && ${plat(31)}.waitT>0.2`), ...R.jump('r', 8, 'on lift'), R.runTo(32.5, 'r'),
  R.wait(`${plat(31)}.y<=17*32+1`, 'lift top'), R.runTo(37.6, 'r'),
  // blade loop: wait until on right side going down (x at 42, y between rows 13.3 and 14)
  R.wait(`${saw(39)}.x>=${c(42)}-1 && ${saw(39)}.y>${c(13)}+4 && ${saw(39)}.y<${c(13)}+20`, 'blade right'), ...R.jumpThen('r', 14, 'l', 'pillar'),
  { r: 1, f: 0 }, R.wait(`${saw(39)}.y>=${c(16)}-1 && ${saw(39)}.x<${c(41.5)}`, 'blade bottom'), R.runTo(40.9,'r'), ...R.jump(null, 20, 'shard1'), R.runTo(41.4, 'r'), ...R.jump('r', 8, 'off pillar'),
  R.runTo(53.5, 'r', 'chimney'),
];
g.run(steps1);
climb(g, 1, 1, 6.2);
g.run([
  R.wait(`${saw(59)}.x<=${c(59)}+2`, 'blade left'), R.wait(`${saw(59)}.x>=${c(61)}`), R.runTo(62.5, 'r'), R.wait('p.onGround', 'trench'),
  R.wait(`${saw(59)}.x<=${c(61)}`, 'passed over'), ...R.jump('r', 10), R.runTo(75, 'r', 'C3'), R.runTo(82, 'r'), R.wait('p.onGround', 'cavern'),
  R.runTo(91, 'r', 'C4'), R.runTo(101, 'r'), R.use('logic'), R.idle(60), R.runTo(112, 'r', 'C5'), R.runTo(114.3, 'r'), ...R.jumpThen('r', 16, 'r', 'P1'), R.runTo(119.3, 'r'),
  R.wait(`${saw(122)}.x>=${c(125)}-1 && ${saw(122)}.y>${c(21)}+2 && ${saw(122)}.y<${c(21)}+16`, 'loop right'), R.runTo(118,'l'), R.runTo(119.4,'r'), ...R.jumpThen('r', 14, 'r', 'P2'),
  R.wait(`${saw(122)}.y>=${c(24)}-1 && ${saw(122)}.x<${c(124.5)}`, 'loop bottom'), R.runTo(123.6,'l'), ...R.jump(null, 20, 'shard2'), R.runTo(124.4, 'r'), ...R.jump('r', 8, 'P3'), R.runTo(129.4, 'r'),
  R.wait(`${saw(131)}.y>=${c(25)}-1`, 'pendulum low'), ...R.jump('r', 10, 'ledge'), R.runTo(136, 'r', 'C6'),
  R.runTo(137.3, 'r'), ...R.jump('r', 6), R.runTo(145.4, 'r', 'crate pushed'), R.idle(5),
  { fn: (g) => g.log.push(['plate', g.level.entities.find(e => e.type === 'plate').active]) },
  ...R.jump('r', 14, 'over crate+kerb'), R.wait(`${plat(149)}.y>=23*32-1 && ${plat(149)}.waitT>0.2`), ...R.jump('r', 8, 'on lift2'), R.runTo(150.3,'r'),
  R.wait(`${plat(149)}.y<=10*32+1`, 'lift2 top'), R.runTo(162.5, 'r', 'chimney2'),
]);
climb(g, 1, 1, 4.0);
g.run([
  R.runTo(170, 'r', 'C8'), R.wait(`${saw(171)}.x>=${c(173)}`), R.runTo(174.4, 'r'), R.wait('p.onGround', 'trench2'),
  R.wait(`${saw(171)}.x<=${c(172)}`, 'passed'), ...R.jump('r', 10), R.runTo(205, 'r', 'exit'),
]);
show(g);
