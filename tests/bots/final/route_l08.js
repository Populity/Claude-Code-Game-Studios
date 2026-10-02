/** l08 «Механический лес» — planned route following the designer's QA notes in src/js/levels/l08.js. */
const { runPlanned, at, toward, cpLit } = require('./planned');
const crate = (w) => w.level.crates[0];
runPlanned('l08', [
  { name: 'cliff', goal: at(29, 39, 20, 20), h: toward(34, 20) },
  { name: 'well-top C50', goal: cpLit(50), h: toward(50, 10, 0.5), opts: { maxNodes: 200000 } },
  { name: 'bridges C73', goal: cpLit(73), h: toward(73, 10, 0.5), opts: { timeKey: 6.4, maxNodes: 200000 } },
  { name: 'grove C101', goal: cpLit(101), h: toward(101, 18, 0.5), opts: { maxNodes: 200000 } },
  { name: 'hall floor', goal: at(108, 112, 26, 26), h: toward(110, 26, 0.5) },
  { name: 'shelf', script: (w) => { // pad x115 launch + reactive wall-jump in the 113/118 shaft, hop the lip
    const P = w.player; let jh = false, dir = 1;
    while (w.tile()[0] < 111.3) w.tick({ right: true }); for (let i = 0; i < 20; i++) w.tick({});
    for (let i = 0; i < 400; i++) {
      const k = { right: false, left: false, jumpPressed: false, jumpHeld: false };
      const wd = P.wallDir || P.nearWall(w.level);
      if (i > 15 && !P.onGround && wd && P.vy > -150 && !jh) { k.jumpPressed = true; jh = true; dir = -wd; } else jh = jh && P.vy < 0;
      k.jumpHeld = jh; if (w.tile()[1] < 15.2 && i > 15) dir = 1;
      if (dir > 0 || i < 12) k.right = true; else k.left = true;
      w.tick(k); if (P.dead) return false;
      if (P.onGround && i > 30) return w.tile()[0] > 118.5;
    }
    return false;
  } },
  { name: 'crate on plate', goal: (w) => w.level.byId.hall_plate.byCrate, h: (w) => Math.abs(crate(w).x / 32 - 129.5) + Math.abs(crate(w).y / 32 - 25) + 0.3 * Math.abs(w.player.cx - crate(w).x) / 32, opts: { maxNodes: 300000, extra: [{ k: 'R', f: 30 }, { k: 'R', f: 60 }], key: (w) => Math.round(crate(w).x / 8) + ',' + Math.round(crate(w).y / 8) } },
  { name: 'terminal', goal: (w) => { const t = w.focus(); return t && t.type === 'terminal'; }, h: toward(141, 26, 1), opts: { maxNodes: 200000 } },
  { name: 'lights', use: true, check: (w) => w.level.byId.lift.powered },
  { name: 'lift top C146', goal: cpLit(146), h: toward(146, 10, 0.5), opts: { timeKey: 12, maxNodes: 200000, extra: [{ k: '', f: 40 }] } },
  { name: 'pads C162', goal: cpLit(162), h: toward(162, 17, 0.5), opts: { maxNodes: 200000 } },
  { name: 'exit', goal: (w) => w.completed, h: toward(195, 8, 0.5), opts: { timeKey: 6.4, maxNodes: 300000, extra: [{ k: '', f: 40 }] } },
]);
