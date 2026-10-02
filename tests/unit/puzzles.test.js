/** Puzzle generators + parser: solvable by construction for many seeds; real level terminals solvable. */
const { makeEngine } = require('../lib/engine');
const { test, assert, report } = require('../lib/harness');
const { pipesClicks, lightsSolve, logicSolve } = require('../lib/solvers');
const { G, load } = makeEngine({ extra: [] });
load('ui/puzzles.js');
const { Pipes, Lights, Code, Logic, parseExpr } = G.Puzzles;
const SEEDS = 500;

test(`pipes: ${SEEDS} seeds × 8 sizes — generated unsolved, solvable by rotating path cells`, () => {
  const sizes = [[3, 3], [4, 3], [5, 3], [5, 4], [6, 4], [7, 5], [8, 6], [4, 6]];
  let n = 0;
  for (const [w, h] of sizes) for (let s = 0; s < SEEDS; s++) {
    const st = Pipes.create({ w, h }, s * 7919 + 13);
    assert(!Pipes.check(st).solved, `pre-solved w${w}h${h} seed ${s}`);
    const k = pipesClicks(st);
    assert(!k.includes(-1), `unreachable cell target w${w}h${h} seed ${s}`);
    k.forEach((c, i) => { st.cells[i].rot = (st.cells[i].rot + c) % 4; });
    assert(Pipes.check(st).solved, `not solved after applying path w${w}h${h} seed ${s}`);
    n++;
  }
  assert(n === sizes.length * SEEDS);
});
test('pipes: source enters from the west, sink exits east, path stays in grid', () => {
  for (let s = 0; s < SEEDS; s++) {
    const st = Pipes.create({ w: 6, h: 4 }, s);
    const path = st.cells.map((c, i) => [c, i]).filter(([c]) => c.onPath);
    assert(path.length >= 6, 'path shorter than grid width');
    assert(st.cells[st.sr * 6].onPath && st.cells[st.kr * 6 + 5].onPath, 'source/sink cell not on path');
  }
});
test(`lights: ${SEEDS} seeds × n=3,4,5 — unsolved at start and solvable (GF(2))`, () => {
  for (const n of [3, 4, 5]) for (const presses of [1, 3, 5, 8]) for (let s = 0; s < SEEDS; s++) {
    const st = Lights.create({ n, presses }, s * 31 + presses);
    assert(!st.on.every(Boolean), `pre-solved n${n} seed ${s}`);
    const sol = lightsSolve(st.on, n);
    assert(sol, `unsolvable n${n} p${presses} seed ${s}`);
    for (const i of sol) Lights.press(st, i, true);
    assert(st.on.every(Boolean), `solution failed n${n} seed ${s}`);
  }
});
test('lights: restart restores the initial board', () => {
  const st = Lights.create({ n: 3, presses: 3 }, 5);
  const init = st.on.slice(); Lights.press(st, 4, true);
  const inp = { pointer: {}, pressed: (a) => a === 'restart', typed: '' };
  Lights.input(st, inp); assert.eq(JSON.stringify(st.on), JSON.stringify(init));
});
test('logic parser: precedence ! > & > ^ > | and parens, vs reference over random exprs', () => {
  const rnd = G.rng(42); const V = ['A', 'B', 'C', 'D'];
  const gen = (d) => {
    const r = rnd();
    if (d <= 0 || r < 0.3) return (rnd() < 0.25 ? '!' : '') + V[Math.floor(rnd() * 4)];
    if (r < 0.4) return '!(' + gen(d - 1) + ')';
    if (r < 0.5) return '(' + gen(d - 1) + ')';
    return gen(d - 1) + ' ' + ['&', '|', '^'][Math.floor(rnd() * 3)] + ' ' + gen(d - 1);
  };
  for (let i = 0; i < 400; i++) {
    const src = gen(4); const f = parseExpr(src);
    // reference: JS with & → &&, | → ||, ^ → !== on booleans, precedence & > ^ > | matches JS (&&? no) — build explicitly
    const js = src.replace(/!/g, ' !').replace(/&/g, '&&').replace(/\|/g, '||').replace(/\^/g, '!=');
    for (let m = 0; m < 16; m++) {
      const env = { A: !!(m & 1), B: !!(m & 2), C: !!(m & 4), D: !!(m & 8) };
      // JS precedence: ! > && > != ... but != binds tighter than && in JS, so evaluate via explicit tree instead
      const ref = refEval(src, env);
      assert.eq(f(env), ref, `${src} @${m}`);
    }
    void js;
  }
  function refEval(s0, env) { // independent shunting-yard
    const s = s0.replace(/\s+/g, ''); const out = [], ops = []; const prec = { '!': 4, '&': 3, '^': 2, '|': 1 };
    const apply = (op) => { if (op === '!') out.push(!out.pop()); else { const b = out.pop(), a = out.pop(); out.push(op === '&' ? a && b : op === '|' ? a || b : a !== b); } };
    for (const ch of s) {
      if (/[A-Z]/.test(ch)) out.push(!!env[ch]);
      else if (ch === '(') ops.push(ch);
      else if (ch === ')') { while (ops[ops.length - 1] !== '(') apply(ops.pop()); ops.pop(); }
      else if (ch === '!') ops.push(ch);
      else { while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[ch]) apply(ops.pop()); ops.push(ch); }
    }
    while (ops.length) apply(ops.pop());
    return out[0];
  }
});
test('logic: start state is never already solved (many seeds; defs with ≤ half solutions, as validator enforces)', () => {
  const defs = [{ inputs: ['A', 'B'], outputs: [{ expr: 'A&B' }] }, { inputs: ['A', 'B', 'C'], outputs: [{ expr: '(A|B) & !C' }] }, { inputs: ['A', 'B', 'C', 'D', 'E'], outputs: [{ expr: '(A ^ B) & !E' }, { expr: '(C & D) ^ (B | E)' }, { expr: '(A | E) & (C ^ (B & D))' }] }, { inputs: ['A', 'B', 'C', 'D'], outputs: [{ expr: 'A ^ C' }, { expr: '!A ^ (C & D)' }, { expr: '(B | D) & !(A & C)' }] }];
  for (const d of defs) for (let s = 0; s < SEEDS; s++) { const st = Logic.create(d, s); assert(!Logic.solved(st), `pre-solved ${JSON.stringify(d.outputs)} seed ${s}`); }
});
test('code: correct entry solves, wrong entry resets, C clears, OK checks', () => {
  const st = Code.create({ code: '492' });
  assert(!Code.keyPress(st, '4') && !Code.keyPress(st, '9')); assert(Code.keyPress(st, '2'), 'correct code');
  const s2 = Code.create({ code: '492' }); Code.keyPress(s2, '1'); Code.keyPress(s2, '1'); assert(!Code.keyPress(s2, '1')); assert.eq(s2.entry, ''); assert(s2.err > 0);
  Code.keyPress(s2, '4'); Code.keyPress(s2, 'C'); assert.eq(s2.entry, '');
  const s3 = Code.create({ code: 1234 }); assert.eq(s3.code, '1234', 'numeric code coerced');
});
test('every campaign terminal puzzle (real seed) is solvable', () => {
  const fs = require('fs'), path = require('path');
  for (const f of fs.readdirSync(path.join(__dirname, '../../src/js/levels'))) if (f !== 'order.js') load('levels/' + f);
  let n = 0;
  for (const id of Object.keys(G.levels)) for (const e of G.levels[id].entities || []) {
    if (e.type !== 'terminal' || !e.puzzle) continue;
    const p = e.puzzle; const seed = p.seed != null ? p.seed : G.hash(id + ':' + (e.id || e.x + ',' + e.y));
    const where = `${id} terminal @${e.x},${e.y} (${p.type})`;
    if (p.type === 'pipes') { const st = Pipes.create(p, seed); assert(!pipesClicks(st).includes(-1), where); }
    if (p.type === 'lights') { const st = Lights.create(p, seed); assert(lightsSolve(st.on, st.n), where); }
    if (p.type === 'logic') { const st = Logic.create(p, seed); assert(logicSolve(st.inputs, st.outputs.map((o) => o.fn)), where + ' unsatisfiable'); assert(!Logic.solved(st), where + ' pre-solved'); }
    if (p.type === 'code') assert(/^\d{2,6}$/.test(String(p.code)), where);
    n++;
  }
  assert(n >= 7, 'expected ≥7 campaign terminals, found ' + n);
});
report('puzzles');
