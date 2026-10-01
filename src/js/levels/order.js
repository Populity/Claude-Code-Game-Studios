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
].filter((e) => G.levels[e.id]);
