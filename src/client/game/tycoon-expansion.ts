import * as THREE from "three";
import type { Cylinder } from "../../shared/entity-collision";
import { TycoonLabelView } from "./tycoon-visuals";
import type { HeadquartersArt } from "./tycoon-headquarters-art";

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

export type TycoonExpansionOptions = {
  groundAt: (localX: number, localZ: number) => number;
  slots?: readonly ExpansionSlot[];
  render?: boolean;
  preflight?: (index: number) => boolean;
  build?: (index: number, restored: boolean) => void;
  art?: HeadquartersArt;
};

export class TycoonExpansion {
  readonly group = new THREE.Group();
  readonly slots: readonly ExpansionSlot[];
  private readonly states = new Map<number, ExpansionState>();
  private readonly kiosks = new Map<number, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  private readonly holograms = new Map<number, THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>>();
  private readonly labels = new Map<number, TycoonLabelView>();
  private readonly collisionBodies: readonly Cylinder[] = [];
  private readonly preflight?: (index: number) => boolean;
  private readonly build?: (index: number, restored: boolean) => void;
  private readonly art?: HeadquartersArt;
  private time = 0;

  constructor(options: TycoonExpansionOptions) {
    this.slots = options.slots ?? EXPANSION_SLOTS;
    this.preflight = options.preflight;
    this.build = options.build;
    this.art = options.art;
    if (this.art) {
      this.group.add(this.art.root);
      this.art.setOwned([]);
    }
    const render = options.render ?? true;

    for (const slot of this.slots) {
      this.states.set(slot.index, "locked");
      if (!render) continue;

      const y = options.groundAt(slot.x, slot.z) + 0.04;
      const kiosk = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.08, 1.5),
        new THREE.MeshStandardMaterial({
          color: LOCKED_COLOR,
          emissive: LOCKED_COLOR,
          emissiveIntensity: 0.2,
          roughness: 0.45,
        }),
      );
      kiosk.name = `hq-kiosk-${slot.index}`;
      kiosk.position.set(slot.x, y, slot.z);
      kiosk.receiveShadow = true;
      this.group.add(kiosk);
      this.kiosks.set(slot.index, kiosk);

      const hologram = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.32),
        new THREE.MeshStandardMaterial({
          color: AFFORDABLE_COLOR,
          emissive: AFFORDABLE_COLOR,
          emissiveIntensity: 0.5,
          roughness: 0.3,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
        }),
      );
      hologram.name = `hq-hologram-${slot.index}`;
      hologram.position.set(slot.x, y + 0.85, slot.z);
      this.group.add(hologram);
      this.holograms.set(slot.index, hologram);

      const label = new TycoonLabelView();
      if (label.sprite) {
        label.sprite.position.set(slot.x, y + 1.35, slot.z);
        this.group.add(label.sprite);
      }
      this.labels.set(slot.index, label);
      this.paint(slot.index);
    }
  }

  getCollisionBodies(): readonly Cylinder[] {
    return this.collisionBodies;
  }

  stateOf(index: number): ExpansionState {
    return this.states.get(index) ?? "locked";
  }

  isOwned(index: number): boolean {
    return this.stateOf(index) === "owned";
  }

  setLabelsHidden(hidden: boolean): void {
    for (const [index, label] of this.labels) {
      if (label.sprite) label.sprite.visible = !hidden && !this.isOwned(index);
    }
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
    if (!(this.preflight?.(index) ?? true)) return false;
    this.states.set(index, "owned");
    this.paint(index);
    this.art?.setOwned(this.ownedIndices());
    this.build?.(index, false);
    return true;
  }

  restore(owned: readonly number[]): void {
    const list = Array.isArray(owned) ? owned : [];
    for (const slot of this.slots) {
      const ownedSlot = list.includes(slot.index);
      this.states.set(slot.index, ownedSlot ? "owned" : "locked");
      this.paint(slot.index);
      if (ownedSlot) this.build?.(slot.index, true);
    }
    this.art?.setOwned(this.ownedIndices());
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
    this.art?.update(delta);
    for (const slot of this.slots) {
      if (this.isOwned(slot.index)) continue;
      const pulse = 1 + Math.sin(this.time * 3 + slot.index) * 0.04;
      this.kiosks.get(slot.index)?.scale.setScalar(pulse);
      const hologram = this.holograms.get(slot.index);
      if (hologram) {
        hologram.scale.setScalar(pulse);
        hologram.rotation.y = this.time * 0.8 + slot.index;
      }
    }
  }

  dispose(): void {
    for (const meshes of [this.kiosks, this.holograms]) {
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    for (const label of this.labels.values()) label.dispose();
    this.art?.dispose();
    this.group.removeFromParent();
    this.group.clear();
    this.kiosks.clear();
    this.holograms.clear();
    this.labels.clear();
  }

  private paint(index: number): void {
    const state = this.stateOf(index);
    const slot = this.slots.find((entry) => entry.index === index);
    const color = state === "affordable" ? AFFORDABLE_COLOR : LOCKED_COLOR;
    const visible = state !== "owned";

    const kiosk = this.kiosks.get(index);
    if (kiosk) {
      kiosk.visible = visible;
      kiosk.material.color.setHex(color);
      kiosk.material.emissive.setHex(color);
      kiosk.material.emissiveIntensity = state === "affordable" ? 0.45 : 0.2;
    }

    const hologram = this.holograms.get(index);
    if (hologram) {
      hologram.visible = visible;
      hologram.material.color.setHex(color);
      hologram.material.emissive.setHex(color);
    }

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
