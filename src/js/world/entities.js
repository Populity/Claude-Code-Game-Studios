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
    }
    update(dt, game) {
      super.update(dt);
      this.pushedT = Math.max(0, (this.pushedT || 0) - dt);
      const C = G.CONFIG.crate;
      this.vy = Math.min(this.vy + C.gravity * dt, C.maxFall);
      const pre = this.vy;
      const r = G.Physics.move(this, 0, this.vy * dt, game.level);
      if (r.ground) {
        if (!this.onGround && pre > 300) { G.Audio.play('crateland'); G.fx.dust(this.cx, this.y + this.h, 6); }
        this.vy = 0;
      }
      this.onGround = r.ground;
      this.groundEntity = r.groundEntity;
      for (const [tx, ty] of r.groundTiles) game.level.touchCrumble(tx, ty);
      // don't sink into the player: rest on their head instead
      const p = game.player;
      if (!p.dead && G.overlap(this, p) && this.y < p.y) { this.y = p.y - this.h; this.vy = 0; this.onGround = true; }
      if (this.y > game.level.pxH + 64 || game.level.hazardAt({ x: this.x + 6, y: this.y + 6, w: this.w - 12, h: this.h - 6 }) === 'acid') {
        G.fx.burst(this.cx, Math.min(this.cy, game.level.pxH), { count: 12, color: '#a08060', speed: 150, life: 0.6 });
        this.x = this.snapshot.x; this.y = this.snapshot.y; this.vy = 0;
        G.Audio.play('respawnCrate');
      }
    }
    restore() { this.x = this.snapshot.x; this.y = this.snapshot.y; this.vy = 0; }
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
      if (this.phase === 'on' && !p.dead && G.overlap({ x: p.x + 3, y: p.y + 4, w: p.w - 6, h: p.h - 6 }, this.beam)) p.kill('laser');
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
        if (dx * dx + dy * dy < (this.r - 3) * (this.r - 3)) p.kill('saw');
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

  // ------------------------------------------------------------------ deco (static prop, drawn by G.Art.Decor.drawProp)
  Types.deco = class extends Entity {
    constructor(d, l) { super(d, l); this.layer = d.layer || 'back'; }
    update() {}
  };
})();
