import { describe, expect, it } from "vitest";
import { raycastInteract, raycastVoxels } from "../../src/shared/raycast";

describe("voxel raycast", () => {
  it("returns the first hit, entry normal and distance", () => {
    const hit = raycastVoxels({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5, (x, y, z) => x === 2 && y === 0 && z === 0 ? 2 : 0);
    expect(hit).toEqual({ hit: { x: 2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, distance: 1.5 });
  });

  it("returns null when no occupied voxel lies within range", () => {
    expect(raycastVoxels({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }, 3, () => 0)).toBeNull();
  });

  it("hits from the negative x and from above", () => {
    const wall = (x: number, y: number, z: number) => (x === -2 && y === 0 && z === 0) || (x === 0 && y === 3 && z === 0) ? 1 : 0;
    expect(raycastVoxels({ x: 0.5, y: 0.5, z: 0.5 }, { x: -1, y: 0, z: 0 }, 5, wall)?.hit).toEqual({ x: -2, y: 0, z: 0 });
    expect(raycastVoxels({ x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 1, z: 0 }, 5, wall)?.normal).toEqual({ x: 0, y: -1, z: 0 });
  });

  it("reports the voxel the ray starts inside and rejects a zero direction", () => {
    expect(raycastVoxels({ x: 0.2, y: 0.2, z: 0.2 }, { x: 1, y: 0, z: 0 }, 4, () => 1)).toEqual({
      hit: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 0, z: 0 },
      distance: 0,
    });
    expect(raycastVoxels({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 4, () => 1)).toBeNull();
  });

  it("skips the voxel the ray starts inside", () => {
    const hit = raycastInteract({ x: 0.2, y: 0.2, z: 0.2 }, { x: 1, y: 0, z: 0 }, 5, (x, y, z) => (x === 0 || x === 2) && y === 0 && z === 0 ? 1 : 0);
    expect(hit).toEqual({ hit: { x: 2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, distance: 1.8 });
  });

  it("starts at the head plane so foliage between camera and player cannot block the reach", () => {
    const world = (x: number, y: number, z: number) => (y === 0 && z === 0 && (x === 2 || x === 7) ? 8 : 0) || (y === 0 && z === 0 && x === 9 ? 7 : 0);
    const camera = { x: 0.5, y: 0.5, z: 0.5 };
    const right = { x: 1, y: 0, z: 0 };
    expect(raycastInteract(camera, right, 12, world)?.hit).toEqual({ x: 2, y: 0, z: 0 });
    const hit = raycastInteract(camera, right, 12, world, { x: 6, y: 2, z: 0.5 });
    expect(hit?.hit).toEqual({ x: 7, y: 0, z: 0 });
    expect(hit?.distance).toBeCloseTo(6.5, 6);
  });

  it("keeps the original far reach endpoint when skipping to the head plane", () => {
    const far = (x: number, y: number, z: number) => (y === 0 && z === 0 && x === 13 ? 7 : 0);
    expect(raycastInteract({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 12, far, { x: 6, y: 0.5, z: 0.5 })).toBeNull();
  });
});
