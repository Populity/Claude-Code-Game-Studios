const S = require('./sim');
const g = S.loadLevel('l06'); g.tp(98, 23); g.run([{f:10}]);
let jh = true, dir = 1; g.frame({ jump: 1, right: 1 }); const o=[];
for (let i = 0; i < 120; i++) { const p = g.player; let c = {}; if (!p.onGround && p.wallDir !== 0 && p.vy > -100 && !jh) { c.jump = 1; jh = true; dir = -p.wallDir; } else { jh = jh && p.vy < 0; c.jump = jh ? 1 : 0; }
 if (dir > 0) c.right = 1; else c.left = 1; g.frame(c); o.push([(p.x/32).toFixed(2),((p.y+42)/32).toFixed(2),p.wallDir,c.jump?'J':'']); if (p.onGround && i > 5) break; }
console.log(o.map(x=>x.join(',')).join(' '));
