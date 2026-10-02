/**
 * Player controller: run, variable jump, coyote time, jump buffering,
 * wall slide + wall jump, crate pushing, carrying a repair part, interaction.
 *
 * Animation state for art (G.Art.Player.draw reads these, never writes):
 *   state: 'idle'|'run'|'jump'|'fall'|'wall'|'push'|'land'|'interact'|'dead'|'spawn'
 *   stateTime, facing (1|-1), vx, vy, onGround, carry (item name|null),
 *   landImpact (0..1, decays), deathCause ('spikes'|'acid'|'laser'|'saw'|'fall'|null)
 */
(function () {
  const P = G.CONFIG.player;

  class Player {
    constructor(x, y) {
      this.w = P.w; this.h = P.h;
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
    }

    setState(s) {
      if (this.state !== s) { this.state = s; this.stateTime = 0; }
    }

    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }

    kill(cause) {
      if (this.dead || this.frozen) return; // frozen = level complete: nothing can kill her any more
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
     * @param {object} ctl  {left,right,down, jumpPressed, jumpHeld}
     */
    update(dt, level, ctl) {
      this.stateTime += dt;
      this.landImpact = Math.max(0, this.landImpact - dt * 4);
      this.interactT = Math.max(0, this.interactT - dt);
      if (this.dead) return;
      if (this.frozen) { ctl = { left: false, right: false, down: false, jumpPressed: false, jumpHeld: false }; }

      const inputX = (ctl.right ? 1 : 0) - (ctl.left ? 1 : 0);

      // ---- never stay inside a dynamic solid (bridge extended into her, crate respawned on her) ----
      if (!G.Physics.depenetrate(this, level, P.crushPush)) { this.kill('crush'); return; }

      // ---- timers ----
      this.coyote = this.onGround ? P.coyoteTime : Math.max(0, this.coyote - dt);
      this.jumpBuffer = ctl.jumpPressed ? P.jumpBuffer : Math.max(0, this.jumpBuffer - dt);
      this.wallLockT = Math.max(0, this.wallLockT - dt);
      this.dropT = Math.max(0, this.dropT - dt);

      // ---- horizontal ----
      const maxSpeed = this.pushing ? P.pushSpeed : P.runSpeed;
      let accel, target = inputX * maxSpeed;
      if (this.onGround) accel = inputX ? P.groundAccel : P.groundDecel;
      else accel = inputX ? P.airAccel : P.airDecel;
      if (this.wallLockT > 0) accel *= 0.25;
      this.vx = G.approach(this.vx, target, accel * dt);
      if (inputX && this.wallLockT <= 0) this.facing = inputX;

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
      if (this.jumpBuffer > 0) {
        if (ctl.down && this.onGround && this.standingOnOneWay(level)) {
          // drop through one-way platform
          this.dropT = 0.2; this.jumpBuffer = 0; this.y += 2; this.onGround = false;
        } else if (this.coyote > 0) {
          this.vy = -P.jumpVelocity;
          this.jumping = true;
          this.onGround = false; this.coyote = 0; this.jumpBuffer = 0;
          G.Audio.play('jump');
          G.fx.dust(this.cx, this.y + this.h, 6);
        } else if (this.wallDir !== 0 || this.wallStick > 0 || this.nearWall(level)) {
          const dir = this.wallDir || this.nearWall(level);
          this.vy = -P.wallJumpVy;
          this.vx = -dir * P.wallJumpVx;
          this.facing = -dir;
          this.jumping = true;
          this.wallLockT = P.wallJumpLock;
          this.jumpBuffer = 0; this.wallStick = 0;
          G.Audio.play('walljump');
          G.fx.dust(dir > 0 ? this.x + this.w : this.x, this.cy, 5);
        }
      }
      if (this.jumping && !ctl.jumpHeld && this.vy < 0) {
        this.vy *= P.jumpCut;
        this.jumping = false;
      }
      if (this.vy >= 0) this.jumping = false;

      // ---- gravity ----
      this.vy += P.gravity * dt;
      const maxFall = sliding ? P.wallSlideMax : P.maxFall;
      if (this.vy > maxFall) this.vy = G.approach(this.vy, maxFall, P.gravity * 2 * dt);
      if (sliding && Math.random() < dt * 20) G.fx.dust(this.wallDir > 0 ? this.x + this.w : this.x, this.y + this.h * 0.4, 1);

      // ---- move ----
      const wasGround = this.onGround;
      const preVy = this.vy;
      const rx = G.Physics.move(this, this.vx * dt, 0, level, { pusher: true, canPush: this.onGround });
      this.pushing = !!rx.pushing && this.onGround && inputX !== 0;
      if (rx.hitX && !this.onGround && inputX !== 0 && this.vy > -P.ledgeAssistMinVy && this.ledgeAssist(level, inputX)) {
        // ledge forgiveness: popped up onto a ledge she just barely missed; keep momentum
        G.Physics.move(this, this.vx * dt * 0.5, 0, level);
      } else if (rx.hitX) this.vx = 0;
      if (this.vy < 0) this.cornerCorrect(level, this.vy * dt);
      const ry = G.Physics.move(this, 0, this.vy * dt, level, { dropThrough: this.dropT > 0 || (ctl.down && ctl.jumpHeld && false) });
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
      for (const [tx, ty] of ry.groundTiles) level.touchCrumble(tx, ty);

      // ---- hazards ----
      const hz = level.hazardAt({ x: this.x + 3, y: this.y + 4, w: this.w - 6, h: this.h - 6 });
      if (hz) this.kill(hz);
      if (this.y > level.pxH + 80) this.kill('fall');

      // ---- animation state ----
      if (this.dead) return;
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
      const T = G.TILE;
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
