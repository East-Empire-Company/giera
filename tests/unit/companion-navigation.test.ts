import { describe, expect, it } from "vitest";
import { pickScoutTarget, planPath } from "../../src/shared/companion-navigation";

const flatWorld = (_x: number, y: number, _z: number): number => (y < 1 ? 1 : 0);
const basePlan = (options: Partial<Parameters<typeof planPath>[0]> = {}) => planPath({
  world: flatWorld,
  isLoaded: () => true,
  blocked: () => false,
  from: { x: 0, y: 1, z: 0 },
  goal: null,
  ...options,
});

describe("planPath", () => {
  it("routes around cylinder-style blockers", () => {
    const result = basePlan({
      goal: { x: 2, y: 1, z: 0 },
      blocked: (x, y, z) => x === 1 && y === 1 && z === 0,
    });

    expect(result).toEqual({
      status: "ok",
      cells: [
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 },
        { x: 2, y: 1, z: 1 },
        { x: 2, y: 1, z: 0 },
      ],
    });
  });

  it("uses fixed neighbor order when routes have equal length", () => {
    const first = basePlan({ goal: { x: 1, y: 1, z: 1 } });
    const second = basePlan({ goal: { x: 1, y: 1, z: 1 } });

    expect(first).toEqual(second);
    expect(first.cells).toEqual([
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 1, y: 1, z: 1 },
    ]);
  });

  it("limits expansion to the requested state count", () => {
    const result = basePlan({ goal: { x: 1, y: 1, z: 0 }, maxStates: 1 });

    expect(result).toEqual({ status: "unreachable", cells: [{ x: 0, y: 1, z: 0 }] });
  });

  it("reports unloaded terrain when a route reaches an unloaded boundary", () => {
    const result = basePlan({
      goal: { x: 1, y: 1, z: 0 },
      isLoaded: (x) => x <= 0,
    });

    expect(result.status).toBe("terrain_unloaded");
  });

  it("reports no_goal when neither a destination nor follow target exists", () => {
    expect(basePlan()).toEqual({ status: "no_goal", cells: [] });
  });

  it("steps up and down by one block between standable cells", () => {
    const heights = new Map([[0, 1], [1, 2], [2, 1]]);
    const result = basePlan({
      from: { x: 0, y: 1, z: 0 },
      goal: { x: 2, y: 1, z: 0 },
      world: (x, y, z) => (z === 0 && y < (heights.get(x) ?? -100) ? 1 : 0),
      blocked: (_x, _y, z) => z !== 0,
    });

    expect(result).toEqual({
      status: "ok",
      cells: [
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 2, z: 0 },
        { x: 2, y: 1, z: 0 },
      ],
    });
  });

  it("returns a reachable intermediate cell when follow target is beyond range", () => {
    const result = basePlan({ followTarget: { x: 20.5, y: 1, z: 0 } });

    expect(result.status).toBe("unreachable");
    expect(result.cells.at(-1)).toEqual({ x: 12, y: 1, z: 0 });
  });
});

describe("pickScoutTarget", () => {
  it("picks the nearest caller-supplied candidate", () => {
    const candidates = [
      { x: 4, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 1, z: 0 },
    ];

    expect(pickScoutTarget(candidates, { x: 0, y: 1, z: 0 })).toEqual({ x: 1, y: 1, z: 0 });
  });

  it("breaks equal scorer results by lowest y, x, then z", () => {
    const candidates = [
      { x: 2, y: 3, z: 0 },
      { x: 0, y: 2, z: 1 },
      { x: -1, y: 2, z: 0 },
      { x: 0, y: 2, z: -1 },
    ];

    expect(pickScoutTarget(candidates, { x: 0, y: 1, z: 0 }, () => 1)).toEqual({ x: -1, y: 2, z: 0 });
  });
});
