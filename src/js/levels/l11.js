/**
 * l11 «Архив Зодчих» — Глава 2 · 2-1 (ruins, variant 'archive'). 198×24 tiles, built procedurally below
 * (same style as bossarena.js). Floor surface = top of row 20 unless noted. ~4 min first play.
 * ROUTE (QA, every jump/dash chain below was replayed in a headless engine sim):
 *  A  Hall x1-26: start (3,19). ЭХО npc (14,19) «l11_echo_meet» stands on the only path BEFORE the
 *     grant trigger x21 rows 16-19 (grant:'dash', l11_dash_get).
 *  B  C (25,19). Dash school: spike pit x29-34 (6 wide: jump, →dash near the apex). Wall x40-46,
 *     top row 15 (5 high: jump + ↑dash).
 *  C  C (44,14). CRYSTAL CHAIN over the spike pit x47-64: jump at the edge, →dash at the apex,
 *     crystal (50,11) → ↗dash, crystal (53,9) → →dash, crystal (58,9) → ↗dash → ledge x65-72 (row 14).
 *  D  C (75,19). ICE run x73-89 (slow to accelerate) → 5-wide spike pit x90-94 (jump + →dash) →
 *     LEFT conveyor x95-107 (net 130 px/s) → 5-wide spike pit x108-112 (full-speed jump or jump+dash).
 *  E  C (114,19). ICE SHAFT x116-121 (ice walls = no wall-jump, spikes x118-121). Walk under
 *     the ice lip to x116, jump, ↑dash → crystal (116,12), ↗dash → (119,9), ↖dash → (116,6),
 *     ↗dash → (120,4), →dash onto the corridor (stand row 4).
 *  F  Crumble bridge: X pairs 133-134, 137-138, 141-142, 145-146 over a spike pit (2-wide gaps,
 *     keep hopping: 0.45 s per block) → ledge x147-152.
 *  G  Drop to C (154,19), right before the ARCHIVIST arena x156-189 (boss targets gate + exit).
 *     Hide behind a pillar so its sweeping laser burns it (×3) → shield drops → crystals appear →
 *     dash into the core; ×3 phases. Gate x190 opens → exit (194,19), trigger l11_end at x192.
 * SHARDS: (57,6) chain detour: from crystal 2 ↗dash instead of →dash, refill on (58,6), →dash home;
 *  (101,14) above the left belt: jump + ↑dash, land back on the belt;
 *  (140,7) in the crumble pit: walk off X 138, grab it falling, ↑dash through the gap, drift onto X 141.
 */
(function () {
  const W = 198, H = 24;
  const g = [];
  for (let y = 0; y < H; y++) g.push(new Array(W).fill('#'));
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
  const put = (x, y, c) => { g[y][x] = c; };

  // A hall + B dash school
  fill(1, 10, 39, 19, '.');
  fill(29, 20, 34, 20, '.'); fill(29, 21, 34, 21, '^');           // 6-wide pit
  fill(40, 4, 46, 14, '.');                                         // B wall top row 15
  fill(36, 4, 39, 9, '.');
  // C crystal chain pit
  fill(47, 4, 64, 19, '.'); fill(47, 20, 64, 20, '^');
  fill(65, 4, 72, 14, '.');                                         // ledge stand row 14
  // D ice + conveyors
  fill(73, 8, 113, 19, '.');
  fill(73, 20, 89, 20, 'I');
  fill(90, 20, 94, 20, '.'); fill(90, 21, 94, 21, '^');
  fill(95, 20, 107, 20, '{');
  fill(108, 20, 112, 20, '.'); fill(108, 21, 112, 21, '^');
  // E ice shaft
  fill(114, 8, 115, 19, '.');
  fill(115, 2, 115, 17, 'I');                                       // left ice wall (open at the bottom to enter)
  fill(116, 2, 121, 19, '.'); fill(118, 20, 121, 20, '^');
  fill(122, 5, 122, 19, 'I');                                       // right ice wall
  fill(116, 1, 121, 1, '#');
  // F corridor + crumble bridge
  fill(122, 2, 152, 4, '.'); fill(127, 1, 152, 1, '.');
  fill(131, 5, 146, 18, '.'); fill(131, 19, 146, 19, '^');
  for (const x of [133, 134, 137, 138, 141, 142, 145, 146]) put(x, 5, 'X');
  // G arena
  fill(153, 1, 189, 19, '.');
  fill(153, 1, 155, 4, '.');
  fill(190, 1, 190, 16, '#');
  fill(191, 1, 196, 19, '.');
  // markers
  put(3, 19, 'P');
  put(25, 19, 'C'); put(44, 14, 'C'); put(75, 19, 'C'); put(114, 19, 'C'); put(154, 19, 'C');
  put(194, 19, 'E');
  put(57, 6, '*'); put(101, 14, '*'); put(140, 7, '*');
  const map = g.map((r) => r.join(''));

  G.registerLevel({
    id: 'l11',
    chapter: 'Глава 2 · Эхо',
    chapterShort: '2-1',
    title: 'Архив Зодчих',
    biome: 'ruins',
    variant: 'archive',
    drone: true,
    objective: 'Исследуйте Архив Зодчих',
    startDialogue: 'l11_start',
    map,
    entities: [
      { type: 'npc', x: 14, y: 19, who: 'echo', dialogue: 'l11_echo_meet', facing: -1 },
      // C crystal chain
      { type: 'dashcrystal', x: 50, y: 11 },
      { type: 'dashcrystal', x: 53, y: 9 },
      { type: 'dashcrystal', x: 58, y: 9 },
      { type: 'dashcrystal', x: 58, y: 6 },             // shard-route recovery
      // E ice shaft
      { type: 'dashcrystal', x: 116, y: 12 },
      { type: 'dashcrystal', x: 119, y: 9 },
      { type: 'dashcrystal', x: 116, y: 6 },
      { type: 'dashcrystal', x: 120, y: 4 },
      // G Архивариус
      { type: 'boss', kind: 'archivist', id: 'archivist', x: 173, y: 6, arena: [156, 1, 34, 19], targets: ['gate', 'exit'] },
      { type: 'bossproj', kind: 'pillar', x: 162, y: 19, h: 3 },
      { type: 'bossproj', kind: 'pillar', x: 173, y: 19, h: 3 },
      { type: 'bossproj', kind: 'pillar', x: 184, y: 19, h: 3 },
      { type: 'door', id: 'gate', x: 190, y: 17, h: 3 },
    ],
    triggers: [
      { x: 21, y: 16, w: 1, h: 4, grant: 'dash', dialogue: 'l11_dash_get' },
      { x: 192, y: 16, w: 1, h: 4, dialogue: 'l11_end' },
    ],
    decor: [
      { kind: 'tablet_shelf', x: 6, y: 19 }, { kind: 'echo_statue', x: 10, y: 19 }, { kind: 'glyph_wall', x: 18, y: 17 },
      { kind: 'data_pillar', x: 23, y: 19 }, { kind: 'tablet_shelf', x: 38, y: 19 }, { kind: 'pillar', x: 27, y: 19 },
      { kind: 'glyph_wall', x: 43, y: 11 }, { kind: 'data_pillar', x: 70, y: 14 }, { kind: 'tablet_shelf', x: 78, y: 19 },
      { kind: 'echo_statue', x: 86, y: 19 }, { kind: 'data_pillar', x: 112, y: 19 }, { kind: 'glyph_wall', x: 126, y: 4 },
      { kind: 'tablet_shelf', x: 150, y: 4 }, { kind: 'pillar', x: 157, y: 19 }, { kind: 'pillar', x: 188, y: 19 },
      { kind: 'echo_statue', x: 196, y: 19 },
    ],
  });
})();
