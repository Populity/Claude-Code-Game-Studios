# QA Report: UX, UI, Visual and Text (QA Engineer #3)

Date: 2026-10-02 · Build: working tree on top of `39600b4`
Evidence: `production/qa/evidence/ux/before/` and `production/qa/evidence/ux/after/`
Tooling: a copy of `tools/qa/shot.js` in the scratchpad, with viewport, DPR and touch settings, mouse and tap steps, and Exo 2 / Share Tech Mono served locally. `tools/` was not edited.

## 1. Text fit, checked by measurement
- Every line in `G.Script`, `G.Cutscenes` and the trigger `say` lines was measured with `ctx.measureText` and the same wrap logic as the game. Talk lines were checked against 664 px at 19 px (3 lines max) and bark lines against 444 px at 16 px (2 lines max). The check was run with the real Exo 2 font and again with the offline fallback font. **0 overflows.**
- Every level `sign` text was checked against the `drawSign` panel (552 px, 17 px, bottom limit 226). **0 overflows.** The longest sign, l08 «Старый шлем», fits with about 20 px to spare (`before/sign.png`).
- Puzzle subtitles and hints all fit.
- I hardened the layout so future script edits cannot overflow either. `Dialogue.layoutLine` (dialogue.js) steps the font down (19→16 for talk, 16→14 for bark) and, only as a last resort, makes the box taller. `splitLines` now handles `\n` and hard-breaks words longer than a line. `G.wrapText` now returns its line count.
- No changes to `script.js` were needed. I found no typos or untranslated strings.

## 2. Fixes made (in my scope)
| Area | Fix | Evidence |
|---|---|---|
| Dialogue | Pauses after `. ! ? … , — :` make lines read like speech. A 0.12 s guard stops a double-press from skipping a line before it is seen. Added a drop shadow and gradient panel so the box reads over bright scenes, a name-plate rule and a bobbing continue arrow. | after/talk_fallbackfont.png, after/talk_top.png, after/bark.png |
| Cutscene | The dialogue box no longer overlaps the bottom letterbox bar. The skip hint is now a key-cap (`Esc` / `Start` / `⏸`) with «Удерживайте, чтобы пропустить» at 62% opacity (was 45%, 12 px) and a full-width hold-progress bar. | before/intro_2.png → after/intro_2.png, after/ending_3.png |
| Puzzles: all | The rules text is no longer lost when a level gives a flavour subtitle. Before, l08 «Корневая матрица» showed only «Пульт древнего подъёмника» and the player got no rules. Rules now sit above the footer. The footer changes with the type and device (keyboard, mouse, gamepad, touch). It no longer offers «R — сброс» on puzzles that have no reset. | before/puz_l08.png → after/puz_l08.png |
| Puzzles: close | The close button is a round chip with a hover state. Its hit area grew from 30×30 to 64×60 view px, about 44 CSS px on a phone in landscape. Tested by tapping it at 844×390, DPR 3. | after/phone_puzzle.png |
| Puzzles: solved | «СИСТЕМА ВОССТАНОВЛЕНА» used to overlap the logic switches and the code keypad. It is now a banner over a dimmed board, and the panel border turns green. | after/code_solved.png |
| Pipes | Rotation is eased and based on frame time (was a per-frame decrement). Mouse hover highlights the cell. The keyboard cursor is thicker. On solve, the flow and the sink turn green and the sink glows. The source and sink are drawn larger and labelled in colour. | after/puz_p2.png, after/puz_l06.png |
| Lights | Hovering or moving the cursor previews the cross of cells a press will flip: a halo, plus a dot showing each cell's next state. Added a «Горит: x / N» counter. | after/lights_hover.png |
| Code | Digit slots with a blinking caret replace `_ _ _`. The riddle hint is now a «ПОДСКАЗКА» card. Keys grew from 58×42 to 76×48, with press feedback. **Backspace deletes a digit**; before, it closed the terminal. **Enter submits.** «C» is now labelled «СБРОС». | after/puz_l04.png, after/code_typing.png |
| Logic | Each variable has its own colour, used in both the expressions and the switches. Expressions use a monospace font, shrink to fit, and show ВКЛ/ВЫКЛ for each output. **Bug fixed:** typing A, D or E toggled that switch *and* moved the cursor or toggled the selected switch, because those letters are also move and action keys. A typed letter now uses up that frame. The Russian layout also works: ф/и/с/в/у map to A–E. | before/puz_l07.png → after/puz_l07.png, after/puz_l10.png |
| Menu | Raised the contrast of locked level-select items (0.28 → 0.36 alpha). | n/a |

The public API is unchanged: `new G.Puzzles.PuzzleOverlay(terminal, game)`, `update(dt)` returns `'close'` or `null`, `draw(ctx, t)`, and `onSolved` is called once. Puzzle generation and solving logic were not touched.
Functional checks run headless:
- Code: typing, Backspace and auto-submit work, and the panel closes after solving.
- Logic: typed letters work.
- Lights: mouse click hits the right cell and the close click works.
- Pipes: a touch tap rotates the right cell and a tap on ✕ closes the panel.
- No page errors.

## 3. Open issues for other owners (I did not edit these)
1. **game.js `drawControls` (around line 157): the text runs outside the panel.** «Действие: рычаг, терминал, взять/починить» ends at x≈1100 on a 1280 screen, but the panel ends at 940 (`before/controls.png`). Fix: widen the panel to `W/2-360, 720` and move the columns: `W/2-40` for keys, `W/2-20` for text. Or shorten the text to «Действие: рычаг, терминал, предмет».
2. **game.js `drawSign` (around line 618): the paragraph height is estimated as `ceil(width/maxW)`.** This can disagree with the real word wrap and cause overlap in future signs. Patch: `y += G.wrapText(ctx, p, px+24, y, pw-48, 23, p) * 23 + 6;` (wrapText now returns the line count) and delete the estimate. Also make the panel height grow with the content.
3. **game.js `drawSign` footer always says «Нажмите E, чтобы закрыть».** It is wrong on touch and gamepad. Patch: `G.input.touchActive ? 'Коснитесь, чтобы закрыть' : G.input.lastDevice === 'gamepad' ? 'Нажмите X, чтобы закрыть' : 'Нажмите E, чтобы закрыть'`.
4. **game.js `drawPrompt` (around line 582) shows key «X» for gamepad.** The gamepad action is mapped to buttons 2 and 1 (X/B on Xbox), so this is fine. But it shows «E» on touch, where the button is also labelled «E». That is consistent, no change needed.
5. **Touch layout (game.js `drawTouch`, around line 537):**
   - The buttons are placed in 960×540 view space, so on 19.5:9 phones they sit inside the game area and leave the black side bars unused. They also cover the player at the start of p2 (`after/phone_game.png`).
   - Suggestion: place the buttons in screen space, using the side bars when `view.ox > 0`, or shrink them to 0.85× and move them 20 px toward the corners.
   - The touch buttons stay drawn and *active* behind open puzzle, sign and pause overlays. Pressing ▲ while a puzzle is open rotates the cursor cell. Patch: in `GameScene.draw`, skip `drawTouch` and set `G.input.touchButtons = []` when `this.puzzle || this.sign || this.paused`.
6. **The pause button is only drawn when touch controls are shown.** That is fine. Note that its hit radius of 24 view px is about 17 CSS px on a phone. Raise it to 34.
7. **index.html depends on Google Fonts.** When offline the game falls back to the system sans-serif. Every line still fits (checked), but the look changes. Bundle Exo 2 and Share Tech Mono locally (woff2, about 120 KB). Owner: lead / build.
8. **Logic expression precedence:** l07 «Фокус» is `НЕ A ИСКЛ-ИЛИ (C И D)` and parses as `(НЕ A) ^ (C&D)`. Players may read it as `НЕ (A ^ …)`. Suggest the level designer writes `(!A) ^ (C & D)` in l07.js:73 so the brackets show. The puzzle is solvable either way: A0 B1 C1 D0.

## 4. Remaining risks
- I did not test with a real physical gamepad. The footer and back/close mapping were checked against the `input.js` button map (B = back+action, which closes; Start = pause, which skips cutscenes).
- In headless runs, a key held across a single stepped frame does not register as a new press. This is a limit of the test harness, not of the game.
- I did not run a full-campaign visual pass at 1920×1080 or 1366×768. The canvas scales uniformly, so the layout is resolution-independent. I verified phone landscape at 844×390, DPR 3.
