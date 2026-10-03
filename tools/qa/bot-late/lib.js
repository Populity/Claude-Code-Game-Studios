// Map builder helpers for l08-l10 (scratch tooling; output is plain level files).
const fs = require('fs');

class Grid {
  constructor(w, h, ch = '.') { this.w = w; this.h = h; this.g = Array.from({ length: h }, () => Array(w).fill(ch)); }
  set(x, y, ch) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y][x] = ch; }
  get(x, y) { return this.g[y] && this.g[y][x]; }
  rect(x0, y0, x1, y1, ch = '#') { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, ch); return this; }
  clear(x0, y0, x1, y1) { return this.rect(x0, y0, x1, y1, '.'); }
  put(x, y, s) { for (let i = 0; i < s.length; i++) if (s[i] !== ' ') this.set(x + i, y, s[i]); return this; }
  rows() { return this.g.map((r) => r.join('')); }
  view(x0 = 0, x1 = this.w - 1, y0 = 0, y1 = this.h - 1) {
    const out = [];
    let hdr = '    ';
    for (let x = x0; x <= x1; x++) hdr += x % 10 === 0 ? String(Math.floor(x / 10) % 10) : ' ';
    out.push(hdr);
    hdr = '    '; for (let x = x0; x <= x1; x++) hdr += String(x % 10); out.push(hdr);
    for (let y = y0; y <= y1; y++) out.push(String(y).padStart(3) + ' ' + this.g[y].slice(x0, x1 + 1).join(''));
    return out.join('\n');
  }
}

function js(v, ind = '') {
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || (Array.isArray(x) && x.every((y) => typeof y !== 'object')))) return '[' + v.map((x) => js(x)).join(', ') + ']';
    return '[\n' + v.map((x) => ind + '  ' + js(x, ind + '  ')).join(',\n') + ',\n' + ind + ']';
  }
  if (v && typeof v === 'object') {
    const parts = Object.entries(v).map(([k, x]) => (/^[a-zA-Z_]\w*$/.test(k) ? k : JSON.stringify(k)) + ': ' + js(x, ind));
    const one = '{ ' + parts.join(', ') + ' }';
    return one;
  }
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
  return String(v);
}

function emit(file, header, def, grid) {
  const lines = [];
  lines.push(header.trim());
  lines.push('G.registerLevel({');
  for (const k of ['id', 'chapter', 'chapterShort', 'title', 'biome', 'variant', 'music', 'drone', 'objective', 'startDialogue']) {
    if (def[k] !== undefined) lines.push(`  ${k}: ${js(def[k])},`);
  }
  lines.push('  map: [');
  const rows = grid.rows();
  rows.forEach((r, i) => lines.push(`    '${r}', // ${i}`));
  lines.push('  ],');
  for (const k of ['entities', 'triggers', 'decor']) {
    lines.push(`  ${k}: [`);
    for (const e of def[k] || []) {
      if (typeof e === 'string') { lines.push('    // ' + e); continue; }
      lines.push('    ' + js(e, '    ') + ',');
    }
    lines.push('  ],');
  }
  lines.push('});');
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

module.exports = { Grid, emit, js };
