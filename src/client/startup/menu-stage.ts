import * as THREE from "three";
import { collideCamera } from "../../shared/camera-collision";

const LOOK_HEIGHT = 1.2;

export type MenuStageOptions = {
  radius: number;
  height: number;
  speed: number;
  startAngle: number;
  solid?: (x: number, y: number, z: number) => boolean;
  groundAt?: (x: number, z: number) => number;
};

export class MenuStage {
  private time = 0;
  private readonly options: MenuStageOptions;
  private readonly lookTarget = new THREE.Vector3();

  constructor(options: MenuStageOptions) {
    this.options = options;
  }

  update(delta: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3): void {
    this.time += delta;
    const angle = this.options.startAngle + this.time * this.options.speed;
    const targetX = focus.x + Math.sin(angle) * this.options.radius;
    const targetZ = focus.z + Math.cos(angle) * this.options.radius;
    const ground = this.options.groundAt ? this.options.groundAt(targetX, targetZ) : Number.NEGATIVE_INFINITY;
    const targetY = Math.max(focus.y + this.options.height, ground + 2.0);
    camera.position.set(targetX, targetY, targetZ);
    this.lookTarget.set(focus.x, focus.y + LOOK_HEIGHT, focus.z);
    if (this.options.solid) {
      const clamped = collideCamera(this.lookTarget, camera.position, this.options.solid);
      camera.position.set(clamped.x, clamped.y, clamped.z);
    }
    camera.lookAt(this.lookTarget);
  }
}
