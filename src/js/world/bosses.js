/**
 * TESSERA — Chapter 2 bosses (logic). Tunables: src/js/config-bosses.js (G.CONFIG.bosses).
 * Art: src/js/art/bosses.js (G.Art.Bosses.draw / drawHUD). Test arena: ?level=bossarena.
 *
 * Entity types registered here:
 *   boss     {type:'boss', kind:'archivist'|'colossus'|'warden', x, y, [id], [targets], [arena:[x,y,w,h]], [dialogue]}
 *            Becomes `active = true` once destroyed (a signal source like a lever: open the exit / doors).
 *            Its rect (x,y,w,h) is the ARENA rect (so it is always drawn while the arena is on screen);
 *            the body centre is (bx, by).
 *   bossproj {type:'bossproj', kind, …} Boss parts. Level-placed props: kind 'pillar' (archivist shield
 *            pylon), kind 'fan' (colossus deflector fan, receiver powered by a lever). Pooled projectiles
 *            spawned by the bosses: 'orb', 'crystal', 'shell', 'blast', 'shock', 'seeker'.
 *
 * Common flow: dormant → intro (camera focus, rumble, roar, letterbox, then `bossN_intro` dialogue)
 * → fight ⇄ phase (rage between phases) → dying → dead. Player death: projectiles vanish, the boss
 * returns to its post, its HP/phase are KEPT, partial in-phase progress (burnt pillars) is reset.
 * Art fields: state, phase, hp, maxHp, telegraphT (0..1), atk, hurtT, introT, roarT, deathT, facing,
 * bx, by, plus per-kind fields documented on each class.
 */
(function () {
  const T = G.TILE;
  const TAU = Math.PI * 2;
  const Types = G.EntityTypes;
  const Base = Object.getPrototypeOf(Types.trigger); // the shared Entity base class
  const BC = () => G.CONFIG.bosses;
  /** Per-phase value: arrays are indexed by phase, scalars apply to every phase. */
  const ph = (v, i) => (Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v);
  const NUM = { archivist: 1, colossus: 2, warden: 3 };

  // ------------------------------------------------------------------ geometry helpers
  /** Liang–Barsky: parameter t∈[0,1] where segment A→B first enters rect r, or -1. */
  function segRect(ax, ay, bx, by, r) {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const P = [-dx, dx, -dy, dy], Q = [ax - r.x, r.x + r.w - ax, ay - r.y, r.y + r.h - ay];
    for (let i = 0; i < 4; i++) {
      if (P[i] === 0) { if (Q[i] < 0) return -1; continue; }
      const t = Q[i] / P[i];
      if (P[i] < 0) { if (t > t1) return -1; if (t > t0) t0 = t; } else { if (t < t0) return -1; if (t < t1) t1 = t; }
    }
    return t0;
  }
  /** Does a circle touch a rect? */
  function circleRect(cx, cy, r, R) {
    const dx = Math.max(R.x - cx, 0, cx - (R.x + R.w));
    const dy = Math.max(R.y - cy, 0, cy - (R.y + R.h));
    return dx * dx + dy * dy < r * r;
  }
  /** Distance along a ray until the first solid tile (or max). */
  function rayLen(level, x, y, ang, max) {
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d = 0; d < max; d += 6) {
      if (level.isSolidTile(Math.floor((x + cx * d) / T), Math.floor((y + cy * d) / T))) return d;
    }
    return max;
  }
  /** Pixel y of the first solid tile top at/below (px, py). */
  function floorBelow(level, px, py) {
    const tx = Math.floor(px / T);
    for (let ty = Math.max(0, Math.floor(py / T)); ty < level.h; ty++) if (level.isSolidTile(tx, ty)) return ty * T;
    return level.pxH;
  }
  const hurtBox = (p) => ({ x: p.x + 3, y: p.y + 4, w: p.w - 6, h: p.h - 6 });
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  /**
   * Is the player performing a damaging strike? The dash (Chapter 2 spec: p.state === 'dash') is the
   * weapon. `p.dashing` is accepted too. Fallback for engines without a dash yet: fast airborne contact.
   */
  function isStriking(p) {
    if (p.state === 'dash' || p.dashing === true) return true;
    if (typeof p.dashT === 'number' && p.dashT < BC().common.strikeGrace) return true; // just-ended dash still carries the blow
    if (p.canDash === undefined && !p.onGround) return Math.hypot(p.vx, p.vy) > BC().common.strikeMinSpeed;
    return false;
  }
  /** Refill the dash (crystals). Works with the spec fields; harmless if the engine has no dash. */
  function refillDash(p) {
    if (typeof p.refillDash === 'function') return !!p.refillDash();
    const max = (G.CONFIG.dash && G.CONFIG.dash.charges) || 1;
    if (typeof p.dashCharges === 'number' && p.dashCharges < max) { p.dashCharges = max; return true; }
    return false;
  }
  const say = (id) => !!(id && G.Script && G.Script[id]);

  // ------------------------------------------------------------------ game hooks (camera + HUD)
  /**
   * Installs per-instance hooks on the GameScene once: a camera bias toward the active boss
   * (fallback when game.cineFocus is absent) and the boss HUD/letterbox pass after drawHUD.
   * Pure instance overrides — game.js is not modified.
   */
  function hookGame(game) {
    if (!game || game._bossHooked) return;
    game._bossHooked = true;
    game._bosses = game._bosses || [];
    if (typeof game.cameraTarget === 'function') {
      const orig = game.cameraTarget.bind(game);
      game.cameraTarget = function () {
        const t = orig();
        const f = game._bossCam;
        if (f && f.k > 0.001) {
          const W = G.VIEW_W, H = G.VIEW_H, L = game.level;
          let x = f.x - W / 2, y = f.y - H / 2;
          x = L.pxW <= W ? (L.pxW - W) / 2 : G.clamp(x, 0, L.pxW - W);
          y = L.pxH <= H ? (L.pxH - H) / 2 : G.clamp(y, 0, L.pxH - H);
          t.x = G.lerp(t.x, x, f.k); t.y = G.lerp(t.y, y, f.k);
        }
        return t;
      };
    }
    if (typeof game.drawHUD === 'function') {
      const origHUD = game.drawHUD.bind(game);
      game.drawHUD = function (ctx, t) {
        origHUD(ctx, t);
        if (G.Art.Bosses && G.Art.Bosses.drawHUD) for (const b of game._bosses) G.Art.Bosses.drawHUD(ctx, b, t, game);
      };
    }
  }

  // ================================================================== boss parts / projectiles
  /**
   * bossproj — pooled projectile or level-placed boss prop. `live` = simulated and drawn.
   * Fields by kind:
   *  orb    {x,y (centre), vx, vy, r, life}                    homing glyph orb (archivist)
   *  crystal{x,y (centre), ready, regrowT}                      dash refill on the exposure path
   *  shell  {x,y, vx, vy, r, deflected, tx, ty (target)}        arcing cannon shell (colossus)
   *  blast  {x,y, r, life, maxLife, harmless}                   explosion
   *  shock  {x,y (floor point), dir, speed, h, life}            stomp shockwave
   *  seeker {x,y (centre), vx, vy, r, eye{x,y}, spawnT}        sentinel drone (warden)
   *  pillar {x,y,w,h rect; state 'up'|'down'|'rising', heat 0..1, downT, riseT, hitT}
   *  fan    {x,y,w,h zone; hx,hy housing; dir ±1; powered; spin}
   */
  Types.bossproj = class extends Base {
    constructor(d, l) {
      super(d, l);
      this.live = d.kind === 'pillar' || d.kind === 'fan';
      this.owner = d.owner || null;
      if (d.kind === 'pillar') {
        const h = (d.h || 3);
        this.x = d.x * T + 4; this.w = T - 8; this.h = h * T; this.y = (d.y + 1) * T - this.h;
        this.state = 'up'; this.heat = 0; this.downT = 0; this.riseT = 1; this.hitT = 0;
      } else if (d.kind === 'fan') {
        // housing on tile (x,y) on the floor; the wind zone extends `len` tiles toward `dir`, `h` tiles up
        this.dirX = d.dir === 'left' ? -1 : 1;
        const len = d.len || 8, h = d.h || 7;
        this.hx = d.x * T + T / 2; this.hy = (d.y + 1) * T;
        this.w = len * T; this.h = h * T;
        this.x = this.dirX > 0 ? (d.x + 1) * T : d.x * T - this.w; this.y = (d.y + 1) * T - this.h;
        this.spin = 0;
      } else { this.w = 16; this.h = 16; }
    }
    /** Activate a pooled projectile. */
    fire(kind, o) {
      Object.assign(this, { vx: 0, vy: 0, r: 8, life: 1, maxLife: 1, deflected: false, harmless: false, ready: true, regrowT: 0, spawnT: 0, t: 0 }, o);
      this.kind = kind; this.live = true; this.maxLife = this.life;
      this.syncRect();
      return this;
    }
    syncRect() { const r = Math.max(this.r || 8, 8); this.w = this.h = r * 2; this.x = this.px - r; this.y = this.py - r; }
    kill() { this.live = false; }
    update(dt, game) {
      this.t += dt;
      if (this.kind === 'pillar') return this.updatePillar(dt);
      if (this.kind === 'fan') return this.updateFan(dt, game);
      if (!this.live) return;
      const o = this.owner;
      if (o && o.frozenWorld(game)) return;
      const p = game.player, L = game.level;
      const C = BC();
      switch (this.kind) {
        case 'orb': {
          // slow homing: rotate velocity toward the player at a capped turn rate
          const A = C.archivist, phs = o ? o.phase : 0;
          const want = Math.atan2(p.cy - this.py, p.cx - this.px);
          let ang = Math.atan2(this.vy, this.vx);
          const sp = ph(A.orbSpeed, phs);
          ang += G.clamp(angDiff(ang, want), -ph(A.orbTurn, phs) * dt, ph(A.orbTurn, phs) * dt);
          this.vx = Math.cos(ang) * sp; this.vy = Math.sin(ang) * sp;
          this.px += this.vx * dt; this.py += this.vy * dt; this.life -= dt;
          const hitPillar = o && o.pillars && o.pillars.some((q) => q.state === 'up' && circleRect(this.px, this.py, this.r, q));
          if (this.life <= 0 || hitPillar || L.isSolidTile(Math.floor(this.px / T), Math.floor(this.py / T))) { this.pop('#c8a8ff'); return; }
          if (!p.dead && circleRect(this.px, this.py, this.r - 2, hurtBox(p))) { p.kill(C.common.killCause); this.pop('#c8a8ff'); return; }
          break;
        }
        case 'crystal': {
          if (!this.ready) { this.regrowT -= dt; if (this.regrowT <= 0) this.ready = true; }
          else if (!p.dead && circleRect(this.px, this.py, 16, p) && refillDash(p)) {
            this.ready = false; this.regrowT = (G.CONFIG.dashcrystal && G.CONFIG.dashcrystal.regrow) || 2.5;
            G.Audio.play('jumppad', { volume: 0.5 });
            G.fx.burst(this.px, this.py, { count: 12, color: ['#ff7ad9', '#ffffff'], speed: 160, life: 0.5, gravity: 0, glow: true });
          }
          break;
        }
        case 'shell': {
          const S = C.colossus;
          this.vy += S.shellGravity * dt;
          this.px += this.vx * dt; this.py += this.vy * dt;
          this.life -= dt;
          // a powered fan catches enemy shells and lobs them back into the colossus' vent
          if (!this.deflected && o) for (const f of o.fans) {
            if (f.powered && this.px > f.x && this.px < f.x + f.w && this.py > f.y && this.py < f.y + f.h) { o.deflect(this); break; }
          }
          if (this.deflected && o) {
            const v = o.ventPos();
            if (Math.hypot(this.px - v.x, this.py - v.y) < 34) { o.shellReturned(this, game); return; }
          }
          if (this.life <= 0 || this.py > L.pxH + 64 || L.isSolidTile(Math.floor(this.px / T), Math.floor((this.py + this.r * 0.5) / T))) {
            this.explode(this.deflected); return;
          }
          if (!this.deflected && !p.dead && circleRect(this.px, this.py, this.r - 2, hurtBox(p))) { p.kill(C.common.killCause); this.explode(false); return; }
          break;
        }
        case 'blast': {
          this.life -= dt;
          if (!this.harmless && !p.dead && this.life > this.maxLife * 0.35 && circleRect(this.px, this.py, this.r, hurtBox(p))) p.kill(C.common.killCause);
          if (this.life <= 0) this.live = false;
          break;
        }
        case 'shock': {
          this.px += this.dir * this.speed * dt; this.life -= dt;
          const ahead = Math.floor((this.px + this.dir * 8) / T), fy = Math.floor((this.py - 8) / T);
          const noFloor = !L.isSolidTile(Math.floor(this.px / T), Math.floor((this.py + 4) / T));
          if (this.life <= 0 || L.isSolidTile(ahead, fy) || noFloor) { this.live = false; G.fx.dust(this.px, this.py, 6); return; }
          const R = { x: this.px - 12, y: this.py - this.h, w: 24, h: this.h };
          if (!p.dead && G.overlap(hurtBox(p), R)) p.kill(C.common.killCause);
          if (Math.random() < 0.5) G.fx.dust(this.px, this.py, 1);
          break;
        }
        case 'seeker': {
          const W = C.warden, phs = o ? o.phase : 0;
          if (this.spawnT > 0) { this.spawnT -= dt; this.py -= 30 * dt; break; }
          const max = ph(W.seekerSpeed, phs);
          const dx = p.cx - this.px, dy = (p.cy - 6) - this.py, d = Math.hypot(dx, dy) || 1;
          this.vx = G.approach(this.vx, (dx / d) * max, W.seekerAccel * dt);
          this.vy = G.approach(this.vy, (dy / d) * max, W.seekerAccel * dt);
          const nx = this.px + this.vx * dt, ny = this.py + this.vy * dt;
          if (L.isSolidTile(Math.floor((nx + Math.sign(this.vx) * this.r) / T), Math.floor(this.py / T))) this.vx = 0; else this.px = nx;
          if (L.isSolidTile(Math.floor(this.px / T), Math.floor((ny + Math.sign(this.vy) * this.r) / T))) this.vy = 0; else this.py = ny;
          this.eye = { x: p.cx, y: p.cy };
          if (!p.dead && circleRect(this.px, this.py, this.r - 1, hurtBox(p))) p.kill(C.common.killCause);
          break;
        }
      }
      this.syncRect();
    }
    pop(color) {
      this.live = false;
      G.fx.burst(this.px, this.py, { count: 10, color: [color, '#ffffff'], speed: 140, life: 0.45, gravity: 0, glow: true });
    }
    explode(harmless) {
      this.live = false;
      const o = this.owner;
      if (o) o.spawn('blast', { px: this.px, py: this.py, r: BC().colossus.blastR, life: BC().colossus.blastTime, harmless });
      G.fx.burst(this.px, this.py, { count: 22, color: ['#ffb36b', '#ff6a3a', '#fff1c0'], speed: 260, life: 0.6, gravity: 300, glow: true });
      G.fx.shake(5, 0.25);
      if (G.game && G.game.isNear && G.game.isNear(this.px, this.py, 700)) G.Audio.play('explosion', { volume: 0.6 });
    }
    updatePillar(dt) {
      this.hitT = Math.max(0, this.hitT - dt);
      if (this.state === 'down') this.downT += dt;
      if (this.state === 'rising') { this.riseT += dt / 1.2; if (this.riseT >= 1) { this.riseT = 1; this.state = 'up'; } }
    }
    collapse() {
      this.state = 'down'; this.downT = 0; this.heat = 0;
      G.fx.burst(this.cx, this.y + 10, { count: 26, color: ['#ffcf6b', '#a07850', '#fff1c0'], speed: 220, life: 0.8, gravity: 600 });
      G.fx.shake(6, 0.35); G.Audio.play('crumble');
    }
    regrow() { if (this.state === 'down') { this.state = 'rising'; this.riseT = 0; this.heat = 0; } }
    updateFan(dt, game) {
      this.spin += dt * (this.powered ? 14 : 1.5);
      const p = game.player;
      if (this.powered && !p.dead && G.overlap(p, this)) {
        G.Physics.move(p, this.dirX * BC().colossus.fanPush * dt, 0, game.level);
      }
    }
  };

  // ================================================================== boss base
  class BossBase extends Base {
    constructor(d, l) {
      super(d, l);
      this.kind = d.kind || 'archivist';
      this.num = NUM[this.kind] || 1;
      this.cfg = BC()[this.kind];
      this.maxHp = this.cfg.hp; this.hp = this.maxHp;
      this.phase = 0;
      this.state = 'dormant';
      this.stateT = 0;
      this.hurtT = 0; this.introT = 0; this.roarT = 99; this.deathT = 0; this.phaseT = 0;
      this.telegraphT = 0; this.atk = null; this.gapT = 1.2; this.patIdx = 0; this.graceT = 0;
      this.facing = -1; this.letterbox = 0; this.hudA = 0;
      // anchor point = the tile the boss is placed on
      this.homeX = d.x * T + T / 2; this.homeY = d.y * T + T / 2;
      this.bx = this.homeX; this.by = this.homeY;
      this.floorY = floorBelow(l, this.homeX, this.homeY);
      const a = d.arena || [d.x - 15, d.y - 12, 30, 16];
      this.arena = { x: a[0] * T, y: a[1] * T, w: a[2] * T, h: a[3] * T };
      Object.assign(this, { x: this.arena.x, y: this.arena.y, w: this.arena.w, h: this.arena.h });
      this.pool = [];
      for (let i = 0; i < BC().common.projectilePool; i++) {
        const e = l.add({ type: 'bossproj', kind: 'none', x: 0, y: 0, owner: this });
        if (e) this.pool.push(e);
      }
      this.introId = d.dialogue ? d.dialogue + '_intro' : `boss${this.num}_intro`;
      this.downId = d.dialogue ? d.dialogue + '_down' : `boss${this.num}_down`;
      this._wasDead = false;
    }
    /** Is the boss (and its projectiles) paused this frame? (blocking dialogue, intro, dead) */
    frozenWorld(game) { return !!(game.dialogue && game.dialogue.blocking) || this.state === 'intro'; }
    spawn(kind, o) {
      const e = this.pool.find((q) => !q.live);
      return e ? e.fire(kind, o) : null;
    }
    clearProjectiles(kinds) { for (const e of this.pool) if (e.live && (!kinds || kinds.includes(e.kind))) e.live = false; }
    get alive() { return this.state !== 'dying' && this.state !== 'dead'; }
    get invulnerable() { return this.state !== 'fight' || this.hurtT > 0; }
    playerInArena(p) {
      const pad = BC().common.wakePad * T, A = this.arena;
      return !p.dead && G.overlap(p, { x: A.x - pad, y: A.y - pad, w: A.w + pad * 2, h: A.h + pad * 2 });
    }
    setState(s) { this.state = s; this.stateT = 0; }

    update(dt, game) {
      this.t += dt; this.stateT += dt;
      hookGame(game);
      if (game._bosses && !game._bosses.includes(this)) game._bosses.push(this);
      const p = game.player, C = BC().common;
      this.hurtT = Math.max(0, this.hurtT - dt);
      this.roarT += dt;
      // ---- player death / respawn: reset cleanly, keep HP + phase
      if (p.dead && !this._wasDead && this.alive && this.state !== 'dormant') this.onPlayerDeath(game);
      if (!p.dead && this._wasDead) this.graceT = C.reengageDelay;
      this._wasDead = p.dead;
      this.graceT = Math.max(0, this.graceT - dt);

      const inArena = this.playerInArena(p);
      const fighting = this.state === 'fight' || this.state === 'phase';
      this.hudA = G.approach(this.hudA, (fighting && inArena) || this.state === 'intro' || this.state === 'dying' ? 1 : 0, dt * 2);
      this.letterbox = G.approach(this.letterbox, this.state === 'intro' && this.stateT < C.introTime - 0.4 ? 1 : 0, dt * 2.5);
      this.camFocus(game, inArena, dt);

      switch (this.state) {
        case 'dormant':
          this.idle(dt, game);
          if (inArena) this.startIntro(game);
          return;
        case 'intro': return this.updateIntro(dt, game);
        case 'dying': return this.updateDying(dt, game);
        case 'dead': return;
      }
      if (this.frozenWorld(game)) return;
      if (this.state === 'phase') {
        this.idle(dt, game);
        if (this.stateT >= C.phaseShiftTime) { this.setState('fight'); this.onPhaseStart(game); }
        return;
      }
      // fight
      if (!inArena || this.graceT > 0) { this.idle(dt, game); return; }
      this.fight(dt, game);
    }

    /** Camera: intro = hard focus on the boss; fight = gentle bias so the boss stays in frame. */
    camFocus(game, inArena, dt) {
      const C = BC().common;
      let k = 0;
      if (this.state === 'intro') k = this.stateT < C.introTime - C.camZoomHold * 0.5 ? 1 : 0.4;
      else if ((this.state === 'fight' || this.state === 'phase') && inArena) k = 0.35;
      else if (this.state === 'dying') k = 0.8;
      const fx = k >= 0.99 ? this.bx : (this.bx + game.player.cx) / 2;
      const fy = k >= 0.99 ? this.by : (this.by + game.player.cy) / 2;
      if (!game._bossCam || game._bossCam.owner === this || game._bossCam.k < 0.01) {
        const prev = game._bossCam && game._bossCam.owner === this ? game._bossCam.k : 0;
        game._bossCam = { owner: this, x: fx, y: fy, k: G.approach(prev, k, dt * 1.6) };
      }
    }

    startIntro(game) {
      this.setState('intro');
      this.introT = 0;
      const p = game.player;
      this._froze = !p.frozen;
      p.frozen = true; p.vx = 0;
      G.Audio.play('rumble');
      G.fx.shake(4, 1.2);
      if (typeof game.cineFocus === 'function') game.cineFocus(this.bx, this.by, BC().common.introZoom, BC().common.introTime);
    }
    updateIntro(dt, game) {
      const C = BC().common;
      this.introT = this.stateT;
      this.idle(dt, game);
      if (this.stateT - dt < C.introRoarAt && this.stateT >= C.introRoarAt) {
        this.roarT = 0;
        G.Audio.play('explosion'); G.Audio.play('alarm', { volume: 0.5 });
        G.fx.shake(12, 0.9);
      }
      if (this.stateT >= C.introTime) {
        if (this._froze) game.player.frozen = false;
        this.setState('fight');
        this.gapT = 1.0;
        this.onPhaseStart(game);
        if (say(this.introId)) game.playDialogue(this.introId);
      }
    }

    /** Deal one point of damage (each kind decides WHEN this is allowed). */
    hit(game) {
      if (!this.alive) return false;
      this.hp = Math.max(0, this.hp - 1);
      this.hurtT = BC().common.hurtTime;
      this.atk = null; this.telegraphT = 0;
      G.Audio.play('explosion'); G.fx.shake(10, 0.6);
      G.fx.burst(this.bx, this.by, { count: 40, color: ['#ffffff', '#ffe17a', '#ff7a5a'], speed: 360, life: 0.9, gravity: 200, glow: true });
      if (this.hp <= 0) { this.die(game); return true; }
      const np = this.phaseFor(this.hp);
      if (np !== this.phase) {
        this.phase = np; this.setState('phase'); this.roarT = 0;
        this.clearProjectiles();
        G.Audio.play('rumble'); G.fx.shake(8, 1.4);
      }
      return true;
    }
    phaseFor(hp) { return G.clamp(this.maxHp - hp, 0, 2); }
    die(game) {
      this.setState('dying'); this.deathT = 0; this.atk = null; this.telegraphT = 0;
      this.clearProjectiles();
      if (game.player.frozen === false) { /* she may keep moving */ }
    }
    updateDying(dt, game) {
      const C = BC().common;
      this.deathT = this.stateT;
      // chained explosions, then a white-out and the final crash
      const k = Math.floor(this.stateT * 6), pk = Math.floor((this.stateT - dt) * 6);
      if (k !== pk && this.stateT < C.deathTime - 0.4) {
        const r = G.rng(k * 977 + this.num);
        const ox = (r() - 0.5) * 140, oy = (r() - 0.5) * 140;
        G.fx.burst(this.bx + ox, this.by + oy, { count: 16, color: ['#fff1c0', '#ffb36b', '#ff5a3a'], speed: 240, life: 0.6, gravity: 100, glow: true });
        if (k % 2 === 0) G.Audio.play('explosion', { volume: 0.7 });
        G.fx.shake(6, 0.3);
      }
      if (this.stateT >= C.deathTime) {
        this.setState('dead');
        this.active = true;
        G.Audio.play('explosion'); G.fx.shake(14, 1.0);
        G.fx.burst(this.bx, this.by, { count: 80, color: ['#ffffff', '#ffe17a', '#7ef9ff'], speed: 520, life: 1.2, gravity: 150, glow: true });
        if (say(this.downId)) game.playDialogue(this.downId);
        this.onDead(game);
      }
    }
    onPlayerDeath(game) {
      this.clearProjectiles();
      this.atk = null; this.telegraphT = 0; this.gapT = 1.0;
      if (this.state === 'phase') { this.setState('fight'); this.onPhaseStart(game); }
      this.resetPosition(game);
    }
    /** Next attack from this phase's pattern (deterministic cycle). */
    nextAttack() {
      const pat = this.cfg.pattern[Math.min(this.phase, this.cfg.pattern.length - 1)];
      const a = pat[this.patIdx % pat.length]; this.patIdx++;
      return a;
    }
    // overridden per kind
    idle() {}
    fight() {}
    onPhaseStart() {}
    resetPosition() { this.bx = this.homeX; this.by = this.homeY; }
    onDead() {}
  }

  // ================================================================== 1 — Архивариус
  /**
   * Archivist. Extra art fields: shield (bool), shieldA 0..1, exposed, exposeT, exposeMax,
   * laser {stage 'aim'|'lock'|'fire'|null, ang, len, dir (sweep ±1), x, y (eye)}, charge 0..1 (orb glow).
   */
  class Archivist extends BossBase {
    constructor(d, l) {
      super(d, l);
      this.hoverY = this.floorY - this.cfg.hoverTiles * T;
      this.homeY = this.by = this.hoverY;
      this.exposed = false; this.exposeT = 0; this.exposeMax = 1;
      this.laser = { stage: null, ang: Math.PI / 2, len: 0, dir: 1, x: this.bx, y: this.by };
      this.sweepSign = 1; this.shieldA = 1; this.charge = 0;
      this.crystals = [];
      this.pillars = null;
    }
    findPillars(game) {
      if (this.pillars) return;
      const A = this.arena;
      this.pillars = game.level.entities.filter((e) => e.type === 'bossproj' && e.kind === 'pillar' && G.overlap(e, A));
      if (!this.pillars.length) {
        for (const dx of [-8, 0, 8]) {
          const tx = Math.floor(this.homeX / T) + dx;
          this.pillars.push(game.level.add({ type: 'bossproj', kind: 'pillar', x: tx, y: Math.floor(this.floorY / T) - 1, h: 3 }));
        }
      }
    }
    get shield() { return !this.exposed; }
    eye() { return { x: this.bx, y: this.by - 26 }; }
    idle(dt, game) {
      this.findPillars(game);
      this.by = G.lerp(this.by, (this.exposed ? this.floorY - this.cfg.exposeHoverTiles * T : this.hoverY) + Math.sin(this.t * 1.3) * 6, G.damp(2, dt));
      this.shieldA = G.approach(this.shieldA, this.exposed ? 0 : 1, dt * 3);
    }
    update(dt, game) {
      this.findPillars(game);
      super.update(dt, game);
      const p = game.player;
      if (!this.alive || this.state === 'dormant' || this.state === 'intro' || p.dead || this.frozenWorld(game)) return;
      // body contact: shield kills; open core takes a dash strike; otherwise she bounces off
      const dx = p.cx - this.bx, dy = p.cy - this.by;
      if (this.exposed && this.state === 'fight') {
        if (circleRect(this.bx, this.by, this.cfg.coreR + 6, p) && isStriking(p)) {
          this.exposed = false; this.crystalsOff();
          p.vx = Math.sign(dx || 1) * 320; p.vy = -420;
          this.hit(game);
          if (this.alive && this.state === 'fight') this.onPhaseStart(game);
        } else if (circleRect(this.bx, this.by, this.cfg.bodyR * 0.8, hurtBox(p))) {
          p.vx = Math.sign(dx || 1) * 260; p.vy = Math.max(p.vy, 120);
        }
      } else if (circleRect(this.bx, this.by, this.cfg.bodyR, hurtBox(p))) p.kill(BC().common.killCause);
    }
    fight(dt, game) {
      const c = this.cfg, i = this.phase, p = game.player;
      this.idle(dt, game);
      if (this.exposed) {
        this.exposeT -= dt;
        if (this.exposeT <= 0) { this.exposed = false; this.crystalsOff(); for (const q of this.pillars) q.regrow(); this.gapT = 1.5; G.Audio.play('alarm', { volume: 0.4 }); }
        return;
      }
      // drift toward the player (slow), never during the beam
      if (!this.atk || this.atk.name !== 'laser' || this.laser.stage === 'aim') {
        const tx = G.clamp(p.cx, this.arena.x + 3 * T, this.arena.x + this.arena.w - 3 * T);
        this.bx = G.approach(this.bx, tx, ph(c.driftSpeed, i) * dt);
        this.facing = p.cx < this.bx ? -1 : 1;
      }
      // shield drops once every pillar is down
      if (this.pillars.length && this.pillars.every((q) => q.state === 'down') && !this.atk) return this.expose(game);
      if (!this.atk) {
        this.gapT -= dt; this.telegraphT = 0;
        if (this.gapT <= 0) this.atk = { name: this.nextAttack(), t: 0, n: 0 };
        return;
      }
      const a = this.atk; a.t += dt;
      if (a.name === 'orbs') {
        const tel = ph(c.orbTelegraph, i);
        this.telegraphT = Math.min(1, a.t / tel); this.charge = this.telegraphT;
        if (a.t >= tel) {
          const due = Math.floor((a.t - tel) / c.orbSpacing) + 1;
          while (a.n < Math.min(due, ph(c.orbCount, i))) {
            const side = a.n % 2 ? 1 : -1;
            const hx = this.bx + side * 62, hy = this.by + 8;
            const ang = Math.atan2(p.cy - hy, p.cx - hx) + side * 0.6;
            this.spawn('orb', { px: hx, py: hy, vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60, r: c.orbR, life: c.orbLife });
            G.Audio.play('laserOn', { volume: 0.35 });
            a.n++;
          }
          if (a.n >= ph(c.orbCount, i)) { this.endAttack(); }
        }
      } else if (a.name === 'laser') this.updateLaser(dt, game);
    }
    updateLaser(dt, game) {
      const c = this.cfg, i = this.phase, p = game.player, a = this.atk, L = this.laser;
      const e = this.eye(); L.x = e.x; L.y = e.y;
      const toP = Math.atan2(p.cy - e.y, p.cx - e.x);
      if (!L.stage) { L.stage = 'aim'; L.ang = toP; L.dir = this.sweepSign; this.sweepSign = -this.sweepSign; a.t = 0; }
      if (L.stage === 'aim') {
        L.ang += G.clamp(angDiff(L.ang, toP), -3 * dt, 3 * dt);
        this.telegraphT = Math.min(1, a.t / ph(c.laserTelegraph, i));
        if (a.t >= ph(c.laserTelegraph, i)) { L.stage = 'lock'; a.t = 0; G.Audio.play('alarm', { volume: 0.35 }); }
      } else if (L.stage === 'lock') {
        this.telegraphT = 1;
        if (a.t >= c.laserLockTime) { L.stage = 'fire'; a.t = 0; a.swept = 0; G.Audio.play('laserOn'); G.fx.shake(4, 0.4); }
      } else if (L.stage === 'fire') {
        this.telegraphT = 0;
        if (a.t > c.laserHold) {
          const s = ph(c.laserSweepSpeed, i) * dt;
          L.ang += L.dir * s; a.swept += s;
        }
        this.castBeam(game, dt);
        if (a.swept >= ph(c.laserSweep, i)) {
          for (const q of this.pillars) if (q.state === 'up' && q.heat >= 1) q.collapse(); else q.heat = 0;
          L.stage = null; this.endAttack();
        }
      }
      if (L.stage !== 'fire') L.len = rayLen(game.level, e.x, e.y, L.ang, c.laserRange);
    }
    /** Beam: stops at the first solid tile or standing pillar (pillars absorb it and overheat). */
    castBeam(game, dt) {
      const c = this.cfg, L = this.laser, p = game.player;
      let len = rayLen(game.level, L.x, L.y, L.ang, c.laserRange);
      const ex = L.x + Math.cos(L.ang) * len, ey = L.y + Math.sin(L.ang) * len;
      let hitP = null, best = 2;
      for (const q of this.pillars) {
        if (q.state !== 'up') continue;
        const tt = segRect(L.x, L.y, ex, ey, q);
        if (tt >= 0 && tt < best) { best = tt; hitP = q; }
      }
      if (hitP) {
        len *= best;
        hitP.heat = Math.min(1, hitP.heat + dt / c.pillarHeat); hitP.hitT = 0.1;
        if (Math.random() < 0.6) G.fx.burst(L.x + Math.cos(L.ang) * len, L.y + Math.sin(L.ang) * len, { count: 2, color: ['#ffcf6b', '#ffffff'], speed: 160, life: 0.3, gravity: 300 });
      }
      L.len = len;
      if (!p.dead) {
        const hb = hurtBox(p), hw = c.laserWidth / 2;
        const R = { x: hb.x - hw, y: hb.y - hw, w: hb.w + hw * 2, h: hb.h + hw * 2 };
        if (segRect(L.x, L.y, L.x + Math.cos(L.ang) * len, L.y + Math.sin(L.ang) * len, R) >= 0) p.kill(BC().common.killCause);
      }
    }
    endAttack() { this.atk = null; this.telegraphT = 0; this.charge = 0; this.laser.stage = null; this.gapT = ph(this.cfg.attackGap, this.phase); }
    expose(game) {
      this.exposed = true; this.exposeMax = this.exposeT = ph(this.cfg.exposeTime, this.phase);
      this.clearProjectiles(['orb']);
      G.Audio.play('explosion'); G.Audio.play('solved'); G.fx.shake(8, 0.8);
      G.fx.burst(this.bx, this.by, { count: 50, color: ['#9ad8ff', '#ffffff'], speed: 420, life: 0.8, gravity: 0, glow: true });
      const fx = Math.floor(this.bx / T) * T + T / 2;
      const fl = floorBelow(game.level, fx, this.by + 40);
      this.crystals = this.cfg.crystalOffsets.map(([ox, oy]) => this.spawn('crystal', { px: fx + ox * T, py: fl + oy * T, r: 12, life: 999 })).filter(Boolean);
    }
    crystalsOff() { for (const c of this.crystals) c.live = false; this.crystals = []; }
    onPhaseStart() { this.exposed = false; this.crystalsOff(); if (this.cfg.pillarRegrow) for (const q of this.pillars || []) q.regrow(); this.gapT = 1.4; this.patIdx = 0; }
    resetPosition() {
      this.bx = this.homeX; this.by = this.hoverY; this.laser.stage = null;
      this.exposed = false; this.crystalsOff();
      if (this.cfg.pillarRegrow) for (const q of this.pillars || []) { q.regrow(); q.heat = 0; }
    }
  }

  // ================================================================== 2 — Колосс Бурь
  /**
   * Colossus. Feet at floor (bx = centre, by = body centre, footY). Extra art fields: walkT (gait),
   * moving, turnT (0..1 turning), ventOpen, ventT (0..1 open), reticle {x,y} (shell landing marker),
   * stompT (0..1 leg raised), valveGone (ripped this reload), cannonAng.
   */
  class Colossus extends BossBase {
    constructor(d, l) {
      super(d, l);
      this.footY = this.floorY;
      this.by = this.footY - this.cfg.h / 2; this.homeY = this.by;
      this.walkT = 0; this.moving = false; this.turnT = 0; this.ventOpen = false; this.ventT = 0;
      this.reticle = null; this.stompT = 0; this.valveGone = false; this.cannonAng = -0.6;
      this._fans = null;
    }
    /** Level-placed fans inside the arena (looked up lazily: they may be listed after the boss). */
    get fans() {
      if (!this._fans) this._fans = this.level.entities.filter((e) => e.type === 'bossproj' && e.kind === 'fan' && G.overlap(e, this.arena));
      return this._fans;
    }
    phaseFor(hp) { return G.clamp(Math.floor((this.maxHp - hp) / this.cfg.hitsPerPhase), 0, 2); }
    bodyBox() { const c = this.cfg; return { x: this.bx - c.w * 0.36, y: this.footY - c.h * 0.86, w: c.w * 0.72, h: c.h * 0.86 }; }
    ventPos() { const c = this.cfg; return { x: this.bx - this.facing * c.w * 0.44, y: this.footY - c.h * 0.74 }; }
    muzzle() { const c = this.cfg; return { x: this.bx + this.facing * c.w * 0.42, y: this.footY - c.h * 0.9 }; }
    idle(dt) {
      this.ventT = G.approach(this.ventT, this.ventOpen ? 1 : 0, dt * 3);
      this.stompT = G.approach(this.stompT, 0, dt * 2);
      this.moving = false;
    }
    update(dt, game) {
      super.update(dt, game);
      const p = game.player;
      if (!this.alive || this.state === 'dormant' || this.state === 'intro' || p.dead || this.frozenWorld(game)) return;
      // back valve: open only while reloading; touching it rips it out (1 hit)
      if (this.ventOpen && !this.valveGone && this.state === 'fight') {
        const v = this.ventPos();
        if (circleRect(v.x, v.y, this.cfg.valveR, p)) {
          this.valveGone = true;
          p.vx = -this.facing * 340; p.vy = -520;
          G.Audio.play('repair');
          G.fx.burst(v.x, v.y, { count: 30, color: ['#e8f4ff', '#9ab0c0'], speed: 300, life: 0.9, gravity: -60 });
          this.hit(game); this.closeVent();
          return;
        }
      }
      if (this.cfg.bodyKill && this.state !== 'dying' && G.overlap(hurtBox(p), this.bodyBox())) p.kill(BC().common.killCause);
    }
    fight(dt, game) {
      const c = this.cfg, i = this.phase, p = game.player;
      this.idle(dt);
      // turning is slow and impossible while reloading (that is the window to get behind it)
      const want = p.cx < this.bx ? -1 : 1;
      if (want !== this.facing && !this.ventOpen && (!this.atk || this.atk.name === 'gap')) {
        this.turnT += dt / c.turnTime;
        if (this.turnT >= 1) { this.facing = want; this.turnT = 0; G.fx.shake(3, 0.3); G.Audio.play('crateland'); }
      } else this.turnT = Math.max(0, this.turnT - dt * 2);
      if (this.ventOpen) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) this.closeVent();
        return;
      }
      if (!this.atk) {
        // walk (slowly) to keep ~6 tiles from her, within its range
        const target = G.clamp(p.cx - this.facing * 6 * T, this.homeX - c.rangeTiles * T, this.homeX + c.rangeTiles * T);
        if (Math.abs(target - this.bx) > 8 && this.turnT === 0) {
          const nb = G.approach(this.bx, target, ph(c.walkSpeed, i) * dt);
          const edge = nb + Math.sign(nb - this.bx) * c.w * 0.5;
          if (!game.level.isSolidTile(Math.floor(edge / T), Math.floor((this.footY - 8) / T))) { this.bx = nb; this.moving = true; this.walkT += dt; }
        }
        this.gapT -= dt; this.telegraphT = 0;
        if (this.gapT <= 0) this.atk = { name: this.nextAttack(), t: 0, n: 0 };
        return;
      }
      const a = this.atk; a.t += dt;
      if (a.name === 'salvo') {
        const tel = ph(c.shellTelegraph, i);
        this.telegraphT = Math.min(1, a.t / tel);
        if (!this.reticle) {
          const fx = G.clamp(p.cx, this.arena.x + T, this.arena.x + this.arena.w - T);
          this.reticle = { x: fx, y: floorBelow(game.level, fx, p.y) };
        }
        // reticle follows her during the first 60% of the telegraph, then locks
        if (this.telegraphT < 0.6) { this.reticle.x = G.approach(this.reticle.x, p.cx, 400 * dt); this.reticle.y = floorBelow(game.level, this.reticle.x, p.y); }
        const m = this.muzzle();
        this.cannonAng = Math.atan2(this.reticle.y - 200 - m.y, (this.reticle.x - m.x)) ;
        if (a.t >= tel) {
          const F = ph(c.shellFlight, i), g = c.shellGravity;
          const vx = (this.reticle.x - m.x) / F, vy = (this.reticle.y - 6 - m.y - 0.5 * g * F * F) / F;
          this.spawn('shell', { px: m.x, py: m.y, vx, vy, r: c.shellR, life: F + 1.5 });
          G.Audio.play('explosion', { volume: 0.5 }); G.fx.shake(4, 0.25);
          G.fx.burst(m.x, m.y, { count: 14, color: ['#fff1c0', '#ffb36b'], speed: 220, life: 0.35, gravity: 0, glow: true, angle: Math.atan2(vy, vx), spread: 0.6 });
          this.muzzleT = 0.15;
          a.n++; a.t = 0; this.reticle = null;
          if (a.n >= ph(c.salvo, i)) { this.atk = null; this.openVent(); }
        }
      } else if (a.name === 'stomp') {
        const tel = ph(c.stompTelegraph, i);
        this.telegraphT = Math.min(1, a.t / tel);
        this.stompT = this.telegraphT;
        if (a.t >= tel) {
          this.stompT = 0;
          const fx = this.bx + this.facing * c.w * 0.3;
          for (const dir of [-1, 1]) this.spawn('shock', { px: fx + dir * c.w * 0.3, py: this.footY, dir, speed: ph(c.shockSpeed, i), h: c.shockH, life: c.shockLife, r: 14 });
          G.Audio.play('explosion'); G.Audio.play('rumble', { volume: 0.6 }); G.fx.shake(10, 0.5);
          G.fx.dust(fx, this.footY, 14);
          this.atk = null; this.telegraphT = 0; this.gapT = ph(c.attackGap, i);
        }
      }
    }
    openVent() { this.ventOpen = true; this.valveGone = false; this.reloadT = ph(this.cfg.reloadTime, this.phase); this.telegraphT = 0; G.Audio.play('wind', { volume: 0.5 }); }
    closeVent() { this.ventOpen = false; this.gapT = ph(this.cfg.attackGap, this.phase); }
    /** A powered fan caught `s`: lob it back into the vent along an exact ballistic arc. */
    deflect(s) {
      const v = this.ventPos(), F = this.cfg.deflectFlight, g = this.cfg.shellGravity;
      s.vx = (v.x - s.px) / F; s.vy = (v.y - s.py - 0.5 * g * F * F) / F;
      s.deflected = true; s.life = F + 0.6;
      G.Audio.play('wind', { volume: 0.6 });
      G.fx.burst(s.px, s.py, { count: 10, color: ['#bfe8ff', '#ffffff'], speed: 180, life: 0.4, gravity: 0 });
    }
    shellReturned(s, game) {
      s.explode(true);
      if (this.ventOpen && this.state === 'fight') { this.hit(game); this.closeVent(); }
      else { G.Audio.play('crateland'); } // clanged off closed armour
    }
    onPhaseStart() { this.gapT = 1.2; this.patIdx = 0; this.ventOpen = false; }
    resetPosition() { this.bx = this.homeX; this.ventOpen = false; this.reticle = null; this.stompT = 0; this.turnT = 0; }
  }

  // ================================================================== 3 — Первый Страж
  /**
   * Warden. Extra art fields: arms [{ang, len}], armState 'on'|'warn'|'off', armK 0..1 (beam power),
   * filled (sockets), socketsTotal, exposed, openT 0..1 (shell open), exposeT, hatchT 0..1 (spawn glow).
   */
  class Warden extends BossBase {
    constructor(d, l) {
      super(d, l);
      this.armAng = 0; this.armState = 'on'; this.armT = 0; this.armK = 1; this.arms = [];
      this.filled = 0; this.socketsTotal = 3; this.exposed = false; this.openT = 0; this.exposeT = 0;
      this.spawnT = 2.5; this.hatchT = 0; this.sockets = null;
      this.cells = [];
      for (let n = 0; n < 3; n++) {
        const c = l.add({ type: 'part', item: this.cfg.cellItem, x: 0, y: 0 });
        if (c) { c.taken = true; c.hidden = true; c.delivered = false; this.cells.push(c); }
      }
    }
    findSockets(game) {
      if (this.sockets) return;
      const A = this.arena;
      this.sockets = game.level.entities.filter((e) => e.type === 'socket' && e.needs === this.cfg.cellItem && G.overlap(e, A));
      this.socketsTotal = this.sockets.length || 3;
    }
    phaseFor() { return Math.min(2, this.filled); }
    idle(dt) { this.openT = G.approach(this.openT, this.exposed ? 1 : 0, dt * 2); this.armK = G.approach(this.armK, 0, dt * 2); this.layArms(); }
    layArms() {
      const n = ph(this.cfg.arms, this.phase), L = this.level;
      this.arms.length = n;
      for (let k = 0; k < n; k++) {
        const ang = this.armAng + (k / n) * TAU;
        this.arms[k] = { ang, len: rayLen(L, this.bx, this.by, ang, this.cfg.armLen * T) };
      }
    }
    update(dt, game) {
      this.findSockets(game);
      // sockets are permanent level sources: count them every frame (also while she is away)
      const f = this.sockets.filter((s) => s.active).length;
      if (f > this.filled && this.alive && this.state !== 'dormant') {
        this.filled = f;
        if (this.filled < this.socketsTotal) this.hit(game);
        else { this.hp = 1; this.hurtT = BC().common.hurtTime; G.Audio.play('explosion'); G.fx.shake(10, 0.8); this.setState('phase'); this.roarT = 0; }
      }
      super.update(dt, game);
      const p = game.player;
      if (!this.alive || this.state === 'dormant' || this.state === 'intro' || p.dead || this.frozenWorld(game)) return;
      if (this.exposed && this.state === 'fight' && circleRect(this.bx, this.by, this.cfg.coreR + 6, p) && isStriking(p)) {
        p.vx = Math.sign(p.cx - this.bx || 1) * 320; p.vy = -420;
        this.exposed = false;
        this.hit(game);
        return;
      }
      if (!this.exposed && circleRect(this.bx, this.by, this.cfg.shellR, hurtBox(p))) p.kill(BC().common.killCause);
    }
    hit(game) { const r = super.hit(game); if (this.state === 'phase') this.clearProjectiles(['seeker']); return r; }
    fight(dt, game) {
      const c = this.cfg, i = this.phase;
      const all = this.filled >= this.socketsTotal;
      // ---- final window: all sockets filled → core opens / closes in a cycle
      if (all) {
        this.exposeT -= dt;
        if (this.exposeT <= 0) {
          this.exposed = !this.exposed;
          this.exposeT = this.exposed ? c.exposeTime : c.closedTime;
          G.Audio.play(this.exposed ? 'door' : 'alarm', { volume: 0.6 });
          if (this.exposed) this.clearProjectiles(['seeker']);
        }
      }
      this.openT = G.approach(this.openT, this.exposed ? 1 : 0, dt * 2);
      // ---- rotating beam arms: on → off (with warn flicker before re-igniting)
      this.armT += dt;
      if (this.exposed) { this.armState = 'off'; this.armT = 0; }
      else if (this.armState === 'on' && this.armT >= ph(c.armOn, i)) { this.armState = 'off'; this.armT = 0; }
      else if (this.armState === 'off' && this.armT >= ph(c.armPause, i) - c.armTelegraph) { this.armState = 'warn'; this.armT = 0; }
      else if (this.armState === 'warn' && this.armT >= c.armTelegraph) { this.armState = 'on'; this.armT = 0; G.Audio.play('laserOn'); }
      this.telegraphT = this.armState === 'warn' ? Math.min(1, this.armT / c.armTelegraph) : 0;
      this.armK = G.approach(this.armK, this.armState === 'on' ? 1 : 0, dt * 6);
      if (this.armState !== 'off') this.armAng += ph(c.armSpeed, i) * dt;
      this.layArms();
      if (this.armState === 'on') this.burnArms(game);
      // ---- seekers
      if (!this.exposed) {
        const alive = this.pool.filter((e) => e.live && e.kind === 'seeker').length;
        if (alive < ph(c.maxSeekers, i)) {
          this.spawnT -= dt;
          this.hatchT = G.clamp(1 - this.spawnT / c.seekerSpawnTelegraph, 0, 1);
          if (this.spawnT <= 0) {
            this.spawn('seeker', { px: this.bx, py: this.by - c.shellR - 10, vx: 0, vy: -60, r: c.seekerR, spawnT: 0.5, life: 999, eye: { x: this.bx, y: this.by } });
            this.spawnT = ph(c.spawnEvery, i); this.hatchT = 0;
            G.Audio.play('droneWake', { volume: 0.6 });
          }
        } else this.hatchT = G.approach(this.hatchT, 0, dt * 2);
      }
    }
    /** Beams kill her and destroy seekers; a destroyed seeker drops an energy cell (if one is still needed). */
    burnArms(game) {
      const p = game.player, hw = this.cfg.armWidth / 2;
      for (const a of this.arms) {
        const ex = this.bx + Math.cos(a.ang) * a.len, ey = this.by + Math.sin(a.ang) * a.len;
        if (!p.dead) {
          const hb = hurtBox(p);
          if (segRect(this.bx, this.by, ex, ey, { x: hb.x - hw, y: hb.y - hw, w: hb.w + hw * 2, h: hb.h + hw * 2 }) >= 0) p.kill(BC().common.killCause);
        }
        for (const s of this.pool) {
          if (!s.live || s.kind !== 'seeker' || s.spawnT > 0) continue;
          const R = { x: s.px - s.r - hw, y: s.py - s.r - hw, w: (s.r + hw) * 2, h: (s.r + hw) * 2 };
          if (segRect(this.bx, this.by, ex, ey, R) >= 0) this.seekerDestroyed(s, game);
        }
      }
    }
    seekerDestroyed(s, game) {
      s.live = false;
      G.fx.burst(s.px, s.py, { count: 24, color: ['#ff5a5a', '#ffe17a', '#ffffff'], speed: 240, life: 0.6, gravity: 300, glow: true });
      G.Audio.play('explosion', { volume: 0.6 });
      const needed = this.socketsTotal - this.filled;
      const outstanding = this.cells.filter((c) => !c.hidden && !c.delivered).length;
      if (outstanding >= needed) return;
      const cell = this.cells.find((c) => c.hidden);
      if (!cell) return;
      const fy = floorBelow(game.level, s.px, s.py);
      cell.hidden = false; cell.taken = false; cell.delivered = false;
      cell.x = G.clamp(s.px - 10, this.arena.x + T, this.arena.x + this.arena.w - T - 20); cell.y = fy - 22;
      cell.home = { x: cell.x, y: cell.y };
      G.Audio.play('pickup');
    }
    onPhaseStart() { this.armState = 'off'; this.armT = 0; this.spawnT = 2.0; this.patIdx = 0; if (this.filled >= this.socketsTotal) { this.exposed = false; this.exposeT = 0.8; } }
    resetPosition() {
      this.armAng = 0; this.armState = 'off'; this.armT = 0; this.spawnT = 2.5; this.hatchT = 0;
      if (this.filled >= this.socketsTotal) { this.exposed = false; this.exposeT = BC().warden.closedTime * 0.5; }
    }
  }

  const KINDS = { archivist: Archivist, colossus: Colossus, warden: Warden };
  /** Factory: `{type:'boss', kind}` picks the class. */
  Types.boss = function (d, l) { const K = KINDS[d.kind] || Archivist; return new K(d, l); };
  G.Bosses = { KINDS, isStriking, segRect, circleRect, rayLen, floorBelow, hookGame };
})();
