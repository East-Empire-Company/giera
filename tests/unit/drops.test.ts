import { describe, expect, it } from "vitest";
import { ItemDropManager } from "../../src/client/entities/drops";
import { makeRng } from "../../src/shared/rng";

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

  it("collects a drop once the player reaches it", () => {
    const manager = new ItemDropManager();
    manager.spawn(10, 40, 10, 3);

    const collected: number[] = [];
    const onCollect = (drop: { blockId: number }) => collected.push(drop.blockId);

    manager.update(0.1, { x: 10, y: 40, z: 10 }, onCollect);
    expect(collected).toEqual([]);

    manager.update(0.2, { x: 10, y: 40, z: 10 }, onCollect);
    expect(collected).toEqual([3]);
    expect(manager.drops.length).toBe(0);
  });

  it("pulls a nearby drop toward the player", () => {
    const manager = new ItemDropManager({ rng: makeRng(7) });
    const drop = manager.spawn(12, 40, 10, 3);

    manager.update(0.1, { x: 10, y: 40, z: 10 });
    manager.update(0.3, { x: 10, y: 40, z: 10 });

    expect(drop.position.x).toBeLessThan(12);
  });

  it("despawns drops older than 60 seconds", () => {
    const manager = new ItemDropManager();
    manager.spawn(10, 40, 10, 3);

    manager.update(61, { x: 1000, y: 40, z: 1000 });

    expect(manager.drops.length).toBe(0);
  });

  it("produces identical drops for identical seeded rng", () => {
    const first = new ItemDropManager({ rng: makeRng(1337) }).spawn(0, 40, 0, 3);
    const second = new ItemDropManager({ rng: makeRng(1337) }).spawn(0, 40, 0, 3);
    const other = new ItemDropManager({ rng: makeRng(2026) }).spawn(0, 40, 0, 3);

    expect(first.velocity.toArray()).toEqual(second.velocity.toArray());
    expect(first.rotation.toArray()).toEqual(second.rotation.toArray());
    expect(first.velocity.toArray()).not.toEqual(other.velocity.toArray());
  });
});
