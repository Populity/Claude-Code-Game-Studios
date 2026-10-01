/** Placeholder — replaced by the entity animation implementation. */
G.Art.Entities = {
  draw(ctx, e, t) {
    const c = { door: '#5a6a8a', bridge: '#8a9aba', lever: '#ffcf6b', plate: '#c0a060', terminal: '#3ad0ff', part: '#ffe17a', socket: '#a08040',
      mplatform: '#9aa0b0', crate: '#a07040', checkpoint: '#60ff90', exit: '#80ffff', shard: '#7ef9ff', jumppad: '#ff70c0', sign: '#c0a080' }[e.type];
    if (e.type === 'laser') { if (e.phase === 'on') { ctx.fillStyle = '#ff3050'; ctx.fillRect(e.beam.x, e.beam.y, e.beam.w, e.beam.h); } else if (e.phase === 'warn') { ctx.fillStyle = 'rgba(255,48,80,0.3)'; ctx.fillRect(e.beam.x, e.beam.y, e.beam.w, e.beam.h); } ctx.fillStyle = '#555'; ctx.fillRect(e.x + 8, e.y + 8, 16, 16); return; }
    if (e.type === 'saw') { ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 7); ctx.fill(); return; }
    if (!c) return;
    if (e.type === 'door' && e.openT > 0.99) return;
    if (e.type === 'bridge' && e.extendT < 0.01) return;
    if (e.type === 'part' && e.taken) return;
    if (e.type === 'shard' && e.collected) return;
    ctx.fillStyle = c; ctx.globalAlpha = e.type === 'door' ? 1 - e.openT * 0.8 : 1;
    ctx.fillRect(e.x, e.y, e.w, e.h); ctx.globalAlpha = 1;
  },
};
