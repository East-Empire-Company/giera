import { describe, expect, it } from "vitest";
import { TrainingDummy } from "../../src/client/entities/dummy";

describe("TrainingDummy", () => {
  it("initializes upright with zero wobble", () => {
    const dummy = new TrainingDummy({ x: 2, y: 50, z: 2 });
    expect(dummy.wobbleAngle).toBe(0);
  });

  it("wobbles on hit and dampens back toward zero over time", () => {
    const dummy = new TrainingDummy({ x: 2, y: 50, z: 2 });
    dummy.hit();
    expect(Math.abs(dummy.wobbleAngle)).toBeGreaterThan(0.3);

    for (let i = 0; i < 40; i++) {
      dummy.update(0.05);
    }
    expect(Math.abs(dummy.wobbleAngle)).toBeLessThan(0.05);
  });
});
