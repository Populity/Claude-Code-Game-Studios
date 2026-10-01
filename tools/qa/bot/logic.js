const parse = (src) => { let i = 0; const s = src.replace(/\s+/g, '');
 const prim = () => { if (s[i] === '!') { i++; const v = prim(); return (e) => !v(e); } if (s[i] === '(') { i++; const v = or(); i++; return v; } const id = s[i++]; return (e) => !!e[id]; };
 const and = () => { let l = prim(); while (s[i] === '&') { i++; const a = l, b = prim(); l = (e) => a(e) && b(e); } return l; };
 const xor = () => { let l = and(); while (s[i] === '^') { i++; const a = l, b = and(); l = (e) => a(e) !== b(e); } return l; };
 const or = () => { let l = xor(); while (s[i] === '|') { i++; const a = l, b = xor(); l = (e) => a(e) || b(e); } return l; };
 return or(); };
const sets = [
 ['A ^ B', '(B | C) & !D', 'C ^ (A & D)'],
 ['A ^ C', '(B | D) & !(A & B)', '!(C | D) ^ B'],
 ['A ^ B', '(C | D) & !(B & C)', 'D ^ (A & C)'],
 ['(A | B) & !(A & B)', '!C ^ D', '(A & C) | (B & D)'],
];
for (const outs of sets) { const fns = outs.map(parse); const sol = [];
 for (let m = 0; m < 16; m++) { const e = { A: m & 1, B: m >> 1 & 1, C: m >> 2 & 1, D: m >> 3 & 1 }; if (fns.every(f => f(e))) sol.push(`A${e.A}B${e.B}C${e.C}D${e.D}`); }
 console.log(outs.join(' ; '), '=>', sol.length, sol.join(' '));
 // per-output counts
 console.log('   individually:', fns.map(f => { let n = 0; for (let m = 0; m < 16; m++) { const e = { A: m & 1, B: m >> 1 & 1, C: m >> 2 & 1, D: m >> 3 & 1 }; if (f(e)) n++; } return n; }).join(','));
}
const cand = ['A ^ B','A ^ C','B ^ D','C ^ D','(A | B) & !C','(B | C) & !D','(A | D) & !B','!(A & B) & (C | D)','C ^ (A & D)','D ^ (B & C)','(A & C) | (B & D)','!(C | D) ^ B','(A ^ D) | (B & C)','!A ^ (C & D)','(B | D) & !(A & C)'];
const E = (m) => ({ A: m & 1, B: m >> 1 & 1, C: m >> 2 & 1, D: m >> 3 & 1 });
const tab = cand.map(c => { const f = parse(c); return [...Array(16)].map((_, m) => f(E(m))); });
const res = [];
for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) for (let k = j + 1; k < cand.length; k++) {
  const sol = []; for (let m = 0; m < 16; m++) if (tab[i][m] && tab[j][m] && tab[k][m]) sol.push(m);
  // pairs alone should still leave >=2 solutions (every output matters)
  const pair = (a, b) => [...Array(16)].filter((_, m) => tab[a][m] && tab[b][m]).length;
  if (sol.length === 1 && pair(i, j) > 1 && pair(i, k) > 1 && pair(j, k) > 1) { const e = E(sol[0]); res.push([cand[i], cand[j], cand[k], `A${e.A}B${e.B}C${e.C}D${e.D}`, pair(i,j)+pair(i,k)+pair(j,k)]); }
}
res.sort((a, b) => b[4] - a[4]); console.log(res.length); res.slice(0, 12).forEach(r => console.log(r.join(' | ')));
