/**
 * Boot: canvas setup (crisp on HiDPI, 16:9 letterboxed), main loop, error overlay.
 */
(function () {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = G.VIEW_W, H = G.VIEW_H;
  let view = { scale: 1, ox: 0, oy: 0 };
  G.canvas = canvas;
  G.errors = [];

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.floor(window.innerWidth * dpr), ch = Math.floor(window.innerHeight * dpr);
    canvas.width = cw; canvas.height = ch;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    const scale = Math.min(cw / W, ch / H);
    view = { scale, ox: Math.round((cw - W * scale) / 2), oy: Math.round((ch - H * scale) / 2) };
    G.input.view = view;
    G.renderScale = scale;
  }
  window.addEventListener('resize', resize);
  resize();

  window.addEventListener('error', (e) => { G.errors.push(String(e.message || e)); });

  // Touch-first devices: show on-screen controls immediately (don't wait for the first tap).
  try { if (window.matchMedia && matchMedia('(pointer: coarse)').matches) G.input.touchActive = true; } catch (e) { /* */ }
  G.applySettings();
  if (G.Art.Decor && G.Art.Decor.boot) try { G.Art.Decor.boot(); } catch (e) { console.error(e); }

  // URL params for QA: ?level=<index|id>&skip=1 jumps straight into a level
  const params = new URLSearchParams(location.search);
  const lv = params.get('level');
  if (lv != null) {
    let idx = /^\d+$/.test(lv) ? +lv : G.LEVEL_ORDER.findIndex((e) => e.id === lv);
    if (idx < 0) idx = G.levels[lv] ? lv : 0;
    if (params.get('cutscene')) G.App.setNow(new G.CutsceneScene(params.get('cutscene'), () => G.App.go(() => new G.TitleScene())));
    else G.App.setNow(new G.GameScene(idx));
  } else if (params.get('cutscene')) {
    G.App.setNow(new G.CutsceneScene(params.get('cutscene'), () => G.App.go(() => new G.TitleScene())));
  } else {
    G.App.setNow(new G.TitleScene());
  }

  const MAX_STEP = 1 / 60, MAX_FRAME = 1 / 15;

  // Losing focus (alt-tab, tab switch, phone call) pauses gameplay instead of letting Mira run on.
  function autoPause() {
    const sc = G.App.scene;
    if (G.timeScale === 0 || !sc || !(sc instanceof G.GameScene)) return;
    if (!sc.paused && !sc.puzzle && !sc.sign && sc.completeT < 0) sc.pause();
  }
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });

  let last = performance.now();
  G.paused = false;
  // Adaptive quality: if real frames average > SLOW_MS for SLOW_SECS of gameplay while quality
  // is 'auto', switch to low graphics (persisted as settings.autoLow; menu «Графика» resets it).
  const SLOW_MS = 22, SLOW_SECS = 2;
  let avgMs = 16.7, slowT = 0;
  function watchFrameTime(rawMs) {
    const sc = G.App.scene;
    if (G.settings.quality !== 'auto' || G.settings.autoLow || G.timeScale != null) return;
    if (!sc || !(sc instanceof G.GameScene) || sc.paused || rawMs > 250) { slowT = 0; return; } // tab switches etc.
    avgMs += (rawMs - avgMs) * 0.1;
    slowT = avgMs > SLOW_MS ? slowT + rawMs / 1000 : 0;
    if (slowT >= SLOW_SECS) { G.settings.autoLow = true; G.persist(); console.info('TESSERA: low graphics enabled (avg frame ' + avgMs.toFixed(1) + ' ms)'); }
  }

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    watchFrameTime(dt * 1000);
    if (dt > MAX_FRAME) dt = MAX_FRAME;
    if (G.timeScale != null) dt *= G.timeScale;
    if (G.timeScale === 0) { requestAnimationFrame(frame); return; } // QA: driven by G.step()
    try {
      // Long frames are split into equal sub-steps ≤ 1/60 s so jump arcs, wall jumps and
      // collisions stay the same on slow machines (only the first sub-step sees new presses).
      const n = Math.ceil(dt / MAX_STEP - 1e-6) || 1;
      for (let i = 0; i < n; i++) {
        G.input.update();
        G.App.update(dt / n);
        G.input.endFrame();
      }
      render();
    } catch (e) {
      console.error(e);
      G.errors.push(String(e && e.stack || e));
      if (G.errors.length > 50) G.errors.shift();
    }
    requestAnimationFrame(frame);
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    G.App.draw(ctx);
    ctx.restore();
    // Phone held upright: the 16:9 game is tiny — show a rotate-device icon (no text).
    if (G.input.touchActive && window.innerHeight > window.innerWidth * 1.1) drawRotateHint();
  }

  function drawRotateHint() {
    const cw = canvas.width, ch = canvas.height, s = Math.min(cw, ch) / 6, t = performance.now() / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(0, 0, cw, ch);
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(-Math.PI / 2 * Math.min(1, Math.max(0, Math.sin(t * 2) * 1.2 + 0.2)));
    ctx.strokeStyle = '#7ef9ff'; ctx.lineWidth = s * 0.08;
    G.roundRect(ctx, -s * 0.5, -s * 0.9, s, s * 1.8, s * 0.15); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, s * 0.72, s * 0.06, 0, 7); ctx.fillStyle = '#7ef9ff'; ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Test hook: advance the game deterministically by n frames (used by QA scripts). */
  G.step = (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) { G.input.update(); G.App.update(dt); G.input.endFrame(); }
    render();
  };

  requestAnimationFrame(frame);
})();
