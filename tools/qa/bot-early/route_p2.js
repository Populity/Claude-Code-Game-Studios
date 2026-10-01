const { Sim } = require('./sim');
const s = new Sim('p2', { verbose: process.argv.includes('-v') });
const from = process.argv[2];
const steps = {
  pools: [
    ['walk', 11], ['runjump', 11.6, 1, 30], ['walk', 18], ['runjump', 18.6, 1, 30], ['walk', 27],
    ['jump', 1, 20, 24], ['walk', 32], ['jump', 1, 20, 22], ['walk', 40],
  ],
  terminal: [['walk', 50], ['act'], ['wait', 70], ['walk', 63]],
  shaft1: [['walk', 64], ['wallclimb', 16, 1], ['walk', 70]],
  shaft2: [['walk', 72], ['wallclimb', 7, 1, 900, 1], ['walk', 80]],
  deck: [['walk', 84], ['walk', 92], ['walk', 105], ['walk', 109],
    ['runjump', 110.6, 1, 10, 14], ['runjump', 115.3, 1, 20, 22], ['runjump', 121.3, 1, 14, 22], ['runjump', 127.3, 1, 14, 20], ['walk', 144]],
};
const order = ['pools', 'terminal', 'shaft1', 'shaft2', 'deck'];
for (const k of order.slice(from ? order.indexOf(from) : 0)) { s.note('== ' + k); s.run(steps[k]); }
s.report();
