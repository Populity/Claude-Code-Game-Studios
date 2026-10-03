const {World,G}=require('./sim.js');
const W=40,H=30;
function mk(rows,ents){return {id:'t',title:'t',biome:'tower',map:rows,entities:ents||[]};}
let rows=[];for(let y=0;y<H;y++){rows.push(y>=H-2?'#'.repeat(W):'#'+'.'.repeat(W-2)+'#');}
rows[H-3]=rows[H-3].slice(0,10)+'J'+rows[H-3].slice(11);
let w=new World(mk(rows)); w.place(9,28); 
let minFeet=1e9; for(let i=0;i<90;i++){ w.tick({right:i<8}); minFeet=Math.min(minFeet,(w.player.y+42)/32);} 
console.log('pad rise',(28-minFeet).toFixed(2));
// pad with jump held
w=new World(mk(rows)); w.place(9,28); minFeet=1e9; for(let i=0;i<90;i++){ w.tick({right:i<8,jumpHeld:true,jumpPressed:i==10}); minFeet=Math.min(minFeet,(w.player.y+42)/32);} 
console.log('pad rise w/ jump pressed in air',(28-minFeet).toFixed(2));
