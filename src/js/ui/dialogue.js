/**
 * Dialogue + cutscene runner.
 *
 * Script data (src/js/story/script.js):
 *   G.Characters = { mira: {name, color}, ... }
 *   G.Script[id] = { mode: 'talk'|'bark', lines: [[who, mood, text], ...] }
 *     talk — blocks player control, advanced with Jump/Action/click.
 *     bark — non-blocking, auto-advances.
 *   G.Cutscenes[id] = [ { scene: 'space', duration: 4, lines: [[who, mood, text], ...] }, ... ]
 *     Each shot shows G.Art.Scenes.draw(ctx, scene, t, W, H, shotIndex) behind its lines.
 */
(function () {
  const W = G.VIEW_W, H = G.VIEW_H;
  const CPS = 48; // typewriter chars per second

  function normLine(l) {
    if (Array.isArray(l)) return { who: l[0], mood: l[1] || 'neutral', text: l[2] || '' };
    return { who: l.who, mood: l.mood || 'neutral', text: l.text || '' };
  }

  class Dialogue {
    constructor() { this.active = null; this.queue = []; }

    get blocking() { return !!(this.active && this.active.mode === 'talk'); }

    play(id, onDone) {
      const s = G.Script && G.Script[id];
      if (!s) { console.warn('Missing script id', id); if (onDone) onDone(); return; }
      const entry = { id, mode: s.mode || 'talk', lines: s.lines.map(normLine), onDone };
      if (this.active && this.active.mode === 'talk' && entry.mode === 'talk') { this.queue.push(entry); return; }
      if (this.active && this.active.mode === 'bark' && entry.mode === 'talk') { this.finish(); }
      if (this.active && entry.mode === 'bark') { this.queue.push(entry); return; }
      this.start(entry);
    }

    /** Play inline lines (used by triggers with `say`), mode 'bark' by default. */
    playInline(lines, mode, onDone) {
      const entry = { id: '__inline', mode: mode || 'bark', lines: lines.map(normLine), onDone };
      if (this.active && (this.active.mode === 'talk' || entry.mode === 'bark')) { this.queue.push(entry); return; }
      if (this.active) this.finish();
      this.start(entry);
    }

    start(entry) {
      this.active = entry;
      this.idx = 0; this.chars = 0; this.lineT = 0; this.openT = 0;
      this.blip = 0;
    }

    finish() {
      const a = this.active;
      this.active = null;
      if (a && a.onDone) a.onDone();
      if (this.queue.length) this.start(this.queue.shift());
    }

    get line() { return this.active ? this.active.lines[this.idx] : null; }

    advance() {
      const line = this.line;
      if (!line) return;
      if (this.chars < line.text.length) { this.chars = line.text.length; return; }
      this.idx++; this.chars = 0; this.lineT = 0;
      G.Audio.play('dialogNext');
      if (this.idx >= this.active.lines.length) this.finish();
    }

    update(dt) {
      if (!this.active) return;
      this.openT = Math.min(1, this.openT + dt * 6);
      this.lineT += dt;
      const line = this.line;
      if (!line) return;
      const before = Math.floor(this.chars);
      this.chars = Math.min(line.text.length, this.chars + dt * CPS);
      if (Math.floor(this.chars) > before) {
        this.blip += Math.floor(this.chars) - before;
        if (this.blip >= 3) { this.blip = 0; G.Audio.play('blip', { who: line.who }); }
      }
      const inp = G.input;
      if (this.active.mode === 'talk') {
        if (inp.pressed('confirm') || inp.pressed('action') || inp.pressed('jump') || inp.pointer.clicked) this.advance();
      } else {
        const hold = 1.6 + line.text.length * 0.045;
        if (this.chars >= line.text.length && this.lineT > hold) this.advance();
      }
    }

    /** Draw the dialogue box in VIEW space. */
    draw(ctx, t) {
      if (!this.active) return;
      const line = this.line;
      if (!line) return;
      const ch = (G.Characters && G.Characters[line.who]) || { name: line.who, color: '#fff' };
      const bark = this.active.mode === 'bark';
      const k = G.easeOutCubic(this.openT);
      const bw = bark ? 560 : 820, bh = bark ? 84 : 132;
      const bx = (W - bw) / 2, by = H - bh - (bark ? 18 : 22) + (1 - k) * 30;
      ctx.save();
      ctx.globalAlpha = k;
      // panel
      ctx.fillStyle = 'rgba(8,12,22,0.86)';
      G.roundRect(ctx, bx, by, bw, bh, 14); ctx.fill();
      ctx.strokeStyle = ch.color; ctx.globalAlpha = k * 0.7; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = k;
      // portrait
      const ps = bark ? 64 : 104;
      const px = bx + 12, py = by + (bh - ps) / 2;
      ctx.save();
      G.roundRect(ctx, px, py, ps, ps, 10); ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(px, py, ps, ps);
      const talking = this.chars < line.text.length;
      if (G.Art.Portraits && G.Art.Portraits.draw) G.Art.Portraits.draw(ctx, line.who, line.mood, px, py, ps, t, talking);
      ctx.restore();
      ctx.strokeStyle = ch.color; ctx.globalAlpha = k * 0.5; G.roundRect(ctx, px, py, ps, ps, 10); ctx.stroke();
      ctx.globalAlpha = k;
      // name
      const tx = px + ps + 16;
      ctx.fillStyle = ch.color;
      ctx.font = `700 ${bark ? 15 : 18}px "Exo 2", "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(ch.name, tx, by + (bark ? 10 : 14));
      // text
      ctx.fillStyle = '#e8eef8';
      ctx.font = `400 ${bark ? 16 : 19}px "Exo 2", "Segoe UI", sans-serif`;
      const shown = line.text.slice(0, Math.floor(this.chars));
      wrapText(ctx, shown, tx, by + (bark ? 32 : 44), bx + bw - tx - 24, bark ? 21 : 25, line.text);
      // continue indicator
      if (!bark && !talking) {
        const a = 0.5 + 0.5 * Math.sin(t * 6);
        ctx.globalAlpha = k * a;
        ctx.fillStyle = ch.color;
        ctx.beginPath();
        const cx = bx + bw - 26, cy = by + bh - 20;
        ctx.moveTo(cx - 7, cy - 4); ctx.lineTo(cx + 7, cy - 4); ctx.lineTo(cx, cy + 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Word-wrap using the FULL text for line breaks so typing doesn't reflow. */
  function wrapText(ctx, shown, x, y, maxW, lh, full) {
    const words = full.split(' ');
    let lineStr = '', count = 0, yy = y;
    const lines = [];
    for (const w of words) {
      const test = lineStr ? lineStr + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && lineStr) { lines.push(lineStr); lineStr = w; }
      else lineStr = test;
    }
    lines.push(lineStr);
    for (const l of lines) {
      const remaining = shown.length - count;
      if (remaining <= 0) break;
      ctx.fillText(l.slice(0, remaining), x, yy);
      count += l.length + 1;
      yy += lh;
    }
  }
  G.wrapText = wrapText;

  /** Cutscene player: full-screen illustrated shots with dialogue lines. */
  class Cutscene {
    constructor(id, onDone) {
      this.id = id;
      this.shots = (G.Cutscenes && G.Cutscenes[id]) || [];
      this.onDone = onDone;
      this.shot = -1; this.t = 0; this.shotT = 0;
      this.fade = 1; // fade-in from black
      this.dialogue = new Dialogue();
      this.done = false;
      this.skipHold = 0;
      if (!this.shots.length) console.warn('Missing cutscene', id);
      this.next();
    }
    next() {
      this.shot++;
      this.shotT = 0;
      if (this.shot >= this.shots.length) { this.end(); return; }
      const s = this.shots[this.shot];
      if (s.music) G.Audio.music(s.music);
      if (s.sound) G.Audio.play(s.sound);
      if (s.shake) G.fx.shake(s.shake, s.duration || 1);
      if (s.lines && s.lines.length) {
        G.Script.__cut = { mode: 'talk', lines: s.lines };
        this.dialogue.play('__cut', () => { this.linesDone = true; });
        this.linesDone = false;
      } else this.linesDone = true;
    }
    end() {
      if (this.done) return;
      this.done = true;
      if (this.onDone) this.onDone();
    }
    update(dt) {
      if (this.done) return;
      this.t += dt; this.shotT += dt;
      this.dialogue.update(dt);
      if (G.input.down('pause') || G.input.down('back')) { this.skipHold += dt; if (this.skipHold > 0.6) { G.input.reset(); this.end(); return; } }
      else this.skipHold = 0;
      const s = this.shots[this.shot];
      if (!s) return;
      const minT = s.duration || 1.5;
      if (this.linesDone && this.shotT >= minT) this.next();
    }
    draw(ctx, t) {
      const s = this.shots[this.shot];
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      if (s && G.Art.Scenes && G.Art.Scenes.draw) {
        ctx.save();
        const sh = G.fx.shakeOffset();
        ctx.translate(sh.x, sh.y);
        G.Art.Scenes.draw(ctx, s.scene, this.shotT, W, H, this.shot);
        ctx.restore();
      }
      // shot transitions: fade in on each shot start
      const fin = Math.max(0, 1 - this.shotT / 0.6);
      if (fin > 0) { ctx.fillStyle = `rgba(0,0,0,${fin})`; ctx.fillRect(0, 0, W, H); }
      // letterbox
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, 34); ctx.fillRect(0, H - 34, W, 34);
      if (s && s.caption) {
        ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, this.shotT) * 0.85 + ')';
        ctx.font = '600 15px "Exo 2", "Segoe UI", sans-serif';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(s.caption, 40, 17);
      }
      this.dialogue.draw(ctx, t);
      // skip hint
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.font = '500 12px "Exo 2", "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(G.input.touchActive ? 'Удерживайте ⏸ — пропустить' : 'Удерживайте Esc — пропустить', W - 24, H - 17);
      if (this.skipHold > 0) {
        ctx.fillStyle = 'rgba(126,249,255,0.8)';
        ctx.fillRect(W - 224, H - 8, 200 * Math.min(1, this.skipHold / 0.6), 3);
      }
      ctx.textAlign = 'left';
    }
  }

  G.Dialogue = Dialogue;
  G.Cutscene = Cutscene;
})();
