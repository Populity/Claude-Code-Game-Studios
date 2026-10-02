const { Grid } = require('./lib.js');
const W = 44, H = 100;
const g = new Grid(W, H);
g.rect(0, 0, W - 1, 0); g.rect(0, 96, W - 1, 99);
g.rect(0, 0, 0, 99); g.rect(W - 1, 0, W - 1, 99);

// ---------------- Z1 base (row 96 → C1 floor row 74)
g.set(3, 95, 'P');
g.rect(17, 84, 42, 95);            // tower core (right) = shaft A right wall
g.rect(12, 86, 12, 93);            // shaft A left wall (entry rows 94-95)
g.rect(6, 85, 12, 85);             // ledge on top of the left wall
g.put(2, 82, 'XXX');               // crumbling stair
g.rect(6, 79, 10, 79);
g.put(12, 76, 'XXX');
g.set(3, 79, '*');                 // shard: full jump off the crumbling stair (fall = back to the ground)
g.rect(1, 74, 42, 74, '='); g.set(8, 73, 'C');
g.rect(7, 74, 9, 74);              // solid under C1

// ---------------- Z2 crumbles + pulsing lasers (C1 row 74 → C2 floor row 55)
g.put(13, 71, 'XXX');
g.put(18, 68, 'XXX');
g.rect(23, 66, 26, 66);            // rest ledge (wait for laser 1)
g.put(28, 63, 'XXXX');
g.put(34, 60, 'XXX');
g.rect(38, 58, 42, 58);            // rest
g.rect(27, 56, 31, 56); g.rect(35, 56, 36, 56); // laser housings (ceiling blocks)
g.set(29, 60, '*');                // shard: above crumble c, inside laser 1 path
g.rect(1, 55, 42, 55, '='); g.rect(40, 55, 42, 55); g.set(40, 54, 'C');

// ---------------- Z3 lifts + saw (C2 row 55 → C3 floor row 37)
g.rect(27, 44, 32, 44);            // ledge A (saw patrols it)
g.rect(1, 37, 42, 37, '='); g.rect(14, 37, 20, 37); g.set(17, 36, 'C');

// ---------------- Z4 storm shaft (C3 row 37 → C4 floor row 20)
g.rect(8, 21, 8, 36);              // shaft B left wall
g.rect(13, 21, 13, 34);            // shaft B right wall (entry rows 35-36)
g.set(9, 31, '#');                 // rest ledge 1 (left)
g.set(12, 26, '#');                // rest ledge 2 (right)
g.rect(1, 21, 7, 36);              // fill left of shaft
g.clear(5, 24, 8, 25); g.set(6, 25, '*'); // shard pocket behind laser row
g.rect(1, 20, 42, 20, '='); g.rect(8, 20, 13, 20, '='); g.rect(14, 20, 18, 20); g.set(16, 19, 'C');

// ---------------- Z5 summit (C4 row 20 → exit row 6)
g.put(21, 17, 'XXX');
g.put(25, 14, 'XXX');
g.rect(28, 12, 30, 12); g.set(29, 11, 'C'); // rest + C5 before saw
g.put(31, 12, 'XXXX');
g.rect(37, 6, 42, 6);              // summit (lift M3 at x35-36 rows 12→7)
g.set(40, 5, 'E');

module.exports = { g, W, H };

const def = {
  id: 'l09', chapter: 'Глава 1 · Тессера', chapterShort: '1-9', title: 'Шпиль', biome: 'tower', drone: true,
  objective: 'Поднимитесь на вершину Шпиля', startDialogue: 'l09_start',
  entities: [
    'Z1 base: wall-jump shaft A (x13-16), crumbling stair',
    { type: 'hint', x: 14, y: 93, text: 'Прыгайте от стены к стене, чтобы подняться', range: 4 },
    { type: 'sign', x: 5, y: 95, title: 'Глифы у подножия', text: 'ЛЮМ переводит:\n«Поднимись — и тебя услышат. Каждый уровень Шпиля держит тех, кто упал: падение — не конец пути».' },
    'Z2: crumbling steps under two pulsing lasers',
    { type: 'laser', x: 29, y: 57, dir: 'down', period: 2.4, on: 1.0 },
    { type: 'laser', x: 35, y: 57, dir: 'down', period: 2.4, on: 1.0, offset: 1.2 },
    { type: 'hint', x: 24, y: 64, text: 'Ждите на камне, пока луч погаснет', range: 4 },
    'Z3: lifts and a patrolling saw',
    { type: 'mplatform', x: 36, y: 54, w: 3, path: [[36, 54], [36, 44]], speed: 2, pause: 1.0 },
    { type: 'saw', x: 27, y: 43, path: [[27, 43], [32, 43]], speed: 2, pause: 0.5 },
    { type: 'mplatform', x: 21, y: 44, w: 3, path: [[21, 44], [21, 38]], speed: 1.5, pause: 1.0 },
    'Z4: storm shaft B (x9-12) with two pulsing horizontal lasers and rest ledges',
    { type: 'laser', x: 8, y: 28, dir: 'right', period: 2.6, on: 1.1 },
    { type: 'laser', x: 13, y: 23, dir: 'left', period: 2.6, on: 1.1, offset: 1.3 },
    { type: 'sign', x: 19, y: 36, title: 'Табличка Зодчих', text: 'Глифы стёрты ветром. ЛЮМ собирает уцелевшие:\n«…МЫ ПОДНИМАЛИСЬ… СНОВА… КАЖДЫЙ РАЗ ВЫШЕ… КАЖДЫЙ РАЗ ТЕ ЖЕ…»\nДальше — только царапины. Человеческие.' },
    'Z5 summit: crumbling stair, vertical saw, lift M3 to the top',
    { type: 'saw', x: 32, y: 5, path: [[32, 5], [32, 10]], speed: 2.5, pause: 0.8 },
    { type: 'mplatform', x: 35, y: 12, w: 2, path: [[35, 12], [35, 7]], speed: 2, pause: 1.4 },
  ],
  triggers: [
    { x: 9, y: 92, w: 3, h: 4, dialogue: 'l09_storm', sound: 'wind', shake: 6, objective: 'Поднимайтесь. Ярусы ловят падающих' },
    { x: 1, y: 70, w: 11, h: 3, sound: 'wind', shake: 4, say: [['orion', 'neutral', 'Лучи пульсируют. Ступени осыпаются. Рекомендую не совмещать.']] },
    { x: 30, y: 50, w: 12, h: 4, dialogue: 'l09_halfway' },
    { x: 14, y: 33, w: 6, h: 3, sound: 'wind', shake: 7, say: [['mira', 'scared', 'Шахта. Конечно, шахта. Вверх, сквозь лучи.'], ['lum', 'determined', 'Камни-уступы! Там ждать. Бип.']] },
    { x: 14, y: 16, w: 5, h: 3, sound: 'wind', shake: 8, objective: 'Доберитесь до вершины', say: [['lum', 'alert', 'Вершина! Пила, ступени, лифт. Всё сразу!']] },
    { x: 36, y: 2, w: 3, h: 4, dialogue: 'l09_top' },
  ],
  decor: [
    { kind: 'glyph_wall', x: 6, y: 95 }, { kind: 'cable_bundle', x: 10, y: 95 }, { kind: 'antenna', x: 24, y: 83 },
    { kind: 'storm_rod', x: 3, y: 73 }, { kind: 'cable_bundle', x: 11, y: 73 }, { kind: 'storm_rod', x: 25, y: 65 },
    { kind: 'glyph_wall', x: 41, y: 57 }, { kind: 'antenna', x: 42, y: 54 }, { kind: 'cable_bundle', x: 30, y: 43 },
    { kind: 'storm_rod', x: 4, y: 36 }, { kind: 'glyph_wall', x: 15, y: 36 }, { kind: 'cable_bundle', x: 2, y: 54 },
    { kind: 'antenna', x: 18, y: 19 }, { kind: 'storm_rod', x: 29, y: 11 }, { kind: 'antenna', x: 42, y: 5 },
    { kind: 'storm_rod', x: 38, y: 5 }, { kind: 'cable_bundle', x: 2, y: 19 }, { kind: 'glyph_wall', x: 6, y: 25 },
  ],
};
module.exports.def = def;
