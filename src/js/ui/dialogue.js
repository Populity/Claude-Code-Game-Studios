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
  const PAUSE = { '.': 0.16, '!': 0.16, '?': 0.16, '…': 0.2, ',': 0.06, '—': 0.08, ':': 0.08 };
  const FONT = '"Exo 2", "Segoe UI", sans-serif';

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
      this.blip = 0; this.pauseT = 0;
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
      if (this.chars < line.text.length) { this.chars = line.text.length; this.pauseT = 0; return; }
      this.idx++; this.chars = 0; this.lineT = 0; this.pauseT = 0;
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
      if (this.pauseT > 0) this.pauseT -= dt;
      else {
        this.chars = Math.min(line.text.length, this.chars + dt * CPS);
        // brief beat after sentence punctuation so lines read like speech
        const ci = Math.floor(this.chars);
        if (ci > before && ci < line.text.length) {
          const pc = line.text[ci - 1];
          if (PAUSE[pc] && line.text[ci] === ' ') this.pauseT = PAUSE[pc];
        }
      }
      if (Math.floor(this.chars) > before) {
        this.blip += Math.floor(this.chars) - before;
        if (this.blip >= 3) { this.blip = 0; G.Audio.play('blip', { who: line.who }); }
      }
      const inp = G.input;
      if (this.active.mode === 'talk') {
        // short guard so the press that opened the box (or a double-tap) doesn't skip a line unseen
        const ready = this.openT >= 1 && this.lineT > 0.12;
        if (ready && (inp.pressed('confirm') || inp.pressed('action') || inp.pressed('jump') || inp.pointer.clicked)) this.advance();
      } else {
        const hold = 1.6 + line.text.length * 0.045;
        if (this.chars >= line.text.length && this.lineT > hold) this.advance();
      }
    }

    /**
     * Fit the line into the box: try the default size, then step the font down,
     * then (last resort) grow the box, so no line can ever overflow the panel.
     */
    layoutLine(ctx, text, bark) {
      const key = text + '|' + bark;
      if (this._lay && this._lay.key === key) return this._lay;
      const bw = bark ? 560 : 820, ps = bark ? 64 : 104;
      const maxW = bw - (12 + ps + 16) - 24;
      const maxLines = bark ? 2 : 3;
      const sizes = bark ? [16, 15, 14] : [19, 18, 17, 16];
      let size = sizes[0], lines;
      for (size of sizes) {
        ctx.font = `400 ${size}px ${FONT}`;
        lines = splitLines(ctx, text, maxW);
        if (lines.length <= maxLines) break;
      }
      const lh = Math.round(size * 1.32);
      const top = bark ? 32 : 44;
      const bh = Math.max(bark ? 84 : 132, top + lines.length * lh + (bark ? 10 : 16));
      this._lay = { key, bw, bh, ps, size, lh, top, maxW, lines };
      return this._lay;
    }

    /**
     * Draw the dialogue box in VIEW space.
     * opts.top: place at the top (player is low on screen). opts.bottom: extra bottom margin (cutscene letterbox).
     */
    draw(ctx, t, opts) {
      if (!this.active) return;
      const line = this.line;
      if (!line) return;
      const ch = (G.Characters && G.Characters[line.who]) || { name: line.who, color: '#fff' };
      const bark = this.active.mode === 'bark';
      const k = G.easeOutCubic(this.openT);
      const L = this.layoutLine(ctx, line.text, bark);
      const bw = L.bw, bh = L.bh;
      const bx = (W - bw) / 2;
      const bottom = (opts && opts.bottom) || 0;
      const by = opts && opts.top ? (bark ? 76 : 70) - (1 - k) * 30 : H - bh - (bark ? 18 : 22) - bottom + (1 - k) * 30;
      ctx.save();
      ctx.globalAlpha = k;
      // panel: soft drop shadow + vertical gradient so it reads over bright scenes
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;
      const pg = ctx.createLinearGradient(0, by, 0, by + bh);
      pg.addColorStop(0, 'rgba(12,18,32,0.92)'); pg.addColorStop(1, 'rgba(6,9,18,0.92)');
      ctx.fillStyle = pg;
      G.roundRect(ctx, bx, by, bw, bh, 14); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = ch.color; ctx.globalAlpha = k * 0.7; ctx.lineWidth = 2;
      G.roundRect(ctx, bx, by, bw, bh, 14); ctx.stroke();
      ctx.globalAlpha = k;
      // portrait
      const ps = L.ps;
      const px = bx + 12, py = by + (bark ? (bh - ps) / 2 : 14);
      ctx.save();
      G.roundRect(ctx, px, py, ps, ps, 10); ctx.clip();
      const bgc = ctx.createRadialGradient(px + ps / 2, py + ps * 0.4, 4, px + ps / 2, py + ps / 2, ps * 0.75);
      bgc.addColorStop(0, 'rgba(255,255,255,0.10)'); bgc.addColorStop(1, 'rgba(255,255,255,0.02)');
      ctx.fillStyle = bgc; ctx.fillRect(px, py, ps, ps);
      const talking = this.chars < line.text.length;
      if (G.Art.Portraits && G.Art.Portraits.draw) G.Art.Portraits.draw(ctx, line.who, line.mood, px, py, ps, t, talking);
      ctx.restore();
      ctx.strokeStyle = ch.color; ctx.globalAlpha = k * 0.6; ctx.lineWidth = 2; G.roundRect(ctx, px, py, ps, ps, 10); ctx.stroke();
      ctx.globalAlpha = k;
      // name plate: coloured name + thin accent rule
      const tx = px + ps + 16;
      ctx.fillStyle = ch.color;
      ctx.font = `700 ${bark ? 15 : 18}px ${FONT}`;
      ctx.textBaseline = 'top';
      const ny = by + (bark ? 10 : 14);
      ctx.fillText(ch.name, tx, ny);
      const nw = ctx.measureText(ch.name).width;
      ctx.globalAlpha = k * 0.35; ctx.fillRect(tx + nw + 10, ny + (bark ? 8 : 10), Math.min(120, bx + bw - tx - nw - 40), 1);
      ctx.globalAlpha = k;
      // text
      ctx.fillStyle = '#eef3fb';
      ctx.font = `400 ${L.size}px ${FONT}`;
      drawLines(ctx, L.lines, Math.floor(this.chars), tx, by + L.top, L.lh);
      // continue indicator
      if (!bark && !talking) {
        const a = 0.55 + 0.45 * Math.sin(t * 6);
        ctx.globalAlpha = k * a;
        ctx.fillStyle = ch.color;
        ctx.beginPath();
        const cx = bx + bw - 26, cy = by + bh - 20 + Math.sin(t * 6) * 2;
        ctx.moveTo(cx - 7, cy - 4); ctx.lineTo(cx + 7, cy - 4); ctx.lineTo(cx, cy + 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Break text into lines that fit maxW (honours '\n'; hard-breaks words longer than a line). */
  function splitLines(ctx, full, maxW) {
    const out = [];
    for (const para of String(full).split('\n')) {
      let lineStr = '';
      for (let w of para.split(' ')) {
        const test = lineStr ? lineStr + ' ' + w : w;
        if (ctx.measureText(test).width <= maxW || !lineStr) {
          lineStr = test;
          // a single over-long token: hard-break it
          while (ctx.measureText(lineStr).width > maxW && lineStr.length > 1) {
            let cut = lineStr.length - 1;
            while (cut > 1 && ctx.measureText(lineStr.slice(0, cut)).width > maxW) cut--;
            out.push(lineStr.slice(0, cut)); lineStr = lineStr.slice(cut);
          }
        } else { out.push(lineStr); lineStr = w; }
      }
      out.push(lineStr);
    }
    return out;
  }

  /** Draw pre-split lines, revealing only the first `count` characters (typewriter). */
  function drawLines(ctx, lines, count, x, y, lh) {
    let left = count;
    for (const l of lines) {
      if (left <= 0) break;
      ctx.fillText(l.slice(0, left), x, y);
      left -= l.length + 1;
      y += lh;
    }
  }

  /**
   * Word-wrap using the FULL text for line breaks so typing doesn't reflow.
   * Returns the number of lines the full text occupies (so callers can stack paragraphs).
   */
  function wrapText(ctx, shown, x, y, maxW, lh, full) {
    const lines = splitLines(ctx, full == null ? shown : full, maxW);
    drawLines(ctx, lines, shown.length, x, y, lh);
    return lines.length;
  }
  G.splitLines = splitLines;
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
        ctx.font = `600 15px ${FONT}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(s.caption, 40, 17);
      }
      // keep the box clear of the bottom letterbox bar
      this.dialogue.draw(ctx, t, { bottom: 14 });
      // skip hint, drawn inside the bottom letterbox bar with a key-cap
      const touch = G.input.touchActive;
      const pad = G.input.lastDevice === 'gamepad';
      const key = touch ? '⏸' : pad ? 'Start' : 'Esc';
      const label = 'Удерживайте, чтобы пропустить';
      ctx.textBaseline = 'middle';
      ctx.font = `500 13px ${FONT}`;
      const lw = ctx.measureText(label).width;
      ctx.font = `700 12px ${FONT}`;
      const kw = Math.max(26, ctx.measureText(key).width + 14);
      const hx = W - 24 - lw, ky = H - 17;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      G.roundRect(ctx, hx - kw - 8, ky - 10, kw, 20, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'center';
      ctx.fillText(key, hx - 8 - kw / 2, ky + 0.5);
      ctx.textAlign = 'left'; ctx.font = `500 13px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fillText(label, hx, ky + 0.5);
      if (this.skipHold > 0) {
        const pw = lw + kw + 8;
        ctx.fillStyle = 'rgba(126,249,255,0.25)'; ctx.fillRect(hx - kw - 8, H - 4, pw, 2);
        ctx.fillStyle = 'rgba(126,249,255,0.95)';
        ctx.fillRect(hx - kw - 8, H - 4, pw * Math.min(1, this.skipHold / 0.6), 2);
      }
      ctx.textAlign = 'left';
    }
  }

  G.Dialogue = Dialogue;
  G.Cutscene = Cutscene;
})();
