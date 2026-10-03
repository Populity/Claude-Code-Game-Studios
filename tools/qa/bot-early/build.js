// Level builder: programmatic map drawing -> literal level file.
const fs = require('fs');
const path = require('path');
const OUT = '/home/user/Claude-Code-Game-Studios/src/js/levels';

class Grid {
  constructor(w, h, fill = '.') { this.w = w; this.h = h; this.g = Array.from({ length: h }, () => Array(w).fill(fill)); }
  set(x, y, ch) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) throw new Error(`set out of bounds ${x},${y}`); this.g[y][x] = ch; }
  get(x, y) { return this.g[y] && this.g[y][x]; }
  rect(x0, y0, x1, y1, ch = '#') { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, ch); return this; }
  clear(x0, y0, x1, y1) { return this.rect(x0, y0, x1, y1, '.'); }
  hline(x0, x1, y, ch) { return this.rect(x0, y, x1, y, ch); }
  vline(x, y0, y1, ch) { return this.rect(x, y0, x, y1, ch); }
  str(x, y, s) { [...s].forEach((c, i) => { if (c !== ' ') this.set(x + i, y, c); }); return this; }
  rows() { return this.g.map((r) => r.join('')); }
}

function lit(v, ind) {
  if (v === null || v === undefined) return 'undefined';
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[' + v.map((x) => lit(x, ind)).join(', ') + ']';
  const ks = Object.keys(v).filter((k) => v[k] !== undefined);
  return '{ ' + ks.map((k) => `${/^[a-zA-Z_]\w*$/.test(k) ? k : lit(k)}: ${lit(v[k], ind)}`).join(', ') + ' }';
}

function emit(meta, grid, { entities = [], triggers = [], decor = [], header = '' }) {
  const rows = grid.rows();
  let s = header.trim() + '\n';
  s += 'G.registerLevel({\n';
  for (const [k, v] of Object.entries(meta)) s += `  ${k}: ${lit(v)},\n`;
  s += '  map: [\n' + rows.map((r, i) => `    '${r}', // ${String(i).padStart(2)}`).join('\n') + '\n  ],\n';
  const arr = (name, a) => `  ${name}: [\n` + a.map((e) => '    ' + (e.__c ? `// ${e.__c}` : lit(e)) + (e.__c ? '' : ',')).join('\n') + '\n  ],\n';
  s += arr('entities', entities);
  s += arr('triggers', triggers);
  s += arr('decor', decor);
  s += '});\n';
  fs.writeFileSync(path.join(OUT, meta.id + '.js'), s);
  return s;
}
const C = (text) => ({ __c: text }); // comment line inside an array

function show(grid) {
  const rows = grid.rows();
  const w = rows[0].length;
  let tens = '    ', ones = '    ';
  for (let x = 0; x < w; x++) { tens += x % 10 === 0 ? String((x / 10) % 10) : ' '; ones += x % 10; }
  console.log(tens + '\n' + ones);
  rows.forEach((r, i) => console.log(String(i).padStart(3) + ' ' + r));
}

module.exports = { Grid, emit, show, C };
