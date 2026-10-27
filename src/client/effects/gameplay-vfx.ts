import * as THREE from "three";
import { makeRng } from "../../shared/rng";

export type GameplayVfxKind = "mine" | "craft" | "place" | "collect" | "bounce";

export type GameplayVfxTextures = {
  dirt01: THREE.Texture;
  dirt02: THREE.Texture;
  spark01: THREE.Texture;
  smoke01: THREE.Texture;
  star01: THREE.Texture;
};

type Particle = {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  age: number;
  life: number;
  size: number;
  gravity: number;
  velocity: THREE.Vector3;
  serial: number;
};

type Spec = {
  count: number;
  life: number;
  gravity: number;
  size: number;
  speed: number;
  lift: number;
  tint: number;
};

const POOL_SIZE = 64;

const SPECS: Record<"dirt" | "spark" | "star" | "smoke", Spec> = {
  dirt: { count: 0, life: 0, gravity: -9, size: 0.22, speed: 2.2, lift: 1.6, tint: 0xffffff },
  spark: { count: 0, life: 0, gravity: 0, size: 0.3, speed: 0.9, lift: 2.2, tint: 0xffe08a },
  star: { count: 0, life: 0, gravity: 0, size: 0.36, speed: 0.8, lift: 2.6, tint: 0xfff2a0 },
  smoke: { count: 0, life: 0, gravity: 0, size: 0.5, speed: 0.7, lift: 1.4, tint: 0xe6e6e6 },
};

export class GameplayVfx {
  private readonly rng: () => number;
  private readonly group = new THREE.Group();
  private readonly pool: Particle[] = [];
  private serial = 0;

  constructor(
    private readonly scene: THREE.Scene,
    seed: number,
    private readonly textures: GameplayVfxTextures
  ) {
    this.rng = makeRng(seed);
    this.group.name = "gameplay-vfx";
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
        opacity: 0,
        fog: false,
      });
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
        serial: 0,
      });
    }
    scene.add(this.group);
  }

  get activeCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.sprite.visible) n++;
    return n;
  }

  snapshot(): { x: number; y: number; z: number; opacity: number }[] {
    return this.pool
      .filter((p) => p.sprite.visible)
      .map((p) => ({ x: p.sprite.position.x, y: p.sprite.position.y, z: p.sprite.position.z, opacity: p.material.opacity }));
  }

  emit(kind: GameplayVfxKind, position: THREE.Vector3): void {
    switch (kind) {
      case "mine":
        this.burst("dirt", 8, 0.45, position, true);
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
      p.material.opacity = 1 - p.age / p.life;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const p of this.pool) {
      p.material.dispose();
    }
  }

  private texture(kind: keyof typeof SPECS, index: number): THREE.Texture {
    switch (kind) {
      case "dirt":
        return index % 2 === 0 ? this.textures.dirt01 : this.textures.dirt02;
      case "spark":
        return this.textures.spark01;
      case "star":
        return this.textures.star01;
      case "smoke":
        return this.textures.smoke01;
    }
  }

  private acquire(): Particle {
    let oldest = this.pool[0];
    for (const p of this.pool) {
      if (!p.sprite.visible) return p;
      if (p.serial < oldest.serial) oldest = p;
    }
    return oldest;
  }

  private burst(kind: keyof typeof SPECS, count: number, life: number, origin: THREE.Vector3, outward: boolean): void {
    const spec = SPECS[kind];
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
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
      p.material.map = this.texture(kind, i);
      p.material.color.setHex(spec.tint);
      p.material.opacity = 1;
      p.material.needsUpdate = true;
      p.sprite.scale.setScalar(spec.size);
      p.sprite.position.copy(origin);
      p.sprite.visible = true;
    }
  }
}
