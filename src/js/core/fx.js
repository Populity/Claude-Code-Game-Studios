/**
 * Particles and screen shake. World-space particles, drawn after entities.
 * Art modules may call G.fx.* too (e.g. ambient sparks) — keep counts modest.
 */
(function () {
  const MAX = 900;
  const parts = [];
  let shakeAmp = 0, shakeT = 0, shakeDur = 1;

  /** Low graphics quality halves particle spawns. */
  const lowN = (n) => (G.lowGfx && G.lowGfx() ? Math.ceil(n / 2) : n);

  const fx = {
    parts,
    /**
     * Spawn a radial burst.
     * opts: count, color, speed, life, size, gravity, drag, glow(bool), shape('circle'|'square'|'spark')
     */
    burst(x, y, o = {}) {
      const n = lowN(o.count || 10);
      for (let i = 0; i < n; i++) {
        const a = o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread || 1) : Math.random() * Math.PI * 2;
        const s = (o.speed || 100) * (0.35 + Math.random() * 0.65);
        fx.spawn({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
          life: (o.life || 0.6) * (0.6 + Math.random() * 0.4),
          size: (o.size || 3) * (0.6 + Math.random() * 0.8),
          color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color || '#fff',
          gravity: o.gravity == null ? 400 : o.gravity,
          drag: o.drag == null ? 1.5 : o.drag,
          glow: !!o.glow, shape: o.shape || 'circle',
        });
      }
    },
    /** Small dust puff at feet. */
    dust(x, y, n = 4) {
      n = lowN(n);
      const col = (G.Art.Decor && G.Art.Decor.dustColor && G.game && G.game.level) ? G.Art.Decor.dustColor(G.game.level) : 'rgba(210,190,160,0.8)';
      for (let i = 0; i < n; i++) {
        fx.spawn({
          x: x + (Math.random() - 0.5) * 14, y: y - 2,
          vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 60 - 10,
          life: 0.35 + Math.random() * 0.3, size: 2 + Math.random() * 3,
          color: col, gravity: -20, drag: 3, shape: 'circle', fade: true, grow: 1.8,
        });
      }
    },
    spawn(p) {
      if (parts.length >= MAX) parts.shift();
      p.t = 0; p.maxLife = p.life;
      parts.push(p);
    },
    shake(amp, dur) {
      if (G.settings && G.settings.reduceShake) amp *= 0.3;
      if (amp >= shakeAmp * (shakeT / shakeDur)) { shakeAmp = amp; shakeDur = dur; shakeT = dur; }
    },
    shakeOffset() {
      if (shakeT <= 0) return { x: 0, y: 0 };
      const k = (shakeT / shakeDur) * shakeAmp;
      return { x: (Math.random() * 2 - 1) * k, y: (Math.random() * 2 - 1) * k };
    },
    clear() { parts.length = 0; shakeT = 0; },
    update(dt) {
      shakeT = Math.max(0, shakeT - dt);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t >= p.maxLife) { parts.splice(i, 1); continue; }
        p.vy += p.gravity * dt;
        const d = Math.exp(-p.drag * dt);
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
    },
    /** Draw in world space (ctx already camera-translated). */
    draw(ctx) {
      for (const p of parts) {
        const k = 1 - p.t / p.maxLife;
        const size = p.grow ? p.size * (1 + (p.grow - 1) * (1 - k)) : p.size * (0.4 + 0.6 * k);
        ctx.globalAlpha = Math.min(1, k * 1.4);
        ctx.fillStyle = p.color;
        if (p.glow) { ctx.globalCompositeOperation = 'lighter'; }
        if (p.shape === 'square') ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
        else if (p.shape === 'spark') {
          ctx.strokeStyle = p.color; ctx.lineWidth = size * 0.6;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
        } else { ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.globalAlpha = 1;
    },
  };
  G.fx = fx;
})();
