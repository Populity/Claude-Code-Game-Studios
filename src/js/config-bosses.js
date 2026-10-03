/**
 * TESSERA — boss tuning (Chapter 2 bosses). Loaded right after config.js.
 * Logic: src/js/world/bosses.js · Art: src/js/art/bosses.js · Test arena: ?level=bossarena
 * Units: pixels and seconds unless a name ends in `Tiles`. Per-phase arrays are indexed by phase (0..2).
 * Design intent: SLOW bosses, deadly projectiles, long readable telegraphs (0.6–1 s), and one
 * logical "exchange" per boss that the player must exploit to deal damage.
 */
window.G = window.G || {};
G.CONFIG = G.CONFIG || {};
G.CONFIG.bosses = {
  common: {
    introTime: 3.4,          // s: camera focus + rumble + roar; player frozen
    introRoarAt: 1.6,        // s into the intro when the roar (explosion SFX + big shake) hits
    letterbox: 46,           // px per bar at full intro
    camZoomHold: 0.6,        // s the camera lingers on the boss after the intro
    reengageDelay: 1.6,      // s after a respawn before the boss attacks again
    hurtTime: 0.7,           // s of hurt flash / stagger after a hit
    phaseShiftTime: 2.0,     // s of invulnerable rage between phases (roar, shake)
    deathTime: 3.0,          // s of the death explosion sequence before `active = true`
    projectilePool: 28,      // pooled bossproj entities per boss
    wakePad: 0,              // tiles of padding added to the arena rect for waking
    strikeMinSpeed: 420,     // px/s: fallback "strike" if the engine has no dash state yet
    strikeGrace: 0.24,       // s after a dash STARTS during which contact still counts as a strike
    introZoom: 1.08,         // game.cineFocus zoom during the intro (bosses are huge: keep it gentle)
    killCause: 'boss',
  },

  // 1 — «Архивариус» (l11). Shield fed by 3 tablet-pillars. Bait its sweeping laser into the
  // pillars (they block the beam and overheat), shield drops, dash-crystals appear, dash into the core.
  archivist: {
    hp: 3,                   // one core strike per phase
    bodyR: 58,               // px shield radius (touching the shield while it is up kills)
    coreR: 22,               // px core hit radius when exposed
    hoverTiles: 8.5,         // tiles above the floor while fighting
    exposeHoverTiles: 6.5,   // tiles above the floor while its shield is down (sinks, stunned)
    driftSpeed: [34, 44, 56],          // px/s horizontal drift toward the player
    attackGap: [2.4, 1.9, 1.5],        // s between attacks
    pattern: [['orbs', 'laser', 'laser'], ['laser', 'orbs', 'laser'], ['laser', 'orbs', 'laser', 'laser']],
    // glyph orbs
    orbTelegraph: [1.0, 0.85, 0.7],    // s of charge glow before the volley
    orbCount: [2, 3, 4],
    orbSpeed: [85, 100, 115],          // px/s — slow, but they home
    orbTurn: [1.1, 1.35, 1.6],         // rad/s max steering
    orbLife: 7.0,
    orbR: 11,
    orbSpacing: 0.35,                  // s between orbs in a volley
    // sweeping laser
    laserTelegraph: [1.0, 0.85, 0.7],  // s: thin aim line tracks the player, then locks
    laserLockTime: 0.25,               // s the aim stays frozen (visible) before firing
    laserHold: 0.55,                   // s the beam holds on the locked angle
    laserSweep: [0.9, 1.15, 1.4],      // rad swept after the hold
    laserSweepSpeed: [0.75, 0.95, 1.15], // rad/s
    laserWidth: 14,                    // px kill width
    laserRange: 1400,
    // pillars
    pillarHeat: 0.35,        // s of beam contact that overheats a pillar (it collapses when the beam ends)
    pillarRegrow: true,      // burnt pillars rise again at each new phase and after a player death
    // exposure
    exposeTime: [7.0, 6.0, 5.0],       // s the core stays open
    crystalOffsets: [[-4, -3.5], [4, -3.5], [0, -6]], // tiles from the boss's floor point (dash path)
  },

  // 2 — «Колосс Бурь» (l12). Slow walker: arcing shells + stomp shockwaves. Exchange: a lever flips
  // a fan that blows its own shells back into its vent (open while it reloads), or swing over it and
  // rip out the valve on its back vent while it reloads.
  colossus: {
    hp: 6,                   // 2 hits per phase
    hitsPerPhase: 2,
    w: 150, h: 220,          // px body box (feet at the bottom)
    walkSpeed: [26, 34, 44], // px/s
    turnTime: 1.3,           // s to turn around (it is slow!)
    rangeTiles: 9,           // walks at most this far from home
    salvo: [3, 3, 4],        // shells per salvo
    shellTelegraph: [1.0, 0.85, 0.7],  // s cannon glow + landing reticle before each shell
    shellFlight: [1.5, 1.35, 1.2],     // s ballistic flight time
    shellGravity: 900,
    shellR: 13,
    blastR: 54,              // px explosion kill radius on impact
    blastTime: 0.35,
    stompTelegraph: [1.0, 0.85, 0.7],
    shockSpeed: [260, 300, 340],       // px/s along the floor
    shockH: 26,              // px height of the shockwave (jump over it)
    shockLife: 2.6,
    reloadTime: [3.6, 3.2, 2.8],       // s vent open after a salvo (the vulnerable window)
    pattern: [['salvo', 'stomp'], ['salvo', 'stomp', 'stomp'], ['salvo', 'stomp', 'salvo']],
    attackGap: [1.8, 1.5, 1.2],
    bodyKill: true,          // touching its legs/body kills
    // fans (level-placed bossproj kind 'fan', powered by a lever)
    fanPush: 120,            // px/s drift applied to the player inside a powered fan zone
    deflectFlight: 1.0,      // s: a fan-caught shell flies back to the vent in this time
    // back valve
    valveR: 22,              // px grab radius around the back vent valve
  },

  // 3 — «Первый Страж» (l13). Core turret with rotating beam arms; spawns sentinel seekers.
  // Exchange: lure seekers into its beams → each drops an energy `cell` → 3 sockets → dash the core.
  warden: {
    hp: 4,                   // 3 sockets + the final strike
    coreR: 30,
    shellR: 64,              // px armour radius (touching it kills while closed)
    arms: [2, 3, 4],         // beam arms (phase = sockets filled)
    armLen: 13,              // tiles
    armSpeed: [0.42, 0.52, 0.62],      // rad/s
    armWidth: 12,
    armTelegraph: 0.9,       // s arms flicker before re-igniting after a pause
    armPause: [2.6, 2.2, 1.8],         // s arms off every cycle
    armOn: [6.0, 6.5, 7.0],            // s arms on every cycle
    spawnEvery: [5.5, 5.0, 4.5],       // s between seeker spawns
    maxSeekers: [1, 2, 2],
    seekerSpeed: [120, 135, 150],      // px/s (slower than Mira's run 250)
    seekerAccel: 340,
    seekerR: 12,
    seekerSpawnTelegraph: 0.9,         // s hatch glow before a seeker launches
    cellItem: 'cell',
    exposeTime: 5.0,          // s the core is open once all sockets are filled
    closedTime: 4.0,          // s it closes again if the strike is missed
  },
};
