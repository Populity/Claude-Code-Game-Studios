/** l09 «Шпиль» — planned route (vertical tower), checkpoint to checkpoint per the designer's QA notes. */
const { runPlanned, toward, cpLit, at, climb } = require('./planned');
const o = (tk) => ({ maxNodes: 150000, timeKey: tk, extra: [{ k: '', f: 30 }] });
runPlanned('l09', [
  { name: 'shaft A', script: (w) => climb(w, 14.5, 1, -1, 85.2) },
  { name: 'Z1 C(8,73)', goal: cpLit(8), h: toward(8, 74, 0.3), opts: o(0) },
  { name: 'Z2 C(40,54)', goal: cpLit(40), h: toward(40, 55, 0.3), opts: o(2.4) },
  { name: 'M1 ride', script: (w) => {
    const m = w.level.entities.find((e) => e.type === 'mplatform' && e.tx === 36); const P = w.player; let n = 0;
    while (Math.abs(w.tile()[0] - 37.5) > 0.2) { w.tick({ left: w.tile()[0] > 37.5, right: w.tile()[0] < 37.5 }); if (++n > 300) return false; }
    n = 0; while (!(P.groundEntity === m)) { if (m.y >= 54 * 32 - 1 && P.onGround && P.groundEntity !== m) { w.tick({ jumpPressed: true, jumpHeld: true }); for (let i = 0; i < 8; i++) w.tick({ jumpHeld: true }); } else w.tick({}); if (++n > 1500 || P.dead) return false; }
    n = 0; while (!(m.y <= 44 * 32 + 1)) { w.tick({}); if (++n > 1500 || P.dead) return false; }
    return true;
  } },
  { name: 'ledge A', goal: at(27, 32.9, 44, 44), h: toward(30, 44, 0.5), opts: { maxNodes: 100000, timeKey: 4, extra: [{ k: '', f: 30 }] } },
  { name: 'Z3 C(17,36)', goal: (w) => w.level.entities.some((e) => e.type === 'checkpoint' && e.tx === 17 && e.ty === 36 && e.lit), h: toward(17, 37, 0.3), opts: o(0) },
  { name: 'shaft B', script: (w) => {
    const lz = (ty) => w.level.entities.find((e) => e.type === 'laser' && e.ty === ty);
    const waitOff = (l) => { let n = 0; while (!(l.computePhase(w.level.time) === 'off' && l.computePhase(w.level.time - 1 / 60) !== 'off')) { w.tick({}); if (++n > 600) return false; } return true; };
    // arrive on the rest ledge while the row-28 beam is dark (the climb's apex passes through it)
    const P = w.player; let n = 0;
    while (Math.abs(w.tile()[0] - 10.6) > 0.15) { w.tick({ right: w.tile()[0] < 10.6, left: w.tile()[0] > 10.6 }); if (++n > 600 || P.dead) return false; }
    if (!waitOff(lz(28)) || !climb(w, 10.6, 1, -1, 31.2)) return false;
    if (!waitOff(lz(28)) || !climb(w, w.tile()[0], 1, 1, 26.2)) return false;
    if (!waitOff(lz(23)) || !climb(w, w.tile()[0], -1, 1, 20.2)) return false;
    return true;
  } },
  { name: 'Z4 C(16,19)', goal: cpLit(16), h: toward(16, 20, 0.3), opts: o(2.6) },
  { name: 'Z5 C(29,11)', goal: cpLit(29), h: toward(29, 12, 0.3), opts: o(0) },
  { name: 'exit', goal: (w) => w.completed, h: toward(40, 6, 0.3), opts: o(0) },
]);
