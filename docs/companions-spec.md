# TESSERA: Health, Pickups, Sudden Hazards, Companions (contract)

## 1. Health (ENGINE)

- **Player:** `p.hp` / `p.maxHp`, with 6 by default (`config.health.player`).
  - Damage comes from `p.hurt(amount, cause, fromX)`: 0.9 s of i-frames (blinking), a knockback away from `fromX`, and a short hit-stop.
  - At 0 HP she dies (existing respawn). On respawn HP is full.
  - Checkpoints heal +2.
- **Damage table** (`config.damage`, tunable):

  | Source | Damage |
  |---|---|
  | `spikes` | 2 |
  | `laser` | 2 |
  | `saw` | 3 |
  | `sentinel` contact | 2 |
  | `orb` / `glyph` boss projectile | 1 |
  | `shell` | 3 |
  | `beam` | 3 |
  | `shockwave` | 2 |
  | `stalactite` | 3 |
  | `mine` | 4 |
  | `crush` | instant |
  | `acid` | instant |
  | `fall` | instant |

  On spikes, damage also bounces her up (so she isn't stuck).
- **Companions** have HP too. Bosses keep their existing HP.
- **HUD (text-free):** segmented HP bar with a heart icon at top-left. The active companion's bar sits under it, with its portrait icon.

## 2. Pickups (`entities: [{type:'pickup', kind, x, y}]`)

All pickups respawn on death only if not consumed before the last checkpoint.

| kind | effect |
|---|---|
| `medkit` | +3 HP |
| `heart` | +1 max HP for the level |
| `shield` | absorbs the next 2 hits (bubble), lasts 20 s |
| `glider` | hold Jump in the air to glide (slow fall, fast horizontal). Lasts until landing 3 times, or for 25 s. **This is the canyon solution.** |
| `jetpack` | 3 s of upward thrust while holding Jump in the air, then empty |
| `boots` | double jump for 30 s |
| `slowmo` | 6 s of world at 0.5× speed (the player stays at 0.75×) |

Art fields: `kind`, `taken`, `t`. Active player buffs are in `p.buffs = {shield:{hits,t}, glider:{t,uses}, jetpack:{fuel}, boots:{t}, slowmo:{t}}`.

## 3. Sudden hazards (`entities`)

| type | fields | behaviour |
|---|---|---|
| `stalactite` | `x,y` (ceiling tile) | When the player passes within 2 tiles horizontally below it, it shakes for 0.35 s (dust telegraph), then falls. It shatters on the ground and respawns after 4 s. |
| `mine` | `x,y` | Buried, with a faint blink. Stepping on it beeps for 0.5 s, then it explodes (radius 1.5 tiles). Jumping away in time avoids the hit. |
| `geyser` | `x,y,[period=3],[on=0.8],[h=6]` | A vent that erupts upward. It deals 1 damage and launches the player up, so it can be used as a lift. |
| `collapse` | `x,y,w,h` | Ceiling block that drops once when the player passes under it. It deals 3 damage, and the fallen block then becomes solid floor. |

## 4. Companions (ENGINE + ART + LEVELS)

### Party members

- **ЛЮМ (`lum`)**, the drone, is always present (from l01).
  - Controlled: free flight in 8 directions at 220 px/s and passes through one-way platforms. It cannot carry items.
  - **Help (G):** a stun pulse with radius 3 tiles. It stuns sentinels for 3 s, interrupts boss projectiles in its radius, and activates levers and terminals from a distance (1 tile).
- **РЕКС (`rex`)**, a gruff survivor from an older «Ковчег-7» wreck, recruitable in l11 (and present afterwards).
  - Big and slow; it cannot wall-jump and only jumps 2 tiles high. HP 10.
  - **Help (G):**
    - If Mira stands within 1.5 tiles, he **throws Mira**: a launch arc toward the direction she faces, about 9 tiles far and 5 high. This flies her over canyons.
    - Otherwise he **grabs and throws** the nearest crate, sentinel or boss projectile within 1.5 tiles, about 8 tiles far. Thrown sentinels are destroyed and deal 2 damage to bosses.

### Recruiting and switching

- **Recruit:** an `npc` with `recruit:'rex'` asks to join. Talk (E), and on the dialogue's end he joins `G.save.party`, which persists.
- **Switch control (Tab / Q, gamepad Y, touch button ⇄):** cycles Mira → ЛЮМ → Рекс.
  - The camera follows the controlled character.
  - Non-controlled members follow Mira with AI: they path along the ground and teleport to her if they are more than 14 tiles away or stuck for 3 s.
  - Mira stands still while you control another member. Enemies may hit her.
  - Swapping is blocked in boss intros and dialogues.
- **Help (G / gamepad LB / touch button ✋):** triggers the help ability of the **controlled** member. When Mira is controlled, it triggers the help of the **nearest** companion as an AI action, for example Рекс throws her.
- **Death:** if a companion reaches 0 HP he is "down" for 10 s (he kneels), then revives with 50% HP. Mira's death still resets to the checkpoint.

### Art fields and dialogue

- **Art fields:** `c.who`, `c.hp`, `c.maxHp`, `c.state` (`follow`/`controlled`/`help`/`down`/`throw`), `c.facing`, `c.vx`, `c.vy`, `c.t`, `c.helpT`. `game.controlled` points at the controlled actor.
- **Dialogue:** the writer adds `l11_rex_meet` (recruit talk), `rex_help1` (bark) and `rex_down` (bark). Rex's character key is `rex` (name «Рекс», color `#e8a15a`).

## 5. Rebalance targets (LEVELS)

- **l11 (2-1), after checkpoint 2:**
  - Make the crystal chain forgiving: add crystals, widen gaps' landing spots, and add a mid-pit safe ledge.
  - Put a `glider` pickup before it.
  - Recruit Рекс at checkpoint 2, and offer an alternative route: Рекс throws Mira over the pit.
- **l12 canyon:** place `glider` and `jetpack` before the long chasms, and add a Рекс-throw shortcut.
- **All levels:**
  - Add medkits near hard sections.
  - Add a few sudden hazards (stalactites in caves, crystal and tower levels; mines in ruins and canyon).
  - Fairness first: every sudden hazard is telegraphed for at least 0.35 s.
