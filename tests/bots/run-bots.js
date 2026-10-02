/**
 * Route bots: every campaign level must be completable start→exit with 0 deaths,
 * running the REAL engine world code headless. Also counts shards collected on the route.
 * Usage: node tests/bots/run-bots.js [levelId ...]
 */
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');
const LEVELS = ['p1', 'p2', 'l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08', 'l09', 'l10'];
// min shards the canonical route collects (regression floor); extra shards verified in shards.js
const SHARD_FLOOR = { p1: 1, p2: 2, l01: 1, l02: 1, l03: 0, l04: 2, l05: 2, l06: 2, l07: 2, l08: 0, l09: 0, l10: 0 };
const only = process.argv.slice(2);
const rows = [];
for (const id of LEVELS) {
  if (only.length && !only.includes(id)) continue;
  const file = ['early', 'late', 'final'].map((d) => path.join(__dirname, d, `route_${id}.js`)).find((f) => fs.existsSync(f));
  if (!file) { rows.push({ id, status: 'PENDING', note: 'no route yet' }); continue; }
  const t0 = Date.now(); let out = '', err = null;
  try { out = execFileSync('node', [file], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { err = e; out = (e.stdout || '') + (e.stderr || ''); }
  let done = false, deaths = -1;
  let m = out.match(/deaths=(\d+) done=(true|false)/); if (m) { deaths = +m[1]; done = m[2] === 'true'; }
  m = out.match(/deaths (\d+) completed (true|false)/); if (m) { deaths = +m[1]; done = m[2] === 'true'; }
  m = out.match(/RESULT deaths=(\d+) completed=(true|false)/); if (m) { deaths = +m[1]; done = m[2] === 'true'; }
  const shards = (out.match(/shard #|"SHARD"|^SHARD /gm) || []).length;
  const checkFails = (out.match(/CHECK FAILED|ABORT|TIMEOUT/g) || []).length;
  const ok = !err && done && deaths === 0 && checkFails === 0 && shards >= SHARD_FLOOR[id];
  rows.push({ id, status: ok ? 'PASS' : 'FAIL', note: `done=${done} deaths=${deaths} shards=${shards} checks-failed=${checkFails} ${((Date.now() - t0) / 1000).toFixed(1)}s` + (err ? ' ERROR ' + String(err.message).split('\n')[0] : '') });
  if (!ok) console.log(out.split('\n').slice(-25).join('\n'));
}
for (const r of rows) console.log(`  ${r.status.padEnd(7)} bot ${r.id.padEnd(4)} ${r.note}`);
const fail = rows.filter((r) => r.status === 'FAIL').length, pend = rows.filter((r) => r.status === 'PENDING').length;
console.log(`RESULT ${JSON.stringify({ suite: 'bots', pass: rows.length - fail - pend, fail, pending: pend })}`);
process.exitCode = fail ? 1 : 0;
