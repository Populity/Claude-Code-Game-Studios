const S = require('./sim');
const g = S.loadLevel('l06'); g.tp(98, 23); g.run([{f:10}]);
let jh = true, dir = 1, got=false; g.frame({ jump: 1, right: 1 });
for (let i = 0; i < 600; i++) { const p = g.player; let c = {}; if (!p.onGround && p.wallDir !== 0 && p.vy > -100 && !jh) { c.jump = 1; jh = true; dir = -p.wallDir; } else { jh = jh && p.vy < 0; c.jump = jh ? 1 : 0; }
 if (g.log.some(l=>l[0]==='SHARD') && p.y+p.h < 15*32 && p.vy>-200) dir=-1;
 if (dir > 0) c.right = 1; else c.left = 1; g.frame(c); if (p.onGround && i > 5) break; }
console.log(JSON.stringify(g.log), g.tile());
