/** l10 «Маяк» — planned route following the designer's QA notes in src/js/levels/l10.js. */
const { runPlanned, at, toward, cpLit, climb } = require('./planned');
const focusIs = (type, tx) => (w) => { const f = w.focus(); return !!f && f.type === type && (tx == null || f.tx === tx); };
const big = (extra) => Object.assign({ maxNodes: 300000, extra: [{ k: '', f: 30 }] }, extra || {});
runPlanned('l10', [
  { name: 'to pipes', goal: focusIs('terminal', 54), h: toward(54, 24, 0.5), opts: big() },
  { name: 'pipes', use: true, check: (w) => w.level.byId.pipe_bridge.powered },
  { name: 'C86', goal: cpLit(86), h: toward(86, 24, 0.5), opts: big({ timeKey: 6 }) },
  { name: 'to code', goal: focusIs('terminal', 88), h: toward(88, 24, 0.5), opts: big() },
  { name: 'code', use: true, check: (w) => w.level.byId.vault_door.powered },
  { name: 'shaft C100', goal: cpLit(100), h: toward(100, 7, 0.3), opts: big({ timeKey: 2.4 }) },
  { name: 'C121', goal: cpLit(121), h: toward(121, 7, 0.3), opts: big({ timeKey: 0 }) },
  { name: 'C141', goal: cpLit(141), h: toward(141, 11, 0.3), opts: big({ timeKey: 0 }) },
  { name: 'to lever', goal: focusIs('lever'), h: toward(144, 11, 0.5), opts: big() },
  { name: 'lever', use: true, check: (w) => w.level.byId.ret_lift.powered },
  { name: 'to core', goal: focusIs('part'), h: toward(146, 11, 0.5), opts: big() },
  { name: 'core', use: true, check: (w) => w.player.carry === 'core' },
  { name: 'chute', script: (w) => { // drop down the 6-wide chute x149-154 into the tunnel
    const P = w.player; let n = 0;
    while (w.tile()[0] < 151.5) { w.tick({ right: true }); if (++n > 400 || P.dead) return false; }
    n = 0; while (!(P.onGround && w.tile()[1] > 32.5)) { w.tick({}); if (++n > 400 || P.dead) return false; }
    n = 0; while (w.tile()[0] > 130) { w.tick({ left: true }); if (++n > 600 || P.dead) return false; }
    return P.carry === 'core';
  } },
  { name: 'to socket', goal: focusIs('socket'), h: toward(30, 24, 0.3), opts: big({ timeKey: 0 }) },
  { name: 'socket', use: true, check: (w) => w.level.byId.core_socket.active },
  { name: 'to final', goal: focusIs('terminal', 29), h: toward(29, 14, 0.3), opts: big({ timeKey: 0 }) },
  { name: 'final', use: true, check: (w) => w.level.byId.final_term.active },
  { name: 'exit', goal: (w) => w.completed, h: toward(37, 14, 0.3), opts: big() },
]);
