const { Grid } = require('./lib.js');
const W = 160, H = 36;
const g = new Grid(W, H);
g.rect(0, 0, W - 1, 0); g.rect(0, 33, W - 1, 35);
g.rect(0, 0, 0, 35); g.rect(W - 1, 0, W - 1, 35);

// ---------------- A arrival + B beacon chamber (floor row 24)
g.rect(1, 24, 91, 29);              // main floor mass (tunnel below at rows 30-32)
g.set(3, 23, 'P');
g.rect(19, 1, 50, 6);               // chamber roof
g.rect(26, 14, 40, 15);             // crown balcony (final terminal + beacon exit)
g.set(37, 13, 'E');
g.clear(23, 24, 25, 24);            // crown lift well (lift sits in the floor gap until powered)
g.clear(44, 24, 46, 29);            // return-lift well down to the tunnel
// ---------------- C pipes bridge over an acid gulf
g.set(52, 23, 'C');
g.clear(56, 24, 66, 26); g.rect(56, 26, 66, 26, '~');
// ---------------- D clue corridor (code signs) + code door
g.rect(68, 1, 91, 18);              // corridor ceiling (rows 19-23 open)
g.set(86, 23, 'C');
// ---------------- E gauntlet
g.rect(92, 24, 158, 29);            // gauntlet base
g.rect(101, 23, 147, 23, '^');      // spike floor under the gauntlet
// E1 laser shaft (interior 97..99), entry from the left at rows 22-23
g.rect(96, 8, 96, 21);
g.rect(100, 8, 100, 23);
g.set(97, 18, '#');                 // rest ledge 1 (left)
g.set(99, 13, '#');                 // rest ledge 2 (right)
g.set(100, 7, 'C');                 // C on the shaft wall top (wait spot for E2)
g.rect(92, 1, 95, 21);              // fill left of the shaft
// E2 crumble + moving platform over the spikes
g.put(101, 8, 'XXXX');
g.put(116, 8, 'XXX');
g.rect(120, 8, 123, 22); g.set(121, 7, 'C');
// E3 pillars with a crumbling middle, saw between, the vault
g.rect(128, 12, 129, 22);
g.put(133, 12, 'XX');              // floating crumbling stepping stone
g.rect(139, 12, 148, 22);           // vault floor
g.set(141, 11, 'C');
// chute to the return tunnel (6 wide → not climbable)
g.clear(149, 12, 154, 32);
g.rect(155, 1, 158, 32);
g.rect(92, 30, 148, 32);            // solid under the gauntlet...
g.clear(47, 30, 148, 32);           // ...except the tunnel rows 30-32
g.clear(44, 30, 46, 32);
g.rect(1, 30, 43, 32);              // seal the tunnel west of the return lift
g.rect(88, 19, 91, 20);             // lintel over the code door
// shards
g.set(98, 10, '*');                 // in the shaft between ledge 2 and the top, beside the laser
g.set(110, 5, '*');                 // above the moving platform's track
g.set(131, 8, '*');                 // over the gap between pillars, saw lane
module.exports = { g, W, H };

const def = {
  id: 'l10', chapter: 'Глава 1 · Тессера', chapterShort: '1-10', title: 'Маяк', biome: 'tower', drone: true,
  objective: 'Найдите ядро Маяка', startDialogue: 'l10_start',
  entities: [
    'B beacon chamber: socket below, crown balcony (final terminal + exit) reached by the crown lift',
    { type: 'socket', id: 'core_socket', x: 30, y: 23, needs: 'core', targets: ['crown_lift', 'exit'], onRepair: 'l10_core', objective: 'Поднимитесь к венцу Маяка и задайте параметры передачи' },
    { type: 'mplatform', id: 'crown_lift', x: 23, y: 24, w: 3, path: [[23, 24], [23, 14]], speed: 2, pause: 1.2 },
    { type: 'terminal', id: 'final_term', x: 29, y: 13, puzzle: { type: 'logic', title: 'Контур передачи', subtitle: 'Последний контур Маяка', inputs: ['A', 'B', 'C', 'D', 'E'], outputs: [
      { label: 'Фокус', expr: '(A ^ B) & !E' },
      { label: 'Частота', expr: '(C & D) ^ (B | E)' },
      { label: 'Мощность', expr: '(A | E) & (C ^ (B & D))' },
    ] }, targets: ['exit'], onSolve: 'l10_final', objective: 'Включите Маяк' },
    { type: 'sign', x: 12, y: 23, title: 'Плита у входа', text: 'Глифы Зодчих, ЛЮМ переводит:\n«Маяк зовёт. Маяк отвечает. Тот, кто вставит ядро, станет голосом».\nНиже кто-то нацарапал по-русски: «НЕ ВСТАВЛЯЙ». Почерк очень похож на твой.' },
    'C pipes: power the bridge over the acid gulf',
    { type: 'terminal', x: 54, y: 23, puzzle: { type: 'pipes', w: 6, h: 4, title: 'Мостовая магистраль' }, targets: ['pipe_bridge'], objective: 'Пройдите к хранилищу ядра' },
    { type: 'bridge', id: 'pipe_bridge', x: 56, y: 24, w: 11 },
    'D clue corridor: three tablets → code 234',
    { type: 'sign', x: 48, y: 23, title: 'Скрижаль I', text: 'Первая цифра — сколько лун смотрит на Тессеру.' },
    { type: 'sign', x: 70, y: 23, title: 'Скрижаль II', text: 'Вторая цифра — сколько букв в слове, которым Маяк говорит со звёздами: «ЗОВ».' },
    { type: 'sign', x: 83, y: 23, title: 'Скрижаль III', text: 'Третья цифра — вдвое больше первой.\nТак открывается хранилище ядра.' },
    { type: 'saw', x: 74, y: 23, path: [[74, 23], [79, 23]], speed: 2, pause: 0.5 },
    { type: 'terminal', x: 88, y: 23, puzzle: { type: 'code', code: '234', title: 'Хранилище ядра', hint: 'Луны · Зов · Вдвое' }, targets: ['vault_door'], objective: 'Доберитесь до ядра' },
    { type: 'door', id: 'vault_door', x: 90, y: 21, h: 3 },
    'E1 laser shaft (interior x97-99) with rest ledges',
    { type: 'laser', x: 96, y: 15, dir: 'right', period: 2.4, on: 1.0 },
    { type: 'laser', x: 100, y: 10, dir: 'left', period: 2.4, on: 1.0, offset: 1.2 },
    'E2 crumbles + moving platform, vertical saw at the far end',
    { type: 'mplatform', x: 106, y: 8, w: 3, path: [[106, 8], [112, 8]], speed: 2, pause: 1.0 },
    { type: 'saw', x: 115, y: 3, path: [[115, 3], [115, 7]], speed: 2, pause: 0.6 },
    'E3 pillars, floating crumble, two anti-phase saws, the vault',
    { type: 'saw', x: 131, y: 8, path: [[131, 8], [131, 13]], speed: 2.5, pause: 0.5 },
    { type: 'saw', x: 137, y: 13, path: [[137, 13], [137, 8]], speed: 2.5, pause: 0.5 },
    { type: 'part', x: 146, y: 11, item: 'core', objective: 'Отнесите ядро в гнездо Маяка' },
    { type: 'lever', x: 144, y: 11, targets: ['ret_lift'], oneShot: true },
    { type: 'hint', x: 151, y: 10, text: 'Шахта ведёт в нижний тоннель — короткий путь назад', range: 4 },
    { type: 'mplatform', id: 'ret_lift', x: 44, y: 24, w: 3, path: [[44, 24], [44, 32]], speed: 2.5, pause: 1.0 },
  ],
  triggers: [
    { x: 50, y: 20, w: 2, h: 4, say: [['lum', 'thinking', 'Мост выключен. Трубы — ЛЮМ любит трубы. Бип.']] },
    { x: 66, y: 20, w: 2, h: 4, say: [['mira', 'thinking', 'Скрижали. Код к хранилищу, если ЛЮМ переведёт.'], ['lum', 'happy', 'Читать все три! По порядку.']] },
    { x: 93, y: 21, w: 2, h: 3, say: [['orion', 'neutral', 'Хранилище защищено. Лучи, обвал, лезвия. Зодчие не хотели, чтобы ядро вернули.'], ['mira', 'determined', 'Зодчие много чего не хотели.']] },
    { x: 140, y: 9, w: 2, h: 3, say: [['lum', 'alert', 'Ядро! Рычаг — опустит лифт в тоннель. Шахта — вниз, к Маяку.']] },
    { x: 26, y: 11, w: 2, h: 3, requires: 'core_socket', say: [['orion', 'neutral', 'Последний контур. Три выхода, пять ключей. Ошибки контур не прощает, но и не наказывает.'], ['mira', 'thinking', 'Логика. Как в учебке. Только ставка — две тысячи жизней.']] },
  ],
  decor: [
    { kind: 'storm_rod', x: 2, y: 23 }, { kind: 'antenna', x: 8, y: 23 }, { kind: 'glyph_wall', x: 15, y: 23 },
    { kind: 'beacon_core', x: 33, y: 13 }, { kind: 'cable_bundle', x: 28, y: 23 }, { kind: 'cable_bundle', x: 36, y: 23 },
    { kind: 'antenna', x: 39, y: 13 }, { kind: 'glyph_wall', x: 42, y: 23 }, { kind: 'storm_rod', x: 51, y: 23 },
    { kind: 'antenna', x: 67, y: 23 }, { kind: 'glyph_wall', x: 77, y: 23 }, { kind: 'cable_bundle', x: 86, y: 23 },
    { kind: 'storm_rod', x: 98, y: 7, layer: 'back' }, { kind: 'antenna', x: 122, y: 7 }, { kind: 'storm_rod', x: 128, y: 11 },
    { kind: 'glyph_wall', x: 142, y: 11 }, { kind: 'beacon_core', x: 147, y: 11, scale: 0.6 }, { kind: 'cable_bundle', x: 100, y: 32 },
    { kind: 'cable_bundle', x: 70, y: 32 }, { kind: 'storm_rod', x: 130, y: 32 },
  ],
};
module.exports.def = def;
