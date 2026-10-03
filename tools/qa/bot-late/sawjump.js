const {World}=require('./sim.js'); const B=require('./b10.js');
const def=Object.assign({},B.def,{map:B.g.rows(),entities:B.def.entities.filter(e=>typeof e!=='string'),triggers:[],decor:[]});
let ok=0,tot=0,ex=[];
for(let wait=0;wait<400;wait+=20)for(let jf of [0,6,12,18,24]){tot++;
 const w=new World(def); w.place(70,24); w.run([{k:'',f:2+wait}]);
 const r=w.run([{k:'R',f:jf},{k:'RJ',f:30},{k:'R',f:60}]);
 if(!r.dead&&w.player.cx/32>80){ok++; if(ex.length<3)ex.push(wait+'/'+jf);} }
console.log('saw-jump success',ok,'/',tot,ex);
