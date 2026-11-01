import * as THREE from "three";
import { Avatar, type PlayerAvatarId } from "./avatar";
import { makeRng } from "../../shared/rng";

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type NPCDef = {
  id: string;
  name: string;
  role: string;
  position: [number, number, number];
  accentColor: string;
  avatarId: PlayerAvatarId;
  scale?: number;
  quickPrompts: string[];
};

export const NPCS: NPCDef[] = [
  {
    id: "tata",
    name: "Tata",
    role: "Tata — przewodnik i opiekun",
    position: [4, 50, 4],
    accentColor: "#4a6fa5",
    avatarId: "tata",
    quickPrompts: ["Co mam zrobić?", "Daj mi blok", "Gdzie mam iść?", "Jak się nazywasz?"],
  },
  {
    id: "mama",
    name: "Mama",
    role: "Mama — pomoc i radość",
    position: [-4, 50, 4],
    accentColor: "#e88a9a",
    avatarId: "mama",
    quickPrompts: ["Jak zrobić kilof?", "Daj mi deski", "Gdzie jest żelazo?", "Co potrafisz?"],
  },
  {
    id: "ciocia",
    name: "Ciocia Ewelina",
    role: "Ciocia — wesoła towarzyszka",
    position: [0, 50, 6],
    accentColor: "#f3a683",
    avatarId: "ciocia",
    quickPrompts: ["Cześć ciociu!", "Daj blok", "Powtórz coś!", "Lecimy?"],
  },
];
export class NPCInstance {
  readonly def: NPCDef;
  readonly position = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  private animTime = 0;
  private rng: () => number;
  private wanderState: "idle" | "walk" = "idle";
  private wanderWait = 3;
  private wanderTarget = new THREE.Vector3();
  avatar?: Avatar;
  constructor(def: NPCDef, rng?: () => number) {
    this.def = def;
    this.position = new THREE.Vector3(...def.position);
    this.home.copy(this.position);
    this.rng = rng ?? makeRng(hashSeed(def.id));
  }

  get name(): string {
    return this.def.name;
  }

  async loadAvatar(): Promise<Avatar> {
    const scale = this.def.scale ?? 0.8;
    const avatar = await Avatar.load(this.def.avatarId, this.def.accentColor);
    avatar.object.scale.setScalar(scale);
    avatar.object.position.copy(this.position);
    const toCenterX = -this.position.x;
    const toCenterZ = -this.position.z;
    avatar.object.rotation.y = Math.atan2(-toCenterX, -toCenterZ);
    this.avatar = avatar;
    return avatar;
  }

  update(delta: number, terrainYAt?: (x: number, z: number) => number, isSolid?: (x: number, y: number, z: number) => boolean): void {
    this.avatar?.update(delta);
    this.animTime += delta;
    this.updateWander(delta, terrainYAt, isSolid);
  }

  walkTo(x: number, z: number): void {
    const dx = x - this.home.x;
    const dz = z - this.home.z;
    const dist = Math.hypot(dx, dz);
    const maxDist = 12;
    const clampedX = dist > maxDist ? this.home.x + (dx / dist) * maxDist : x;
    const clampedZ = dist > maxDist ? this.home.z + (dz / dist) * maxDist : z;
    this.wanderTarget.set(clampedX, this.position.y, clampedZ);
    this.wanderState = "walk";
    this.wanderWait = 4 + this.rng() * 8;
  }

  private updateWander(delta: number, terrainYAt?: (x: number, z: number) => number, isSolid?: (x: number, y: number, z: number) => boolean): void {
    if (this.wanderState === "idle") {
      this.avatar?.setMotion("idle");
      this.wanderWait -= delta;
      if (this.wanderWait > 0) return;
      const angle = this.rng() * Math.PI * 2;
      const dist = 1.5 + this.rng() * 4.5;
      this.wanderTarget.set(
        this.home.x + Math.cos(angle) * dist,
        this.position.y,
        this.home.z + Math.sin(angle) * dist
      );
      this.wanderState = "walk";
      this.avatar?.setMotion("walk");
      return;
    }
    const dx = this.wanderTarget.x - this.position.x;
    const dz = this.wanderTarget.z - this.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 0.02) {
      this.wanderState = "idle";
      this.avatar?.setMotion("idle");
      this.wanderWait = 4 + this.rng() * 8;
      return;
    }
    const dist = Math.sqrt(distSq);
    const step = Math.min(1.2 * delta, dist);
    if (isSolid) {
      const probeX = this.position.x + (dx / dist) * (step + 0.45);
      const probeZ = this.position.z + (dz / dist) * (step + 0.45);
      const feet = Math.floor(this.position.y);
      if (isSolid(Math.floor(probeX), feet, Math.floor(probeZ)) || isSolid(Math.floor(probeX), feet + 1, Math.floor(probeZ))) {
        this.wanderState = "idle";
        this.avatar?.setMotion("idle");
        this.wanderWait = 1 + this.rng() * 3;
        return;
      }
    }
    this.position.x += (dx / dist) * step;
    this.position.z += (dz / dist) * step;
    if (terrainYAt) this.position.y = terrainYAt(this.position.x, this.position.z) + 1;
    const entity = this.avatar?.object;
    if (entity) {
      entity.position.set(this.position.x, this.position.y, this.position.z);
      entity.rotation.y = Math.atan2(dx, dz);
    }
  }
}

export class NPCManager {
  readonly npcs: NPCInstance[];

  constructor(rngFactory?: (seed: number) => () => number) {
    this.npcs = NPCS.map((def) =>
      rngFactory ? new NPCInstance(def, rngFactory(hashSeed(def.id))) : new NPCInstance(def)
    );
  }

  updateAll(delta: number, terrainYAt?: (x: number, z: number) => number, isSolid?: (x: number, y: number, z: number) => boolean): void {
    for (const npc of this.npcs) npc.update(delta, terrainYAt, isSolid);
  }

  getNearestNPC(x: number, y: number, z: number, maxDist = 3.0): NPCInstance | null {
    let nearest: NPCInstance | null = null;
    let minDistSq = maxDist * maxDist;

    for (const npc of this.npcs) {
      const dx = npc.position.x - x;
      const dy = npc.position.y - y;
      const dz = npc.position.z - z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq <= minDistSq) {
        minDistSq = distSq;
        nearest = npc;
      }
    }
    return nearest;
  }

  spawnInScene(scene: THREE.Scene, terrainYAt: (x: number, z: number) => number): Promise<void> {
    return Promise.all(
      this.npcs.map(async (npc) => {
        const y = terrainYAt(npc.position.x, npc.position.z) + 1;
        npc.position.y = y;
        const avatar = await npc.loadAvatar();
        scene.add(avatar.object);
      })
    ).then(() => {});
  }
}
