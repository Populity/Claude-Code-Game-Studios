const { Sim } = require('./sim');
const s = new Sim('l02', { verbose: process.argv.includes('-v') });
const P = (s) => s.level.byId;
s.run([
  ['walk', 29], ['walk', 35], ['jump', 1, 20, 14], ['walk', 40], ['check', (s) => P(s).plate_lesson.active && P(s).plate_lesson.byCrate, 'crate on lesson plate'],
  ['wait', 40], ['walk', 47],
  ['runjump', 50.6, 1, 30, 20], ['walk', 59], ['runjump', 60.5, 1, 20, 16], ['runjump', 64.4, 1, 24, 16], ['runjump', 68.4, 1, 20, 22],
  ['walk', 74], ['hold', {r:1}, 40], ['walk', 80], ['jump', 1, 20, 20], ['walk', 84],
  ['walk', 89], ['check', (s) => P(s).plate_a.active && P(s).plate_a.byCrate, 'crate in well A'],
  ['jump', 1, 20, 10], ['walk', 91], ['jump', 1, 20, 14], ['walk', 94], ['jump', 1, 20, 12], ['walk', 96], ['walk', 101], ['hold', {r:1}, 20], ['wait', 60],
  ['check', (s) => P(s).plate_b.active && P(s).plate_b.byCrate, 'crate in well B'],
  ['walk', 101], ['runjump', 101.6, 1, 10, 30], ['walk', 113],
  ['runjump', 117.3, 1, 10, 30], ['runjump', 122.4, 1, 20, 30], ['runjump', 129.4, 1, 20, 30], ['runjump', 136.4, 1, 20, 18],
  ['runjump', 140.4, 1, 20, 18], ['runjump', 144.4, 1, 20, 30], ['walk', 158], ['jump', 1, 20, 20], ['walk', 165], ['jump', 1, 20, 20], ['walk', 174],
]);
s.report();
