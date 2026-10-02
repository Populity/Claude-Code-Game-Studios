# QA Report: Engine and Gameplay Systems (QA #2)

Scope: `src/js/world/*`, `src/js/core/{util,input,fx,audio}.js`, `game.js`, `main.js`, `config.js`.
Method: Node simulations that run the real engine code (`tests/bots/*/sim.js` harness), each run
against the pre-QA commit `e0c9ec8` and against the fixed tree, plus headless Chromium smoke runs
(`tools/qa/shot.js` and a Playwright script for the real-time loop).

Regression state after the fixes:
- unit tests: physics 16/16, puzzles 8/8, save 8/8, signals 10/10
- bots: p1 through l07 all PASS (9/9). l08, l09 and l10 have no route yet.
- `validate-levels`: 0 errors
- browser smoke: every level, plus pause → «К последнему чекпоинту», runs with 0 JS errors

## Bugs fixed

| # | Sev | Bug | Repro (before → after) | Fix |
|---|---|---|---|---|
| 1 | **High** | Falling through a **rising lift**. The platform moves up before the player moves, so its top ends up above her `prevBottom` and the one-way test rejects it. This is worst on the first frame a lift starts with her on it. | Player standing on a lift that starts rising: off the lift for 600/600 frames (she falls to the floor) → 0/600 | `physics.js`: the one-way landing tolerance now adds the platform's own upward `dy` for the frame |
| 2 | **High** | A **bridge extending into the player** (or a crate respawning onto her) puts her inside a solid. The next X move then snaps her across to the solid's edge, a teleport of 71 px or more, or she drops into the pit. | Bridge goes solid while she is mid-jump in its row → she now pops onto the bridge (or out below it), with no teleport | `physics.js`: added `embeddedIn()` / `depenetrate()`. A move ignores dynamic solids the body is already inside. `Player.update` pushes her out along the shortest free axis (≤ `crushPush` 40 px), otherwise `kill('crush')` |
| 3 | Med | Standing on a **crate on a moving lift**: the lift carries the crate but not her, so the crate slides out from under her. Stacked crates have the same problem. | crate−player offset drifted from −6 px to +30 px and she fell → stays at −5 px, still standing on the crate | `entities.js`: `carryRiders()` carries recursively (lift → crate → player/crate) |
| 4 | Med | A **trigger with `requires`** never fires if she is already standing in the zone when the source turns on. She has to leave and come back. | Lever pulled inside the zone: NOT fired → fired | The trigger stays "outside" while the requirement is unmet |
| 5 | Low | `player.carryPart` stayed set after death, so a stale part reference carried over into the next life. | stale → null | `Player.reset` clears `carryPart` |
| 6 | Low | She could die after touching the exit (a saw or laser during the 2.2 s completion fade), giving a death and a respawn on a completed level. | code path | `kill()` does nothing while `frozen` (level complete) |
| 7 | Low | **Quick taps were lost**: a key pressed and released between two frames (at low fps) never registered as `pressed`. | code path | `input.js`: a tap is latched for one update (key repeat ignored) |
| 8 | Low | **Long frames changed the physics.** dt was clamped to 1/30, so a slow PC got a different jump arc and the game slowed below 30 fps. | code path | `main.js`: frames up to 1/15 s are split into equal sub-steps of ≤ 1/60 s. `G.step` is unchanged and stays deterministic |
| 9 | Low | Alt-tab or switching tabs during gameplay let the game keep running with input cleared. | — | `main.js`: auto-pause on `blur` / `visibilitychange` (not under QA `timeScale`) |
| 10 | Low | Above row 0 counted as empty, so a jump pad or wall jump could carry her over a wall that touches the top of the map, off-camera. | — | `level.js`: a solid column in row 0 continues upward |

## Feel polish (data-driven, `config.player`)
- **Corner correction** (`cornerCorrection: 6`): a jump that clips a ceiling edge by 6 px or less slides around it. Before, it bonked at row 12; now it passes.
- **Ledge forgiveness** (`ledgeAssist: 8`, `ledgeAssistMinVy: 120`): if she misses a ledge top by 8 px or less while holding toward it, she is popped up onto it. Before, she fell short; now she lands on the ledge.
- **Wall jump while holding into the wall**: 20/20 from a tile wall and 20/20 from a door, across a range of heights. Down + Jump drop-through on `=` works.

## Performance
Measured with `G.step` in headless Chromium:
- Simulation update: 0.05–0.09 ms per frame in l05, l06, l09 and l10. The engine is not the bottleneck.
- I removed per-frame array allocations: the new `level.crates` cache replaces `entities.filter` in door, plate, lift and crumble code.
- Render cost is almost all decor and atmosphere art.

**Adaptive graphics (lead request):**
- New setting `G.settings.quality` = `auto | high | low`, shown in Settings as «Графика» (title and pause menu).
- In `auto`, `main.js` keeps a rolling average of real frame time. If it stays above 22 ms for 2 s of unpaused gameplay, it sets `settings.autoLow = true`, which is persisted.
- Low mode skips `Decor.drawForeground` and `drawAtmosphere` and halves particle spawns. `G.lowGfx()` tells you whether low mode is active.
- Choosing `auto` again resets the flag so the game measures from scratch.
- Verified in headless Chromium: the fallback triggered on l05 (average 23.1 ms). The menu cycles авто (низкая) → высокая → низкая → авто, the choice persists, and there were 0 errors.

## Level checks
- I idled 4 s at every spawn point and checkpoint in all 12 levels: no spawn inside a solid, no deaths, always grounded. No soft-lock found from spawns.
- A crate snapshot taken in an unrecoverable spot is the only soft-lock vector I found. The pause action «Вернуть ящики на место» already recovers from it.

## For other owners
- **`tools/qa/bot-early/route_l03.js`** (the old copy): its `wallclimb` heuristic is frame-timing fragile. With a ±8 px start offset it succeeds in 7 of 17 runs on both the old and the new engine. The ledge assist shifted the start by 2 px, so this old copy now times out. The copy in `tests/bots/early` passes.
- **Art (`art/player.js`)**: the new `deathCause` value `'crush'` falls through to your default case. Add it if you want a distinct effect.
- **Design**: replaying a level from level select sets `save.current` to that level, so «Продолжить» then points back at it. I left this alone because it is a design decision.

## Remaining risks
- l08, l09 and l10 have no bot routes, so full traversal is not proven for them (spawns and checkpoints are safe).
- A lift rising into a ceiling while she rides it scrapes her off (she falls; she is not crushed). Levels should avoid it.
- Lasers are computed once from tiles, so doors and crates do not block beams. This is by design, but players may expect cover.
- The adaptive threshold was tuned only on headless software rasterisation. It needs a check on real low-end GPUs.
