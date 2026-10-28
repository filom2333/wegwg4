// Keyboard / mouse input with pointer lock and rebindable actions.

import { settings } from './settings.js';

class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set(); // codes pressed this frame
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, pressed: new Set(), released: new Set() };
    this.locked = false;
    this.enabled = true;
    this.canvas = null;
    this.onLockChange = null;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (this.locked && ['Space', 'Tab', 'KeyF', 'ControlLeft', 'AltLeft'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouse.buttons = 0;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouse.buttons |= 1 << e.button;
      this.mouse.pressed.add(e.button);
    });
    window.addEventListener('mouseup', (e) => {
      this.mouse.buttons &= ~(1 << e.button);
      this.mouse.released.add(e.button);
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.mouse.wheel += Math.sign(e.deltaY);
      },
      { passive: true }
    );
    window.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.down.clear();
        this.mouse.buttons = 0;
      }
      this.onLockChange && this.onLockChange(this.locked);
    });
  }

  attach(canvas) {
    this.canvas = canvas;
  }

  lock() {
    if (!this.canvas) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: false });
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      /* ignore */
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  code(action) {
    return settings.data.bindings[action] || action;
  }
  isDown(action) {
    return this.down.has(this.code(action));
  }
  wasPressed(action) {
    return this.pressed.has(this.code(action));
  }
  wasReleased(action) {
    return this.released.has(this.code(action));
  }
  mouseDown(b = 0) {
    return (this.mouse.buttons & (1 << b)) !== 0;
  }
  mousePressed(b = 0) {
    return this.mouse.pressed.has(b);
  }
  mouseReleased(b = 0) {
    return this.mouse.released.has(b);
  }

  // Simulated input for automated tests.
  simulate(code, isDown) {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
      this.released.add(code);
    }
  }
  simulateMouse(button, isDown) {
    if (isDown) {
      this.mouse.buttons |= 1 << button;
      this.mouse.pressed.add(button);
    } else {
      this.mouse.buttons &= ~(1 << button);
      this.mouse.released.add(button);
    }
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
    this.mouse.pressed.clear();
    this.mouse.released.clear();
  }
}

export const input = new Input();
