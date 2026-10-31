import * as THREE from "three";

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

const LOCKED_COLOR = 0xe53e3e;
const AFFORDABLE_COLOR = 0x38a169;
const OWNED_COLOR = 0xf6c445;
const GROW_SECONDS = 0.6;
const OWNED_SCALE = 1.35;

export type TycoonExpansionOptions = {
  groundAt: (localX: number, localZ: number) => number;
  slots?: readonly ExpansionSlot[];
  render?: boolean;
};

export class TycoonExpansion {
  readonly group = new THREE.Group();
  readonly slots: readonly ExpansionSlot[];
  private readonly states = new Map<number, ExpansionState>();
  private readonly growth = new Map<number, number>();
  private readonly rings = new Map<number, THREE.Mesh>();
  private readonly discs = new Map<number, THREE.Mesh>();
  private readonly markers = new Map<number, THREE.Mesh>();
  private readonly markerBaseY = new Map<number, number>();
  private time = 0;

  constructor(options: TycoonExpansionOptions) {
    this.slots = options.slots ?? EXPANSION_SLOTS;
    const render = options.render ?? true;
    for (const slot of this.slots) {
      this.states.set(slot.index, "locked");
      this.growth.set(slot.index, 0);
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
      this.markerBaseY.set(slot.index, marker.position.y);
    }
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
    this.growth.set(index, 0);
    this.paint(index);
    return true;
  }

  restore(owned: readonly number[]): void {
    const list = Array.isArray(owned) ? owned : [];
    for (const slot of this.slots) {
      const isOwned = list.includes(slot.index);
      this.states.set(slot.index, isOwned ? "owned" : "locked");
      this.growth.set(slot.index, isOwned ? 1 : 0);
      this.paint(slot.index);
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
      const ring = this.rings.get(slot.index);
      const disc = this.discs.get(slot.index);
      const marker = this.markers.get(slot.index);
      if (this.isOwned(slot.index)) {
        const current = this.growth.get(slot.index) ?? 0;
        const next = Math.min(1, current + delta / GROW_SECONDS);
        this.growth.set(slot.index, next);
        const eased = 1 - Math.pow(1 - next, 3);
        const scale = 1 + (OWNED_SCALE - 1) * eased;
        ring?.scale.setScalar(scale);
        disc?.scale.setScalar(scale);
        if (marker) {
          const baseY = this.markerBaseY.get(slot.index) ?? marker.position.y;
          marker.position.y = baseY + Math.sin(this.time * 2.4 + slot.index) * 0.12;
          marker.rotation.y += delta * 1.4;
        }
      } else {
        const pulse = 1 + Math.sin(this.time * 3 + slot.index) * 0.04;
        ring?.scale.setScalar(pulse);
        disc?.scale.setScalar(pulse);
      }
    }
  }

  dispose(): void {
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material.dispose();
    });
    this.group.removeFromParent();
    this.rings.clear();
    this.discs.clear();
    this.markers.clear();
  }

  private paint(index: number): void {
    const state = this.stateOf(index);
    const color = state === "owned" ? OWNED_COLOR : state === "affordable" ? AFFORDABLE_COLOR : LOCKED_COLOR;
    const ring = this.rings.get(index);
    if (ring) {
      const material = ring.material as THREE.MeshStandardMaterial;
      material.color.setHex(color);
      material.emissive.setHex(color);
      material.emissiveIntensity = state === "owned" ? 0.55 : state === "affordable" ? 0.45 : 0.2;
    }
    const disc = this.discs.get(index);
    if (disc) {
      const material = disc.material as THREE.MeshStandardMaterial;
      material.color.setHex(color);
      material.opacity = state === "owned" ? 0.45 : 0.25;
    }
    const marker = this.markers.get(index);
    if (marker) marker.visible = state === "owned";
  }
}
