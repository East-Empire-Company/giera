import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { createHousePlan } from "../../src/shared/house-plan";

type HouseWorld = {
  getBlock(x: number, y: number, z: number): number;
  surfaceColumnTop(x: number, z: number): number;
};

const flatWorld: HouseWorld = {
  getBlock: (_x, y) => y <= 40 ? BLOCK_ID.grass : BLOCK_ID.air,
  surfaceColumnTop: () => 40,
};
const player = { x: 0, z: 0, yaw: Math.PI };

describe("shared house plans", () => {
  it.each([424242, 7])("creates a deterministic bounded plan for seed %i", (seed) => {
    const first = createHousePlan(flatWorld, player, seed);
    const repeat = createHousePlan(flatWorld, player, seed);

    expect(first).not.toBeNull();
    expect(first).toEqual(repeat);
    expect(first!.blocks.length).toBeLessThanOrEqual(150);
    expect(first!.blocks.every(({ id }) => id !== BLOCK_ID.air)).toBe(true);
  });

  it("supports both explicit archetypes with deterministic placement order", () => {
    const cabin = createHousePlan(flatWorld, player, 7, undefined, "cabin");
    const tower = createHousePlan(flatWorld, player, 7, undefined, "lookout_tower");

    expect(cabin?.archetype).toBe("cabin");
    expect(tower?.archetype).toBe("lookout_tower");
    expect(cabin).toEqual(createHousePlan(flatWorld, player, 7, undefined, "cabin"));
    expect(tower).toEqual(createHousePlan(flatWorld, player, 7, undefined, "lookout_tower"));
    expect(new Set(tower!.blocks.map(({ x, y, z }) => `${x},${y},${z}`)).size).toBe(tower!.blocks.length);
  });
});
