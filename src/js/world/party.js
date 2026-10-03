/**
 * Party / companions (docs/companions-spec.md §4).
 *
 * Members: Mira (G.Player), ЛЮМ (the existing G.Drone, who:'lum') and Рекс (G.Companion, who:'rex',
 * recruited through an npc with recruit:'rex', persisted in G.save.party).
 * G.Party owns: control switching (swap), help actions, AI follow/teleport, companion damage,
 * down/revive. game.controlled = the actor driven by input (camera follows it).
 *
 * Companion art fields: who, hp, maxHp, state ('follow'|'controlled'|'help'|'down'|'throw'),
 * facing, vx, vy, t, helpT (s since the last help action), invulnT, downT.
 * Rex body: x,y top-left, w,h (like the player). ЛЮМ: x,y = centre.
 */
(function () {
  const T = G.TILE;
  const PC = () => G.CONFIG.party;

  /** Shared damage for companions: i-frames, Infinity → down. */
  function hurtCompanion(c, amount, cause, fromX) {
    if (c.state === 'down' || c.invulnT > 0 || !(amount > 0)) return false;
    c.hp -= isFinite(amount) ? amount : c.hp;
    c.invulnT = PC().iframes;
    if (c.vx != null) { const dir = fromX == null ? -c.facing : (c.cx >= fromX ? 1 : -1); c.vx = dir * 220; c.vy = -280; }
    G.fx.burst(c.cx, c.cy, { count: 10, color: ['#ff6a5a', '#ffd27a'], speed: 180, life: 0.4, size: 3, gravity: 400 });
    G.Audio.play('hurt', { volume: 0.6 });
    if (c.hp <= 0) { c.hp = 0; c.goDown(); }
    return true;
  }

  // ------------------------------------------------------------------ Рекс
  class Companion {
    constructor(who, x, y) {
      const R = PC().rex;
      this.who = who; this.w = R.w; this.h = R.h;
      this.maxHp = R.hp; this.hp = this.maxHp;
      this.place(x, y);
      this.state = 'follow'; this.stateTime = 0; this.t = 0; this.helpT = 99; this.helpCd = 0;
      this.invulnT = 0; this.downT = 0; this.stuckT = 0; this.order = null; this.talking = false;
    }
    place(x, y) { this.x = x; this.y = y; this.vx = 0; this.vy = 0; this.onGround = false; this.facing = this.facing || 1; this.stuckT = 0; }
    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    hurtbox() { return { x: this.x + 3, y: this.y + 4, w: this.w - 6, h: this.h - 6 }; }
    touchesCircle(cx, cy, r) { const b = this.hurtbox(); const nx = G.clamp(cx, b.x, b.x + b.w), ny = G.clamp(cy, b.y, b.y + b.h); return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r; }
    hurt(a, cause, fromX) { return hurtCompanion(this, a, cause, fromX); }
    setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; } }
    goDown() { this.setState('down'); this.downT = PC().downTime; this.order = null; if (G.game && G.game.party) G.game.party.onDown(this); }
    /** Platformer step. ctl: {left,right,jumpPressed,jumpHeld}. No wall jump, ~2-tile jump. */
    physics(dt, level, inputX, jump) {
      const R = PC().rex;
      this.vx = G.approach(this.vx, inputX * R.runSpeed, R.accel * dt);
      if (inputX) this.facing = inputX;
      if (jump && this.onGround) { this.vy = -Math.sqrt(2 * R.gravity * R.jumpTiles * T); this.onGround = false; G.Audio.play('jump', { volume: 0.5 }); }
      this.vy = Math.min(this.vy + R.gravity * dt, R.maxFall);
      const rx = G.Physics.move(this, this.vx * dt, 0, level);
      if (rx.hitX) this.vx = 0;
      const ry = G.Physics.move(this, 0, this.vy * dt, level);
      if (ry.hitY) this.vy = 0;
      this.onGround = ry.ground;
      return rx;
    }
  }
  G.Companion = Companion;

  // ------------------------------------------------------------------ party
  class Party {
    /** @param {object} game GameScene-like {level, player, drone, dialogue} */
    constructor(game, opts = {}) {
      this.game = game;
      this.rex = null;
      if (opts.rex) this.addRex(game.player.cx - 40, game.player.y + game.player.h);
      const d = game.drone;
      if (d) {
        d.who = 'lum'; d.maxHp = PC().lum.hp; d.hp = d.maxHp; d.invulnT = 0; d.helpT = 99; d.helpCd = 0; d.downT = 0;
        if (!d.hurt) d.hurt = (a, cause, fromX) => (d.state === 'controlled' ? hurtCompanion(d, a, cause, fromX) : false);
        d.goDown = () => { d.state = 'down'; d.stateTime = 0; d.downT = PC().downTime; this.onDown(d); };
        Object.defineProperty(d, 'cx', { get() { return d.x; }, configurable: true });
        Object.defineProperty(d, 'cy', { get() { return d.y; }, configurable: true });
        d.hurtbox = () => { const b = PC().lum.body; return { x: d.x - b / 2, y: d.y - b / 2, w: b, h: b }; };
        d.touchesCircle = (cx, cy, r) => Math.hypot(cx - d.x, cy - d.y) < r + PC().lum.body / 2;
      }
      game.controlled = game.player;
    }
    /** Spawn Рекс standing with feet at (x, feetY). */
    addRex(x, feetY) { if (!this.rex) this.rex = new Companion('rex', x - PC().rex.w / 2, feetY - PC().rex.h); return this.rex; }
    lumAvailable() { const d = this.game.drone; return !!(d && d.enabled && d.state !== 'broken' && d.state !== 'waking'); }
    /** Companions present in the world (for drawing, hazards). */
    members() { const out = []; if (this.lumAvailable()) out.push(this.game.drone); if (this.rex) out.push(this.rex); return out; }
    /** Actors hazards may hurt: Mira, Рекс, and ЛЮМ only while controlled. */
    actors() { const out = [this.game.player]; if (this.rex && this.rex.state !== 'down') out.push(this.rex); const d = this.game.drone; if (d && d.state === 'controlled') out.push(d); return out; }
    swapBlocked() {
      const g = this.game, p = g.player;
      return !!((g.dialogue && g.dialogue.blocking) || p.dead || p.frozen || g.completeT >= 0 || g.level.entities.some((e) => e.type === 'boss' && e.state === 'intro'));
    }
    /** Cycle control Mira → ЛЮМ → Рекс (skips absent/down members). */
    swap() {
      if (this.swapBlocked()) return false;
      const g = this.game, cyc = [g.player];
      if (this.lumAvailable() && g.drone.state !== 'down') cyc.push(g.drone);
      if (this.rex && this.rex.state !== 'down') cyc.push(this.rex);
      if (cyc.length < 2) return false;
      const next = cyc[(cyc.indexOf(g.controlled) + 1) % cyc.length];
      this.setControlled(next);
      G.Audio.play('ui');
      return true;
    }
    setControlled(a) {
      const g = this.game, prev = g.controlled;
      if (prev && prev !== g.player && prev.state === 'controlled') prev.state = 'follow';
      g.controlled = a || g.player;
      if (a && a !== g.player) { a.state = 'controlled'; a.stateTime = 0; }
    }
    onDown(c) {
      if (this.game.controlled === c) this.setControlled(this.game.player);
      G.Audio.play('death', { volume: 0.4 });
      if (c.who === 'rex' && G.Script && G.Script.rex_down && this.game.dialogue && !this.game.dialogue.blocking) this.game.dialogue.play('rex_down');
    }
    /** Help (G): the controlled member's ability; with Mira controlled, the nearest companion acts. */
    help() {
      const g = this.game;
      if (g.dialogue && g.dialogue.blocking) return false;
      let c = g.controlled;
      if (c === g.player) {
        const cand = this.members().filter((m) => m.state !== 'down');
        cand.sort((a, b) => Math.hypot(a.cx - g.player.cx, a.cy - g.player.cy) - Math.hypot(b.cx - g.player.cx, b.cy - g.player.cy));
        c = cand[0];
        if (!c) return false;
        if (c === this.rex && !this.miraInReach()) { c.order = { t: PC().rex.helpWalk }; return true; } // walk over, then throw her
      }
      return this.doHelp(c);
    }
    doHelp(c) {
      if (!c || c.state === 'down' || c.helpCd > 0) return false;
      c.helpCd = PC().helpCooldown; c.helpT = 0;
      return c.who === 'lum' ? this.lumPulse(c) : this.rexHelp(c);
    }
    miraInReach() { const r = this.rex, p = this.game.player; return !p.dead && Math.hypot(p.cx - r.cx, (p.y + p.h) - (r.y + r.h)) <= PC().rex.grabR * T; }
    /** ЛЮМ: stun pulse — sentinels stunned, boss projectiles popped, levers/terminals within reach used. */
    lumPulse(d) {
      const L = PC().lum, g = this.game, R = L.pulseR * T;
      if (d.state !== 'controlled') { d.state = 'help'; d.stateTime = 0; }
      G.Audio.play('sentinelStun');
      G.fx.burst(d.x, d.y, { count: 30, color: ['#7ef9ff', '#ffffff'], speed: R * 2.4, life: 0.35, size: 3, gravity: 0, glow: true });
      for (const e of g.level.entities) {
        if (e.type === 'sentinel' && !e.destroyed && Math.hypot(e.cx - d.x, e.cy - d.y) < R) { e.setState('stunned'); e.stunT = L.stunTime; e.vx = 0; e.vy = 0; }
        else if (e.type === 'bossproj' && e.live && ['orb', 'shell', 'seeker', 'shock'].includes(e.kind) && Math.hypot(e.px - d.x, e.py - d.y) < R) {
          if (e.kind === 'shell' && e.explode) e.explode(true); else if (e.pop) e.pop('#7ef9ff'); else e.live = false;
        } else if ((e.type === 'lever' || e.type === 'terminal') && e.interactable && (!e.canInteract || e.canInteract(g))) {
          const dx = Math.max(e.x - d.x, d.x - (e.x + e.w), 0), dy = Math.max(e.y - d.y, d.y - (e.y + e.h), 0);
          if (Math.hypot(dx, dy) <= L.reach * T) e.interact(g);
        }
      }
      return true;
    }
    /** Рекс: throw Mira if she is within reach, else grab + throw the nearest crate / sentinel / boss projectile. */
    rexHelp(r) {
      const R = PC().rex, g = this.game, p = g.player, gr = R.grabR * T, grav = G.CONFIG.player.gravity;
      const launch = (dist, h) => { const vy = Math.sqrt(2 * grav * h * T); return { vy: -vy, vx: dist * T / (2 * vy / grav) }; };
      r.setState('throw');
      if (this.miraInReach()) {
        const v = launch(R.throwMira.dist, R.throwMira.height);
        p.detachRope(); p.vx = p.facing * v.vx; p.vy = v.vy; p.onGround = false; p.jumping = false; p.thrownT = 2; p.y -= 2;
        r.facing = p.facing;
        G.Audio.play('jumppad'); G.fx.dust(p.cx, p.y + p.h, 8);
        if (G.Script && G.Script.rex_help1 && g.dialogue && !g.dialogue.active) g.dialogue.play('rex_help1');
        return true;
      }
      let best = null, bd = gr;
      for (const e of g.level.entities) {
        let ex, ey;
        if (e.type === 'crate' || (e.type === 'sentinel' && !e.destroyed && e.state !== 'thrown')) { ex = e.cx; ey = e.cy; }
        else if (e.type === 'bossproj' && e.live && ['orb', 'shell', 'seeker'].includes(e.kind)) { ex = e.px; ey = e.py; }
        else continue;
        const d = Math.hypot(ex - r.cx, ey - r.cy) - (e.w || 0) / 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) { r.setState('follow'); return false; }
      const v = launch(R.throwObj.dist, R.throwObj.height), dir = r.facing;
      if (best.type === 'crate') { best.y -= 2; best.vx = dir * v.vx; best.vy = v.vy; best.thrownT = 1; best.onGround = false; }
      else if (best.type === 'sentinel') { best.setState('thrown'); best.vx = dir * v.vx; best.vy = v.vy; }
      else if (best.kind === 'shell') { best.deflected = true; best.vx = dir * v.vx; best.vy = v.vy; }
      else if (best.pop) best.pop('#e8a15a'); else best.live = false;
      G.Audio.play('crateland');
      return true;
    }

    /**
     * Per-tick update. ctl = input controls (applied to the controlled companion), dt = gameplay dt.
     * Called by GameScene after Mira's update.
     */
    update(dt, ctl) {
      const g = this.game, p = g.player, L = g.level, P = PC();
      for (const c of this.members()) {
        c.helpT = (c.helpT || 0) + dt; c.helpCd = Math.max(0, (c.helpCd || 0) - dt); c.invulnT = Math.max(0, (c.invulnT || 0) - dt);
        if (c.state === 'down') {
          c.downT -= dt;
          if (c.who === 'rex') c.physics(dt, L, 0, false); else { c.y = Math.min(c.y + 120 * dt, c.y + 1); }
          if (c.downT <= 0) { c.hp = Math.ceil(c.maxHp * P.reviveFrac); c.state = 'follow'; c.stateTime = 0; c.invulnT = P.iframes; }
          continue;
        }
        if ((c.state === 'help' || c.state === 'throw') && c.helpT > 0.45) c.state = g.controlled === c ? 'controlled' : 'follow';
        if (c.who === 'lum') this.updateLum(c, dt, ctl); else this.updateRex(c, dt, ctl);
        this.hazards(c);
      }
      if (g.controlled !== p && (!g.controlled || g.controlled.state === 'down')) this.setControlled(p);
    }
    updateLum(d, dt, ctl) {
      if (this.game.controlled !== d) return; // follow AI = G.Drone.update
      const s = PC().lum.speed;
      const ix = (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0), iy = (ctl.down ? 1 : 0) - (ctl.up || ctl.jumpHeld ? 1 : 0);
      const n = Math.hypot(ix, iy) || 1;
      d.vx = G.approach(d.vx, (ix / n) * s, s * 8 * dt); d.vy = G.approach(d.vy, (iy / n) * s, s * 8 * dt);
      if (ix) d.facing = ix;
      const body = d.hurtbox();
      G.Physics.move(body, d.vx * dt, 0, this.game.level);
      G.Physics.move(body, 0, d.vy * dt, this.game.level, { dropThrough: true });
      d.x = body.x + body.w / 2; d.y = body.y + body.h / 2;
      d.x = G.clamp(d.x, 8, this.game.level.pxW - 8); d.y = Math.max(8, d.y);
      d.lookX = d.x + d.facing * 60; d.lookY = d.y;
    }
    updateRex(r, dt, ctl) {
      const g = this.game, p = g.player, P = PC(), R = P.rex, L = g.level;
      r.t += dt; r.stateTime += dt;
      if (g.controlled === r) {
        const ix = (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0);
        r.physics(dt, L, ix, ctl.jumpPressed);
        if (r.y > L.pxH + 64) { r.hurt(G.CONFIG.damage.fallCompanion, 'fall'); this.teleport(r); }
        return;
      }
      // ---- AI: follow Mira along the ground, teleport when far / stuck / fallen ----
      if (r.order) { r.order.t -= dt; if (this.miraInReach()) { r.order = null; this.doHelp(r); } else if (r.order.t <= 0) r.order = null; }
      const tx = r.order ? p.cx : p.cx - p.facing * R.followGap * T;
      const dx = tx - r.cx, far = Math.abs(dx) > (r.order ? 4 : T * 0.6);
      const ix = far ? Math.sign(dx) : 0;
      let jump = false;
      if (ix && r.onGround) {
        const ahead = { x: r.x + ix * 6, y: r.y, w: r.w, h: r.h };
        const wall = G.Physics.solidAt(ahead, L, r);
        const fx = Math.floor((ix > 0 ? r.x + r.w + 4 : r.x - 4) / T), fy = Math.floor((r.y + r.h + 2) / T);
        const gap = !L.isSolidTile(fx, fy) && !L.isOneWayTile(fx, fy);
        jump = wall || (gap && p.y + p.h <= r.y + r.h + 4);
      }
      const ox = r.x;
      r.physics(dt, L, ix, jump);
      const dist = Math.hypot(p.cx - r.cx, p.cy - r.cy);
      r.stuckT = far && Math.abs(r.x - ox) < 0.3 && dist > 3 * T ? r.stuckT + dt : (dist > 3 * T && ix && Math.abs(r.x - ox) < 0.3 ? r.stuckT + dt : 0);
      if (!p.dead && (dist > P.teleportDist * T || r.stuckT > P.stuckTime || r.y > L.pxH + 64)) this.teleport(r);
    }
    /** Put a companion next to Mira (on her ground). */
    teleport(c) {
      const p = this.game.player;
      if (c.who === 'lum') { c.x = p.cx - 30; c.y = p.y - 30; return; }
      c.place(p.cx - p.facing * 30 - c.w / 2, p.y + p.h - c.h);
      if (G.Physics.solidAt(c, this.game.level, c)) c.place(p.cx - c.w / 2, p.y + p.h - c.h);
      G.fx.burst(c.cx, c.cy, { count: 12, color: ['#e8a15a', '#ffffff'], speed: 120, life: 0.4, gravity: -60, glow: true });
    }
    /** Legacy hazards (tiles, lasers, saws, sentinels) for physical companions; new hazards use game.actors(). */
    hazards(c) {
      if (c.state === 'down' || c.invulnT > 0) return;
      if (c.who === 'lum' && c.state !== 'controlled') return;
      const g = this.game, L = g.level, D = G.CONFIG.damage, b = c.hurtbox();
      const hz = L.hazardAt(b);
      if (hz === 'spikes') { c.hurt(D.spikes, 'spikes'); if (c.vy != null && c.who === 'rex') c.vy = -G.CONFIG.health.spikeBounce * 0.8; return; }
      if (hz === 'acid') { c.hurt(Infinity, 'acid'); if (c.who === 'rex') this.teleport(c); return; }
      for (const e of L.entities) {
        if (e.type === 'laser' && e.phase === 'on' && G.overlap(b, e.beam)) { c.hurt(D.laser, 'laser', e.beam.x + e.beam.w / 2); return; }
        if (e.type === 'saw' && e.running && c.touchesCircle(e.x, e.y, e.r - 3)) { c.hurt(D.saw, 'saw', e.x); return; }
        if (e.type === 'sentinel' && !e.destroyed && e.state !== 'stunned' && e.state !== 'thrown' && c.touchesCircle(e.cx, e.cy, G.CONFIG.sentinel.hitR)) { c.hurt(D.sentinel, 'sentinel', e.cx); return; }
      }
    }
    /** After Mira respawns: companions back at her side, control returns to her. */
    onRespawn() {
      this.setControlled(this.game.player);
      if (this.rex) { if (this.rex.state !== 'down') this.rex.state = 'follow'; this.rex.order = null; this.teleport(this.rex); }
    }
  }
  G.Party = Party;
})();
