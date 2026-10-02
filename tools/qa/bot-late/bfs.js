// Best-first search over macro actions using real engine physics.
const DYN = new Set(['crate','mplatform','saw','plate','door','bridge','lever','terminal','part','socket','trigger','checkpoint','shard','laser','jumppad','exit']);
function snap(world){
  const prim=(o)=>{const r={};for(const k in o){const v=o[k];if(v===null||(typeof v!=='object'&&typeof v!=='function'))r[k]=v;}return r;};
  if(!world._dyn) world._dyn=world.level.entities.filter(e=>DYN.has(e.type));
  return {p:prim(world.player),ge:world.player.groundEntity,cp:world.player.carryPart,time:world.level.time,
    ents:world._dyn.map(e=>prim(e)),cr:[...world.level.crumbles.values()].filter(c=>c.state!=='idle'||c.t<5).map(c=>[c,c.state,c.t]),sp:world.spawnPoint};
}
function restore(world,s){
  Object.assign(world.player,s.p);world.player.groundEntity=s.ge;world.player.carryPart=s.cp;world.level.time=s.time;
  world._dyn.forEach((e,i)=>Object.assign(e,s.ents[i]));
  for(const c of world.level.crumbles.values()){c.state='idle';c.t=99;}
  for(const [c,st,t] of s.cr){c.state=st;c.t=t;}
  world.spawnPoint=s.sp;
}
class Heap{constructor(){this.a=[];}push(x){const a=this.a;a.push(x);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p].f<=a[i].f)break;[a[p],a[i]]=[a[i],a[p]];i=p;}}pop(){const a=this.a;const top=a[0];const last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,m=i;if(l<a.length&&a[l].f<a[m].f)m=l;if(r<a.length&&a[r].f<a[m].f)m=r;if(m===i)break;[a[m],a[i]]=[a[i],a[m]];i=m;}}return top;}get size(){return this.a.length;}}
function search(world, goal, h, opts={}){
  const macros=[];
  for(const d of ['','L','R']){ for(const f of [4,10,18]) macros.push({k:d,f}); for(const f of [6,12,22]) macros.push({k:d+'J',f}); }
  if(opts.extra) macros.push(...opts.extra);
  const tk=opts.timeKey||0;
  const key=(w)=>{const p=w.player;return [Math.round(p.x/5),Math.round(p.y/5),Math.round(p.vx/70),Math.round(p.vy/100),p.onGround?1:0,tk?Math.round(((w.level.time%tk)/tk)*16):0, w.player.carry||''].join(',');};
  const start=snap(world); const heap=new Heap(); const seen=new Set([key(world)]);
  heap.push({f:h(world),s:start,path:[],g:0});
  let nodes=0; const maxNodes=opts.maxNodes||150000;
  while(heap.size){
    const n=heap.pop();
    for(const m of macros){
      restore(world,n.s); let dead=false,hit=false;
      for(let i=0;i<m.f;i++){const k=m.k;world.tick({left:k.includes('L'),right:k.includes('R'),down:k.includes('D'),jumpPressed:k.includes('J')&&i===0,jumpHeld:k.includes('J')}); if(k.includes('E')&&i===0) world.interact(); if(world.player.dead){dead=true;break;} if(goal(world)){hit=true;break;}}
      nodes++;
      if(hit){const path=n.path.concat([m]);restore(world,start);return {path,nodes,frames:path.reduce((a,x)=>a+x.f,0)};}
      if(dead)continue;
      const kk=key(world); if(seen.has(kk))continue; seen.add(kk);
      const g=n.g+m.f/60;
      heap.push({f:h(world)+g*(opts.gw||0.5),s:snap(world),path:n.path.concat([m]),g});
    }
    if(nodes>maxNodes)break;
  }
  restore(world,start); return {path:null,nodes};
}
module.exports={search,snap,restore};
