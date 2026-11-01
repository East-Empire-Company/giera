import * as THREE from "three";
import { makeRng } from "../../shared/rng";

export type GameplayVfxKind = "mine" | "wood" | "leaves" | "footstep" | "pollen" | "craft" | "place" | "collect" | "bounce" | "impact_ring" | "debris";

export type GameplayVfxTextures = {
  dirt01: THREE.Texture;
  dirt02: THREE.Texture;
  leaf01: THREE.Texture;
  spark01: THREE.Texture;
  smoke01: THREE.Texture;
  star01: THREE.Texture;
};

type ParticleKind = "dirt" | "spark" | "star" | "smoke" | "wood" | "leaf" | "pollen" | "dust" | "debris";
type ParticlePriority = "ambient" | "gameplay";

type Particle = {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  life: number;
  size: number;
  gravity: number;
  velocity: THREE.Vector3;
  serial: number;
  priority: ParticlePriority;
  groundY: number;
  bounce: boolean;
};

type Spec = { gravity: number; size: number; speed: number; lift: number; tint: number };

const POOL_SIZE = 64;
const FOOTSTEP_DISTANCE = 0.9;

const SPECS: Record<ParticleKind, Spec> = {
  dirt: { gravity: -9, size: 0.22, speed: 2.2, lift: 1.6, tint: 0xffffff },
  spark: { gravity: 0, size: 0.3, speed: 0.9, lift: 2.2, tint: 0xffe08a },
  star: { gravity: 0, size: 0.36, speed: 0.8, lift: 2.6, tint: 0xfff2a0 },
  smoke: { gravity: 0, size: 0.5, speed: 0.7, lift: 1.4, tint: 0xe6e6e6 },
  wood: { gravity: -4.5, size: 0.14, speed: 1.8, lift: 1.35, tint: 0xb87945 },
  leaf: { gravity: -1.2, size: 0.18, speed: 1.2, lift: 1.6, tint: 0x9bcf5a },
  pollen: { gravity: 0, size: 0.1, speed: 0.14, lift: 0.12, tint: 0xffe6a0 },
  dust: { gravity: -0.5, size: 0.15, speed: 0.5, lift: 0.3, tint: 0xb1a98b },
  debris: { gravity: -14, size: 0.18, speed: 3, lift: 1.2, tint: 0xffffff },
};

export class GameplayVfx {
  private readonly rng: () => number;
  private readonly group = new THREE.Group();
  private readonly pool: Particle[] = [];
  private serial = 0;
  private readonly footstepStates = new Map<string, { position: THREE.Vector3; distance: number }>();
  private readonly impactRing: THREE.Mesh;
  private readonly impactRingGeometry = new THREE.RingGeometry(0.88, 1, 24);
  private readonly impactRingMaterial = new THREE.MeshBasicMaterial({
    color: 0xffdf96,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  private impactRingAge = -1;

  constructor(
    private readonly scene: THREE.Scene,
    seed: number,
    private readonly textures: GameplayVfxTextures
  ) {
    this.rng = makeRng(seed);
    this.group.name = "gameplay-vfx";
    this.impactRing = new THREE.Mesh(this.impactRingGeometry, this.impactRingMaterial);
    this.impactRing.rotation.x = -Math.PI / 2;
    this.impactRing.visible = false;
    scene.add(this.impactRing);
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      this.group.add(sprite);
      this.pool.push({
        sprite,
        material,
        age: 0,
        life: 0,
        size: 0,
        gravity: 0,
        velocity: new THREE.Vector3(),
        priority: "gameplay",
        serial: 0,
        groundY: -Infinity,
        bounce: false,
      });
    }
    scene.add(this.group);
  }

  get activeCount(): number {
    let n = this.impactRing.visible ? 1 : 0;
    for (const p of this.pool) if (p.sprite.visible) n++;
    return n;
  }

  snapshot(): { x: number; y: number; z: number; opacity: number }[] {
    return this.pool
      .filter((p) => p.sprite.visible)
      .map((p) => ({ x: p.sprite.position.x, y: p.sprite.position.y, z: p.sprite.position.z, opacity: p.material.opacity }));
  }

  emit(kind: GameplayVfxKind, position: THREE.Vector3, options: { tint?: number; groundY?: number } = {}): void {
    switch (kind) {
      case "mine":
        this.burst("dirt", 8, 0.45, position, true);
        break;
      case "wood":
        this.burst("wood", 8, 0.48, position, true);
        break;
      case "leaves":
        this.burst("leaf", 8, 0.72, position, true);
        break;
      case "debris":
        this.burst("debris", 10, 0.65, position, true, "gameplay", options);
        break;
      case "impact_ring":
        this.impactRing.position.copy(position);
        this.impactRing.position.y = options.groundY ?? position.y;
        this.impactRing.scale.setScalar(0.3);
        this.impactRingMaterial.color.setHex(options.tint ?? 0xffdf96);
        this.impactRingMaterial.opacity = 0.8;
        this.impactRing.visible = true;
        this.impactRingAge = 0;
        break;
      case "footstep":
        this.burst("dust", 4, 0.28, position, true, "ambient");
        break;
      case "pollen":
        this.burst("pollen", 2, 2.8, position, false, "ambient");
        break;
      case "place":
        this.burst("dirt", 4, 0.35, position, true);
        break;
      case "craft":
        this.burst("spark", 8, 0.65, position, false);
        break;
      case "collect":
        this.burst("star", 8, 0.8, position, false);
        break;
      case "bounce":
        this.burst("smoke", 6, 0.6, position, false);
        this.burst("star", 6, 0.6, position, false);
        break;
    }
  }

  updateFootsteps(playerId: string, position: THREE.Vector3, grounded: boolean): void {
    let state = this.footstepStates.get(playerId);
    if (!state) {
      state = { position: position.clone(), distance: 0 };
      this.footstepStates.set(playerId, state);
      return;
    }
    const dx = position.x - state.position.x;
    const dz = position.z - state.position.z;
    state.position.copy(position);
    if (!grounded) {
      state.distance = 0;
      return;
    }
    const distance = Math.hypot(dx, dz);
    if (distance > 1.25) {
      state.distance = 0;
      return;
    }
    state.distance += distance;
    if (state.distance < FOOTSTEP_DISTANCE) return;
    state.distance %= FOOTSTEP_DISTANCE;
    this.emit("footstep", position);
  }

  update(deltaSeconds: number): void {
    for (const p of this.pool) {
      if (!p.sprite.visible) continue;
      p.age += deltaSeconds;
      if (p.age >= p.life) {
        p.sprite.visible = false;
        p.material.opacity = 0;
        continue;
      }
      p.velocity.y += p.gravity * deltaSeconds;
      p.sprite.position.addScaledVector(p.velocity, deltaSeconds);
      if (p.bounce && p.sprite.position.y <= p.groundY && p.velocity.y < 0) {
        p.sprite.position.y = p.groundY;
        p.velocity.y = -p.velocity.y * 0.4;
        p.velocity.x *= 0.4;
        p.velocity.z *= 0.4;
        p.bounce = false;
      }
      p.material.opacity = 1 - p.age / p.life;
    }
    if (this.impactRing.visible) {
      this.impactRingAge += deltaSeconds;
      if (this.impactRingAge >= 0.25) {
        this.impactRing.visible = false;
        this.impactRingMaterial.opacity = 0;
      } else {
        const progress = this.impactRingAge / 0.25;
        this.impactRing.scale.setScalar(0.3 + progress * 0.9);
        this.impactRingMaterial.opacity = 0.8 * (1 - progress);
      }
    }
  }

  dispose(): void {
    this.scene.remove(this.group, this.impactRing);
    for (const p of this.pool) p.material.dispose();
    this.impactRingGeometry.dispose();
    this.impactRingMaterial.dispose();
    this.footstepStates.clear();
  }

  private texture(kind: ParticleKind, index: number): THREE.Texture {
    switch (kind) {
      case "wood":
      case "dust":
      case "dirt":
      case "debris":
        return index % 2 === 0 ? this.textures.dirt01 : this.textures.dirt02;
      case "leaf":
        return this.textures.leaf01;
      case "spark":
      case "pollen":
        return this.textures.spark01;
      case "star":
        return this.textures.star01;
      case "smoke":
        return this.textures.smoke01;
    }
  }

  private acquire(priority: ParticlePriority): Particle | null {
    let oldestAmbient: Particle | null = null;
    let oldestGameplay: Particle | null = null;
    for (const p of this.pool) {
      if (!p.sprite.visible) return p;
      if (p.priority === "ambient") {
        if (!oldestAmbient || p.serial < oldestAmbient.serial) oldestAmbient = p;
      } else if (!oldestGameplay || p.serial < oldestGameplay.serial) {
        oldestGameplay = p;
      }
    }
    return priority === "ambient" ? oldestAmbient : oldestAmbient ?? oldestGameplay;
  }

  private burst(
    kind: ParticleKind,
    count: number,
    life: number,
    origin: THREE.Vector3,
    outward: boolean,
    priority: ParticlePriority = "gameplay",
    options: { tint?: number; groundY?: number } = {}
  ): void {
    const spec = SPECS[kind];
    for (let i = 0; i < count; i++) {
      const p = this.acquire(priority);
      if (!p) continue;
      const angle = this.rng() * Math.PI * 2;
      const radial = spec.speed * (0.5 + this.rng() * 0.5);
      p.velocity.set(
        Math.cos(angle) * radial,
        outward ? spec.lift * (0.4 + this.rng() * 0.6) : spec.lift * (0.7 + this.rng() * 0.3),
        Math.sin(angle) * radial
      );
      p.age = 0;
      p.life = life;
      p.gravity = spec.gravity;
      p.size = spec.size;
      p.serial = ++this.serial;
      p.priority = priority;
      p.groundY = options.groundY ?? -Infinity;
      p.bounce = kind === "debris";
      p.material.map = this.texture(kind, i);
      p.material.color.setHex(options.tint ?? spec.tint);
      p.material.opacity = 1;
      p.material.needsUpdate = true;
      p.sprite.scale.setScalar(spec.size);
      p.sprite.position.copy(origin);
      p.sprite.visible = true;
    }
  }
}
