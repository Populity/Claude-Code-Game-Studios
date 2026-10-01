const { Sim } = require('./sim');
const s = new Sim('p1', { verbose: process.argv.includes('-v') });
s.run([
  ['walk', 19],
  ['jump', 1, 30, 12], ['walk', 22],          // 1-step
  ['jump', 1, 30, 12], ['walk', 26],          // 2-step
  ['jump', 1, 30, 14], ['walk', 33],          // 3-step (full hold)
  ['walk', 36],
  ['runjump', 37.6, 1, 30], ['walk', 44],    // safe pit
  ['runjump', 45.5, 1, 30], ['walk', 49.5],  // spike pit 1 (shard)
  ['runjump', 50.5, 1, 30], ['walk', 58],    // spike pit 2 (4 wide)
  ['act'], ['wait', 60], ['walk', 64],
  ['walk', 68], ['laserGap', 70, 1.0], ['walk', 77],
  ['laserGap', 80, 0.5], ['walk', 82],
  ['laserGap', 85, 0.5], ['runjump', 83.5, 1, 20], ['walk', 92],
  ['walk', 97], ['jump', 0, 30], ['walk', 99], ['jump', 1, 30, 14], ['walk', 103], ['jump', 1, 30, 30], ['walk', 109],
]);
s.report();
