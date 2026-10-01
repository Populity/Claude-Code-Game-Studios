const fs=require('fs');const S=require('./sim');const {Grid}=require('./lb');
function mk(gap){const g0=new Grid(50,30); g0.r(0,25,49,29); g0.r(10,2,10,24); g0.r(11+gap,2,11+gap,22); g0.r(35,2,35,24); g0.s(11,24,'P');
fs.writeFileSync(__dirname+'/wt.js',`G.registerLevel({id:'wt',biome:'ruins',title:'f',map:${JSON.stringify(g0.rows())},entities:[]});`);}
function climb(gap, single){
  mk(gap); const g=S.loadLevel('wt',__dirname+'/wt.js');
  if(single) g.tp(34,24);
  g.run([{f:30}]);
  let minRow=99, jumpHeld=false, dirHold=single?1:1;
  for(let i=0;i<400;i++){
    const p=g.player; let ctl={};
    if(i<1){ctl={jump:1, right:1}; jumpHeld=true;}
    else if(!p.onGround && p.wallDir!==0 && p.vy>-100 && !jumpHeld){ ctl={jump:1}; jumpHeld=true; dirHold=single?1:-p.wallDir; }
    else { jumpHeld = jumpHeld && p.vy<0; ctl={jump: jumpHeld?1:0}; }
    if(dirHold>0) ctl.right=1; else ctl.left=1;
    g.frame(ctl);
    minRow=Math.min(minRow,(g.player.y+g.player.h)/32);
  }
  return minRow.toFixed(2);
}
for(const gap of [2,3,4,5,6]) console.log('chimney gap',gap,'min feet row (floor=25):',climb(gap,false));
console.log('single wall min feet row:',climb(3,true));
