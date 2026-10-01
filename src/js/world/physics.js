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
      // ---- X axis ----
      let remaining = dx;
      while (Math.abs(remaining) > 0.0001) {
        const s = Math.abs(remaining) > STEP ? STEP * Math.sign(remaining) : remaining;
        remaining -= s;
        body.x += s;
        let hits = solidsOverlapping(body, level, body, false);
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
          if (pushed) hits = solidsOverlapping(body, level, body, false);
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
        let hits = solidsOverlapping(body, level, body, s > 0 && !opts.dropThrough);
        if (s > 0) {
          hits = hits.filter((h) => !h.oneWay || prevBottom <= h.y + 0.5);
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

    /** Is there ground directly below the body (1px probe)? Returns the ground hit or null. */
    probeGround(body, level) {
      const r = { x: body.x, y: body.y + body.h, w: body.w, h: 1 };
      const hits = solidsOverlapping(r, level, body, true).filter((h) => !h.oneWay || Math.abs(h.y - (body.y + body.h)) < 1);
      return hits.length ? hits : null;
    },

    /** Wall contact on side dir (-1 left, +1 right), static solids & doors only (not crates/platforms). */
    wallAt(body, dir, level) {
      const r = { x: dir > 0 ? body.x + body.w : body.x - 1, y: body.y + 4, w: 1, h: body.h - 10 };
      return solidsOverlapping(r, level, body, false).some((h) => h.tile || (h.entity && h.entity.climbable));
    },
  };

  G.Physics = Physics;
})();
