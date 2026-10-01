/** Placeholder — replaced by the cutscene illustration implementation. */
G.Art.Scenes = {
  draw(ctx, id, t, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a1030'); g.addColorStop(1, '#301a40');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '14px sans-serif'; ctx.fillText('[scene: ' + id + ']', 40, 60);
  },
};
