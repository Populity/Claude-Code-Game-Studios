/**
 * Audio facade. The full procedural sound design lives in src/js/core/audio-synth.js
 * (owned by the audio agent) which replaces G.Audio.impl. This file guarantees
 * the API exists so gameplay code can always call it safely.
 *
 * API:
 *   G.Audio.play(name, {volume})   one-shot SFX by name (see SFX list in docs/level-format.md)
 *   G.Audio.music(trackId)         crossfade to a music track ('menu','ship','desert',...), null = stop
 *   G.Audio.setVolume(kind, v)     kind: 'master'|'music'|'sfx', v in [0,1]
 *   G.Audio.unlock()               call on first user gesture (browsers block audio until then)
 */
(function () {
  const Audio = {
    impl: null,
    volumes: { master: 0.8, music: 0.6, sfx: 0.8 },
    play(name, opts) { try { if (this.impl) this.impl.play(name, opts || {}); } catch (e) { console.warn('sfx', name, e); } },
    music(id) { try { if (this.impl) this.impl.music(id); } catch (e) { console.warn('music', id, e); } },
    setVolume(kind, v) { this.volumes[kind] = v; try { if (this.impl && this.impl.setVolume) this.impl.setVolume(kind, v); } catch (e) { /* */ } },
    unlock() { try { if (this.impl && this.impl.unlock) this.impl.unlock(); } catch (e) { /* */ } },
    update(dt) { try { if (this.impl && this.impl.update) this.impl.update(dt); } catch (e) { /* */ } },
  };
  G.Audio = Audio;
})();
