#!/usr/bin/env node
/**
 * Build a single self-contained HTML page of TESSERA (all scripts inlined)
 * from src/index.html. Usage: node tools/build-single.js <out.html> [--fragment]
 * --fragment omits doctype/html/head/body (for hosts that wrap the page).
 */
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'src');
const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const [out, flag] = process.argv.slice(2);
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
let js = '';
for (const s of scripts) {
  const p = path.join(src, s);
  if (!fs.existsSync(p)) continue;
  js += `\n// ---- ${s} ----\n` + fs.readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script');
}
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600;700;800&family=Share+Tech+Mono&display=swap" rel="stylesheet">';
const body = `<canvas id="game" aria-label="Тессера — игра"></canvas>\n<script>${js}\n</script>`;
const page = flag === '--fragment'
  ? `<title>Тессера</title>\n${fonts}\n<style>${style}</style>\n${body}\n`
  : `<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<title>Тессера</title>\n${fonts}\n<style>${style}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024).toFixed(0)} KB, ${scripts.length} scripts)`);
