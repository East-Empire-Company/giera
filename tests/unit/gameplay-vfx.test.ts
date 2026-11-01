import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GameplayVfx, type GameplayVfxKind, type GameplayVfxTextures } from "../../src/client/effects/gameplay-vfx";

function makeVfx(seed = 424242): GameplayVfx {
  const textures: GameplayVfxTextures = {
    dirt01: new THREE.Texture(),
    dirt02: new THREE.Texture(),
    leaf01: new THREE.Texture(),
    spark01: new THREE.Texture(),
    smoke01: new THREE.Texture(),
    star01: new THREE.Texture(),
  };
  return new GameplayVfx(new THREE.Scene(), seed, textures);
}

const origin = new THREE.Vector3(10, 20, 30);

  it("expands and removes the impact ring after 0.25 seconds", () => {
    const scene = new THREE.Scene();
    const vfx = new GameplayVfx(scene, 424242, {
      dirt01: new THREE.Texture(), dirt02: new THREE.Texture(), leaf01: new THREE.Texture(),
      spark01: new THREE.Texture(), smoke01: new THREE.Texture(), star01: new THREE.Texture(),
    });
    vfx.emit("impact_ring", origin, { groundY: 19 });
    const ring = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    expect(ring?.visible).toBe(true);
    expect(ring?.scale.x).toBeCloseTo(0.3);
    vfx.update(0.125);
    expect(ring?.scale.x).toBeCloseTo(0.75);
    expect(ring?.visible).toBe(true);
    vfx.update(0.13);
    expect(ring?.visible).toBe(false);
    vfx.dispose();
  });

  it("emits ten gravity-driven debris particles that bounce at ground height", () => {
    const vfx = makeVfx();
    vfx.emit("debris", origin, { groundY: 20, tint: 0x996633 });
    expect(vfx.activeCount).toBe(10);
    vfx.update(0.3);
    const impactPositions = vfx.snapshot();
    expect(impactPositions.every((particle) => particle.y >= 20)).toBe(true);
    vfx.update(0.05);
    const particles = vfx.snapshot();
    expect(particles).toHaveLength(10);
    expect(particles.every((particle) => particle.y >= 20)).toBe(true);
    expect(particles.some((particle) => particle.y > 20)).toBe(true);
  });

describe("GameplayVfx bursts", () => {
  const cases: [GameplayVfxKind, number, number][] = [
    ["mine", 8, 0.45],
    ["craft", 8, 0.65],
    ["place", 4, 0.35],
    ["collect", 8, 0.8],
    ["bounce", 12, 0.6],
  ];

  it.each(cases)("%s spawns %i particles that expire after %fs", (kind, count, life) => {
    const vfx = makeVfx();
    expect(vfx.activeCount).toBe(0);
    vfx.emit(kind, origin);
    expect(vfx.activeCount).toBe(count);
    vfx.update(life - 0.05);
    expect(vfx.activeCount).toBe(count);
    vfx.update(0.06);
    expect(vfx.activeCount).toBe(0);
  });

  it("fades opacity linearly", () => {
    const vfx = makeVfx();
    vfx.emit("craft", origin);
    vfx.update(0.325);
    for (const p of vfx.snapshot()) expect(p.opacity).toBeCloseTo(0.5, 5);
  });

  it("mine bursts spread outward and craft bursts rise", () => {
    const mine = makeVfx();
    mine.emit("mine", origin);
    mine.update(0.2);
    const spread = mine.snapshot().map((p) => Math.hypot(p.x - origin.x, p.z - origin.z));
    expect(Math.min(...spread)).toBeGreaterThan(0.1);

    const craft = makeVfx();
    craft.emit("craft", origin);
    craft.update(0.3);
    for (const p of craft.snapshot()) expect(p.y).toBeGreaterThan(origin.y);
  });

  it("recycles the oldest particles when the 64-sprite pool is full", () => {
    const vfx = makeVfx();
    for (let i = 0; i < 9; i++) vfx.emit("collect", origin);
    expect(vfx.activeCount).toBe(64);
    vfx.update(0.1);
    vfx.emit("mine", new THREE.Vector3(0, 0, 0));
    expect(vfx.activeCount).toBe(64);
    const fresh = vfx.snapshot().filter((p) => p.opacity === 1);
    expect(fresh).toHaveLength(8);
  });
  it("emits distinct wood and leaf debris", () => {
    const wood = makeVfx();
    const leaves = makeVfx();
    const emit = (vfx: GameplayVfx, kind: GameplayVfxKind): void => vfx.emit(kind, origin);
    emit(wood, "wood");
    emit(leaves, "leaves");
    expect(wood.activeCount).toBeGreaterThan(0);
    expect(leaves.activeCount).toBeGreaterThan(0);
    wood.update(0.15);
    leaves.update(0.15);
    expect(wood.snapshot()).not.toEqual(leaves.snapshot());
  });

  it("spawns pollen when space exists but never replaces gameplay bursts", () => {
    const vfx = makeVfx();
    const emit = (kind: GameplayVfxKind, position: THREE.Vector3): void => vfx.emit(kind, position);
    emit("pollen", origin);
    expect(vfx.activeCount).toBeGreaterThan(0);

    const full = makeVfx();
    for (let i = 0; i < 8; i++) full.emit("collect", origin);
    const gameplay = full.snapshot();
    full.emit("pollen", new THREE.Vector3(0, 0, 0));
    expect(full.snapshot()).toEqual(gameplay);
  });

  it("emits dust after grounded travel, not while airborne", () => {
    const vfx = makeVfx();
    vfx.updateFootsteps("p1", new THREE.Vector3(0, 0, 0), true);
    vfx.updateFootsteps("p1", new THREE.Vector3(0.4, 0, 0), true);
    expect(vfx.activeCount).toBe(0);
    vfx.updateFootsteps("p1", new THREE.Vector3(0.9, 0, 0), true);
    expect(vfx.activeCount).toBeGreaterThan(0);

    const airborne = makeVfx();
    airborne.updateFootsteps("p1", new THREE.Vector3(0, 0, 0), false);
    airborne.updateFootsteps("p1", new THREE.Vector3(1, 0, 0), false);
    expect(airborne.activeCount).toBe(0);
  });

  it("is deterministic for the same seed and differs for another seed", () => {
    const run = (seed: number) => {
      const vfx = makeVfx(seed);
      vfx.emit("bounce", origin);
      vfx.update(0.2);
      return JSON.stringify(vfx.snapshot());
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });
});
