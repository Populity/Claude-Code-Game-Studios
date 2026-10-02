#!/usr/bin/env node
/**
 * TESSERA unified regression suite. Usage: node tests/run-all.js [--skip-browser] [--only=unit,bots,...]
 * Suites: validator (tools/validate-levels.js), unit (physics, signals, puzzles, save),
 *         bots (route bots, all 12 campaign levels), browser (levels, cutscenes, title, puzzles via UI, campaign).
 * Prints a PASS/FAIL table; exit code 1 on any failure. No npm install (uses global playwright).
 */
const { spawnSync } = require('child_process');
const path = require('path');
const R = __dirname, ROOT = path.join(R, '..');
const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;
const suites = [
  { group: 'validator', name: 'level validator (static)', cmd: [path.join(ROOT, 'tools/validate-levels.js')] },
  { group: 'unit', name: 'unit: physics', cmd: [path.join(R, 'unit/physics.test.js')] },
  { group: 'unit', name: 'unit: signals', cmd: [path.join(R, 'unit/signals.test.js')] },
  { group: 'unit', name: 'unit: puzzles (500 seeds)', cmd: [path.join(R, 'unit/puzzles.test.js')] },
  { group: 'unit', name: 'unit: save data + flow', cmd: [path.join(R, 'unit/save.test.js')] },
  { group: 'bots', name: 'route bots (12 levels)', cmd: [path.join(R, 'bots/run-bots.js')] },
  { group: 'browser', name: 'browser smoke', cmd: [path.join(R, 'browser/smoke.js')] },
].filter((s) => (!only || only.includes(s.group)) && !(args.includes('--skip-browser') && s.group === 'browser'));
const table = []; const t0 = Date.now(); let anyFail = false;
for (const s of suites) {
  const t = Date.now();
  console.log(`\n=== ${s.name}`);
  const r = spawnSync('node', s.cmd, { encoding: 'utf8', timeout: 6 * 60 * 1000, cwd: ROOT });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out.split('\n').filter((l) => !/^RESULT \{/.test(l)).join('\n'));
  const m = out.match(/^RESULT (\{.*)$/m); const res = m ? JSON.parse(m[1]) : null;
  let detail = res ? `${res.pass} pass, ${res.fail} fail` + (res.pending ? `, ${res.pending} pending` : '') : '';
  if (s.group === 'validator') { const v = out.match(/(\d+) error\(s\), (\d+) warning\(s\)/); detail = v ? `${v[1]} errors, ${v[2]} warnings` : 'no summary'; }
  const ok = r.status === 0 && !r.error;
  if (!ok) anyFail = true;
  table.push([s.name, ok ? (res && res.pending ? 'PASS*' : 'PASS') : 'FAIL', detail, ((Date.now() - t) / 1000).toFixed(1) + 's']);
}
console.log('\n\n================ TESSERA regression summary ================');
const w = [34, 6, 34, 8];
console.log(['Suite', 'Result', 'Detail', 'Time'].map((h, i) => h.padEnd(w[i])).join(' | '));
console.log(w.map((n) => '-'.repeat(n)).join('-|-'));
for (const row of table) console.log(row.map((c, i) => String(c).padEnd(w[i])).join(' | '));
console.log(`\nTotal ${((Date.now() - t0) / 1000).toFixed(1)}s — ${anyFail ? 'FAIL' : 'PASS'}${table.some((r) => r[1] === 'PASS*') ? '  (* = some items pending, see above)' : ''}`);
process.exitCode = anyFail ? 1 : 0;
