/**
 * Campaign order. before/after = cutscene ids from G.Cutscenes (src/js/story/script.js).
 */
G.LEVEL_ORDER = [
  { id: 'p1', before: 'intro' },
  { id: 'p2', after: 'crash' },
  { id: 'l01' },
  { id: 'l02' },
  { id: 'l03' },
  { id: 'l04' },
  { id: 'l05' },
  { id: 'l06' },
  { id: 'l07' },
  { id: 'l08' },
  { id: 'l09' },
  { id: 'l10', after: 'ending' },
  { id: 'l11', before: 'ch2_intro' },
  { id: 'l12' },
  { id: 'l13', after: 'ch2_end' },
].filter((e) => G.levels[e.id]);
