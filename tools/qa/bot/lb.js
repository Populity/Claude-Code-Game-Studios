const fs = require('fs');
class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.g = [...Array(h)].map(() => Array(w).fill('.')); }
  r(x0, y0, x1, y1, c = '#') { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) throw new Error(`r out of bounds ${x},${y}`); this.g[y][x] = c; } return this; }
  s(x, y, c) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) throw new Error(`s out of bounds ${x},${y}`); this.g[y][x] = c; return this; }
  rows() { return this.g.map((r) => r.join('')); }
}
function lit(v, ind = '') {
  if (Array.isArray(v)) return '[' + v.map((x) => lit(x, ind)).join(', ') + ']';
  if (v && typeof v === 'object') return '{ ' + Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${/^[a-zA-Z_]\w*$/.test(k) ? k : `'${k}'`}: ${lit(x, ind)}`).join(', ') + ' }';
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  return String(v);
}
function emit(file, header, def, grid) {
  const lines = [];
  lines.push(header.trim());
  lines.push('G.registerLevel({');
  for (const k of ['id', 'chapter', 'chapterShort', 'title', 'biome', 'variant', 'music', 'drone', 'objective', 'startDialogue']) if (def[k] !== undefined) lines.push(`  ${k}: ${lit(def[k])},`);
  lines.push('  map: [');
  const rows = grid.rows();
  const tens = rows[0].length;
  // column ruler comment
  let ruler = ''; for (let x = 0; x < tens; x++) ruler += x % 10 === 0 ? String((x / 10) % 10) : ' ';
  lines.push(`    //${ruler}`);
  rows.forEach((r, i) => lines.push(`    '${r}', // ${i}`));
  lines.push('  ],');
  for (const k of ['entities', 'triggers', 'decor']) {
    lines.push(`  ${k}: [`);
    for (const e of def[k] || []) {
      if (typeof e === 'string') { lines.push(`    // ${e}`); continue; }
      lines.push(`    ${lit(e)},`);
    }
    lines.push('  ],');
  }
  lines.push('});');
  fs.writeFileSync(file, lines.join('\n') + '\n');
}
module.exports = { Grid, emit, lit };
