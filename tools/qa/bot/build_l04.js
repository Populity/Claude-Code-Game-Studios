const { Grid, emit } = require('./lb');
const W = 200, H = 22;
const g = new Grid(W, H);
// ---------- A: entrance (0-24)
g.r(0, 17, 24, 21); g.r(14, 16, 24, 16);
g.s(3, 16, 'P');
// ---------- B: glyph plaza (25-40)
g.r(25, 16, 40, 21);
// ---------- C: crumble bridge over spike pit (41-60)
g.r(41, 21, 60, 21); g.r(41, 20, 60, 20, '^');
g.r(41, 16, 47, 16, 'X');           // crumble run, flush with floor
g.r(48, 16, 49, 21);                // stone stub (rest point)
g.r(52, 14, 53, 14, 'X');           // stepping crumbles, rising
g.r(56, 13, 57, 13, 'X');
g.s(45, 11, '*');                   // shard 1: full-height jump mid-run (crumbles keep falling)
// ---------- D: laser corridor (61-96)
g.r(61, 16, 96, 21);
g.s(63, 15, 'C');
g.r(66, 0, 92, 10);                 // corridor ceiling
g.r(75, 14, 76, 15);                // hurdle in pocket 1
g.r(83, 15, 84, 15, '^');           // spikes in pocket 2
// ---------- E: gate courtyard (97-130)
g.r(97, 16, 130, 21);
g.s(98, 15, 'C');
g.r(109, 8, 116, 9);                // zenith ledge
g.r(120, 5, 121, 5);                // shard perch
g.s(121, 4, '*');                   // shard 2
g.r(129, 0, 130, 12);               // gate wall (door below at rows 13-15)
// ---------- F: sanctum (131-150)
g.r(131, 0, 152, 9);                // sanctum ceiling
g.r(131, 16, 140, 21);
g.s(133, 15, 'C');
g.r(141, 21, 148, 21); g.r(141, 20, 148, 20, '^');   // chasm (bridge 'span' covers row 16)
g.r(149, 16, 153, 21);
g.s(151, 15, 'C');
// ---------- G: final gallery (154-199)
g.r(154, 21, 174, 21); g.r(154, 20, 174, 20, '^');
g.r(164, 16, 166, 21);              // pillar P1 (stand row 15)
g.r(166, 6, 170, 7);                // broken lintel holding the laser
g.r(170, 16, 171, 16, 'X');         // crumble pair after the laser
g.r(175, 15, 199, 21);              // exit terrace (stand row 14)
g.r(172, 20, 174, 20, '^');
g.r(180, 3, 180, 11); g.r(184, 3, 184, 11);   // optional chimney (walk under rows 12-14)
g.s(182, 3, '*');                   // shard 3 at the chimney top

g.s(178, 14, 'C');
g.s(195, 14, 'E');

const def = {
  id: 'l04', chapter: 'Глава 1 · Тессера', chapterShort: '1-4', title: 'Врата Зодчих', biome: 'ruins', drone: true,
  objective: 'Исследуйте руины Зодчих', startDialogue: 'l04_start',
  entities: [
    'B — glyph plaza: lore tablet',
    { type: 'sign', x: 37, y: 15, title: 'Скрижаль у входа', text: 'Путник, мы не боимся тебя.\nМы оставили двери открытыми. Тому, кто умеет читать, они откроются.' },
    'D — laser corridor: alternating arcs with safe pockets (period 2.4 s, on 1.0 s)',
    { type: 'laser', x: 71, y: 11, dir: 'down', period: 2.4, on: 1.0, offset: 0 },
    { type: 'laser', x: 79, y: 11, dir: 'down', period: 2.4, on: 1.0, offset: 1.2 },
    { type: 'laser', x: 87, y: 11, dir: 'down', period: 2.4, on: 1.0, offset: 0 },
    { type: 'hint', x: 68, y: 14, text: 'Дуги гаснут по очереди. Ждите в нишах между ними', range: 4 },
    'E — courtyard: three clue tablets + code gate',
    { type: 'sign', x: 101, y: 15, title: 'Скрижаль Восхода', text: 'Я — Восход, первый из трёх стражей.\nМоя цифра вдвое больше цифры Заката.' },
    { type: 'mplatform', id: 'zlift', x: 106, y: 15, w: 3, path: [[106, 15], [106, 8]], speed: 2, pause: 1.2 },
    { type: 'sign', x: 113, y: 7, title: 'Скрижаль Зенита', text: 'Я — Зенит, второй страж, я стою выше всех.\nМоя цифра нечётна и больше цифры Восхода.' },
    { type: 'sign', x: 122, y: 15, title: 'Скрижаль Врат', text: 'Назови трёх стражей по порядку: Восход, Зенит, Закат. У каждого стража — одна цифра.\nВместе их цифры дают пятнадцать. Закат молчит — о нём скажут другие.' },
    { type: 'terminal', x: 126, y: 15, targets: ['gate'], onSolve: 'l04_message', objective: 'Пройдите во внутреннее святилище',
      puzzle: { type: 'code', code: '492', title: 'Врата Зодчих', hint: 'Восход · Зенит · Закат. Цифры стражей записаны на трёх скрижалях во дворе.' } },
    { type: 'door', id: 'gate', x: 129, y: 13, w: 2, h: 3 },
    'F — sanctum: lights matrix powers the light bridge',
    { type: 'terminal', x: 138, y: 15, targets: ['span'], objective: 'Перейдите по световому мосту',
      puzzle: { type: 'lights', n: 3, presses: 4, title: 'Матрица моста', subtitle: 'Кристаллы питают мост. Зажгите все девять.' } },
    { type: 'bridge', id: 'span', x: 141, y: 16, w: 8 },
    'G — gallery: lift over spikes, arc + crumble jump, terrace',
    { type: 'mplatform', x: 154, y: 16, w: 3, path: [[154, 16], [161, 16]], speed: 2.5, pause: 0.6 },
    { type: 'laser', x: 168, y: 8, dir: 'down', period: 2.0, on: 0.8 },
    { type: 'sign', x: 191, y: 14, title: 'Последняя скрижаль', text: 'Дальше — Стоки. Вода ушла, осталась горечь.\nМы ждали. Мы ждём.' },
  ],
  triggers: [
    { x: 30, y: 12, w: 3, h: 4, dialogue: 'l04_glyphs', objective: 'Доберитесь до Врат Зодчих' },
    { x: 43, y: 12, w: 2, h: 4, say: [['lum', 'alert', 'Бип! Камень хрупкий. Не останавливайся.']] },
    { x: 99, y: 11, w: 2, h: 5, objective: 'Найдите три скрижали и откройте Врата', say: [['mira', 'thinking', 'Кодовый замок. И три таблички вокруг… ЛЮМ, читаем всё.']] },
    { x: 150, y: 12, w: 2, h: 4, requires: 'span', say: [['lum', 'happy', 'Мост держит! Дальше — к свету.']] },
    { x: 186, y: 11, w: 2, h: 4, dialogue: 'l04_end', objective: 'Пройдите к выходу из руин' },
  ],
  decor: [
    { kind: 'arch', x: 9, y: 16 }, { kind: 'pillar', x: 5, y: 16 }, { kind: 'broken_pillar', x: 13, y: 16 },
    { kind: 'vines', x: 20, y: 15 }, { kind: 'statue', x: 27, y: 15 },
    { kind: 'glyph_wall', x: 33, y: 15 }, { kind: 'broken_pillar', x: 39, y: 15, flip: true },
    { kind: 'pillar', x: 62, y: 15 }, { kind: 'vines', x: 67, y: 15 }, { kind: 'glyph_wall', x: 82, y: 15 },
    { kind: 'statue', x: 94, y: 15 }, { kind: 'arch', x: 100, y: 15 }, { kind: 'pillar', x: 104, y: 15 },
    { kind: 'vines', x: 112, y: 9, layer: 'front' }, { kind: 'statue', x: 118, y: 15 }, { kind: 'glyph_wall', x: 124, y: 15 },
    { kind: 'glyph_wall', x: 135, y: 15, scale: 1.3 }, { kind: 'statue', x: 151, y: 15, flip: true },
    { kind: 'broken_pillar', x: 165, y: 15 }, { kind: 'arch', x: 189, y: 14 }, { kind: 'pillar', x: 197, y: 14 },
    { kind: 'vines', x: 177, y: 14 },
  ],
};
module.exports = { g, def };
if (require.main === module) {
  const header = `/**
 * l04 «Врата Зодчих» (ruins) — Chapter 1-4.
 * Teach → test → twist: crumble run, alternating arcs, lift, code riddle, lights matrix, arc+crumble jump.
 *
 * ROUTE (QA): P → glyph wall (trigger l04_glyphs) → crumble run over spikes (don't stop; stone stub at x48-49
 * is the only rest) → C1 (63) → arc corridor: wait in the two pockets, each arc is off 1.4 s of every 2.4 s →
 * C2 (98) courtyard → read Восход tablet (101), ride lift (106) up to the Зенит tablet (113,7), read the Врата tablet
 * (122) → code terminal (126) → gate opens (l04_message) → C3 (133) → lights terminal (138) powers bridge 'span' →
 * ride the shuttle platform (154→161) → pillar (164-166) → wait for the arc at x168 to go off (period 2.0, on 0.8)
 * → jump to the crumble pair (170-171) → jump on to the terrace (175+) → C5 (178) → l04_end → exit (195).
 *
 * CODE RIDDLE (answer 492): Восход = 2·Закат; Зенит odd and > Восход; Восход+Зенит+Закат = 15.
 *   3·Закат + Зенит = 15 → Закат=1: Зенит=12 ✗; Закат=2: Восход=4, Зенит=9 ✓ (odd, >4); Закат=3: Зенит=6 ✗ (even);
 *   Закат=4: Восход=8, Зенит=3 ✗ (<8); Закат≥5 ✗. Unique: 4-9-2.
 * LIGHTS: 3×3, seeded, solvable by construction (4 presses scramble).
 * SHARDS: (45,11) full-height jump mid crumble-run; (121,4) leap from the Зенит ledge to the perch;
 *   (182,3) optional wall-jump chimney above the terrace.
 */`;
  emit('/home/user/Claude-Code-Game-Studios/src/js/levels/l04.js', header, def, g);
  console.log('written');
}
