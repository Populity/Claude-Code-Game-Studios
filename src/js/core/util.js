/**
 * Shared math / helper utilities and global registries.
 */
window.G = window.G || {};
G.Art = G.Art || {};
G.levels = G.levels || {};

G.TILE = G.CONFIG.TILE;
G.VIEW_W = G.CONFIG.VIEW_W;
G.VIEW_H = G.CONFIG.VIEW_H;

/** Clamp v into [a, b]. */
G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Linear interpolation. */
G.lerp = (a, b, t) => a + (b - a) * t;
/** Move v toward target by at most step. */
G.approach = (v, target, step) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);
/** Frame-rate independent exponential smoothing factor. */
G.damp = (rate, dt) => 1 - Math.exp(-rate * dt);
G.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
G.easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
G.easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** AABB overlap test for {x,y,w,h}. */
G.overlap = (a, b) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Deterministic PRNG (mulberry32). Returns a function producing [0,1).
 * Use for anything that must look the same every run (decor scatter, puzzles).
 */
G.rng = (seed) => {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Stable string hash → uint32 (for seeding from level ids). */
G.hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Register a level definition (called from src/js/levels/*.js). */
G.registerLevel = (def) => { G.levels[def.id] = def; };

/** Safe localStorage wrappers — storage may be unavailable (private mode, previews). */
G.store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  },
};

/** Rounded-rect path helper used by UI and art. */
G.roundRect = (ctx, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};
