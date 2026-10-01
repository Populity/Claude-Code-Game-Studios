const { Grid, emit } = require('./lb');
const W = 210, H = 30;
const g = new Grid(W, H);
g.r(0, 0, 209, 1);                  // cave ceiling
// ---------- A: entry (0-33)
g.r(0, 26, 33, 29); g.s(3, 25, 'P');
// ---------- B: lever lift up the cliff, pillar with a looping blade (34-55)
g.r(34, 17, 55, 29);                // cliff (stand 16)
g.r(40, 14, 41, 16);                // crystal pillar (stand 13)
g.s(40, 11, '*');                   // shard 1: above the pillar, inside the blade's loop
g.s(47, 16, 'C');
// ---------- C: wall-jump chimney (53-55) between x52 (hanging) and the x56 pillar
g.r(52, 3, 52, 14);
g.r(56, 6, 80, 29);                 // pillar + gallery mass (gallery stand 5)
g.r(62, 6, 63, 6, '.');             // trench: duck under the blade
g.s(74, 5, 'C');
// ---------- E: cavern + logic gate (81-114)
g.r(81, 26, 114, 29);
g.r(83, 15, 85, 15, '='); g.r(87, 20, 89, 20, '=');   // crystal shelves soften the drop
g.s(94, 25, 'C');
g.r(108, 2, 108, 22);               // crystal wall; gate door at rows 23-25
g.s(111, 25, 'C');
// ---------- F1: pillars over spikes with blades (115-132)
g.r(115, 29, 132, 29); g.r(115, 28, 132, 28, '^');
g.r(117, 24, 119, 28); g.r(123, 23, 124, 28); g.r(128, 23, 129, 28);
g.s(123, 19, '*');                  // shard 2: above the looping blade on the middle pillar
// ---------- F2: crate → plate → lift (133-151)
g.r(133, 24, 151, 29);              // ledge (stand 23)
g.s(135, 23, 'C');
g.s(138, 23, '#'); g.s(140, 23, 'B'); g.s(147, 23, '#');   // kerbs keep the crate between 139 and 146
// ---------- F3: plateau (152-209), stand 9
g.r(152, 10, 209, 29);
g.s(155, 9, 'C');
g.r(161, 2, 161, 7);                // hanging crystal
g.r(165, 4, 166, 9);                // crystal pillar (top stand 3)
g.s(163, 2, '*');                   // shard 3: top of the chimney
g.s(169, 9, 'C');
g.r(174, 10, 175, 10, '.');         // trench under the patrolling blade
g.s(204, 9, 'E');

const def = {
  id: 'l07', chapter: 'Глава 1 · Тессера', chapterShort: '1-7', title: 'Кристальные пещеры', biome: 'crystal', drone: true,
  objective: 'Пройдите сквозь кристальные пещеры', startDialogue: 'l07_start',
  entities: [
    'B — lever lift + looping blade around a crystal pillar',
    { type: 'lever', x: 28, y: 25, targets: ['l1'] },
    { type: 'mplatform', id: 'l1', x: 31, y: 25, w: 3, path: [[31, 25], [31, 17]], speed: 3, pause: 1.0 },
    { type: 'hint', x: 28, y: 23, text: 'Рычаг запускает подъёмник', range: 4 },
    { type: 'saw', x: 39, y: 13, path: [[39, 13], [42, 13], [42, 16], [39, 16]], mode: 'loop', speed: 3 },
    'D — gallery blade patrol: wait in the trench (62-63) while it passes overhead',
    { type: 'saw', x: 59, y: 4, path: [[59, 4], [67, 4]], speed: 3, pause: 0.2 },
    'E — logic gate',
    { type: 'sign', x: 95, y: 25, title: 'Поющий кристалл', text: 'Четыре струны — A, B, C, D. Три голоса должны звучать разом.\nКто поёт без лада — тот молчит.' },
    { type: 'terminal', x: 101, y: 25, targets: ['gate'], onSolve: 'l07_logic', objective: 'Пройдите за кристальную стену',
      puzzle: { type: 'logic', title: 'Резонансный контур', inputs: ['A', 'B', 'C', 'D'], outputs: [
        { label: 'Резонатор', expr: 'A ^ C' },
        { label: 'Фокус', expr: '!A ^ (C & D)' },
        { label: 'Затвор', expr: '(B | D) & !(A & C)' },
      ] } },
    { type: 'door', id: 'gate', x: 108, y: 23, h: 3 },
    'F1 — pillars: blade loops the middle pillar (4 s cycle), pendulum blade before the ledge',
    { type: 'saw', x: 122, y: 21, path: [[122, 21], [125, 21], [125, 24], [122, 24]], mode: 'loop', speed: 3 },
    { type: 'saw', x: 131, y: 18, path: [[131, 18], [131, 25]], speed: 3.5, pause: 0.3 },
    'F2 — crate on the plate runs the lift',
    { type: 'plate', x: 146, y: 23, targets: ['l2'] },
    { type: 'mplatform', id: 'l2', x: 149, y: 23, w: 3, path: [[149, 23], [149, 10]], speed: 3.5, pause: 0.8 },
    'F3 — chimney over the crystal pillar, blade patrol with a trench',
    { type: 'saw', x: 171, y: 7, path: [[171, 7], [179, 7]], speed: 3.5, pause: 0.2 },
    { type: 'sign', x: 199, y: 9, title: 'Последний кристалл', text: 'Мы звали не о помощи.\nМы звали в гости.' },
  ],
  triggers: [
    { x: 12, y: 22, w: 2, h: 4, dialogue: 'l07_crystals' },
    { x: 49, y: 13, w: 2, h: 4, say: [['lum', 'thinking', 'Стены близко. Прыжок — от стены к стене, бип.']] },
    { x: 58, y: 2, w: 1, h: 4, say: [['mira', 'scared', 'Пила по всей галерее… Та выемка в полу — укрытие.']] },
    { x: 92, y: 22, w: 2, h: 4, objective: 'Настройте резонансный контур' },
    { x: 136, y: 20, w: 2, h: 4, objective: 'Запустите подъёмник' },
    { x: 192, y: 6, w: 2, h: 4, dialogue: 'l07_end' },
  ],
  decor: [
    { kind: 'crystal_big', x: 9, y: 25 }, { kind: 'crystal_cluster', x: 15, y: 25 }, { kind: 'geode', x: 21, y: 25 },
    { kind: 'crystal_cluster', x: 25, y: 25, flip: true }, { kind: 'crystal_cluster', x: 36, y: 16 },
    { kind: 'crystal_big', x: 45, y: 16 }, { kind: 'crystal_cluster', x: 54, y: 16 }, { kind: 'geode', x: 70, y: 5 },
    { kind: 'crystal_cluster', x: 78, y: 5 }, { kind: 'crystal_big', x: 86, y: 25, scale: 1.4 }, { kind: 'geode', x: 98, y: 25 },
    { kind: 'crystal_cluster', x: 105, y: 25 }, { kind: 'crystal_big', x: 113, y: 25 }, { kind: 'crystal_cluster', x: 134, y: 23 },
    { kind: 'geode', x: 143, y: 23 }, { kind: 'crystal_big', x: 158, y: 9 }, { kind: 'crystal_cluster', x: 168, y: 9 },
    { kind: 'crystal_cluster', x: 184, y: 9 }, { kind: 'geode', x: 190, y: 9 }, { kind: 'crystal_big', x: 207, y: 9 },
  ],
};
module.exports = { g, def };
if (require.main === module) {
  const header = `/**
 * l07 «Кристальные пещеры» (crystal) — Chapter 1-7. The hardest chapter-1 level before the forest.
 * Lever lift, looping blades, wall-jump chimneys, a 4-input logic gate, crate-powered lift.
 *
 * ROUTE (QA): P → l07_crystals → lever (28) starts lift l1 (31) → ride up the cliff → blade loops the crystal pillar
 * (40-41) every 4 s (top → right side → bottom → left side): wait at x≤38, jump onto the pillar while the blade
 * runs down the RIGHT side, hop off right while it is on the bottom/left → C2 (47) → chimney 53-55: wall-jump between
 * x52 (hanging; walk in under it) and the x56 pillar, top out at stand 5 → gallery: blade patrols 59↔67 at head height;
 * follow it right, drop into the trench (62-63) while it passes back overhead, then run on → C3 (74) → drop into the
 * cavern (crystal shelves) → C4 (94) → logic terminal (101): l07_logic opens the gate (108) → C5 (111) → pillars over
 * spikes 117-119 / 123-124 / 128-129: the middle one is looped by a blade (same rhythm as before); the pendulum blade
 * x131 must be LOW when you jump to the ledge → C6 (135) → push the crate (140) right until it stops on the plate
 * (146, kerb 147) → hop the crate + kerb → ride lift l2 (149) up → C7 (155) → chimney 162-164 between the hanging
 * crystal x161 and pillar x165, top out on the pillar (stand 3) → drop right → C8 (169) → blade 171↔179: duck into the
 * trench (174-175) → l07_end → exit (204).
 * LOGIC (4 inputs, 3 outputs, exactly 1 of 16): Резонатор = A^C, Фокус = !A^(C&D), Затвор = (B|D)&!(A&C).
 *   A^C ⇒ A&C is false ⇒ Затвор = B|D. If A=1,C=0: Фокус = 0^0 = 0 ✗. So A=0,C=1: Фокус = 1^D ⇒ D=0; Затвор ⇒ B=1.
 *   ANSWER: A=0, B=1, C=1, D=0. (Any two outputs alone leave ≥2 solutions, so all three matter.)
 * SHARDS: (40,11) above the looped pillar; (123,19) above the looped middle pillar; (163,2) chimney top.
 */`;
  emit('/home/user/Claude-Code-Game-Studios/src/js/levels/l07.js', header, def, g);
  console.log('written');
}
