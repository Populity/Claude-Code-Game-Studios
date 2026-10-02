const {World,G}=require('./sim.js');
const W=40,H=30;
function mk(rows,ents){return {id:'t',title:'t',biome:'tower',map:rows,entities:ents||[]};}
let rows=[];for(let y=0;y<H;y++){rows.push(y>=H-2?'#'.repeat(W):'#'+'.'.repeat(W-2)+'#');}
rows[H-3]=rows[H-3].slice(0,10)+'J'+rows[H-3].slice(11);
let w=new World(mk(rows),[5,H-3]); w.run([{k:'',f:3}]);
let minFeet=1e9; for(let i=0;i<90;i++){ w.tick({right:i<20}); minFeet=Math.min(minFeet,(w.player.y+42)/32);} 
console.log('pad: floor surface row',H-2,'min feet row',minFeet.toFixed(2),'rise',(H-2-minFeet).toFixed(2));
w=new World(mk(rows),[9,H-3]); w.run([{k:'',f:3}]); let x0=w.player.x; let f=0; w.tick({right:true}); while(!(w.player.onGround&&f>10) && f<200){w.tick({right:true});f++;} console.log('pad flight frames',f,'dx tiles',((w.player.x-x0)/32).toFixed(1));
rows=[];for(let y=0;y<H;y++){ if(y==20) rows.push('#####'+'X'.repeat(30)+'#####'); else if (y>=H-2) rows.push('#'.repeat(W)); else rows.push('#'+'.'.repeat(W-2)+'#'); }
w=new World(mk(rows)); w.place(3,20); let r=w.run([{k:'R',f:150}]); console.log('crumble run', r.at, r.dead);
w=new World(mk(rows)); w.place(8,20); r=w.run([{k:'',f:40}]); console.log('stand on crumble 40f', r.at);
