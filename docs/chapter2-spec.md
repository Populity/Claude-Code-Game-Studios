# TESSERA Chapter 2 «Эхо»: Contract for the new content

This is the shared contract for the Chapter 2 work, which is being built in parallel. It extends
`docs/level-format.md`, so read that first. When a section here says **ENGINE**, the gameplay
programmer implements it in `src/js/world/*`, `config.js`, `core/input.js` and `game.js`. When it
says **ART**, the named artist draws it.

## 1. Story frame (writer)

At the end of Chapter 1, Mira switched the Beacon on and heard her own voice warning her.
Chapter 2 picks up straight after that.

- **New character: ЭХО (`echo`).** An ancient custodian automaton of the Architects. It is tall, thin
  and asymmetrical, built from bronze plates, with a cracked mask and a slowly turning ring of light
  around its head. It speaks in archaic, slightly formal Russian, sometimes in riddles, and it
  remembers "the previous Miras". It is neither friend nor foe: it tests her. It gives her the
  **impulse module (рывок / dash)** in `l11`. Portrait colour `#ffd27a`.
- **New threat: Стражи (sentinels).** Architect guard drones that wake when the Beacon fires. They
  hunt anything that moves, which creates movement pressure.
- **Levels:**
  - `l11` «Архив Зодчих» (ruins, variant `archive`): meet ЭХО and receive the dash.
  - `l12` «Ветряные трубы» (canyon): wind currents, anchors to swing from, sentinels.
  - `l13` «Сердце Шпиля» (tower, variant `core`): every mechanic together. ЭХО reveals the loop is
    deliberate.
- **Cutscenes:**
  - `ch2_intro`, before l11. Scenes: `beacon_on` → `voice` → `archive_gate`.
  - `ch2_end`, after l13. Scenes: `echo_reveal` → `wrecks_orbit`.
- **Required dialogue ids:**
  - l11: `l11_start`, `l11_echo_meet` (npc), `l11_dash_get`, `l11_end`
  - l12: `l12_start`, `l12_wind`, `l12_sentinel`, `l12_end`
  - l13: `l13_start`, `l13_echo_truth` (npc), `l13_final` (final terminal onSolve)

## 2. New movement and mechanics (ENGINE)

### Dash (рывок)

- **Keys:** Shift / C / L, gamepad RB (button 5), and a new touch button «⚡». This is the new
  input action `dash`.
- **Movement:** 8-directional, held direction with facing as the fallback; up+side gives a
  diagonal. Speed is `dashSpeed: 620` px/s for `dashTime: 0.16` s, gravity is off during the dash,
  and afterwards velocity is kept ×0.55.
- **Recharge:** **1 charge**. It refills on landing, on a wall slide, or by touching a
  `dashcrystal`. The player is not invulnerable while dashing.
- **Availability:** `player.canDash` is true when `level.def.abilities` contains `'dash'`, or
  `G.save.abilities.dash` is set. l11 grants the ability through a trigger with `grant: 'dash'`,
  which sets the save flag, plays `l11_dash_get` and shows a hint.
- **Art fields:** `p.state === 'dash'`, `p.dashDir {x,y}`, `p.dashCharges`, `p.dashT`. Draw an
  after-image trail, and give the hair a colour cue when no charge is left.

### Other mechanics

- **Momentum inheritance (physics improvement):** jumping off a moving platform adds the
  platform's velocity (`mplatform.dx/dt`) to the player. Crates get proper friction, slide a little
  after a push, and inherit the velocity of the platform they ride.
- **`anchor`, grapple point `{x,y,[len=4]}`:** while airborne and within `len` tiles, press
  **action** to attach a rope. The player then swings as a pendulum with real angular momentum:
  left/right pumps the swing and up/down shortens or lengthens the rope by ±1 tile. Press jump to
  release with the tangential velocity plus a small boost. Art fields: `anchor.attached`,
  `p.rope {ax, ay, len, angle}`, `p.state === 'swing'`.
- **`wind`, current zone `{x,y,w,h,dir:'up'|'down'|'left'|'right',[strength=900],[period],[on]}`:**
  applies acceleration to the player and crates inside the zone. It can pulse like a laser. Art
  fields: `phase`, `strength`.
- **`dashcrystal` `{x,y}`:** a floating crystal that refills the dash on touch and regrows after 2.5 s.
  Art fields: `ready`, `regrowT`.
- **`fallplat` `{x,y,[w=2]}`:** a platform that shakes for 0.5 s after you stand on it, then falls
  with gravity, then respawns after 3 s. It is solid on top only. Art fields: `state`
  (`idle`/`shaking`/`falling`/`gone`) and `t`.
- **Ice tile `I`:** low friction (accel ×0.25, decel ×0.08). Cannot be wall-jumped off (too slick).
- **Conveyor tiles `{` (moving left) and `}` (moving right):** carry bodies standing on them at
  120 px/s.
- **`sentinel`, enemy drone `{x,y,[range=7],[speed=170],[path]}`:**
  - It patrols its path, or hovers in place if it has none.
  - If the player is within `range` tiles and in line of sight (tile raycast), it chases with
    steering for up to 4 s at `speed`, keeping 1 tile above the ground.
  - After a chase it returns home and has a 1 s cooldown before it can chase again.
  - Touching it kills, with death cause `'sentinel'`. It never enters solid tiles.
  - A **laser beam stuns it for 3 s** (it falls), which is a puzzle hook.
  - Art fields: `state` (`patrol`/`alert`/`chase`/`return`/`stunned`), `eye {x,y}` (look target),
    `alertT`, `vx`, `vy`.
- **`npc` `{x,y,who:'echo',dialogue,[facing]}`:** interactable with prompt «Говорить». It plays its
  dialogue id, and repeat talks play `dialogue + '_again'` if that id exists. Art fields: `who`,
  `facing`, `talking` (true while its dialogue is active), `t`.

**ENGINE also updates:** `docs/level-format.md` (adding the new rows), `tools/validate-levels.js`
(new chars, types and story ids for l11–l13), the sandbox (`src/js/levels/sandbox2.js`, opened with
`?level=sandbox2`, demonstrating every new mechanic), and unit tests in `tests/unit/`.

## 3. Light and shadow (ART: lighting artist, `src/js/art/lighting.js`)

`G.Art.Lighting.draw(ctx, view, level, t, game)` is called in world space after the player, fx and
entities are drawn, and before front props. It renders a lighting pass:

- **Darkness:** a per-biome ambient darkness (ship and caves dark, desert bright, tower stormy), so
  light sources matter.
- **Light sources** (radius, colour, flicker): lasers (along the beam), checkpoints (lit), exit,
  terminals, crystals, `glow_moss` and `lamp` props, the player's shoulder lamp (a cone in her
  facing direction), the drone's eye, the sentinel eyes, the ЭХО ring, and acid surfaces.
- **Shadows:** soft 2D shadows cast by solid tiles for the strongest lights near the camera (max ~6
  shadow-casting lights; visibility polygon by tile-edge raycasting at half resolution, blurred). The
  player and crates cast short contact shadows on the ground below them.
- **Draw order:** composite with `multiply` for darkness and `lighter` for light glow.
- **Budget:** fast. Use an offscreen buffer at 0.5× and rebuild the static tile-edge segment cache
  only when `level.version` changes. Skip entirely when `G.lowGfx()`. Also provide
  `G.Art.Lighting.setQuality('high'|'medium')`.

## 4. Art for the new things (ART: character/mechanism animator)

| Element | Where it lives |
|---|---|
| ЭХО standing/talking/idle animation | `G.Art.Entities.draw` case `npc` |
| ЭХО portrait | `G.Art.Portraits` `who === 'echo'` |
| Sentinel drone animation | `G.Art.Entities.draw` case `sentinel` |
| Anchor, wind, dashcrystal, fallplat, ice and conveyor tiles | ice and conveyors drawn in decor `drawTiles` (decor artist) |
| Mira's dash and swing states, rope rendering | `G.Art.Player.draw` |

## 5. Cutscene scenes (ART: cinematic illustrator, `G.Art.Scenes`)

New scene ids: `archive_gate` (colossal Architect archive doors opening, with ЭХО silhouetted in
light) and `echo_reveal` (ЭХО's mask breaking, showing a hall of countless sleeping Mira-clones in
cryo, unsettling).
