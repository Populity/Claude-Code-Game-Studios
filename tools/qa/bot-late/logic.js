const ins=['A','B','C','D','E'];
const outs=process.argv.slice(2);
const toJs=(e)=>e.replace(/([A-E])/g,'v.$1').replace(/\^/g,'!==').replace(/&/g,'&&').replace(/\|/g,'||');
// careful precedence: in engine ^ binds looser than & and tighter than |. Use explicit parens in exprs.
const fns=outs.map(o=>new Function('v','return !!('+toJs(o)+')'));
const sols=[];
for(let m=0;m<32;m++){const v={};ins.forEach((k,i)=>v[k]=!!(m&(1<<i)));const r=fns.map(f=>f(v));if(r.every(Boolean))sols.push(ins.map(k=>v[k]?1:0).join(''));}
console.log('solutions ABCDE:',sols);
// per-output satisfying fraction
fns.forEach((f,i)=>{let c=0;for(let m=0;m<32;m++){const v={};ins.forEach((k,j)=>v[k]=!!(m&(1<<j)));if(f(v))c++;}console.log(outs[i],c+'/32');});
