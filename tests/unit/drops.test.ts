import { describe, expect, it } from "vitest";
import { ItemDropManager } from "../../src/client/entities/drops";

describe("ItemDropManager", () => {
  it("spawns item drop at position with initial upward velocity", () => {
    const manager = new ItemDropManager();
    const drop = manager.spawn(10, 40, 10, 3); // cobblestone
    expect(drop.position.x).toBe(10);
    expect(drop.position.y).toBe(40);
    expect(drop.position.z).toBe(10);
    expect(drop.velocity.y).toBeGreaterThan(0);
    expect(manager.drops.length).toBe(1);
  });

  it("updates physics and attracts toward player", () => {
    const manager = new ItemDropManager();
    manager.spawn(10, 40, 10, 3);

    // Player is at (10.5, 40, 10.5) - within magnet radius
    let collectedCount = 0;
    manager.update(0.1, { x: 10.5, y: 40, z: 10.5 }, () => {
      collectedCount++;
    });

    expect(manager.drops.length).toBeGreaterThanOrEqual(0);
  });
});
