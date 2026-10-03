// usage: node reach.js b08 sx sy gx0 gy0 gx1 gy1   (start: tile x, feet on row sy; goal box on centre-x / feet row)
const {World}=require('./sim.js'); const {search}=require('./bfs.js');
const [,, mod, sx, sy, gx0, gy0, gx1, gy1] = process.argv.map((v,i)=>i>2?+v:v);
const B=require('./'+mod+'.js');
const def=Object.assign({},B.def,{map:B.g.rows(), entities:(B.def.entities||[]).filter(e=>typeof e!=='string'), triggers:[], decor:[]});
const w=new World(def); w.place(sx,sy);
if(process.env.PRE) eval(process.env.PRE);
w.run([{k:'',f:2}]);
const goal=(w)=>{const p=w.player;const cx=p.cx/32, fy=(p.y+p.h)/32; return cx>=gx0&&cx<=gx1+1&&fy>=gy0-0.05&&fy<=gy1+1;};
const gxm=(gx0+gx1+1)/2, gym=(gy0+gy1+1)/2;
const t0=Date.now();
const r=search(w,goal,(w)=>Math.abs(w.player.cx/32-gxm)*0.3+Math.abs((w.player.y+42)/32-gym),{maxNodes:+(process.env.NODES||150000),timeKey:+(process.env.TK||0),gw:+(process.env.GW||0.5)});
console.log(`[${mod} (${sx},${sy})→(${gx0}..${gx1},${gy0}..${gy1})]`, r.path? 'REACHED '+r.path.length+' macros '+r.frames+'f ('+(r.frames/60).toFixed(1)+'s)':'NOT reached', 'nodes',r.nodes, (Date.now()-t0)+'ms');
if(r.path&&process.env.SHOW) console.log(r.path.map(m=>m.k+m.f).join(' '));
