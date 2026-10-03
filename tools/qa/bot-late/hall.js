const {World}=require('./sim.js'); const {search}=require('./bfs.js'); const B=require('./b08.js');
const def=Object.assign({},B.def,{map:B.g.rows(),entities:B.def.entities.filter(e=>typeof e!=='string'),triggers:[],decor:[]});
const mk=()=>new World(def);
let w=mk(); w.place(108,26); w.run([{k:'',f:2}]);
const crate=()=>w.level.entities.find(e=>e.type==='crate');
let r=search(w,(w)=>w.player.onGround && w.player.cx/32>119 && w.player.cx/32<124 && (w.player.y+42)/32<16.1,(w)=>Math.abs((w.player.y+42)/32-16)+Math.abs(w.player.cx/32-121)*0.3,{maxNodes:150000});
console.log('floor→shelf', r.path?('OK '+r.frames+'f '+r.path.map(m=>m.k+m.f).join(' ')):'FAIL', r.nodes);
// crate: from shelf push right
w=mk(); w.place(122,16); w.run([{k:'',f:2}]);
r=search(w,(w)=>w.level.byId.hall_plate.active && w.level.byId.hall_plate.byCrate,(w)=>Math.abs(crate().x/32-129.5)+Math.abs(w.player.cx/32-crate().x/32)*0.2,{maxNodes:150000});
console.log('crate→plate', r.path?('OK '+r.frames+'f '+r.path.map(m=>m.k+m.f).join(' ')):'FAIL', r.nodes, 'crate', crate().x/32);
if(r.path){ w.run(r.path); console.log('crate at',crate().x/32,crate().y/32,'plate',w.level.byId.hall_plate.active);
  w.run([{k:'',f:60}]); console.log('door open?',w.level.byId.hall_door.openT);
  r=search(w,(w)=>w.player.cx/32>140,(w)=>Math.abs(w.player.cx/32-141),{maxNodes:80000}); console.log('→terminal',r.path?'OK':'FAIL');
  w.run(r.path); const t=w.interact(); console.log('interacted',t&&t.type, 'lift powered',w.level.byId.lift.powered);
  r=search(w,(w)=>w.player.onGround && (w.player.y+42)/32<10.1 && w.player.cx/32>141,(w)=>Math.abs((w.player.y+42)/32-10)+Math.abs(w.player.cx/32-143)*0.2,{maxNodes:150000,timeKey:15.4});
  console.log('lift→corridor',r.path?'OK '+r.frames:'FAIL',r.nodes);
}
// player alone: stand in slot then try to pass door (must FAIL)
w=mk(); w.place(129,27); w.run([{k:'',f:2}]);
r=search(w,(w)=>w.player.cx/32>137,(w)=>Math.abs(w.player.cx/32-138),{maxNodes:60000});
console.log('bypass door without crate (expect FAIL):', r.path?'POSSIBLE '+r.path.map(m=>m.k+m.f).join(' '):'impossible', r.nodes);
