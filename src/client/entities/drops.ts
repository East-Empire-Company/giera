import * as THREE from "three";

export type DropItem = {
  id: number;
  blockId: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  mesh?: THREE.Mesh;
  age: number;
};

export class ItemDropManager {
  readonly drops: DropItem[] = [];
  private nextId = 1;
  private readonly scene?: THREE.Scene;
  private readonly rng: () => number;
  private readonly sharedGeometry = new THREE.BoxGeometry(0.32, 0.32, 0.32);
  private readonly defaultMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0.1,
  });

  constructor(options: { scene?: THREE.Scene; rng?: () => number } = {}) {
    this.scene = options.scene;
    this.rng = options.rng ?? Math.random;
  }

  spawn(x: number, y: number, z: number, blockId: number, material?: THREE.Material): DropItem {
    const drop: DropItem = {
      id: this.nextId++,
      blockId,
      position: new THREE.Vector3(x, y, z),
      velocity: new THREE.Vector3(
        (this.rng() - 0.5) * 2.0,
        3.5 + this.rng() * 1.0,
        (this.rng() - 0.5) * 2.0
      ),
      rotation: new THREE.Euler(this.rng(), this.rng(), this.rng()),
      age: 0,
    };

    if (this.scene) {
      const mesh = new THREE.Mesh(this.sharedGeometry, material ?? this.defaultMaterial);
      mesh.position.copy(drop.position);
      mesh.rotation.copy(drop.rotation);
      mesh.castShadow = true;
      this.scene.add(mesh);
      drop.mesh = mesh;
    }

    this.drops.push(drop);
    return drop;
  }

  update(delta: number, playerPos: { x: number; y: number; z: number }, onCollect?: (drop: DropItem) => void): void {
    const gravity = -14.0;
    const magnetRadiusSq = 3.5 * 3.5;
    const collectRadiusSq = 0.9 * 0.9;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.age += delta;

      const dx = playerPos.x - drop.position.x;
      const dy = playerPos.y + 0.9 - drop.position.y;
      const dz = playerPos.z - drop.position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Magnet attraction
      if (distSq <= magnetRadiusSq && drop.age > 0.3) {
        const speed = 12.0;
        const invDist = 1 / Math.sqrt(distSq);
        drop.velocity.x = dx * invDist * speed;
        drop.velocity.y = dy * invDist * speed;
        drop.velocity.z = dz * invDist * speed;
      } else {
        drop.velocity.y += gravity * delta;
      }

      drop.position.addScaledVector(drop.velocity, delta);
      drop.rotation.y += 3.5 * delta;
      drop.rotation.x += 2.0 * delta;

      if (drop.mesh) {
        drop.mesh.position.copy(drop.position);
        drop.mesh.rotation.copy(drop.rotation);
      }

      // Check collection
      if (distSq <= collectRadiusSq && drop.age > 0.2) {
        if (drop.mesh && this.scene) {
          this.scene.remove(drop.mesh);
        }
        this.drops.splice(i, 1);
        onCollect?.(drop);
      } else if (drop.age > 60) {
        // Despawn old drops after 60s
        if (drop.mesh && this.scene) {
          this.scene.remove(drop.mesh);
        }
        this.drops.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const drop of this.drops) {
      if (drop.mesh && this.scene) {
        this.scene.remove(drop.mesh);
      }
    }
    this.drops.length = 0;
  }
}
