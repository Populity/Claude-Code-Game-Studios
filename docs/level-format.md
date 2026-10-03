# TESSERA: Technical Contracts

This is the shared reference for everyone building on the engine (level designers, artists,
audio, writer, QA). The engine lives in `src/js/` (plain `<script>` files that share a global
`G` namespace, with no modules and no build step). Open `src/index.html` through any static
server.

- Run: `npx http-server src -p 8080`, then open `http://localhost:8080/`.
- Jump straight into a level: `?level=l03` (by id) or `?level=4` (campaign index).
  `?level=sandbox` opens the mechanics test room.
- Play a cutscene: `?cutscene=intro`.
- Headless QA screenshot: `node tools/qa/shot.js "level=l03" out.png [script.json]`.
- Validate levels: `node tools/validate-levels.js`.

View: 960×540 logical px, 16:9, letterboxed. **Tile = 32 px.** Levels are usually 17–40
rows tall and 120–220 columns wide.

---

## 1. Level files (`src/js/levels/<id>.js`)

```js
G.registerLevel({
  id: 'l03',
  chapter: 'Глава 1 · Тессера',     // shown in the level banner
  chapterShort: '1-3',              // shown in level select
  title: 'Ущелье ветров',
  biome: 'canyon',                  // ship|wreck|desert|canyon|ruins|caves|crystal|tower
  variant: undefined,               // optional decor variant, e.g. 'overgrown' for ruins
  music: 'canyon',                  // optional; defaults to biome
  drone: true,                      // ЛЮМ follows the player; false = absent;
                                    // {broken:true, x, y, wakeOn:'socketId'} = lies broken until that source is active
  objective: 'Найдите путь через ущелье', // initial objective text (HUD)
  startDialogue: 'l03_start',       // script id played ~0.6s after the level starts
  map: [ /* array of equal-length strings, see legend */ ],
  entities: [ /* see §2, TILE coordinates */ ],
  triggers: [ /* see §2 trigger */ ],
  decor: [ /* see §3 props, TILE coordinates */ ],
});
```

### Map legend (one char = one tile)

| Char | Meaning |
|---|---|
| `.` | empty |
| `#` | solid ground (the biome decides the look, auto-tiled) |
| `=` | one-way platform (jump up through it; ↓+Jump drops through) |
| `^` | floor spikes (deadly). Place on the floor row above solid ground |
| `v` | ceiling spikes (deadly) |
| `~` | acid / deadly liquid (fill pools 1–2 rows deep) |
| `X` | crumbling block: falls 0.45s after being stood on, returns after 3s |
| `P` | player start (exactly one). The player stands ON the tile below |
| `C` | checkpoint beacon (stand-height). Respawn point once touched |
| `E` | level exit doorway (needs solid ground below). Locked if anything targets `exit` |
| `B` | pushable crate (32×32). Resets to the last checkpoint snapshot on death |
| `*` | data shard (optional collectible) |
| `J` | jump pad (launches about 9 tiles high) |
| `I` | ice: solid, slick (accel ×0.25, decel ×0.08), cannot be wall-slid or wall-jumped |
| `{` / `}` | conveyor belt, solid, carries bodies standing on it left / right at 120 px/s (kept when jumping off) |

The left and right map edges are solid. Falling below the bottom row kills. The camera clamps
to the map.

### Movement reach (from `src/js/config.js`, design within these!)

| Move | Reach |
|---|---|
| Max jump height | **3 tiles comfortable**, 3.5 absolute max |
| Running jump gap (same height) | **4 tiles comfortable**, 5 hard (precise) |
| Wall jump | pushes ~2–3 tiles away from the wall, ~2.5 tiles up. Zig-zag between two walls 3–5 tiles apart to climb any height |
| Wall slide | slow fall while holding toward a wall |
| Jump pad | ~9 tiles up |
| Player size | 20×42 px: needs a **2-tile-high** gap to pass |

Never require a jump above these limits. Prefer generous early, precise late.

---

## 2. Entities (`entities: []`, TILE coordinates, `y` = the tile row the thing stands in)

**Signals.** *Sources* (`lever`, `plate`, `terminal`, `socket`) have `targets: ['id', …]`.
*Receivers* (`door`, `bridge`, `mplatform`, `laser`, `saw`, `exit`) have an `id`. A receiver is
powered when ALL its sources are active (or ANY if the receiver has `need: 'any'`). Add
`invert: true` to flip it.

| type | fields | behaviour |
|---|---|---|
| `lever` | `x,y,targets,[on],[oneShot]` | E toggles. `oneShot`: can only be switched on |
| `plate` | `x,y,targets,[w]` | active while the player OR a crate stands on it |
| `terminal` | `x,y,targets,puzzle,[onSolve],[objective]` | E opens the puzzle overlay; becomes active once solved |
| `part` | `x,y,item,[onPickup],[objective]` | E picks it up (one at a time). Returns home if the player dies before delivering |
| `socket` | `x,y,needs,targets,[onRepair],[objective]` | E while carrying `needs` repairs it, then active forever |
| `door` | `id,x,y,[w=1],[h=3]` | solid until powered; never closes on a body |
| `bridge` | `id,x,y,[w=3],[h=1]` | solid only while powered |
| `mplatform` | `[id],x,y,[w=3],path:[[x,y],…],[speed=2 tiles/s],[pause=0.5],[mode='pingpong'\|'loop']` | one-way moving platform that carries riders. If anything targets its id, it only moves while powered |
| `laser` | `[id],x,y,dir('down'\|'up'\|'left'\|'right'),[len],[period],[on],[offset]` | deadly beam from the emitter tile until the first solid tile. `period`/`on` in seconds make it pulse (0.45s warning flicker before each pulse). If targeted and powered, it is permanently OFF |
| `saw` | `[id],x,y,path:[[x,y],…],[speed=3],[r=18 px],[pause=0]` | deadly spinning blade moving along a path (tile centres). If targeted and powered, it stops |
| `sign` | `x,y,title,text` *or* `x,y,dialogue` | E reads it. Use it for logic clues and lore. `\n` = new paragraph |
| `hint` | `x,y,text,[touchText],[range=5]` | floating tutorial text that fades in when the player is within `range` tiles |
| `trigger` | `x,y,[w=1],[h=1],[dialogue],[say],[mode],[objective],[once=true],[requires],[sound],[shake],[grant]` | invisible zone, fires when the player enters. `say: [[who,mood,text],…]` inline barks (`mode` 'bark' default or 'talk'). `requires: 'id'` fires only once that source is active. `grant: 'dash'` unlocks the dash (save flag) and shows the icon hint |
| `anchor` | `x,y,[len=4]` | grapple point. Airborne + E within `len` tiles (clear line) attaches a rope: pendulum swing, ←/→ pump, ↑/↓ reel ±1 tile, Jump releases with a boost |
| `wind` | `[id],x,y,w,h,dir('up'\|'down'\|'left'\|'right'),[strength=900],[period],[on],[offset]` | current zone accelerating the player (and crates ×0.6). Pulses like a laser with `period`/`on`. If targeted, blows only while powered. Up-wind lifts only if strength > gravity (2100) |
| `dashcrystal` | `x,y` | refills the dash on touch, regrows after 2.5 s |
| `fallplat` | `x,y,[w=2]` | one-way platform: shakes 0.5 s once stood on, falls, respawns after 3 s |
| `sentinel` | `x,y,[range=7],[speed=170],[path:[[x,y],…]]` | enemy drone: patrols/hovers, chases on sight (≤4 s), returns, 1 s cooldown. Touch deals 2 damage (then it backs off). Рекс can grab + throw it (destroyed, 2 dmg to a boss). A live laser beam stuns it 3 s |
| `npc` | `x,y,who,dialogue,[facing],[recruit]` | E «Говорить» plays `dialogue`; later talks play `dialogue+'_again'` if it exists. `recruit:'rex'`: when the talk ends he joins the party (`G.save.party`) and the npc is replaced by the companion; from that level on in `LEVEL_ORDER` Рекс is present (level field `rex:false` opts out) |
| `pickup` | `x,y,kind` | `kind`: `medkit` (+3 HP, stays if HP full), `heart` (+1 max HP for the level), `shield` (2 hits / 20 s), `glider` (hold Jump falling: slow fall, fast air; 3 landings / 25 s), `jetpack` (3 s thrust holding Jump in the air), `boots` (double jump, 30 s), `slowmo` (6 s world 0.5×, Mira 0.75×). Returns on death unless a checkpoint was lit after taking it. Art: `kind`, `taken`, `t` |
| `stalactite` | `x,y` (tile under a solid ceiling) | someone within 2 tiles horizontally below → shakes 0.4 s → falls (3 dmg), shatters, back after 4 s. Art: `state` (`idle shake fall broken`), `stateT` |
| `mine` | `x,y` (tile above a floor) | stepped on → beeps 0.5 s → explodes r 1.5 tiles (4 dmg); rearms after 5 s and on respawn. Art: `state` (`armed beep boom spent`), `stateT` |
| `geyser` | `x,y,[period=3],[on=0.8],[h=6],[offset]` (tile above a floor) | 0.5 s steam warning, then erupts `on` s: 1 dmg + launches anyone in the column ~`h` tiles up (a lift). Art: `phase` (`idle warn on`), `k`, `colH`, `column` |
| `collapse` | `x,y,w,h` (empty tiles under a ceiling) | solid ceiling block; when someone passes under it shakes 0.45 s, falls (3 dmg, pushes clear, never crushes) and stays as solid floor. Art: `state` (`idle shake fall landed`) |
| `boss` | `x,y,kind,…` | owned by the boss module (`src/js/world/bosses.js`) |

Damage (config `damage`): spikes 2 (+bounce), laser 2, saw 3, sentinel 2, boss orb 1 / shell 3 / beam 3 / shockwave 2 / body 2; acid, fall, crush = instant. Mira has 6 HP, checkpoints heal +2.

Level-level field `abilities: ['dash']` makes the dash available in that level regardless of the save.

Art fields (chapter 2): `anchor.attached`; `wind.phase`/`strength`/`k`; `dashcrystal.ready`/`regrowT`; `fallplat.state` (`idle shaking falling gone`)/`t`;
`sentinel.state` (`patrol alert chase return stunned`)/`eye{x,y}`/`alertT`/`vx`/`vy`; `npc.who`/`facing`/`talking`/`talkMood`/`t`.
Player: `state` `'dash'|'swing'`, `canDash`, `dashCharges`, `dashDir{x,y}`, `dashT` (s since the dash started), `rope{ax,ay,len,angle}`, `talking`, `talkMood`.
Drone also gets `talking`/`talkMood` while ЛЮМ/Орион speak. Camera: `G.game.cineFocus(x, y, zoom, dur)`; `G.game.speaker = obj` speaks for other ids.

### Puzzles (`terminal.puzzle`). All are generated from a seed and solvable by construction.

```js
{ type: 'pipes',  w: 5, h: 4 }                       // 4×3 easy … 7×5 hard
{ type: 'lights', n: 3, presses: 3 }                 // n 3..5, presses = difficulty
{ type: 'code',   code: '417', hint: 'Текст подсказки на экране терминала' }
{ type: 'logic',  inputs: ['A','B','C'], outputs: [ { label: 'Шлюз', expr: 'A & !B' }, … ] }
// logic ops: & (И)  | (ИЛИ)  ^ (ИСКЛ-ИЛИ)  ! (НЕ)  parentheses. Must be satisfiable (the validator checks).
```

Optional fields: `title`, `subtitle`, `seed`. A code lock's clues should be readable `sign`s
in the same level, ideally a small riddle ("the number of stars on the three tablets, in
order"), not the plain code.

Repair items (`part.item` / `socket.needs`): `fuse`, `cell`, `gear`, `lens`, `chip`, `core`,
`valve`, `antenna`.

---

## 3. Decor props (`decor: []`)

`{ kind, x, y, [layer='back'|'front'], [flip], [scale] }`. Props are drawn by
`G.Art.Decor.drawProp`. `x,y` is the tile where the prop's **bottom-centre** sits (bottom
edge = bottom of that tile). Kinds:

| biome | kinds |
|---|---|
| ship / wreck | `cryo_pod`, `console`, `pipes`, `cable_bundle`, `locker`, `window_space`, `warning_light`, `hull_breach`, `crate_stack`, `fan` |
| desert / canyon | `pod_wreck`, `debris`, `fire`, `rock`, `bones`, `monolith`, `singing_pillar`, `dune_grass`, `spire_far` |
| ruins | `pillar`, `broken_pillar`, `statue`, `glyph_wall`, `arch`, `vines`, `helmet` |
| ruins `archive` (l11) | `tablet_shelf`, `data_pillar`, `echo_statue`, `glyph_wall`, `pillar` |
| caves | `stalagmite`, `mushroom`, `pipe_outlet`, `glow_moss`, `footprints` |
| crystal | `crystal_cluster`, `crystal_big`, `geode` |
| tower | `antenna`, `beacon_core`, `storm_rod`, `cable_bundle`, `glyph_wall` |
| tower `core` (l13) | `ring_machine`, `conduit`, `data_pillar`, `beacon_core`, `cable_bundle` |
| any | `lamp`, `sign_post`, `crate_stack` |

Light-emitting kinds (`lamp`, `fire`, `glow_moss`, `warning_light`, `beacon_core`, crystals, `mushroom`,
`console`, `cryo_pod`, `data_pillar`, `tablet_shelf`, `echo_statue`, `ring_machine`, `conduit`…) also feed
`G.Art.Lighting`; `lamp`, `fire`, `beacon_core`, `crystal_big`, `data_pillar` and `ring_machine` cast tile shadows.
Unknown kinds draw nothing (with a console warning). Tile decoration (grass on edges,
stalactites, rivets…) is automatic. Do not place props for it.

---

## 4. Art interfaces (`src/js/art/*.js`)

All drawing uses Canvas 2D, procedurally, with no image files. `ctx` is already scaled to the
960×540 logical view. **World-space** functions get `ctx` translated by the camera, so you
draw at entity world-pixel coordinates. **View-space** functions draw at 0..960 × 0..540.
`t` = level time in seconds. Must be deterministic per seed (use `G.rng(seed)`, never
`Math.random()` for static layout) and fast: the whole frame budget is ~8 ms, so cache
static layers in offscreen canvases.

### `G.Art.Player.draw(ctx, p, t)` (world). Mira.
Body box `p.x,p.y` (top-left), `p.w=20`, `p.h=42`; feet at `p.y+p.h`. Fields: `vx, vy, facing
(±1), onGround, state` ∈ `idle run jump fall wall land push interact dead spawn`,
`stateTime, landImpact (0..1), carry (item|null), deathCause, wallDir (±1 when touching a wall
in air)`. Draw slightly larger than the box (the sprite may overflow it). `dead`: do not draw
the body (particles already burst); optionally draw a fading ghost for 0.3s. `spawn`:
materialise effect for ~0.45s.

### `G.Art.Drone.draw(ctx, d, t)` (world). ЛЮМ.
`d.x,d.y` = centre, `vx,vy,facing,state` ∈ `follow broken waking`, `stateTime, lookX, lookY,
mood` ∈ `neutral happy alert sad`. Small (~16–22 px), glowing eye.

### `G.Art.Entities.draw(ctx, e, t, level)` (world). Switch on `e.type`.

| type | rect | animation fields |
|---|---|---|
| `door` | `x,y,w,h` | `openT` 0 closed..1 open (slides/splits; must look passable when ≥0.6) |
| `bridge` | `x,y,w,h` | `extendT` 0..1 (solid when >0.6) |
| `lever` | tile `x,y` (32×32, stands on floor) | `active`, `flipT` 0..1 |
| `plate` | `x,y,w,h` (thin, on the floor) | `active`, `pressT` 0..1, `byCrate` |
| `terminal` | `x,y,32×64` | `solved`, `t` |
| `part` | `x,y,20×22` | `item`, `taken` (hide if taken; when carried the player art draws it), `t` |
| `socket` | `x,y,32×64` | `needs`, `active`, `repairT` |
| `mplatform` | `x,y,w,16` | `dx,dy`, `running` |
| `crate` | `x,y,32×32` | `pushedT` |
| `laser` | emitter tile `x,y`; `beam` rect | `phase` ∈ `on warn off disabled`, `dir` |
| `saw` | centre `x,y`, radius `r` | `running`, `t` |
| `checkpoint` | `x,y,32×64` | `lit`, `current`, `litT` |
| `exit` | `x,y,32×96` | `locked`, `used` |
| `shard` | `x,y,16×16` | `collected`, `collectT` (animate the pickup for ~0.4s, then hide) |
| `jumppad` | `x,y,32×10` | `fireT` (time since launch) |
| `sign` | tile `x,y` | `title` |

`trigger`, `hint` and `deco` are never passed here.

### `G.Art.Decor` (world and view)
- `init(level)` is called when a level loads. Build caches and scatter props deterministically
  from `G.hash(level.id)`.
- `drawBackground(ctx, view, level, t)` (VIEW space). Sky and parallax layers (use
  `view.x/view.y`). Must fill the whole 960×540.
- `drawTiles(ctx, view, level, t)` (WORLD). Every visible tile: solid (auto-tile edges by
  neighbours), one-way, spikes, acid (animated), crumble (`level.crumbleState(tx,ty)` →
  `{state:'idle'|'shaking'|'gone', t}`, shake when shaking, skip when gone). Use
  `level.tileCode(tx,ty)` with `G.TILE_CODES`, and `level.charAt` for the raw char.
- `drawProp(ctx, e, t, level)` (WORLD). Decor props (§3).
- `drawForeground(ctx, view, level, t)` (WORLD). Optional foreground silhouettes and
  particles in front of the player (keep them sparse, never hide gameplay).
- `drawAtmosphere(ctx, view, level, t)` (VIEW). Fog, light shafts, vignette, colour grading.
- `dustColor(level)`, `debrisColor(level)` return CSS colours for particles.
- `boot()` (optional) is called once at startup.

### `G.Art.Scenes.draw(ctx, id, t, W, H, shotIndex)` (VIEW)
Full-screen cutscene illustrations, animated over `t` seconds since the shot started. Ids are
in `design/game-brief.md`. `title` loops forever as the menu background. `credits` loops.

### `G.Art.Portraits.draw(ctx, who, mood, x, y, size, t, talking)` (VIEW)
Square character portrait for dialogue boxes. `who` ∈ `mira orion lum voice`, `mood` ∈
`neutral happy sad angry scared surprised thinking determined`. `talking` = mouth animation.
Clipped to the square already.

---

## 5. Story data (`src/js/story/script.js`)

```js
G.Characters = { mira: { name: 'Мира', color: '#ffb36b' }, ... };
G.Script = {
  'l01_start': { mode: 'talk', lines: [ ['mira', 'scared', 'Текст…'], ['lum', 'happy', '…'] ] },
  'l01_horizon': { mode: 'bark', lines: [ ... ] },   // bark = non-blocking, auto-advance
};
G.Cutscenes = {
  intro: [ { scene: 'space', duration: 4, caption: '2187 год', music: 'intro', sound: 'rumble', shake: 0,
             lines: [ ['orion', 'neutral', '…'] ] }, ... ],
};
G.CREDITS = ['ТЕССЕРА', 'Глава 1 завершена', ...];
```

Keep a line under about 140 characters (it must fit 3 lines in the box). `talk` blocks the
player, so use it for story beats. `bark` is for in-motion comments.

---

## 6. Audio (`src/js/core/audio-synth.js` sets `G.Audio.impl`)

`impl.play(name, opts)`, `impl.music(id)`, `impl.setVolume(kind,v)`, `impl.unlock()`,
`impl.update(dt)`.

SFX names used by the engine: `jump walljump land death respawn checkpoint lever door bridge
plateDown plateUp terminalOpen rotate toggle key error solved pickup repair crumble crateland
respawnCrate jumppad laserOn shard levelComplete objective dialogNext blip ui uiMove uiSelect
pause droneWake rumble alarm explosion wind`. `blip` gets `opts.who` (voice pitch per character).

Music ids: `menu intro ship wreck desert canyon ruins caves crystal tower ending credits`.
