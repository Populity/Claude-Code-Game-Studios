const { Grid, emit } = require('./lb');
const W = 190, H = 26;
const g = new Grid(W, H);
// ---------- A: outside, sand (0-17) + breach steps (18-24)
g.r(0, 21, 17, 25); g.s(3, 20, 'P');
g.r(18, 0, 73, 10);                 // hull above the cryo bay
g.r(18, 20, 19, 25); g.r(20, 19, 21, 25); g.r(22, 18, 23, 25);   // tilted steps into the breach
// ---------- B: cryo bay (24-70), floor row 17 (stand 16), open rows 11-16
g.r(24, 17, 95, 18);                // cryo deck = hold ceiling
g.r(48, 17, 50, 18, '.');           // broken deck: drop into the hold
g.r(70, 11, 70, 16);                // bay wall (beyond: return corridor)
g.s(27, 16, 'C');
// ---------- C: cargo hold (24-99), floor row 24 (stand 23), open rows 19-23
g.r(18, 24, 99, 25);
g.s(26, 23, '*');                   // shard 1: behind the storage arc
g.s(52, 23, 'C');
g.r(56, 25, 60, 25, '~'); g.r(56, 24, 60, 24, 'X');   // coolant pool under a crumbling grating
g.r(72, 24, 75, 25, '~');           // coolant pool (4 wide jump, low ceiling)
g.s(89, 23, 'C');
// shaft (97-99): left wall x96 rows 15-20, right wall x100 rows 11-25, capped by the upper deck at rows 9-10
g.r(96, 15, 96, 20);
g.r(100, 11, 100, 25);
g.s(98, 11, '*');                   // shard 2: top of the shaft
// ---------- D: return corridor (71-95), stand 16
g.r(74, 9, 100, 10);                // upper deck floor over corridor + shaft
g.r(74, 9, 76, 10, '.');            // lift hole
// ---------- E: upper deck (74-189), floor row 9 (stand 8), open rows 3-8
g.r(74, 0, 189, 2);
g.r(101, 9, 189, 25);               // hull mass under the upper deck
g.s(79, 8, 'C');
g.r(90, 8, 99, 8);                  // raised deck section (stand 7)
// broken deck over the breach
g.r(104, 9, 127, 14, '.'); g.r(104, 15, 127, 15, '^');
g.s(106, 9, 'X'); g.s(107, 9, 'X');            // crumbling plates
g.r(111, 8, 112, 14);               // girder stub (stand 7) — wait here for the blade
g.r(116, 9, 117, 14);               // strut (stand 8)
g.s(122, 5, '*');                   // shard 3: jump from the moving plate
g.s(130, 8, 'C');
g.s(152, 8, 'C');
g.r(162, 9, 170, 14, '.'); g.r(162, 15, 170, 15, '^');
g.r(162, 9, 165, 9, 'X'); g.r(168, 9, 170, 9, 'X');
g.s(185, 8, 'E');

const wave = (xs, y, period, on, delta) => xs.map((x, k) => ({ type: 'laser', x, y, dir: 'down', period, on, offset: +(((period - k * delta) % period + period) % period).toFixed(2) }));
const def = {
  id: 'l06', chapter: 'Глава 1 · Тессера', chapterShort: '1-6', title: 'Обломки «Ковчега»', biome: 'wreck', drone: true,
  objective: 'Проникните в криоотсек', startDialogue: 'l06_start',
  entities: [
    { type: 'sign', x: 45, y: 16, title: 'Пульт криоотсека', text: 'КРИОСЕКЦИЯ Б. Капсул: 2000. Жизнеобеспечение: РЕЗЕРВ 4%.\nОСНОВНАЯ ЯЧЕЙКА: НЕ ОБНАРУЖЕНА. Запасные ячейки — трюм, сектор 9.' },
    { type: 'sign', x: 64, y: 16, title: 'Табличка на капсуле', text: 'Капсула 0417. Орлов Тимофей, 22 года. Биолог-агроном.\nСостояние: стабильное.' },
    'C — hold: storage arc guards shard 1',
    { type: 'laser', x: 32, y: 19, dir: 'down', period: 2.0, on: 1.0 },
    { type: 'laser', x: 64, y: 19, dir: 'down', period: 2.0, on: 0.8, offset: 0 },
    { type: 'laser', x: 68, y: 19, dir: 'down', period: 2.0, on: 0.8, offset: 1.0 },
    { type: 'saw', x: 81, y: 19, path: [[81, 19], [81, 23]], speed: 2.5, pause: 0.5 },
    { type: 'part', x: 93, y: 23, item: 'cell', objective: 'Отнесите ячейку к силовому узлу наверху', onPickup: undefined },
    { type: 'hint', x: 98, y: 21, text: 'Прыгайте от стены к стене', range: 3 },
    'D — return corridor (carrying the cell: dying sends it back to sector 9)',
    { type: 'laser', x: 90, y: 11, dir: 'down', period: 2.2, on: 0.9, offset: 0 },
    { type: 'laser', x: 84, y: 11, dir: 'down', period: 2.2, on: 0.9, offset: 1.1 },
    { type: 'saw', x: 79, y: 11, path: [[79, 11], [79, 16]], speed: 2.5, pause: 0.6 },
    { type: 'socket', x: 72, y: 16, needs: 'cell', targets: ['lift', 'exit'], onRepair: 'l06_orion', objective: 'Поднимитесь на инженерную палубу' },
    { type: 'mplatform', id: 'lift', x: 74, y: 16, w: 3, path: [[74, 16], [74, 9]], speed: 3, pause: 1.2 },
    'E — upper deck: arc wave, broken deck over the breach, pipes terminal, exit',
    ...wave([84, 88, 92, 96], 3, 2.0, 0.8, 0.5),
    { type: 'saw', x: 114, y: 4, path: [[114, 4], [114, 11]], speed: 3, pause: 0.5 },
    { type: 'mplatform', x: 118, y: 9, w: 3, path: [[118, 9], [125, 9]], speed: 2, pause: 0.6 },
    { type: 'terminal', x: 146, y: 8, targets: ['exit'], onSolve: 'l06_plan', objective: 'Шлюз открыт — к выходу',
      puzzle: { type: 'pipes', w: 7, h: 5, title: 'Магистраль криосекции', subtitle: 'Проведите энергию от новой ячейки к капсулам. Каждый сегмент поворачивается.' } },
    { type: 'laser', x: 158, y: 3, dir: 'down', period: 2.0, on: 0.8 },
    { type: 'sign', x: 182, y: 8, title: 'Аварийный шлюз', text: 'Открывается только при восстановленном питании и магистрали.' },
  ],
  triggers: [
    { x: 33, y: 12, w: 2, h: 5, dialogue: 'l06_cryo', objective: 'Найдите энергоячейку в трюме' },
    { x: 49, y: 20, w: 2, h: 4, say: [['lum', 'alert', 'Бип! Трюм. Искрит. Ячейки — в дальнем конце.']] },
    { x: 95, y: 11, w: 1, h: 4, say: [['mira', 'determined', 'Силовой узел где-то слева. Только не урони, ЛЮМ.'], ['lum', 'happy', 'Несёшь ты. Бип.']] },
    { x: 140, y: 5, w: 2, h: 4, objective: 'Восстановите магистраль на терминале' },
    { x: 178, y: 5, w: 2, h: 4, dialogue: 'l06_end' },
  ],
  decor: [
    { kind: 'hull_breach', x: 12, y: 20 }, { kind: 'cable_bundle', x: 8, y: 20 }, { kind: 'warning_light', x: 21, y: 18 },
    { kind: 'cryo_pod', x: 30, y: 16 }, { kind: 'cryo_pod', x: 37, y: 16 }, { kind: 'cryo_pod', x: 41, y: 16 },
    { kind: 'console', x: 45, y: 16 }, { kind: 'cryo_pod', x: 55, y: 16 }, { kind: 'cryo_pod', x: 59, y: 16 },
    { kind: 'cryo_pod', x: 64, y: 16 }, { kind: 'warning_light', x: 52, y: 16 },
    { kind: 'locker', x: 24, y: 23 }, { kind: 'locker', x: 29, y: 23 }, { kind: 'crate_stack', x: 40, y: 23 },
    { kind: 'pipes', x: 62, y: 23 }, { kind: 'cable_bundle', x: 77, y: 23 }, { kind: 'crate_stack', x: 91, y: 23 },
    { kind: 'pipes', x: 87, y: 16 }, { kind: 'console', x: 71, y: 16 },
    { kind: 'locker', x: 82, y: 8 }, { kind: 'hull_breach', x: 115, y: 8 }, { kind: 'pipes', x: 134, y: 8 },
    { kind: 'console', x: 144, y: 8 }, { kind: 'cable_bundle', x: 149, y: 8 }, { kind: 'warning_light', x: 175, y: 8 },
    { kind: 'fan', x: 135, y: 5 },
  ],
};
module.exports = { g, def };
if (require.main === module) {
  const header = `/**
 * l06 «Обломки «Ковчега»» (wreck) — Chapter 1-6. The cryo section, tilted in the sand.
 * Carry an energy cell through a hazard loop (dying returns it), then a big 7×5 pipes terminal. Exit needs both.
 *
 * ROUTE (QA): P (sand) → hop up the tilted steps → C1 (27) cryo bay, l06_cryo → drop through the broken deck (48-50)
 * → C2 (52) hold: crumbling grating over coolant (56-60, keep running) → sparks x64/x68 alternate (period 2.0, on 0.8, offsets 0/1.0)
 * → 4-wide coolant jump (72-75) → pass under the vertical blade x81 while it is up → C3 (89) → take the CELL (93) →
 * wall-jump up the shaft (x96 wall rows 15-20 ↔ x100 wall) → land on the x96 wall top (stand 14) → corridor going left:
 * sparks x90/x84 (period 2.2, on 0.9, alternate) and blade x79 (vertical) → socket (72): l06_orion, lift + exit power
 * → ride the lift (74) up → C4 (79) upper deck: 4-arc wave (x84..96, period 2.0, each next arc off 0.5 s later) →
 * crumbling plates (106-107) → girder (111-112, wait) → time the vertical blade x114 (it rests 0.5 s at each end) →
 * strut (116-117) → moving plate 118↔125 (flush with strut and deck) → C5 (130) → pipes terminal (146): l06_plan → C6 (152) → arc x158 →
 * crumbling bridge 162-165 / jump / 168-170 → l06_end → exit (185).
 * PIPES: 7×5, seeded, solvable by construction. Exit 'exit' is wired to BOTH the socket and the terminal.
 * SHARDS: (26,23) behind the storage arc x32 in the hold's dead end; (98,11) climb to the very top of the shaft;
 *   (122,5) jump from the moving plate over the spikes.
 */`;
  emit('/home/user/Claude-Code-Game-Studios/src/js/levels/l06.js', header, def, g);
  console.log('written');
}
