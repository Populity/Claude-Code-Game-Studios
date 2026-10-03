#!/usr/bin/env node
/**
 * Static validator for TESSERA level files. Reports observations (errors / warnings),
 * never edits files. Usage: node tools/validate-levels.js [levelId ...]
 *
 * Checks: map shape, P/E/C placement, entity types + required fields, bounds,
 * signal wiring, dialogue ids vs script, required story ids per level (design/game-brief.md),
 * logic-puzzle satisfiability, deco kinds.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'js');
const ctx = { console, Math, JSON, Object, Array, Set, Map, Uint8Array, String, Number, Boolean, Error };
ctx.window = ctx;
ctx.localStorage = { getItem: () => null, setItem: () => {} };
vm.createContext(ctx);
const load = (f) => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });

load('config.js');
load('core/util.js');
ctx.G.Audio = { play() {}, music() {} };
ctx.G.fx = { burst() {}, dust() {}, shake() {} };
load('world/level.js');
load('world/physics.js');
load('world/entities.js');
try { load('config-bosses.js'); } catch (e) { /* optional */ }
try { load('world/bosses.js'); } catch (e) { /* boss module optional */ }
try { load('story/script.js'); } catch (e) { console.log('! script.js failed to load:', e.message); }

const levelFiles = fs.readdirSync(path.join(SRC, 'levels')).filter((f) => f.endsWith('.js') && f !== 'order.js');
const warnCapture = [];
const origWarn = console.warn;
for (const f of levelFiles) {
  try { load('levels/' + f); } catch (e) { console.log(`✖ ${f}: failed to load: ${e.message}`); }
}
try { load('levels/order.js'); } catch (e) { console.log('✖ order.js:', e.message); }

const REQUIRED = {
  p1: ['p1_wake', 'p1_door', 'p1_sparks', 'p1_end'],
  p2: ['p2_start', 'p2_reactor', 'p2_fixed', 'p2_shaft', 'p2_breaking', 'p2_pod'],
  l01: ['l01_start', 'l01_lum_found', 'l01_fuse', 'l01_lum_wake', 'l01_horizon'],
  l02: ['l02_start', 'l02_dunes_sing', 'l02_gate', 'l02_gate_open'],
  l03: ['l03_start', 'l03_walls', 'l03_tower_sight', 'l03_end'],
  l04: ['l04_start', 'l04_glyphs', 'l04_message', 'l04_end'],
  l05: ['l05_start', 'l05_acid', 'l05_footprints', 'l05_end'],
  l06: ['l06_start', 'l06_cryo', 'l06_orion', 'l06_plan', 'l06_end'],
  l07: ['l07_start', 'l07_crystals', 'l07_logic', 'l07_end'],
  l08: ['l08_start', 'l08_helmet', 'l08_doubt', 'l08_end'],
  l09: ['l09_start', 'l09_storm', 'l09_halfway', 'l09_top'],
  l10: ['l10_start', 'l10_core', 'l10_final'],
  l11: ['l11_start', 'l11_echo_meet', 'l11_dash_get', 'l11_end'],
  l12: ['l12_start', 'l12_wind', 'l12_sentinel', 'l12_end'],
  l13: ['l13_start', 'l13_echo_truth', 'l13_final'],
};
const CUTSCENES = ['intro', 'crash', 'ending', 'ch2_intro', 'ch2_end'];
const BIOMES = ['ship', 'wreck', 'desert', 'canyon', 'ruins', 'caves', 'crystal', 'tower'];
const DECO = ['cryo_pod', 'console', 'pipes', 'cable_bundle', 'locker', 'window_space', 'warning_light', 'hull_breach', 'crate_stack', 'fan',
  'pod_wreck', 'debris', 'fire', 'rock', 'bones', 'monolith', 'singing_pillar', 'dune_grass', 'spire_far',
  'pillar', 'broken_pillar', 'statue', 'glyph_wall', 'arch', 'vines', 'helmet',
  'stalagmite', 'mushroom', 'pipe_outlet', 'glow_moss', 'footprints', 'crystal_cluster', 'crystal_big', 'geode',
  'antenna', 'beacon_core', 'storm_rod', 'lamp', 'sign_post', 'tablet_shelf', 'data_pillar', 'echo_statue', 'ring_machine', 'conduit'];
const ITEMS = ['fuse', 'cell', 'gear', 'lens', 'chip', 'core', 'valve', 'antenna'];

const only = process.argv.slice(2);
let totalErr = 0, totalWarn = 0;
const G = ctx.G;
const script = G.Script || {};

function satisfiable(p) {
  const inputs = p.inputs || ['A', 'B', 'C'];
  const outs = (p.outputs || []).map((o) => G.Puzzles ? null : o);
  const parse = (src) => { // same grammar as ui/puzzles.js
    let i = 0; const s = src.replace(/\s+/g, '');
    const prim = () => { if (s[i] === '!') { i++; const v = prim(); return (e) => !v(e); } if (s[i] === '(') { i++; const v = or(); i++; return v; } const id = s[i++]; if (!/[A-Z]/.test(id)) throw new Error('bad token ' + id); return (e) => !!e[id]; };
    const and = () => { let l = prim(); while (s[i] === '&') { i++; const a = l, b = prim(); l = (e) => a(e) && b(e); } return l; };
    const xor = () => { let l = and(); while (s[i] === '^') { i++; const a = l, b = and(); l = (e) => a(e) !== b(e); } return l; };
    const or = () => { let l = xor(); while (s[i] === '|') { i++; const a = l, b = xor(); l = (e) => a(e) || b(e); } return l; };
    const f = or(); if (i !== s.length) throw new Error('trailing input in ' + src); return f;
  };
  const fns = (p.outputs || [{ expr: p.expr || 'A&B' }]).map((o) => parse(o.expr));
  let count = 0;
  for (let m = 0; m < 1 << inputs.length; m++) {
    const env = {}; inputs.forEach((k, j) => { env[k] = !!(m & (1 << j)); });
    if (fns.every((f) => f(env))) count++;
  }
  return count;
}

const order = (G.LEVEL_ORDER || []).map((e) => e.id);
for (const id of Object.keys(G.levels)) {
  if (only.length && !only.includes(id)) continue;
  const def = G.levels[id];
  const errs = [], warns = [];
  const E = (m) => errs.push(m), Wn = (m) => warns.push(m);
  const rows = def.map || [];
  const w = Math.max(...rows.map((r) => r.length));
  rows.forEach((r, i) => { if (r.length !== w) Wn(`row ${i} length ${r.length} ≠ ${w} (padded with '.')`); if (/[^.#=^v~XPCEB*JI{} ]/.test(r)) E(`row ${i} has unknown chars: ${r.replace(/[.#=^v~XPCEB*JI{} ]/g, '')}`); });
  const count = (ch) => rows.reduce((n, r) => n + r.split(ch).length - 1, 0);
  if (count('P') !== 1) E(`expected exactly one P, found ${count('P')}`);
  if (count('E') < 1) E('no exit E');
  if (!BIOMES.includes(def.biome)) E(`unknown biome '${def.biome}'`);
  if (!def.title) E('missing title');
  const at = (x, y) => (y >= 0 && y < rows.length && x >= 0 && x < w ? (rows[y][x] || '.') : x < 0 || x >= w ? '#' : '.');
  const solidBelow = (x, y) => '#XI{}'.includes(at(x, y + 1)) || at(x, y + 1) === '=';
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if ('PCEB'.includes(ch) && !solidBelow(x, y) && ch !== 'B') Wn(`'${ch}' at ${x},${y} has no solid ground below`);
    if (ch === 'P' && (at(x, y - 1) === '#')) E(`P at ${x},${y} has no headroom (needs 2 tiles)`);
    if (ch === '^' && !'#X'.includes(at(x, y + 1))) Wn(`spike '^' at ${x},${y} floating (no ground below)`);
  }));
  let L;
  const warnsBefore = [];
  console.warn = (...a) => warnsBefore.push(a.join(' '));
  try { L = new G.Level(def); } catch (e) { E('Level construction failed: ' + e.stack); }
  console.warn = origWarn;
  warnsBefore.forEach((m) => E(m));
  const usedIds = new Set();
  const addId = (v) => v && usedIds.add(v);
  if (def.startDialogue) addId(def.startDialogue);
  for (const e of def.entities || []) {
    const req = { lever: ['targets'], plate: ['targets'], terminal: ['puzzle', 'targets'], part: ['item'], socket: ['needs', 'targets'], door: ['id'], bridge: ['id'], laser: ['dir'], saw: ['path'], sign: [], hint: ['text'], mplatform: [], anchor: [], wind: ['w', 'h', 'dir'], dashcrystal: [], fallplat: [], sentinel: [], npc: ['who', 'dialogue'], boss: ['kind'], pickup: ['kind'], stalactite: [], mine: [], geyser: [], collapse: ['w', 'h'] }[e.type];
    if (!req) { if (!G.EntityTypes[e.type]) E(`unknown entity type ${e.type}`); continue; }
    for (const k of req) if (e[k] == null && !(k === 'targets' && e.target)) E(`${e.type} at ${e.x},${e.y} missing '${k}'`);
    if (e.x < 0 || e.x >= w || e.y < 0 || e.y >= rows.length) E(`${e.type} at ${e.x},${e.y} out of bounds`);
    if (['lever', 'terminal', 'part', 'socket', 'sign'].includes(e.type) && at(e.x, e.y) === '#') E(`${e.type} at ${e.x},${e.y} is inside a solid tile`);
    if (['lever', 'terminal', 'socket', 'plate', 'sign'].includes(e.type) && !solidBelow(e.x, e.y)) Wn(`${e.type} at ${e.x},${e.y} not standing on ground`);
    if (e.type === 'part' && !ITEMS.includes(e.item)) E(`part item '${e.item}' unknown`);
    if (e.type === 'socket' && !ITEMS.includes(e.needs)) E(`socket needs '${e.needs}' unknown`);
    if (e.type === 'socket' && !(def.entities || []).some((p) => p.type === 'part' && p.item === e.needs)) E(`socket at ${e.x},${e.y} needs '${e.needs}' but no such part in level`);
    if (e.type === 'terminal' && e.puzzle) {
      const p = e.puzzle;
      if (!['pipes', 'lights', 'code', 'logic'].includes(p.type)) E(`terminal puzzle type '${p.type}' unknown`);
      if (p.type === 'logic') { try { const n = satisfiable(p); if (!n) E(`logic puzzle at ${e.x},${e.y} is UNSATISFIABLE`); else if (n > (1 << (p.inputs || []).length) / 2) Wn(`logic puzzle at ${e.x},${e.y} is very easy (${n} solutions)`); } catch (err) { E('logic expr parse: ' + err.message); } }
      if (p.type === 'code' && !/^\d{2,6}$/.test(String(p.code))) E(`code '${p.code}' must be 2–6 digits`);
      if (p.type === 'pipes' && ((p.w || 5) > 8 || (p.h || 4) > 6)) Wn('pipes puzzle larger than 8×6 may not fit');
    }
    if (e.type === 'pickup' && !['medkit', 'heart', 'shield', 'glider', 'jetpack', 'boots', 'slowmo'].includes(e.kind)) E(`pickup at ${e.x},${e.y} unknown kind '${e.kind}'`);
    if (e.type === 'stalactite' && at(e.x, e.y - 1) !== '#') Wn(`stalactite at ${e.x},${e.y} has no solid ceiling above`);
    if ((e.type === 'mine' || e.type === 'geyser') && at(e.x, e.y + 1) !== '#') Wn(`${e.type} at ${e.x},${e.y} is not on a floor tile`);
    if (e.type === 'npc' && e.recruit && e.recruit !== 'rex') E(`npc recruit '${e.recruit}' unknown`);
    if (e.type === 'wind' && !['up', 'down', 'left', 'right'].includes(e.dir)) E(`wind at ${e.x},${e.y} bad dir '${e.dir}'`);
    if (e.type === 'npc' && e.dialogue && script[e.dialogue + '_again']) addId(e.dialogue + '_again');
    if (e.type === 'sentinel' && at(e.x, e.y) === '#') E(`sentinel at ${e.x},${e.y} inside a solid tile`);
    if (e.type === 'mplatform' || e.type === 'saw' || e.type === 'sentinel') for (const pt of e.path || []) if (pt[0] < 0 || pt[0] >= w || pt[1] < 0 || pt[1] >= rows.length) E(`${e.type} path point ${pt} out of bounds`);
    addId(e.onSolve); addId(e.onPickup); addId(e.onRepair); addId(e.dialogue);
  }
  for (const tr of def.triggers || []) { addId(tr.dialogue); if (tr.grant && !['dash'].includes(tr.grant)) E(`trigger grant '${tr.grant}' unknown`); if (tr.x < 0 || tr.x >= w) E(`trigger at ${tr.x},${tr.y} out of bounds`); if (tr.requires && !L?.byId[tr.requires]) E(`trigger requires unknown id ${tr.requires}`); }
  for (const d of def.decor || []) if (!DECO.includes(d.kind)) Wn(`decor kind '${d.kind}' not in the art contract`);
  if (L) {
    for (const e of L.entities) {
      if (['door', 'bridge'].includes(e.type) && !L.sourcesFor[e.id]) Wn(`${e.type} '${e.id}' has no sources (permanently ${e.type === 'door' ? 'closed' : 'absent'})`);
    }
    if (def.drone && typeof def.drone === 'object' && def.drone.wakeOn && !L.byId[def.drone.wakeOn]) E(`drone.wakeOn '${def.drone.wakeOn}' not found`);
  }
  for (const sid of usedIds) if (!script[sid]) Wn(`dialogue id '${sid}' not in G.Script (yet)`);
  for (const sid of REQUIRED[id] || []) if (!usedIds.has(sid)) E(`required story id '${sid}' is not placed in this level`);
  const cps = count('C');
  const info = `${w}×${rows.length} tiles, ${cps} checkpoints, ${(def.entities || []).length} entities, ${count('*')} shards`;
  totalErr += errs.length; totalWarn += warns.length;
  console.log(`${errs.length ? '✖' : '✔'} ${id}${order.includes(id) ? '' : ' (not in campaign order)'}: ${info}`);
  errs.forEach((m) => console.log('   ERROR ' + m));
  warns.forEach((m) => console.log('   warn  ' + m));
}
if (!only.length) {
  for (const c of CUTSCENES) if (!(G.Cutscenes || {})[c]) { console.log(`   warn  cutscene '${c}' missing from G.Cutscenes`); totalWarn++; }
  for (const id of Object.keys(REQUIRED)) if (!G.levels[id]) { console.log(`   warn  level '${id}' not written yet`); totalWarn++; }
}
console.log(`\n${totalErr} error(s), ${totalWarn} warning(s)`);
process.exit(totalErr ? 1 : 0);
