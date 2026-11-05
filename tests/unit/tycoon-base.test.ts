import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { TycoonBase, type BaseWorld } from "../../src/client/game/tycoon-base";

const origin = { x: 100, y: 60, z: 100 };
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;

function fakeWorld() {
  const edits = new Map<string, number>();
  const writes: { x: number; y: number; z: number; id: number }[] = [];
  const generated = (_x: number, y: number, _z: number): number => y === origin.y ? BLOCK_ID.grass : BLOCK_ID.air;
  const world: BaseWorld = {
    getBlock: (x, y, z) => edits.get(key(x, y, z)) ?? generated(x, y, z),
    getGeneratedBlock: generated,
    hasEdit: (x, y, z) => edits.has(key(x, y, z)),
    setBlock: (x, y, z, id) => {
      edits.set(key(x, y, z), id);
      writes.push({ x, y, z, id });
    },
  };
  return { world, edits, writes };
}

describe("TycoonBase", () => {
  it("blocks an obstructed purchase before any write", () => {
    const { world, writes } = fakeWorld();
    world.setBlock(origin.x, origin.y, origin.z, BLOCK_ID.planks);
    writes.length = 0;
    const base = new TycoonBase(origin, world);

    expect(base.preflight(0)).toBe(false);
    expect(base.start(0)).toBe(false);
    expect(writes).toHaveLength(0);
  });

  it("writes four foundation operations per simulation update", () => {
    const { world, writes } = fakeWorld();
    const base = new TycoonBase(origin, world);

    expect(base.start(0)).toBe(true);
    base.update(1 / 60);
    expect(writes).toHaveLength(4);
    expect(writes.every((write) => write.id === BLOCK_ID.hero_floor && write.y === origin.y)).toBe(true);
  });

  it("refreshes ground decor once when animated construction finishes", () => {
    const { world, writes } = fakeWorld();
    let refreshes = 0;
    world.refreshDecor = () => { refreshes++; };
    const base = new TycoonBase(origin, world);

    expect(base.start(0)).toBe(true);
    for (let update = 0; update < 29; update++) base.update(1 / 60);
    expect(writes).toHaveLength(116);
    expect(refreshes).toBe(0);
    base.update(1 / 60);
    expect(writes).toHaveLength(117);
    expect(refreshes).toBe(1);
    base.update(1 / 60);
    expect(refreshes).toBe(1);
  });

  it("restores a legacy owned foundation immediately and idempotently", () => {
    const { world, writes } = fakeWorld();
    const base = new TycoonBase(origin, world);

    base.restore([0]);
    expect(writes).toHaveLength(13 * 9);
    expect(world.getBlock(origin.x, origin.y, origin.z)).toBe(BLOCK_ID.hero_floor);
    base.restore([0]);
    expect(writes).toHaveLength(13 * 9);
  });

  it("preserves a foreign player block and records a diagnostic", () => {
    const { world, writes } = fakeWorld();
    world.setBlock(origin.x, origin.y, origin.z, BLOCK_ID.planks);
    writes.length = 0;
    const base = new TycoonBase(origin, world);

    base.restore([0]);
    expect(world.getBlock(origin.x, origin.y, origin.z)).toBe(BLOCK_ID.planks);
    expect(writes).toHaveLength(13 * 9 - 1);
    expect(base.diagnostics.some((line) => line.includes("0,0,0"))).toBe(true);
  });
});
