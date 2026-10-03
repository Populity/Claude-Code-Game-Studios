// node climb.js b09 sx sy firstDir stopFeetRow exitDir [waitFrames]
const {World}=require('./sim.js'); const B=require('./'+process.argv[2]+'.js');
const [sx,sy,d0,stopRow,exitDir,wait]=process.argv.slice(3).map(Number);
const def=Object.assign({},B.def,{map:B.g.rows(),entities:B.def.entities.filter(e=>typeof e!=='string'),triggers:[],decor:[]});
const w=new World(def); w.place(sx,sy); w.run([{k:'',f:2+(wait||0)}]);
let dir=d0, log=[], phase='climb', best=99;
w.tick({left:dir<0,right:dir>0,jumpPressed:true,jumpHeld:true});
for(let f=0;f<900;f++){const p=w.player; let jp=false; const feet=(p.y+42)/32; best=Math.min(best,feet);
 if(phase==='climb'){ if(feet<=stopRow){phase='exit';}
   else { const nw=p.nearWall(w.level); if(!p.onGround && nw===dir && p.vy>-150){jp=true;dir=-dir;} if(p.onGround && f>3){jp=true;} } }
 const L= phase==='exit'? exitDir<0 : dir<0, R= phase==='exit'? exitDir>0: dir>0;
 w.tick({left:L,right:R,jumpPressed:jp,jumpHeld:true});
 if(p.dead){log.push('DEAD '+p.deathCause);break;}
 if(f%8==0) log.push(`${(p.cx/32).toFixed(1)},${((p.y+42)/32).toFixed(1)}${p.onGround?'g':''}`);
 if(phase==='exit' && p.onGround){log.push(`LANDED ${(p.cx/32).toFixed(1)},${((p.y+42)/32).toFixed(1)} f${f}`);break;}
}
console.log(log.join(' '));
