const { Grid, emit } = require('./lb');
const W = 200, H = 24;
const g = new Grid(W, H);
const acid = (x0, x1) => { g.r(x0, 19, x1, 20, '~'); g.r(x0, 21, x1, 23); };
// ---------- A: drain outlet (0-13)
g.r(0, 0, 37, 6);                   // cave ceiling
g.r(0, 13, 9, 23); g.s(3, 12, 'P');
g.r(10, 16, 13, 23);                // step down
// ---------- B: acid intro (14-40)
g.r(14, 19, 21, 23);
acid(22, 23);                       // channel 1 (2 wide)
g.r(24, 19, 27, 23);
acid(28, 33); g.r(30, 18, 31, 23);  // channel 2 with a stone
g.r(34, 19, 74, 23);
g.s(37, 18, 'C');
g.r(38, 0, 74, 12);                 // rhythm corridor ceiling (corridor rows 13-18)
// ---------- D: cargo lock room (75-112)
g.r(75, 0, 112, 9);
g.r(75, 10, 75, 15);                // hanging lintel of the room entrance
g.r(75, 19, 112, 23);
g.s(77, 18, 'C');
g.s(81, 18, 'B');                   // crate 1
g.s(88, 18, '#');                   // kerb: crates cannot pass it, Mira hops it
g.r(89, 10, 89, 14); g.r(91, 10, 91, 14);   // cargo bunker walls; chute door at (90,14)
g.s(90, 13, 'B');                   // crate 2 sits on the closed chute
g.r(100, 10, 100, 15);              // wall above the lock door
g.s(103, 18, 'C');
// ---------- E: acid lake (113-151)
g.r(113, 0, 151, 5);
acid(113, 151);
g.r(116, 18, 117, 23); g.r(121, 18, 122, 23); g.r(126, 18, 127, 23);   // stepping pillars (stand 17)
g.r(131, 18, 135, 23);              // rest ledge
g.s(133, 17, 'C');
g.s(124, 13, '*');                  // shard: full-height jump through the arc column
// M2 shuttle 136->142 (row 17), M3 lift x147-149 rows 18->11
// ---------- F: footprints gallery (152-176)
g.r(152, 0, 168, 4);
g.r(150, 12, 199, 23);              // dry ledge (stand 11), flush with the lift top; continues under the chimney
g.s(154, 11, 'C');
g.s(148, 8, '*');                   // shard: jump from the top of the lift
// ---------- G: chimney to the surface (177-199)
g.r(177, 2, 177, 9);                // left wall (hanging; walk in under it, rows 10-11)
g.r(181, 3, 199, 11);               // right block: top row 3 is the exit terrace (stand 2)
g.s(174, 11, 'C');
g.s(177, 1, '*');                   // shard: perch on top of the hanging wall
g.s(196, 2, 'E');

// rhythm wave helper: k-th laser goes off delta*k later than the first
const wave = (xs, y, period, on, delta) => xs.map((x, k) => ({ type: 'laser', x, y, dir: 'down', period, on, offset: +(((period - k * delta) % period + period) % period).toFixed(2) }));

const def = {
  id: 'l05', chapter: 'Глава 1 · Тессера', chapterShort: '1-5', title: 'Затопленные стоки', biome: 'caves', drone: true,
  objective: 'Спуститесь в стоки', startDialogue: 'l05_start',
  entities: [
    { type: 'sign', x: 7, y: 12, title: 'Скрижаль стоков', text: 'Вода ушла вниз, в глубину. Осталась едкая горечь.\nНе касайся зелёного.' },
    'C — rhythm 1: arc wave on flat ground (period 2.0, on 0.9, each next arc goes off 0.5 s later — run behind the wave)',
    ...wave([46, 50, 54, 58, 62, 66], 13, 2.0, 0.9, 0.5),
    { type: 'hint', x: 43, y: 16, text: 'Дуги гаснут волной — бегите за ней', range: 4 },
    'D — cargo lock: door needs BOTH plates. Crate 1 → plate A (pushed against the kerb); Mira on plate B opens the chute → crate 2 drops onto her → step aside, it lands on B',
    { type: 'plate', id: 'pA', x: 87, y: 18, targets: ['lock', 'chute'] },
    { type: 'plate', id: 'pB', x: 90, y: 18, targets: ['lock', 'chute'] },
    { type: 'door', id: 'chute', x: 90, y: 14, w: 1, h: 1 },
    { type: 'door', id: 'lock', x: 100, y: 16, h: 3 },
    { type: 'sign', x: 84, y: 18, title: 'Грузовой шлюз', text: 'Створ открыт, пока прижаты ОБЕ плиты.\nГруз подаётся из бункера сверху.' },
    'E1 — rhythm 2: hop pillar to pillar; arcs between the pillars go off one after another (period 2.4, on 1.0, step 0.7 s)',
    ...wave([114, 119, 124, 129], 6, 2.4, 1.0, 0.7),
    'E2 — shuttle + lift over acid',
    'both cycles are 7.2 s and phase-locked: the shuttle reaches its far end just as the lift bottoms out',
    { type: 'mplatform', x: 136, y: 17, w: 3, path: [[136, 17], [142, 17]], speed: 2, pause: 0.6 },
    { type: 'mplatform', x: 147, y: 12, w: 3, path: [[147, 12], [147, 18]], speed: 2, pause: 0.6 },
    'G — chimney arc: off 1.8 s of every 2.4 s',
    { type: 'laser', x: 181, y: 6, dir: 'left', period: 2.4, on: 0.6 },
    { type: 'hint', x: 179, y: 10, text: 'Прыгайте от стены к стене', range: 3 },
  ],
  triggers: [
    { x: 17, y: 15, w: 2, h: 4, dialogue: 'l05_acid', objective: 'Пройдите стоки, не касаясь кислоты' },
    { x: 92, y: 15, w: 3, h: 4, requires: 'pA', say: [['lum', 'thinking', 'Бип. Одна плита прижата. На вторую встань сама — посмотрим, что будет.']] },
    { x: 104, y: 15, w: 2, h: 4, say: [['mira', 'determined', 'Ящик вместо меня. Сойдёт.']] },
    { x: 134, y: 14, w: 1, h: 4, say: [['lum', 'alert', 'Платформы ходят сами. Прыгай, когда подъедут.']] },
    { x: 158, y: 8, w: 2, h: 4, dialogue: 'l05_footprints', objective: 'Выберитесь на поверхность' },
    { x: 189, y: 0, w: 2, h: 3, dialogue: 'l05_end' },
  ],
  decor: [
    { kind: 'pipe_outlet', x: 2, y: 12 }, { kind: 'glow_moss', x: 8, y: 12 }, { kind: 'stalagmite', x: 15, y: 18 },
    { kind: 'mushroom', x: 25, y: 18 }, { kind: 'glow_moss', x: 35, y: 18 }, { kind: 'stalagmite', x: 40, y: 18 },
    { kind: 'pipe_outlet', x: 48, y: 18 }, { kind: 'glow_moss', x: 60, y: 18 }, { kind: 'mushroom', x: 70, y: 18 },
    { kind: 'pipe_outlet', x: 79, y: 18 }, { kind: 'stalagmite', x: 95, y: 18 }, { kind: 'mushroom', x: 107, y: 18 },
    { kind: 'glow_moss', x: 132, y: 17 }, { kind: 'stalagmite', x: 153, y: 11 },
    { kind: 'footprints', x: 157, y: 11 }, { kind: 'footprints', x: 160, y: 11 }, { kind: 'footprints', x: 163, y: 11 },
    { kind: 'footprints', x: 166, y: 11 }, { kind: 'mushroom', x: 170, y: 11 }, { kind: 'glow_moss', x: 175, y: 11 },
    { kind: 'stalagmite', x: 186, y: 2 }, { kind: 'glow_moss', x: 192, y: 2 },
  ],
};
module.exports = { g, def };
if (require.main === module) {
  const header = `/**
 * l05 «Затопленные стоки» (caves) — Chapter 1-5.
 * New: acid. Rhythm arcs (offset waves), a two-plate cargo lock, shuttle + lift over acid, chimney with an arc.
 *
 * ROUTE (QA): P → steps down → l05_acid → hop channel 1 (2 wide) and channel 2 via the stone → C1 (37) →
 * arc corridor: 6 arcs at x46..66, period 2.0/on 0.9, each one goes off 0.5 s after the previous → run right behind
 * the wave, or stop in any gap between arcs (all gaps are safe floor) → C2 (77) cargo lock:
 *   push crate 1 (81) right until it stops against the kerb (88) — that is plate A (87) → hop the kerb, stand on
 *   plate B (90): A+B open the door AND the bunker chute above B → crate 2 drops onto Mira's head → step off,
 *   it lands on B → door 'lock' (100) stays open → C3 (103) [crates are snapshotted on the plates here].
 * → acid lake: pillars 116-117, 121-122, 126-127, ledge 131; gaps of 3 tiles, each with an arc (period 2.4, on 1.0,
 *   each next arc off 0.7 s later) → wait on a pillar for the arc ahead to go dark, then hop → C4 (133) →
 *   shuttle 136↔142 (row 17) → hop the 2-tile gap to the lift 147-149 (rows 12↔18; the two are phase-locked, the lift
 *   is low whenever the shuttle waits at its far end) → ride up, step right onto the ledge (150) → C5 (154)
 *   → boot prints + l05_footprints → C6 (174) → chimney 178-180: wall-jump between x177 and x181; the arc at row 6
 *   is OFF 1.8 s of every 2.4 s (start climbing right after it fires) → top (stand row 2) → l05_end → exit (196,2).
 * SHARDS: (124,13) full-height jump in the middle arc column; (148,7) jump from the lift at its top;
 *   (177,1) on top of the hanging chimney wall (jump left from the chimney top).
 */`;
  emit('/home/user/Claude-Code-Game-Studios/src/js/levels/l05.js', header, def, g);
  console.log('written');
}
