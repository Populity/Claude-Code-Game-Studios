const { Sim } = require('./sim');
const s = new Sim('l01', { verbose: process.argv.includes('-v') });
s.run([
  ['walk', 16], ['jump', -1, 30, 14], ['walk', 11], ['jump', -1, 22, 30], ['walk', 7], ['jump', -1, 30, 30], ['walk', 3], ['jump', 1, 30, 30], ['walk', 7], ['runjump', 8.6, 1, 14, 20], ['walk', 13], ['act'], ['wait', 10], ['walk', 14], ['walk', 16], ['walk', 24], ['act'], ['wait', 90],
  ['walk', 40], ['runjump', 42.6, 1, 10, 10], ['walk', 46], ['runjump', 48.6, 1, 20], ['walk', 64],
  ['wallclimb', 5, 1, 900, 1], ['walk', 80], ['walk', 85], ['runjump', 87.5, 1, 30], ['walk', 103],
  ['jump', 1, 30, 16], ['walk', 106], ['runjump', 107.8, 1, 30, 20], ['walk', 111], ['runjump', 112.8, 1, 20, 20], ['walk', 116], ['runjump', 117.8, 1, 16, 18],
  ['walk', 121], ['runjump', 122.2, 1, 10, 30], ['walk', 132], ['jump', 1, 20, 18], ['walk', 137], ['jump', 1, 20, 20], ['walk', 165],
]);
s.report();
