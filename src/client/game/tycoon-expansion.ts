import * as THREE from "three";
import type { Cylinder } from "../../shared/entity-collision";
import { TycoonCollisionRoots } from "./tycoon-collision";
import type { FactoryModel, FactoryPartProvider } from "./tycoon-plot";
import { TycoonLabelView } from "./tycoon-visuals";

export type ExpansionSlot = {
  index: number;
  x: number;
  z: number;
  cost: number;
};

export type ExpansionState = "locked" | "affordable" | "owned";

export const EXPANSION_SLOTS: readonly ExpansionSlot[] = [
  { index: 0, x: -4.5, z: 2.6, cost: 20 },
  { index: 1, x: -0.5, z: 2.6, cost: 30 },
  { index: 2, x: 3.5, z: 2.6, cost: 40 },
  { index: 3, x: -4.5, z: 5.6, cost: 50 },
  { index: 4, x: -0.5, z: 5.6, cost: 60 },
  { index: 5, x: 3.5, z: 5.6, cost: 70 },
];

const LOCKED_COLOR = 0x526675;
const AFFORDABLE_COLOR = 0xf6c445;
const OWNED_COLOR = 0xf6c445;
const GROW_SECONDS = 0.6;

export type TycoonExpansionOptions = {
  groundAt: (localX: number, localZ: number) => number;
  slots?: readonly ExpansionSlot[];
  render?: boolean;
};

export class TycoonExpansion {
  readonly group = new THREE.Group();
  readonly slots: readonly ExpansionSlot[];
  private readonly groundAt: (localX: number, localZ: number) => number;
  private readonly states = new Map<number, ExpansionState>();
  private readonly growth = new Map<number, number>();
  private readonly rings = new Map<number, THREE.Mesh>();
  private readonly discs = new Map<number, THREE.Mesh>();
  private readonly markers = new Map<number, THREE.Mesh>();
  private readonly labels = new Map<number, TycoonLabelView>();
  private readonly modules = new Map<number, THREE.Group>();
  private readonly collision = new TycoonCollisionRoots();
  private parts?: FactoryPartProvider;
  private time = 0;

  constructor(options: TycoonExpansionOptions) {
    this.slots = options.slots ?? EXPANSION_SLOTS;
    this.groundAt = options.groundAt;
    const render = options.render ?? true;
    for (const slot of this.slots) {
      this.states.set(slot.index, "locked");
      if (!render) continue;

      const y = options.groundAt(slot.x, slot.z) + 0.08;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.05, 0.13, 10, 36),
        new THREE.MeshStandardMaterial({
          color: LOCKED_COLOR,
          emissive: LOCKED_COLOR,
          emissiveIntensity: 0.2,
          roughness: 0.45,
        })
      );
      ring.name = `expansion-ring-${slot.index}`;
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(slot.x, y, slot.z);
      ring.receiveShadow = true;
      this.group.add(ring);
      this.rings.set(slot.index, ring);

      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.92, 36),
        new THREE.MeshStandardMaterial({
          color: LOCKED_COLOR,
          roughness: 0.7,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        })
      );
      disc.name = `expansion-disc-${slot.index}`;
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(slot.x, y - 0.02, slot.z);
      this.group.add(disc);
      this.discs.set(slot.index, disc);

      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32),
        new THREE.MeshStandardMaterial({ color: OWNED_COLOR, emissive: OWNED_COLOR, emissiveIntensity: 0.5, roughness: 0.3 })
      );
      marker.name = `expansion-marker-${slot.index}`;
      marker.position.set(slot.x, y + 1.2, slot.z);
      marker.castShadow = true;
      marker.visible = false;
      this.group.add(marker);
      this.markers.set(slot.index, marker);

      const label = new TycoonLabelView();
      if (label.sprite) {
        label.sprite.position.set(slot.x, y + 1.35, slot.z);
        this.group.add(label.sprite);
      }
      this.labels.set(slot.index, label);
      this.paint(slot.index);
    }
  }

  bindFactoryParts(parts: FactoryPartProvider): void {
    this.parts = parts;
    for (const index of this.ownedIndices()) this.buildModule(index, true);
  }

  getCollisionBodies(): readonly Cylinder[] {
    return this.collision.get(this.group);
  }

  stateOf(index: number): ExpansionState {
    return this.states.get(index) ?? "locked";
  }

  isOwned(index: number): boolean {
    return this.stateOf(index) === "owned";
  }

  ownedIndices(): number[] {
    return this.slots.filter((slot) => this.isOwned(slot.index)).map((slot) => slot.index);
  }

  costOf(index: number): number {
    return this.slots.find((slot) => slot.index === index)?.cost ?? 0;
  }

  canAfford(index: number, stars: number): boolean {
    const cost = this.costOf(index);
    return cost > 0 && !this.isOwned(index) && stars >= cost;
  }

  refresh(stars: number): void {
    for (const slot of this.slots) {
      if (this.isOwned(slot.index)) continue;
      const next = stars >= slot.cost ? "affordable" : "locked";
      if (this.stateOf(slot.index) === next) continue;
      this.states.set(slot.index, next);
      this.paint(slot.index);
    }
  }

  claim(index: number): boolean {
    if (this.isOwned(index) || !this.slots.some((slot) => slot.index === index)) return false;
    this.states.set(index, "owned");
    this.paint(index);
    this.buildModule(index, false);
    return true;
  }

  restore(owned: readonly number[]): void {
    const list = Array.isArray(owned) ? owned : [];
    for (const slot of this.slots) {
      const ownedSlot = list.includes(slot.index);
      this.states.set(slot.index, ownedSlot ? "owned" : "locked");
      this.paint(slot.index);
      if (!ownedSlot) continue;
      const module = this.modules.get(slot.index);
      if (module) {
        module.scale.setScalar(1);
        this.growth.set(slot.index, 1);
        this.collision.markDirty();
      } else {
        this.buildModule(slot.index, true);
      }
    }
  }

  registerShadowMaterials(register: (material: THREE.Material) => void): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => register(entry));
      else register(material);
    });
  }

  update(delta: number): void {
    this.time += delta;
    for (const slot of this.slots) {
      const module = this.modules.get(slot.index);
      if (module) {
        const current = this.growth.get(slot.index) ?? 1;
        if (current < 1) {
          const next = Math.min(1, current + delta / GROW_SECONDS);
          this.growth.set(slot.index, next);
          const eased = 1 - Math.pow(1 - next, 3);
          module.scale.setScalar(next === 1 ? 1 : 0.001 + (1 - 0.001) * eased);
          this.collision.markDirty();
        }
        continue;
      }
      if (this.isOwned(slot.index)) continue;
      const pulse = 1 + Math.sin(this.time * 3 + slot.index) * 0.04;
      this.rings.get(slot.index)?.scale.setScalar(pulse);
      this.discs.get(slot.index)?.scale.setScalar(pulse);
    }
  }

  dispose(): void {
    for (const owned of [this.rings, this.discs, this.markers]) {
      for (const mesh of owned.values()) {
        mesh.geometry.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    }
    for (const label of this.labels.values()) label.dispose();
    this.group.removeFromParent();
    this.group.clear();
    this.rings.clear();
    this.discs.clear();
    this.markers.clear();
    this.labels.clear();
    this.modules.clear();
    this.collision.clear();
  }

  private buildModule(index: number, restored: boolean): void {
    if (this.modules.has(index) || !this.parts || !this.isOwned(index)) return;
    const slot = this.slots.find((entry) => entry.index === index);
    if (!slot) return;
    const root = new THREE.Group();
    root.name = `expansion-module-${index}`;
    root.position.set(slot.x, this.groundAt(slot.x, slot.z), slot.z);
    const add = (name: FactoryModel, x: number, y: number, z: number, scale: number): void => {
      const part = this.parts?.clonePart(name);
      if (!part) return;
      part.position.set(x, y, z);
      part.scale.setScalar(scale);
      root.add(part);
    };
    if (index === 0) add("factoryLongConveyor", 0, 0, 0, 0.65);
    if (index === 1) {
      add("factoryMachine", 0, 0, 0, 0.55);
      add("factoryHopper", 0, 1.3 * 0.55, 0, 0.55);
    }
    if (index === 2) add("factoryScanner", 0, 0, 0, 0.75);
    if (index === 3) {
      add("factoryMachine", 0, 0, 0, 0.55);
      add("factoryHopper", 0, 1.3 * 0.55, 0, 0.55);
    }
    if (index === 4) {
      add("factoryButton", 0, 0, 0, 0.8);
      add("factoryGear", 0.55, 0.55, 0, 0.45);
    }
    if (index === 5) {
      add("factoryMachine", -0.45, 0, 0, 0.5);
      add("factoryScanner", 0.55, 0, 0, 0.6);
    }
    root.scale.setScalar(restored ? 1 : 0.001);
    this.group.add(root);
    this.modules.set(index, root);
    this.growth.set(index, restored ? 1 : 0);
    this.collision.add(root);
  }

  private paint(index: number): void {
    const state = this.stateOf(index);
    const slot = this.slots.find((entry) => entry.index === index);
    const color = state === "affordable" ? AFFORDABLE_COLOR : LOCKED_COLOR;
    const visible = state !== "owned";
    const ring = this.rings.get(index);
    if (ring) {
      ring.visible = visible;
      const material = ring.material as THREE.MeshStandardMaterial;
      material.color.setHex(color);
      material.emissive.setHex(color);
      material.emissiveIntensity = state === "affordable" ? 0.45 : 0.2;
    }
    const disc = this.discs.get(index);
    if (disc) {
      disc.visible = visible;
      const material = disc.material as THREE.MeshStandardMaterial;
      material.color.setHex(color);
      material.opacity = 0.25;
    }
    const marker = this.markers.get(index);
    if (marker) marker.visible = false;
    const label = this.labels.get(index);
    if (label?.sprite) label.sprite.visible = visible;
    if (slot) {
      label?.update({
        icon: state === "locked" ? "lock" : "star",
        text: String(slot.cost),
        accent: state === "affordable" ? "#ffd84d" : "#9fb3bc",
      });
    }
  }
}
