/**
 * l13 «Сердце Шпиля» — Глава 2 · 2-3 (tower, variant 'core'). 229×24 tiles, built procedurally below.
 * Dash allowed (abilities). Floor = top of row 20 (stand 19) or row 12 (stand 11); pits are bottomless.
 * Every section was replayed in a headless engine sim / bot. ~5 min first play.
 * ROUTE (QA):
 *  A  Start (3,19).
 *  B  UP-DRAFT chasm x13-22 (wind x14-17, on 1.8 of 3.0): ride to the ceiling, →dash to ledge x23-33.
 *  C  C (25,11). ANCHOR CHASM x34-57: anchors (39,5) → (48,5), a DOWN-DRAFT x42-46 pulses between them
 *     (on 1.0 of 2.8): leave the first rope when it fades, ↗dash if it drags you → ledge x58-70.
 *  D  C (60,11). SENTINEL + LASER CORRIDOR x71-109 (ceiling row 5): spike pits 75-78 / 85-88 / 96-99,
 *     lasers x82 and x93 (2.4 s, 0.7 on, half a period apart), a patroller (84↔98) and a guard (101,7).
 *     Wait out a beam, sprint, dash past the patroller as it locks on (it may get stunned by a beam).
 *  ½  C (111,11) + ЭХО npc (112,11) «l13_echo_truth» — midway.
 *  E  SWING + DOWN-DRAFT gauntlet x114-135: anchor (118,4) → crystal (124,8) → anchor (130,4),
 *     down-draft x122-125 (on 1.0 of 2.6) → land x136-140.
 *  F  C (139,19). ICE SHAFT x142-147 (spike floor): jump, ↑dash → crystal (142,12), ↗ (145,9),
 *     ↖ (142,6), ↗ (146,4), →dash into the corridor (stand row 4).
 *  G  CRUMBLE BRIDGE over the pit x157-172: X pairs 159-160 / 163-164 / 167-168 / 171-172, a Страж
 *     (165,10) waits below and punishes any hesitation → ledge x173-178, drop to C (180,19).
 *  H  WARDEN arena x182-216 (boss targets gate): lure seekers into its beam arms → each drops a cell →
 *     sockets (185/199/214,19) → core opens → dash strike. Gate x217 opens the final chamber.
 *  FINAL terminal (221,19), onSolve l13_final → exit (226,19). Reachable only after boss3.
 *     Фокус = (A^B)&!E · Петля = C^D · Эхо = (A&C)^(D|E) · Ключ = (C|B)&!(D&(A|B))
 *     UNIQUE solution A=1 B=0 C=1 D=0 E=0 (brute-forced: 1 of 32). Фокус ⇒ E=0, A≠B; Петля ⇒ C≠D;
 *     A=0,B=1: Эхо ⇒ D=1 ⇒ Ключ fails; so A=1,B=0, and Ключ = C&!D ⇒ C=1, D=0.
 * SHARDS: (15,4) top of the up-draft; (52,7) above the second rope's release arc (late release + ↑dash);
 *  (166,7) in the crumble pit next to the Страж: walk off X 164, grab, ↑dash through the gap onto X 167.
 */
(function () {
  const W = 229, H = 24;
  const g = [];
  for (let y = 0; y < H; y++) g.push(new Array(W).fill('#'));
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c; };
  const put = (x, y, c) => { g[y][x] = c; };

  // A start
  fill(1, 4, 12, 19, '.');
  // B up-draft chasm → ledge (stand row 11)
  fill(13, 4, 22, 23, '.');
  fill(23, 2, 33, 11, '.');
  // C anchor chasm with a crosswind
  fill(34, 2, 57, 23, '.');
  fill(58, 2, 70, 11, '.');
  // D sentinel corridor (stand row 11, ceiling row 5)
  fill(71, 6, 109, 11, '.');
  for (const [a, b] of [[75, 78], [85, 88], [96, 99]]) { fill(a, 12, b, 12, '.'); fill(a, 13, b, 13, '^'); }
  fill(110, 2, 113, 11, '.');
  // E swing + down-draft gauntlet
  fill(114, 2, 135, 23, '.');
  fill(136, 2, 140, 19, '.'); fill(136, 12, 137, 19, '#');
  // F ice shaft (ice walls, spike floor) → upper corridor
  fill(138, 8, 141, 19, '.');
  fill(141, 2, 141, 17, 'I');
  fill(142, 2, 147, 19, '.'); fill(144, 20, 147, 20, '^');
  fill(148, 5, 148, 19, 'I');
  fill(142, 1, 147, 1, '#');
  // G crumble bridge (a sentinel guards the pit)
  fill(148, 2, 178, 4, '.'); fill(153, 1, 178, 1, '.');
  fill(157, 5, 172, 18, '.'); fill(157, 19, 172, 19, '^');
  for (const x of [159, 160, 163, 164, 167, 168, 171, 172]) put(x, 5, 'X');
  // H warden arena x182-216, gate x217, final chamber
  fill(179, 1, 216, 19, '.');
  fill(188, 15, 191, 15, '#'); fill(209, 15, 212, 15, '#');
  fill(217, 1, 217, 16, '#');
  fill(218, 1, 227, 19, '.');
  // markers
  put(3, 19, 'P');
  put(25, 11, 'C'); put(60, 11, 'C'); put(111, 11, 'C'); put(139, 19, 'C'); put(180, 19, 'C');
  put(226, 19, 'E');
  put(15, 4, '*'); put(52, 7, '*'); put(166, 7, '*');
  const map = g.map((r) => r.join(''));

  G.registerLevel({
    id: 'l13',
    chapter: 'Глава 2 · Эхо',
    chapterShort: '2-3',
    title: 'Сердце Шпиля',
    biome: 'tower',
    variant: 'core',
    drone: true,
    abilities: ['dash'],
    objective: 'Доберитесь до Сердца Шпиля',
    startDialogue: 'l13_start',
    map,
    entities: [
      // B up-draft
      { type: 'wind', x: 14, y: 3, w: 4, h: 21, dir: 'up', strength: 3600, period: 3.0, on: 1.8 },
      // C anchors + crosswind
      { type: 'anchor', x: 39, y: 5, len: 5 },
      { type: 'anchor', x: 48, y: 5, len: 5 },
      { type: 'wind', x: 42, y: 2, w: 5, h: 22, dir: 'down', strength: 1500, period: 2.8, on: 1.0, offset: 1.4 },
      // D sentinel corridor
      { type: 'sentinel', x: 91, y: 8, range: 7, path: [[84, 8], [98, 8]] },
      { type: 'laser', x: 82, y: 6, dir: 'down', period: 2.4, on: 0.7 },
      { type: 'laser', x: 93, y: 6, dir: 'down', period: 2.4, on: 0.7, offset: 1.2 },
      { type: 'sentinel', x: 101, y: 7, range: 6 },
      { type: 'npc', x: 112, y: 11, who: 'echo', dialogue: 'l13_echo_truth', facing: -1 },
      // E swing + down-draft
      { type: 'anchor', x: 118, y: 4, len: 5 },
      { type: 'dashcrystal', x: 124, y: 8 },
      { type: 'wind', x: 122, y: 2, w: 4, h: 22, dir: 'down', strength: 1800, period: 2.6, on: 1.0 },
      { type: 'anchor', x: 130, y: 4, len: 5 },
      // F ice shaft crystals
      { type: 'dashcrystal', x: 142, y: 12 },
      { type: 'dashcrystal', x: 145, y: 9 },
      { type: 'dashcrystal', x: 142, y: 6 },
      { type: 'dashcrystal', x: 146, y: 4 },
      // G pit guard
      { type: 'sentinel', x: 165, y: 10, range: 6 },
      // H Первый Страж
      { type: 'boss', kind: 'warden', id: 'warden', x: 199, y: 8, arena: [182, 1, 35, 19], targets: ['gate'] },
      { type: 'socket', x: 185, y: 19, needs: 'cell', targets: [] },
      { type: 'socket', x: 199, y: 19, needs: 'cell', targets: [] },
      { type: 'socket', x: 214, y: 19, needs: 'cell', targets: [] },
      { type: 'part', x: 193, y: 19, item: 'cell', bossCell: true },
      { type: 'part', x: 194, y: 19, item: 'cell', bossCell: true },
      { type: 'part', x: 195, y: 19, item: 'cell', bossCell: true },
      { type: 'door', id: 'gate', x: 217, y: 17, h: 3 },
      // final terminal (behind the gate) → exit
      { type: 'terminal', id: 'final_term', x: 221, y: 19, targets: ['exit'], onSolve: 'l13_final', puzzle: {
        type: 'logic', title: 'Сердце Шпиля', subtitle: 'Разомкните петлю', inputs: ['A', 'B', 'C', 'D', 'E'], outputs: [
          { label: 'Фокус', expr: '(A ^ B) & !E' },
          { label: 'Петля', expr: 'C ^ D' },
          { label: 'Эхо', expr: '(A & C) ^ (D | E)' },
          { label: 'Ключ', expr: '(C | B) & !(D & (A | B))' },
        ] } },
    ],
    triggers: [],
    decor: [
      { kind: 'ring_machine', x: 7, y: 19 }, { kind: 'conduit', x: 11, y: 19 }, { kind: 'data_pillar', x: 31, y: 11 },
      { kind: 'cable_bundle', x: 28, y: 11 }, { kind: 'conduit', x: 66, y: 11 }, { kind: 'beacon_core', x: 69, y: 11 },
      { kind: 'data_pillar', x: 106, y: 11 }, { kind: 'ring_machine', x: 109, y: 11 }, { kind: 'conduit', x: 150, y: 4 },
      { kind: 'data_pillar', x: 176, y: 4 }, { kind: 'beacon_core', x: 220, y: 19 }, { kind: 'ring_machine', x: 224, y: 19 },
      { kind: 'cable_bundle', x: 183, y: 19 }, { kind: 'conduit', x: 215, y: 19 },
    ],
  });
})();
