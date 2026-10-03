/**
 * TESSERA — procedural audio (Web Audio API, zero audio files).
 *
 * Sets G.Audio.impl = { play(name, opts), music(id), setVolume(kind, v), unlock(), update(dt) }.
 *
 * Signal flow (one engine per AudioContext; the same builders target an OfflineAudioContext
 * for the render test in G.Audio.synth.renderOffline):
 *
 *   sfx voices ──► sfx bus ──┐                        ┌─► reverb send A/B (convolver, per-biome IR, crossfaded)
 *   music tracks ► music bus ┼─► mix ─► HPF ─► glue comp ─► limiter ─► soft clip ─► master ─► out
 *                            └─ reverb / delay returns ─┘
 *
 * Music: generative tracks driven by a lookahead scheduler (setInterval 25 ms, ~0.12 s ahead).
 * Every track is built from the same layer vocabulary (drone, bed, pad, bass, motif, arp, perc,
 * events) and every melodic statement is a variant of the shared "signal" leitmotif, expressed
 * in scale degrees so each biome's mode recolours it (aeolian = longing, phrygian = menace,
 * lydian = wonder, dorian = open/warm, mixolydian = homeward).
 *
 * No AudioContext (node, old browser, headless failure) → every call silently no-ops.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const G = root.G;
  if (!G || !G.Audio) return;
  const AC = root.AudioContext || root.webkitAudioContext;
  const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;

  // ───────────────────────────── helpers / theory ─────────────────────────────
  const rnd = Math.random;
  const rr = (a, b) => a + (b - a) * rnd();
  const pick = (a) => a[(rnd() * a.length) | 0];
  const vary = (amt) => 1 + (rnd() * 2 - 1) * amt;
  const dv = (x, d) => (x != null ? x : d);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const MODES = {
    ionian: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10],
  };
  function degSemi(scale, d) {
    const n = scale.length, o = Math.floor(d / n);
    return scale[d - o * n] + 12 * o;
  }

  /**
   * The "signal" leitmotif — the rhythmic call the Ковчег-7 picks up in the intro.
   * Scale degrees (0 = tonic): 5th, 3rd, 4th, 7th-below, tonic. Rhythm in eighth notes.
   * In aeolian that is A-F-G-C-D over D: a falling question that lands home.
   */
  const SIGNAL = { deg: [4, 2, 3, -1, 0], dur: [1, 1, 2, 1, 3] };
  function motifVariant(v) {
    let deg = SIGNAL.deg.slice(), dur = SIGNAL.dur.slice();
    if (v === 'answer') { deg = [4, 2, 3, 5, 4]; }                 // unresolved: ends on the 5th
    else if (v === 'frag') { deg = deg.slice(0, 3); dur = [1, 1, 4]; }
    else if (v === 'aug') { dur = dur.map((x) => x * 2); }
    else if (v === 'inv') { deg = deg.map((d) => 4 - d); }         // mirror: 0,2,1,5,4
    else if (v === 'resolve') { deg = [4, 2, 3, -1, 0, 7]; dur = [1, 1, 2, 1, 1, 4]; }
    return { deg, dur };
  }

  function softClipCurve() {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
      const y = ax < 0.7 ? ax : 0.7 + 0.29 * Math.tanh((ax - 0.7) / 0.29);
      c[i] = x < 0 ? -y : y;
    }
    return c;
  }

  function makeNoise(ctx) {
    const sr = ctx.sampleRate, len = Math.floor(sr * 2);
    const mk = () => ctx.createBuffer(1, len, sr);
    const w = mk(), p = mk(), b = mk();
    const wd = w.getChannelData(0), pd = p.getChannelData(0), bd = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const x = rnd() * 2 - 1;
      wd[i] = x * 0.7;
      b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
      pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
      last = (last + 0.02 * x) / 1.02;
      bd[i] = last * 3.5;
    }
    // crossfade loop seam
    const f = Math.floor(sr * 0.01);
    for (const d of [wd, pd, bd]) for (let i = 0; i < f; i++) { const k = i / f; d[len - f + i] = d[len - f + i] * (1 - k) + d[i] * k; }
    return { w, p, b };
  }

  // ─────────────────────────────── spaces (reverb/delay presets) ───────────────────────────────
  // rt = RT60 (s), damp = one-pole brightness at start→end of tail, er = early reflections,
  // comb = metallic ringing, mus/sfx = send levels, dt/fb/dcut = feedback delay.
  const SPACES = {
    space:   { rt: 4.0, len: 4.5, pre: 0.02, damp: [0.55, 0.10], er: 0, comb: 0,    mus: 0.55, sfx: 0.16, dt: 0.48, fb: 0.42, dcut: 2600 },
    metal:   { rt: 1.1, len: 1.5, pre: 0.004, damp: [0.75, 0.35], er: 7, comb: 0.5, mus: 0.32, sfx: 0.20, dt: 0.19, fb: 0.22, dcut: 3500 },
    hull:    { rt: 2.3, len: 2.7, pre: 0.012, damp: [0.6, 0.18], er: 6, comb: 0.42,  mus: 0.40, sfx: 0.22, dt: 0.37, fb: 0.30, dcut: 2400 },
    open:    { rt: 1.5, len: 1.9, pre: 0.045, damp: [0.35, 0.07], er: 2, comb: 0,   mus: 0.30, sfx: 0.08, dt: 0.36, fb: 0.30, dcut: 2800 },
    canyon:  { rt: 2.6, len: 3.0, pre: 0.07, damp: [0.4, 0.08], er: 3, comb: 0,     mus: 0.36, sfx: 0.13, dt: 0.56, fb: 0.46, dcut: 2000 },
    hall:    { rt: 3.2, len: 3.6, pre: 0.025, damp: [0.5, 0.12], er: 9, comb: 0,    mus: 0.45, sfx: 0.18, dt: 0.42, fb: 0.30, dcut: 2600 },
    cave:    { rt: 4.4, len: 4.5, pre: 0.03, damp: [0.42, 0.10], er: 6, comb: 0.12, mus: 0.55, sfx: 0.30, dt: 0.62, fb: 0.44, dcut: 1700 },
    crystal: { rt: 4.0, len: 4.5, pre: 0.02, damp: [0.85, 0.35], er: 5, comb: 0.18, mus: 0.50, sfx: 0.25, dt: 0.33, fb: 0.50, dcut: 5200 },
    storm:   { rt: 1.9, len: 2.3, pre: 0.03, damp: [0.45, 0.10], er: 2, comb: 0,    mus: 0.30, sfx: 0.12, dt: 0.30, fb: 0.22, dcut: 2400 },
  };

  function genIR(ctx, s) {
    const sr = ctx.sampleRate, len = Math.floor(sr * s.len), pre = Math.floor(sr * s.pre);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.pow(10, (-3 * t) / s.rt);
        const a = s.damp[0] + (s.damp[1] - s.damp[0]) * Math.min(1, t / s.rt);
        lp += a * ((rnd() * 2 - 1) - lp);
        d[i] = lp * env;
      }
      for (let k = 0; k < s.er; k++) {
        const i = pre + Math.floor(sr * rr(0.003, 0.085));
        if (i < len) d[i] += (rnd() < 0.5 ? -1 : 1) * rr(0.25, 0.7) * (1 - k / (s.er + 1));
      }
      if (s.comb) {
        const D = [Math.floor(sr * (0.0047 + ch * 0.0003)), Math.floor(sr * (0.0071 - ch * 0.0004))];
        for (const Dk of D) for (let i = Dk; i < len; i++) d[i] += s.comb * 0.5 * d[i - Dk];
      }
      const fi = Math.floor(sr * 0.002);
      for (let i = 0; i < fi && pre + i < len; i++) d[pre + i] *= i / fi;
    }
    return buf;
  }

  // ─────────────────────────────── engine ───────────────────────────────
  const MAX_VOICES = 24;

  function createEngine(ctx, offline) {
    const vol = G.Audio.volumes || { master: 0.8, music: 0.6, sfx: 0.8 };
    const E = { ctx, offline: !!offline, voices: [], last: {}, tracks: [], musicId: undefined,
      key: { root: 50, scale: MODES.aeolian }, space: null, slot: 0, irCache: {} };
    const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    E.gain = gain;
    E.nb = makeNoise(ctx);

    // master chain
    E.mix = gain(1);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 28; hp.Q.value = 0.6;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -20; glue.knee.value = 16; glue.ratio.value = 2.5; glue.attack.value = 0.012; glue.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -6; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    const clip = ctx.createWaveShaper(); clip.curve = softClipCurve();
    E.master = gain(vol.master);
    E.mix.connect(hp); hp.connect(glue); glue.connect(lim); lim.connect(clip); clip.connect(E.master); E.master.connect(ctx.destination);

    E.music = gain(vol.music); E.music.connect(E.mix);
    E.sfx = gain(vol.sfx); E.sfx.connect(E.mix);

    // reverb: two convolver slots crossfaded on biome change
    E.revIn = gain(1);
    E.conv = [0, 1].map(() => { const c = ctx.createConvolver(); const g = gain(0); E.revIn.connect(c); c.connect(g); g.connect(E.mix); return { c, g }; });
    E.musSend = gain(0.4 * vol.music); E.musSend.connect(E.revIn);
    E.sfxSend = gain(0.15 * vol.sfx); E.sfxSend.connect(E.revIn);
    // ping-pong feedback delay
    E.dlyIn = gain(1);
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2), fl = gain(0.35), fr = gain(0.35);
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    const merge = ctx.createChannelMerger(2);
    dl.delayTime.value = 0.4; dr.delayTime.value = 0.4;
    E.dlyIn.connect(dlp); dlp.connect(dl); dl.connect(fl); fl.connect(dr); dr.connect(fr); fr.connect(dl);
    dl.connect(merge, 0, 0); dr.connect(merge, 0, 1);
    const dret = gain(0.55); merge.connect(dret); dret.connect(E.mix); dret.connect(E.revIn);
    E.dly = { dl, dr, fl, fr, dlp };
    E.dlyMus = gain(vol.music); E.dlyMus.connect(E.dlyIn);
    E.dlySfx = gain(vol.sfx); E.dlySfx.connect(E.dlyIn);
    E.spaceDef = SPACES.space;

    E.setVolume = function (kind, v) {
      const now = ctx.currentTime, s = E.spaceDef;
      v = clamp(+v || 0, 0, 1);
      if (kind === 'master') E.master.gain.setTargetAtTime(v, now, 0.05);
      else if (kind === 'music') { E.music.gain.setTargetAtTime(v, now, 0.05); E.musSend.gain.setTargetAtTime(s.mus * v, now, 0.05); E.dlyMus.gain.setTargetAtTime(v, now, 0.05); }
      else if (kind === 'sfx') { E.sfx.gain.setTargetAtTime(v, now, 0.05); E.sfxSend.gain.setTargetAtTime(s.sfx * v, now, 0.05); E.dlySfx.gain.setTargetAtTime(v, now, 0.05); }
    };

    E.setSpace = function (name) {
      const s = SPACES[name] || SPACES.open;
      if (E.space === name) return;
      const now = ctx.currentTime, first = E.space == null, xf = first ? 0.01 : 1.5;
      E.space = name; E.spaceDef = s;
      const ir = E.irCache[name] || (E.irCache[name] = genIR(ctx, s));
      const next = first ? 0 : 1 - E.slot;
      const a = E.conv[next], b = E.conv[1 - next];
      a.c.buffer = ir;
      a.g.gain.cancelScheduledValues(now); a.g.gain.setValueAtTime(a.g.gain.value, now); a.g.gain.linearRampToValueAtTime(1, now + xf);
      if (!first) { b.g.gain.cancelScheduledValues(now); b.g.gain.setValueAtTime(b.g.gain.value, now); b.g.gain.linearRampToValueAtTime(0, now + xf); }
      E.slot = next;
      const v = G.Audio.volumes || vol;
      E.musSend.gain.setTargetAtTime(s.mus * dv(v.music, 0.6), now, 0.4);
      E.sfxSend.gain.setTargetAtTime(s.sfx * dv(v.sfx, 0.8), now, 0.4);
      const tc = first ? 0.001 : 0.6;
      E.dly.dl.delayTime.setTargetAtTime(s.dt, now, tc);
      E.dly.dr.delayTime.setTargetAtTime(s.dt * 1.5 > 1.9 ? s.dt : s.dt * 1.5, now, tc);
      E.dly.fl.gain.setTargetAtTime(s.fb, now, tc); E.dly.fr.gain.setTargetAtTime(s.fb, now, tc);
      E.dly.dlp.frequency.setTargetAtTime(s.dcut, now, tc);
    };

    // ── primitives ──
    function connectAll(node, dest) { if (Array.isArray(dest)) { for (const d of dest) if (d) node.connect(d); } else node.connect(dest); }
    function mkFilter(t, q, dur) {
      const f = ctx.createBiquadFilter();
      f.type = q.type || 'lowpass';
      f.frequency.setValueAtTime(q.f, t);
      if (q.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, q.f2), t + dv(q.gl, dur));
      f.Q.value = dv(q.Q, 0.7);
      return f;
    }
    function mkPan(t, p, dur) {
      if (p.pan == null || !ctx.createStereoPanner) return null;
      const pn = ctx.createStereoPanner();
      pn.pan.setValueAtTime(clamp(p.pan, -1, 1), t);
      if (p.pan2 != null) pn.pan.linearRampToValueAtTime(clamp(p.pan2, -1, 1), t + dur);
      return pn;
    }
    function envelope(t, p, g0) {
      const a = dv(p.a, 0.004), h = p.h || 0, d = dv(p.d, 0.2);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(g0, t + a);
      if (h) env.gain.setValueAtTime(g0, t + a + h);
      env.gain.setTargetAtTime(0, t + a + h, d / 6);
      return { env, end: t + a + h + d };
    }
    /** Oscillator voice: {type,f,f2,gl,det,a,h,d,g,flt,fm:{r,i,d,s},vib:{r,c},pan,pan2} → {src,end} */
    function tone(dest, t, p) {
      const g0 = dv(p.g, 0.3);
      const { env, end } = envelope(t, p, g0);
      const total = end - t;
      const o = ctx.createOscillator();
      o.type = p.type || 'sine';
      o.frequency.setValueAtTime(p.f, t);
      if (p.f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, p.f2), t + dv(p.gl, total));
      if (p.det) o.detune.setValueAtTime(p.det, t);
      let head = o;
      if (p.flt) { const f = mkFilter(t, p.flt, total); head.connect(f); head = f; }
      head.connect(env);
      const pn = mkPan(t, p, total);
      if (pn) { env.connect(pn); connectAll(pn, dest); } else connectAll(env, dest);
      const stopAt = end + 0.03;
      if (p.fm) {
        const m = ctx.createOscillator(), mg = ctx.createGain();
        m.frequency.setValueAtTime(p.f * p.fm.r, t);
        if (p.f2) m.frequency.exponentialRampToValueAtTime(Math.max(1, p.f2 * p.fm.r), t + dv(p.gl, total));
        mg.gain.setValueAtTime(p.f * p.fm.i, t);
        mg.gain.setTargetAtTime(p.f * p.fm.i * dv(p.fm.s, 0.04), t, dv(p.fm.d, total / 3));
        m.connect(mg); mg.connect(o.frequency);
        m.start(t); m.stop(stopAt);
      }
      if (p.vib) {
        const l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = p.vib.r; lg.gain.value = p.vib.c;
        l.connect(lg); lg.connect(o.detune);
        l.start(t); l.stop(stopAt);
      }
      o.start(t); o.stop(stopAt);
      o.onended = () => { try { env.disconnect(); if (pn) pn.disconnect(); } catch (e) { /* */ } };
      return { src: o, end: stopAt };
    }
    /** Noise voice: {c:'w'|'p'|'b', rate, a,h,d,g, flt, pan,pan2} */
    function noise(dest, t, p) {
      const g0 = dv(p.g, 0.2);
      const { env, end } = envelope(t, p, g0);
      const total = end - t;
      const s = ctx.createBufferSource();
      s.buffer = E.nb[p.c || 'w']; s.loop = true;
      if (p.rate) s.playbackRate.value = p.rate;
      let head = s;
      if (p.flt) { const f = mkFilter(t, p.flt, total); head.connect(f); head = f; }
      if (p.flt2) { const f = mkFilter(t, p.flt2, total); head.connect(f); head = f; }
      head.connect(env);
      const pn = mkPan(t, p, total);
      if (pn) { env.connect(pn); connectAll(pn, dest); } else connectAll(env, dest);
      const stopAt = end + 0.03;
      s.start(t, rnd() * 1.8); s.stop(stopAt);
      s.onended = () => { try { env.disconnect(); if (pn) pn.disconnect(); } catch (e) { /* */ } };
      return { src: s, end: stopAt };
    }
    E.tone = tone; E.noise = noise;

    // key helpers for SFX (octave 0 ≈ C4..B4)
    E.kn = function (deg, oct) {
      const base = 60 + (((E.key.root % 12) + 12) % 12);
      return mtof(base + degSemi(E.key.scale, deg) + 12 * (oct || 0));
    };

    // ── SFX voices ──
    E.voice = function (o) {
      const now = ctx.currentTime;
      if (!E.offline && E.voices.length >= MAX_VOICES) {
        const old = E.voices.shift();
        try {
          old.out.gain.cancelScheduledValues(now); old.out.gain.setValueAtTime(old.out.gain.value, now);
          old.out.gain.linearRampToValueAtTime(0, now + 0.03);
          for (const s of old.srcs) { try { s.stop(now + 0.05); } catch (e) { /* */ } }
        } catch (e) { /* */ }
      }
      const out = gain(dv(o.g, 1));
      out.connect(E.sfx);
      const rev = gain(dv(o.rev, 0.25)); out.connect(rev); rev.connect(E.sfxSend);
      let dly = null;
      if (o.dly) { dly = gain(o.dly); out.connect(dly); dly.connect(E.dlySfx); }
      const v = { out, rev, dly, t: dv(o.t, now + 0.01), end: 0, srcs: [], last: null };
      return v;
    };
    E.vt = function (v, p) { const r = tone(v.out, v.t + (p.t || 0), p); v.srcs.push(r.src); if (r.end > v.end) { v.end = r.end; v.last = r.src; } return r; };
    E.vn = function (v, p) { const r = noise(v.out, v.t + (p.t || 0), p); v.srcs.push(r.src); if (r.end > v.end) { v.end = r.end; v.last = r.src; } return r; };
    E.finish = function (v) {
      if (!v.last) { try { v.out.disconnect(); } catch (e) { /* */ } return; }
      const prev = v.last.onended;
      v.last.onended = () => {
        if (prev) prev();
        try { v.out.disconnect(); v.rev.disconnect(); if (v.dly) v.dly.disconnect(); } catch (e) { /* */ }
        const i = E.voices.indexOf(v); if (i >= 0) E.voices.splice(i, 1);
      };
      E.voices.push(v);
    };

    E.play = function (name, opts) {
      const fn = SFX[name];
      if (!fn) return;
      opts = opts || {};
      const now = ctx.currentTime;
      if (!E.offline) {
        const lim = dv(RATE[name], 0.025);
        if (E.last[name] != null && now - E.last[name] < lim && now >= E.last[name]) return;
        E.last[name] = now;
      }
      const m = META[name] || {};
      const vol = typeof opts.volume === 'number' ? clamp(opts.volume, 0, 1.5) : 1;
      const v = E.voice({ g: vol * dv(m.g, 1), rev: m.rev, dly: m.dly, t: opts.at });
      fn(E, v, opts);
      E.finish(v);
    };

    // ── music ──
    E.setMusic = function (id, fade) {
      if (id === undefined) id = null;
      if (id === E.musicId) return;
      E.musicId = id;
      fade = dv(fade, 2);
      const now = ctx.currentTime;
      for (const T of E.tracks) if (T.stopAt == null) fadeOut(T, now, fade);
      if (id == null) return;
      const def = TRACKS[id] || TRACKS.ambient;
      E.key = { root: def.root, scale: MODES[def.mode] || MODES.aeolian };
      E.setSpace(def.space);
      E.tracks.push(makeTrack(E, def, id, now, fade));
    };
    function fadeOut(T, now, fade) {
      T.stopAt = now + fade;
      for (const g of [T.out.gain, T.echoF.gain]) {
        g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + fade);
      }
      for (const s of T.persist) { try { s.stop(T.stopAt + 0.1); } catch (e) { /* */ } }
    }
    E.schedule = function (horizon) {
      const now = ctx.currentTime;
      for (let k = E.tracks.length - 1; k >= 0; k--) {
        const T = E.tracks[k];
        if (!E.offline && T.next < now - 0.08) { while (T.next < now) { T.next += T.spb; T.i++; } }
        while (T.next < horizon && (T.stopAt == null || T.next < T.stopAt)) {
          try { stepTrack(T, T.i, T.next); } catch (e) { /* never break the loop */ }
          T.i++; T.next += T.spb;
        }
        if (T.stopAt != null && now > T.stopAt + 0.2) {
          E.tracks.splice(k, 1);
          const out = T.out, echo = T.echoF, rs = T.revS;
          setTimeout(() => { try { out.disconnect(); echo.disconnect(); rs.disconnect(); } catch (e) { /* */ } }, 6000);
        }
      }
    };
    E.modulate = function (dt) {
      const now = ctx.currentTime;
      for (const T of E.tracks) {
        if (!T.gust || T.stopAt != null) continue;
        T.gustT -= dt;
        if (T.gustT <= 0) {
          T.gustT = rr(2.5, 7);
          T.gust.gain.setTargetAtTime(rr(0.45, 1.5), now, rr(0.8, 2));
        }
      }
    };
    return E;
  }

  // ─────────────────────────────── music instruments ───────────────────────────────
  // All take (T, t, f, dur, g, dest) and write into the track.
  function dests(T, echo) { return echo ? [T.in, T.echo] : T.in; }
  const INST = {
    bell(T, t, f, dur, g, echo) {
      T.E.tone(dests(T, echo), t, { f, a: 0.003, d: Math.max(1.2, dur * 2.2), g, fm: { r: 3, i: 1.1, d: 0.25, s: 0.05 } });
      T.E.tone(T.in, t, { f: f * 0.5, a: 0.005, d: Math.max(1, dur * 1.6), g: g * 0.35 });
    },
    glass(T, t, f, dur, g, echo) {
      T.E.tone(dests(T, echo), t, { f, a: 0.002, d: 1.4, g, fm: { r: 3.5, i: 0.6, d: 0.12, s: 0.02 } });
    },
    pluck(T, t, f, dur, g, echo) {
      T.E.tone(dests(T, echo), t, { type: 'triangle', f, a: 0.003, d: Math.max(0.7, dur * 1.5), g, flt: { type: 'lowpass', f: Math.min(9000, f * 8), f2: f * 1.5, gl: 0.35, Q: 1.5 } });
      T.E.tone(T.in, t, { f: f * 2, a: 0.002, d: 0.25, g: g * 0.25 });
    },
    flute(T, t, f, dur, g, echo) {
      T.E.tone(dests(T, echo), t, { type: 'triangle', f, a: 0.09, h: dur * 0.55, d: dur * 0.7 + 0.2, g, vib: { r: 4.8, c: 9 }, flt: { type: 'lowpass', f: 2200 } });
      T.E.noise(T.in, t, { c: 'p', a: 0.06, h: dur * 0.3, d: 0.25, g: g * 0.25, flt: { type: 'bandpass', f: f * 2, Q: 8 } });
    },
    lead(T, t, f, dur, g, echo) {
      T.E.tone(dests(T, echo), t, { type: 'sawtooth', f, a: 0.03, h: dur * 0.5, d: dur * 0.6 + 0.15, g, vib: { r: 5.5, c: 7 }, flt: { type: 'lowpass', f: 2600, f2: 900, Q: 2 } });
      T.E.tone(T.in, t, { type: 'sawtooth', f, det: 9, a: 0.03, h: dur * 0.5, d: dur * 0.6 + 0.15, g: g * 0.6, flt: { type: 'lowpass', f: 1800, f2: 700 } });
    },
    sig(T, t, f, dur, g, echo) { // the alien radio signal: pulsed, band-limited
      const n = Math.max(1, Math.round(dur / 0.11));
      for (let k = 0; k < n; k++) {
        T.E.tone(dests(T, echo), t + k * 0.11, { type: 'square', f, a: 0.004, h: 0.035, d: 0.05, g: g * (k === 0 ? 1 : 0.55), flt: { type: 'bandpass', f: f * 2, Q: 3 } });
      }
      T.E.tone(T.in, t, { f, a: 0.01, h: dur * 0.6, d: dur * 0.5, g: g * 0.5 });
    },
  };
  function padChord(T, t, freqs, dur, o) {
    const E = T.E, ctx = E.ctx;
    const a = Math.min(dv(o.a, dur * 0.4), dur * 0.5), r = dv(o.r, 2.4), cut = dv(o.cut, 1000);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(cut * 0.45, t); f.frequency.linearRampToValueAtTime(cut, t + a); f.frequency.linearRampToValueAtTime(cut * 0.6, t + dur + r);
    const env = ctx.createGain();
    const g = dv(o.g, 0.03);
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + a); env.gain.setValueAtTime(g, t + dur);
    env.gain.setTargetAtTime(0, t + dur, r / 5);
    f.connect(env); env.connect(T.in);
    const stopAt = t + dur + r + 0.05;
    let first = null;
    for (const fr of freqs) {
      for (const det of [-dv(o.det, 7), dv(o.det, 7)]) {
        const osc = ctx.createOscillator(); osc.type = o.type || 'sawtooth';
        osc.frequency.value = fr; osc.detune.value = det + rr(-2, 2);
        osc.connect(f); osc.start(t); osc.stop(stopAt);
        if (!first) first = osc;
      }
    }
    first.onended = () => { try { env.disconnect(); } catch (e) { /* */ } };
  }
  function choirChord(T, t, freqs, dur, o) {
    const E = T.E, ctx = E.ctx;
    const a = Math.min(dur * 0.45, 2.5), r = 2.5, g = dv(o.g, 0.05);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + a); env.gain.setValueAtTime(g, t + dur);
    env.gain.setTargetAtTime(0, t + dur, r / 5);
    env.connect(T.in);
    const pre = ctx.createGain(); pre.gain.value = 1;
    const vowel = pick([[650, 1080], [400, 800], [550, 950]]);
    for (const fm of vowel) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fm; bp.Q.value = 5; pre.connect(bp); bp.connect(env); }
    const stopAt = t + dur + r + 0.05;
    let first = null;
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = rr(4.2, 5.6); lg.gain.value = 7;
    l.connect(lg); l.start(t); l.stop(stopAt);
    for (const fr of freqs) {
      for (const det of [-9, 9]) {
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = fr; osc.detune.value = det + rr(-3, 3);
        lg.connect(osc.detune);
        osc.connect(pre); osc.start(t); osc.stop(stopAt);
        if (!first) first = osc;
      }
    }
    first.onended = () => { try { env.disconnect(); pre.disconnect(); } catch (e) { /* */ } };
  }
  function bassNote(T, t, f, dur, g) {
    T.E.tone(T.in, t, { f, a: 0.012, h: dur * 0.5, d: dur * 0.6, g });
    T.E.tone(T.in, t, { type: 'triangle', f: f * 2, a: 0.012, h: dur * 0.3, d: dur * 0.5, g: g * 0.3, flt: { type: 'lowpass', f: 500 } });
  }
  const PERCI = {
    kick(T, t, g) { T.E.tone(T.in, t, { f: 115, f2: 42, gl: 0.11, a: 0.002, d: 0.32, g }); T.E.noise(T.in, t, { c: 'p', d: 0.02, g: g * 0.25, flt: { type: 'lowpass', f: 1500 } }); },
    tom(T, t, g, f) { T.E.tone(T.in, t, { f: f || 85, f2: (f || 85) * 0.7, gl: 0.3, a: 0.003, d: 0.55, g }); T.E.noise(T.in, t, { c: 'p', d: 0.06, g: g * 0.35, flt: { type: 'lowpass', f: 700 } }); },
    hat(T, t, g) { T.E.noise(T.in, t, { c: 'w', a: 0.001, d: 0.045, g, flt: { type: 'highpass', f: 7000 } }); },
    shaker(T, t, g) { T.E.noise(T.in, t, { c: 'w', a: 0.012, d: 0.06, g, flt: { type: 'bandpass', f: 6500, Q: 1.2 } }); },
    rim(T, t, g) { T.E.noise(T.in, t, { c: 'w', d: 0.025, g, flt: { type: 'bandpass', f: 1900, Q: 5 } }); },
  };
  const PERC = {
    ship(T, pos, bar, t) {
      if (pos === 0 || pos === 4) PERCI.kick(T, t, 0.11);
      if (pos % 2 === 1) PERCI.hat(T, t, 0.012);
      if (pos === 6 && bar % 2 === 1) PERCI.rim(T, t, 0.035);
    },
    tower(T, pos, bar, t) {
      if (pos === 0) { PERCI.kick(T, t, 0.16); PERCI.tom(T, t, 0.11, 70); }
      if (pos === 3) PERCI.tom(T, t, 0.1, 82);
      if (pos === 6) PERCI.tom(T, t, 0.09, 66);
      if (pos === 7 && bar % 2 === 1) PERCI.tom(T, t, 0.07, 104);
      PERCI.hat(T, t, pos === 2 || pos === 6 ? 0.016 : 0.008);
    },
    soft(T, pos, bar, t) {
      if (pos === 0 || pos === 4) PERCI.kick(T, t, 0.07);
      PERCI.shaker(T, t, pos % 2 ? 0.014 : 0.008);
    },
  };
  const EVENTS = {
    creak(T, t) { T.E.tone(T.in, t, { type: 'sawtooth', f: rr(48, 75), f2: rr(38, 60), a: rr(0.2, 0.5), h: 0.3, d: 0.7, g: 0.022, vib: { r: rr(5, 9), c: 35 }, flt: { type: 'bandpass', f: rr(400, 900), Q: 4 }, pan: rr(-0.7, 0.7) }); },
    drip(T, t) {
      const f = rr(900, 1700), p = rr(-0.8, 0.8);
      T.E.tone([T.in, T.echo], t, { f, f2: f * 1.7, gl: 0.035, a: 0.001, d: 0.07, g: 0.035, pan: p });
      if (rnd() < 0.4) T.E.tone(T.in, t + rr(0.25, 0.5), { f: f * 0.9, f2: f * 1.5, gl: 0.03, a: 0.001, d: 0.06, g: 0.018, pan: -p });
    },
    thunder(T, t) {
      T.E.noise(T.in, t, { c: 'b', a: rr(0.05, 0.3), h: rr(0.3, 0.8), d: rr(2.5, 4), g: rr(0.18, 0.3), flt: { type: 'lowpass', f: 380, f2: 90, gl: 3 }, pan: rr(-0.5, 0.5) });
      T.E.noise(T.in, t, { c: 'p', a: 0.01, d: 0.5, g: 0.05, flt: { type: 'lowpass', f: 1600, f2: 300 } });
    },
    alarmDistant(T, t) {
      for (let k = 0; k < 4; k++) T.E.tone(T.in, t + k * 0.42, { type: 'triangle', f: k % 2 ? 494 : 587, a: 0.04, h: 0.25, d: 0.12, g: 0.012, flt: { type: 'lowpass', f: 900 }, pan: 0.4 });
    },
    shimmer(T, t) { INST.glass(T, t, T.n(pick([0, 2, 4, 6]), 2), 1, 0.015, true); },
  };

  // persistent layers
  function startDrone(T, o, t0) {
    const E = T.E, ctx = E.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.cut; f.Q.value = 1.2;
    const env = ctx.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(o.g, t0 + 4);
    f.connect(env); env.connect(T.in);
    const notes = [[0, o.type || 'triangle', 1], [0, 'sine', 0.7, -1]];
    if (o.fifth) notes.push([4, o.type || 'triangle', 0.45]);
    for (const [deg, type, lvl, oo] of notes) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type; osc.frequency.value = T.n(deg, dv(o.oct, -1) + (oo || 0)); osc.detune.value = rr(-4, 4);
      g.gain.value = lvl; osc.connect(g); g.connect(f); osc.start(t0); T.persist.push(osc);
    }
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = rr(0.03, 0.06); lg.gain.value = o.cut * 0.45;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start(t0); T.persist.push(lfo);
  }
  function startBed(T, o, t0) {
    const E = T.E, ctx = E.ctx, k = o.kind;
    const env = ctx.createGain(); env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(o.g, t0 + 3);
    const gust = ctx.createGain(); gust.gain.value = 1;
    gust.connect(env); env.connect(T.in);
    const src = ctx.createBufferSource(); src.loop = true;
    src.buffer = E.nb[k === 'hiss' ? 'w' : k === 'cave' || k === 'hum' ? 'b' : 'p'];
    const f = ctx.createBiquadFilter();
    if (k === 'wind' || k === 'storm') {
      f.type = 'bandpass'; f.frequency.value = dv(o.f, 500); f.Q.value = k === 'storm' ? 0.7 : 1.1;
      T.gust = gust; T.gustT = 1;
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = k === 'storm' ? 0.11 : 0.05; lg.gain.value = dv(o.f, 500) * 0.5;
      l.connect(lg); lg.connect(f.frequency); l.start(t0); T.persist.push(l);
    } else if (k === 'hiss') { f.type = 'bandpass'; f.frequency.value = dv(o.f, 2500); f.Q.value = 0.6; }
    else if (k === 'cave') { f.type = 'lowpass'; f.frequency.value = 160; }
    else { f.type = 'lowpass'; f.frequency.value = 260; } // hum
    src.connect(f); f.connect(gust);
    src.start(t0, rnd() * 1.5); T.persist.push(src);
    if (k === 'hum') {
      for (const [fr, lv, ty] of [[50, 0.5, 'sawtooth'], [100, 0.25, 'sine'], [150.5, 0.08, 'sine']]) {
        const osc = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        osc.type = ty; osc.frequency.value = fr; lp.type = 'lowpass'; lp.frequency.value = 220; g.gain.value = lv;
        osc.connect(lp); lp.connect(g); g.connect(gust); osc.start(t0); T.persist.push(osc);
      }
    }
    if (k === 'storm') { // low roar under the gusts
      const s2 = ctx.createBufferSource(); s2.buffer = E.nb.b; s2.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
      const g = ctx.createGain(); g.gain.value = 0.8;
      s2.connect(lp); lp.connect(g); g.connect(gust); s2.start(t0, rnd()); T.persist.push(s2);
    }
  }

  // ─────────────────────────────── tracks ───────────────────────────────
  // pad.voicing / bass.pat / arp notes are scale degrees relative to the current chord root.
  const TRACKS = {
    menu: { root: 50, mode: 'aeolian', bpm: 64, space: 'space',
      drone: { g: 0.07, cut: 420, fifth: true }, bed: { kind: 'hiss', g: 0.01, f: 3000 },
      pad: { prog: [0, 5, 3, 4], bars: 2, g: 0.032, cut: 1100, voicing: [0, 2, 4, 7], oct: 0 },
      motif: { inst: 'bell', every: 8, start: 2, oct: 1, g: 0.06, vars: ['full', 'answer', 'aug', 'full'], echo: true },
      arp: { inst: 'glass', p: 0.1, oct: 2, g: 0.018, set: 'chord', echo: true } },
    intro: { root: 45, mode: 'aeolian', bpm: 60, space: 'space',
      drone: { g: 0.09, cut: 300 }, bed: { kind: 'hiss', g: 0.018, f: 2000 },
      pad: { prog: [0, 0, 5, 5], bars: 4, g: 0.022, cut: 700, type: 'triangle', voicing: [0, 4, 7], oct: 0, from: 4 },
      motif: { inst: 'sig', every: 2, start: 1, oct: 1, g: 0.035, vars: ['full', 'full', 'frag', 'full', 'answer'], echo: true },
      ev: [{ k: 'shimmer', p: 0.2 }] },
    ship: { root: 48, mode: 'phrygian', bpm: 100, space: 'metal',
      drone: { g: 0.05, cut: 260, type: 'sawtooth' }, bed: { kind: 'hum', g: 0.045 },
      pad: { prog: [0, 1, 0, 6], bars: 2, g: 0.022, cut: 650, voicing: [0, 2, 4], oct: 0 },
      bass: { pat: [0, null, 0, 0, null, 0, 7, null], g: 0.09, oct: -1, len: 0.8 },
      perc: 'ship',
      motif: { inst: 'lead', every: 8, start: 4, oct: 0, g: 0.03, vars: ['frag', 'answer'] },
      ev: [{ k: 'creak', p: 0.25 }, { k: 'alarmDistant', p: 0.12 }] },
    wreck: { root: 45, mode: 'aeolian', bpm: 56, space: 'hull',
      drone: { g: 0.07, cut: 350, fifth: true }, bed: { kind: 'wind', g: 0.022, f: 350 },
      pad: { prog: [0, 3, 5, 4], bars: 2, g: 0.028, cut: 800, voicing: [0, 2, 4], oct: 0 },
      motif: { inst: 'pluck', every: 8, start: 2, oct: 1, g: 0.07, vars: ['frag', 'full', 'answer'], broken: 0.2, echo: true },
      arp: { inst: 'pluck', p: 0.08, oct: 0, g: 0.035, set: 'chord' },
      ev: [{ k: 'creak', p: 0.35 }] },
    desert: { root: 50, mode: 'dorian', bpm: 70, space: 'open',
      drone: { g: 0.065, cut: 500, fifth: true }, bed: { kind: 'wind', g: 0.04, f: 600 },
      pad: { prog: [0, 3, 0, 6], bars: 2, g: 0.032, cut: 1400, type: 'triangle', voicing: [0, 4, 7], oct: 0 },
      motif: { inst: 'flute', every: 8, start: 4, oct: 1, g: 0.045, vars: ['full', 'aug', 'answer'] },
      arp: { inst: 'pluck', p: [0.35, 0, 0.15, 0.1, 0.3, 0, 0.15, 0.1], oct: 1, g: 0.04, set: 'penta', echo: true } },
    canyon: { root: 52, mode: 'dorian', bpm: 64, space: 'canyon',
      drone: { g: 0.075, cut: 380, fifth: true, type: 'sawtooth' }, bed: { kind: 'wind', g: 0.055, f: 450 },
      pad: { prog: [0, 6, 3, 0], bars: 4, g: 0.028, cut: 900, voicing: [0, 4, 7], oct: 0 },
      motif: { inst: 'flute', every: 4, start: 2, oct: 1, g: 0.05, vars: ['full', 'frag', 'answer', 'frag'], echo: true },
      arp: { inst: 'pluck', p: 0.06, oct: -1, g: 0.05, set: 'penta' } },
    ruins: { root: 45, mode: 'phrygian', bpm: 58, space: 'hall',
      drone: { g: 0.065, cut: 320, fifth: true }, bed: { kind: 'cave', g: 0.03 },
      pad: { prog: [0, 1, 6, 0], bars: 2, g: 0.05, choir: true, voicing: [0, 2, 4], oct: 0 },
      motif: { inst: 'bell', every: 8, start: 2, oct: 0, g: 0.06, vars: ['aug', 'answer', 'full'], echo: true },
      arp: { inst: 'bell', p: 0.05, oct: 1, g: 0.018, set: 'chord' } },
    caves: { root: 41, mode: 'aeolian', bpm: 52, space: 'cave',
      drone: { g: 0.085, cut: 260, oct: 0 }, bed: { kind: 'cave', g: 0.05 },
      pad: { prog: [0, 5, 0, 3], bars: 4, g: 0.024, cut: 600, type: 'triangle', voicing: [0, 2, 4], oct: 0 },
      motif: { inst: 'bell', every: 8, start: 3, oct: 2, g: 0.035, vars: ['frag', 'frag', 'full'], echo: true },
      ev: [{ k: 'drip', p: 0.9 }, { k: 'drip', p: 0.6 }, { k: 'drip', p: 0.3 }] },
    crystal: { root: 52, mode: 'lydian', bpm: 72, space: 'crystal',
      drone: { g: 0.055, cut: 500, fifth: true }, bed: { kind: 'hiss', g: 0.012, f: 6000 },
      pad: { prog: [0, 1, 4, 0], bars: 2, g: 0.03, cut: 2200, type: 'triangle', voicing: [0, 2, 4, 6], oct: 0 },
      motif: { inst: 'bell', every: 8, start: 2, oct: 1, g: 0.06, vars: ['full', 'answer', 'inv', 'full'], echo: true },
      arp: { inst: 'glass', p: [0.6, 0.2, 0.4, 0.2, 0.5, 0.2, 0.4, 0.3], oct: 2, g: 0.02, set: 'chord', echo: true },
      ev: [{ k: 'shimmer', p: 0.4 }] },
    tower: { root: 50, mode: 'aeolian', bpm: 88, space: 'storm',
      drone: { g: 0.065, cut: 300, fifth: true, type: 'sawtooth' }, bed: { kind: 'storm', g: 0.07, f: 700 },
      pad: { prog: [0, 5, 6, 4], bars: 2, g: 0.032, cut: 1000, voicing: [0, 2, 4], oct: 0 },
      bass: { pat: [0, null, 0, 7, null, 0, null, 0], g: 0.11, oct: -1, len: 0.9 },
      perc: 'tower',
      motif: { inst: 'lead', every: 4, start: 4, oct: 0, g: 0.04, vars: ['full', 'answer', 'full', 'aug'] },
      ev: [{ k: 'thunder', p: 0.18 }] },
    ending: { root: 50, mode: 'lydian', bpm: 60, space: 'space',
      drone: { g: 0.075, cut: 450, fifth: true }, bed: { kind: 'hiss', g: 0.01 },
      pad: { prog: [0, 4, 5, 1], bars: 2, g: 0.042, cut: 1600, voicing: [0, 2, 4, 7], oct: 0 },
      motif: { inst: 'bell', every: 4, start: 1, oct: 1, g: 0.07, vars: ['full', 'aug', 'resolve', 'answer'], echo: true, dbl: 'flute' } },
    credits: { root: 50, mode: 'mixolydian', bpm: 76, space: 'space',
      drone: { g: 0.045, cut: 400, fifth: true },
      pad: { prog: [0, 6, 3, 0], bars: 2, g: 0.032, cut: 1300, voicing: [0, 2, 4], oct: 0 },
      bass: { pat: [0, null, null, 0, null, null, 4, null], g: 0.09, oct: -1, len: 1.5 },
      perc: 'soft',
      motif: { inst: 'pluck', every: 4, start: 2, oct: 1, g: 0.065, vars: ['full', 'answer', 'resolve', 'inv'], echo: true },
      arp: { inst: 'bell', p: 0.1, oct: 2, g: 0.016, set: 'chord' } },
    ambient: { root: 45, mode: 'aeolian', bpm: 60, space: 'open',
      drone: { g: 0.07, cut: 380, fifth: true }, bed: { kind: 'hiss', g: 0.01 },
      pad: { prog: [0, 5], bars: 4, g: 0.028, cut: 900, voicing: [0, 2, 4], oct: 0 },
      motif: { inst: 'bell', every: 16, start: 4, oct: 1, g: 0.04, vars: ['frag', 'full'], echo: true } },
  };

  function makeTrack(E, def, id, now, fade) {
    const ctx = E.ctx;
    const T = { E, def, id, i: 0, spb: 60 / def.bpm / 2, next: now + 0.08, stopAt: null, persist: [], chord: def.pad ? def.pad.prog[0] : 0, mc: 0, quietUntil: -1 };
    T.n = (deg, oct) => mtof(def.root + degSemi(MODES[def.mode], deg) + 12 * (oct || 0));
    T.in = E.gain(0.68); // music trim: keeps the bed ~4 dB under gameplay SFX
    T.out = E.gain(0); T.in.connect(T.out); T.out.connect(E.music);
    T.revS = E.gain(1); T.out.connect(T.revS); T.revS.connect(E.musSend);
    T.echo = E.gain(0.5); T.echoF = E.gain(0); T.echo.connect(T.echoF); T.echoF.connect(E.dlyMus);
    for (const g of [T.out.gain, T.echoF.gain]) { g.setValueAtTime(0, now); g.linearRampToValueAtTime(1, now + Math.max(0.05, fade)); }
    if (def.drone) startDrone(T, def.drone, now);
    if (def.bed) startBed(T, def.bed, now);
    return T;
  }

  function stepTrack(T, i, t) {
    const d = T.def, pos = i % 8, bar = (i / 8) | 0, barLen = T.spb * 8;
    if (d.pad && pos === 0 && bar % d.pad.bars === 0) {
      const idx = (bar / d.pad.bars) % d.pad.prog.length;
      T.chord = d.pad.prog[idx];
      if (bar >= (d.pad.from || 0)) {
        const freqs = (d.pad.voicing || [0, 2, 4]).map((v) => T.n(T.chord + v, d.pad.oct || 0));
        if (d.pad.choir) choirChord(T, t, freqs, barLen * d.pad.bars, d.pad);
        else padChord(T, t, freqs, barLen * d.pad.bars, d.pad);
      }
    }
    if (d.bass) {
      const s = d.bass.pat[pos];
      if (s != null) bassNote(T, t, T.n(T.chord + s, dv(d.bass.oct, -2)), T.spb * dv(d.bass.len, 1), d.bass.g * (pos === 0 ? 1 : 0.75));
    }
    const m = d.motif;
    if (m && pos === 0 && bar >= m.start && (bar - m.start) % m.every === 0) {
      const variant = m.vars[T.mc++ % m.vars.length];
      const mv = motifVariant(variant);
      let tt = t;
      for (let k = 0; k < mv.deg.length; k++) {
        const dur = mv.dur[k] * T.spb;
        if (!(m.broken && k > 0 && rnd() < m.broken)) {
          INST[m.inst](T, tt, T.n(mv.deg[k], m.oct), dur * 1.3, m.g * (k === mv.deg.length - 1 ? 1.1 : 1), m.echo);
          if (m.dbl) INST[m.dbl](T, tt, T.n(mv.deg[k], m.oct - 1), dur * 1.2, m.g * 0.45, false);
        }
        tt += dur;
      }
      T.quietUntil = tt;
    }
    if (d.arp && t >= T.quietUntil) {
      const p = Array.isArray(d.arp.p) ? d.arp.p[pos] : d.arp.p;
      if (rnd() < p) {
        const degs = d.arp.set === 'penta' ? [0, 2, 3, 4, 6, 7] : [0, 2, 4, 7];
        const deg = (d.arp.set === 'penta' ? 0 : T.chord) + pick(degs);
        INST[d.arp.inst](T, t, T.n(deg, d.arp.oct), T.spb * 2, d.arp.g * rr(0.6, 1), d.arp.echo);
      }
    }
    if (d.perc) PERC[d.perc](T, pos, bar, t);
    if (d.ev && pos === 0) for (const ev of d.ev) if (rnd() < ev.p) EVENTS[ev.k](T, t + rnd() * barLen);
  }

  // ─────────────────────────────── SFX ───────────────────────────────
  const RATE = { crumble: 0.05, land: 0.06, blip: 0.035, rotate: 0.03, toggle: 0.03, key: 0.03, uiMove: 0.03, laserOn: 0.08,
    crateland: 0.08, door: 0.1, plateDown: 0.05, plateUp: 0.05, jump: 0.04, walljump: 0.04, explosion: 0.15, rumble: 0.3, wind: 0.3, alarm: 0.5, dialogNext: 0.05 };
  // per-sound bus sends: rev (reverb), dly (echo), g (level trim)
  const META = {
    death: { rev: 0.45 }, respawn: { rev: 0.35, dly: 0.12 }, checkpoint: { rev: 0.35, dly: 0.25 }, solved: { rev: 0.35, dly: 0.3 },
    shard: { rev: 0.45, dly: 0.4 }, levelComplete: { rev: 0.4, dly: 0.3 }, pickup: { rev: 0.3, dly: 0.15 },
    repair: { rev: 0.35, dly: 0.15 }, alarm: { rev: 0.5 }, explosion: { rev: 0.5 }, rumble: { rev: 0.3, g: 0.7 }, wind: { rev: 0.3, g: 2.2 },
    droneWake: { rev: 0.3, dly: 0.1 }, door: { rev: 0.35 }, bridge: { rev: 0.3 }, jumppad: { rev: 0.25 }, laserOn: { rev: 0.25, g: 1.3 },
    ui: { rev: 0.05, g: 2.2 }, uiMove: { rev: 0.05, g: 2.8 }, uiSelect: { rev: 0.1, dly: 0.08, g: 1.2 }, pause: { rev: 0.1, g: 1.8 }, dialogNext: { rev: 0.05, g: 2.8 },
    key: { rev: 0.08, g: 1.6 }, rotate: { rev: 0.1, g: 1.7 }, toggle: { rev: 0.1, g: 2.2 }, jump: { rev: 0.12, g: 1.7 }, walljump: { rev: 0.12, g: 1.7 },
    land: { rev: 0.15, g: 1.3 }, blip: { rev: 0.1, g: 1.6 }, plateUp: { rev: 0.15, g: 2 }, plateDown: { rev: 0.15, g: 1.4 }, lever: { rev: 0.2, g: 1.4 },
    crumble: { rev: 0.2, g: 1.8 }, respawnCrate: { rev: 0.25, g: 1.6 }, objective: { rev: 0.3, dly: 0.2, g: 1.4 }, crateland: { rev: 0.2, g: 1.3 },
  };
  const bellP = (f, d, g, r) => ({ f, a: 0.002, d, g, fm: { r: r || 3, i: 1.0, d: d * 0.25, s: 0.05 } });

  const SFX = {
    jump(E, v) {
      const pv = vary(0.06);
      E.vt(v, { type: 'triangle', f: 190 * pv, f2: 430 * pv, gl: 0.09, a: 0.004, d: 0.12, g: 0.22, flt: { type: 'lowpass', f: 2400 } });
      E.vt(v, { f: 380 * pv, f2: 860 * pv, gl: 0.07, a: 0.003, d: 0.07, g: 0.06 });
      E.vn(v, { c: 'w', a: 0.01, d: 0.09, g: 0.07, flt: { type: 'bandpass', f: 1800 * pv, f2: 4200, Q: 1.2 } });
    },
    walljump(E, v) {
      const pv = vary(0.06), side = rnd() < 0.5 ? -0.25 : 0.25;
      E.vn(v, { c: 'p', a: 0.002, d: 0.05, g: 0.2, flt: { type: 'bandpass', f: 900 * pv, Q: 1.5 }, pan: side });
      E.vn(v, { c: 'w', a: 0.008, d: 0.12, g: 0.07, flt: { type: 'bandpass', f: 2500, f2: 5000, Q: 1.2 }, pan: side, pan2: -side });
      E.vt(v, { type: 'triangle', f: 230 * pv, f2: 580 * pv, gl: 0.1, a: 0.004, d: 0.14, g: 0.2, flt: { type: 'lowpass', f: 2600 } });
    },
    land(E, v, o) {
      const k = clamp(dv(o.volume, 0.6), 0, 1), pv = vary(0.07);
      E.vt(v, { f: (125 + 45 * (1 - k)) * pv, f2: 46, gl: 0.09 + 0.06 * k, a: 0.002, d: 0.11 + 0.1 * k, g: 0.38 });
      E.vn(v, { c: 'p', a: 0.002, d: 0.05 + 0.07 * k, g: 0.18 + 0.12 * k, flt: { type: 'lowpass', f: (600 + 1500 * k) * pv, f2: 220, Q: 0.7 } });
      if (k > 0.7) E.vn(v, { c: 'b', a: 0.004, d: 0.25, g: 0.3 * k, flt: { type: 'lowpass', f: 160 } });
    },
    death(E, v) {
      E.vt(v, { f: 75, f2: 34, gl: 0.25, a: 0.002, d: 0.3, g: 0.45 });
      E.vt(v, { f: 420, f2: 60, gl: 0.38, a: 0.003, d: 0.42, g: 0.22 });
      E.vt(v, { type: 'square', f: 210, f2: 42, gl: 0.3, a: 0.003, d: 0.3, g: 0.05, flt: { type: 'lowpass', f: 1300, f2: 200 } });
      E.vn(v, { c: 'p', a: 0.002, d: 0.35, g: 0.32, flt: { type: 'lowpass', f: 3200, f2: 160 } });
      for (let k = 0; k < 5; k++) E.vt(v, { t: 0.05 + k * 0.045, type: 'triangle', f: E.kn(4 - k, 1), a: 0.002, d: 0.08, g: 0.045, pan: (k - 2) * 0.2 });
    },
    respawn(E, v) {
      E.vn(v, { c: 'w', a: 0.25, d: 0.15, g: 0.06, flt: { type: 'bandpass', f: 500, f2: 5200, Q: 2, gl: 0.35 } });
      [0, 4, 7].forEach((d, k) => E.vt(v, Object.assign({ t: 0.08 + k * 0.07 }, bellP(E.kn(d, 0), 0.35, 0.08))));
      E.vt(v, { f: E.kn(0, -2), a: 0.2, d: 0.3, g: 0.12 });
    },
    checkpoint(E, v) {
      [0, 2, 4, 7].forEach((d, k) => E.vt(v, Object.assign({ t: k * 0.07 }, bellP(E.kn(d, 1), 0.9, 0.085))));
      E.vt(v, { type: 'triangle', f: E.kn(0, 0), a: 0.05, h: 0.2, d: 0.8, g: 0.05 });
      E.vt(v, { type: 'triangle', f: E.kn(4, 0), a: 0.05, h: 0.2, d: 0.8, g: 0.04 });
      E.vn(v, { c: 'w', a: 0.1, d: 0.4, g: 0.02, flt: { type: 'highpass', f: 6000 } });
    },
    lever(E, v) {
      E.vn(v, { c: 'w', a: 0.001, d: 0.02, g: 0.25, flt: { type: 'bandpass', f: 2600, Q: 2 } });
      E.vt(v, { f: 170, f2: 85, a: 0.002, d: 0.12, g: 0.32 });
      E.vn(v, { t: 0.07, c: 'w', a: 0.001, d: 0.03, g: 0.2, flt: { type: 'bandpass', f: 1800, Q: 3 } });
      E.vt(v, { t: 0.07, type: 'square', f: 90, f2: 60, a: 0.002, d: 0.07, g: 0.05, flt: { type: 'lowpass', f: 600 } });
    },
    door(E, v) {
      E.vn(v, { c: 'b', a: 0.05, h: 0.4, d: 0.2, g: 0.35, flt: { type: 'lowpass', f: 300, f2: 700, gl: 0.5 } });
      E.vt(v, { type: 'sawtooth', f: 52, f2: 70, gl: 0.5, a: 0.06, h: 0.35, d: 0.15, g: 0.08, flt: { type: 'lowpass', f: 380 } });
      E.vn(v, { c: 'w', a: 0.05, h: 0.35, d: 0.1, g: 0.015, flt: { type: 'bandpass', f: 3000, Q: 6 } });
      E.vt(v, { t: 0.55, f: 110, f2: 48, a: 0.002, d: 0.18, g: 0.32 });
      E.vn(v, { t: 0.55, c: 'p', a: 0.001, d: 0.06, g: 0.22, flt: { type: 'lowpass', f: 1300 } });
    },
    bridge(E, v) {
      E.vt(v, { type: 'sawtooth', f: 70, f2: 150, gl: 0.55, a: 0.05, h: 0.4, d: 0.15, g: 0.06, flt: { type: 'lowpass', f: 500, f2: 1200 } });
      for (let k = 0; k < 6; k++) E.vn(v, { t: k * 0.09, c: 'w', a: 0.001, d: 0.015, g: 0.11, flt: { type: 'bandpass', f: 3200, Q: 4 } });
      E.vt(v, { t: 0.6, type: 'triangle', f: 320, a: 0.002, d: 0.3, g: 0.08, fm: { r: 2.7, i: 0.5, d: 0.08 } });
      E.vt(v, { t: 0.6, f: 95, f2: 60, a: 0.002, d: 0.12, g: 0.2 });
    },
    plateDown(E, v) {
      E.vn(v, { c: 'p', a: 0.001, d: 0.04, g: 0.2, flt: { type: 'lowpass', f: 1500 } });
      E.vt(v, { f: 160, f2: 90, a: 0.002, d: 0.12, g: 0.3 });
      E.vt(v, { t: 0.03, type: 'triangle', f: E.kn(0, 0), a: 0.004, d: 0.2, g: 0.06 });
    },
    plateUp(E, v) {
      E.vn(v, { c: 'w', a: 0.001, d: 0.02, g: 0.1, flt: { type: 'bandpass', f: 2200, Q: 2 } });
      E.vt(v, { f: 140, f2: 210, a: 0.002, d: 0.08, g: 0.14 });
      E.vt(v, { t: 0.02, type: 'triangle', f: E.kn(4, -1), a: 0.004, d: 0.13, g: 0.04 });
    },
    terminalOpen(E, v) {
      [0, 2, 4].forEach((d, k) => E.vt(v, { t: k * 0.06, type: 'square', f: E.kn(d, 1), a: 0.002, d: k === 2 ? 0.14 : 0.05, g: 0.045, flt: { type: 'lowpass', f: 3000 } }));
      E.vn(v, { c: 'w', a: 0.08, d: 0.12, g: 0.05, flt: { type: 'bandpass', f: 800, f2: 4000, Q: 1.5 } });
      E.vt(v, { f: E.kn(0, -1), a: 0.1, h: 0.1, d: 0.3, g: 0.08 });
    },
    rotate(E, v) {
      const pv = vary(0.08);
      E.vn(v, { c: 'w', a: 0.001, d: 0.018, g: 0.22, flt: { type: 'bandpass', f: 3200 * pv, Q: 3 } });
      E.vt(v, { f: 900 * pv, f2: 1300 * pv, a: 0.002, d: 0.04, g: 0.06 });
      E.vt(v, { t: 0.025, f: 240 * pv, a: 0.002, d: 0.05, g: 0.12 });
    },
    toggle(E, v) {
      const pv = vary(0.07);
      E.vt(v, { type: 'square', f: 1400 * pv, a: 0.001, d: 0.012, g: 0.05, flt: { type: 'lowpass', f: 4000 } });
      E.vt(v, { f: 620 * pv, f2: 520 * pv, a: 0.002, d: 0.06, g: 0.12 });
      E.vn(v, { c: 'w', a: 0.001, d: 0.01, g: 0.07, flt: { type: 'bandpass', f: 5000, Q: 2 } });
    },
    key(E, v) {
      const f = E.kn(pick([0, 1, 2, 4, 5]), 1);
      E.vt(v, { type: 'triangle', f, a: 0.002, h: 0.03, d: 0.06, g: 0.1 });
      E.vt(v, { f: f * 2, a: 0.002, d: 0.04, g: 0.025 });
    },
    error(E, v) {
      E.vt(v, { type: 'square', f: 233, a: 0.003, h: 0.07, d: 0.05, g: 0.06, flt: { type: 'lowpass', f: 1400 } });
      E.vt(v, { t: 0.13, type: 'square', f: 185, a: 0.003, h: 0.1, d: 0.08, g: 0.06, flt: { type: 'lowpass', f: 1200 } });
      E.vt(v, { f: 116, a: 0.005, h: 0.2, d: 0.1, g: 0.1 });
    },
    solved(E, v) {
      [0, 2, 4, 7, 9].forEach((d, k) => E.vt(v, Object.assign({ t: k * 0.075, pan: (k - 2) * 0.15 }, bellP(E.kn(d, 1), 1.2, 0.08))));
      [0, 2, 4].forEach((d) => E.vt(v, { type: 'triangle', f: E.kn(d, 0), a: 0.15, h: 0.3, d: 1.0, g: 0.035 }));
      E.vt(v, { f: E.kn(0, -1), a: 0.05, h: 0.3, d: 0.8, g: 0.1 });
    },
    pickup(E, v) {
      E.vt(v, bellP(E.kn(4, 1), 0.5, 0.1));
      E.vt(v, Object.assign({ t: 0.08 }, bellP(E.kn(7, 1), 0.6, 0.1)));
      E.vn(v, { c: 'w', a: 0.01, d: 0.25, g: 0.03, flt: { type: 'highpass', f: 6000 } });
    },
    repair(E, v) {
      E.vt(v, { type: 'sawtooth', f: 80, f2: 420, gl: 0.45, a: 0.02, h: 0.3, d: 0.2, g: 0.07, flt: { type: 'lowpass', f: 300, f2: 3000, gl: 0.45 } });
      for (let k = 0; k < 4; k++) E.vn(v, { t: 0.05 + rnd() * 0.35, c: 'w', a: 0.001, d: 0.02, g: 0.13, flt: { type: 'highpass', f: 3000 }, pan: rr(-0.5, 0.5) });
      [0, 4, 7].forEach((d, k) => E.vt(v, Object.assign({ t: 0.45 + k * 0.03 }, bellP(E.kn(d, 1), 1.0, 0.07))));
      E.vt(v, { t: 0.45, f: E.kn(0, -1), a: 0.03, h: 0.2, d: 0.6, g: 0.1 });
    },
    crumble(E, v) {
      for (let k = 0; k < 6; k++) E.vn(v, { t: rnd() * 0.32, c: 'p', a: 0.002, d: 0.03 + rnd() * 0.06, g: 0.12 + rnd() * 0.12, flt: { type: 'bandpass', f: 300 + rnd() * 900, Q: 1.2 }, pan: rr(-0.3, 0.3) });
      E.vt(v, { f: 90, f2: 50, a: 0.002, d: 0.15, g: 0.16 });
      E.vn(v, { c: 'b', a: 0.02, d: 0.35, g: 0.16, flt: { type: 'lowpass', f: 400 } });
    },
    crateland(E, v) {
      const pv = vary(0.06);
      E.vt(v, { f: 120 * pv, f2: 55, a: 0.002, d: 0.14, g: 0.32 });
      E.vn(v, { c: 'p', a: 0.001, d: 0.08, g: 0.2, flt: { type: 'bandpass', f: 450 * pv, Q: 1 } });
      E.vt(v, { type: 'triangle', f: 330 * pv, a: 0.002, d: 0.22, g: 0.04, fm: { r: 2.4, i: 0.4, d: 0.06 } });
    },
    respawnCrate(E, v) {
      E.vn(v, { c: 'w', a: 0.2, d: 0.1, g: 0.05, flt: { type: 'bandpass', f: 400, f2: 3000, Q: 2, gl: 0.3 } });
      E.vt(v, { f: E.kn(0, -1), f2: E.kn(0, 0), gl: 0.25, a: 0.05, d: 0.2, g: 0.07 });
      E.vt(v, Object.assign({ t: 0.25 }, bellP(E.kn(4, 0), 0.3, 0.05)));
    },
    jumppad(E, v) {
      E.vt(v, { f: 90, f2: 52, a: 0.002, d: 0.15, g: 0.35 });
      E.vt(v, { type: 'triangle', f: 180, f2: 720, gl: 0.2, a: 0.005, d: 0.3, g: 0.13, vib: { r: 18, c: 60 } });
      E.vn(v, { c: 'w', a: 0.01, d: 0.25, g: 0.08, flt: { type: 'bandpass', f: 600, f2: 3500, gl: 0.25, Q: 1.2 } });
      E.vt(v, Object.assign({ t: 0.12 }, bellP(E.kn(4, 1), 0.3, 0.04)));
    },
    laserOn(E, v) {
      E.vt(v, { type: 'sawtooth', f: 1800, f2: 180, gl: 0.08, a: 0.001, d: 0.1, g: 0.08, flt: { type: 'bandpass', f: 1500, Q: 1 } });
      E.vt(v, { type: 'square', f: 110, a: 0.005, h: 0.12, d: 0.1, g: 0.05, vib: { r: 30, c: 40 }, flt: { type: 'lowpass', f: 900 } });
      E.vn(v, { c: 'w', a: 0.001, d: 0.08, g: 0.1, flt: { type: 'highpass', f: 4000 } });
      for (let k = 0; k < 3; k++) E.vn(v, { t: 0.02 + rnd() * 0.15, c: 'w', a: 0.001, d: 0.012, g: 0.08, flt: { type: 'bandpass', f: rr(2500, 6000), Q: 3 } });
    },
    shard(E, v) {
      [4, 7, 9, 11, 14].forEach((d, k) => E.vt(v, Object.assign({ t: k * 0.06, pan: (k - 2) * 0.2 }, bellP(E.kn(d, 1), 1.4, 0.06, 3.5))));
      E.vn(v, { c: 'w', a: 0.05, d: 0.6, g: 0.025, flt: { type: 'highpass', f: 7000 } });
      E.vt(v, { f: E.kn(0, 0), a: 0.1, h: 0.2, d: 1.0, g: 0.05 });
      E.vt(v, { f: E.kn(4, 0), a: 0.1, h: 0.2, d: 1.0, g: 0.035 });
    },
    levelComplete(E, v) {
      // the signal motif, resolved upward — the "you made it" statement of the leitmotif
      const mv = motifVariant('resolve');
      let t = 0.1;
      for (let k = 0; k < mv.deg.length; k++) {
        E.vt(v, Object.assign({ t }, bellP(E.kn(mv.deg[k], 1), k === mv.deg.length - 1 ? 2.2 : 0.9, 0.075)));
        t += mv.dur[k] * 0.13;
      }
      [0, 2, 4, 7].forEach((d) => E.vt(v, { type: 'triangle', f: E.kn(d, -1), a: 0.35, h: 0.9, d: 1.6, g: 0.035, flt: { type: 'lowpass', f: 1800 } }));
      E.vt(v, { f: E.kn(0, -2), a: 0.3, h: 1.0, d: 1.5, g: 0.12 });
      E.vn(v, { t: t, c: 'w', a: 0.2, d: 1.2, g: 0.025, flt: { type: 'highpass', f: 6500 } });
    },
    objective(E, v) {
      E.vt(v, bellP(E.kn(4, 1), 0.5, 0.065));
      E.vt(v, Object.assign({ t: 0.12 }, bellP(E.kn(7, 1), 0.7, 0.065)));
    },
    dialogNext(E, v) {
      E.vt(v, { f: 1500, f2: 1300, a: 0.002, d: 0.03, g: 0.05 });
      E.vn(v, { c: 'w', a: 0.001, d: 0.01, g: 0.035, flt: { type: 'bandpass', f: 4000, Q: 2 } });
    },
    blip(E, v, o) {
      const who = o.who;
      if (who === 'orion') {
        const f = E.kn(pick([0, 0, 4]), -1) * vary(0.01);
        E.vt(v, { f, a: 0.006, h: 0.03, d: 0.05, g: 0.14 });
        E.vt(v, { f: f * 2, a: 0.006, h: 0.02, d: 0.04, g: 0.025 });
      } else if (who === 'lum') {
        const f = rr(1100, 1700);
        E.vt(v, { f, f2: f * 1.35, gl: 0.03, a: 0.002, d: 0.045, g: 0.16 });
      } else if (who === 'voice') {
        v.rev.gain.value = 0.7;
        const f = E.kn(pick([0, 1, 3]), 0) * vary(0.03);
        E.vt(v, { f: f * 1.012, a: 0.02, h: 0.04, d: 0.12, g: 0.07, vib: { r: 6, c: 25 } });
        E.vt(v, { f: f * 0.988, a: 0.02, h: 0.04, d: 0.12, g: 0.07, vib: { r: 4.3, c: 20 } });
        E.vt(v, { type: 'triangle', f: f * 1.5 * 1.03, a: 0.03, h: 0.02, d: 0.1, g: 0.015 });
      } else if (who === 'mira') {
        const f = E.kn(pick([0, 2, 4, 5]), 0) * vary(0.04);
        E.vt(v, { type: 'triangle', f, a: 0.004, h: 0.02, d: 0.05, g: 0.09, flt: { type: 'lowpass', f: 1800 } });
      } else {
        const f = E.kn(pick([0, 2, 4]), 0) * vary(0.04);
        E.vt(v, { f, a: 0.004, h: 0.02, d: 0.05, g: 0.08 });
      }
    },
    ui(E, v) {
      E.vt(v, { f: 800, a: 0.002, d: 0.035, g: 0.1 });
      E.vn(v, { c: 'w', a: 0.001, d: 0.008, g: 0.05, flt: { type: 'bandpass', f: 3000, Q: 2 } });
    },
    uiMove(E, v) {
      const pv = vary(0.04);
      E.vt(v, { f: 1250 * pv, f2: 1050 * pv, a: 0.002, d: 0.03, g: 0.06 });
    },
    uiSelect(E, v) {
      E.vt(v, { type: 'triangle', f: E.kn(4, 1), a: 0.002, d: 0.1, g: 0.09 });
      E.vt(v, { t: 0.06, type: 'triangle', f: E.kn(7, 1), a: 0.002, h: 0.03, d: 0.2, g: 0.09 });
    },
    pause(E, v) {
      E.vt(v, { f: 620, f2: 310, gl: 0.18, a: 0.003, d: 0.22, g: 0.12, flt: { type: 'lowpass', f: 2000, f2: 500 } });
      E.vn(v, { c: 'p', a: 0.005, d: 0.2, g: 0.06, flt: { type: 'lowpass', f: 800, f2: 200 } });
    },
    droneWake(E, v) {
      E.vt(v, { type: 'sawtooth', f: 55, f2: 220, gl: 0.5, a: 0.05, h: 0.3, d: 0.2, g: 0.06, flt: { type: 'lowpass', f: 200, f2: 1800, gl: 0.5 } });
      for (let k = 0; k < 3; k++) { const f = 900 + k * 350; E.vt(v, { t: 0.5 + k * 0.09, f, f2: f * 1.3, gl: 0.04, a: 0.002, d: 0.06, g: 0.07 }); }
      E.vt(v, Object.assign({ t: 0.8 }, bellP(E.kn(0, 1), 0.5, 0.05)));
    },
    rumble(E, v) {
      E.vn(v, { c: 'b', a: 0.4, h: 1.2, d: 1.2, g: 0.5, flt: { type: 'lowpass', f: 140 } });
      E.vt(v, { f: 38, a: 0.3, h: 1.2, d: 1.0, g: 0.25, vib: { r: 3, c: 40 } });
      for (let k = 0; k < 4; k++) E.vn(v, { t: rnd() * 2, c: 'p', a: 0.003, d: 0.05, g: 0.06, flt: { type: 'bandpass', f: rr(300, 700), Q: 1.5 }, pan: rr(-0.6, 0.6) });
    },
    alarm(E, v) {
      for (let k = 0; k < 6; k++) {
        const f = k % 2 ? 520 : 660;
        E.vt(v, { t: k * 0.3, type: 'sawtooth', f, a: 0.02, h: 0.22, d: 0.06, g: 0.06, flt: { type: 'lowpass', f: 1800 } });
        E.vt(v, { t: k * 0.3, f: f / 2, a: 0.02, h: 0.22, d: 0.06, g: 0.05 });
      }
    },
    explosion(E, v) {
      E.vn(v, { c: 'w', a: 0.002, d: 1.2, g: 0.45, flt: { type: 'lowpass', f: 4000, f2: 120, gl: 0.8 } });
      E.vt(v, { f: 90, f2: 28, gl: 0.6, a: 0.002, d: 0.9, g: 0.5 });
      E.vn(v, { c: 'b', a: 0.01, h: 0.3, d: 2.0, g: 0.4, flt: { type: 'lowpass', f: 220 } });
      for (let k = 0; k < 6; k++) E.vn(v, { t: 0.1 + rnd() * 1.1, c: 'w', a: 0.001, d: 0.02, g: 0.05, flt: { type: 'highpass', f: 2500 }, pan: rr(-0.7, 0.7) });
    },
    wind(E, v) {
      const p = rr(-0.7, -0.3);
      E.vn(v, { c: 'p', a: 0.8, h: 1.2, d: 1.4, g: 0.28, flt: { type: 'bandpass', f: 300, f2: 900, gl: 1.6, Q: 1.5 }, pan: p, pan2: -p });
      E.vn(v, { c: 'w', a: 0.8, h: 1.0, d: 1.0, g: 0.04, flt: { type: 'bandpass', f: 1600, f2: 2100, Q: 12 }, pan: -p, pan2: p });
    },
  };

  // ─────────────────────────────── live implementation ───────────────────────────────
  let E = null, failed = false, timer = null, wantMusic;
  function tick() {
    if (!E || E.ctx.state !== 'running') return;
    const hidden = root.document && root.document.hidden;
    E.schedule(E.ctx.currentTime + (hidden ? 1.2 : 0.12));
  }
  function ensure() {
    if (E || failed) return E;
    if (!AC) { failed = true; return null; }
    try {
      const ctx = new AC({ latencyHint: 'interactive' });
      E = createEngine(ctx, false);
      timer = setInterval(() => { try { tick(); } catch (e) { /* */ } }, 25);
    } catch (e) { failed = true; E = null; }
    return E;
  }

  G.Audio.impl = {
    play(name, opts) {
      if (!E || E.ctx.state !== 'running') return;
      try { E.play(name, opts); } catch (e) { /* never throw into gameplay */ }
    },
    music(id) {
      wantMusic = id == null ? null : id;
      if (!E) return;
      try { E.setMusic(wantMusic); tick(); } catch (e) { /* */ }
    },
    setVolume(kind, v) {
      if (!E) return;
      try { E.setVolume(kind, v); } catch (e) { /* */ }
    },
    unlock() {
      if (E && E.ctx.state === 'running') return;
      const e = ensure();
      if (!e) return;
      try {
        const ctx = e.ctx;
        if (ctx.state !== 'running' && ctx.resume) {
          const p = ctx.resume();
          if (p && p.then) p.then(() => { tick(); }, () => {});
        }
        // iOS: a silent buffer started inside the gesture unlocks output
        const b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); b.connect(ctx.destination); b.start(0);
        const v = G.Audio.volumes || {};
        for (const k of ['master', 'music', 'sfx']) if (v[k] != null) e.setVolume(k, v[k]);
        if (wantMusic !== undefined) e.setMusic(wantMusic);
      } catch (err) { /* */ }
    },
    update(dt) {
      if (!E || E.ctx.state !== 'running') return;
      try { E.modulate(dt || 0); tick(); } catch (e) { /* */ }
    },
  };

  // ─────────────────────────────── QA / offline render hooks ───────────────────────────────
  function stats(buf) {
    let peak = 0, sum = 0, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const x = d[i], a = x < 0 ? -x : x; if (a > peak) peak = a; sum += x * x; }
      n += d.length;
    }
    return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / n).toFixed(5) };
  }
  G.Audio.synth = {
    sfxNames: Object.keys(SFX),
    musicIds: Object.keys(TRACKS).filter((k) => k !== 'ambient'),
    signal: SIGNAL,
    /** Live engine state (null until unlocked). */
    state() { return E ? { ctx: E.ctx.state, voices: E.voices.length, tracks: E.tracks.map((t) => t.id), music: E.musicId, space: E.space } : null; },
    /**
     * Render with an OfflineAudioContext through the full mix chain.
     * kind 'sfx' | 'music'; opts for sfx (e.g. {volume}, {who}); key = music id to set the SFX key/space.
     * Resolves {peak, rms} of the rendered buffer.
     */
    renderOffline(kind, id, seconds, opts, key) {
      if (!OAC) return Promise.resolve(null);
      const sr = 44100, dur = seconds || 1;
      const ctx = new OAC(2, Math.floor(sr * dur), sr);
      const e = createEngine(ctx, true);
      if (kind === 'music') { e.setMusic(id, 2); e.schedule(dur); }
      else {
        const def = TRACKS[key || 'desert'];
        e.key = { root: def.root, scale: MODES[def.mode] }; e.setSpace(def.space);
        e.play(id, Object.assign({ at: 0.02 }, opts || {}));
      }
      return ctx.startRendering().then(stats);
    },
  };
})();
