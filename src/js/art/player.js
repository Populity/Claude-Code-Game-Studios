/** Placeholder — replaced by the character animation implementation. */
G.Art.Player = {
  draw(ctx, p, t) {
    if (p.dead) return;
    ctx.fillStyle = '#f0a050'; ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#fff'; ctx.fillRect(p.facing > 0 ? p.x + p.w - 7 : p.x + 2, p.y + 8, 5, 5);
  },
};
G.Art.Drone = { draw(ctx, d) { ctx.fillStyle = '#7ef9ff'; ctx.beginPath(); ctx.arc(d.x, d.y, 8, 0, 7); ctx.fill(); } };
