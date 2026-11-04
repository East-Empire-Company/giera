import * as THREE from "three";
import type { Cylinder } from "../../shared/entity-collision";

export class TycoonCollisionRoots {
  private readonly roots: THREE.Object3D[] = [];
  private readonly bodies: Cylinder[] = [];
  private readonly bounds = new THREE.Box3();
  private readonly size = new THREE.Vector3();
  private dirty = true;

  add(root: THREE.Object3D): void {
    this.roots.push(root);
    this.dirty = true;
  }

  markDirty(): void {
    this.dirty = true;
  }

  clear(): void {
    this.roots.length = 0;
    this.bodies.length = 0;
    this.dirty = true;
  }

  get(worldParent: THREE.Object3D): readonly Cylinder[] {
    if (!this.dirty) return this.bodies;
    worldParent.updateWorldMatrix(true, true);
    let count = 0;
    for (const root of this.roots) {
      if (!root.visible) continue;
      this.bounds.makeEmpty();
      this.bounds.setFromObject(root);
      if (this.bounds.isEmpty()) continue;
      this.bounds.getSize(this.size);
      const radius = Math.max(this.size.x, this.size.z) * 0.5;
      if (radius <= 0.05 || this.size.y <= 0.05) continue;
      const body = this.bodies[count] ?? { x: 0, y: 0, z: 0, radius: 0, height: 0 };
      this.bodies[count] = body;
      body.x = (this.bounds.min.x + this.bounds.max.x) * 0.5;
      body.y = this.bounds.min.y;
      body.z = (this.bounds.min.z + this.bounds.max.z) * 0.5;
      body.radius = radius;
      body.height = this.size.y;
      count++;
    }
    this.bodies.length = count;
    this.dirty = false;
    return this.bodies;
  }
}
