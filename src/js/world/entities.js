/**
 * Runtime entity types. Data comes from level definitions in TILE coords;
 * runtime fields are in PIXELS. Art reads entity fields via G.Art.Entities.draw.
 *
 * Signals: "sources" (lever, plate, terminal, socket) expose `active` and
 * `targets: [ids]`. "Receivers" (door, bridge, mplatform, laser, saw, exit)
 * have an `id` and get `powered` set by Level.resolveSignals().
 */
(function () {
  const T = G.TILE;
  const Types = {};
  G.EntityTypes = Types;

  class Entity {
    constructor(d, level) {
      Object.assign(this, d);
      this.level = level;
      this.tx = d.x; this.ty = d.y;
      this.x = d.x * T; this.y = d.y * T;
      this.w = T; this.h = T;
      this.targets = d.targets || (d.target ? [d.target] : []);
      this.active = false;
      this.powered = false;
      this.t = 0;
      this.solid = false;
      this.interactable = false;
    }
    /** Does this receiver have any signal sources? */
    get wired() { return !!(this.id && this.level.sourcesFor && this.level.sourcesFor[this.id]); }
    update(dt, game) { this.t += dt; }
    isSolid() { return false; }
    get cx() { return this.x + this.w / 2; }
    get cy() { return this.y + this.h / 2; }
  }

  // ------------------------------------------------------------------ checkpoint
  Types.checkpoint = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.y = (d.y - 1) * T; this.h = 2 * T;
      this.lit = false; this.litT = 0;
    }
    update(dt, game) {
      super.update(dt);
      if (this.lit) this.litT += dt;
      const p = game.player;
      if (!this.lit && !p.dead && G.overlap(p, this)) {
        game.activateCheckpoint(this);
        p.heal(G.CONFIG.health.checkpointHeal);
      }
    }
    get spawnPoint() {
      return { x: this.x + (T - G.CONFIG.player.w) / 2, y: (this.ty + 1) * T - G.CONFIG.player.h };
    }
  };

  // ------------------------------------------------------------------ exit
  Types.exit = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.y = (d.y - 2) * T; this.h = 3 * T;
      this.used = false;
    }
    get locked() { return this.wired && !this.powered; }
    update(dt, game) {
      super.update(dt);
      const p = game.player;
      if (!this.used && !p.dead && !this.locked && G.overlap(p, { x: this.x + 8, y: this.y, w: this.w - 16, h: this.h })) {
        this.used = true;
        game.completeLevel();
      }
    }
  };

  // ------------------------------------------------------------------ crate
  Types.crate = class extends Entity {
    constructor(d, l) {
      super(d, l);
      const s = G.CONFIG.crate.size;
      this.w = s; this.h = s;
      this.x = d.x * T + (T - s) / 2; this.y = (d.y + 1) * T - s;
      this.home = { x: this.x, y: this.y };
      this.snapshot = { x: this.x, y: this.y };
      this.vy = 0;
      this.solid = true;
      this.pushable = true;
      this.onGround = false;
      this.groundEntity = null;
    }
    isSolid() { return true; }
    tryPush(dx, level) {
      if (!this.onGround) return;
      G.Physics.move(this, dx, 0, level);
      if (Math.abs(dx) > 0 && Math.random() < 0.3) G.fx.dust(dx > 0 ? this.x : this.x + this.w, this.y + this.h, 1);
      this.pushedT = 0.1;
      this.pushedNow = true;
      this.vx = Math.sign(dx) * G.CONFIG.player.pushSpeed; // slides a little after release (friction)
    }
    update(dt, game) {
      super.update(dt);
      this.pushedT = Math.max(0, (this.pushedT || 0) - dt);
      const C = G.CONFIG.crate, L = game.level, p = game.player;
      const wind = L.winds && L.winds.length ? L.windAt(this) : null;
      this.vy = Math.min(this.vy + (C.gravity + (wind ? wind.ay * G.CONFIG.wind.crateFactor : 0)) * dt, C.maxFall);
      // ---- horizontal: friction, belts, wind, inherited platform velocity ----
      if (wind) this.vx += wind.ax * G.CONFIG.wind.crateFactor * dt;
      if (this.onGround) {
        const ice = this.surface && this.surface.ice;
        this.vx = G.approach(this.vx, 0, C.friction * (ice ? G.CONFIG.surface.iceDecel : 1) * dt);
      }
      if (!this.thrownT) this.vx = G.clamp(this.vx, -C.maxSlide, C.maxSlide);
      const belt = this.onGround && this.surface && this.surface.conveyor ? this.surface.conveyor * G.CONFIG.surface.conveyorSpeed : 0;
      const mx = (this.pushedNow ? 0 : this.vx) + belt;
      this.pushedNow = false;
      if (mx) {
        const ox = this.x;
        const r = G.Physics.move(this, mx * dt, 0, L);
        if (!p.dead && G.overlap(this, p) && !(this.y + this.h <= p.y + 2)) { this.x = ox; this.vx = 0; }
        else if (r.hitX) this.vx = 0;
      }
      const pre = this.vy;
      const wasGround = this.onGround, prevGE = this.groundEntity;
      const r = G.Physics.move(this, 0, this.vy * dt, L);
      if (r.ground) {
        if (!this.onGround && pre > 300) { G.Audio.play('crateland'); G.fx.dust(this.cx, this.y + this.h, 6); }
        this.vy = 0;
      }
      this.onGround = r.ground;
      this.groundEntity = r.groundEntity;
      this.surface = r.ground ? L.surfaceOf(r.groundTiles) : { ice: false, conveyor: 0 };
      // left the ground: a push slide stops at the edge (drops straight down, as in chapter 1);
      // leaving a moving platform inherits its velocity
      this.thrownT = Math.max(0, (this.thrownT || 0) - dt); if (this.onGround && this.thrownT < 0.9) this.thrownT = 0;
      if (wasGround && !this.onGround && !this.thrownT) this.vx = prevGE && prevGE.vx ? prevGE.vx * G.CONFIG.momentum.inheritX : 0;
      for (const [tx, ty] of r.groundTiles) L.touchCrumble(tx, ty);
      // don't sink into the player: rest on their head instead
      if (!p.dead && G.overlap(this, p) && this.y < p.y) { this.y = p.y - this.h; this.vy = 0; this.onGround = true; }
      if (this.y > L.pxH + 64 || L.hazardAt({ x: this.x + 6, y: this.y + 6, w: this.w - 12, h: this.h - 6 }) === 'acid') {
        G.fx.burst(this.cx, Math.min(this.cy, L.pxH), { count: 12, color: '#a08060', speed: 150, life: 0.6 });
        this.x = this.snapshot.x; this.y = this.snapshot.y; this.vy = 0; this.vx = 0;
        G.Audio.play('respawnCrate');
      }
    }
    restore() { this.x = this.snapshot.x; this.y = this.snapshot.y; this.vy = 0; this.vx = 0; }
  };

  // ------------------------------------------------------------------ shard (collectible)
  Types.shard = class extends Entity {
    constructor(d, l) { super(d, l); this.x += 8; this.y += 8; this.w = 16; this.h = 16; this.collected = false; this.collectT = 0; }
    update(dt, game) {
      super.update(dt);
      if (this.collected) { this.collectT += dt; return; }
      if (G.overlap(game.player, this) && !game.player.dead) {
        this.collected = true;
        game.collectShard(this);
      }
    }
  };

  // ------------------------------------------------------------------ jump pad
  Types.jumppad = class extends Entity {
    constructor(d, l) { super(d, l); this.y = d.y * T + T - 10; this.h = 10; this.fireT = 99; }
    update(dt, game) {
      super.update(dt);
      this.fireT += dt;
      const p = game.player;
      if (!p.dead && p.vy >= 0 && G.overlap(p, { x: this.x + 2, y: this.y - 2, w: this.w - 4, h: 8 })) {
        p.vy = -G.CONFIG.player.jumpPadVelocity;
        p.jumping = false; p.onGround = false; p.coyote = 0;
        p.setState('jump');
        this.fireT = 0;
        G.Audio.play('jumppad');
        G.fx.burst(this.cx, this.y, { count: 10, color: '#7ef9ff', speed: 180, life: 0.5, size: 3, gravity: 300 });
      }
    }
  };

  // ------------------------------------------------------------------ door (solid until powered)
  Types.door = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.w = (d.w || 1) * T; this.h = (d.h || 3) * T;
      this.solid = true; this.climbable = true;
      this.openT = 0; // 0 closed .. 1 open
    }
    isSolid() { return this.openT < 0.6; }
    update(dt, game) {
      super.update(dt);
      const want = this.powered ? 1 : 0;
      if (want === 0 && this.openT > 0) {
        // never close on a body
        if (G.overlap(game.player, this) || game.level.crates.some((b) => G.overlap(b, this))) return;
      }
      const prev = this.openT;
      this.openT = G.approach(this.openT, want, dt * 2.2);
      if (prev === 0 && this.openT > 0) G.Audio.play('door');
      if (prev === 1 && this.openT < 1) G.Audio.play('door');
    }
  };

  // ------------------------------------------------------------------ bridge (solid when powered)
  Types.bridge = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.w = (d.w || 3) * T; this.h = (d.h || 1) * T;
      this.solid = true; this.climbable = true;
      this.extendT = 0;
    }
    isSolid() { return this.extendT > 0.6; }
    update(dt, game) {
      super.update(dt);
      const prev = this.extendT;
      let want = this.powered ? 1 : 0;
      // retracting under a body is allowed (it falls) – that's the point of a bridge
      this.extendT = G.approach(this.extendT, want, dt * 2.5);
      if (prev === 0 && this.extendT > 0) G.Audio.play('bridge');
    }
  };

  // ------------------------------------------------------------------ lever
  Types.lever = class extends Entity {
    constructor(d, l) { super(d, l); this.interactable = true; this.flipT = 0; this.active = !!d.on; this.prompt = 'Рычаг'; }
    update(dt) { super.update(dt); this.flipT = G.approach(this.flipT, this.active ? 1 : 0, dt * 6); }
    canInteract() { return !(this.oneShot && this.active); }
    interact(game) {
      this.active = !this.active;
      G.Audio.play('lever');
      game.player.interactT = 0.25;
    }
  };

  // ------------------------------------------------------------------ pressure plate
  Types.plate = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.w = (d.w || 1) * T;
      this.y = d.y * T + T - 6; this.h = 6;
      this.pressT = 0;
    }
    update(dt, game) {
      super.update(dt);
      const zone = { x: this.x + 3, y: this.y - 2, w: this.w - 6, h: 8 };
      const was = this.active;
      this.byCrate = game.level.crates.some((b) => G.overlap(b, zone));
      this.active = this.byCrate || (!game.player.dead && G.overlap(game.player, zone));
      if (this.active !== was) G.Audio.play(this.active ? 'plateDown' : 'plateUp');
      this.pressT = G.approach(this.pressT, this.active ? 1 : 0, dt * 10);
    }
  };

  // ------------------------------------------------------------------ terminal (opens a puzzle)
  Types.terminal = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.y = (d.y - 1) * T; this.h = 2 * T;
      this.interactable = true;
      this.solved = false;
      this.puzzleState = null;
      this.prompt = 'Терминал';
    }
    canInteract() { return !this.solved; }
    interact(game) {
      game.player.interactT = 0.3;
      game.openPuzzle(this);
    }
    onSolved(game) {
      this.solved = true;
      this.active = true;
      G.Audio.play('solved');
      G.fx.burst(this.cx, this.y + 10, { count: 24, color: '#7ef9ff', speed: 200, life: 0.9, size: 3, gravity: 200 });
      if (this.onSolve) game.playDialogue(this.onSolve);
      if (this.objective) game.setObjective(this.objective);
    }
  };

  // ------------------------------------------------------------------ part (carryable repair item)
  Types.part = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.item = d.item || 'fuse';
      this.x += 6; this.y += 10; this.w = 20; this.h = 22;
      this.home = { x: this.x, y: this.y };
      this.taken = false; this.delivered = false;
      this.interactable = true;
      this.prompt = 'Взять';
    }
    canInteract(game) { return !this.taken && !game.player.carry; }
    interact(game) {
      this.taken = true;
      game.player.carry = this.item;
      game.player.carryPart = this;
      game.player.interactT = 0.25;
      G.Audio.play('pickup');
      if (this.onPickup) game.playDialogue(this.onPickup);
      if (this.objective) game.setObjective(this.objective);
    }
  };

  // ------------------------------------------------------------------ socket (accepts a part → repaired)
  Types.socket = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.needs = d.needs || 'fuse';
      this.y = (d.y - 1) * T; this.h = 2 * T;
      this.interactable = true;
      this.prompt = 'Починить';
      this.repairT = 0;
    }
    canInteract(game) { return !this.active && game.player.carry === this.needs; }
    /** Shown when the player is near but lacks the part. */
    missingHint(game) { return !this.active && game.player.carry !== this.needs ? (G.ITEM_NAMES[this.needs] || this.needs) : null; }
    interact(game) {
      this.active = true;
      const part = game.player.carryPart;
      if (part) part.delivered = true;
      game.player.carry = null; game.player.carryPart = null;
      game.player.interactT = 0.35;
      G.Audio.play('repair');
      G.fx.burst(this.cx, this.cy, { count: 30, color: '#ffe17a', speed: 240, life: 0.8, size: 3, gravity: 400 });
      if (this.onRepair) game.playDialogue(this.onRepair);
      if (this.objective) game.setObjective(this.objective);
    }
    update(dt) { super.update(dt); if (this.active) this.repairT += dt; }
  };

  G.ITEM_NAMES = {
    fuse: 'Предохранитель', cell: 'Энергоячейка', gear: 'Шестерня', lens: 'Фокусирующая линза',
    chip: 'Чип навигации', core: 'Ядро Зодчих', valve: 'Клапан', antenna: 'Антенна',
  };

  // ------------------------------------------------------------------ moving platform (one-way, carries riders)
  Types.mplatform = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.w = (d.w || 3) * T; this.h = 16;
      this.oneWay = true; this.solid = true;
      const pts = (d.path || []).map(([x, y]) => ({ x: x * T, y: y * T }));
      if (!pts.length || pts[0].x !== this.x || pts[0].y !== this.y) pts.unshift({ x: this.x, y: this.y });
      this.pts = pts;
      this.from = 0; this.to = Math.min(1, pts.length - 1); this.segT = 0; this.dir = 1;
      this.speed = (d.speed || 2) * T;
      this.pause = d.pause == null ? 0.5 : d.pause;
      this.waitT = 0;
      this.mode = d.mode || 'pingpong';
      this.dx = 0; this.dy = 0;
      this.vx = 0; this.vy = 0; // px/s (momentum inheritance)
      this.mover = true;
    }
    isSolid() { return true; }
    get running() { return !this.wired || this.powered; }
    update(dt, game) {
      super.update(dt);
      const ox = this.x, oy = this.y;
      if (this.pts.length > 1 && this.running) {
        if (this.waitT > 0) this.waitT -= dt;
        else {
          let move = this.speed * dt;
          let guard = 0;
          while (move > 0 && guard++ < 16) {
            const A = this.pts[this.from], B = this.pts[this.to];
            const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
            const left = len * (1 - this.segT);
            if (move < left) { this.segT += move / len; move = 0; }
            else {
              move -= left; this.segT = 0; this.advance();
              if (this.pause > 0 && (this.from === 0 || (this.mode !== 'loop' && this.from === this.pts.length - 1))) { this.waitT = this.pause; break; }
            }
          }
          const A = this.pts[this.from], B = this.pts[this.to];
          this.x = G.lerp(A.x, B.x, this.segT);
          this.y = G.lerp(A.y, B.y, this.segT);
        }
      }
      this.dx = this.x - ox; this.dy = this.y - oy;
      this.vx = dt > 0 ? this.dx / dt : 0; this.vy = dt > 0 ? this.dy / dt : 0;
      // carry riders (and whatever stands on them: Mira on a crate on a lift moves too)
      if (this.dx || this.dy) carryRiders(this, this.dx, this.dy, game, 0);
    }
    advance() {
      const n = this.pts.length;
      this.from = this.to;
      if (this.mode === 'loop') { this.to = (this.from + 1) % n; return; }
      if (this.from + this.dir < 0 || this.from + this.dir >= n) this.dir = -this.dir;
      this.to = this.from + this.dir;
    }
  };

  /** Move every body standing on `base` by (dx,dy), recursively for stacks. */
  function carryRiders(base, dx, dy, game, depth) {
    if (depth > 4) return;
    const L = game.level;
    const visit = (r) => {
      if (r === base || r.groundEntity !== base || r.dead) return;
      const ox = r.x, oy = r.y;
      G.Physics.move(r, dx, 0, L);
      G.Physics.move(r, 0, dy, L);
      if (r.x !== ox || r.y !== oy) carryRiders(r, r.x - ox, r.y - oy, game, depth + 1);
    };
    visit(game.player);
    for (const c of L.crates) visit(c);
  }
  G.carryRiders = carryRiders;

  // ------------------------------------------------------------------ laser / energy arc (hazard)
  Types.laser = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.dir = d.dir || 'down';
      this.period = d.period || 0;
      this.onTime = d.on == null ? (this.period ? this.period / 2 : 0) : d.on;
      this.offset = d.offset || 0;
      this.warn = 0.45;
      // beam length: until first solid tile (max len)
      const maxLen = d.len || 24;
      const [ddx, ddy] = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[this.dir];
      this.ddx = ddx; this.ddy = ddy;
      let n = 0;
      let cx = d.x + ddx, cy = d.y + ddy;
      while (n < maxLen && !l.isSolidTile(cx, cy)) { n++; cx += ddx; cy += ddy; }
      this.len = n;
      const th = 10;
      if (ddx === 0) {
        this.beam = { x: this.x + T / 2 - th / 2, y: ddy > 0 ? this.y + T : this.y - n * T, w: th, h: n * T };
      } else {
        this.beam = { x: ddx > 0 ? this.x + T : this.x - n * T, y: this.y + T / 2 - th / 2, w: n * T, h: th };
      }
      this.phase = 'on';
    }
    /** 'off' | 'warn' | 'on' | 'disabled' */
    computePhase(time) {
      if (this.wired && this.powered) return 'disabled';
      if (!this.period) return 'on';
      const ph = ((time + this.offset) % this.period + this.period) % this.period;
      if (ph < this.onTime) return 'on';
      if (ph > this.period - this.warn) return 'warn';
      return 'off';
    }
    update(dt, game) {
      super.update(dt);
      const prev = this.phase;
      this.phase = this.computePhase(game.level.time);
      if (this.phase === 'on' && prev !== 'on' && game.isNear(this.cx, this.cy, 520)) G.Audio.play('laserOn', { volume: 0.5 });
      const p = game.player;
      if (this.phase === 'on' && !p.dead && G.overlap({ x: p.x + 3, y: p.y + 4, w: p.w - 6, h: p.h - 6 }, this.beam)) p.hurt(G.CONFIG.damage.laser, 'laser', this.beam.x + this.beam.w / 2);
    }
  };

  // ------------------------------------------------------------------ saw / spinning blade (hazard on a path)
  Types.saw = class extends Types.mplatform {
    constructor(d, l) {
      super(d, l);
      this.r = d.r || 18;
      this.oneWay = false; this.solid = false;
      this.w = this.h = 0;
      // centre on tile
      const off = T / 2;
      this.pts = this.pts.map((p) => ({ x: p.x + off, y: p.y + off }));
      this.x = this.pts[0].x; this.y = this.pts[0].y;
      this.pause = d.pause == null ? 0 : d.pause;
      this.speed = (d.speed || 3) * T;
    }
    isSolid() { return false; }
    get running() { return !(this.wired && this.powered); }
    update(dt, game) {
      // move like a platform but never carry
      const saveRiders = game.player.groundEntity;
      super.update(dt, game);
      game.player.groundEntity = saveRiders;
      const p = game.player;
      if (!p.dead && this.running) {
        const nx = G.clamp(this.x, p.x + 3, p.x + p.w - 3);
        const ny = G.clamp(this.y, p.y + 4, p.y + p.h - 2);
        const dx = this.x - nx, dy = this.y - ny;
        if (dx * dx + dy * dy < (this.r - 3) * (this.r - 3)) p.hurt(G.CONFIG.damage.saw, 'saw', this.x);
      }
    }
  };

  // ------------------------------------------------------------------ sign (readable text, used for logic clues)
  Types.sign = class extends Entity {
    constructor(d, l) { super(d, l); this.interactable = true; this.prompt = 'Читать'; }
    canInteract() { return true; }
    interact(game) {
      G.Audio.play('ui');
      if (this.dialogue) game.playDialogue(this.dialogue);
      else game.showSign(this.title || 'Надпись', this.text || '');
    }
  };

  // ------------------------------------------------------------------ trigger (invisible zone)
  Types.trigger = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.w = (d.w || 1) * T; this.h = (d.h || 1) * T;
      this.once = d.once !== false;
      this.fired = false; this.inside = false;
    }
    update(dt, game) {
      const p = game.player;
      const inside = !p.dead && G.overlap(p, this);
      if (inside && !this.inside && !(this.once && this.fired)) {
        // requirement not met yet: stay "outside" so it fires as soon as it is met, even if she never left the zone
        if (this.requires && !(game.level.byId[this.requires] && game.level.byId[this.requires].active)) { this.inside = false; return; }
        this.fired = true;
        if (this.grant) G.grantAbility(game, this.grant);
        if (this.objective) game.setObjective(this.objective);
        if (this.dialogue) game.playDialogue(this.dialogue);
        if (this.say) game.dialogue.playInline(this.say, this.mode || 'bark');
        if (this.sound) G.Audio.play(this.sound);
        if (this.shake) G.fx.shake(this.shake, 0.6);
      }
      this.inside = inside;
    }
  };

  // ------------------------------------------------------------------ hint (floating tutorial text, drawn by HUD)
  Types.hint = class extends Entity {
    constructor(d, l) { super(d, l); this.alpha = 0; }
    update(dt, game) {
      const near = Math.abs(game.player.cx - this.cx) < (this.range || 5) * T && Math.abs(game.player.cy - this.cy) < 4 * T;
      this.alpha = G.approach(this.alpha, near ? 1 : 0, dt * 3);
    }
  };


  // ================================================================== Chapter 2 (docs/chapter2-spec.md §2)

  /**
   * Grant an ability ('dash') for this run and in the save, then show the icon hint.
   * Works without a full GameScene (unit tests): G.save / game.onAbilityGranted are optional.
   */
  G.grantAbility = (game, name) => {
    game.level.granted[name] = true;
    if (G.save) { G.save.abilities = G.save.abilities || {}; G.save.abilities[name] = true; if (G.persist) G.persist(); }
    if (name === 'dash') { game.player.canDash = true; game.player.dashCharges = G.CONFIG.dash.charges; }
    if (game.onAbilityGranted) game.onAbilityGranted(name);
    G.Audio.play('solved');
  };

  // ------------------------------------------------------------------ anchor (grapple point)
  /** {x,y,[len=4 tiles]}. Art: attached. Rope state lives on the player (p.rope). */
  Types.anchor = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.reach = (d.len || G.CONFIG.swing.reach) * T;
      this.attached = false;
    }
  };

  // ------------------------------------------------------------------ wind (current zone)
  /**
   * {x,y,w,h,dir,[strength=900],[period],[on],[offset]}. Pulses like a laser if `period` is set.
   * If something targets its id, it blows only while powered. Art: phase ('on'|'warn'|'off'), strength, k (0..1).
   */
  Types.wind = class extends Entity {
    constructor(d, l) {
      super(d, l);
      const W = G.CONFIG.wind;
      this.w = (d.w || 1) * T; this.h = (d.h || 1) * T;
      this.dir = d.dir || 'up';
      this.strength = d.strength || W.strength;
      this.period = d.period || 0;
      this.onTime = d.on == null ? (this.period ? this.period / 2 : 0) : d.on;
      this.offset = d.offset || 0;
      const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.dir] || [0, -1];
      this.ux = v[0]; this.uy = v[1];
      this.phase = 'on'; this.k = 1;
    }
    /** Force factor 0..1 at level time (ramps in/out). */
    factor(time) {
      if (this.wired && !this.powered) return 0;
      if (!this.period) return 1;
      const R = G.CONFIG.wind.ramp;
      const ph = ((time + this.offset) % this.period + this.period) % this.period;
      if (ph >= this.onTime) return 0;
      return Math.min(1, ph / R, (this.onTime - ph) / R);
    }
    computePhase(time) {
      if (this.wired && !this.powered) return 'off';
      if (!this.period) return 'on';
      const ph = ((time + this.offset) % this.period + this.period) % this.period;
      if (ph < this.onTime) return 'on';
      if (ph > this.period - G.CONFIG.wind.warn) return 'warn';
      return 'off';
    }
    /** Acceleration {ax, ay} in px/s² at level time. */
    force(time) {
      const k = this.factor(time) * this.strength;
      return { ax: this.ux * k, ay: this.uy * k };
    }
    update(dt, game) {
      super.update(dt);
      this.phase = this.computePhase(game.level.time);
      this.k = this.factor(game.level.time);
    }
  };

  // ------------------------------------------------------------------ dashcrystal
  /** {x,y}: refills the dash on touch, regrows after dashcrystal.regrow s. Art: ready, regrowT (s left). */
  Types.dashcrystal = class extends Entity {
    constructor(d, l) { super(d, l); this.ready = true; this.regrowT = 0; }
    update(dt, game) {
      super.update(dt);
      const C = G.CONFIG.dashcrystal, p = game.player;
      if (!this.ready) { this.regrowT = Math.max(0, this.regrowT - dt); if (this.regrowT <= 0) { this.ready = true; G.Audio.play('crystalRegrow'); } return; }
      if (p.canDash && p.touchesCircle(this.cx, this.cy, C.radius) && p.refillDash()) {
        this.ready = false; this.regrowT = C.regrow;
        G.Audio.play('crystal');
        G.fx.burst(this.cx, this.cy, { count: 14, color: ['#7ef9ff', '#ffffff'], speed: 160, life: 0.5, size: 3, gravity: 0, glow: true });
      }
    }
  };

  // ------------------------------------------------------------------ fallplat
  /** {x,y,[w=2]}: one-way; shakes 0.5s when stood on, falls, respawns. Art: state, t. */
  Types.fallplat = class extends Entity {
    constructor(d, l) {
      super(d, l);
      const F = G.CONFIG.fallplat;
      this.w = (d.w || 2) * T; this.h = F.h;
      this.home = { x: this.x, y: this.y };
      this.oneWay = true; this.solid = true; this.mover = true;
      this.state = 'idle'; this.vy = 0; this.vx = 0; this.dx = 0; this.dy = 0;
    }
    isSolid() { return this.state !== 'gone'; }
    setState(s) { this.state = s; this.t = 0; }
    update(dt, game) {
      this.t += dt;
      const F = G.CONFIG.fallplat, L = game.level;
      const riders = [game.player, ...L.crates].filter((b) => b.groundEntity === this && !b.dead);
      this.dy = 0;
      if (this.state === 'idle' && riders.length) { this.setState('shaking'); G.Audio.play('crumble'); }
      else if (this.state === 'shaking' && this.t >= F.shake) this.setState('falling');
      else if (this.state === 'falling') {
        this.vy = Math.min(this.vy + F.gravity * dt, F.maxFall);
        this.dy = this.vy * dt; this.y += this.dy;
        carryRiders(this, 0, this.dy, game, 0);
        if (this.t >= F.fallTime || this.y > L.pxH + 64) { this.setState('gone'); this.vy = 0; }
      } else if (this.state === 'gone' && this.t >= F.respawn) {
        const r = { x: this.home.x, y: this.home.y, w: this.w, h: this.h };
        if (![game.player, ...L.crates].some((b) => G.overlap(b, r))) { this.x = this.home.x; this.y = this.home.y; this.setState('idle'); }
      }
      this.vy = this.state === 'falling' ? this.vy : 0;
    }
  };

  // ------------------------------------------------------------------ sentinel (enemy drone)
  /**
   * {x,y,[range=7],[speed=170],[path:[[x,y],…]]}. Patrol → alert → chase (≤4 s, LOS) → return → cooldown.
   * Touch kills ('sentinel'); a live laser beam stuns it (falls, harmless) for stunTime.
   * x,y = top-left of a 2·bodyR box; centre = cx, cy. Art: state, eye{x,y}, alertT, vx, vy, stunT.
   */
  Types.sentinel = class extends Entity {
    constructor(d, l) {
      super(d, l);
      const S = G.CONFIG.sentinel;
      this.w = this.h = S.bodyR * 2;
      this.x = d.x * T + T / 2 - S.bodyR; this.y = d.y * T + T / 2 - S.bodyR;
      this.home = { x: this.x, y: this.y };
      this.range = (d.range || S.range) * T;
      this.speed = d.speed || S.speed;
      this.pts = (d.path || []).map(([x, y]) => ({ x: x * T + T / 2 - S.bodyR, y: y * T + T / 2 - S.bodyR }));
      if (this.pts.length) this.pts.unshift({ x: this.x, y: this.y });
      this.ptIdx = 1; this.ptDir = 1;
      this.reset();
    }
    reset() {
      this.x = this.home.x; this.y = this.home.y;
      this.vx = 0; this.vy = 0;
      this.state = 'patrol'; this.stateT = 0;
      this.alertT = 0; this.chaseT = 0; this.loseT = 0; this.cooldownT = 0; this.stunT = 0;
      this.eye = { x: this.cx + 20, y: this.cy };
      this.destroyed = false;
      this.ptIdx = 1; this.ptDir = 1;
    }
    setState(s) { if (this.state !== s) { this.state = s; this.stateT = 0; } }
    sees(p, L) {
      if (p.dead || p.frozen) return false;
      const dx = p.cx - this.cx, dy = p.cy - this.cy;
      if (dx * dx + dy * dy > this.range * this.range) return false;
      return G.Physics.lineClear(L, this.cx, this.cy, p.cx, p.cy);
    }
    /** Distance from centre down to the first solid tile (max 4 tiles). */
    floorGap(L) {
      const tx = Math.floor(this.cx / T);
      for (let ty = Math.floor(this.cy / T); ty < Math.floor(this.cy / T) + 4; ty++) if (L.isSolidTile(tx, ty) || L.isOneWayTile(tx, ty)) return ty * T - this.cy;
      return Infinity;
    }
    steer(tx, ty, speed, accel, dt) {
      const dx = tx - this.x, dy = ty - this.y, d = Math.hypot(dx, dy) || 1;
      const s = Math.min(speed, d * 4);
      this.vx = G.approach(this.vx, (dx / d) * s, accel * dt);
      this.vy = G.approach(this.vy, (dy / d) * s, accel * dt);
      return d;
    }
    update(dt, game) {
      super.update(dt);
      const S = G.CONFIG.sentinel, L = game.level, p = game.player;
      if (this.destroyed) return;
      this.stateT += dt;
      if (this.state === 'thrown') { // grabbed + thrown by Рекс: ballistic, harmless, destroyed on impact
        this.vy = Math.min(this.vy + S.gravity * dt, 900);
        const rx = G.Physics.move(this, this.vx * dt, 0, L), ry = G.Physics.move(this, 0, this.vy * dt, L);
        const boss = L.entities.find((e) => e.type === 'boss' && e.alive && e.state === 'fight' && Math.hypot(e.bx - this.cx, e.by - this.cy) < (e.cfg.bodyR || 40) + 16);
        if (boss) for (let i = 0; i < G.CONFIG.party.rex.sentinelBossDmg && boss.alive; i++) { boss.hurtT = 0; boss.hit(game); }
        if (rx.hitX || ry.hitY || boss || this.stateT > 2 || this.y > L.pxH) {
          this.destroyed = true;
          G.fx.burst(this.cx, this.cy, { count: 22, color: ['#ff6a5a', '#ffd27a', '#ffffff'], speed: 240, life: 0.6, gravity: 400 });
          G.Audio.play('explosion', { volume: 0.5 });
        }
        return;
      }
      this.cooldownT = Math.max(0, this.cooldownT - dt);
      // laser stun
      if (this.state !== 'stunned' && L.lasers) for (const lz of L.lasers) if (lz.phase === 'on' && G.overlap(this, lz.beam)) {
        this.setState('stunned'); this.stunT = S.stunTime; this.vx = 0; this.vy = 0;
        G.Audio.play('sentinelStun'); G.fx.burst(this.cx, this.cy, { count: 12, color: ['#ff6a5a', '#ffffff'], speed: 160, life: 0.5, size: 3, gravity: 300 });
        break;
      }
      const sees = this.state !== 'stunned' && this.sees(p, L);
      switch (this.state) {
        case 'patrol': {
          if (this.pts.length > 1) {
            const tgt = this.pts[this.ptIdx];
            if (this.steer(tgt.x, tgt.y, S.patrolSpeed, S.accel, dt) < 3) {
              if (this.ptIdx + this.ptDir < 0 || this.ptIdx + this.ptDir >= this.pts.length) this.ptDir = -this.ptDir;
              this.ptIdx += this.ptDir;
            }
          } else this.steer(this.home.x, this.home.y + Math.sin(this.t * 2) * 4, S.patrolSpeed, S.accel, dt);
          this.eye = { x: this.cx + Math.sign(this.vx || 1) * 20, y: this.cy + 4 };
          if (sees && this.cooldownT <= 0) { this.setState('alert'); this.alertT = 0; G.Audio.play('sentinelAlert'); }
          break;
        }
        case 'alert':
          this.alertT += dt;
          this.vx = G.approach(this.vx, 0, S.accel * dt); this.vy = G.approach(this.vy, 0, S.accel * dt);
          this.eye = { x: p.cx, y: p.cy };
          if (!sees) { this.setState('return'); break; }
          if (this.alertT >= S.alertTime) { this.setState('chase'); this.chaseT = 0; this.loseT = 0; }
          break;
        case 'chase': {
          this.chaseT += dt;
          this.loseT = sees ? 0 : this.loseT + dt;
          this.eye = { x: p.cx, y: p.cy };
          this.steer(p.cx - this.w / 2, p.cy - this.h / 2, this.speed, S.accel, dt);
          if (this.chaseT >= S.chaseTime || this.loseT >= S.loseTime || p.dead) this.setState('return');
          break;
        }
        case 'return': {
          const d = this.steer(this.home.x, this.home.y, S.returnSpeed, S.accel, dt);
          this.eye = { x: this.home.x + this.w / 2, y: this.home.y + this.h / 2 };
          if (d < 4 || this.stateT > 8) { if (this.stateT > 8) { this.x = this.home.x; this.y = this.home.y; } this.setState('patrol'); this.cooldownT = S.cooldown; this.vx = this.vy = 0; }
          break;
        }
        case 'stunned':
          this.stunT -= dt;
          this.vy = Math.min(this.vy + S.gravity * dt, 900); this.vx = G.approach(this.vx, 0, 400 * dt);
          this.eye = { x: this.cx, y: this.cy + 20 };
          if (this.stunT <= 0) { this.setState('return'); this.cooldownT = S.cooldown; }
          break;
      }
      // keep hovering above the ground (not while stunned)
      if (this.state !== 'stunned') {
        const gap = this.floorGap(L);
        if (gap < S.hover) this.vy = Math.min(this.vy, -(S.hover - gap) * 6);
      }
      const rx = G.Physics.move(this, this.vx * dt, 0, L);
      if (rx.hitX) this.vx = 0;
      const ry = G.Physics.move(this, 0, this.vy * dt, L);
      if (ry.hitY) this.vy = 0;
      if (this.state !== 'stunned' && p.touchesCircle(this.cx, this.cy, S.hitR) && p.hurt(G.CONFIG.damage.sentinel, 'sentinel', this.cx)) { this.setState('return'); this.cooldownT = S.cooldown; }
    }
  };

  // ------------------------------------------------------------------ npc
  /** {x,y,who,dialogue,[facing]}: talk with E; repeat talks play dialogue+'_again' if it exists. Art: who, facing, talking, t. */
  Types.npc = class extends Entity {
    constructor(d, l) {
      super(d, l);
      this.y = (d.y - 1) * T; this.h = 2 * T;
      this.interactable = true; this.prompt = 'Говорить';
      this.facing = d.facing || -1;
      this.talking = false; this.talkMood = 'neutral'; this.talks = 0;
    }
    canInteract(game) { return !game.dialogue.blocking && !this.gone; }
    currentDialogue() {
      const again = this.dialogue + '_again';
      return this.talks > 0 && G.Script && G.Script[again] ? again : this.dialogue;
    }
    interact(game) {
      const id = this.currentDialogue();
      this.talks++;
      this.facing = game.player.cx >= this.cx ? 1 : -1;
      game.player.facing = -this.facing;
      // recruit:'rex' — joins the party when the talk ends (docs/companions-spec.md §4)
      const join = this.recruit && game.recruit ? () => game.recruit(this) : null;
      if (id) game.playDialogue(id, join || undefined); else if (join) join();
    }
    update(dt, game) {
      super.update(dt);
      const p = game.player, R = G.CONFIG.npc.faceRange * T;
      if (!this.talking && Math.abs(p.cx - this.cx) < R && Math.abs(p.cy - this.cy) < R) this.facing = p.cx >= this.cx ? 1 : -1;
    }
  };

  // ------------------------------------------------------------------ deco (static prop, drawn by G.Art.Decor.drawProp)
  Types.deco = class extends Entity {
    constructor(d, l) { super(d, l); this.layer = d.layer || 'back'; }
    update() {}
  };
})();

// ==================================================================== health pickups + sudden hazards
// docs/companions-spec.md §2–3. Actors = Mira + companions (game.actors() if present, else just Mira).
(function () {
  const T = G.TILE, Types = G.EntityTypes;
  const Base = Object.getPrototypeOf(Types.trigger);
  const actors = (game) => (game.actors ? game.actors() : [game.player]);
  const hb = (a) => (a.hurtbox ? a.hurtbox() : a);
  const hurtA = (a, cause, fromX, amt) => a.hurt && a.hurt(amt != null ? amt : G.CONFIG.damage[cause], cause, fromX);

  /** {type:'pickup', kind, x, y}. Art: kind, taken, t. Taken pickups return on death unless a checkpoint was lit since (consumed). */
  Types.pickup = class extends Base {
    constructor(d, l) { super(d, l); this.taken = false; this.consumed = false; }
    update(dt, game) {
      this.t += dt;
      if (this.taken) return;
      const p = game.player, R = G.CONFIG.pickups.radius;
      if (p.dead || !p.touchesCircle(this.cx, this.cy, R + 6)) return;
      if (G.applyPickup(p, this.kind, game)) {
        this.taken = true;
        G.Audio.play('pickup');
        G.fx.burst(this.cx, this.cy, { count: 14, color: ['#ffffff', '#7dffa8', '#ffe17a'], speed: 160, life: 0.5, size: 3, gravity: 0, glow: true });
      }
    }
  };
  /** Apply a pickup kind to the player. Returns false if it should stay (medkit at full HP). */
  G.applyPickup = (p, kind, game) => {
    const K = G.CONFIG.pickups, b = p.buffs;
    switch (kind) {
      case 'medkit': if (p.hp >= p.maxHp) return false; p.heal(K.medkit); return true;
      case 'heart': p.maxHp += K.heart; p.hp += K.heart; return true;
      case 'shield': b.shield = { hits: K.shield.hits, t: K.shield.time }; return true;
      case 'glider': b.glider = { t: K.glider.time, uses: K.glider.uses }; return true;
      case 'jetpack': b.jetpack = { fuel: K.jetpack.fuel }; return true;
      case 'boots': b.boots = { t: K.boots.time }; return true;
      case 'slowmo': b.slowmo = { t: K.slowmo.time }; return true;
    }
    return false;
  };

  /** {type:'stalactite', x, y (ceiling tile)}. Art: state 'idle'|'shake'|'fall'|'broken', shakeT, t. */
  Types.stalactite = class extends Base {
    constructor(d, l) {
      super(d, l); const S = G.CONFIG.hazards.stalactite;
      this.w = S.w; this.h = S.h; this.home = { x: this.x + (T - S.w) / 2, y: this.y };
      this.reset();
    }
    reset() { this.x = this.home.x; this.y = this.home.y; this.vy = 0; this.state = 'idle'; this.stateT = 0; }
    update(dt, game) {
      const S = G.CONFIG.hazards.stalactite, L = game.level; this.t += dt; this.stateT += dt;
      if (this.state === 'idle') {
        if (actors(game).some((a) => !a.dead && Math.abs((a.cx) - this.cx) < S.triggerX * T && a.cy > this.y && a.cy - this.y < 14 * T)) { this.state = 'shake'; this.stateT = 0; G.Audio.play('crumble'); }
      } else if (this.state === 'shake') {
        if (Math.random() < 0.3) G.fx.dust(this.cx, this.y + 4, 1);
        if (this.stateT >= S.shake) { this.state = 'fall'; this.stateT = 0; }
      } else if (this.state === 'fall') {
        this.vy = Math.min(this.vy + S.gravity * dt, S.maxFall); this.y += this.vy * dt;
        for (const a of actors(game)) if (!a.dead && G.overlap(hb(a), this)) hurtA(a, 'stalactite', this.cx);
        if (L.isSolidTile(Math.floor(this.cx / T), Math.floor((this.y + this.h) / T)) || this.y > L.pxH) {
          this.state = 'broken'; this.stateT = 0;
          G.fx.burst(this.cx, this.y + this.h, { count: 14, color: ['#a8b8c8', '#ffffff'], speed: 180, life: 0.5, gravity: 800 });
        }
      } else if (this.state === 'broken' && this.stateT >= S.respawn) this.reset();
    }
  };

  /** {type:'mine', x, y (tile above the floor)}. Art: state 'armed'|'beep'|'boom'|'spent', stateT. */
  Types.mine = class extends Base {
    constructor(d, l) { super(d, l); this.y += T - 8; this.h = 8; this.x += 6; this.w = T - 12; this.state = 'armed'; this.stateT = 0; }
    reset() { this.state = 'armed'; this.stateT = 0; }
    update(dt, game) {
      const M = G.CONFIG.hazards.mine; this.t += dt; this.stateT += dt;
      if (this.state === 'armed') {
        if (actors(game).some((a) => !a.dead && G.overlap(a, { x: this.x, y: this.y - 4, w: this.w, h: 12 }))) { this.state = 'beep'; this.stateT = 0; G.Audio.play('alarm', { volume: 0.5 }); }
      } else if (this.state === 'beep' && this.stateT >= M.beep) {
        this.state = 'boom'; this.stateT = 0;
        const r = M.radius * T;
        for (const a of actors(game)) if (!a.dead && (a.touchesCircle ? a.touchesCircle(this.cx, this.cy, r) : Math.hypot(a.cx - this.cx, a.cy - this.cy) < r)) hurtA(a, 'mine', this.cx);
        G.fx.burst(this.cx, this.cy, { count: 26, color: ['#ffb36b', '#ff6a3a', '#fff1c0'], speed: 280, life: 0.6, gravity: 300, glow: true });
        G.fx.shake(7, 0.3); G.Audio.play('explosion', { volume: 0.7 });
      } else if (this.state === 'boom' && this.stateT > 0.3) { this.state = 'spent'; this.stateT = 0; }
      else if (this.state === 'spent' && M.rearm && this.stateT >= M.rearm) this.reset();
    }
  };

  /** {type:'geyser', x, y, [period=3], [on=0.8], [h=6]}. Art: phase 'idle'|'warn'|'on', k (0..1 of the phase), colH (px). */
  Types.geyser = class extends Base {
    constructor(d, l) {
      super(d, l); const C = G.CONFIG.hazards.geyser;
      this.period = d.period || C.period; this.onTime = d.on || C.on; this.hT = d.h || C.h; this.offset = d.offset || 0;
      this.colH = this.hT * T; this.phase = 'idle'; this.k = 0;
    }
    get column() { return { x: this.x + 4, y: this.y + T - this.colH, w: T - 8, h: this.colH }; }
    update(dt, game) {
      const C = G.CONFIG.hazards.geyser; this.t += dt;
      const ph = ((game.level.time + this.offset) % this.period + this.period) % this.period;
      const prev = this.phase;
      if (ph < this.onTime) { this.phase = 'on'; this.k = ph / this.onTime; }
      else if (ph > this.period - C.warn) { this.phase = 'warn'; this.k = (ph - (this.period - C.warn)) / C.warn; }
      else { this.phase = 'idle'; this.k = 0; }
      if (this.phase === 'on' && prev !== 'on' && game.isNear(this.cx, this.cy, 600)) G.Audio.play('jumppad', { volume: 0.5 });
      if (this.phase !== 'on') return;
      const v = Math.sqrt(2 * G.CONFIG.player.gravity * this.colH) * C.launch;
      for (const a of actors(game)) {
        if (a.dead || !G.overlap(hb(a), this.column)) continue;
        hurtA(a, 'geyser', this.cx);
        if (!a.dead) { a.vx = a.vx * 0.3; a.vy = -v; a.onGround = false; a.jumping = false; if (a.wallLockT != null) a.wallLockT = 0; }
      }
    }
  };

  /** {type:'collapse', x, y, w, h}: ceiling block, falls once when someone passes under, then is solid floor. Art: state 'idle'|'shake'|'fall'|'landed', stateT. */
  Types.collapse = class extends Base {
    constructor(d, l) { super(d, l); this.w = (d.w || 2) * T; this.h = (d.h || 1) * T; this.solid = true; this.vy = 0; this.state = 'idle'; this.stateT = 0; }
    isSolid() { return this.state === 'idle' || this.state === 'shake' || this.state === 'landed'; }
    update(dt, game) {
      const C = G.CONFIG.hazards.collapse, L = game.level; this.t += dt; this.stateT += dt;
      if (this.state === 'idle') {
        const pad = C.triggerPad * T;
        if (actors(game).some((a) => !a.dead && a.cx > this.x - pad && a.cx < this.x + this.w + pad && a.cy > this.y + this.h && a.cy - this.y < 12 * T)) { this.state = 'shake'; this.stateT = 0; G.Audio.play('rumble'); }
      } else if (this.state === 'shake') {
        if (Math.random() < 0.4) G.fx.dust(this.x + Math.random() * this.w, this.y + this.h, 1);
        if (this.stateT >= C.shake) { this.state = 'fall'; this.stateT = 0; }
      } else if (this.state === 'fall') {
        this.vy = Math.min(this.vy + C.gravity * dt, C.maxFall);
        let dy = this.vy * dt; const step = 4;
        while (dy > 0) {
          const s = Math.min(step, dy); dy -= s;
          const ty = Math.floor((this.y + this.h + s) / T); let hit = false;
          for (let tx = Math.floor(this.x / T); tx <= Math.floor((this.x + this.w - 1) / T); tx++) if (L.isSolidTile(tx, ty)) hit = true;
          if (hit || this.y > L.pxH) { this.y = ty * T - this.h; this.land(game); return; }
          this.y += s;
        }
        for (const a of actors(game)) if (!a.dead && G.overlap(hb(a), this)) {
          hurtA(a, 'collapse', this.cx);
          a.x = a.cx < this.cx ? this.x - a.w - 1 : this.x + this.w + 1; // shoved clear, never crushed
        }
      }
    }
    land(game) {
      this.state = 'landed'; this.stateT = 0; this.vy = 0;
      for (const a of actors(game)) if (!a.dead && G.overlap(a, this)) a.x = a.cx < this.cx ? this.x - a.w - 1 : this.x + this.w + 1;
      G.fx.shake(8, 0.4); G.Audio.play('crateland');
      G.fx.burst(this.cx, this.y + this.h, { count: 24, color: ['#8a7a66', '#c8b8a0'], speed: 220, life: 0.7, gravity: 700 });
    }
  };
})();
