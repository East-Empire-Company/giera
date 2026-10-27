import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GameplayVfx, type GameplayVfxKind, type GameplayVfxTextures } from "../../src/client/effects/gameplay-vfx";

function makeVfx(seed = 424242): GameplayVfx {
  const textures: GameplayVfxTextures = {
    dirt01: new THREE.Texture(),
    dirt02: new THREE.Texture(),
    spark01: new THREE.Texture(),
    smoke01: new THREE.Texture(),
    star01: new THREE.Texture(),
  };
  return new GameplayVfx(new THREE.Scene(), seed, textures);
}

const origin = new THREE.Vector3(10, 20, 30);

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
