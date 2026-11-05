export type Position3 = { x: number; y: number; z: number };
export type ElevatorPlayer = 0 | 1;

type Ride = { player: ElevatorPlayer; direction: "up" | "down"; time: number };

const DURATION = 1.2;
const CENTER_DURATION = 0.15;
const VERTICAL_DURATION = 0.85;
const VERTICAL_START = CENTER_DURATION;
const EXIT_START = CENTER_DURATION + VERTICAL_DURATION;
const EPSILON = 1e-9;

export class TycoonElevator {
  private ride: Ride | null = null;
  private readonly armed: [boolean, boolean] = [true, true];
  private height = 0;

  constructor(private readonly origin: Position3) {}

  step(player: ElevatorPlayer, position: Position3, delta: number, owned: boolean): Position3 | null {
    if (!owned) {
      this.reset();
      return null;
    }

    if (this.ride) {
      if (this.ride.player !== player) return null;
      const up = this.ride.direction === "up";
      this.ride.time = Math.min(DURATION, this.ride.time + delta);
      const finished = this.ride.time >= DURATION - EPSILON;
      const time = finished ? DURATION : this.ride.time;
      const groundY = this.origin.y + 1;
      const upperY = this.origin.y + 5;
      let y = up ? groundY : upperY;
      let z = this.origin.z + (up ? 1.5 : 3.5);

      if (time < CENTER_DURATION) {
        const progress = time / CENTER_DURATION;
        z = this.origin.z + (up ? 1.5 + progress : 3.5 - progress);
      } else if (time < EXIT_START) {
        const progress = (time - VERTICAL_START) / VERTICAL_DURATION;
        y = up ? groundY + 4 * progress : upperY - 4 * progress;
        z = this.origin.z + 2.5;
      } else {
        const progress = (time - EXIT_START) / (DURATION - EXIT_START);
        y = up ? upperY : groundY;
        z = this.origin.z + (up ? 2.5 + progress : 2.5 - progress);
      }

      this.height = y - this.origin.y - 1;
      if (finished) {
        this.armed[player] = false;
        this.ride = null;
      }
      return { x: this.origin.x + 1.5, y, z };
    }

    const level = Math.abs(position.y - (this.origin.y + 1)) < 0.5
      ? "ground"
      : Math.abs(position.y - (this.origin.y + 5)) < 0.5
        ? "upper"
        : null;
    if (!level) return null;
    const callZ = this.origin.z + (level === "ground" ? 1.5 : 3.5);
    const near = Math.hypot(position.x - (this.origin.x + 1.5), position.z - callZ) < 0.75;
    if (!near) {
      this.armed[player] = true;
      return null;
    }
    if (!this.armed[player]) return null;
    this.ride = { player, direction: level === "ground" ? "up" : "down", time: 0 };
    return { x: this.origin.x + 1.5, y: position.y, z: position.z };
  }

  platformHeight(): number {
    return this.height;
  }

  reset(): void {
    this.ride = null;
    this.height = 0;
    this.armed[0] = true;
    this.armed[1] = true;
  }
}
