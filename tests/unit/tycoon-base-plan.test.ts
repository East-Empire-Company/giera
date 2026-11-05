import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { baseStagePlan, HQ_DISPENSERS, HQ_ELEVATOR, HQ_FOOTPRINT } from "../../src/shared/tycoon-base-plan";

describe("HQ stage plans", () => {
  it("builds a same-height foundation inside the footprint", () => {
    const floor = baseStagePlan(0);
    expect(floor).toHaveLength(13 * 9);
    expect(floor.every((op) => op.y === 0 && op.id === BLOCK_ID.hero_floor && op.kind === "surface")).toBe(true);
    expect(floor.every((op) => op.x >= HQ_FOOTPRINT.minX && op.x <= HQ_FOOTPRINT.maxX && op.z >= 0 && op.z <= 8)).toBe(true);
  });

  it("keeps a two-block entrance and exactly one upper shaft opening", () => {
    const shell = baseStagePlan(1);
    expect(shell.some((op) => op.z === 0 && (op.x === -1 || op.x === 0) && (op.y === 1 || op.y === 2))).toBe(false);
    const upper = baseStagePlan(2);
    const floor = upper.filter((op) => op.y === 4);
    expect(floor).toHaveLength(13 * 9 - 1);
    expect(floor.some((op) => op.x === HQ_ELEVATOR.x && op.z === HQ_ELEVATOR.z)).toBe(false);
    expect(floor.some((op) => op.x === 1 && op.z === 3)).toBe(true);
  });

  it("defines four block dispensers and three gear dispensers at their art positions", () => {
    expect(HQ_DISPENSERS).toHaveLength(7);
    expect(HQ_DISPENSERS.filter((dispenser) => dispenser.stage === 4).map((dispenser) => [dispenser.item, dispenser.count, dispenser.x, dispenser.z])).toEqual([
      ["hero_floor", 8, -5, 7],
      ["hero_wall", 8, -3, 7],
      ["hero_glass", 8, -1, 7],
      ["neon_block", 8, 1, 7],
    ]);
    expect(HQ_DISPENSERS.filter((dispenser) => dispenser.stage === 5).map((dispenser) => [dispenser.item, dispenser.x, dispenser.z])).toEqual([
      ["star_pickaxe", -6, 2],
      ["star_axe", -6, 4],
      ["pulse_sword", -6, 7],
    ]);
  });

  it("is deterministic and has no duplicate coordinates within a stage", () => {
    for (let stage = 0; stage < 6; stage++) {
      expect(baseStagePlan(stage)).toEqual(baseStagePlan(stage));
      const keys = baseStagePlan(stage).map((op) => `${op.x},${op.y},${op.z}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
