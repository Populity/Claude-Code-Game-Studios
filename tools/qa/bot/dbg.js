const S = require('./sim'); const { R, show } = require('./dsl');
const g = S.loadLevel('l04');
g.tp(170,15); g.run([{f:5}]);
const pts=[]; g.run([{r:1,f:6}]); 
for(let i=0;i<60;i++){ g.frame({right:1,jump:i<18}); pts.push([(g.player.x/32).toFixed(2),((g.player.y+42)/32).toFixed(2)]); if(g.player.onGround||g.player.dead)break;}
console.log(pts.join(' '));
