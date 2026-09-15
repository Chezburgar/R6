// Keyboard/mouse input with pointer lock. Bindings mirror Siege's PC defaults where the browser
// allows it (Ctrl is deliberately unbound: Ctrl+W closes the tab and Ctrl+S/D/F open browser dialogs).
export const Bindings = {
  forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
  sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC'], prone: ['KeyZ'],
  leanL: ['KeyQ'], leanR: ['KeyE'], jump: ['Space'], interact: ['KeyF'],
  reload: ['KeyR'], melee: ['KeyV'], fireMode: ['KeyB'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'],
  gadget: ['KeyG'], scoreboard: ['Tab'],
  drone: ['Digit5', 'KeyX'],     // observation tool: operator → drone view
  droneExit: ['Digit5'],         // drone → operator (X is scan while droning)
  deployDrone: ['Digit6'],       // throw out a new drone
  scan: ['KeyX'],                // hold while droning: identify the enemy under the reticle
  ping: ['KeyZ', 'KeyM'],        // contextual ping (Z while droning, M as operator since Z is prone)
  pause: ['Escape'],
};

class InputClass {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();     // keys pressed this frame
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, pressed: 0, released: 0 };
    this.locked = false;
    this.enabled = false;
    this.wantLock = false;
    this._el = null;
    this.onLockChange = null;
    this.lastLockChange = 0;
  }

  attach(el) {
    this._el = el;
    window.addEventListener('keydown', e => {
      // keep the browser from acting on game keys: Tab (focus), F-keys, Alt (Chrome menu focus →
      // blur → pointer lock lost), Ctrl combos (find/save/bookmark dialogs)
      if (e.code === 'Tab' || e.code === 'AltLeft' || e.code === 'AltRight' || (e.code.startsWith('F') && e.code.length <= 3 && e.code !== 'F11')) e.preventDefault();
      if ((e.ctrlKey || e.metaKey) && this.locked && e.code !== 'KeyW' && e.code !== 'KeyT' && e.code !== 'KeyN') e.preventDefault();
      if (e.code === 'Space' && this.locked) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
    });
    window.addEventListener('keyup', e => { if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault(); this.keys.delete(e.code); this.released.add(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.buttons = 0; });
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      // Clamp absurd deltas produced by pointer-lock glitches on some browsers.
      const dx = Math.max(-200, Math.min(200, e.movementX)), dy = Math.max(-200, Math.min(200, e.movementY));
      this.mouse.dx += dx; this.mouse.dy += dy;
    });
    document.addEventListener('mousedown', e => {
      if (!this.locked) return;
      this.mouse.buttons |= (1 << e.button); this.mouse.pressed |= (1 << e.button);
      e.preventDefault();
    });
    document.addEventListener('mouseup', e => {
      this.mouse.buttons &= ~(1 << e.button); this.mouse.released |= (1 << e.button);
      if (this.locked && e.button >= 3) e.preventDefault();   // side buttons would navigate history
    });
    document.addEventListener('auxclick', e => { if (this.locked) e.preventDefault(); });
    document.addEventListener('wheel', e => { if (this.locked) this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('contextmenu', e => { if (this.locked) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      this.lastLockChange = performance.now();
      this.keys.clear(); this.mouse.buttons = 0;
      this.onLockChange && this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => { this.onLockError && this.onLockError(); });
    el.addEventListener('click', () => { if (this.wantLock && !this.locked) this.lock(); });
  }

  lock() {
    if (!this._el || this.locked) return;
    try {
      const p = this._el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = this._el.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (_) {} });
    } catch (e) { try { this._el.requestPointerLock(); } catch (_) {} }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(action) { const b = Bindings[action]; for (let i = 0; i < b.length; i++) if (this.keys.has(b[i])) return true; return false; }
  hit(action) { const b = Bindings[action]; for (let i = 0; i < b.length; i++) if (this.pressed.has(b[i])) return true; return false; }
  up(action) { const b = Bindings[action]; for (let i = 0; i < b.length; i++) if (this.released.has(b[i])) return true; return false; }
  fire() { return (this.mouse.buttons & 1) !== 0; }
  fireHit() { return (this.mouse.pressed & 1) !== 0; }
  aim() { return (this.mouse.buttons & 2) !== 0; }
  aimHit() { return (this.mouse.pressed & 2) !== 0; }
  middleHit() { return (this.mouse.pressed & 4) !== 0; }

  // Call at the end of every frame.
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; this.mouse.pressed = 0; this.mouse.released = 0;
  }
}
export const Input = new InputClass();
