/**
 * Level: parses a level definition (ASCII map + entity list) into a runtime world.
 *
 * Map characters (one char = one 32px tile):
 *   '.' or ' '  empty            '#' solid ground          '=' one-way platform
 *   '^' floor spikes             'v' ceiling spikes        '~' acid (deadly liquid)
 *   'X' crumbling block          'P' player start          'C' checkpoint
 *   'E' level exit               'B' pushable crate        '*' data shard (collectible)
 *   'J' jump pad
 * Everything else (doors, levers, terminals, lasers…) is declared in def.entities
 * using TILE coordinates. See docs/level-format.md.
 */
(function () {
  const T = G.TILE;
  const TILE = { EMPTY: 0, SOLID: 1, ONEWAY: 2, SPIKE_UP: 3, SPIKE_DOWN: 4, ACID: 5, CRUMBLE: 6 };
  G.TILE_CODES = TILE;

  const CHAR_TILE = {
    '#': TILE.SOLID, '=': TILE.ONEWAY, '^': TILE.SPIKE_UP, 'v': TILE.SPIKE_DOWN,
    '~': TILE.ACID, 'X': TILE.CRUMBLE,
  };

  class Level {
    /** @param {object} def level definition from G.levels */
    constructor(def) {
      this.def = def;
      this.id = def.id;
      this.biome = def.biome || 'desert';
      const rows = def.map;
      this.h = rows.length;
      this.w = Math.max(...rows.map((r) => r.length));
      this.rows = rows.map((r) => r.padEnd(this.w, '.'));
      this.pxW = this.w * T;
      this.pxH = this.h * T;
      this.tiles = new Uint8Array(this.w * this.h);
      this.crumbles = new Map(); // idx -> {state, t}
      this.entities = [];
      this.byId = {};
      this.spawn = { x: 2 * T, y: 2 * T };
      this.shardTotal = 0;
      this.time = 0;
      this.version = 0; // bump when tile solidity changes (art caches may listen)

      let shardIndex = 0;
      for (let ty = 0; ty < this.h; ty++) {
        for (let tx = 0; tx < this.w; tx++) {
          const ch = this.rows[ty][tx];
          const code = CHAR_TILE[ch] || TILE.EMPTY;
          this.tiles[ty * this.w + tx] = code;
          if (code === TILE.CRUMBLE) this.crumbles.set(ty * this.w + tx, { state: 'idle', t: 0, tx, ty });
          switch (ch) {
            case 'P': this.spawn = { x: tx * T + (T - G.CONFIG.player.w) / 2, y: (ty + 1) * T - G.CONFIG.player.h }; break;
            case 'C': this.add({ type: 'checkpoint', x: tx, y: ty }); break;
            case 'E': this.add({ type: 'exit', id: 'exit', x: tx, y: ty }); break;
            case 'B': this.add({ type: 'crate', x: tx, y: ty }); break;
            case '*': this.add({ type: 'shard', x: tx, y: ty, index: shardIndex++ }); break;
            case 'J': this.add({ type: 'jumppad', x: tx, y: ty }); break;
          }
        }
      }
      this.shardTotal = shardIndex;
      for (const e of def.entities || []) this.add(Object.assign({}, e));
      for (const tr of def.triggers || []) this.add(Object.assign({ type: 'trigger' }, tr));
      for (const d of def.decor || []) this.add(Object.assign({ type: 'deco' }, d));
      /** Crates never get added/removed at runtime: cached to avoid per-frame filters. */
      this.crates = this.entities.filter((e) => e.type === 'crate');
      this.buildSignalGraph();
    }

    /** Instantiate an entity from data (tile coords) and index it. */
    add(data) {
      const Ctor = G.EntityTypes[data.type];
      if (!Ctor) { console.warn('Unknown entity type', data.type, 'in level', this.id); return null; }
      const e = new Ctor(data, this);
      this.entities.push(e);
      if (e.id) {
        if (this.byId[e.id] && e.type !== 'exit') console.warn('Duplicate entity id', e.id, 'in level', this.id);
        this.byId[e.id] = e;
      }
      return e;
    }

    buildSignalGraph() {
      this.sourcesFor = {};
      for (const e of this.entities) {
        for (const tid of e.targets || []) {
          (this.sourcesFor[tid] = this.sourcesFor[tid] || []).push(e);
          if (!this.byId[tid]) console.warn('Signal target not found:', tid, 'in level', this.id);
        }
      }
    }

    /** Recompute receiver power from sources. Receivers default to needing ALL their sources. */
    resolveSignals() {
      for (const id in this.sourcesFor) {
        const r = this.byId[id];
        if (!r) continue;
        const src = this.sourcesFor[id];
        const on = r.need === 'any' ? src.some((s) => s.active) : src.every((s) => s.active);
        r.powered = r.invert ? !on : on;
      }
    }

    tileCode(tx, ty) {
      if (tx < 0 || tx >= this.w) return TILE.SOLID;
      // Above the map, walls that touch the top row continue upward, so a jump pad or a
      // wall-jump can never carry her over a wall off-screen. Below the map is open (fall = death).
      if (ty < 0) return this.tiles[tx] === TILE.SOLID ? TILE.SOLID : TILE.EMPTY;
      if (ty >= this.h) return TILE.EMPTY;
      return this.tiles[ty * this.w + tx];
    }

    /** Raw map character (for decor). */
    charAt(tx, ty) {
      if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) return tx < 0 || tx >= this.w ? '#' : '.';
      return this.rows[ty][tx];
    }

    isSolidTile(tx, ty) {
      const c = this.tileCode(tx, ty);
      if (c === TILE.SOLID) return true;
      if (c === TILE.CRUMBLE) {
        const cr = this.crumbles.get(ty * this.w + tx);
        return !cr || cr.state !== 'gone';
      }
      return false;
    }

    isOneWayTile(tx, ty) { return this.tileCode(tx, ty) === TILE.ONEWAY; }

    /** Dynamic solid rects (closed doors, active bridges, crates, platforms). */
    dynamicSolids() {
      const out = [];
      for (const e of this.entities) if (e.solid && e.isSolid()) out.push(e);
      return out;
    }

    /** Called when a body stands on tile (tx,ty). */
    touchCrumble(tx, ty) {
      const cr = this.crumbles.get(ty * this.w + tx);
      if (cr && cr.state === 'idle') { cr.state = 'shaking'; cr.t = 0; G.Audio.play('crumble'); }
    }

    updateCrumbles(dt, bodies) {
      const C = G.CONFIG.crumble;
      for (const cr of this.crumbles.values()) {
        cr.t += dt;
        if (cr.state === 'shaking' && cr.t >= C.delay) {
          cr.state = 'gone'; cr.t = 0; this.version++;
          G.fx.burst(cr.tx * T + T / 2, cr.ty * T + T / 2, { count: 10, color: G.Art.Decor && G.Art.Decor.debrisColor ? G.Art.Decor.debrisColor(this) : '#8a7a66', speed: 120, gravity: 900, life: 0.8, size: 4 });
        } else if (cr.state === 'gone' && cr.t >= C.respawn) {
          const rect = { x: cr.tx * T, y: cr.ty * T, w: T, h: T };
          if (!bodies.some((b) => G.overlap(b, rect))) { cr.state = 'idle'; cr.t = 0; this.version++; }
        }
      }
    }

    /** Shake offset for crumble tiles (for art). */
    crumbleState(tx, ty) { return this.crumbles.get(ty * this.w + tx) || null; }

    /** Is the rect touching a deadly tile? Hitboxes are inset to be forgiving. */
    hazardAt(r) {
      const x0 = Math.floor(r.x / T), x1 = Math.floor((r.x + r.w - 1) / T);
      const y0 = Math.floor(r.y / T), y1 = Math.floor((r.y + r.h - 1) / T);
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const c = this.tileCode(tx, ty);
          let hz = null;
          if (c === TILE.SPIKE_UP) hz = { x: tx * T + 5, y: ty * T + 16, w: T - 10, h: 16 };
          else if (c === TILE.SPIKE_DOWN) hz = { x: tx * T + 5, y: ty * T, w: T - 10, h: 14 };
          else if (c === TILE.ACID) hz = { x: tx * T, y: ty * T + 10, w: T, h: T - 10 };
          if (hz && G.overlap(r, hz)) return c === TILE.ACID ? 'acid' : 'spikes';
        }
      }
      return null;
    }
  }

  G.Level = Level;
})();
