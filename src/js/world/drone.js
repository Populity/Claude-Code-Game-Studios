/**
 * ЛЮМ — the companion drone. Purely presentational + narrative: follows the
 * player, looks at nearby interactables, glows. Can start "broken" and wake
 * when a level entity becomes active (level.def.drone = {broken:true, x, y, wakeOn:'id'}).
 *
 * Art reads: x, y (centre, px), vx, vy, facing, state ('follow'|'broken'|'waking'|'scan'),
 * stateTime, lookX, lookY (world point it looks at), mood ('neutral'|'happy'|'alert'|'sad').
 */
(function () {
  const T = G.TILE;
  class Drone {
    constructor(level, player) {
      const cfg = level.def.drone;
      this.enabled = cfg !== false && cfg !== undefined;
      this.x = player.cx - 30; this.y = player.y - 20;
      this.vx = 0; this.vy = 0;
      this.facing = 1;
      this.state = 'follow';
      this.stateTime = 0;
      this.mood = 'neutral';
      this.lookX = this.x + 10; this.lookY = this.y;
      this.t = Math.random() * 10;
      if (cfg && typeof cfg === 'object' && cfg.broken) {
        this.state = 'broken';
        this.x = cfg.x * T + T / 2; this.y = (cfg.y + 1) * T - 8;
        this.wakeOn = cfg.wakeOn;
      }
    }
    setState(s) { if (this.state !== s) { this.state = s; this.stateTime = 0; } }
    update(dt, game) {
      if (!this.enabled) return;
      this.t += dt; this.stateTime += dt;
      const p = game.player;
      if (this.state === 'broken') {
        const src = this.wakeOn && game.level.byId[this.wakeOn];
        if (src && src.active) { this.setState('waking'); G.Audio.play('droneWake'); }
        return;
      }
      if (this.state === 'waking') {
        this.vy = -40; this.y += this.vy * dt;
        if (this.stateTime > 1.2) this.setState('follow');
        return;
      }
      if (this.state === 'controlled' || this.state === 'down') return; // driven by G.Party (party.js)
      // target: behind and above the player
      const tx = p.cx - p.facing * 34;
      const ty = p.y - 18 + Math.sin(this.t * 2.2) * 5;
      const k = 7;
      this.vx += ((tx - this.x) * k - this.vx * 3.2) * dt * 3;
      this.vy += ((ty - this.y) * k - this.vy * 3.2) * dt * 3;
      this.x += this.vx * dt; this.y += this.vy * dt;
      // look at nearest interactable or the player
      let look = { x: p.cx + p.facing * 60, y: p.cy };
      let best = 160 * 160;
      for (const e of game.level.entities) {
        if (!e.interactable || (e.canInteract && !e.canInteract(game))) continue;
        const dx = e.cx - this.x, dy = e.cy - this.y, d = dx * dx + dy * dy;
        if (d < best) { best = d; look = { x: e.cx, y: e.cy }; }
      }
      this.lookX = G.lerp(this.lookX, look.x, G.damp(6, dt));
      this.lookY = G.lerp(this.lookY, look.y, G.damp(6, dt));
      this.facing = this.lookX >= this.x ? 1 : -1;
      if (p.dead) this.mood = 'sad';
      else if (best < 160 * 160) this.mood = 'alert';
      else if (this.mood !== 'happy' || this.stateTime > 2) this.mood = 'neutral';
    }
    cheer() { this.mood = 'happy'; this.stateTime = 0; }
  }
  G.Drone = Drone;
})();
