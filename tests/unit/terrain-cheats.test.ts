import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { CHUNK_SIZE, chunkKey } from "../../src/shared/chunk";
import { applyMinePlan, createMinePlan, type MinePlan } from "../../src/client/game/terrain-cheats";
import { GameInventory, MAX_EDITS_PER_CHUNK } from "../../src/client/game/inventory";

describe("Iskra mine planning", () => {
  it("plans a bounded tunnel through untouched natural blocks only", () => {
    const edited: Record<string, true> = { "0,41,8": true };
    const world = {
      getBlock: (x: number, y: number, z: number) => {
        if (edited[`${x},${y},${z}`]) return BLOCK_ID.stone;
        return y >= 40 && y <= 43 && x >= -2 && x <= 2 && z >= 0 && z <= 12 ? BLOCK_ID.stone : BLOCK_ID.air;
      },
      hasEdit: (x: number, y: number, z: number) => Boolean(edited[`${x},${y},${z}`]),
    };
    const plan = createMinePlan(world, { x: 0.5, y: 41, z: 0.5, yaw: Math.PI });
    expect(plan).not.toBeNull();
    expect(plan!.blocks.length).toBeGreaterThanOrEqual(6);
    expect(plan!.blocks.length).toBeLessThanOrEqual(32);
    expect(plan!.blocks.every((block) => block.id === BLOCK_ID.stone)).toBe(true);
    expect(plan!.blocks.some((block) => `${block.x},${block.y},${block.z}` === "0,41,1")).toBe(true);
    expect(plan!.blocks.some((block) => `${block.x},${block.y},${block.z}` === "0,41,8")).toBe(false);
  });
  it("stops before wood, water, and bedrock", () => {
    for (const blocker of [BLOCK_ID.oak_log, BLOCK_ID.water, BLOCK_ID.bedrock]) {
      const world = {
        getBlock: (x: number, y: number, z: number) =>
          x === 0 && y === 41 && z === 3
            ? blocker
            : y >= 40 && y <= 43 && x >= -2 && x <= 2 && z >= 0 && z <= 12
              ? BLOCK_ID.stone
              : BLOCK_ID.air,
        hasEdit: () => false,
      };
      const plan = createMinePlan(world, { x: 0.5, y: 41, z: 0.5, yaw: Math.PI });

      expect(plan).not.toBeNull();
      expect(plan!.blocks.every((block) => block.z < 3)).toBe(true);
    }
  });

  it("declines excavation when natural terrain provides too few blocks", () => {
    const world = { getBlock: () => BLOCK_ID.air, hasEdit: () => false };
    expect(createMinePlan(world, { x: 0.5, y: 41, z: 0.5, yaw: Math.PI })).toBeNull();
  });

  it("applies edits only when every planned block still matches untouched terrain", () => {
    const blocks: MinePlan["blocks"] = [
      { x: 1, y: 41, z: 1, id: BLOCK_ID.stone },
      { x: 2, y: 41, z: 1, id: BLOCK_ID.dirt },
    ];
    const plan = { blocks, entrance: { x: 1, z: 1 } };
    const terrain = new Map<string, number>(blocks.map((block) => [`${block.x},${block.y},${block.z}`, block.id]));
    const edited = new Set<string>();
    const world = {
      getBlock: (x: number, y: number, z: number) => terrain.get(`${x},${y},${z}`) ?? BLOCK_ID.air,
      hasEdit: (x: number, y: number, z: number) => edited.has(`${x},${y},${z}`),
      setBlock: (x: number, y: number, z: number, id: number) => { terrain.set(`${x},${y},${z}`, id); },
    };
    const inventory = new GameInventory();

    terrain.set("2,41,1", BLOCK_ID.oak_log);
    expect(applyMinePlan(plan, world, inventory)).toBeNull();
    expect(terrain.get("1,41,1")).toBe(BLOCK_ID.stone);
    expect(inventory.toJSON().chunkEdits).toEqual({});

    terrain.set("2,41,1", BLOCK_ID.dirt);
    edited.add("2,41,1");
    expect(applyMinePlan(plan, world, inventory)).toBeNull();
    expect(terrain.get("1,41,1")).toBe(BLOCK_ID.stone);
  });

  it("declines plans that exceed a chunk's saved edit limit", () => {
    const plan: MinePlan = {
      blocks: [
        { x: 1, y: 41, z: 1, id: BLOCK_ID.stone },
        { x: 2, y: 41, z: 1, id: BLOCK_ID.stone },
      ],
      entrance: { x: 1, z: 1 },
    };
    const key = chunkKey(Math.floor(1 / CHUNK_SIZE), Math.floor(41 / CHUNK_SIZE), Math.floor(1 / CHUNK_SIZE));
    const inventory = new GameInventory({ chunkEdits: { [key]: MAX_EDITS_PER_CHUNK - 1 } });
    const terrain = new Map<string, number>(plan.blocks.map((block) => [`${block.x},${block.y},${block.z}`, block.id]));
    const world = {
      getBlock: (x: number, y: number, z: number) => terrain.get(`${x},${y},${z}`) ?? BLOCK_ID.air,
      hasEdit: () => false,
      setBlock: (x: number, y: number, z: number, id: number) => { terrain.set(`${x},${y},${z}`, id); },
    };

    expect(applyMinePlan(plan, world, inventory)).toBeNull();
    expect(terrain.get("1,41,1")).toBe(BLOCK_ID.stone);
  });
});
