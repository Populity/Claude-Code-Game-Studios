/** l08 «Механический лес» — planned route following the designer's QA notes in src/js/levels/l08.js. */
const { runPlanned, at, toward, cpLit } = require('./planned');
const crate = (w) => w.level.crates[0];
runPlanned('l08', [
  { name: 'cliff', goal: at(29, 39, 20, 20), h: toward(34, 20) },
  { name: 'well-top C50', goal: cpLit(50), h: toward(50, 10, 0.5), opts: { maxNodes: 200000 } },
  { name: 'bridges C73', goal: cpLit(73), h: toward(73, 10, 0.5), opts: { timeKey: 6.4, maxNodes: 200000 } },
  { name: 'grove C101', goal: cpLit(101), h: toward(101, 18, 0.5), opts: { maxNodes: 200000 } },
  { name: 'hall floor', goal: at(108, 112, 26, 26), h: toward(110, 26, 0.5) },
  { name: 'shelf', goal: (w) => w.player.onGround && w.player.cy / 32 < 15.5 && w.player.cx / 32 > 118.5, h: (w) => { const [x, f] = w.tile(); return x < 118 ? Math.abs(f - 13) + Math.abs(x - 115.5) * 0.3 : Math.abs(f - 16) + Math.abs(x - 121) * 0.3; }, opts: { maxNodes: 200000 } },
  { name: 'crate on plate', goal: (w) => w.level.byId.hall_plate.byCrate, h: (w) => Math.abs(crate(w).x / 32 - 129.5) + Math.abs(crate(w).y / 32 - 25) + 0.3 * Math.abs(w.player.cx - crate(w).x) / 32, opts: { maxNodes: 300000, extra: [{ k: 'R', f: 30 }, { k: 'R', f: 60 }], key: (w) => Math.round(crate(w).x / 8) + ',' + Math.round(crate(w).y / 8) } },
  { name: 'terminal', goal: (w) => { const t = w.focus(); return t && t.type === 'terminal'; }, h: toward(141, 26, 1), opts: { maxNodes: 200000 } },
  { name: 'lights', use: true, check: (w) => w.level.byId.lift.powered },
  { name: 'lift top C146', goal: cpLit(146), h: toward(146, 10, 0.5), opts: { timeKey: 12, maxNodes: 200000, extra: [{ k: '', f: 40 }] } },
  { name: 'pads C162', goal: cpLit(162), h: toward(162, 17, 0.5), opts: { maxNodes: 200000 } },
  { name: 'exit', goal: (w) => w.completed, h: toward(195, 8, 0.5), opts: { timeKey: 6.4, maxNodes: 300000, extra: [{ k: '', f: 40 }] } },
]);
