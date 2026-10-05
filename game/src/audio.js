// Procedural WebAudio SFX + beat — no asset files needed.
let ctx = null, master = null, musicNode = null;
function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination); }
  return ctx;
}
function tone(freq, dur, type = 'square', vol = 0.3, slide = 0) {
  const a = ac(); if (!a) return; const t = a.currentTime;
  const o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur);
}
function noise(dur, vol = 0.3, lp = 1200) {
  const a = ac(); if (!a) return; const t = a.currentTime;
  const b = a.createBuffer(1, a.sampleRate * dur, a.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = a.createBufferSource(); s.buffer = b; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
  const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t);
}
let lastPop = 0;
export const Sfx = {
  unlock() { ac()?.resume(); },
  click() { tone(880, 0.05, 'square', 0.1); },
  pop() { const n = performance.now(); if (n - lastPop < 40) return; lastPop = n; tone(500 + Math.random() * 400, 0.08, 'triangle', 0.15, 600); },
  snipe() { noise(0.15, 0.25, 4000); tone(1400, 0.1, 'sawtooth', 0.08, -1000); },
  slam() { tone(90, 0.35, 'sine', 0.6, -50); noise(0.25, 0.3, 500); },
  bass() { tone(60, 0.4, 'sine', 0.55, -20); tone(120, 0.15, 'square', 0.08); },
  throw() { tone(300, 0.2, 'triangle', 0.1, 300); },
  boom() { noise(0.6, 0.45, 700); tone(70, 0.5, 'sine', 0.5, -40); },
  place() { tone(523, 0.08, 'square', 0.15); setTimeout(() => tone(784, 0.12, 'square', 0.15), 70); },
  upgrade() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.1, 'square', 0.14), i * 60)); },
  hurt() { tone(200, 0.3, 'sawtooth', 0.25, -150); },
  wave() { tone(220, 0.3, 'sawtooth', 0.15, 220); },
  ult() { noise(1.2, 0.5, 2500); [262, 330, 392, 523, 659].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sawtooth', 0.15), i * 50)); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'square', 0.15), i * 110)); },
  lose() { [400, 300, 200, 120].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sawtooth', 0.15), i * 180)); },
  music(on) {
    if (musicNode) { clearInterval(musicNode); musicNode = null; }
    if (!on) return;
    let i = 0; const bassline = [55, 55, 65.4, 49];
    musicNode = setInterval(() => {
      if (!ctx || ctx.state !== 'running') return;
      const beat = i % 8; if (beat % 2 === 0) tone(50, 0.18, 'sine', 0.35, -20);
      if (beat % 4 === 2) noise(0.08, 0.08, 6000);
      tone(bassline[(i >> 3) % 4] * 2, 0.2, 'sawtooth', 0.05); i++;
    }, 220);
  },
};
