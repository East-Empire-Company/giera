import * as THREE from "three";
import { collideCamera } from "../../shared/camera-collision";

const LOOK_HEIGHT = 1.2;

export type MenuStageOptions = {
  radius: number;
  height: number;
  speed: number;
  startAngle: number;
  solid?: (x: number, y: number, z: number) => boolean;
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
    camera.position.set(
      focus.x + Math.sin(angle) * this.options.radius,
      focus.y + this.options.height,
      focus.z + Math.cos(angle) * this.options.radius
    );
    this.lookTarget.set(focus.x, focus.y + LOOK_HEIGHT, focus.z);
    if (this.options.solid) {
      const clamped = collideCamera(this.lookTarget, camera.position, this.options.solid);
      camera.position.set(clamped.x, clamped.y, clamped.z);
    }
    camera.lookAt(this.lookTarget);
  }
}
