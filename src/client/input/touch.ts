export type TouchInput = {
  forward: number;
  right: number;
  lookX: number;
  lookY: number;
  jump: boolean;
  place: boolean;
  mine: boolean;
};

export class TouchController {
  private joystickTouchId: string | null = null;
  private joystickOrigin: { x: number; y: number } | null = null;
  private joystickVector = { forward: 0, right: 0 };

  private lookTouchId: string | null = null;
  private lookPrevious: { x: number; y: number } | null = null;
  private lookAccumulator = { lookX: 0, lookY: 0 };

  jump = false;
  place = false;
  mine = false;

  handleTouchStart(id: string, x: number, y: number, screenWidth: number): void {
    if (x < screenWidth / 2) {
      // Left side: Joystick
      if (this.joystickTouchId === null) {
        this.joystickTouchId = id;
        this.joystickOrigin = { x, y };
        this.joystickVector = { forward: 0, right: 0 };
      }
    } else {
      // Right side: Camera look
      if (this.lookTouchId === null) {
        this.lookTouchId = id;
        this.lookPrevious = { x, y };
      }
    }
  }

  handleTouchMove(id: string, x: number, y: number): void {
    if (id === this.joystickTouchId && this.joystickOrigin) {
      const dx = x - this.joystickOrigin.x;
      const dy = y - this.joystickOrigin.y;
      const radius = 50; // max joystick drag radius
      const clampedX = Math.max(-1, Math.min(1, dx / radius));
      const clampedY = Math.max(-1, Math.min(1, dy / radius));

      this.joystickVector = {
        forward: -clampedY, // Drag up -> forward
        right: clampedX,
      };
    } else if (id === this.lookTouchId && this.lookPrevious) {
      const dx = x - this.lookPrevious.x;
      const dy = y - this.lookPrevious.y;
      this.lookAccumulator.lookX += dx;
      this.lookAccumulator.lookY += dy;
      this.lookPrevious = { x, y };
    }
  }

  handleTouchEnd(id: string): void {
    if (id === this.joystickTouchId) {
      this.joystickTouchId = null;
      this.joystickOrigin = null;
      this.joystickVector = { forward: 0, right: 0 };
    } else if (id === this.lookTouchId) {
      this.lookTouchId = null;
      this.lookPrevious = null;
    }
  }

  getInput(): TouchInput {
    return {
      forward: this.joystickVector.forward,
      right: this.joystickVector.right,
      lookX: this.lookAccumulator.lookX,
      lookY: this.lookAccumulator.lookY,
      jump: this.jump,
      place: this.place,
      mine: this.mine,
    };
  }

  consumeLook(): { lookX: number; lookY: number } {
    const res = { ...this.lookAccumulator };
    this.lookAccumulator = { lookX: 0, lookY: 0 };
    return res;
  }

  attachDOM(container: HTMLElement, onInventoryToggle: () => void, onPlaceClick: () => void): void {
    const touchOverlay = document.createElement("div");
    touchOverlay.className = "hud-touch-controls";
    touchOverlay.innerHTML = `
      <div class="hud-touch-actions">
        <button class="hud-touch-btn hud-touch-mine" id="touch-mine-btn">Kop</button>
        <button class="hud-touch-btn hud-touch-place" id="touch-place-btn">Staw</button>
        <button class="hud-touch-btn hud-touch-jump" id="touch-jump-btn">Skok</button>
        <button class="hud-touch-btn hud-touch-inv" id="touch-inv-btn">Plecak</button>
      </div>
    `;
    container.appendChild(touchOverlay);

    const mineBtn = touchOverlay.querySelector<HTMLButtonElement>("#touch-mine-btn")!;
    const jumpBtn = touchOverlay.querySelector<HTMLButtonElement>("#touch-jump-btn")!;
    const placeBtn = touchOverlay.querySelector<HTMLButtonElement>("#touch-place-btn")!;
    const invBtn = touchOverlay.querySelector<HTMLButtonElement>("#touch-inv-btn")!;

    mineBtn.addEventListener("touchstart", (e) => { e.preventDefault(); this.mine = true; });
    mineBtn.addEventListener("touchend", (e) => { e.preventDefault(); this.mine = false; });

    jumpBtn.addEventListener("touchstart", (e) => { e.preventDefault(); this.jump = true; });
    jumpBtn.addEventListener("touchend", (e) => { e.preventDefault(); this.jump = false; });

    placeBtn.addEventListener("touchstart", (e) => { e.preventDefault(); onPlaceClick(); });
    invBtn.addEventListener("click", () => onInventoryToggle());

    // Window touch listeners for joystick and look
    window.addEventListener("touchstart", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        this.handleTouchStart(`touch-${t.identifier}`, t.clientX, t.clientY, window.innerWidth);
      }
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        this.handleTouchMove(`touch-${t.identifier}`, t.clientX, t.clientY);
      }
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        this.handleTouchEnd(`touch-${t.identifier}`);
      }
    }, { passive: true });
  }
}
