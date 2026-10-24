import { describe, expect, it } from "vitest";
import { PlayerController } from "../../src/client/entities/player";
import type { AABB } from "../../src/shared/physics";

describe("PlayerController", () => {
  it("initializes player at spawn with default head pivot and camera arm", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 45, 0] });
    expect(player.position.x).toBe(0);
    expect(player.position.y).toBe(45);
    expect(player.position.z).toBe(0);
    expect(player.yaw).toBe(Math.PI);
    expect(player.pitch).toBe(0);
  });

  it("clamps camera pitch within ±85 degrees", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 45, 0] });
    player.rotateCamera(0, 2.0); // > 85 deg (~1.48 rad)
    expect(player.pitch).toBeLessThanOrEqual(1.484);

    player.rotateCamera(0, -5.0);
    expect(player.pitch).toBeGreaterThanOrEqual(-1.484);
  });

  it("calculates third-person camera target with arm offset", () => {
    const player = new PlayerController({ id: "p1", spawn: [10, 40, 20] });
    const target = player.getCameraTarget();
    expect(target.x).toBeCloseTo(10, 1);
    expect(target.y).toBeCloseTo(41.55, 1);
    expect(target.z).toBeCloseTo(20, 1);
  });

  it("computes player bounding box correctly", () => {
    const player = new PlayerController({ id: "p1", spawn: [10, 40, 20] });
    const box = player.getBoundingBox();
    expect(box.minX).toBeCloseTo(9.7, 1);
    expect(box.maxX).toBeCloseTo(10.3, 1);
    expect(box.minY).toBeCloseTo(40, 1);
    expect(box.maxY).toBeCloseTo(41.8, 1);
  });

  it("respawns player at spawn coordinates when falling below y < -20", () => {
    const player = new PlayerController({ id: "p1", spawn: [0, 50, 0] });
    player.position.y = -21;
    player.step(0.05, () => false, { forward: 0, right: 0, jump: false, sprint: false });
    expect(player.position.y).toBe(50);
    expect(player.position.x).toBe(0);
    expect(player.position.z).toBe(0);
    expect(player.velocity.y).toBe(0);
  });
});
