/** Placeholder — replaced by the portrait implementation. */
G.Art.Portraits = { draw(ctx, who, mood, x, y, s) { ctx.fillStyle = (G.Characters[who] || {}).color || '#888'; ctx.fillRect(x + 10, y + 10, s - 20, s - 20); } };
