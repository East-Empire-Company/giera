import * as THREE from "three";
import { TycoonPlot } from "./tycoon-plot";
import { TycoonExpansion, EXPANSION_SLOTS, type ExpansionSlot } from "./tycoon-expansion";
import type { TycoonTheme } from "../../shared/tycoon-slots";
import type { Cylinder } from "../../shared/entity-collision";

export type TycoonUpgrade = {
  tier: number;
  cost: number;
  name: string;
};

export type TycoonOptions = {
  surfaceAt?: (x: number, z: number) => number;
  blocked?: (x: number, z: number) => boolean;
  theme?: TycoonTheme;
  label?: string;
};

const EMPTY_COLLISION_BODIES: readonly Cylinder[] = [];

const DEFAULT_THEME: TycoonTheme = {
  accent: 0x38a169,
  collector: 0x38a169,
  collectorEmissive: 0x22543d,
  upgrade: 0xd69e2e,
  upgradeEmissive: 0x744210,
  trampoline: 0xe53e3e,
};

export type SerializedTycoon = {
  vaultCoins: number;
  collectedStars: number;
  dropperTier: number;
  expansions?: number[];
};

const RISING_VELOCITY_LIMIT = 1;

function createNameLabel(text: string, accent: number): THREE.Sprite | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;

  ctx.fillStyle = "rgba(12, 16, 24, 0.82)";
  ctx.fillRect(6, 6, 500, 116);
  ctx.strokeStyle = `#${accent.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);

  let size = 72;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  while (size > 28 && ctx.measureText(text).width > 440) {
    size -= 4;
    ctx.font = `bold ${size}px system-ui, sans-serif`;
  }
  ctx.fillStyle = "#f7fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 68);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
  );
  sprite.scale.set(4.2, 1.05, 1);
  return sprite;
}

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
  readonly expansion: TycoonExpansion;
  private collectorMesh?: THREE.Mesh;
  private upgradeMesh?: THREE.Mesh;
  private trampolineMesh?: THREE.Mesh;
  private plot?: TycoonPlot;
  private label?: THREE.Sprite;

  constructor(spawn: { x: number; y: number; z: number }, scene?: THREE.Scene, options?: TycoonOptions) {
    this.origin = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.collectorPadPos = new THREE.Vector3(spawn.x, spawn.y, spawn.z - 2);
    this.upgradePadPos = new THREE.Vector3(spawn.x + 2, spawn.y, spawn.z - 2);
    this.trampolinePos = new THREE.Vector3(spawn.x - 2, spawn.y, spawn.z - 2);

    const surfaceAt = options?.surfaceAt;
    const blockedAt = options?.blocked;
    const theme = options?.theme ?? DEFAULT_THEME;
    const groundOffset = (localX: number, localZ: number): number => {
      if (!surfaceAt) return 0;
      const y = surfaceAt(this.origin.x + localX, this.origin.z + localZ);
      return Number.isFinite(y) ? y + 1 - this.origin.y : 0;
    };

    const expansionSlots = blockedAt
      ? EXPANSION_SLOTS.filter((slot) => !blockedAt(this.origin.x + slot.x, this.origin.z + slot.z))
      : undefined;
    this.expansion = new TycoonExpansion({
      groundAt: groundOffset,
      slots: expansionSlots,
      render: Boolean(scene),
    });

    if (scene) {
      this.object = new THREE.Group();
      this.object.position.copy(this.origin);
      this.object.add(this.expansion.group);

      const padGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.1, 24);

      const greenMat = new THREE.MeshStandardMaterial({
        color: theme.collector,
        emissive: theme.collectorEmissive,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      this.collectorMesh = new THREE.Mesh(padGeo, greenMat);
      this.collectorMesh.position.set(0, groundOffset(0, -2) + 0.09, -2);
      this.collectorMesh.receiveShadow = true;
      this.object.add(this.collectorMesh);

      const yellowMat = new THREE.MeshStandardMaterial({
        color: theme.upgrade,
        emissive: theme.upgradeEmissive,
        emissiveIntensity: 0.6,
        roughness: 0.3,
      });
      this.upgradeMesh = new THREE.Mesh(padGeo, yellowMat);
      this.upgradeMesh.position.set(2, groundOffset(2, -2) + 0.09, -2);
      this.upgradeMesh.receiveShadow = true;
      this.object.add(this.upgradeMesh);

      const trampBaseGeo = new THREE.CylinderGeometry(0.85, 0.95, 0.25, 24);
      const redMat = new THREE.MeshStandardMaterial({ color: theme.trampoline, roughness: 0.4 });
      const trampBase = new THREE.Mesh(trampBaseGeo, redMat);
      trampBase.position.set(-2, groundOffset(-2, -2) + 0.14, -2);
      trampBase.castShadow = true;
      trampBase.receiveShadow = true;

      const springGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.08, 24);
      const bouncyMat = new THREE.MeshStandardMaterial({ color: 0xf6e05e, roughness: 0.2 });
      this.trampolineMesh = new THREE.Mesh(springGeo, bouncyMat);
      this.trampolineMesh.position.set(-2, groundOffset(-2, -2) + 0.3, -2);
      this.trampolineMesh.castShadow = true;

      this.object.add(trampBase);
      this.object.add(this.trampolineMesh);

      scene.add(this.object);

      if (options?.label) {
        this.label = createNameLabel(options.label, theme.accent);
        if (this.label) {
          this.label.position.set(0, 3.6, -1);
          this.object.add(this.label);
        }
      }

      this.plot = new TycoonPlot(this.origin, {
        surfaceAt: (localX, localZ) =>
          surfaceAt ? surfaceAt(this.origin.x + localX, this.origin.z + localZ) : this.origin.y - 1,
        blocked: blockedAt
          ? (localX, localZ) => blockedAt(this.origin.x + localX, this.origin.z + localZ)
          : undefined,
      });
      scene.add(this.plot.group);
    }
  }
  getCollisionBodies(): readonly Cylinder[] {
    return this.plot?.getCollisionBodies() ?? EMPTY_COLLISION_BODIES;
  }
  registerShadowMaterials(register: (material: THREE.Material) => void): void {
    this.object?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((entry) => register(entry));
      else if (mat) register(mat);
    });
    this.plot?.registerShadowMaterials(register);
    this.expansion.registerShadowMaterials(register);
  }

  get upgradeCost(): number {
    return this.dropperTier * 5;
  }

  toJSON(): SerializedTycoon {
    return {
      vaultCoins: this.vaultCoins,
      collectedStars: this.collectedStars,
      dropperTier: this.dropperTier,
      expansions: this.expansion.ownedIndices(),
    };
  }

  restore(progress: SerializedTycoon): void {
    this.vaultCoins = progress.vaultCoins;
    this.collectedStars = progress.collectedStars;
    this.dropperTier = progress.dropperTier;
    this.expansion.restore(progress.expansions ?? []);
    this.expansion.refresh(this.collectedStars);
  }

  addStars(amount: number): void {
    this.collectedStars += amount;
    this.expansion.refresh(this.collectedStars);
  }

  get expansionSlots(): readonly ExpansionSlot[] {
    return this.expansion.slots;
  }

  get nextExpansionSlot(): ExpansionSlot | undefined {
    return this.expansion.slots.find((slot) => !this.expansion.isOwned(slot.index));
  }

  buyExpansion(index: number): boolean {
    if (!this.expansion.canAfford(index, this.collectedStars)) return false;
    this.collectedStars -= this.expansion.costOf(index);
    this.expansion.claim(index);
    this.expansion.refresh(this.collectedStars);
    return true;
  }

  buyNextExpansion(): boolean {
    const next = this.nextExpansionSlot;
    if (!next) return false;
    return this.buyExpansion(next.index);
  }

  buyNextExpansionWithPrice(): { bought: boolean; stars: number; cost: number } {
    const next = this.nextExpansionSlot;
    if (!next) return { bought: false, stars: this.collectedStars, cost: 0 };
    const bought = this.buyExpansion(next.index);
    return { bought, stars: this.collectedStars, cost: next.cost };
  }

  update(
    delta: number,
    playerPos: { x: number; y: number; z: number },
    onCollect?: (coins: number) => void,
    onUpgrade?: () => void,
    onBounce?: () => void,
    verticalVelocity = 0,
    onExpand?: (index: number) => void
  ): void {
    this.dropTimer += delta;
    const interval = Math.max(0.6, 2.5 / this.dropperTier);
    if (this.dropTimer >= interval) {
      this.dropTimer = 0;
      this.vaultCoins++;
      this.plot?.produce();
    }

    this.updatePlayerInteractions(delta, playerPos, onCollect, onUpgrade, onBounce, verticalVelocity, false, onExpand);

    this.updateVisuals(delta);
  }

  updateVisuals(delta: number): void {
    this.pulseTime += delta;
    if (this.collectorMesh && this.upgradeMesh) {
      const pulse = Math.sin(this.pulseTime * 0.005) * 0.05 + 1.0;
      this.collectorMesh.scale.set(pulse, 1, pulse);
      this.upgradeMesh.scale.set(pulse, 1, pulse);
    }

    this.plot?.update(delta, this.dropperTier);
    this.expansion.update(delta);
  }

  updateSecondary(
    delta: number,
    playerPos: { x: number; y: number; z: number },
    onCollect?: (coins: number) => void,
    onUpgrade?: () => void,
    onBounce?: () => void,
    verticalVelocity = 0,
    onExpand?: (index: number) => void
  ): void {
    this.updatePlayerInteractions(delta, playerPos, onCollect, onUpgrade, onBounce, verticalVelocity, true, onExpand);
  }

  private updatePlayerInteractions(
    delta: number,
    playerPos: { x: number; y: number; z: number },
    onCollect: ((coins: number) => void) | undefined,
    onUpgrade: (() => void) | undefined,
    onBounce: (() => void) | undefined,
    verticalVelocity: number,
    isSecondary: boolean,
    onExpand: ((index: number) => void) | undefined
  ): void {
    if (isSecondary) {
      if (this.secondaryTrampolineCooldown > 0) this.secondaryTrampolineCooldown -= delta;
    } else if (this.trampolineCooldown > 0) {
      this.trampolineCooldown -= delta;
    }

    const distToCollector = Math.hypot(playerPos.x - this.collectorPadPos.x, playerPos.z - this.collectorPadPos.z);
    if (distToCollector < 1.1 && this.vaultCoins > 0) {
      const coins = this.vaultCoins;
      this.collectedStars += coins;
      this.vaultCoins = 0;
      onCollect?.(coins);
    }

    const distToUpgrade = Math.hypot(playerPos.x - this.upgradePadPos.x, playerPos.z - this.upgradePadPos.z);
    if (distToUpgrade < 1.1 && this.collectedStars >= this.upgradeCost) {
      this.collectedStars -= this.upgradeCost;
      this.dropperTier++;
      onUpgrade?.();
    }

    this.expansion.refresh(this.collectedStars);

    for (const slot of this.expansion.slots) {
      if (this.expansion.isOwned(slot.index)) continue;
      const distance = Math.hypot(
        playerPos.x - (this.origin.x + slot.x),
        playerPos.z - (this.origin.z + slot.z)
      );
      if (distance >= 1.1) continue;
      if (!this.buyExpansion(slot.index)) continue;
      onExpand?.(slot.index);
      break;
    }

    if (
      this.onTrampoline(playerPos, verticalVelocity) &&
      (isSecondary ? this.secondaryTrampolineCooldown : this.trampolineCooldown) <= 0
    ) {
      if (isSecondary) this.secondaryTrampolineCooldown = 0.6;
      else this.trampolineCooldown = 0.6;
      onBounce?.();
    }
  }


  /** Over the pad horizontally and not still climbing from the last bounce. Pad height is not used: it is sampled at a different column than the pad. */
  private onTrampoline(playerPos: { x: number; z: number }, verticalVelocity: number): boolean {
    const horizontal = Math.hypot(playerPos.x - this.trampolinePos.x, playerPos.z - this.trampolinePos.z);
    return horizontal < 1.1 && verticalVelocity <= RISING_VELOCITY_LIMIT;
  }

  dispose(): void {
    this.plot?.dispose();
    this.plot = undefined;
    this.expansion.dispose();
    if (this.label) {
      this.label.material.map?.dispose();
      this.label.material.dispose();
      this.label.removeFromParent();
      this.label = undefined;
    }
    if (this.object) {
      this.object.removeFromParent();
    }
  }
}
