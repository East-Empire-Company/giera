import * as THREE from "three";

export class TrainingDummy {
  readonly position: THREE.Vector3;
  readonly object: THREE.Group;
  private readonly pivot: THREE.Group;
  wobbleAngle = 0;
  private wobbleVelocity = 0;

  constructor(spawn: { x: number; y: number; z: number }, materials?: { planks?: THREE.Material; bark?: THREE.Material }) {
    this.position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.object = new THREE.Group();
    this.object.position.copy(this.position);

    // Stand base
    const baseGeo = new THREE.CylinderGeometry(0.35, 0.45, 0.2, 12);
    const woodMat = materials?.planks ?? new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const base = new THREE.Mesh(baseGeo, woodMat);
    base.position.y = 0.1;
    base.castShadow = true;
    this.object.add(base);

    // Spring pivot at base
    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.2;
    this.object.add(this.pivot);

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8);
    const pole = new THREE.Mesh(poleGeo, materials?.bark ?? woodMat);
    pole.position.y = 0.7;
    pole.castShadow = true;
    this.pivot.add(pole);

    // Torso (Straw / Burlap sack)
    const torsoGeo = new THREE.CylinderGeometry(0.25, 0.22, 0.8, 12);
    const torso = new THREE.Mesh(torsoGeo, woodMat);
    torso.position.y = 0.9;
    torso.castShadow = true;
    this.pivot.add(torso);

    // Target smile / bullseye on chest
    const targetGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.02, 16);
    const redMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.8 });
    const target = new THREE.Mesh(targetGeo, redMat);
    target.rotation.x = Math.PI / 2;
    target.position.set(0, 0.9, 0.26);
    this.pivot.add(target);

    // Head
    const headGeo = new THREE.SphereGeometry(0.2, 12, 12);
    const head = new THREE.Mesh(headGeo, woodMat);
    head.position.y = 1.45;
    head.castShadow = true;
    this.pivot.add(head);
  }

  hit(): void {
    // Impulse hit
    this.wobbleVelocity = 14.0;
    this.wobbleAngle = 0.45;
  }

  update(delta: number): void {
    if (Math.abs(this.wobbleAngle) > 0.001 || Math.abs(this.wobbleVelocity) > 0.001) {
      const springK = 80.0;
      const damping = 6.0;
      const force = -springK * this.wobbleAngle - damping * this.wobbleVelocity;
      this.wobbleVelocity += force * delta;
      this.wobbleAngle += this.wobbleVelocity * delta;

      this.pivot.rotation.z = this.wobbleAngle;
    } else {
      this.wobbleAngle = 0;
      this.wobbleVelocity = 0;
      this.pivot.rotation.z = 0;
    }
  }

  isHit(origin: THREE.Vector3, maxDist = 3.5): boolean {
    return origin.distanceTo(this.position) <= maxDist;
  }
}
