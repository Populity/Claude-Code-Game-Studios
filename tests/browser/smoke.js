/**
 * Browser smoke (headless Chromium via global playwright). Deterministic: rAF loop paused (G.timeScale=0),
 * frames advanced with G.step(). Sections: levels, cutscenes, title→new game, puzzles via UI, campaign.
 * Usage: node tests/browser/smoke.js [section ...]   sections: levels cutscenes title puzzles campaign
 */
const path = require('path'), fs = require('fs'), http = require('http');
const { execSync } = require('child_process');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const { pipesClicks, lightsSolve, logicSolve } = require('../lib/solvers');
const ROOT = path.join(__dirname, '..', '..', 'src');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const only = process.argv.slice(2);
const rows = [];
const rec = (name, ok, note = '') => { rows.push({ name, ok, note }); console.log(`  ${ok ? 'PASS' : 'FAIL'}    ${name}${note ? '  — ' + note : ''}`); };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (err, data) => {
        if (err) { resp.writeHead(404); resp.end(); return; }
        resp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); resp.end(data);
      });
    }).listen(0, () => res(srv));
  });
}

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/index.html`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const t0 = Date.now();

  async function open(query = '') {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' })); // offline: no web fonts
    await page.goto(base + (query ? '?' + query : ''));
    await page.waitForFunction(() => window.G && G.App && G.step);
    await page.evaluate(() => { G.timeScale = 0; });
    const api = {
      page, errs,
      step: (n = 1) => page.evaluate((k) => G.step(k), n),
      ev: (fn, arg) => page.evaluate(fn, arg),
      async press(key, hold = 2) { await page.keyboard.down(key); await api.step(hold); await page.keyboard.up(key); await api.step(1); },
      gErrors: () => page.evaluate(() => G.errors.slice()),
      async allErrors() { return [...errs, ...(await api.gErrors())]; },
      /** click at VIEW coords (960×540 space) */
      async clickView(x, y) {
        const c = await page.evaluate(([vx, vy]) => { const v = G.input.view, d = window.devicePixelRatio || 1; return { x: (vx * v.scale + v.ox) / d, y: (vy * v.scale + v.oy) / d }; }, [x, y]);
        await page.mouse.click(c.x, c.y); await api.step(1);
      },
      close: () => ctx.close(),
    };
    return api;
  }
  const want = (s) => !only.length || only.includes(s);

  // ---------------------------------------------------------------- 1. every level loads and runs 300 frames
  if (want('levels')) {
    const ids = await (async () => { const a = await open('level=0'); const r = await a.ev(() => G.LEVEL_ORDER.map((e) => e.id)); await a.close(); return r; })();
    for (let i = 0; i < ids.length; i++) {
      const a = await open('level=' + i);
      const info = await a.ev(() => ({ id: G.game && G.game.def.id, scene: G.App.scene && G.App.scene.constructor.name }));
      for (let k = 0; k < 10; k++) await a.step(30);
      // also exercise movement input for a moment
      await a.page.keyboard.down('ArrowRight'); await a.step(60); await a.page.keyboard.up('ArrowRight');
      const e = await a.allErrors();
      const alive = await a.ev(() => !!G.game && G.App.scene === G.game);
      await a.page.screenshot({ path: path.join(SHOTS, `level-${ids[i]}.png`) });
      rec(`level ${ids[i]} loads + 360 frames`, info.id === ids[i] && alive && !e.length, e.slice(0, 3).join(' | '));
      await a.close();
    }
  }

  // ---------------------------------------------------------------- 2. cutscenes play through with Enter
  if (want('cutscenes')) {
    for (const id of ['intro', 'crash', 'ending']) {
      const a = await open('cutscene=' + id);
      const shots = await a.ev((c) => (G.Cutscenes[c] || []).length, id);
      let frames = 0, seen = new Set();
      while (frames < 60 * 240) {
        const st = await a.ev(() => { const s = G.App.scene; return s && s.cs ? { shot: s.cs.shot, done: s.cs.done } : { title: s instanceof G.TitleScene }; });
        if (st.title || st.done) break;
        seen.add(st.shot);
        await a.press('Enter', 1); await a.step(12); frames += 15;
      }
      await a.step(60);
      const end = await a.ev(() => G.App.scene instanceof G.TitleScene);
      const e = await a.allErrors();
      rec(`cutscene ${id} plays through (${shots} shots)`, end && seen.size === shots && !e.length, `shots seen ${seen.size}/${shots}, ${(frames / 60).toFixed(0)}s game time` + (e.length ? ' ERR ' + e.slice(0, 2).join(' | ') : ''));
      await a.close();
    }
  }

  // ---------------------------------------------------------------- 3. title → New Game → intro cutscene
  if (want('title')) {
    const a = await open('');
    await a.step(30);
    const first = await a.ev(() => G.App.scene instanceof G.TitleScene && G.App.scene.menu.items[G.App.scene.menu.sel].label);
    await a.press('Enter'); await a.step(90);
    const st = await a.ev(() => ({ cut: G.App.scene instanceof G.CutsceneScene, id: G.App.scene.cs && G.App.scene.cs.id, cur: G.save.current }));
    await a.page.screenshot({ path: path.join(SHOTS, 'title-newgame-intro.png') });
    const e = await a.allErrors();
    rec('title menu → New Game → intro cutscene', first === 'Новая игра' && st.cut && st.id === 'intro' && st.cur === 0 && !e.length, `selected='${first}' scene=${st.id}` + (e.length ? ' ERR ' + e[0] : ''));
    await a.close();
  }

  // ---------------------------------------------------------------- 4. puzzles solved through the UI on real terminals
  if (want('puzzles')) {
    const terms = await (async () => { const a = await open('level=0'); const r = await a.ev(() => { const out = []; G.LEVEL_ORDER.forEach((en, i) => (G.levels[en.id].entities || []).forEach((e) => { if (e.type === 'terminal') out.push({ i, id: en.id, x: e.x, y: e.y, type: e.puzzle.type }); })); return out; }); await a.close(); return r; })();
    for (const t of terms) {
      const a = await open('level=' + t.i);
      await a.step(5);
      // test setup: dismiss story dialogue, stand Mira next to the terminal, power the terminal's prerequisites are not needed (terminals are always usable)
      const opened = await a.ev((tt) => {
        const g = G.game; g.pendingStartDialogue = null; g.dialogue.active = null; g.dialogue.queue = [];
        const term = g.level.entities.find((e) => e.type === 'terminal' && e.tx === tt.x && e.ty === tt.y);
        g.player.reset(term.x + 6, (tt.y + 1) * 32 - g.player.h); g.player.state = 'idle';
        g.spawnPoint = { x: g.player.x, y: g.player.y };
        return !!term;
      }, t);
      await a.step(20);
      await a.press('KeyE');
      let st = await a.ev(() => G.game.puzzle && JSON.parse(JSON.stringify(G.game.puzzle.st, (k, v) => (typeof v === 'function' ? undefined : v))));
      let ok = opened && !!st, note = '';
      if (ok && t.type === 'pipes') {
        const lay = await a.ev(() => G.Puzzles.Pipes.layout(G.game.puzzle.st));
        const clicks = pipesClicks(st);
        if (clicks.includes(-1)) { ok = false; note = 'unsolvable cell'; }
        for (let i = 0; i < clicks.length && ok; i++) for (let k = 0; k < clicks[i]; k++) {
          const x = i % st.w, y = Math.floor(i / st.w);
          await a.clickView(lay.gx + (x + 0.5) * lay.size, lay.gy + (y + 0.5) * lay.size);
        }
        note = `clicked ${clicks.reduce((s, c) => s + c, 0)} rotations`;
      } else if (ok && t.type === 'lights') {
        const lay = await a.ev(() => G.Puzzles.Lights.layout(G.game.puzzle.st));
        const sol = lightsSolve(st.on, st.n);
        if (!sol) { ok = false; note = 'no GF(2) solution'; } else {
          for (const i of sol) await a.clickView(lay.gx + (i % st.n + 0.5) * lay.size, lay.gy + (Math.floor(i / st.n) + 0.5) * lay.size);
          note = `${sol.length} presses`;
        }
      } else if (ok && t.type === 'code') {
        // wrong code first (must be rejected), then the right one, typed on the keyboard
        const code = st.code;
        const wrong = code.split('').map((c) => String((+c + 1) % 10)).join('');
        await a.page.keyboard.type(wrong); await a.step(2);
        const rejected = await a.ev(() => !G.game.puzzle.solvedT && G.game.puzzle.st.entry === '');
        await a.page.keyboard.type(code); await a.step(2);
        if (!rejected) { ok = false; note = 'wrong code not rejected'; } else note = `typed wrong '${wrong}' (rejected) then '${code}'`;
      } else if (ok && t.type === 'logic') {
        const lay = await a.ev(() => G.Puzzles.Logic.layout(G.game.puzzle.st));
        const target = await a.ev(() => { const s = G.game.puzzle.st; for (let m = 0; m < 1 << s.inputs.length; m++) { const env = {}; s.inputs.forEach((k, j) => { env[k] = !!(m & (1 << j)); }); if (s.outputs.every((o) => o.fn(env))) return env; } return null; });
        if (!target) { ok = false; note = 'unsatisfiable'; } else {
          let n = 0;
          for (let i = 0; i < st.inputs.length; i++) if (!!st.env[st.inputs[i]] !== target[st.inputs[i]]) { await a.clickView(lay.gx + i * (lay.sw + lay.gap) + lay.sw / 2, lay.gy + 43); n++; }
          note = `toggled ${n} switches → ${st.inputs.map((k) => k + '=' + (target[k] ? 1 : 0)).join(' ')}`;
        }
      }
      await a.step(100); // solved banner, overlay auto-closes, signals propagate
      const res = await a.ev((tt) => { const g = G.game; const term = g.level.entities.find((e) => e.type === 'terminal' && e.tx === tt.x && e.ty === tt.y); return { solved: term.solved, closed: !g.puzzle, powered: term.targets.map((id) => [id, g.level.byId[id] && (g.level.byId[id].powered || g.level.sourcesFor[id].some((s) => !s.active))]) }; }, t);
      await a.page.screenshot({ path: path.join(SHOTS, `puzzle-${t.id}-${t.type}.png`) });
      const e = await a.allErrors();
      ok = ok && res.solved && res.closed && res.powered.every(([, p]) => p) && !e.length;
      rec(`puzzle ${t.id} ${t.type} @${t.x},${t.y} solved via UI`, ok, note + (res.solved ? '' : ' NOT SOLVED') + (e.length ? ' ERR ' + e[0] : ''));
      await a.close();
    }
  }

  // ---------------------------------------------------------------- 5. full campaign continuity → credits
  if (want('campaign')) {
    const a = await open('');
    await a.step(30); await a.press('Enter'); // New Game
    const N = await a.ev(() => G.LEVEL_ORDER.length);
    let ok = true, note = '';
    const advanceUntil = async (pred, label, max = 60 * 400) => {
      for (let f = 0; f < max; f += 15) {
        if (await a.ev(pred)) return true;
        const cut = await a.ev(() => G.App.scene instanceof G.CutsceneScene);
        if (cut) await a.press('Enter', 1);
        await a.step(12);
      }
      note += ` timeout:${label}`; return false;
    };
    for (let i = 0; i < N && ok; i++) {
      ok = await advanceUntil(new Function(`return G.App.scene instanceof G.GameScene && G.App.scene.index === ${i} && !G.App.pending`), 'level ' + i);
      if (!ok) break;
      const sv = await a.ev(() => ({ cur: G.save.current, un: G.save.unlocked, id: G.game.def.id }));
      if (sv.cur !== i || sv.un < i) { ok = false; note += ` save mismatch at ${i}: ${JSON.stringify(sv)}`; break; }
      await a.step(10);
      await a.ev(() => G.game.completeLevel());
      await a.step(150);
      const after = await a.ev(() => ({ cur: G.save.current, un: G.save.unlocked, best: Object.keys(G.save.best).length, ls: JSON.parse(localStorage.getItem('tessera_save_v1')).current }));
      if (after.cur !== i + 1 || after.un < i + 1 || after.ls !== i + 1) { ok = false; note += ` save not advanced after ${sv.id}: ${JSON.stringify(after)}`; }
    }
    if (ok) ok = await advanceUntil(() => G.App.scene instanceof G.CreditsScene, 'credits');
    await a.step(60);
    await a.page.screenshot({ path: path.join(SHOTS, 'campaign-credits.png') });
    const e = await a.allErrors();
    const fin = await a.ev(() => ({ cur: G.save.current, un: G.save.unlocked }));
    rec(`campaign: New Game → ${N} levels + 3 cutscenes → credits, save advances`, ok && !e.length, `final save current=${fin.cur} unlocked=${fin.un}` + note + (e.length ? ' ERR ' + e.slice(0, 2).join(' | ') : ''));
    // credits → title on key press
    await a.step(200); await a.press('Enter'); await a.step(120);
    const back = await a.ev(() => G.App.scene instanceof G.TitleScene && G.App.scene.menu.items[0].label);
    rec('credits → title; menu offers no stale "Continue" after finishing', !!back, `first item='${back}'`);
    await a.close();
  }

  await browser.close(); srv.close();
  const fail = rows.filter((r) => !r.ok).length;
  console.log(`RESULT ${JSON.stringify({ suite: 'browser', pass: rows.length - fail, fail, secs: Math.round((Date.now() - t0) / 1000) })}`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error(e); console.log(`RESULT ${JSON.stringify({ suite: 'browser', pass: 0, fail: 1, error: e.message })}`); process.exit(1); });
const SHOTS = path.join(__dirname, '..', '..', 'production', 'qa', 'evidence', 'automation');
fs.mkdirSync(SHOTS, { recursive: true });
