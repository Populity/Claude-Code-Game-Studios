/**
 * Axis-separated AABB movement against the tile grid and dynamic solids.
 * Shared by the player, crates and anything else with a body {x,y,w,h}.
 */
(function () {
  const T = G.TILE;
  const STEP = 8; // max px per sub-step (prevents tunnelling)

  /** Collect solid rects (tiles + dynamic) overlapping rect r. */
  function solidsOverlapping(r, level, ignore, includeOneWay) {
    const out = [];
    const x0 = Math.floor(r.x / T), x1 = Math.floor((r.x + r.w - 0.001) / T);
    const y0 = Math.floor(r.y / T), y1 = Math.floor((r.y + r.h - 0.001) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (level.isSolidTile(tx, ty)) out.push({ x: tx * T, y: ty * T, w: T, h: T, tile: true, tx, ty });
        else if (includeOneWay && level.isOneWayTile(tx, ty)) out.push({ x: tx * T, y: ty * T, w: T, h: 8, oneWay: true, tile: true, tx, ty });
      }
    }
    for (const e of level._dyn || level.dynamicSolids()) {
      if (e === ignore || (ignore && ignore.carriedBy === e)) continue;
      if (e.oneWay && !includeOneWay) continue;
      const er = e.oneWay ? { x: e.x, y: e.y, w: e.w, h: Math.min(e.h, 10) } : e;
      if (G.overlap(r, er)) out.push(e.oneWay ? Object.assign({ oneWay: true, entity: e }, er) : Object.assign({ entity: e }, { x: e.x, y: e.y, w: e.w, h: e.h }));
    }
    return out;
  }

  const Physics = {
    /** True if any non-one-way solid overlaps rect. */
    solidAt(r, level, ignore) {
      return solidsOverlapping(r, level, ignore, false).length > 0;
    },

    /**
     * Move body by (dx, dy). Returns collision info:
     * { hitX, hitY, ground, ceiling, groundEntity, groundTiles: [[tx,ty]] }
     * opts.dropThrough — ignore one-way platforms this move.
     * opts.pusher      — if set, crates hit horizontally are pushed (player only).
     */
    move(body, dx, dy, level, opts = {}) {
      const res = { hitX: false, hitY: false, ground: false, ceiling: false, groundEntity: null, groundTiles: [] };
      // Dynamic solids the body is already inside (a bridge extended into it, a crate respawned
      // onto it) never block it: it can always walk out instead of being snapped across them.
      const stuck = Physics.embeddedIn(body, level);
      const filt = stuck ? (hs) => hs.filter((h) => !h.entity || !stuck.includes(h.entity)) : (hs) => hs;
      // ---- X axis ----
      let remaining = dx;
      while (Math.abs(remaining) > 0.0001) {
        const s = Math.abs(remaining) > STEP ? STEP * Math.sign(remaining) : remaining;
        remaining -= s;
        body.x += s;
        let hits = filt(solidsOverlapping(body, level, body, false));
        if (hits.length && opts.pusher) {
          let pushed = false;
          for (const h of hits) {
            if (h.entity && h.entity.pushable && opts.canPush) {
              const before = h.entity.x;
              h.entity.tryPush(s, level);
              if (h.entity.x !== before) pushed = true;
              res.pushing = h.entity;
            }
          }
          if (pushed) hits = filt(solidsOverlapping(body, level, body, false));
        }
        if (hits.length) {
          if (s > 0) body.x = Math.min(...hits.map((h) => h.x)) - body.w;
          else body.x = Math.max(...hits.map((h) => h.x + h.w));
          res.hitX = true;
          break;
        }
      }
      // ---- Y axis ----
      remaining = dy;
      while (Math.abs(remaining) > 0.0001) {
        const s = Math.abs(remaining) > STEP ? STEP * Math.sign(remaining) : remaining;
        remaining -= s;
        const prevBottom = body.y + body.h;
        body.y += s;
        let hits = filt(solidsOverlapping(body, level, body, s > 0 && !opts.dropThrough));
        if (s > 0) {
          // A rising one-way platform moved up before this body moved: accept it if the body was
          // above where the platform top was at the start of the frame (no fall-through on lifts).
          hits = hits.filter((h) => !h.oneWay || prevBottom <= h.y + 0.5 + (h.entity && h.entity.dy < 0 ? -h.entity.dy : 0));
        } else {
          hits = hits.filter((h) => !h.oneWay);
        }
        if (hits.length) {
          if (s > 0) {
            const top = Math.min(...hits.map((h) => h.y));
            body.y = top - body.h;
            res.ground = true;
            for (const h of hits) {
              if (Math.abs(h.y - top) > 0.5) continue;
              if (h.entity) res.groundEntity = h.entity;
              if (h.tile) res.groundTiles.push([h.tx, h.ty]);
            }
          } else {
            body.y = Math.max(...hits.map((h) => h.y + h.h));
            res.ceiling = true;
          }
          res.hitY = true;
          break;
        }
      }
      return res;
    },

    /** Non-one-way dynamic solids the body currently overlaps, or null. */
    embeddedIn(body, level) {
      let out = null;
      for (const e of level._dyn || level.dynamicSolids()) {
        if (e === body || e.oneWay || !G.overlap(body, e)) continue;
        (out = out || []).push(e);
      }
      return out;
    },

    /**
     * Push a body out of dynamic solids it is embedded in, along the shortest free axis
     * (max `maxPush` px). Returns false if no free spot was found (the body is crushed).
     */
    depenetrate(body, level, maxPush = 40) {
      const stuck = Physics.embeddedIn(body, level);
      if (!stuck) return true;
      const cands = [];
      for (const e of stuck) {
        cands.push([0, e.y - body.h - body.y], [0, e.y + e.h - body.y], [e.x - body.w - body.x, 0], [e.x + e.w - body.x, 0]);
      }
      cands.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));
      for (const [ox, oy] of cands) {
        if (Math.abs(ox) + Math.abs(oy) > maxPush) break;
        const r = { x: body.x + ox, y: body.y + oy, w: body.w, h: body.h };
        if (!Physics.solidAt(r, level, body)) { body.x = r.x; body.y = r.y; return true; }
      }
      return false;
    },

    /** Is there ground directly below the body (1px probe)? Returns the ground hit or null. */
    probeGround(body, level) {
      const r = { x: body.x, y: body.y + body.h, w: body.w, h: 1 };
      const hits = solidsOverlapping(r, level, body, true).filter((h) => !h.oneWay || Math.abs(h.y - (body.y + body.h)) < 1);
      return hits.length ? hits : null;
    },

    /**
     * Wall contact on side dir (-1 left, +1 right), static solids & doors only (not crates/platforms).
     * Ice tiles are too slick to cling to: they never count as a wall (no slide, no wall jump).
     */
    wallAt(body, dir, level) {
      const r = { x: dir > 0 ? body.x + body.w : body.x - 1, y: body.y + 4, w: 1, h: body.h - 10 };
      return solidsOverlapping(r, level, body, false).some((h) => (h.tile && !(level.isIceTile && level.isIceTile(h.tx, h.ty))) || (h.entity && h.entity.climbable));
    },

    /**
     * Tile line-of-sight (grid DDA, Amanatides–Woo): true if the segment (x0,y0)→(x1,y1) crosses
     * no solid tile. Dynamic solids are ignored (doors/crates do not block sight or ropes).
     * `skip(tx,ty)` may exempt tiles (e.g. the anchor's own tile).
     */
    lineClear(level, x0, y0, x1, y1, skip) {
      let tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
      const ex = Math.floor(x1 / T), ey = Math.floor(y1 / T);
      const dx = x1 - x0, dy = y1 - y0;
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
      const tdx = dx !== 0 ? Math.abs(T / dx) : Infinity, tdy = dy !== 0 ? Math.abs(T / dy) : Infinity;
      let tmx = dx !== 0 ? ((sx > 0 ? (tx + 1) * T - x0 : x0 - tx * T) / Math.abs(dx)) : Infinity;
      let tmy = dy !== 0 ? ((sy > 0 ? (ty + 1) * T - y0 : y0 - ty * T) / Math.abs(dy)) : Infinity;
      for (let guard = 0; guard < 512; guard++) {
        if (level.isSolidTile(tx, ty) && !(skip && skip(tx, ty))) return false;
        if (tx === ex && ty === ey) return true;
        if (tmx < tmy) { if (tmx > 1) return true; tmx += tdx; tx += sx; } else { if (tmy > 1) return true; tmy += tdy; ty += sy; }
      }
      return true;
    },
  };

  G.Physics = Physics;
})();
