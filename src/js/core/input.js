/**
 * Input: keyboard, gamepad and on-screen touch buttons, unified into actions.
 *
 * Actions: left right up down jump action dash pause restart confirm back
 * Query with G.input.down(a) (held), G.input.pressed(a) (this frame), G.input.released(a).
 * Pointer (mouse / tap) in VIEW coordinates: G.input.pointer {x, y, down, clicked}.
 */
(function () {
  const KEYMAP = {
    ArrowLeft: ['left'], KeyA: ['left'],
    ArrowRight: ['right'], KeyD: ['right'],
    ArrowUp: ['up', 'jump'], KeyW: ['up', 'jump'],
    ArrowDown: ['down'], KeyS: ['down'],
    Space: ['jump', 'confirm'], KeyZ: ['jump'], KeyK: ['jump'],
    KeyE: ['action'], KeyF: ['action'], KeyX: ['action'], KeyJ: ['action'],
    Enter: ['confirm', 'action'],
    Escape: ['pause', 'back'], KeyP: ['pause'],
    KeyR: ['restart'],
    ShiftLeft: ['dash'], ShiftRight: ['dash'], KeyC: ['dash'], KeyL: ['dash'],
    Backspace: ['back'],
  };

  const held = {};       // action -> count of sources holding it
  const prev = {};
  const cur = {};
  const keyHeld = {};
  const tapped = {};     // actions pressed since the last update(): a press+release within one frame still counts
  const touchHeld = {};
  let padHeld = {};

  const input = {
    pointer: { x: 0, y: 0, down: false, clicked: false, moved: false },
    /** Printable characters typed this frame (for code entry). */
    typed: '',
    touchActive: false,
    lastDevice: 'keyboard',
    /** Screen→view transform, set by the renderer every frame. */
    view: { scale: 1, ox: 0, oy: 0 },
    /** Touch button rects in VIEW coords, set by HUD: [{action, x, y, r}] */
    touchButtons: [],

    down(a) { return !!cur[a]; },
    pressed(a) { return !!cur[a] && !prev[a]; },
    released(a) { return !cur[a] && !!prev[a]; },
    anyPressed() {
      for (const a in cur) if (cur[a] && !prev[a]) return true;
      return false;
    },
    /** Call once per frame BEFORE game logic. */
    update() {
      for (const a in cur) prev[a] = cur[a];
      pollGamepad();
      const all = new Set([
        ...Object.keys(keyHeld), ...Object.keys(touchHeld), ...Object.keys(padHeld), ...Object.keys(prev),
      ]);
      for (const a in tapped) all.add(a);
      for (const a of all) cur[a] = !!(keyHeld[a] || touchHeld[a] || padHeld[a] || tapped[a]);
      for (const a in tapped) delete tapped[a];
      this.typed = typedBuf; typedBuf = '';
    },
    /** Call once per frame AFTER game logic. */
    endFrame() { this.pointer.clicked = false; this.pointer.moved = false; },
    /** Clear all held state (on blur / scene change). */
    reset() {
      for (const k in keyHeld) delete keyHeld[k];
      for (const k in tapped) delete tapped[k];
      for (const k in touchHeld) delete touchHeld[k];
      padHeld = {};
      for (const k in cur) { cur[k] = false; prev[k] = false; }
    },
  };
  G.input = input;

  function toView(clientX, clientY) {
    const v = input.view;
    const dpr = window.devicePixelRatio || 1;
    return { x: (clientX * dpr - v.ox) / v.scale, y: (clientY * dpr - v.oy) / v.scale };
  }

  let typedBuf = '';
  window.addEventListener('keydown', (e) => {
    if (e.key && e.key.length === 1) typedBuf += e.key;
    const acts = KEYMAP[e.code];
    if (!acts) return;
    e.preventDefault();
    input.lastDevice = 'keyboard';
    for (const a of acts) { if (!keyHeld[a] && !e.repeat) tapped[a] = true; keyHeld[a] = true; }
    if (G.Audio && G.Audio.unlock) G.Audio.unlock();
  });
  window.addEventListener('keyup', (e) => {
    const acts = KEYMAP[e.code];
    if (!acts) return;
    for (const a of acts) delete keyHeld[a];
  });
  window.addEventListener('blur', () => input.reset());

  // ---- Pointer (mouse + touch for UI and on-screen buttons) ----
  const activeTouches = new Map(); // id -> action|null

  function buttonAt(p) {
    for (const b of input.touchButtons) {
      const dx = p.x - b.x, dy = p.y - b.y;
      if (dx * dx + dy * dy <= b.r * b.r) return b.action;
    }
    return null;
  }
  function recomputeTouchHeld() {
    for (const k in touchHeld) delete touchHeld[k];
    for (const a of activeTouches.values()) if (a) touchHeld[a] = true;
  }

  window.addEventListener('pointerdown', (e) => {
    if (G.Audio && G.Audio.unlock) G.Audio.unlock();
    const p = toView(e.clientX, e.clientY);
    input.pointer.x = p.x; input.pointer.y = p.y;
    if (e.pointerType === 'touch') {
      input.touchActive = true;
      input.lastDevice = 'touch';
      const act = buttonAt(p);
      activeTouches.set(e.pointerId, act);
      recomputeTouchHeld();
      if (act) { tapped[act] = true; return; } // on-screen button, not a UI click
    } else {
      input.lastDevice = 'mouse';
    }
    input.pointer.down = true;
    input.pointer.clicked = true;
  });
  window.addEventListener('pointermove', (e) => {
    const p = toView(e.clientX, e.clientY);
    input.pointer.x = p.x; input.pointer.y = p.y; input.pointer.moved = true;
    if (e.pointerType === 'touch' && activeTouches.has(e.pointerId)) {
      // allow sliding a finger between buttons
      activeTouches.set(e.pointerId, buttonAt(p));
      recomputeTouchHeld();
    }
  });
  const end = (e) => {
    input.pointer.down = false;
    if (activeTouches.has(e.pointerId)) {
      activeTouches.delete(e.pointerId);
      recomputeTouchHeld();
    }
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  // Stop the browser / host app from treating game touches as scroll, zoom or swipe-back
  // (that turns them into pointercancel and the on-screen buttons "do nothing").
  const block = (e) => { if (e.cancelable) e.preventDefault(); };
  if (!window.PointerEvent) {
    // Legacy Touch Events path: mirror the pointer logic above.
    const tdown = (e) => {
      block(e);
      if (G.Audio && G.Audio.unlock) G.Audio.unlock();
      input.touchActive = true; input.lastDevice = 'touch';
      for (const t of e.changedTouches) {
        const p = toView(t.clientX, t.clientY);
        input.pointer.x = p.x; input.pointer.y = p.y;
        const act = buttonAt(p);
        activeTouches.set('t' + t.identifier, act);
        if (act) tapped[act] = true; else { input.pointer.down = true; input.pointer.clicked = true; }
      }
      recomputeTouchHeld();
    };
    const tmove = (e) => {
      block(e);
      for (const t of e.changedTouches) {
        const p = toView(t.clientX, t.clientY);
        input.pointer.x = p.x; input.pointer.y = p.y; input.pointer.moved = true;
        if (activeTouches.has('t' + t.identifier)) activeTouches.set('t' + t.identifier, buttonAt(p));
      }
      recomputeTouchHeld();
    };
    const tend = (e) => {
      block(e);
      for (const t of e.changedTouches) activeTouches.delete('t' + t.identifier);
      if (!e.touches.length) input.pointer.down = false;
      recomputeTouchHeld();
    };
    window.addEventListener('touchstart', tdown, { passive: false });
    window.addEventListener('touchmove', tmove, { passive: false });
    window.addEventListener('touchend', tend, { passive: false });
    window.addEventListener('touchcancel', tend, { passive: false });
  } else {
    window.addEventListener('touchstart', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
  }
  window.addEventListener('gesturestart', block, { passive: false }); // iOS pinch-zoom
  window.addEventListener('contextmenu', (e) => e.preventDefault());  // long-press menu

  // ---- Gamepad ----
  function pollGamepad() {
    padHeld = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (ax < -0.4 || b(14)) padHeld.left = true;
      if (ax > 0.4 || b(15)) padHeld.right = true;
      if (ay < -0.5 || b(12)) padHeld.up = true;
      if (ay > 0.5 || b(13)) padHeld.down = true;
      if (b(0)) { padHeld.jump = true; padHeld.confirm = true; }
      if (b(2) || b(1)) padHeld.action = true;
      if (b(1)) padHeld.back = true;
      if (b(5)) padHeld.dash = true;
      if (b(9)) padHeld.pause = true;
      if (b(3)) padHeld.restart = true;
      if (Object.keys(padHeld).length) input.lastDevice = 'gamepad';
    }
  }
})();
