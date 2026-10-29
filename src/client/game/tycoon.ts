import * as THREE from "three";

export type TycoonUpgrade = {
  tier: number;
  cost: number;
  name: string;
};

const RISING_VELOCITY_LIMIT = 1;

export class TycoonManager {
  readonly origin: THREE.Vector3;
  readonly collectorPadPos: THREE.Vector3;
  readonly upgradePadPos: THREE.Vector3;
  readonly trampolinePos: THREE.Vector3;

  vaultCoins = 0;
  collectedStars = 0;
  dropperTier = 1;
  private dropTimer = 0;
  private trampolineCooldown = 0;
  private secondaryTrampolineCooldown = 0;
  private pulseTime = 0;

  readonly object?: THREE.Group;
  private collectorMesh?: THREE.Mesh;
  private upgradeMesh?: THREE.Mesh;
  private trampolineMesh?: THREE.Mesh;

  constructor(spawn: { x: number; y: number; z: number }, scene?: THREE.Scene) {
    this.origin = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.collectorPadPos = new THREE.Vector3(spawn.x, spawn.y, spawn.z - 2);
    this.upgradePadPos = new THREE.Vector3(spawn.x + 2, spawn.y, spawn.z - 2);
    this.trampolinePos = new THREE.Vector3(spawn.x - 2, spawn.y, spawn.z - 2);

    if (scene) {
      this.object = new THREE.Group();
      this.object.position.copy(this.origin);

      // Dropper Machine Frame
      const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.6 });
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(0, 1.1, 0);
      this.object.add(post);

      // Dropper Chute / Chute Box
      const boxGeo = new THREE.BoxGeometry(0.8, 0.5, 0.8);
      const chuteMat = new THREE.MeshStandardMaterial({ color: 0x3182ce, roughness: 0.4 });
      const chute = new THREE.Mesh(boxGeo, chuteMat);
      chute.position.set(0, 2.1, 0);
      this.object.add(chute);

      // Ramp
      const rampGeo = new THREE.BoxGeometry(0.4, 0.08, 1.8);
      const rampMat = new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.5 });
      const ramp = new THREE.Mesh(rampGeo, rampMat);
      ramp.rotation.x = -0.35;
      ramp.position.set(0, 1.2, -0.8);
      this.object.add(ramp);

      // Collector Pad (Green glowing disc)
      const padGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.1, 24);
      const greenMat = new THREE.MeshStandardMaterial({
        color: 0x38a169,
        emissive: 0x22543d,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      this.collectorMesh = new THREE.Mesh(padGeo, greenMat);
      this.collectorMesh.position.set(0, 0.05, -2);
      this.object.add(this.collectorMesh);

      // Upgrade Pad (Yellow glowing disc)
      const upGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.1, 24);
      const yellowMat = new THREE.MeshStandardMaterial({
        color: 0xd69e2e,
        emissive: 0x744210,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      this.upgradeMesh = new THREE.Mesh(upGeo, yellowMat);
      this.upgradeMesh.position.set(2, 0.05, -2);
      this.object.add(this.upgradeMesh);

      // Trampoline Pad (Red & Yellow bouncer)
      const trampBaseGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.25, 24);
      const redMat = new THREE.MeshStandardMaterial({ color: 0xe53e3e, roughness: 0.4 });
      const trampBase = new THREE.Mesh(trampBaseGeo, redMat);
      trampBase.position.set(-2, 0.12, -2);

      const springGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.08, 24);
      const bouncyMat = new THREE.MeshStandardMaterial({ color: 0xf6e05e, roughness: 0.2 });
      this.trampolineMesh = new THREE.Mesh(springGeo, bouncyMat);
      this.trampolineMesh.position.set(-2, 0.28, -2);

      this.object.add(trampBase);
      this.object.add(this.trampolineMesh);

      scene.add(this.object);
    }
  }

  get upgradeCost(): number {
    return this.dropperTier * 5;
  }

  addStars(amount: number): void {
    this.collectedStars += amount;
  }

  update(
    delta: number,
    playerPos: { x: number; y: number; z: number },
    onCollect?: (coins: number) => void,
    onUpgrade?: () => void,
    onBounce?: () => void,
    verticalVelocity = 0
  ): void {
    // 1. Dropper interval
    this.dropTimer += delta;
    const interval = Math.max(0.6, 2.5 / this.dropperTier);
    if (this.dropTimer >= interval) {
      this.dropTimer = 0;
      this.vaultCoins++;
    }

    if (this.trampolineCooldown > 0) {
      this.trampolineCooldown -= delta;
    }

    // 2. Collector Pad Check
    const distToCollector = Math.hypot(playerPos.x - this.collectorPadPos.x, playerPos.z - this.collectorPadPos.z);
    if (distToCollector < 1.1 && this.vaultCoins > 0) {
      const coins = this.vaultCoins;
      this.collectedStars += coins;
      this.vaultCoins = 0;
      onCollect?.(coins);
    }

    // 3. Upgrade Pad Check
    const distToUpgrade = Math.hypot(playerPos.x - this.upgradePadPos.x, playerPos.z - this.upgradePadPos.z);
    if (distToUpgrade < 1.1 && this.collectedStars >= this.upgradeCost) {
      this.collectedStars -= this.upgradeCost;
      this.dropperTier++;
      onUpgrade?.();
    }

    // 4. Trampoline Check
    if (this.onTrampoline(playerPos, verticalVelocity) && this.trampolineCooldown <= 0) {
      this.trampolineCooldown = 0.6;
      onBounce?.();
    }

    // Visual breathing / pulse on pads
    this.pulseTime += delta;
    if (this.collectorMesh && this.upgradeMesh) {
      const pulse = Math.sin(this.pulseTime * 0.005) * 0.05 + 1.0;
      this.collectorMesh.scale.set(pulse, 1, pulse);
      this.upgradeMesh.scale.set(pulse, 1, pulse);
    }
  }

  updateSecondaryTrampoline(
    delta: number,
    playerPos: { x: number; y: number; z: number },
    onBounce?: () => void,
    verticalVelocity = 0
  ): void {
    if (this.secondaryTrampolineCooldown > 0) this.secondaryTrampolineCooldown -= delta;
    if (this.onTrampoline(playerPos, verticalVelocity) && this.secondaryTrampolineCooldown <= 0) {
      this.secondaryTrampolineCooldown = 0.6;
      onBounce?.();
    }
  }

  /** Over the pad horizontally and not still climbing from the last bounce. Pad height is not used: it is sampled at a different column than the pad. */
  private onTrampoline(playerPos: { x: number; z: number }, verticalVelocity: number): boolean {
    const horizontal = Math.hypot(playerPos.x - this.trampolinePos.x, playerPos.z - this.trampolinePos.z);
    return horizontal < 1.1 && verticalVelocity <= RISING_VELOCITY_LIMIT;
  }

  dispose(): void {
    if (this.object) {
      this.object.removeFromParent();
    }
  }
}
