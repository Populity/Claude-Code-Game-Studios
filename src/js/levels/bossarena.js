/**
 * Boss test arena (not in the campaign). Open with ?level=bossarena
 * Three arenas left→right: Архивариус, Колосс Бурь, Первый Страж. Each boss, once destroyed,
 * powers the gate to the next arena (boss `targets`). A checkpoint stands right before each arena.
 * Logic: src/js/world/bosses.js · tuning: src/js/config-bosses.js
 */
(function () {
  const W = 128, H = 22;
  const g = [];
  for (let y = 0; y < H; y++) g.push(new Array(W).fill(y === 0 || y >= 20 ? '#' : '.'));
  const put = (x, y, c) => { g[y][x] = c; };
  const col = (x, y0, y1) => { for (let y = y0; y <= y1; y++) put(x, y, '#'); };
  for (let y = 0; y < H; y++) { put(0, y, '#'); put(W - 1, y, '#'); }
  // arena walls with 3-high gate gaps (doors) at the floor
  col(42, 1, 16); col(84, 1, 16); col(124, 1, 16);
  put(2, 19, 'P'); put(5, 19, 'C'); put(45, 19, 'C'); put(87, 19, 'C'); put(126, 19, 'E');
  // colossus arena: one-way perches under the anchors
  for (let x = 55; x <= 58; x++) put(x, 14, '=');
  // warden arena: solid ledges = cover from the beam arms
  for (let x = 95; x <= 98; x++) put(x, 15, '#');
  for (let x = 116; x <= 119; x++) put(x, 15, '#');
  const map = g.map((r) => r.join(''));

  G.registerLevel({
    id: 'bossarena',
    chapter: 'Тест',
    title: 'Арена боссов',
    biome: 'tower',
    drone: false,
    abilities: ['dash'],
    map,
    entities: [
      // 1 — Архивариус: 3 tablet-pillars feed its shield
      { type: 'boss', kind: 'archivist', id: 'bossA', x: 25, y: 6, arena: [8, 1, 34, 19], targets: ['gA'] },
      { type: 'bossproj', kind: 'pillar', x: 14, y: 19, h: 3 },
      { type: 'bossproj', kind: 'pillar', x: 25, y: 19, h: 3 },
      { type: 'bossproj', kind: 'pillar', x: 36, y: 19, h: 3 },
      { type: 'door', id: 'gA', x: 42, y: 17, h: 3 },
      // 2 — Колосс Бурь: lever-flipped fan + anchors over its back
      { type: 'boss', kind: 'colossus', id: 'bossB', x: 72, y: 19, arena: [48, 1, 36, 19], targets: ['gB'] },
      { type: 'lever', x: 50, y: 19, targets: ['fan1'] },
      { type: 'bossproj', kind: 'fan', id: 'fan1', x: 52, y: 19, dir: 'right', len: 9, h: 9 },
      { type: 'anchor', x: 66, y: 7, len: 5 },
      { type: 'anchor', x: 76, y: 7, len: 5 },
      { type: 'door', id: 'gB', x: 84, y: 17, h: 3 },
      // 3 — Первый Страж: 3 cell sockets
      { type: 'boss', kind: 'warden', id: 'bossC', x: 107, y: 8, arena: [89, 1, 35, 19], targets: ['gC'] },
      { type: 'socket', x: 92, y: 19, needs: 'cell', targets: [] },
      { type: 'socket', x: 107, y: 19, needs: 'cell', targets: [] },
      { type: 'socket', x: 122, y: 19, needs: 'cell', targets: [] },
      { type: 'door', id: 'gC', x: 124, y: 17, h: 3 },
    ],
  });
})();
