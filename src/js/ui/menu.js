/**
 * Generic vertical menu widget (keyboard/gamepad/mouse/touch) used by title,
 * pause and settings screens. Items: {label, action(), disabled?, value?() , left?(), right?()}
 */
(function () {
  const FONT = '"Exo 2", "Segoe UI", sans-serif';
  class Menu {
    constructor(items, opts = {}) {
      this.items = items;
      this.sel = items.findIndex((i) => !i.disabled);
      if (this.sel < 0) this.sel = 0;
      this.x = opts.x || G.VIEW_W / 2;
      this.y = opts.y || 260;
      this.lh = opts.lh || 46;
      this.w = opts.w || 320;
      this.align = opts.align || 'center';
      this.size = opts.size || 22;
      this.rects = [];
      this.t = 0;
    }
    move(d) {
      const n = this.items.length;
      for (let k = 0; k < n; k++) {
        this.sel = (this.sel + d + n) % n;
        if (!this.items[this.sel].disabled) break;
      }
      G.Audio.play('uiMove');
    }
    update(dt) {
      this.t += dt;
      const inp = G.input;
      if (inp.pressed('up')) this.move(-1);
      if (inp.pressed('down')) this.move(1);
      const it = this.items[this.sel];
      if (it && it.left && inp.pressed('left')) { it.left(); G.Audio.play('uiMove'); }
      if (it && it.right && inp.pressed('right')) { it.right(); G.Audio.play('uiMove'); }
      if ((inp.pressed('confirm') || inp.pressed('action')) && it && !it.disabled) { G.Audio.play('uiSelect'); it.action && it.action(); return; }
      // pointer
      for (let i = 0; i < this.rects.length; i++) {
        const r = this.rects[i];
        const p = inp.pointer;
        const hit = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
        if (hit && p.moved && !this.items[i].disabled && this.sel !== i) { this.sel = i; }
        if (hit && p.clicked && !this.items[i].disabled) {
          this.sel = i;
          const item = this.items[i];
          if (item.left && item.right) {
            // click left/right half to adjust sliders
            if (p.x < r.x + r.w * 0.35) item.left(); else if (p.x > r.x + r.w * 0.65) item.right(); else if (item.action) item.action();
            G.Audio.play('uiMove');
          } else { G.Audio.play('uiSelect'); item.action && item.action(); }
          return;
        }
      }
    }
    draw(ctx) {
      this.rects = [];
      ctx.textBaseline = 'middle';
      this.items.forEach((it, i) => {
        const y = this.y + i * this.lh;
        const sel = i === this.sel;
        const rx = this.align === 'center' ? this.x - this.w / 2 : this.x - 16;
        const r = { x: rx, y: y - this.lh / 2 + 4, w: this.w, h: this.lh - 8 };
        this.rects.push(r);
        if (sel) {
          const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
          g.addColorStop(0, 'rgba(126,249,255,0)'); g.addColorStop(0.5, 'rgba(126,249,255,0.18)'); g.addColorStop(1, 'rgba(126,249,255,0)');
          ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        ctx.font = `${sel ? 700 : 500} ${this.size}px ${FONT}`;
        ctx.textAlign = this.align;
        ctx.fillStyle = it.disabled ? 'rgba(255,255,255,0.28)' : sel ? '#ffffff' : 'rgba(220,235,255,0.72)';
        let label = it.label;
        if (it.value) label += ':  ' + (it.left ? '‹ ' : '') + it.value() + (it.right ? ' ›' : '');
        if (sel) { ctx.save(); ctx.shadowColor = '#7ef9ff'; ctx.shadowBlur = 16; ctx.fillText(label, this.x, y); ctx.restore(); }
        else ctx.fillText(label, this.x, y);
      });
      ctx.textAlign = 'left';
    }
  }
  G.Menu = Menu;
})();
