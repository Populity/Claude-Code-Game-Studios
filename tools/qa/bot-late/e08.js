const {emit}=require('./lib.js'); const B=require('./b08.js');
B.def.decor=[
  {kind:'arch',x:8,y:25},{kind:'vines',x:5,y:25},{kind:'statue',x:19,y:25},{kind:'broken_pillar',x:23,y:25},
  {kind:'vines',x:34,y:19},{kind:'pillar',x:47,y:10},{kind:'glyph_wall',x:52,y:10},
  {kind:'broken_pillar',x:61,y:10},{kind:'vines',x:76,y:10},{kind:'statue',x:79,y:10},
  {kind:'glyph_wall',x:84,y:13},{kind:'vines',x:88,y:18},{kind:'helmet',x:93,y:18},{kind:'broken_pillar',x:96,y:18},
  {kind:'arch',x:110,y:25},{kind:'vines',x:125,y:13},{kind:'pillar',x:133,y:25,layer:'back'},{kind:'glyph_wall',x:139,y:25},
  {kind:'vines',x:148,y:9},{kind:'broken_pillar',x:163,y:17},{kind:'statue',x:190,y:8},{kind:'arch',x:195,y:8},{kind:'vines',x:186,y:8},
];
const header=`/**
 * l08 «Механический лес» — Глава 1 · 1-8 (ruins, overgrown). 200×30 tiles. ~3.5 min first play.
 * ROUTE (QA): S0 start (x3) → S1 jump-pad teach: pad x27 → cliff top (row 20)
 *  → S2 doorway x40 into the pad well (pads x42-43, walls x40/x45, 4 wide): pad launch + 3-4 wall jumps,
 *    exit right on top (row 11). C x50.
 *  → S3 crumbling bridges row 11 over spikes: wait on the plateau until saw A (x56) rises, run X54-58,
 *    jump to rest pillar x61-62; wait for saw B (x66, counter-phase) to rise, run X63-68, jump to x71. C x73.
 *  → S4 grove (row 19): helmet + sign (trigger l08_helmet), then l08_doubt. C x101 (before puzzle).
 *  → S5 HALL PUZZLE: drop to the floor (pad x106 returns to grove). Pad x115 in the shaft between pillar
 *    x113 and wall x118 → wall-jump up, hop the lip (x118,row15) onto the shelf. Push the crate (x124)
 *    RIGHT off the shelf; on the floor push it right into the 2-wide slot x129-130 (plate) — it drops in
 *    and stays. Door x136 opens. Plate is 5 tiles from the door, so the player alone cannot hold it open.
 *    Crate pushed left falls into acid x120-122 and respawns on the shelf (no soft-lock).
 *    Terminal x141: LIGHTS 4×4 (seeded, presses 5) — any lights-out solution. Powers lift x137 → row 10.
 *  → S6 corridor C x146 → pad chain: pads x156 → x164 (C x162) → x173 → crumbling ledge X178-181 → exit x195.
 *    Saw x168 sweeps rows 8-15 through the apex of the 2nd arc: wait on the left of pillar 2, launch when the saw has just dropped (≈70% of its 6.4s cycle is safe). Hold → through each flight.
 * SHARDS: (40,13) window in the well's left wall; (64,7) full jump off the crumbling bridge;
 *  (180,6) above the crumbling ledge — full jump while it collapses.
 * Dialogue: l08_start (start), l08_helmet, l08_doubt (triggers), l08_end (trigger near exit).
 */`;
emit('/home/user/Claude-Code-Game-Studios/src/js/levels/l08.js',header,B.def,B.g);
