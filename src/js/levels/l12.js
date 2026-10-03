/**
 * l12 «Ветряные трубы» — Глава 2 · 2-2 (canyon). Map built procedurally below. ~4 min first play.
 * ROUTE (QA): see the block comment written at the end of tuning (top of file is authoritative).
 */
(function () {
  const W = 227, H = 24;
  const g = [];
  for (let y = 0; y < H; y++) g.push(new Array(W).fill('#'));
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
  const put = (x, y, c) => { g[y][x] = c; };

  // A start
  fill(1, 4, 21, 19, '.');
  // B1 up-draft chasm → high ledge (stand row 11)
  fill(22, 4, 31, 23, '.');
  fill(32, 2, 42, 11, '.');
  // B2 gust bridge (fallplats over a bottomless pit)
  fill(43, 2, 60, 23, '.');
  fill(61, 2, 76, 11, '.');
  // C anchor chasm
  fill(77, 2, 100, 23, '.');
  // D sentinel corridor (stand row 11, ceiling row 5)
  fill(101, 4, 112, 11, '.');
  fill(113, 6, 151, 11, '.');
  for (const [a, b] of [[117, 120], [127, 130], [138, 141]]) { fill(a, 12, b, 12, '.'); fill(a, 13, b, 13, '^'); }
  // E wind + swing gauntlet
  fill(152, 2, 155, 11, '.');
  fill(156, 2, 177, 23, '.');
  fill(178, 2, 183, 19, '.'); fill(178, 12, 179, 19, '#');
  // F colossus arena x184-219, gate x220, exit area
  fill(180, 1, 219, 19, '.'); fill(178, 12, 179, 19, '#');
  fill(191, 14, 194, 14, '='); fill(183, 1, 183, 16, '#');
  fill(220, 1, 220, 16, '#');
  fill(221, 1, 225, 19, '.');
  // markers
  put(3, 19, 'P');
  put(34, 11, 'C'); put(69, 11, 'C'); put(103, 11, 'C'); put(153, 11, 'C'); put(181, 19, 'C');
  put(224, 19, 'E');
  put(26, 4, '*'); put(57, 7, '*'); put(128, 9, '*');
  const map = g.map((r) => r.join(''));

  G.registerLevel({
    id: 'l12',
    chapter: 'Глава 2 · Эхо',
    chapterShort: '2-2',
    title: 'Ветряные трубы',
    biome: 'canyon',
    drone: true,
    abilities: ['dash'],
    objective: 'Пройдите сквозь Ветряные трубы',
    startDialogue: 'l12_start',
    map,
    entities: [
      // B1 up-draft
      { type: 'wind', x: 23, y: 3, w: 4, h: 21, dir: 'up', strength: 3600, period: 3.2, on: 2.0 },
      // B2 gust bridge
      { type: 'fallplat', x: 46, y: 12 }, { type: 'fallplat', x: 51, y: 12 }, { type: 'fallplat', x: 56, y: 12 },
      { type: 'wind', x: 43, y: 3, w: 18, h: 9, dir: 'left', strength: 1300, period: 3.4, on: 1.1 },
      // C anchors
      { type: 'anchor', x: 82, y: 5, len: 5 },
      { type: 'anchor', x: 91, y: 5, len: 5 },
      // D sentinels + stun laser
      { type: 'sentinel', x: 112, y: 8, range: 7, path: [[112, 7], [112, 9]] },
      { type: 'sentinel', x: 133, y: 8, range: 7, path: [[126, 8], [140, 8]] },
      { type: 'laser', x: 124, y: 6, dir: 'down', period: 2.4, on: 0.7 },
      { type: 'sentinel', x: 143, y: 7, range: 6 },
      // E swing + wind gauntlet
      { type: 'anchor', x: 160, y: 4, len: 5 },
      { type: 'dashcrystal', x: 166, y: 8 },
      { type: 'wind', x: 164, y: 2, w: 4, h: 22, dir: 'down', strength: 1800, period: 2.6, on: 1.0 },
      { type: 'anchor', x: 172, y: 4, len: 5 },
      // F Колосс Бурь
      { type: 'boss', kind: 'colossus', id: 'colossus', x: 208, y: 19, arena: [184, 1, 36, 19], targets: ['gate', 'exit'] },
      { type: 'lever', x: 186, y: 19, targets: ['fan1'] },
      { type: 'bossproj', kind: 'fan', id: 'fan1', x: 188, y: 19, dir: 'right', len: 9, h: 9 },
      { type: 'anchor', x: 202, y: 7, len: 5 },
      { type: 'anchor', x: 212, y: 7, len: 5 },
      { type: 'door', id: 'gate', x: 220, y: 17, h: 3 },
    ],
    triggers: [
      { x: 19, y: 15, w: 1, h: 5, dialogue: 'l12_wind' },
      { x: 102, y: 8, w: 1, h: 4, dialogue: 'l12_sentinel', mode: 'talk' },
      { x: 222, y: 16, w: 1, h: 4, dialogue: 'l12_end' },
    ],
    decor: [
      { kind: 'pod_wreck', x: 6, y: 19 }, { kind: 'rock', x: 12, y: 19 }, { kind: 'singing_pillar', x: 17, y: 19 },
      { kind: 'spire_far', x: 10, y: 19, layer: 'back' }, { kind: 'monolith', x: 40, y: 11 }, { kind: 'bones', x: 72, y: 11 },
      { kind: 'singing_pillar', x: 75, y: 11 }, { kind: 'rock', x: 106, y: 11 }, { kind: 'debris', x: 145, y: 11 },
      { kind: 'monolith', x: 154, y: 11 }, { kind: 'rock', x: 182, y: 19 }, { kind: 'bones', x: 198, y: 19 },
      { kind: 'singing_pillar', x: 223, y: 19 },
    ],
  });
})();
