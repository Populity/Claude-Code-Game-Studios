/**
 * Scene flow + the main gameplay scene.
 *
 * Flow: Title → (cutscene) → level → (cutscene) → next level … → credits.
 * Level order and per-level cutscenes come from G.LEVEL_ORDER (src/js/levels/order.js):
 *   [{ id:'p1', before:'intro' (cutscene id, optional), after:'crash' (optional) }, ...]
 */
(function () {
  const W = G.VIEW_W, H = G.VIEW_H, T = G.TILE;
  const FONT = '"Exo 2", "Segoe UI", sans-serif';
  const SAVE_KEY = 'tessera_save_v1';

  // ------------------------------------------------------------------ save + settings
  G.save = Object.assign({ unlocked: 0, current: 0, shards: {}, deaths: 0, best: {} }, G.store.get(SAVE_KEY, {}));
  G.settings = Object.assign({ music: 0.6, sfx: 0.8, reduceShake: false, touch: 'auto', quality: 'auto', autoLow: false }, G.store.get('tessera_settings_v1', {}));
  /** Effective low-graphics mode: chosen explicitly, or picked by the auto fallback (main.js frame timer). */
  G.lowGfx = () => G.settings.quality === 'low' || (G.settings.quality === 'auto' && !!G.settings.autoLow);
  G.persist = () => { G.store.set(SAVE_KEY, G.save); G.store.set('tessera_settings_v1', G.settings); };
  G.applySettings = () => { G.Audio.setVolume('music', G.settings.music); G.Audio.setVolume('sfx', G.settings.sfx); };

  // ------------------------------------------------------------------ App / scene manager
  const App = {
    scene: null,
    fade: 1, fadeDir: -1, pending: null,
    t: 0,
    /** Switch scene with a fade through black. */
    go(makeScene, fast) {
      if (this.pending) return;
      this.pending = makeScene;
      this.fadeDir = 1;
      this.fadeSpeed = fast ? 5 : 2.6;
    },
    setNow(scene) { this.scene = scene; G.input.reset(); },
    update(dt) {
      this.t += dt;
      if (this.fadeDir !== 0) {
        this.fade = G.clamp(this.fade + this.fadeDir * dt * (this.fadeSpeed || 2.6), 0, 1);
        if (this.fadeDir > 0 && this.fade >= 1) {
          const mk = this.pending; this.pending = null;
          G.fx.clear();
          this.setNow(mk());
          this.fadeDir = -1;
        } else if (this.fadeDir < 0 && this.fade <= 0) this.fadeDir = 0;
      }
      if (this.scene && !this.pending) this.scene.update(dt);
      else if (this.scene && this.scene.passiveUpdate) this.scene.passiveUpdate(dt);
      G.Audio.update(dt);
    },
    draw(ctx) {
      if (this.scene) this.scene.draw(ctx, this.t);
      if (this.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${this.fade})`; ctx.fillRect(0, 0, W, H); }
    },

    // ---- flow helpers ----
    startLevelIndex(i, skipBefore) {
      const entry = G.LEVEL_ORDER[i];
      if (!entry) { this.go(() => new CreditsScene()); return; }
      G.save.current = i; G.save.unlocked = Math.max(G.save.unlocked, i); G.persist();
      if (entry.before && !skipBefore) {
        this.go(() => new CutsceneScene(entry.before, () => App.go(() => new GameScene(i))));
      } else this.go(() => new GameScene(i));
    },
    afterLevel(i) {
      if (typeof i === 'string') { this.go(() => new TitleScene()); return; }
      const entry = G.LEVEL_ORDER[i];
      G.save.unlocked = Math.max(G.save.unlocked, i + 1);
      G.save.current = i + 1;
      G.persist();
      if (entry.after) this.go(() => new CutsceneScene(entry.after, () => App.startLevelIndex(i + 1)));
      else this.startLevelIndex(i + 1);
    },
  };
  G.App = App;

  // ------------------------------------------------------------------ Cutscene scene
  class CutsceneScene {
    constructor(id, onDone) { this.cs = new G.Cutscene(id, onDone); }
    update(dt) { this.cs.update(dt); G.fx.update(dt); }
    draw(ctx, t) { this.cs.draw(ctx, t); }
  }
  G.CutsceneScene = CutsceneScene;

  // ------------------------------------------------------------------ Title scene
  class TitleScene {
    constructor() {
      this.t = 0;
      this.mode = 'main';
      G.Audio.music('menu');
      this.buildMain();
    }
    buildMain() {
      const hasSave = G.save.current > 0 && G.save.current < G.LEVEL_ORDER.length;
      const items = [];
      if (hasSave) items.push({ label: 'Продолжить', action: () => App.startLevelIndex(G.save.current, true) });
      items.push({ label: 'Новая игра', action: () => { G.save.current = 0; G.persist(); App.startLevelIndex(0); } });
      items.push({ label: 'Выбор уровня', action: () => this.buildLevels() });
      items.push({ label: 'Настройки', action: () => this.buildSettings() });
      items.push({ label: 'Управление', action: () => { this.mode = 'controls'; this.menu = new G.Menu([{ label: 'Назад', action: () => this.buildMain() }], { y: 470 }); } });
      this.mode = 'main';
      this.menu = new G.Menu(items, { y: 300, lh: 44 });
    }
    buildLevels() {
      this.mode = 'levels';
      const items = G.LEVEL_ORDER.map((e, i) => {
        const def = G.levels[e.id];
        const sh = (G.save.shards[e.id] || []).length;
        const total = def ? countShards(def) : 0;
        return {
          label: (def ? `${def.chapterShort || ''} ${def.title}` : e.id) + (i <= G.save.unlocked && total ? `  ◆${sh}/${total}` : ''),
          disabled: i > G.save.unlocked || !def,
          action: () => App.startLevelIndex(i, false),
        };
      });
      items.push({ label: 'Назад', action: () => this.buildMain() });
      this.menu = new G.Menu(items, { y: 92, lh: 33, size: 17, w: 520 });
    }
    buildSettings() {
      this.mode = 'settings';
      this.menu = settingsMenu(() => this.buildMain(), 250);
    }
    update(dt) {
      this.t += dt;
      this.menu.update(dt);
      if (G.input.pressed('back') && this.mode !== 'main') this.buildMain();
    }
    draw(ctx, t) {
      if (G.Art.Scenes && G.Art.Scenes.draw) G.Art.Scenes.draw(ctx, 'title', this.t, W, H, 0);
      else { ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, W, H); }
      if (this.mode === 'main' || this.mode === 'settings' || this.mode === 'controls') {
        // logo
        ctx.save();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `800 86px ${FONT}`;
        ctx.shadowColor = '#7ef9ff'; ctx.shadowBlur = 30 + Math.sin(this.t * 1.5) * 10;
        const g = ctx.createLinearGradient(0, 110, 0, 190);
        g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#8fe9ff');
        ctx.fillStyle = g;
        ctx.fillText('ТЕССЕРА', W / 2, 150);
        ctx.shadowBlur = 0;
        ctx.font = `500 20px ${FONT}`; ctx.fillStyle = 'rgba(220,240,255,0.8)';
        ctx.letterSpacing = '6px';
        ctx.fillText('СИГНАЛ ИЗ ПЫЛИ', W / 2, 204);
        ctx.letterSpacing = '0px';
        ctx.restore();
      }
      if (this.mode === 'controls') drawControls(ctx);
      else {
        if (this.mode === 'levels') {
          ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#7ef9ff'; ctx.font = `700 24px ${FONT}`; ctx.textAlign = 'center';
          ctx.fillText('Выбор уровня', W / 2, 50); ctx.textAlign = 'left';
        }
        this.menu.draw(ctx);
      }
      if (this.mode === 'controls') this.menu.draw(ctx);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = `400 12px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillText('Глава 1 · v0.1', W - 16, H - 14); ctx.textAlign = 'left';
    }
  }
  G.TitleScene = TitleScene;

  function countShards(def) { return def.map.reduce((n, r) => n + (r.split('*').length - 1), 0); }

  function drawControls(ctx) {
    ctx.fillStyle = 'rgba(4,8,16,0.82)'; G.roundRect(ctx, W / 2 - 370, 230, 740, 210, 14); ctx.fill();
    const rows = [
      ['← → / A D', 'Движение'], ['Пробел / W / ↑', 'Прыжок (держите — выше)'], ['Прыжок у стены', 'Отскок от стены'],
      ['E / F', 'Действие: рычаг, терминал, взять/починить'], ['↓ + Пробел', 'Спрыгнуть с платформы'], ['R', 'Вернуться к чекпоинту'], ['Esc', 'Пауза'],
    ];
    ctx.font = `600 16px ${FONT}`; ctx.textBaseline = 'middle';
    rows.forEach(([k, v], i) => {
      ctx.fillStyle = '#7ef9ff'; ctx.textAlign = 'right'; ctx.fillText(k, W / 2 - 100, 254 + i * 26);
      ctx.fillStyle = '#e8eef8'; ctx.textAlign = 'left'; ctx.fillText(v, W / 2 - 80, 254 + i * 26);
    });
  }

  function settingsMenu(onBack, y) {
    const pct = (v) => Math.round(v * 100) + '%';
    const Q = ['auto', 'high', 'low'];
    const cycleQ = (d) => {
      G.settings.quality = Q[(Q.indexOf(G.settings.quality) + d + Q.length) % Q.length];
      if (G.settings.quality === 'auto') G.settings.autoLow = false; // re-measure from scratch
      G.persist();
    };
    const step = (k, d) => () => { G.settings[k] = G.clamp(Math.round((G.settings[k] + d) * 10) / 10, 0, 1); G.applySettings(); G.persist(); };
    return new G.Menu([
      { label: 'Музыка', value: () => pct(G.settings.music), left: step('music', -0.1), right: step('music', 0.1), action: step('music', 0.1) },
      { label: 'Звуки', value: () => pct(G.settings.sfx), left: step('sfx', -0.1), right: step('sfx', 0.1), action: step('sfx', 0.1) },
      { label: 'Тряска экрана', value: () => (G.settings.reduceShake ? 'слабая' : 'полная'), action: () => { G.settings.reduceShake = !G.settings.reduceShake; G.persist(); }, left: () => { G.settings.reduceShake = !G.settings.reduceShake; G.persist(); }, right: () => { G.settings.reduceShake = !G.settings.reduceShake; G.persist(); } },
      { label: 'Графика', value: () => ({ auto: G.settings.autoLow ? 'авто (низкая)' : 'авто', high: 'высокая', low: 'низкая' }[G.settings.quality] || 'авто'), action: () => cycleQ(1), left: () => cycleQ(-1), right: () => cycleQ(1) },
      { label: 'Сенсорные кнопки', value: () => ({ auto: 'авто', on: 'вкл', off: 'выкл' }[G.settings.touch]), action: () => { G.settings.touch = { auto: 'on', on: 'off', off: 'auto' }[G.settings.touch]; G.persist(); } },
      { label: 'Назад', action: onBack },
    ], { y, lh: 44, w: 440 });
  }

  // ------------------------------------------------------------------ Credits
  class CreditsScene {
    constructor() { this.t = 0; G.Audio.music('credits'); }
    update(dt) {
      this.t += dt;
      if (this.t > 3 && (G.input.anyPressed() || G.input.pointer.clicked)) App.go(() => new TitleScene());
    }
    draw(ctx) {
      if (G.Art.Scenes && G.Art.Scenes.draw) G.Art.Scenes.draw(ctx, 'credits', this.t, W, H, 0);
      else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = (G.CREDITS || ['ТЕССЕРА', 'Глава 1 завершена', 'Продолжение следует…']);
      const y0 = H + 40 - this.t * 38;
      lines.forEach((l, i) => {
        const y = Math.max(y0 + i * 40, i === lines.length - 1 ? H / 2 : -100);
        ctx.font = i === 0 ? `800 48px ${FONT}` : `500 20px ${FONT}`;
        ctx.fillStyle = i === 0 ? '#7ef9ff' : '#e8eef8';
        ctx.fillText(l, W / 2, y);
      });
      const total = Object.values(G.save.shards).reduce((n, a) => n + a.length, 0);
      ctx.font = `500 15px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`Осколков данных: ${total}  ·  Попыток: ${G.save.deaths}`, W / 2, H - 30);
      ctx.textAlign = 'left';
    }
  }
  G.CreditsScene = CreditsScene;

  // ------------------------------------------------------------------ Gameplay scene
  class GameScene {
    constructor(index) {
      this.index = index;
      this.entry = typeof index === 'string' ? { id: index } : G.LEVEL_ORDER[index];
      const def = G.levels[this.entry.id];
      this.def = def;
      this.level = new G.Level(def);
      this.player = new G.Player(this.level.spawn.x, this.level.spawn.y);
      this.drone = new G.Drone(this.level, this.player);
      this.dialogue = new G.Dialogue();
      this.puzzle = null;
      this.paused = false;
      this.pauseMenu = null;
      this.checkpoint = null;
      this.spawnPoint = { x: this.level.spawn.x, y: this.level.spawn.y };
      this.cam = { x: 0, y: 0 };
      this.objective = def.objective || '';
      this.objectiveT = 0;
      this.bannerT = 0;
      this.deathT = 0;
      this.deaths = 0;
      this.time = 0;
      this.completeT = -1;
      this.sign = null;
      this.focus = null;
      const got = G.save.shards[def.id] || [];
      for (const e of this.level.entities) if (e.type === 'shard' && got.includes(e.index)) { e.collected = true; e.collectT = 99; e.already = true; }
      this.snapshot();
      this.snapCamera();
      G.game = this;
      if (G.Art.Decor && G.Art.Decor.init) G.Art.Decor.init(this.level);
      G.Audio.music(def.music || this.level.biome);
      if (def.startDialogue) this.pendingStartDialogue = def.startDialogue;
    }

    // ---- API used by entities ----
    isNear(x, y, d) { return Math.abs(x - this.player.cx) < d && Math.abs(y - this.player.cy) < d; }
    playDialogue(id) { this.dialogue.play(id); }
    setObjective(text) { if (text !== this.objective) { this.objective = text; this.objectiveT = 0; G.Audio.play('objective'); } }
    showSign(title, text) { this.sign = { title, text, t: 0 }; }
    openPuzzle(terminal) { this.puzzle = new G.Puzzles.PuzzleOverlay(terminal, this); }
    collectShard(s) {
      G.Audio.play('shard');
      G.fx.burst(s.cx, s.cy, { count: 18, color: ['#7ef9ff', '#c8a8ff', '#ffffff'], speed: 200, life: 0.7, size: 3, gravity: 0, glow: true });
      const arr = G.save.shards[this.def.id] = G.save.shards[this.def.id] || [];
      if (!arr.includes(s.index)) arr.push(s.index);
      G.persist();
      this.shardPopT = 0;
    }
    activateCheckpoint(cp) {
      for (const e of this.level.entities) if (e.type === 'checkpoint' && e !== cp) e.current = false;
      cp.lit = true; cp.current = true; cp.litT = 0;
      this.checkpoint = cp;
      this.spawnPoint = cp.spawnPoint;
      this.snapshot();
      G.Audio.play('checkpoint');
      G.fx.burst(cp.cx, cp.y + 10, { count: 20, color: ['#7ef9ff', '#ffffff'], speed: 160, life: 0.8, size: 3, gravity: -60, glow: true });
      this.drone.cheer();
    }
    snapshot() { for (const e of this.level.entities) if (e.type === 'crate') e.snapshot = { x: e.x, y: e.y }; }
    completeLevel() {
      if (this.completeT >= 0) return;
      this.completeT = 0;
      this.player.frozen = true;
      G.Audio.play('levelComplete');
      const prev = G.save.best[this.def.id];
      if (!prev || this.time < prev) G.save.best[this.def.id] = this.time;
      G.persist();
    }

    respawn() {
      const p = this.player;
      const carryPart = p.carryPart;
      p.reset(this.spawnPoint.x, this.spawnPoint.y);
      if (carryPart && !carryPart.delivered) { carryPart.taken = false; carryPart.x = carryPart.home.x; carryPart.y = carryPart.home.y; }
      for (const e of this.level.entities) if (e.type === 'crate') e.restore();
      this.drone.x = p.cx - 30; this.drone.y = p.y - 30;
      G.Audio.play('respawn');
      G.fx.burst(p.cx, p.cy, { count: 16, color: ['#7ef9ff', '#ffffff'], speed: 120, life: 0.6, gravity: -100, glow: true });
    }

    snapCamera() {
      const t = this.cameraTarget();
      this.cam.x = t.x; this.cam.y = t.y;
    }
    cameraTarget() {
      const C = G.CONFIG.camera, p = this.player;
      let x = p.cx - W / 2 + p.facing * C.lookAhead;
      let y = p.cy - H / 2 - 30;
      x = this.level.pxW <= W ? (this.level.pxW - W) / 2 : G.clamp(x, 0, this.level.pxW - W);
      y = this.level.pxH <= H ? (this.level.pxH - H) / 2 : G.clamp(y, 0, this.level.pxH - H);
      return { x, y };
    }

    findFocus() {
      const p = this.player;
      if (p.dead || this.dialogue.blocking) return null;
      let best = null, bd = 1e9;
      const range = G.CONFIG.player.interactRange;
      for (const e of this.level.entities) {
        if (!e.interactable) continue;
        const dx = Math.max(e.x - (p.x + p.w), p.x - (e.x + e.w), 0);
        const dy = Math.max(e.y - (p.y + p.h), p.y - (e.y + e.h), 0);
        if (dx > range || dy > 16) continue;
        const d = Math.abs(e.cx - p.cx);
        const can = !e.canInteract || e.canInteract(this);
        const missing = e.missingHint ? e.missingHint(this) : null;
        if (!can && !missing) continue;
        if (d < bd) { bd = d; best = { e, can, missing }; }
      }
      return best;
    }

    update(dt) {
      const inp = G.input;
      if (this.pendingStartDialogue && this.time > 0.6) { this.dialogue.play(this.pendingStartDialogue); this.pendingStartDialogue = null; }

      // ---- modal layers ----
      if (this.puzzle) {
        const r = this.puzzle.update(dt);
        if (r === 'close') { this.puzzle = null; G.input.reset(); }
        this.tickWorld(dt * 0.0, true);
        return;
      }
      if (this.sign) {
        this.sign.t += dt;
        if (this.sign.t > 0.2 && (inp.pressed('action') || inp.pressed('confirm') || inp.pressed('jump') || inp.pressed('back') || inp.pointer.clicked)) { this.sign = null; G.input.reset(); }
        return;
      }
      if (this.paused) { this.pauseMenu.update(dt); if (inp.pressed('pause') && this.pauseMenuReady) this.resume(); this.pauseMenuReady = true; return; }
      if (inp.pressed('pause') && this.completeT < 0) { this.pause(); return; }
      if (G.input.touchActive && inp.pointer.clicked && this.pauseBtn && Math.hypot(inp.pointer.x - this.pauseBtn.x, inp.pointer.y - this.pauseBtn.y) < this.pauseBtn.r) { this.pause(); return; }

      this.tickWorld(dt, false);
    }

    pause() {
      this.paused = true; this.pauseMenuReady = false;
      G.Audio.play('pause');
      const resumeItems = () => [
        { label: 'Продолжить', action: () => this.resume() },
        { label: 'К последнему чекпоинту', action: () => { this.resume(); if (!this.player.dead) this.player.kill('restart'); } },
        { label: 'Вернуть ящики на место', action: () => { for (const e of this.level.entities) if (e.type === 'crate') { e.x = e.home.x; e.y = e.home.y; e.vy = 0; e.snapshot = { x: e.x, y: e.y }; } this.resume(); } },
        { label: 'Перезапустить уровень', action: () => { App.go(() => new GameScene(this.index), true); } },
        { label: 'Настройки', action: () => { this.pauseMenu = settingsMenu(() => { this.pauseMenu = new G.Menu(resumeItems(), { y: 230, lh: 44, w: 420 }); }, 230); } },
        { label: 'Выйти в меню', action: () => App.go(() => new TitleScene()) },
      ];
      this.pauseMenu = new G.Menu(resumeItems(), { y: 230, lh: 44, w: 420 });
    }
    resume() { this.paused = false; G.input.reset(); }

    tickWorld(dt, frozen) {
      if (frozen) return;
      const inp = G.input;
      const L = this.level;
      this.time += dt;
      L.time += dt;
      this.objectiveT += dt; this.bannerT += dt;
      if (this.shardPopT != null) this.shardPopT += dt;
      L._dyn = L.dynamicSolids();

      // moving things first so riders are carried
      for (const e of L.entities) if (e.type === 'mplatform' || e.type === 'saw') e.update(dt, this);
      L._dyn = L.dynamicSolids();

      const blocked = this.dialogue.blocking || this.completeT >= 0;
      const ctl = blocked ? { left: false, right: false, down: false, jumpPressed: false, jumpHeld: false } : {
        left: inp.down('left'), right: inp.down('right'), down: inp.down('down'),
        jumpPressed: inp.pressed('jump'), jumpHeld: inp.down('jump'),
      };
      this.player.update(dt, L, ctl);

      for (const e of L.entities) if (e.type !== 'mplatform' && e.type !== 'saw') e.update(dt, this);
      L.resolveSignals();
      L.updateCrumbles(dt, this._bodies || (this._bodies = [this.player, ...L.crates]));
      this.drone.update(dt, this);
      this.dialogue.update(dt);
      G.fx.update(dt);

      // interaction
      this.focus = this.findFocus();
      if (!blocked && this.focus && this.focus.can && inp.pressed('action')) this.focus.e.interact(this);

      // restart from checkpoint
      if (!blocked && inp.pressed('restart') && !this.player.dead) this.player.kill('restart');

      // death / respawn
      if (this.player.dead) {
        if (this.deathT === 0) { this.deaths++; G.save.deaths++; }
        this.deathT += dt;
        if (this.deathT >= G.CONFIG.death.respawnDelay) { this.deathT = 0; this.respawn(); }
      }

      // level complete
      if (this.completeT >= 0) {
        this.completeT += dt;
        if (this.completeT > 2.2 && !this.leaving) { this.leaving = true; App.afterLevel(this.index); }
      }

      // camera
      const C = G.CONFIG.camera;
      const tgt = this.cameraTarget();
      this.cam.x = G.lerp(this.cam.x, tgt.x, G.damp(C.smooth, dt));
      this.cam.y = G.lerp(this.cam.y, tgt.y, G.damp(C.verticalSmooth, dt));
    }

    passiveUpdate(dt) { G.fx.update(dt); }

    // ------------------------------------------------------------------ rendering
    draw(ctx, t) {
      const L = this.level, cam = this.cam;
      const Decor = G.Art.Decor || {};
      const sh = G.fx.shakeOffset();
      const view = { x: cam.x + sh.x, y: cam.y + sh.y, w: W, h: H };
      const time = L.time;

      if (Decor.drawBackground) Decor.drawBackground(ctx, view, L, time);
      else { ctx.fillStyle = '#10141f'; ctx.fillRect(0, 0, W, H); }

      ctx.save();
      ctx.translate(-Math.round(view.x * 2) / 2, -Math.round(view.y * 2) / 2);
      const onScreen = (e, m = 96) => e.x + e.w + m > view.x && e.x - m < view.x + W && e.y + e.h + m > view.y && e.y - m < view.y + H;

      for (const e of L.entities) if (e.type === 'deco' && e.layer !== 'front' && onScreen(e, 300) && Decor.drawProp) Decor.drawProp(ctx, e, time, L);
      if (Decor.drawTiles) Decor.drawTiles(ctx, view, L, time);
      else drawDebugTiles(ctx, view, L);

      const Ent = G.Art.Entities;
      const order = ['exit', 'checkpoint', 'sign', 'terminal', 'socket', 'lever', 'door', 'bridge', 'plate', 'jumppad', 'laser', 'mplatform', 'crate', 'part', 'shard', 'saw'];
      for (const type of order) {
        for (const e of L.entities) {
          if (e.type !== type) continue;
          const vis = e.type === 'laser' ? true : onScreen(e, e.type === 'saw' ? 64 : 96);
          if (vis && Ent && Ent.draw) Ent.draw(ctx, e, time, L);
        }
      }
      if (this.drone.enabled && G.Art.Drone && G.Art.Drone.draw) G.Art.Drone.draw(ctx, this.drone, time);
      if (G.Art.Player && G.Art.Player.draw) G.Art.Player.draw(ctx, this.player, time);
      G.fx.draw(ctx);
      for (const e of L.entities) if (e.type === 'deco' && e.layer === 'front' && onScreen(e, 300) && Decor.drawProp) Decor.drawProp(ctx, e, time, L);
      const low = G.lowGfx();
      if (Decor.drawForeground && !low) Decor.drawForeground(ctx, view, L, time);

      // world-space UI: hints + interaction prompt
      for (const e of L.entities) if (e.type === 'hint' && e.alpha > 0.01) drawHint(ctx, e);
      if (this.focus && !this.puzzle) drawPrompt(ctx, this.focus, t);
      ctx.restore();

      if (Decor.drawAtmosphere && !low) Decor.drawAtmosphere(ctx, view, L, time);

      this.drawHUD(ctx, t);
      const pScreenY = this.player.y + this.player.h - this.cam.y;
      this.dialogue.draw(ctx, t, { top: pScreenY > H - 190 });
      if (this.sign) drawSign(ctx, this.sign);
      if (this.puzzle) this.puzzle.draw(ctx, t);
      if (this.paused) {
        ctx.fillStyle = 'rgba(2,6,12,0.75)'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#7ef9ff'; ctx.font = `800 40px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText('ПАУЗА', W / 2, 150); ctx.textAlign = 'left';
        this.pauseMenu.draw(ctx);
      }
      if (this.player.dead) {
        const k = Math.min(1, this.deathT / G.CONFIG.death.respawnDelay);
        ctx.fillStyle = `rgba(0,0,0,${Math.max(0, (k - 0.5) * 2) * 0.9})`; ctx.fillRect(0, 0, W, H);
      }
      if (this.completeT >= 0) drawComplete(ctx, this);
    }

    drawHUD(ctx, t) {
      const def = this.def;
      // level banner
      if (this.bannerT < 4.5 && !this.dialogue.active) {
        const a = Math.min(1, this.bannerT * 2, (4.5 - this.bannerT) * 1.5);
        ctx.save(); ctx.globalAlpha = Math.max(0, a);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(126,249,255,0.9)'; ctx.font = `600 15px ${FONT}`;
        ctx.fillText((def.chapter || '').toUpperCase(), W / 2, 92);
        ctx.fillStyle = '#ffffff'; ctx.font = `800 36px ${FONT}`;
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 12;
        ctx.fillText(def.title, W / 2, 128);
        ctx.restore();
      }
      // objective
      if (this.objective) {
        const a = Math.min(1, this.objectiveT * 2);
        ctx.save(); ctx.globalAlpha = a;
        ctx.font = `600 14px ${FONT}`;
        const label = 'ЗАДАЧА';
        const tw = Math.max(ctx.measureText(this.objective).width, 60) + 34;
        ctx.fillStyle = 'rgba(4,10,18,0.6)'; G.roundRect(ctx, 14, 14, tw, 50, 10); ctx.fill();
        ctx.fillStyle = this.objectiveT < 2 && Math.sin(this.objectiveT * 12) > 0 ? '#ffffff' : '#ffcf6b';
        ctx.fillRect(14, 22, 3, 34);
        ctx.font = `700 11px ${FONT}`; ctx.fillStyle = '#ffcf6b'; ctx.textBaseline = 'top';
        ctx.fillText(label, 26, 21);
        ctx.font = `600 15px ${FONT}`; ctx.fillStyle = '#eef6ff';
        ctx.fillText(this.objective, 26, 38);
        ctx.restore();
      }
      // shards
      if (this.level.shardTotal > 0) {
        const got = this.level.entities.filter((e) => e.type === 'shard' && e.collected).length;
        const pop = this.shardPopT != null && this.shardPopT < 0.5 ? 1 + (0.5 - this.shardPopT) : 1;
        ctx.save();
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.font = `700 ${Math.round(16 * pop)}px ${FONT}`; ctx.fillStyle = '#c8e9ff';
        const x = W - (G.input.touchActive ? 70 : 18);
        ctx.fillText(`${got}/${this.level.shardTotal}`, x, 30);
        ctx.fillStyle = '#7ef9ff';
        ctx.translate(x - ctx.measureText(`${got}/${this.level.shardTotal}`).width - 14, 30);
        ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
      }
      // carried item
      if (this.player.carry) {
        ctx.save(); ctx.font = `600 13px ${FONT}`; ctx.fillStyle = '#ffe17a'; ctx.textAlign = 'right';
        ctx.fillText('В руках: ' + (G.ITEM_NAMES[this.player.carry] || this.player.carry), W - 18, 56);
        ctx.restore();
      }
      this.drawTouch(ctx);
    }

    drawTouch(ctx) {
      const overlay = this.puzzle || this.sign || this.paused || this.completeT >= 0;
      const show = !overlay && (G.settings.touch === 'on' || (G.settings.touch === 'auto' && G.input.touchActive));
      if (!show) { G.input.touchButtons = []; this.pauseBtn = null; return; }
      const btns = [
        { action: 'left', x: 80, y: H - 80, r: 50, label: '◀' },
        { action: 'right', x: 200, y: H - 80, r: 50, label: '▶' },
        { action: 'action', x: W - 210, y: H - 70, r: 44, label: 'E' },
        { action: 'jump', x: W - 90, y: H - 100, r: 58, label: '▲' },
        { action: 'down', x: 140, y: H - 170, r: 34, label: '▼' },
      ];
      G.input.touchButtons = btns;
      this.pauseBtn = { x: W - 34, y: 30, r: 34 };
      ctx.save();
      for (const b of btns) {
        const held = G.input.down(b.action);
        ctx.globalAlpha = held ? 0.55 : 0.28;
        ctx.fillStyle = '#0b1622'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
        ctx.strokeStyle = '#7ef9ff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.globalAlpha = held ? 1 : 0.7;
        ctx.fillStyle = '#e8f6ff'; ctx.font = `700 ${Math.round(b.r * 0.6)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(b.label, b.x, b.y + 1);
      }
      ctx.globalAlpha = 0.6; ctx.fillStyle = '#e8f6ff';
      ctx.fillRect(this.pauseBtn.x - 8, this.pauseBtn.y - 10, 5, 20); ctx.fillRect(this.pauseBtn.x + 3, this.pauseBtn.y - 10, 5, 20);
      ctx.restore();
    }
  }
  G.GameScene = GameScene;

  // ------------------------------------------------------------------ draw helpers
  function drawHint(ctx, e) {
    ctx.save();
    ctx.globalAlpha = e.alpha * 0.95;
    ctx.font = `600 15px ${FONT}`;
    const text = G.input.touchActive && e.touchText ? e.touchText : e.text;
    const w = ctx.measureText(text).width + 24;
    const x = e.x + G.TILE / 2 - w / 2, y = e.y;
    ctx.fillStyle = 'rgba(4,10,18,0.72)'; G.roundRect(ctx, x, y, w, 30, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(126,249,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#e8f6ff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + 15);
    ctx.restore();
  }

  function drawPrompt(ctx, f, t) {
    const e = f.e;
    const key = G.input.touchActive ? 'E' : G.input.lastDevice === 'gamepad' ? 'X' : 'E';
    const text = f.can ? e.prompt || 'Действие' : 'Нужно: ' + f.missing;
    ctx.save();
    ctx.font = `700 13px ${FONT}`;
    const w = ctx.measureText(text).width + (f.can ? 40 : 20);
    const x = e.cx - w / 2, y = e.y - 34 + Math.sin(t * 4) * 2;
    ctx.fillStyle = f.can ? 'rgba(4,10,18,0.8)' : 'rgba(30,8,10,0.8)';
    G.roundRect(ctx, x, y, w, 24, 7); ctx.fill();
    ctx.strokeStyle = f.can ? '#7ef9ff' : '#ff8a8a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textBaseline = 'middle';
    if (f.can) {
      ctx.fillStyle = '#7ef9ff'; G.roundRect(ctx, x + 5, y + 4, 18, 16, 4); ctx.fill();
      ctx.fillStyle = '#04101a'; ctx.textAlign = 'center'; ctx.fillText(key, x + 14, y + 12.5);
      ctx.fillStyle = '#e8f6ff'; ctx.textAlign = 'left'; ctx.fillText(text, x + 30, y + 12.5);
    } else {
      ctx.fillStyle = '#ffd0d0'; ctx.textAlign = 'center'; ctx.fillText(text, x + w / 2, y + 12.5);
    }
    ctx.restore();
  }

  function drawSign(ctx, s) {
    const k = G.easeOutCubic(Math.min(1, s.t * 5));
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    const pw = 600, px = (W - pw) / 2;
    const paras = s.text.split('\n');
    // measure wrapped height first so the panel fits its content
    ctx.font = `400 17px ${FONT}`;
    let lines = 0;
    for (const p of paras) {
      let line = '', n = 1;
      for (const w of p.split(' ')) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > pw - 48 && line) { n++; line = w; } else line = test;
      }
      lines += n;
    }
    const ph = Math.min(H - 40, 58 + lines * 23 + paras.length * 6 + 44);
    const py = (H - ph) / 2 + (1 - k) * 20;
    ctx.fillStyle = 'rgba(14,12,8,0.95)'; G.roundRect(ctx, px, py, pw, ph, 14); ctx.fill();
    ctx.strokeStyle = '#ffcf6b'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffcf6b'; ctx.font = `700 20px ${FONT}`; ctx.textBaseline = 'top';
    ctx.fillText(s.title, px + 24, py + 20);
    ctx.fillStyle = '#f4ead8'; ctx.font = `400 17px ${FONT}`;
    let y = py + 58;
    for (const p of paras) {
      const n = G.wrapText(ctx, p, px + 24, y, pw - 48, 23, p);
      y += (typeof n === 'number' ? n : 1) * 23 + 6;
    }
    const dev = G.input.touchActive ? 'Коснитесь экрана' : G.input.lastDevice === 'gamepad' ? 'Нажмите X' : 'Нажмите E';
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `400 12px ${FONT}`;
    ctx.fillText(dev + ', чтобы закрыть', px + 24, py + ph - 28);
    ctx.restore();
  }

  function drawComplete(ctx, g) {
    const k = Math.min(1, g.completeT * 1.5);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${k * 0.55})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = k;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7dffa8'; ctx.font = `800 40px ${FONT}`;
    ctx.shadowColor = '#7dffa8'; ctx.shadowBlur = 20;
    ctx.fillText('УЧАСТОК ПРОЙДЕН', W / 2, H / 2 - 30);
    ctx.shadowBlur = 0;
    const mm = Math.floor(g.time / 60), ss = Math.floor(g.time % 60).toString().padStart(2, '0');
    const got = g.level.entities.filter((e) => e.type === 'shard' && e.collected).length;
    ctx.fillStyle = '#e8eef8'; ctx.font = `500 18px ${FONT}`;
    ctx.fillText(`Время ${mm}:${ss}   ·   Попыток ${g.deaths}   ·   Осколки ${got}/${g.level.shardTotal}`, W / 2, H / 2 + 20);
    ctx.restore();
  }

  /** Fallback tile renderer (used only if the decor module is missing). */
  function drawDebugTiles(ctx, view, L) {
    const x0 = Math.max(0, Math.floor(view.x / T)), x1 = Math.min(L.w - 1, Math.floor((view.x + W) / T));
    const y0 = Math.max(0, Math.floor(view.y / T)), y1 = Math.min(L.h - 1, Math.floor((view.y + H) / T));
    const C = G.TILE_CODES;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const c = L.tileCode(tx, ty);
      if (c === C.SOLID || (c === C.CRUMBLE && L.isSolidTile(tx, ty))) { ctx.fillStyle = c === C.CRUMBLE ? '#8a6a4a' : '#3a4a5a'; ctx.fillRect(tx * T, ty * T, T, T); }
      else if (c === C.ONEWAY) { ctx.fillStyle = '#6a7a8a'; ctx.fillRect(tx * T, ty * T, T, 6); }
      else if (c === C.SPIKE_UP || c === C.SPIKE_DOWN) { ctx.fillStyle = '#d0d0d0'; ctx.fillRect(tx * T + 4, ty * T + (c === C.SPIKE_UP ? 16 : 0), T - 8, 16); }
      else if (c === C.ACID) { ctx.fillStyle = '#6cff3a'; ctx.fillRect(tx * T, ty * T + 8, T, T - 8); }
    }
  }
})();
