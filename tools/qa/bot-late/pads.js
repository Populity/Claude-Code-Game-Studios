const {World}=require('./sim.js'); const B=require(process.argv[2]||'./b08.js');
const def=Object.assign({},B.def,{map:B.g.rows(),entities:B.def.entities.filter(e=>typeof e!=='string'),triggers:[],decor:[]});
// arg: startX feetRow, then hold-right frames sweep; runs until onGround after first leaving ground, reports landing
const [sx,sy,tOff]=process.argv.slice(3).map(Number);
const res=[];
for(let t0=0;t0<(tOff||1);t0+=0.5)for(let hold=10;hold<=90;hold+=8){
  const w=new World(def); w.place(sx,sy); w.run([{k:'',f:2+Math.round(t0*60)}]);
  let left=false,f=0,out='';
  for(f=0;f<300;f++){ w.tick({right:f<hold}); const p=w.player; if(p.dead){out='DEAD:'+p.deathCause+'@'+(p.cx/32).toFixed(1);break;} if(!p.onGround)left=true; else if(left){out=(w.shards?"*":"")+`land ${(p.cx/32).toFixed(1)},${((p.y+42)/32).toFixed(1)}`;break;} }
  res.push(`t${t0} h${hold}:${out}`);
}
console.log(res.join(' | '));
