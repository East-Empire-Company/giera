import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { createHousePlan, placeHousePlan, type HouseWorld } from "../../src/client/game/house-builder";
import { CHUNK_SIZE, chunkKey } from "../../src/shared/chunk";
import { GameInventory, MAX_EDITS_PER_CHUNK } from "../../src/client/game/inventory";

const flatWorld = (occupied: ReadonlySet<string> = new Set()): HouseWorld => ({
  getBlock: (x, y, z) => y <= 40 ? BLOCK_ID.grass : occupied.has(`${x},${y},${z}`) ? BLOCK_ID.stone : BLOCK_ID.air,
  surfaceColumnTop: () => 40,
});

const player = { x: 0, y: 41, z: 0, yaw: Math.PI };
const mutableFlatWorld = () => {
  const edits = new Map<string, number>();
  const world: HouseWorld & { setBlock: (x: number, y: number, z: number, id: number) => void } = {
    getBlock: (x, y, z) => y <= 40 ? BLOCK_ID.grass : edits.get(`${x},${y},${z}`) ?? BLOCK_ID.air,
    surfaceColumnTop: () => 40,
    hasEdit: (x, y, z) => edits.has(`${x},${y},${z}`),
    setBlock: (x, y, z, id) => edits.set(`${x},${y},${z}`, id),
  };
  return { world, edits };
};

describe("Iskra house plans", () => {
  it("creates deterministic, bounded block houses from the seeded style choices", () => {
    const first = createHousePlan(flatWorld(), player, 424242);
    const repeat = createHousePlan(flatWorld(), player, 424242);

    expect(first).not.toBeNull();
    expect(first).toEqual(repeat);
    expect(first!.blocks.length).toBeGreaterThan(40);
    expect(first!.blocks.length).toBeLessThanOrEqual(150);
    expect(new Set(first!.blocks.map(({ x, y, z }) => `${x},${y},${z}`)).size).toBe(first!.blocks.length);
    expect(first!.blocks.every(({ y, id }) => y > 40 && id !== BLOCK_ID.air)).toBe(true);
  });
  it("builds a narrow lookout tower when Iskra requests that archetype", () => {
    const plan = createHousePlan(flatWorld(), player, 424242, undefined, "lookout_tower");
    expect(plan?.archetype).toBe("lookout_tower");
    expect(new Set(plan!.blocks.map(({ x }) => x)).size).toBeLessThanOrEqual(3);
    expect(new Set(plan!.blocks.map(({ z }) => z)).size).toBeLessThanOrEqual(3);
  });
  it("spans both footprint axes when the player faces the X axis", () => {
    const plan = createHousePlan(flatWorld(), { x: 0, z: 0, yaw: Math.PI / 2 }, 424242)!;

    expect(new Set(plan.blocks.map(({ x }) => x)).size).toBeGreaterThan(1);
    expect(new Set(plan.blocks.map(({ z }) => z)).size).toBeGreaterThan(1);
  });
  it("refuses occupied terrain and protected actor areas", () => {
    const occupiedWorld: HouseWorld = {
      getBlock: (_x, y) => y <= 40 ? BLOCK_ID.grass : BLOCK_ID.stone,
      surfaceColumnTop: () => 40,
    };

    expect(createHousePlan(occupiedWorld, player, 424242)).toBeNull();
    expect(createHousePlan(flatWorld(), player, 424242, () => true)).toBeNull();
  });
  it("places the full plan and records edit limits", () => {
    const { world, edits } = mutableFlatWorld();
    const plan = createHousePlan(world, player, 424242)!;
    const inventory = new GameInventory();

    expect(placeHousePlan(plan, world, inventory)).toBe(plan);
    expect(edits.size).toBe(plan.blocks.length);
    expect(Object.values(inventory.toJSON().chunkEdits).reduce((sum, count) => sum + count, 0)).toBe(plan.blocks.length);
  });

  it("does not partially overwrite a blocked house site or exceed a chunk edit limit", () => {
    const blocked = mutableFlatWorld();
    const plan = createHousePlan(blocked.world, player, 424242)!;
    const first = plan.blocks[0];
    blocked.world.setBlock(first.x, first.y, first.z, BLOCK_ID.stone);
    const editsBefore = blocked.edits.size;
    expect(placeHousePlan(plan, blocked.world, new GameInventory())).toBeNull();
    expect(blocked.edits.size).toBe(editsBefore);
    const editedAir = mutableFlatWorld();
    const editedPlan = createHousePlan(editedAir.world, player, 424242)!;
    const editedBlock = editedPlan.blocks[0];
    editedAir.world.setBlock(editedBlock.x, editedBlock.y, editedBlock.z, BLOCK_ID.air);
    expect(placeHousePlan(editedPlan, editedAir.world, new GameInventory())).toBeNull();
    expect(editedAir.edits.size).toBe(1);

    const limited = mutableFlatWorld();
    const chunk = chunkKey(Math.floor(first.x / CHUNK_SIZE), Math.floor(first.y / CHUNK_SIZE), Math.floor(first.z / CHUNK_SIZE));
    const inventory = new GameInventory({ chunkEdits: { [chunk]: MAX_EDITS_PER_CHUNK } });
    expect(placeHousePlan(plan, limited.world, inventory)).toBeNull();
    expect(limited.edits.size).toBe(0);
  });
});
