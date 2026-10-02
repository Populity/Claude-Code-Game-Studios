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

  // ---- Chapter 2 movement (docs/chapter2-spec.md §2) ----
  dash: {
    speed: 620,             // px/s along the (normalised) 8-way direction
    time: 0.16,             // s, gravity off
    endKeep: 0.55,          // velocity multiplier when the dash ends
    charges: 1,             // max charges; refilled on landing / wall slide / dashcrystal
    cooldown: 0.12,         // s after a dash ends before another may start
    refillDelay: 0.08,      // s after a dash ends before ground/wall contact refills it
    freezeFrames: 2,        // hit-stop frames at dash start (game.js), 0 = off
    shake: 3,               // screen-shake intensity at dash start (px)
    jumpCancel: true,       // jump during a grounded/wall-touching dash = dash-jump (keeps speed)
    overspeedTime: 0.35,    // s after a dash / swing release / lift jump where overspeed decays slowly
    overspeedDecel: 520,    // px/s^2 air decel above runSpeed while overspeedTime is active
  },
  momentum: {
    inheritX: 1.0,          // share of a moving platform's horizontal velocity given on jump / walk-off
    inheritUp: 1.0,         // share of its upward velocity (downward motion never weakens a jump)
    conveyorInherit: 1.0,   // share of conveyor speed kept when jumping off a belt
  },
  surface: {
    iceAccel: 0.25,         // ground accel multiplier on ice 'I'
    iceDecel: 0.08,         // ground decel multiplier on ice
    conveyorSpeed: 120,     // px/s carried by '{' (left) and '}' (right)
  },
  swing: {
    reach: 4,               // default anchor.len, tiles
    minLen: 40,             // px, shortest rope
    ropeOffsetY: 10,        // px below her head where the rope attaches
    gravity: 2100,          // px/s^2 while swinging
    pump: 900,              // px/s^2 tangential accel from left/right (pumping)
    damping: 0.06,          // 1/s velocity damping (air drag), 0 = lossless
    maxSpeed: 900,          // px/s cap while attached
    reelStep: 1,            // tiles per up/down press
    reelSpeed: 260,         // px/s rope length change
    releaseBoostY: -170,    // px/s added upward on jump-release
    releaseBoostX: 1.08,    // horizontal multiplier on jump-release
    reattachDelay: 0.2,     // s before another anchor may be grabbed
    wallDetachSpeed: 260,   // px/s: hitting a wall faster than this cuts the rope
    blockGrace: 0.05,       // s a tile may cut the rope line before it detaches
  },
  wind: {
    strength: 900,          // default px/s^2
    drag: 3.0,              // 1/s: horizontal wind velocity decays toward strength/drag terminal speed
    groundGrip: 0.5,        // horizontal wind accel multiplier while standing
    warn: 0.45,             // s of warning before a pulsing zone turns on
    ramp: 0.2,              // s fade in/out of the force
    crateFactor: 0.6,       // crates are heavier: wind accel multiplier
  },
  dashcrystal: { regrow: 2.5, radius: 14 },
  fallplat: { shake: 0.5, gravity: 1800, maxFall: 800, fallTime: 1.6, respawn: 3.0 },
  sentinel: {
    range: 7,               // tiles, detection radius
    speed: 170,             // px/s chase speed
    accel: 520,             // px/s^2 steering accel (inertia: sharp moves escape it)
    patrolSpeed: 60,        // px/s along its path
    returnSpeed: 120,       // px/s heading home
    alertTime: 0.45,        // s telegraph before a chase (eye locks on, no movement)
    chaseTime: 4.0,         // s max chase
    loseTime: 1.0,          // s without line of sight before giving up
    cooldown: 1.0,          // s after returning home before it can chase again
    stunTime: 3.0,          // s stunned after a laser hit (falls, harmless)
    hover: 32,              // px: keeps at least this much air below its centre
    hitR: 11,               // px kill radius (art draws ~16 px: the hitbox is fair)
    bodyR: 12,              // px collision half-size vs tiles
    gravity: 1400,          // px/s^2 while stunned
  },

  crate: {
    size: 32, gravity: 2100, maxFall: 900,
    friction: 1500,         // px/s^2 slide decel after a push (≈4 px slide at pushSpeed)
    dashKick: 300,          // px/s given to a crate a dash slams into (≈1 tile slide)
    maxSlide: 400,          // px/s cap on crate horizontal speed
  },

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
