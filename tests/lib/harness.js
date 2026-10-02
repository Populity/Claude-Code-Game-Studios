/** Tiny test harness: test(name, fn); report() prints results and returns {pass, fail}. */
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e && e.message || String(e) }); }
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
assert.eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
assert.near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) throw new Error(`${msg || 'not near'}: got ${a}, want ${b}±${tol}`); };
function report(suite) {
  let pass = 0, fail = 0;
  for (const r of results) { if (r.ok) pass++; else { fail++; console.log(`  FAIL ${suite} :: ${r.name}\n       ${r.err}`); } }
  console.log(`RESULT ${JSON.stringify({ suite, pass, fail })}`);
  process.exitCode = fail ? 1 : 0;
  return { pass, fail };
}
module.exports = { test, assert, report };
