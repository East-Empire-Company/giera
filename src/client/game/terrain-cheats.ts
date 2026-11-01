import { BLOCK_ID, type BlockId } from "../../shared/blocks";
import { CHUNK_SIZE, chunkKey, WORLD_HEIGHT } from "../../shared/chunk";
import { MAX_EDITS_PER_CHUNK, type GameInventory } from "./inventory";

export type MinePlan = {
  blocks: { x: number; y: number; z: number; id: BlockId }[];
  entrance: { x: number; z: number };
};

export type MineWorld = {
  getBlock: (x: number, y: number, z: number) => number;
  hasEdit: (x: number, y: number, z: number) => boolean;
};

const MINE_LENGTH = 8;
const MINE_WIDTH = 2;
const MINE_HEIGHT = 2;
const MAX_MINE_BLOCKS = 32;
const MIN_MINE_BLOCKS = 6;
const MINEABLE_BLOCKS: Record<number, true> = {
  [BLOCK_ID.stone]: true,
  [BLOCK_ID.dirt]: true,
  [BLOCK_ID.grass]: true,
  [BLOCK_ID.sand]: true,
  [BLOCK_ID.coal_ore]: true,
  [BLOCK_ID.iron_ore]: true,
  [BLOCK_ID.gold_ore]: true,
};

export function createMinePlan(
  world: MineWorld,
  player: { x: number; y: number; z: number; yaw: number },
  occupied?: (x: number, z: number, radius: number) => boolean
): MinePlan | null {
  if (![player.x, player.y, player.z, player.yaw].every(Number.isFinite)) return null;

  const facingX = -Math.sin(player.yaw);
  const facingZ = -Math.cos(player.yaw);
  const forwardX = Math.abs(facingX) > Math.abs(facingZ) ? Math.sign(facingX) : 0;
  const forwardZ = forwardX === 0 ? Math.sign(facingZ) : 0;
  if (forwardX === 0 && forwardZ === 0) return null;

  const sideX = -forwardZ;
  const sideZ = forwardX;
  const baseX = Math.floor(player.x);
  const baseZ = Math.floor(player.z);
  const floorY = Math.floor(player.y) - 1;
  const blocks: MinePlan["blocks"] = [];

  for (let distance = 1; distance <= MINE_LENGTH; distance++) {
    const section: MinePlan["blocks"] = [];
    let blocked = false;
    for (let lane = 0; lane < MINE_WIDTH && !blocked; lane++) {
      const x = baseX + forwardX * distance + sideX * lane;
      const z = baseZ + forwardZ * distance + sideZ * lane;
      if (occupied?.(x + 0.5, z + 0.5, 0.35)) {
        blocked = true;
        break;
      }
      for (let height = 1; height <= MINE_HEIGHT; height++) {
        const y = floorY - height + 1;
        if (y < 1 || y >= WORLD_HEIGHT - 1 || world.hasEdit(x, y, z)) {
          blocked = true;
          break;
        }
        const id = world.getBlock(x, y, z);
        if (id === BLOCK_ID.air) continue;
        if (!MINEABLE_BLOCKS[id]) {
          blocked = true;
          break;
        }
        section.push({ x, y, z, id: id as BlockId });
      }
    }
    if (blocked) break;
    for (const block of section) {
      if (blocks.length >= MAX_MINE_BLOCKS) break;
      blocks.push(block);
    }
  }

  if (blocks.length < MIN_MINE_BLOCKS) return null;
  return {
    blocks,
    entrance: { x: baseX + forwardX, z: baseZ + forwardZ },
  };
}
export function applyMinePlan(
  plan: MinePlan,
  world: MineWorld & { setBlock(x: number, y: number, z: number, id: number): void },
  inventory: GameInventory
): MinePlan | null {
  const counts = new Map<string, number>();
  const savedCounts = inventory.toJSON().chunkEdits;
  for (const block of plan.blocks) {
    if (world.hasEdit(block.x, block.y, block.z) || world.getBlock(block.x, block.y, block.z) !== block.id) return null;
    const key = chunkKey(
      Math.floor(block.x / CHUNK_SIZE),
      Math.floor(block.y / CHUNK_SIZE),
      Math.floor(block.z / CHUNK_SIZE)
    );
    const count = (counts.get(key) ?? 0) + 1;
    if ((savedCounts[key] ?? 0) + count > MAX_EDITS_PER_CHUNK) return null;
    counts.set(key, count);
  }

  for (const block of plan.blocks) {
    world.setBlock(block.x, block.y, block.z, BLOCK_ID.air);
    inventory.recordChunkEdit(
      chunkKey(
        Math.floor(block.x / CHUNK_SIZE),
        Math.floor(block.y / CHUNK_SIZE),
        Math.floor(block.z / CHUNK_SIZE)
      )
    );
  }
  return plan;
}
