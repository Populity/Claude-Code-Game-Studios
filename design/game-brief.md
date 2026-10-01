# ТЕССЕРА: Сигнал из пыли — Game Brief

> The design record at `rigor: minimal` (one-page brief, replaces concept doc + GDDs).
> Platform: HTML5 Canvas, vanilla JS, no build step. Plays in desktop and mobile browsers.

## Pitch

A 2D puzzle-platformer. Ship engineer Mira crash-lands on Tessera, a dead planet covered
in the half-working machines of a vanished civilisation, the Architects. She survives by
**jumping precisely** between and off obstacles (wall jumps, moving lifts, crumbling stone,
blades, energy arcs) and by **repairing things**: routing power, solving logic circuits,
cracking codes from clues and carrying parts to broken machines.

## Pillars

1. **Hands and head.** Every level mixes a platforming challenge with a repair or logic puzzle.
2. **Fair difficulty.** Deaths are instant and cheap: frequent checkpoints, respawn in about 1s.
3. **A mystery that pulls you forward.** Each level reveals one new piece of the story.

## Core loop

Explore, reach a broken mechanism, find a part, code or route, repair it, and the way opens.
Hazards between those steps test movement.

## Scope: first version (Chapter 1)

| Part | Levels | Target first-play time |
|---|---|---|
| Prologue | `p1`, `p2` + `intro` and `crash` cutscenes | ~5 min |
| Chapter 1 "Тессера" | `l01` … `l10` + `ending` cutscene | ~30 min (~3 min/level incl. deaths) |

## Characters (script ids)

- **`mira`: Мира Орлова.** 29, flight engineer of the colony ship «Ковчег-7». Practical, dry
  humour, talks to machines, secretly scared of heights. Her younger brother **Тим** sleeps
  in cryo among the 2,000 colonists.
- **`orion`: ОРИОН.** The ship's AI. Calm, formal, precise. Seems lost when the ship breaks
  up; a weak fragment returns in `l06`.
- **`lum`: ЛЮМ.** A small repair drone. Short sentences, "бип", curious and loyal. It learns
  the Architects' glyphs in `l04` and from then on translates.
- **`voice`: ???** The signal of Tessera. It speaks rarely, in fragments. In the finale it
  turns out to be **Mira's own voice**.

## Story outline (beats → level → required dialogue ids)

Dialogue ids are the contract between the writer (`src/js/story/script.js`) and the level
designers (`src/js/levels/*.js`). Designers MUST place every id listed for their level, as
`startDialogue`, a trigger `dialogue`, or a terminal/part/socket `onSolve`/`onPickup`/`onRepair`.
Designers MAY add extra gameplay barks inline via trigger `say` (no id needed).

**Cutscene `intro`** (before p1). Year 2187. «Ковчег-7» carries 2,000 colonists in cryosleep to
Proxima b. The ship picks up a strange rhythmic signal from an uncharted system. A gravity
anomaly grips the hull and ORION wakes the flight engineer.
Shots use scenes `space` → `signal` → `anomaly`.

**p1 «Пробуждение»** (biome `ship`). Mira wakes in the cryo bay. It is the movement tutorial:
run, jump, interact. The doors are jammed, so she pulls a lever. Sparking cables (timed energy
arcs) block the corridor.
Ids: `p1_wake` (start), `p1_door`, `p1_sparks`, `p1_end`.

**p2 «Реакторный отсек»** (biome `ship`). The reactor is overheating. She routes the coolant
with a pipes terminal, climbs a maintenance shaft (the wall-jump tutorial) while the ship starts
breaking apart, and reaches the escape pod where ЛЮМ is waiting.
Ids: `p2_start`, `p2_reactor`, `p2_fixed` (pipes onSolve), `p2_shaft`, `p2_breaking`, `p2_pod`.

**Cutscene `crash`** (after p2). The pod launches as the ship breaks in two. The cryo section
falls separately. The descent reveals Tessera: an amber sky, a ring and two moons. Then impact.
Scenes: `pod_launch` → `ship_breakup` → `descent` → `crash`.

**l01 «Место крушения»** (`desert`). The pod is burning. ЛЮМ is broken: find a fuse in the
debris and repair it. ORION's last telemetry says the cryo section fell to the east.
Ids: `l01_start`, `l01_lum_found`, `l01_fuse` (onPickup), `l01_lum_wake` (onRepair), `l01_horizon`.

**l02 «Поющие дюны»** (`desert`). Wind-singing stone pillars. Crates and pressure plates open
the first Architect gate. The sandstone crumbles.
Ids: `l02_start`, `l02_dunes_sing`, `l02_gate`, `l02_gate_open`.

**l03 «Ущелье ветров»** (`canyon`). Wall jumps between canyon walls, ancient lifts, grinding
blades. First sight of the Spire (the Beacon) on the horizon.
Ids: `l03_start`, `l03_walls`, `l03_tower_sight`, `l03_end`.

**l04 «Врата Зодчих»** (`ruins`). ЛЮМ downloads the glyph dictionary from a tablet. A code lock
is solved with clues on glyph tablets (signs). A lights matrix follows. The message on the wall
reads: «Мы ждали вас».
Ids: `l04_start`, `l04_glyphs`, `l04_message` (code onSolve), `l04_end`.

**l05 «Затопленные стоки»** (`caves`). Acid channels, timed lasers, double plates
(crate + Mira). She finds **human boot prints**, which should be impossible.
Ids: `l05_start`, `l05_acid`, `l05_footprints`, `l05_end`.

**l06 «Обломки «Ковчега»»** (`wreck`). The cryo section, tilted in the sand. The colonists are
alive (Tim too), but power is failing. She repairs the power with a big pipes puzzle and an
energy cell. A fragment of ORION wakes: the signal comes from the Spire, and only its antenna
can call for rescue.
Ids: `l06_start`, `l06_cryo`, `l06_orion` (socket onRepair), `l06_plan` (terminal onSolve), `l06_end`.

**l07 «Кристальные пещеры»** (`crystal`). Singing crystals, a logic-gates terminal, lifts and
blades. ЛЮМ deciphers: the signal is not a call for help, it is an *invitation*.
Ids: `l07_start`, `l07_crystals`, `l07_logic` (onSolve), `l07_end`.

**l08 «Механический лес»** (`ruins`, overgrown variant). Jump pads, a combined crate + lights
puzzle. She finds an old human helmet marked «КОВЧЕГ-7», scratched and centuries old.
Ids: `l08_start`, `l08_helmet`, `l08_doubt`, `l08_end`.

**l09 «Шпиль»** (`tower`). A vertical climb in a storm: wall jumps, crumbling ledges, lasers.
Ids: `l09_start`, `l09_storm`, `l09_halfway`, `l09_top`.

**l10 «Маяк»** (`tower`). The top of the Spire. Repair the Beacon core (part `core`), then a
final terminal (logic). The Beacon fires.
Ids: `l10_start`, `l10_core` (onRepair), `l10_final`.

**Cutscene `ending`** (after l10). A light column hits the sky and the signal answers. The
Voice speaks in Mira's own voice: «Не включай его… В прошлый раз мы тоже включили». The sky
clears: the orbit is full of wrecks of identical «Ковчег-7» ships. *To be continued.*
Scenes: `beacon_on` → `voice` → `wrecks_orbit`.

## Cutscene scene ids (art contract: `G.Art.Scenes.draw(ctx, id, t, W, H, shotIndex)`)

`title`, `space`, `signal`, `anomaly`, `pod_launch`, `ship_breakup`, `descent`, `crash`,
`beacon_on`, `voice`, `wrecks_orbit`, `credits`.

## Biomes (art contract: `G.Art.Decor`)

`ship`, `wreck`, `desert`, `canyon`, `ruins` (+ overgrown look when `level.def.variant === 'overgrown'`),
`caves`, `crystal`, `tower`.

## MVP list / build order

1. Core engine: physics, entities, signals, puzzles, dialogue, menus, save. **Done.**
2. Levels p1–l10 + story script, in parallel.
3. Art: character animation, entity animation, biome decor, cutscene illustrations, in parallel.
4. Procedural audio: SFX + music per biome.
5. QA loop: automated smoke tests, level reachability, bug fixing, until clean.
