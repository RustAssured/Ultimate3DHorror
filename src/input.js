// input.js — keyboard + mouse + pointer-lock, mapped to actions.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.clicked = false;
    this.wheel = 0;
    this.sensitivity = 0.0022;

    this._onKeyDown = (e) => {
      // don't swallow devtools / refresh
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
    };
    this._onClick = () => { this.clicked = true; };
    this._onWheel = (e) => { this.wheel += e.deltaY; };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    window.addEventListener('mousedown', this._onClick);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    // Safety: release keys when window loses focus
    window.addEventListener('blur', () => this.keys.clear());
  }

  requestLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }
  exitLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }

  // movement axis from WASD / arrows: returns {x,z} in [-1,1]
  moveAxis() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  // consume accumulated mouse delta (call once per frame)
  consumeMouse() {
    const d = { x: this.mouseDX * this.sensitivity, y: this.mouseDY * this.sensitivity };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }
  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }
  consumeClick() {
    const c = this.clicked;
    this.clicked = false;
    return c;
  }

  // edge-triggered key press (returns true once until released)
  pressed(code) {
    if (this.keys.has(code)) {
      if (!this._pressedSet) this._pressedSet = new Set();
      if (!this._pressedSet.has(code)) {
        this._pressedSet.add(code);
        return true;
      }
      return false;
    } else {
      if (this._pressedSet) this._pressedSet.delete(code);
      return false;
    }
  }
}
