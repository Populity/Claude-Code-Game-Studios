/**
 * Planned route runner. A route is a list of legs; each leg has a goal (+ heuristic). The recorded macro
 * path for every leg is cached in route_<id>.json; on replay the cached path is executed and verified
 * (goal reached, no death). If a leg's cached path no longer works (engine/level changed) it is
 * re-searched with best-first search (deterministic) and the cache is updated — the run then reports
 * REPLANNED so a human can review. Output: "RESULT deaths=N completed=bool" + SHARD lines.
 */
const fs = require('fs'), path = require('path');
const { World, search } = require('./world');
function runPlanned(id, legs, { replan = process.argv.includes('--replan') } = {}) {
  const cacheFile = path.join(__dirname, `route_${id}.json`);
  const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
  const w = new World(id); let changed = false, failed = null;
  for (const leg of legs) {
    if (leg.wait) { for (let i = 0; i < leg.wait; i++) w.tick({}); continue; }
    if (leg.use) { w.tick({}); w.tick({ action: true }); w.tick({}); if (leg.check && !leg.check(w)) { failed = `use '${leg.name}' had no effect at ${w.tile()}`; break; } continue; }
    const goal = leg.goal;
    let ok = false;
    const cached = !replan && cache[leg.name];
    if (cached) {
      const s0 = w.snap(); let r = 'ok';
      for (const m of cached) { r = w.applyMacro(m, goal); if (r !== 'ok') break; }
      if (r === 'hit' || goal(w)) ok = true; else w.restore(s0);
    }
    if (!ok) {
      const res = search(w, goal, leg.h, leg.opts || {});
      if (!res.path) { failed = `leg '${leg.name}' unreachable from ${w.tile()} (${res.nodes} nodes)`; break; }
      for (const m of res.path) if (w.applyMacro(m, goal) !== 'ok') break;
      cache[leg.name] = res.path; changed = true;
      console.log(`REPLANNED leg ${leg.name}: ${res.path.length} macros (${res.nodes} nodes)`);
    }
    console.log(`leg ${leg.name.padEnd(18)} -> ${JSON.stringify(w.tile())} t=${(w.frame / 60).toFixed(1)}s deaths=${w.deaths}`);
  }
  // let the exit register if the last leg ended on it
  for (let i = 0; i < 5 && !w.completed && !failed; i++) w.tick({});
  if (changed) fs.writeFileSync(cacheFile, JSON.stringify(cache));
  for (const l of w.log) if (/^SHARD|^DEATH/.test(l)) console.log(l);
  if (failed) console.log('ABORT ' + failed);
  console.log(`RESULT deaths=${w.deaths} completed=${w.completed && !failed}`);
  return w;
}
const at = (x0, x1, row0, row1) => (w) => { const [x, f] = w.tile(); return x >= x0 && x <= x1 && f >= row0 - 0.05 && f <= row1 + 0.05 && w.player.onGround; };
const toward = (x, row, kx = 0.3) => (w) => { const [cx, f] = w.tile(); return Math.abs(cx - x) * kx + Math.abs(f - row); };
const cpLit = (tx) => (w) => w.level.entities.some((e) => e.type === 'checkpoint' && e.tx === tx && e.lit);
module.exports = { runPlanned, at, toward, cpLit };
