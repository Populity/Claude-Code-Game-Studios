/**
 * TESSERA: shared biome palettes and colour helpers (owned by environment art).
 *
 * Every biome palette has the same shape so the decor renderer can stay data-driven:
 *   sky        [[stop, colour], ...]  vertical sky / back-wall gradient (top -> bottom)
 *   haze       colour that far layers fade toward (atmospheric perspective)
 *   far/mid/near  silhouette base colours for the parallax layers
 *   light      key-light colour used for light shafts
 *   accent / accent2  emissive colours (strip lights, glyphs, bioluminescence)
 *   rock       solid tile material  { base, dark, deep, light, rim, line, cap, capLight, capDark, detail }
 *   plat       one-way platform     { top, body, dark, accent }
 *   spike      spikes               { base, light, dark, tip, glow }
 *   acid       deadly liquid        { top, body, deep, glow, bubble }
 *   crumble    crumbling block      { base, light, dark, crack }
 *   grade      colour grade overlay { top, bottom } (rgba strings), vignette (0..1)
 *   dust / debris  particle colours (G.Art.Decor.dustColor / debrisColor)
 *   motes      ambient particle descriptors used by the atmosphere pass
 *
 * Variants (level.def.variant) are looked up as `<biome>_<variant>` and fall back to the base biome.
 */
(function () {
  const P = (G.Art.Palette = G.Art.Palette || {});

  // ------------------------------------------------------------------ colour helpers
  const cache = new Map();

  /**
   * Parse '#rgb' / '#rrggbb' into [r, g, b] (0..255). Results are memoised.
   * @param {string} hex
   * @returns {number[]}
   */
  P.rgbOf = (hex) => {
    let v = cache.get(hex);
    if (v) return v;
    let h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cache.set(hex, v);
    return v;
  };

  /** Build '#rrggbb' from 0..255 channels (clamped). */
  P.hex = (r, g, b) => {
    const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  };

  /**
   * Mix two hex colours.
   * @param {string} a
   * @param {string} b
   * @param {number} t 0 = a, 1 = b
   * @returns {string} '#rrggbb'
   */
  P.mix = (a, b, t) => {
    const A = P.rgbOf(a), B = P.rgbOf(b);
    return P.hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
  };

  /** Lighten (k > 0, toward white) or darken (k < 0, toward black) a hex colour. */
  P.shade = (c, k) => (k >= 0 ? P.mix(c, '#ffffff', k) : P.mix(c, '#000000', -k));

  /** Hex colour with alpha -> 'rgba(r,g,b,a)'. */
  P.alpha = (c, a) => {
    const v = P.rgbOf(c);
    return `rgba(${v[0]},${v[1]},${v[2]},${a})`;
  };

  // ------------------------------------------------------------------ biome palettes
  P.biomes = {
    ship: {
      sky: [[0, '#04060b'], [0.5, '#0a0f17'], [1, '#121a25']],
      haze: '#1b2b3c', far: '#161f2b', mid: '#0f151e', near: '#07090e',
      light: '#7fe9ff', accent: '#38e8ff', accent2: '#ff3044',
      rock: { base: '#2b323d', dark: '#1b2028', deep: '#0f1218', light: '#4c5868', rim: '#9fb4c8', line: '#07090d',
        cap: '#5d6979', capLight: '#c3d0dc', capDark: '#323a46', detail: '#f2b33a' },
      plat: { top: '#8e9aaa', body: '#454e5b', dark: '#1d2229', accent: '#38e8ff' },
      spike: { base: '#3b424c', light: '#d6dee8', dark: '#161a20', tip: '#ff5060', glow: '#ff2a3a' },
      acid: { top: '#b8ffd0', body: '#3ae08a', deep: '#0b4a32', glow: '#3cff9a', bubble: '#d8ffe8' },
      crumble: { base: '#3a3f47', light: '#6a7380', dark: '#1a1d22', crack: '#0a0b0e' },
      grade: { top: 'rgba(40,90,140,0.10)', bottom: 'rgba(10,20,40,0.22)' }, vignette: 0.55,
      dust: 'rgba(150,180,205,0.75)', debris: '#5c6676',
      motes: [{ kind: 'mote', n: 46, color: '#9fdcff', size: 1.6, vx: 4, vy: -3, depth: 0.7, alpha: 0.45, glow: true }],
    },
    wreck: {
      sky: [[0, '#ffe2a8'], [0.45, '#f4b56e'], [0.8, '#d27a46'], [1, '#9a4a2c']],
      haze: '#e7a46a', far: '#a8603c', mid: '#3a2a26', near: '#1a1312',
      light: '#ffd9a0', accent: '#40d8ff', accent2: '#ff9a3a',
      rock: { base: '#4b403a', dark: '#2e2622', deep: '#1a1513', light: '#7b6757', rim: '#d9b384', line: '#0f0b0a',
        cap: '#e2b071', capLight: '#f8dba4', capDark: '#b07a44', detail: '#c06a3a' },
      plat: { top: '#a89a88', body: '#5a4c42', dark: '#241c18', accent: '#ffb14a' },
      spike: { base: '#4a3e36', light: '#e8d2b8', dark: '#1c1512', tip: '#ff5a3a', glow: '#ff4a20' },
      acid: { top: '#e4ff9a', body: '#8ad62a', deep: '#2a4a0e', glow: '#a8ff3a', bubble: '#f0ffc8' },
      crumble: { base: '#6a5444', light: '#a88a6a', dark: '#2a1e18', crack: '#120c08' },
      grade: { top: 'rgba(255,200,120,0.10)', bottom: 'rgba(80,30,10,0.22)' }, vignette: 0.5,
      dust: 'rgba(232,190,130,0.8)', debris: '#8a6a4a',
      motes: [{ kind: 'mote', n: 50, color: '#ffd9a0', size: 1.5, vx: 14, vy: 2, depth: 0.8, alpha: 0.55, glow: true },
        { kind: 'spark', n: 6, color: '#ffcf6a', size: 1.6, vx: 30, vy: 60, depth: 1, alpha: 0.9, glow: true }],
    },
    desert: {
      sky: [[0, '#1c1340'], [0.28, '#4a2458'], [0.52, '#a8465e'], [0.72, '#ec8256'], [0.88, '#ffbd78'], [1, '#ffdca0']],
      haze: '#e9906c', far: '#a04c5c', mid: '#7c3a42', near: '#3a1b24',
      light: '#ffcf8a', accent: '#ffc46a', accent2: '#7ef9ff',
      rock: { base: '#b0663e', dark: '#87482d', deep: '#5a2c1f', light: '#d8925a', rim: '#ffd59e', line: '#3a160e',
        cap: '#f0b46a', capLight: '#ffe2ac', capDark: '#c4824a', detail: '#e7a868' },
      plat: { top: '#f2c588', body: '#a7653d', dark: '#4e2618', accent: '#ffcf8a' },
      spike: { base: '#6e3a2a', light: '#ffe0c0', dark: '#2a120c', tip: '#ff4a3a', glow: '#ff5a2a' },
      acid: { top: '#fff0a0', body: '#ff9a20', deep: '#8a2a0c', glow: '#ffa030', bubble: '#fff4c0' },
      crumble: { base: '#c7814e', light: '#efb67a', dark: '#6a361e', crack: '#2a120a' },
      grade: { top: 'rgba(120,60,160,0.10)', bottom: 'rgba(255,140,60,0.10)' }, vignette: 0.45,
      dust: 'rgba(240,196,140,0.85)', debris: '#c88a54',
      motes: [{ kind: 'sand', n: 70, color: '#ffd9a0', size: 1.2, vx: 220, vy: 18, depth: 1.0, alpha: 0.5, glow: false },
        { kind: 'mote', n: 24, color: '#ffe8c0', size: 1.4, vx: 40, vy: -4, depth: 0.6, alpha: 0.4, glow: true }],
    },
    canyon: {
      sky: [[0, '#ffe6b8'], [0.3, '#f6ad74'], [0.62, '#c25c40'], [1, '#5a1e1a']],
      haze: '#d8805e', far: '#b0563e', mid: '#7c3024', near: '#3a1410',
      light: '#ffd6a0', accent: '#ffb46a', accent2: '#7ef9ff',
      rock: { base: '#8f3b28', dark: '#64271c', deep: '#3c1611', light: '#bb5a3a', rim: '#ffb184', line: '#260c08',
        cap: '#c9754a', capLight: '#efaa76', capDark: '#94482e', detail: '#d98a5a' },
      plat: { top: '#e19a6a', body: '#8a3e28', dark: '#3a140e', accent: '#ffcf8a' },
      spike: { base: '#5a2418', light: '#ffd0b0', dark: '#220a06', tip: '#ff4a3a', glow: '#ff5a2a' },
      acid: { top: '#fff0a0', body: '#ff8a1a', deep: '#7a200a', glow: '#ff9a2a', bubble: '#fff4c0' },
      crumble: { base: '#a8553a', light: '#d4875e', dark: '#4a1a10', crack: '#1e0806' },
      grade: { top: 'rgba(255,190,120,0.10)', bottom: 'rgba(90,20,20,0.24)' }, vignette: 0.55,
      dust: 'rgba(220,140,100,0.85)', debris: '#a4543a',
      motes: [{ kind: 'streak', n: 14, color: '#ffe0c0', size: 1, vx: 380, vy: 10, depth: 1.0, alpha: 0.22, glow: false },
        { kind: 'mote', n: 40, color: '#ffd0a0', size: 1.3, vx: 60, vy: 4, depth: 0.85, alpha: 0.45, glow: true }],
    },
    ruins: {
      sky: [[0, '#081820'], [0.35, '#143038'], [0.65, '#2c5654'], [0.85, '#5f8670'], [1, '#a6b48a']],
      haze: '#5a8274', far: '#3a5c58', mid: '#22383a', near: '#0e1a1c',
      light: '#d8ffd8', accent: '#5ef0ff', accent2: '#a8ff8a',
      rock: { base: '#4b5a48', dark: '#33402f', deep: '#1d251d', light: '#71836a', rim: '#bfd0a6', line: '#0d130e',
        cap: '#5d8c3c', capLight: '#a4d460', capDark: '#36561f', detail: '#5ef0ff' },
      plat: { top: '#93a486', body: '#4f6050', dark: '#1d261d', accent: '#5ef0ff' },
      spike: { base: '#5a5038', light: '#f0e0b0', dark: '#1e1a10', tip: '#ff5040', glow: '#ff4a3a' },
      acid: { top: '#d0ffb0', body: '#5ad84a', deep: '#0e4220', glow: '#7aff6a', bubble: '#e8ffd8' },
      crumble: { base: '#62705a', light: '#93a284', dark: '#262e22', crack: '#0c100a' },
      grade: { top: 'rgba(120,220,220,0.07)', bottom: 'rgba(10,40,40,0.22)' }, vignette: 0.5,
      dust: 'rgba(190,205,170,0.8)', debris: '#6f7e62',
      motes: [{ kind: 'mote', n: 44, color: '#d8ffe0', size: 1.4, vx: 10, vy: -6, depth: 0.7, alpha: 0.45, glow: true }],
    },
    ruins_overgrown: {
      sky: [[0, '#03100f'], [0.35, '#082624'], [0.7, '#164234'], [1, '#3c6a48']],
      haze: '#2c5a46', far: '#1f4438', mid: '#12291f', near: '#06110c',
      light: '#c8ffd0', accent: '#5ef0ff', accent2: '#ff7ad0',
      rock: { base: '#41513e', dark: '#2b3829', deep: '#172016', light: '#647a58', rim: '#b4d49a', line: '#0a100a',
        cap: '#4a8a30', capLight: '#9ae05a', capDark: '#2a5418', detail: '#5ef0ff' },
      plat: { top: '#7f9a72', body: '#3f5640', dark: '#16201a', accent: '#8affc0' },
      spike: { base: '#4e4a30', light: '#e8e0a8', dark: '#1a180c', tip: '#ff5040', glow: '#ff4a3a' },
      acid: { top: '#d0ffb0', body: '#4ad870', deep: '#0a3a20', glow: '#6aff8a', bubble: '#e8ffd8' },
      crumble: { base: '#58684e', light: '#88a07a', dark: '#222c1e', crack: '#0a0e08' },
      grade: { top: 'rgba(80,220,160,0.08)', bottom: 'rgba(0,30,20,0.28)' }, vignette: 0.6,
      dust: 'rgba(170,210,160,0.8)', debris: '#5f7452',
      motes: [{ kind: 'spore', n: 40, color: '#9affc8', size: 2.2, vx: 6, vy: -10, depth: 0.8, alpha: 0.7, glow: true },
        { kind: 'spore', n: 12, color: '#ff8ad8', size: 2, vx: -4, vy: -8, depth: 0.9, alpha: 0.6, glow: true }],
    },
    // Chapter 2, l11: the endless Architect archive. Cold teal light, polished dark stone,
    // ЭХО's gold (#ffd27a) as the only warm accent.
    ruins_archive: {
      sky: [[0, '#01070a'], [0.35, '#041319'], [0.7, '#0a272d'], [1, '#164046']],
      haze: '#1a4a50', far: '#0f3238', mid: '#0a2228', near: '#03090c',
      light: '#b8fff6', accent: '#5ef0ff', accent2: '#ffd27a',
      rock: { base: '#38464c', dark: '#253237', deep: '#10191d', light: '#5a6d76', rim: '#a8e4ec', line: '#050b0d',
        cap: '#4c6a72', capLight: '#c8f4ff', capDark: '#22363c', detail: '#5ef0ff' },
      plat: { top: '#8aa4ac', body: '#3c4e56', dark: '#141e22', accent: '#5ef0ff' },
      spike: { base: '#4c4632', light: '#f4e4b0', dark: '#1a170c', tip: '#ff5040', glow: '#ff4a3a' },
      acid: { top: '#d0fff8', body: '#3ad8d0', deep: '#0a3a40', glow: '#5af0ff', bubble: '#e0fffc' },
      crumble: { base: '#48585e', light: '#7a909a', dark: '#1c262a', crack: '#080c0e' },
      grade: { top: 'rgba(90,220,240,0.08)', bottom: 'rgba(0,25,35,0.30)' }, vignette: 0.62,
      dust: 'rgba(170,215,220,0.75)', debris: '#5a6c72',
      motes: [{ kind: 'glyph', n: 22, color: '#7ef9ff', size: 5, vx: 3, vy: -9, depth: 0.75, alpha: 0.75, glow: true },
        { kind: 'mote', n: 34, color: '#c8fff8', size: 1.3, vx: 2, vy: -4, depth: 0.55, alpha: 0.4, glow: true }],
    },
    caves: {
      sky: [[0, '#040607'], [0.5, '#081012'], [1, '#0c1a1a']],
      haze: '#122828', far: '#0f1e1e', mid: '#091314', near: '#030607',
      light: '#9affd8', accent: '#4affc0', accent2: '#a8ff4a',
      rock: { base: '#3d454c', dark: '#272d32', deep: '#121518', light: '#66737e', rim: '#a8c8cc', line: '#040506',
        cap: '#2f6e5c', capLight: '#6af0c0', capDark: '#1a3a32', detail: '#4affc0' },
      plat: { top: '#6a7a7c', body: '#343c40', dark: '#121618', accent: '#4affc0' },
      spike: { base: '#3a4044', light: '#d0e0e0', dark: '#101214', tip: '#ff5a4a', glow: '#ff3a3a' },
      acid: { top: '#eaffa0', body: '#86e82a', deep: '#1a4a0a', glow: '#9aff3a', bubble: '#f4ffd0' },
      crumble: { base: '#3e454a', light: '#6a767e', dark: '#16191c', crack: '#050607' },
      grade: { top: 'rgba(40,120,110,0.08)', bottom: 'rgba(40,120,20,0.12)' }, vignette: 0.7,
      dust: 'rgba(140,165,165,0.75)', debris: '#4b555d',
      motes: [{ kind: 'spore', n: 34, color: '#7affc8', size: 1.8, vx: 3, vy: -7, depth: 0.75, alpha: 0.6, glow: true },
        { kind: 'mote', n: 24, color: '#c8ff8a', size: 1.3, vx: -2, vy: -4, depth: 0.5, alpha: 0.35, glow: true }],
    },
    crystal: {
      sky: [[0, '#07041a'], [0.5, '#130a30'], [1, '#22124a']],
      haze: '#3a2470', far: '#2a1a56', mid: '#180e36', near: '#08051a',
      light: '#d8c0ff', accent: '#5ef0e0', accent2: '#c070ff',
      rock: { base: '#3c3056', dark: '#271d3e', deep: '#120c20', light: '#5e4c84', rim: '#cbb0ff', line: '#07040e',
        cap: '#4fd8d0', capLight: '#c8fff8', capDark: '#2a7a88', detail: '#b070ff' },
      plat: { top: '#b8fff4', body: '#3aa8b0', dark: '#16324a', accent: '#c8fff8' },
      spike: { base: '#5a3a8a', light: '#f0e0ff', dark: '#1a0e30', tip: '#ff5aa0', glow: '#ff4a8a' },
      acid: { top: '#f4d0ff', body: '#b050ff', deep: '#3a0c6a', glow: '#c070ff', bubble: '#fae8ff' },
      crumble: { base: '#463466', light: '#7a62a4', dark: '#1a1030', crack: '#08040e' },
      grade: { top: 'rgba(120,80,255,0.10)', bottom: 'rgba(20,10,60,0.25)' }, vignette: 0.6,
      dust: 'rgba(200,180,255,0.8)', debris: '#6a5a9a',
      motes: [{ kind: 'glint', n: 30, color: '#e8fcff', size: 2.4, vx: 0, vy: -3, depth: 0.7, alpha: 0.9, glow: true },
        { kind: 'mote', n: 30, color: '#c8a8ff', size: 1.4, vx: 4, vy: -5, depth: 0.6, alpha: 0.45, glow: true }],
    },
    tower: {
      sky: [[0, '#04060d'], [0.4, '#0b1122'], [0.75, '#161e36'], [1, '#232c48']],
      haze: '#2c3654', far: '#1a2136', mid: '#10141f', near: '#06080d',
      light: '#b8d0ff', accent: '#6ad8ff', accent2: '#ffb04a',
      rock: { base: '#2d3139', dark: '#1d2026', deep: '#101216', light: '#4b525e', rim: '#a8bcd4', line: '#06070a',
        cap: '#596170', capLight: '#cad8ea', capDark: '#30363f', detail: '#6ad8ff' },
      plat: { top: '#a4b0c0', body: '#48505c', dark: '#1a1e24', accent: '#6ad8ff' },
      spike: { base: '#3c424c', light: '#e0e8f4', dark: '#14161a', tip: '#ff5060', glow: '#ff3a4a' },
      acid: { top: '#e0e8ff', body: '#6a80ff', deep: '#1a1a6a', glow: '#7a9aff', bubble: '#f0f4ff' },
      crumble: { base: '#3c414a', light: '#6c7480', dark: '#16181c', crack: '#060708' },
      grade: { top: 'rgba(60,90,160,0.12)', bottom: 'rgba(10,15,40,0.28)' }, vignette: 0.6,
      dust: 'rgba(170,185,210,0.75)', debris: '#4c5462',
      motes: [{ kind: 'rain', n: 130, color: '#b8ccf0', size: 1, vx: -160, vy: 900, depth: 1.0, alpha: 0.32, glow: false }],
    },
    // Chapter 2, l13: the Spire's heart. Indoors (no storm): deep violet structure lit by an
    // amber core; rising embers instead of rain.
    tower_core: {
      sky: [[0, '#05020a'], [0.4, '#110822'], [0.75, '#24102e'], [1, '#341826']],
      haze: '#3a1e4a', far: '#231436', mid: '#150b22', near: '#06030a',
      light: '#ffcf8a', accent: '#ffb04a', accent2: '#b77aff',
      rock: { base: '#2c2636', dark: '#1d1925', deep: '#0e0b14', light: '#4a4256', rim: '#d4b0e8', line: '#050309',
        cap: '#5a4c64', capLight: '#ffdcae', capDark: '#2e2638', detail: '#ffb04a' },
      plat: { top: '#a898b4', body: '#4a4058', dark: '#1a1522', accent: '#ffb04a' },
      spike: { base: '#3e3448', light: '#f0e0f4', dark: '#140f1a', tip: '#ff5060', glow: '#ff3a4a' },
      acid: { top: '#ffe8c0', body: '#ff9a3a', deep: '#5a1a2a', glow: '#ffb04a', bubble: '#fff0d8' },
      crumble: { base: '#3e3648', light: '#6e6280', dark: '#17121c', crack: '#060408' },
      grade: { top: 'rgba(150,90,255,0.10)', bottom: 'rgba(60,20,10,0.30)' }, vignette: 0.62,
      dust: 'rgba(200,170,210,0.75)', debris: '#4e4458',
      motes: [{ kind: 'mote', n: 40, color: '#ffc070', size: 1.6, vx: 6, vy: -22, depth: 0.85, alpha: 0.55, glow: true },
        { kind: 'mote', n: 18, color: '#c89aff', size: 1.3, vx: -3, vy: -10, depth: 0.55, alpha: 0.4, glow: true }],
    },
  };

  /**
   * Palette for a level (honours level.def.variant, falls back to desert).
   * @param {G.Level|{biome:string, def?:object}} level
   * @returns {object} palette
   */
  P.get = (level) => {
    const biome = (level && level.biome) || 'desert';
    const variant = level && level.def && level.def.variant;
    return (variant && P.biomes[biome + '_' + variant]) || P.biomes[biome] || P.biomes.desert;
  };

  /**
   * Dynamic-lighting ambience per biome / variant (used by G.Art.Lighting).
   *   amb    multiply colour of unlit space ('#ffffff' = no darkening)
   *   lamp   strength of Mira's shoulder lamp (0..1), glow additive bloom scale,
   *   shadow true when the biome is dark enough for cast shadows to read.
   * Values are art-direction knobs: tune here, never in lighting.js.
   */
  P.lighting = {
    ship:            { amb: '#5a6682', lamp: 1.0, glow: 1.0, shadow: true },
    wreck:           { amb: '#a49488', lamp: 0.55, glow: 0.7, shadow: true },
    desert:          { amb: '#f6eee6', lamp: 0.15, glow: 0.35, shadow: false },
    canyon:          { amb: '#e2ccbe', lamp: 0.25, glow: 0.45, shadow: false },
    ruins:           { amb: '#8c9e98', lamp: 0.55, glow: 0.7, shadow: true },
    ruins_overgrown: { amb: '#6a827c', lamp: 0.8, glow: 0.9, shadow: true },
    ruins_archive:   { amb: '#566e78', lamp: 0.95, glow: 1.0, shadow: true },
    caves:           { amb: '#56686e', lamp: 1.0, glow: 1.0, shadow: true },
    crystal:         { amb: '#7a6a94', lamp: 0.8, glow: 1.0, shadow: true },
    tower:           { amb: '#646c8a', lamp: 0.9, glow: 0.9, shadow: true, storm: true },
    tower_core:      { amb: '#5e4a68', lamp: 0.9, glow: 1.0, shadow: true },
  };
  /** Lighting ambience for a level (variant first, then biome, then neutral). */
  P.lightingFor = (level) => {
    const biome = (level && level.biome) || 'desert';
    const variant = level && level.def && level.def.variant;
    return (variant && P.lighting[biome + '_' + variant]) || P.lighting[biome] || P.lighting.desert;
  };
})();
