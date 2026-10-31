import { describe, expect, it } from "vitest";
import { sweepAABB } from "../../src/shared/physics";

describe("AABB sweep", () => {
  it("does not tunnel through a wall at high velocity", () => {
    const result = sweepAABB((x, y, z) => x === 2 && y >= 1 && y <= 2 && z === 0, { minX: 0.2, minY: 1, minZ: 0.2, maxX: 0.8, maxY: 2.8, maxZ: 0.8 }, { x: 5, y: 0, z: 0 });
    expect(result.position.x + 0.6).toBeLessThanOrEqual(2.0001);
    expect(result.hitAxis).toBe("x");
  });

  it("lands on a floor without crossing it", () => {
    const result = sweepAABB((_x, y, _z) => y === 0, { minX: 0.2, minY: 1.2, minZ: 0.2, maxX: 0.8, maxY: 3, maxZ: 0.8 }, { x: 0, y: -1, z: 0 });
    expect(result.position.y).toBeGreaterThanOrEqual(1);
    expect(result.onGround).toBe(true);
    expect(result.hitAxis).toBe("y");
  });
});
