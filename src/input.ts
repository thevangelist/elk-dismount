export class Input {
  keys = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  private pressed = new Set<string>();

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('F')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
  }

  lock() {
    this.el.requestPointerLock();
  }

  down(code: string) {
    return this.keys.has(code);
  }

  justPressed(code: string) {
    const hit = this.pressed.has(code);
    this.pressed.delete(code);
    return hit;
  }

  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
}
