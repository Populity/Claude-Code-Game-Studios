const {World}=require('./sim.js'); const B=require('./b08.js');
const def=Object.assign({},B.def,{map:B.g.rows(),entities:B.def.entities.filter(e=>typeof e!=='string'),triggers:[],decor:[]});
const w=new World(def); w.place(114,26); w.run([{k:'',f:2}]);
let dir=1, log=[];
for(let f=0;f<240;f++){const p=w.player; let jp=false; const nw=p.nearWall(w.level);
 if(f>5 && !p.onGround && nw===dir && p.vy>-150){jp=true;dir=-dir;}
 w.tick({left:dir<0,right:dir>0||f<5,jumpPressed:jp,jumpHeld:true});
 if(f%6==0) log.push(`${(p.cx/32).toFixed(1)},${((p.y+42)/32).toFixed(1)}${jp?'J':''}`);}
console.log(log.join(' '));
