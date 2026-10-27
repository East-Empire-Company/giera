import { describe, expect, it } from "vitest";
import { blockedByCylinders, pushOutOfCylinders } from "../../src/shared/entity-collision";

const npc = { x: 0, y: 60, z: 0, radius: 0.4, height: 1.8 };

describe("cylinder collision", () => {
  it("pushes an overlapping body out to the contact distance along the line of centres", () => {
    const r = pushOutOfCylinders({ x: 0.3, y: 60, z: 0 }, 0.3, 1.8, [npc]);
    expect(r.pushed).toBe(true);
    expect(r.x).toBeCloseTo(0.7, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it("ignores bodies that do not overlap horizontally or vertically", () => {
    expect(pushOutOfCylinders({ x: 2, y: 60, z: 0 }, 0.3, 1.8, [npc]).pushed).toBe(false);
    expect(pushOutOfCylinders({ x: 0.2, y: 62, z: 0 }, 0.3, 1.8, [npc]).pushed).toBe(false);
  });

  it("reports a blocked step", () => {
    expect(blockedByCylinders(0.5, 0, 60, 0.3, 1.8, [npc])).toBe(true);
    expect(blockedByCylinders(1.5, 0, 60, 0.3, 1.8, [npc])).toBe(false);
  });
});
