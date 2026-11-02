import { BLOCK_ID } from "../../shared/blocks";
import { CHUNK_SIZE, chunkKey } from "../../shared/chunk";
import type { HousePlan, HouseWorld } from "../../shared/house-plan";
import { MAX_EDITS_PER_CHUNK, type GameInventory } from "./inventory";
export function placeHousePlan(
  plan: HousePlan,
  world: HouseWorld & { setBlock(x: number, y: number, z: number, id: number): void },
  inventory: GameInventory
): HousePlan | null {
  const counts = new Map<string, number>();
  const savedCounts = inventory.toJSON().chunkEdits;
  for (const block of plan.blocks) {
    if (world.hasEdit?.(block.x, block.y, block.z) || world.getBlock(block.x, block.y, block.z) !== BLOCK_ID.air) return null;
    const key = chunkKey(Math.floor(block.x / CHUNK_SIZE), Math.floor(block.y / CHUNK_SIZE), Math.floor(block.z / CHUNK_SIZE));
    const count = (counts.get(key) ?? 0) + 1;
    if ((savedCounts[key] ?? 0) + count > MAX_EDITS_PER_CHUNK) return null;
    counts.set(key, count);
  }
  for (const block of plan.blocks) {
    world.setBlock(block.x, block.y, block.z, block.id);
    inventory.recordChunkEdit(chunkKey(Math.floor(block.x / CHUNK_SIZE), Math.floor(block.y / CHUNK_SIZE), Math.floor(block.z / CHUNK_SIZE)));
  }
  return plan;
}
