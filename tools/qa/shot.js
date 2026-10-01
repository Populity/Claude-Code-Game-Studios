/**
 * QA helper: open the game headless, optionally run a scripted input sequence,
 * screenshot and report console errors.
 * Usage: node tools/qa/shot.js "<query>" out.png [script.json]
 *   script.json: [{"keys":["ArrowRight"], "frames":60}, {"eval":"G.game.player.x"}]
 * Uses G.step() for deterministic frame advance (requestAnimationFrame is paused).
 */
const path = require('path');
const { chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'));
const http = require('http');
const fs = require('fs');

const root = path.join(__dirname, '..', '..', 'src');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (err, data) => {
        if (err) { resp.writeHead(404); resp.end(); return; }
        resp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        resp.end(data);
      });
    }).listen(0, () => res(srv));
  });
}

(async () => {
  const [query = '', out = 'shot.png', scriptFile] = process.argv.slice(2);
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(`http://localhost:${port}/index.html?${query}`);
  await page.waitForTimeout(400);
  // freeze rAF-driven loop timing by using deterministic steps
  await page.evaluate(() => { G.timeScale = 0; });
  const results = [];
  if (scriptFile) {
    const steps = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
    for (const s of steps) {
      if (s.keys) {
        for (const k of s.keys) await page.keyboard.down(k);
        await page.evaluate((n) => G.step(n), s.frames || 1);
        for (const k of s.keys) await page.keyboard.up(k);
      } else if (s.frames) await page.evaluate((n) => G.step(n), s.frames);
      if (s.eval) results.push(await page.evaluate(s.eval));
      if (s.shot) await page.screenshot({ path: s.shot });
    }
  } else await page.evaluate(() => G.step(30));
  await page.screenshot({ path: out });
  const errs = await page.evaluate(() => G.errors);
  console.log(JSON.stringify({ logs, errors: errs, results }, null, 1));
  await browser.close();
  srv.close();
})();
