/**
 * Player controller: run, variable jump, coyote time, jump buffering,
 * wall slide + wall jump, crate pushing, carrying a repair part, interaction.
 * Chapter 2 (docs/chapter2-spec.md §2): dash, rope swing on anchors, wind, ice,
 * conveyors, momentum inheritance from moving platforms.
 *
 * Animation state for art (G.Art.Player.draw reads these, never writes):
 *   state: 'idle'|'run'|'jump'|'fall'|'wall'|'push'|'land'|'interact'|'dead'|'spawn'|'dash'|'swing'
 *   stateTime, facing (1|-1), vx, vy, onGround, carry (item name|null),
 *   landImpact (0..1, decays), deathCause ('spikes'|'acid'|'laser'|'saw'|'fall'|'sentinel'|'crush'|…|null)
 *   canDash, dashCharges (0..dash.charges), dashDir {x,y} (unit), dashT (s since the last dash
 *   started; keeps counting after it ends so art can fade the after-image trail)
 *   rope {ax, ay, len, angle} while swinging (angle 0 = straight below the anchor, + = to the right)
 *   talking / talkMood: set by GameScene while Mira speaks in a talk dialogue
 *
 * Reusable damage helpers for any hazard (bosses, sentinels, projectiles):
 *   p.hurtbox()                → forgiving inset rect
 *   p.touchesRect(r) / p.touchesCircle(cx, cy, r) → bool
 *   p.hurt(amount, cause, fromX[, deathCause]) → damage with i-frames + knockback (docs/companions-spec.md §1)
 *   p.kill(cause)              → instant death (acid, fall, crush)
 *
 * Health / buffs (art + HUD read): hp, maxHp, invulnT (s of i-frames left, blink while > 0),
 *   hurtT (s since the last hit), lastHurt (cause), gliding, jetting (bool, this frame),
 *   buffs = {shield:{hits,t}, glider:{t,uses}, jetpack:{fuel}, boots:{t}, slowmo:{t}} (absent = inactive).
 */
(function () {
  const P = G.CONFIG.player;
  const T = G.TILE;
  const NO_CTL = { left: false, right: false, up: false, down: false, jumpPressed: false, jumpHeld: false, dashPressed: false, actionPressed: false, upPressed: false, downPressed: false };

  class Player {
    constructor(x, y) {
      this.w = P.w; this.h = P.h;
      this.canDash = false;
      this.talking = false; this.talkMood = 'neutral';
      this.maxHp = G.CONFIG.health.player;
      this.reset(x, y);
    }

    reset(x, y) {
      this.x = x; this.y = y;
      this.vx = 0; this.vy = 0;
      this.facing = 1;
      this.onGround = false;
      this.groundEntity = null;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.wallDir = 0;
      this.wallStick = 0;
      this.wallLockT = 0;
      this.jumping = false;
      this.state = 'spawn';
      this.stateTime = 0;
      this.dead = false;
      this.deathCause = null;
      this.carry = null;
      this.carryPart = null;
      this.landImpact = 0;
      this.interactT = 0;
      this.pushing = false;
      this.dropT = 0;
      this.frozen = false;
      // ---- chapter 2 ----
      this.dashCharges = G.CONFIG.dash.charges;
      this.dashTimer = 0;          // s left in the current dash (0 = not dashing)
      this.dashT = 99;             // s since the last dash started (art)
      this.dashDir = { x: 1, y: 0 };
      this.dashCooldownT = 0;
      this.dashRefillT = 0;
      this.dashStarted = false;    // one-frame flag: GameScene applies hit-stop
      this.overspeedT = 0;
      this.windVx = 0;
      this.surface = { ice: false, conveyor: 0 };
      this.groundVel = { x: 0, y: 0 };
      this.reattachT = 0;
      this.actionUsed = false;
      if (this.anchor) this.anchor.attached = false;
      this.anchor = null;
      this.rope = null;
      // ---- health + buffs (docs/companions-spec.md §1–2) ----
      this.hp = this.maxHp;
      this.invulnT = 0; this.hurtT = 99; this.lastHurt = null; this.hurtStarted = false;
      this.buffs = {};
      this.airJumpUsed = false; this.thrownT = 0;
      this.gliding = false; this.jetting = false;
    }

    /**
     * Take damage. Instant causes (amount Infinity: acid/fall/crush) kill. A shield absorbs the hit.
     * Otherwise HP drops, 0.9 s of i-frames start, she is knocked away from fromX and the scene
     * applies a short hit-stop (hurtStarted flag). Returns true if the hit landed.
     * @param {number} amount HP to remove
     * @param {string} cause damage table key (also the death cause)
     * @param {number} [fromX] world x of the source (knockback direction); default: opposite facing
     * @param {string} [deathCause] cause recorded if this hit kills (default: cause)
     */
    hurt(amount, cause, fromX, deathCause) {
      if (this.dead || this.frozen) return false;
      if (!isFinite(amount)) { this.kill(deathCause || cause); return true; }
      if (this.invulnT > 0 || amount <= 0) return false;
      const H = G.CONFIG.health;
      this.invulnT = H.iframes; this.hurtT = 0; this.lastHurt = cause;
      const sh = this.buffs.shield;
      if (sh) {
        if (--sh.hits <= 0) delete this.buffs.shield;
        G.Audio.play('shieldHit');
        G.fx.burst(this.cx, this.cy, { count: 14, color: ['#9fe8ff', '#ffffff'], speed: 180, life: 0.4, size: 3, gravity: 0, glow: true });
        return false;
      }
      this.hp -= amount;
      if (this.hp <= 0) { this.hp = 0; this.kill(deathCause || cause); return true; }
      this.detachRope();
      if (this.dashing) this.endDash(true);
      const dir = fromX == null ? -this.facing : (this.cx >= fromX ? 1 : -1);
      this.vx = dir * H.knockX; this.vy = Math.min(this.vy, -H.knockY);
      this.jumping = false; this.onGround = false; this.wallLockT = H.knockLock; this.thrownT = 0;
      this.hurtStarted = true;
      G.Audio.play('hurt');
      G.fx.burst(this.cx, this.cy, { count: 12, color: ['#ff6a5a', '#ffd27a'], speed: 200, life: 0.45, size: 3, gravity: 500 });
      G.fx.shake(5, 0.2);
      return true;
    }

    /** Restore HP (medkit, checkpoint). Returns the amount actually healed. */
    heal(n) { const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + n); return this.hp - before; }

    /** Count down buff timers in REAL seconds (game.js calls this; slow-motion does not stretch buffs). */
    tickBuffs(dt) {
      const b = this.buffs;
      for (const k of ['shield', 'glider', 'boots', 'slowmo']) if (b[k] && b[k].t != null) { b[k].t -= dt; if (b[k].t <= 0) delete b[k]; }
    }

    setState(s) {
      if (this.state !== s) { this.state = s; this.stateTime = 0; }
    }

    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
    get dashing() { return this.dashTimer > 0; }

    /** Forgiving hitbox used by all hazards. */
    hurtbox() { return { x: this.x + 3, y: this.y + 4, w: this.w - 6, h: this.h - 6 }; }
    touchesRect(r) { return !this.dead && G.overlap(this.hurtbox(), r); }
    touchesCircle(cx, cy, r) {
      if (this.dead) return false;
      const hb = this.hurtbox();
      const nx = G.clamp(cx, hb.x, hb.x + hb.w), ny = G.clamp(cy, hb.y, hb.y + hb.h);
      return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < r * r;
    }

    kill(cause) {
      if (this.dead || this.frozen) return; // frozen = level complete: nothing can kill her any more
      this.detachRope();
      this.dashTimer = 0;
      this.dead = true;
      this.deathCause = cause;
      this.setState('dead');
      this.vx = 0; this.vy = 0;
      G.Audio.play('death');
      G.fx.burst(this.cx, this.cy, { count: 26, color: cause === 'acid' ? '#9dff5c' : '#ffd27a', speed: 260, life: 0.9, size: 4, gravity: 600 });
      G.fx.shake(10, 0.35);
    }

    /**
     * @param {number} dt
     * @param {G.Level} level
     * @param {object} ctl  {left,right,up,down, jumpPressed, jumpHeld, dashPressed, actionPressed, upPressed, downPressed}
     */
    update(dt, level, ctl) {
      const D = G.CONFIG.dash;
      this.stateTime += dt;
      this.dashT += dt;
      this.landImpact = Math.max(0, this.landImpact - dt * 4);
      this.interactT = Math.max(0, this.interactT - dt);
      this.invulnT = Math.max(0, this.invulnT - dt); this.hurtT += dt;
      this.thrownT = Math.max(0, this.thrownT - dt);
      this.gliding = false; this.jetting = false;
      this.actionUsed = false;
      this.canDash = !!(level.hasAbility && level.hasAbility('dash'));
      if (this.dead) return;
      ctl = Object.assign({}, NO_CTL, this.frozen ? {} : ctl);

      const inputX = (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0);
      const inputY = (ctl.down ? 1 : 0) - (ctl.up ? 1 : 0);

      // ---- never stay inside a dynamic solid (bridge extended into her, crate respawned on her) ----
      if (!G.Physics.depenetrate(this, level, P.crushPush)) { this.kill('crush'); return; }

      // ---- timers ----
      this.coyote = this.onGround ? P.coyoteTime : Math.max(0, this.coyote - dt);
      this.jumpBuffer = ctl.jumpPressed ? P.jumpBuffer : Math.max(0, this.jumpBuffer - dt);
      this.wallLockT = Math.max(0, this.wallLockT - dt);
      this.dropT = Math.max(0, this.dropT - dt);
      this.dashCooldownT = Math.max(0, this.dashCooldownT - dt);
      this.dashRefillT = Math.max(0, this.dashRefillT - dt);
      this.overspeedT = Math.max(0, this.overspeedT - dt);
      this.reattachT = Math.max(0, this.reattachT - dt);

      // ---- dash start (also cuts a rope) ----
      if (ctl.dashPressed && this.canDash && this.dashCharges > 0 && !this.dashing && this.dashCooldownT <= 0) this.startDash(inputX, inputY);

      // ---- rope swing ----
      if (this.rope) {
        this.updateSwing(dt, level, ctl, inputX);
        if (this.rope) { this.afterMove(level, false, 0, false); return; }
      }

      // ---- anchor grab (airborne, action) ----
      if (ctl.actionPressed && !this.onGround && !this.dashing && this.reattachT <= 0 && this.tryAttach(level)) {
        this.actionUsed = true;
        this.afterMove(level, false, 0, false);
        return;
      }

      // ---- dash in progress ----
      if (this.dashing) {
        this.dashTimer -= dt;
        const cancel = this.jumpBuffer > 0 && D.jumpCancel && (this.coyote > 0 || this.wallDir !== 0 || this.nearWall(level));
        if (cancel) {
          this.endDash(false); // keep full speed into the jump (dash-jump)
        } else {
          const wasGround = this.onGround;
          const rx = G.Physics.move(this, this.vx * dt, 0, level);
          if (rx.hitX) { this.kickCrate(level, Math.sign(this.vx)); this.vx = 0; }
          const ry = G.Physics.move(this, 0, this.vy * dt, level, { dropThrough: this.dropT > 0 });
          if (ry.hitY) this.vy = 0;
          this.onGround = ry.ground || (wasGround && this.vy === 0 && !!G.Physics.probeGround(this, level));
          if (ry.ground) { this.groundEntity = ry.groundEntity; this.surface = level.surfaceOf(ry.groundTiles); }
          for (const [tx, ty] of ry.groundTiles) level.touchCrumble(tx, ty);
          if (this.dashTimer <= 0) this.endDash(true);
          this.afterMove(level, false, 0, false);
          return;
        }
      }

      // ---- horizontal ----
      const ice = this.onGround && this.surface.ice;
      const PK = G.CONFIG.pickups;
      const glide = !!this.buffs.glider && !this.onGround && ctl.jumpHeld && this.vy > 0;
      const maxSpeed = this.pushing ? P.pushSpeed : glide ? P.runSpeed * PK.glider.speedMul : P.runSpeed;
      let accel; const target = inputX * maxSpeed;
      if (this.onGround) accel = inputX ? P.groundAccel * (ice ? G.CONFIG.surface.iceAccel : 1) : P.groundDecel * (ice ? G.CONFIG.surface.iceDecel : 1);
      else accel = inputX ? (glide ? PK.glider.accel : P.airAccel) : P.airDecel;
      // thrown by Рекс: keep the launch speed unless she steers against it
      if (this.thrownT > 0 && !this.onGround && (inputX === 0 || inputX === Math.sign(this.vx)) && Math.abs(this.vx) >= Math.abs(target)) accel = 0;
      // overspeed (dash, swing release, lift jump): above target, decay slowly in the air
      if (!this.onGround && this.overspeedT > 0 && Math.abs(this.vx) > Math.abs(target) && (inputX === 0 || inputX === Math.sign(this.vx))) accel = D.overspeedDecel;
      if (this.wallLockT > 0) accel *= 0.25;
      this.vx = G.approach(this.vx, target, accel * dt);
      if (inputX && this.wallLockT <= 0) this.facing = inputX;

      // ---- wind ----
      let windAy = 0;
      if (level.winds && level.winds.length) {
        const W = G.CONFIG.wind;
        const f = level.windAt(this);
        this.windVx += ((this.onGround ? W.groundGrip : 1) * f.ax - W.drag * this.windVx) * dt;
        windAy = f.ay;
      } else this.windVx = 0;

      // ---- wall detection (airborne only) ----
      this.wallDir = 0;
      if (!this.onGround) {
        if (G.Physics.wallAt(this, -1, level)) this.wallDir = -1;
        else if (G.Physics.wallAt(this, 1, level)) this.wallDir = 1;
      }
      const pressingIntoWall = this.wallDir !== 0 && inputX === this.wallDir;
      if (this.wallDir !== 0 && (pressingIntoWall || this.wallStick > 0) && this.vy > 0) {
        if (pressingIntoWall) this.wallStick = P.wallStickTime;
      }
      this.wallStick = this.wallDir !== 0 ? Math.max(0, this.wallStick - (pressingIntoWall ? 0 : dt)) : 0;
      const sliding = this.wallDir !== 0 && this.vy > 0 && (pressingIntoWall || this.wallStick > 0);

      // ---- jump ----
      let jumped = false;
      if (this.jumpBuffer > 0) {
        if (ctl.down && this.onGround && this.standingOnOneWay(level)) {
          // drop through one-way platform
          this.dropT = 0.2; this.jumpBuffer = 0; this.y += 2; this.onGround = false;
        } else if (this.coyote > 0) {
          this.vy = -P.jumpVelocity;
          // momentum inheritance: a lift / belt adds its velocity to the jump
          if (this.groundVel.x || this.groundVel.y) {
            this.vx += this.groundVel.x; this.vy += this.groundVel.y;
            this.overspeedT = D.overspeedTime;
          }
          this.groundVel = { x: 0, y: 0 };
          this.jumping = true; jumped = true;
          this.onGround = false; this.coyote = 0; this.jumpBuffer = 0;
          G.Audio.play('jump');
          G.fx.dust(this.cx, this.y + this.h, 6);
        } else if (this.wallDir !== 0 || this.wallStick > 0 || this.nearWall(level)) {
          const dir = this.wallDir || this.nearWall(level);
          this.vy = -P.wallJumpVy;
          this.vx = -dir * P.wallJumpVx;
          this.facing = -dir;
          this.jumping = true; jumped = true;
          this.wallLockT = P.wallJumpLock;
          this.jumpBuffer = 0; this.wallStick = 0;
          G.Audio.play('walljump');
          G.fx.dust(dir > 0 ? this.x + this.w : this.x, this.cy, 5);
        } else if (this.buffs.boots && !this.airJumpUsed && !this.onGround) {
          // boots: one extra jump in the air (refreshed on ground / wall)
          this.vy = -P.jumpVelocity * G.CONFIG.pickups.boots.jumpMul;
          this.airJumpUsed = true; this.jumping = true; jumped = true; this.jumpBuffer = 0; this.thrownT = 0;
          G.Audio.play('jump');
          G.fx.burst(this.cx, this.y + this.h, { count: 8, color: ['#ffe17a', '#ffffff'], speed: 120, life: 0.35, size: 3, gravity: 200 });
        }
      }
      if (this.jumping && !ctl.jumpHeld && this.vy < 0) {
        this.vy *= P.jumpCut;
        this.jumping = false;
      }
      if (this.vy >= 0) this.jumping = false;

      // ---- gravity (+ vertical wind) ----
      const jet = this.buffs.jetpack;
      if (jet && !this.onGround && !sliding && ctl.jumpHeld && !this.jumping) {
        // jetpack: upward thrust while Jump is held in the air (after the jump's own rise)
        const J = G.CONFIG.pickups.jetpack;
        this.vy = G.approach(this.vy, -J.speed, J.accel * dt);
        jet.fuel -= dt; this.jetting = true;
        if (jet.fuel <= 0) delete this.buffs.jetpack;
        if (Math.random() < dt * 30) G.fx.burst(this.cx, this.y + this.h, { count: 1, color: ['#ffb36b', '#fff1c0'], speed: 60, life: 0.3, size: 3, gravity: 300 });
      } else this.vy += (P.gravity + windAy) * dt;
      if (glide && !this.jetting) this.gliding = true;
      const maxFall = sliding ? P.wallSlideMax : this.gliding ? G.CONFIG.pickups.glider.fall : P.maxFall;
      if (this.vy > maxFall) this.vy = G.approach(this.vy, maxFall, P.gravity * 2 * dt);
      if (sliding && Math.random() < dt * 20) G.fx.dust(this.wallDir > 0 ? this.x + this.w : this.x, this.y + this.h * 0.4, 1);

      // ---- move ----
      const wasGround = this.onGround;
      const preVy = this.vy;
      const belt = this.onGround && this.surface.conveyor ? this.surface.conveyor * G.CONFIG.surface.conveyorSpeed : 0;
      const rx = G.Physics.move(this, (this.vx + this.windVx + belt) * dt, 0, level, { pusher: true, canPush: this.onGround });
      this.pushing = !!rx.pushing && this.onGround && inputX !== 0;
      if (rx.hitX && !this.onGround && inputX !== 0 && this.vy > -P.ledgeAssistMinVy && this.ledgeAssist(level, inputX)) {
        // ledge forgiveness: popped up onto a ledge she just barely missed; keep momentum
        G.Physics.move(this, this.vx * dt * 0.5, 0, level);
      } else if (rx.hitX) { this.vx = 0; this.windVx = 0; }
      if (this.vy < 0) this.cornerCorrect(level, this.vy * dt);
      const ry = G.Physics.move(this, 0, this.vy * dt, level, { dropThrough: this.dropT > 0 });
      if (ry.hitY) {
        if (ry.ground) {
          if (!wasGround && preVy > 250) {
            this.landImpact = G.clamp(preVy / P.maxFall, 0.3, 1);
            G.Audio.play('land', { volume: this.landImpact });
            G.fx.dust(this.cx, this.y + this.h, Math.round(4 + this.landImpact * 8));
          }
          this.vy = 0;
        } else if (ry.ceiling) {
          this.vy = Math.max(this.vy, 30);
        }
      }
      this.onGround = ry.ground;
      this.groundEntity = ry.groundEntity;
      this.surface = ry.ground ? level.surfaceOf(ry.groundTiles) : { ice: false, conveyor: 0 };
      for (const [tx, ty] of ry.groundTiles) level.touchCrumble(tx, ty);
      if (this.onGround || sliding) this.airJumpUsed = false;
      if (this.onGround) this.thrownT = 0;
      if (this.onGround && !wasGround && this.buffs.glider && --this.buffs.glider.uses <= 0) delete this.buffs.glider;

      // ---- momentum: remember the ground's velocity; walking off a lift keeps its horizontal part ----
      if (this.onGround) {
        const M = G.CONFIG.momentum, ge = this.groundEntity;
        const gx = ge && ge.vx ? ge.vx : 0, gy = ge && ge.vy ? ge.vy : 0;
        this.groundVel = { x: gx * M.inheritX + this.surface.conveyor * G.CONFIG.surface.conveyorSpeed * M.conveyorInherit, y: Math.min(0, gy) * M.inheritUp };
      } else if (wasGround && !jumped) {
        if (this.groundVel.x) { this.vx += this.groundVel.x; this.overspeedT = D.overspeedTime; }
        this.groundVel = { x: 0, y: 0 };
      }

      this.afterMove(level, sliding, preVy, wasGround);
    }

    /** Shared tail of update: dash refill, hazards, animation state. */
    afterMove(level, sliding, preVy, wasGround) {
      const D = G.CONFIG.dash;
      if (!this.dashing && this.dashRefillT <= 0 && (this.onGround || sliding) && this.dashCharges < D.charges) this.dashCharges = D.charges;

      // ---- hazards ----
      const hz = level.hazardAt(this.hurtbox());
      if (hz === 'spikes') {
        // spikes hurt and bounce her out (up off floor spikes, down off ceiling spikes) so she is never stuck
        const hb = this.hurtbox(), ceil = level.tileCode(Math.floor(this.cx / T), Math.floor(hb.y / T)) === G.TILE_CODES.SPIKE_DOWN;
        this.hurt(G.CONFIG.damage.spikes, 'spikes', null);
        if (!this.dead) {
          if (ceil) this.vy = Math.max(this.vy, 150);
          else { this.vy = -G.CONFIG.health.spikeBounce; this.onGround = false; this.jumping = false; }
          this.detachRope(); this.dashTimer = 0;
        }
      } else if (hz) this.hurt(G.CONFIG.damage[hz] != null ? G.CONFIG.damage[hz] : Infinity, hz);
      if (this.y > level.pxH + 80) this.kill('fall');

      // ---- animation state ----
      if (this.dead) return;
      if (this.dashing) { this.setState('dash'); return; }
      if (this.rope) { this.setState('swing'); return; }
      if (this.state === 'spawn' && this.stateTime < 0.45) return;
      if (this.onGround) {
        if (!wasGround && preVy > 250) this.setState('land');
        else if (this.state === 'land' && this.stateTime < 0.12) { /* hold */ }
        else if (this.interactT > 0) this.setState('interact');
        else if (this.pushing) this.setState('push');
        else if (Math.abs(this.vx) > 20) this.setState('run');
        else this.setState('idle');
      } else if (sliding) this.setState('wall');
      else if (this.vy < 0) this.setState('jump');
      else this.setState('fall');
    }

    // ------------------------------------------------------------------ dash
    startDash(inputX, inputY) {
      const D = G.CONFIG.dash;
      this.detachRope();
      let dx = inputX, dy = inputY;
      if (!dx && !dy) dx = this.facing;
      const n = Math.hypot(dx, dy);
      dx /= n; dy /= n;
      this.dashDir = { x: dx, y: dy };
      this.vx = dx * D.speed; this.vy = dy * D.speed;
      this.windVx = 0;
      this.dashTimer = D.time; this.dashT = 0;
      this.dashCharges--;
      this.jumping = false; this.wallLockT = 0;
      if (inputX) this.facing = inputX;
      this.dashStarted = true;
      this.setState('dash');
      G.Audio.play('dash');
      if (D.shake) G.fx.shake(D.shake, 0.12);
      G.fx.burst(this.cx, this.cy, { count: 8, color: ['#7ef9ff', '#ffffff'], speed: 140, life: 0.35, size: 3, gravity: 0 });
    }

    /** @param {boolean} decay apply the end-of-dash velocity multiplier */
    endDash(decay) {
      const D = G.CONFIG.dash;
      this.dashTimer = 0;
      if (decay) { this.vx *= D.endKeep; this.vy *= D.endKeep; }
      this.dashCooldownT = D.cooldown;
      this.dashRefillT = D.refillDelay;
      this.overspeedT = D.overspeedTime;
    }

    /** A dash slamming into a crate kicks it (it slides ~1 tile). */
    kickCrate(level, dir) {
      if (!dir || !level.crates) return;
      const probe = { x: dir > 0 ? this.x + this.w : this.x - 2, y: this.y + 2, w: 2, h: this.h - 4 };
      for (const c of level.crates) if (G.overlap(probe, c)) { c.vx = dir * G.CONFIG.crate.dashKick; c.pushedT = 0.1; }
    }

    /** Refill dash charges (dashcrystal). Returns true if anything was refilled. */
    refillDash() {
      const D = G.CONFIG.dash;
      if (this.dashCharges >= D.charges) return false;
      this.dashCharges = D.charges;
      return true;
    }

    // ------------------------------------------------------------------ rope swing
    ropePoint() { return { x: this.cx, y: this.y + G.CONFIG.swing.ropeOffsetY }; }

    tryAttach(level) {
      if (!level.anchors || !level.anchors.length) return false;
      const q = this.ropePoint();
      let best = null, bd = Infinity;
      for (const a of level.anchors) {
        const d = Math.hypot(q.x - a.cx, q.y - a.cy);
        if (d > a.reach || d >= bd) continue;
        if (!G.Physics.lineClear(level, a.cx, a.cy, q.x, q.y, (tx, ty) => tx === a.tx && ty === a.ty)) continue;
        best = a; bd = d;
      }
      if (!best) return false;
      this.attach(best);
      return true;
    }

    attach(a) {
      const S = G.CONFIG.swing;
      const q = this.ropePoint();
      const len = Math.max(S.minLen, Math.hypot(q.x - a.cx, q.y - a.cy));
      const angle = Math.atan2(q.x - a.cx, q.y - a.cy);
      this.anchor = a; a.attached = true;
      this.rope = { ax: a.cx, ay: a.cy, len, angle, target: len, omega: (this.vx * Math.cos(angle) - this.vy * Math.sin(angle)) / len, slack: false, blockT: 0 };
      this.dashTimer = 0; this.jumping = false; this.windVx = 0;
      this.setState('swing');
      G.Audio.play('rope');
    }

    detachRope() {
      if (this.anchor) this.anchor.attached = false;
      this.anchor = null;
      if (this.rope) this.reattachT = G.CONFIG.swing.reattachDelay;
      this.rope = null;
    }

    /**
     * Pendulum: θ'' = (−g·sinθ + pump·cosθ + wind·tangent)/L, damping, angular momentum
     * conserved when reeling (ω·L² = const). If the rope tension would go negative
     * (above the anchor, too slow) the rope goes slack and she flies ballistically until taut.
     */
    updateSwing(dt, level, ctl, inputX) {
      const S = G.CONFIG.swing, r = this.rope, a = this.anchor;
      // release
      if (ctl.jumpPressed || ctl.actionPressed) {
        const boost = ctl.jumpPressed;
        this.detachRope();
        this.actionUsed = !!ctl.actionPressed;
        if (boost) {
          this.vx *= S.releaseBoostX; this.vy += S.releaseBoostY;
          this.overspeedT = G.CONFIG.dash.overspeedTime;
          this.jumpBuffer = 0;
          G.Audio.play('jump');
        }
        return;
      }
      // reel ±1 tile per press
      if (ctl.upPressed) r.target = Math.max(S.minLen, r.target - S.reelStep * T);
      if (ctl.downPressed) r.target = Math.min(a.reach, r.target + S.reelStep * T);
      const wind = level.winds && level.winds.length ? level.windAt(this) : { ax: 0, ay: 0 };

      if (!r.slack) {
        const L0 = r.len;
        const L1 = G.approach(L0, r.target, S.reelSpeed * dt);
        if (L1 !== L0) { r.omega *= (L0 * L0) / (L1 * L1); r.len = L1; }
        const s = Math.sin(r.angle), c = Math.cos(r.angle);
        const tang = -S.gravity * s + inputX * S.pump * c + wind.ax * c - wind.ay * s;
        r.omega += (tang / r.len) * dt;
        r.omega *= Math.max(0, 1 - S.damping * dt);
        const vmax = S.maxSpeed / r.len;
        r.omega = G.clamp(r.omega, -vmax, vmax);
        // tension check: ω²L + g·cosθ < 0 → rope goes slack
        if (r.omega * r.omega * r.len + (S.gravity + wind.ay) * c < 0) {
          r.slack = true;
          this.vx = r.len * r.omega * c; this.vy = -r.len * r.omega * s;
        } else {
          r.angle += r.omega * dt;
          this.vx = r.len * r.omega * Math.cos(r.angle);
          this.vy = -r.len * r.omega * Math.sin(r.angle);
        }
      }
      if (r.slack) {
        this.vy = Math.min(this.vy + (S.gravity + wind.ay) * dt, P.maxFall);
        this.vx += wind.ax * dt;
      }
      // desired rope point → body delta
      let dx, dy;
      if (!r.slack) {
        dx = r.ax + r.len * Math.sin(r.angle) - this.w / 2 - this.x;
        dy = r.ay + r.len * Math.cos(r.angle) - S.ropeOffsetY - this.y;
      } else { dx = this.vx * dt; dy = this.vy * dt; }
      const rx = G.Physics.move(this, dx, 0, level);
      const ry = G.Physics.move(this, 0, dy, level);
      let q = this.ropePoint();
      let d = Math.hypot(q.x - r.ax, q.y - r.ay);
      if (r.slack && d >= r.len) {
        // rope snaps taut: keep only the tangential velocity
        r.angle = Math.atan2(q.x - r.ax, q.y - r.ay);
        r.omega = (this.vx * Math.cos(r.angle) - this.vy * Math.sin(r.angle)) / r.len;
        r.slack = false;
        G.Physics.move(this, r.ax + r.len * Math.sin(r.angle) - this.w / 2 - this.x, 0, level);
        G.Physics.move(this, 0, r.ay + r.len * Math.cos(r.angle) - S.ropeOffsetY - this.y, level);
        q = this.ropePoint(); d = Math.hypot(q.x - r.ax, q.y - r.ay);
      }
      if (Math.abs(this.vx) > 20) this.facing = Math.sign(this.vx);
      this.onGround = false;
      if (rx.hitX || ry.hitY) {
        const speed = Math.hypot(this.vx, this.vy);
        if (ry.ground) { this.detachRope(); this.onGround = true; this.vy = 0; this.groundEntity = ry.groundEntity; this.surface = level.surfaceOf(ry.groundTiles); return; }
        if (rx.hitX && Math.abs(this.vx) > S.wallDetachSpeed) { this.detachRope(); this.vx = 0; return; }
        if (!r.slack) {
          r.angle = Math.atan2(q.x - r.ax, q.y - r.ay);
          r.omega = 0;
          if (d < r.len - 1) r.len = Math.max(S.minLen, d);
          r.target = Math.max(r.target, r.len);
        } else { if (rx.hitX) this.vx = 0; if (ry.hitY) this.vy = Math.max(0, this.vy); }
        if (speed > 0) { this.vx = rx.hitX ? 0 : this.vx; this.vy = ry.hitY ? 0 : this.vy; }
      }
      // a tile cutting the rope line detaches after a short grace
      const clear = G.Physics.lineClear(level, r.ax, r.ay, q.x, q.y, (tx, ty) => tx === a.tx && ty === a.ty);
      r.blockT = clear ? 0 : r.blockT + dt;
      if (r.blockT > S.blockGrace) { this.detachRope(); return; }
      this.wallDir = 0;
    }

    // ------------------------------------------------------------------ helpers
    /** Jumping into a ceiling edge by a few px: slide sideways around it instead of bonking. */
    cornerCorrect(level, dy) {
      const r = { x: this.x, y: this.y + dy, w: this.w, h: this.h };
      if (!G.Physics.solidAt(r, level, this)) return;
      for (let o = 1; o <= P.cornerCorrection; o++) {
        for (const s of [-1, 1]) {
          r.x = this.x + o * s;
          if (!G.Physics.solidAt(r, level, this) && !G.Physics.solidAt({ x: r.x, y: this.y, w: this.w, h: this.h }, level, this)) { this.x = r.x; return; }
        }
      }
    }

    /** Falling just short of a ledge top: lift up to ledgeAssist px if that clears it. */
    ledgeAssist(level, dir) {
      for (let k = 1; k <= P.ledgeAssist; k++) {
        const up = { x: this.x, y: this.y - k, w: this.w, h: this.h };
        if (G.Physics.solidAt(up, level, this)) return false;
        if (!G.Physics.solidAt({ x: this.x + dir * 2, y: up.y, w: this.w, h: this.h }, level, this)) { this.y = up.y; return true; }
      }
      return false;
    }

    standingOnOneWay(level) {
      const ty = Math.floor((this.y + this.h + 1) / T);
      const x0 = Math.floor(this.x / T), x1 = Math.floor((this.x + this.w - 1) / T);
      let any = false;
      for (let tx = x0; tx <= x1; tx++) {
        if (level.isSolidTile(tx, ty)) return false;
        if (level.isOneWayTile(tx, ty)) any = true;
      }
      if (this.groundEntity && this.groundEntity.oneWay) any = true;
      return any;
    }

    /** Wall within 6px on either side (lenient wall jump). Returns dir or 0. */
    nearWall(level) {
      if (this.onGround) return 0;
      const b = { x: this.x - 5, y: this.y, w: this.w, h: this.h };
      if (G.Physics.wallAt(b, -1, level)) return -1;
      b.x = this.x + 5;
      if (G.Physics.wallAt(b, 1, level)) return 1;
      return 0;
    }
  }

  G.Player = Player;
})();
