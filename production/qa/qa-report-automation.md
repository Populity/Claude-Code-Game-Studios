# TESSERA — Automation QA report

Run: `node tests/run-all.js` (Node 22 + global Playwright, no npm install). Total ≈ 80 s.

| Suite | Result | Detail |
|---|---|---|
| Level validator (static) | PASS | 0 errors, 0 warnings, 12 campaign levels + sandbox |
| Unit: physics | PASS | 16/16 |
| Unit: signals | PASS | 10/10 |
| Unit: puzzles (500 seeds × sizes) | PASS | 8/8 — pipes/lights always solvable, logic parser |
| Unit: save data + flow | PASS | 8/8 |
| Route bots (real engine, headless) | PASS | 12/12 levels start→exit, 0 deaths |
| Browser smoke (Chromium) | PASS | 27/27 — every level 360 frames, 3 cutscenes, title→New Game, 9 terminals solved through the UI, full campaign → credits, save advances |

## Fixed during the final pass
- **l09 «Шпиль», storm shaft B:** a wall-jump climb's apex passed through the pulsing laser 3 tiles above each 1-tile rest ledge, and the two lasers were anti-phase — the bot (and a player) could not land on the ledges safely. Rest ledges widened to 2 tiles; both lasers now pulse in phase with a longer dark window (on 0.8 s of 2.6 s).
- **l10 «Маяк», laser shaft:** same pattern; lasers set in phase (on 0.8 s of 2.4 s).
- **l10 route bot written** (previously pending); l09 bot waits for the dark window before climbing.

## Coverage notes / remaining risks
- Bots and smoke use deterministic stepping; real-time feel on low-end GPUs is not measured (adaptive graphics fallback exists, see qa-report-engine.md).
- No physical gamepad test. No human playtest yet — first-play time per level (~3 min) is an estimate.
