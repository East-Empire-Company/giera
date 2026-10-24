import { describe, expect, it } from "vitest";
import { raycastVoxels } from "../../src/shared/raycast";

describe("voxel raycast", () => {
  it("returns the first hit, entry normal and distance", () => {
    const hit = raycastVoxels({ x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 5, (x, y, z) => x === 2 && y === 0 && z === 0 ? 2 : 0);
    expect(hit).toEqual({ hit: { x: 2, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 }, distance: 1.5 });
  });

  it("returns null when no occupied voxel lies within range", () => {
    expect(raycastVoxels({ x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 0 }, 3, () => 0)).toBeNull();
  });
});
