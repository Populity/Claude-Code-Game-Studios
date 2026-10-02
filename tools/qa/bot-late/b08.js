const { Grid, emit } = require('./lib.js');
const W = 200, H = 30;
const g = new Grid(W, H);
g.rect(0, 0, W - 1, 0);            // canopy
g.rect(0, 26, W - 1, 29);          // bedrock
g.rect(0, 0, 0, 29); g.rect(W - 1, 0, W - 1, 29);

// S0 start
g.rect(12, 24, 14, 25);
g.set(3, 25, 'P');
// S1 jump-pad teach: pad + 6-high cliff
g.set(27, 25, 'J');
g.rect(30, 20, 39, 25);
// S2 pad well (interior 41..44), doorway in left wall at rows 18-19
g.rect(40, 1, 40, 17); g.rect(40, 20, 40, 25);
g.clear(40, 12, 40, 13);           // window pocket (shard)
g.set(40, 13, '*');
g.set(42, 25, 'J'); g.set(43, 25, 'J');
g.rect(45, 11, 53, 25);            // right wall + plateau
g.set(50, 10, 'C');
// S3 crumbling bridges over spike pit, two saws
g.put(54, 11, 'XXXXX');
g.rect(61, 11, 62, 25);            // rest pillar
g.put(63, 11, 'XXXXXX');
g.rect(54, 25, 60, 25, '^'); g.rect(63, 25, 70, 25, '^');
g.set(64, 7, '*');
// S4 landing + helmet grove
g.rect(71, 11, 80, 25);
g.set(73, 10, 'C');
g.rect(81, 14, 86, 25);
g.rect(87, 19, 103, 25);
g.set(101, 18, 'C');
// S5 puzzle hall
g.rect(104, 0, 143, 5);            // hall ceiling
g.set(106, 25, 'J');               // back to the grove
g.rect(113, 9, 113, 21);           // shaft left pillar
g.set(115, 25, 'J');
g.rect(118, 15, 118, 21);          // shaft right wall + lip
g.rect(118, 16, 126, 17);          // crate shelf
g.set(124, 15, 'B');
g.rect(120, 26, 122, 27, '~');     // acid: crate reset / hazard
g.clear(129, 26, 130, 26);         // plate slot
g.set(133, 25, 'C');
g.rect(136, 6, 136, 22);           // hall right wall (door below)
g.rect(143, 6, 143, 25);           // alcove right wall
g.rect(140, 10, 151, 10);          // corridor floor
g.rect(140, 0, 151, 6);            // corridor ceiling
g.set(146, 9, 'C');
// S6 final gauntlet: pad chain over spikes, saw, crumbling ledge
g.rect(152, 25, 177, 25, '^');
g.rect(154, 18, 156, 25); g.set(156, 17, 'J');
g.rect(161, 18, 164, 25); g.set(164, 17, 'J'); g.set(162, 17, 'C');
g.rect(171, 18, 173, 25); g.set(173, 17, 'J');
g.set(180, 6, '*');
g.put(178, 11, 'XXXX');
g.rect(178, 25, 183, 25, '^');
g.rect(184, 9, 198, 25);
g.set(195, 8, 'E');

module.exports = { g, W, H };
if (require.main === module) console.log(g.view(0, 199));

// ---------------------------------------------------------------- definition
const def = {
  id: 'l08',
  chapter: 'Глава 1 · Тессера',
  chapterShort: '1-8',
  title: 'Механический лес',
  biome: 'ruins',
  variant: 'overgrown',
  drone: true,
  objective: 'Пройдите через механический лес',
  startDialogue: 'l08_start',
  entities: [
    'S1-S2: jump pads, then pad + wall-jump well',
    { type: 'hint', x: 26, y: 22, text: 'Прыжковая плита: просто встаньте на неё. В полёте держите ← →' },
    { type: 'hint', x: 37, y: 16, text: 'Плита подбросит — дальше прыгайте от стены к стене', range: 4 },
    'S3: crumbling bridges, two counter-phased saws',
    { type: 'saw', x: 56, y: 4, path: [[56, 4], [56, 9]], speed: 2.5, pause: 0.8 },
    { type: 'saw', x: 66, y: 9, path: [[66, 9], [66, 4]], speed: 2.5, pause: 0.8 },
    'S4: the helmet grove',
    { type: 'sign', x: 92, y: 18, title: 'Старый шлем', text: 'Человеческий шлем. Стекло в паутине трещин, металл изъеден окалиной, сквозь визор пророс тонкий медный побег.\nНа боку, под слоем ржавчины, — трафарет: «КОВЧЕГ-7 · БОРТИНЖЕНЕР».\nТочно такой же шлем остался в капсуле Миры. Только этому — несколько веков.' },
    { type: 'sign', x: 84, y: 13, title: 'Табличка Зодчих', text: 'ЛЮМ переводит, запинаясь:\n«Лес растёт сам. Мы лишь заводим его снова — каждый раз, когда вы приходите».' },
    'S5: crate + plate + lights puzzle hall',
    { type: 'sign', x: 108, y: 25, title: 'Пульт подъёмника', text: 'Глифы над дверью: «Путь к пульту открыт, пока плита под грузом».\nНиже, мельче: «Упавший в кислоту груз механизм вернёт на полку».' },
    { type: 'plate', id: 'hall_plate', x: 129, y: 26, w: 2, targets: ['hall_door'] },
    { type: 'door', id: 'hall_door', x: 136, y: 23, h: 3 },
    { type: 'terminal', x: 141, y: 25, puzzle: { type: 'lights', n: 4, presses: 5, title: 'Корневая матрица', subtitle: 'Пульт древнего подъёмника' }, targets: ['lift'], objective: 'Поднимитесь на подъёмнике' },
    { type: 'mplatform', id: 'lift', x: 137, y: 25, w: 3, path: [[137, 25], [137, 10]], speed: 2.5, pause: 1.2 },
    'S6: pad chain over spikes',
    { type: 'saw', x: 168, y: 8, path: [[168, 8], [168, 15]], speed: 2.5, pause: 0.4 },
  ],
  triggers: [
    { x: 51, y: 8, w: 2, h: 3, objective: 'Пересеките осыпающиеся мосты', say: [['lum', 'alert', 'Мост сыплется! Бежать, не стоять. Пила внизу — ждать.'], ['mira', 'determined', 'Ждать на камне, бежать по мосту. Поняла.']] },
    { x: 89, y: 15, w: 2, h: 4, dialogue: 'l08_helmet' },
    { x: 98, y: 15, w: 2, h: 4, dialogue: 'l08_doubt' },
    { x: 104, y: 19, w: 3, h: 7, objective: 'Положите груз на плиту и откройте дверь к пульту', say: [['mira', 'thinking', 'Плита у двери, ящик на полке. Намёк понят.']] },
    { x: 133, y: 22, w: 2, h: 4, requires: 'hall_plate', say: [['lum', 'happy', 'Дверь открыта! Груз держит. Бип!']] },
    { x: 140, y: 7, w: 2, h: 3, objective: 'Пройдите цепочку катапульт', say: [['orion', 'neutral', 'Впереди цепь катапульт. Направление в полёте задаёте вы, инженер.'], ['mira', 'scared', 'Обожаю, когда направление задаю я.']] },
    { x: 186, y: 5, w: 2, h: 4, dialogue: 'l08_end' },
  ],
  decor: [],
};
module.exports.def = def;
