/**
 * TESSERA — gameplay tuning values.
 * All feel/physics numbers live here (data-driven, never hardcoded in systems).
 * Units: pixels and seconds. One tile = TILE px.
 */
window.G = window.G || {};

G.CONFIG = {
  TILE: 32,
  VIEW_W: 960,
  VIEW_H: 540,

  player: {
    w: 20,
    h: 42,
    runSpeed: 250,          // max horizontal speed, px/s
    groundAccel: 2400,      // px/s^2
    groundDecel: 2800,
    airAccel: 1700,
    airDecel: 900,
    gravity: 2100,
    maxFall: 900,
    jumpVelocity: 700,      // initial upward speed
    jumpCut: 0.45,          // vy multiplier when jump is released early
    coyoteTime: 0.1,
    jumpBuffer: 0.13,
    wallSlideMax: 140,      // max fall speed while sliding on a wall
    wallJumpVx: 290,
    wallJumpVy: 650,
    wallJumpLock: 0.16,     // seconds of reduced air control after wall jump
    wallStickTime: 0.12,    // grace to press away from the wall and still wall-jump
    pushSpeed: 110,         // speed while pushing a crate
    interactRange: 40,
    jumpPadVelocity: 1050,
    cornerCorrection: 6,    // px: jumping into a ceiling corner by ≤ this slides around it
    ledgeAssist: 8,         // px: missing a ledge top by ≤ this pops her up onto it
    ledgeAssistMinVy: 120,  // only when not rising faster than this (px/s)
    crushPush: 40,          // px: max push-out from a dynamic solid before it counts as a crush
  },

  crate: { size: 32, gravity: 2100, maxFall: 900 },

  crumble: { delay: 0.45, respawn: 3.0 },

  death: { respawnDelay: 1.0 },

  camera: { lookAhead: 70, smooth: 6, verticalSmooth: 5, deadzoneY: 40 },

  /**
   * Reference reach numbers for level designers (derived from the values above,
   * see tools/validate-levels.js which recomputes them):
   *   max jump height ≈ v²/2g ≈ 116px ≈ 3.6 tiles  → 3 tiles is comfortable
   *   flat gap jumpable ≈ 2v/g * runSpeed ≈ 166px ≈ 5.2 tiles → 4 comfortable, 5 hard
   */
};
