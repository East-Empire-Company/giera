import { BLOCK_ID, type BlockId } from "../../shared/blocks";
import { makeRng } from "../../shared/rng";
import { WORLD_HEIGHT } from "../../shared/chunk";
import { CHUNK_SIZE, chunkKey } from "../../shared/chunk";
import { MAX_EDITS_PER_CHUNK, type GameInventory } from "./inventory";

export type HouseWorld = {
  getBlock(x: number, y: number, z: number): number;
  surfaceColumnTop(x: number, z: number): number;
};

export type HousePlan = {
  blocks: { x: number; y: number; z: number; id: BlockId }[];
  center: { x: number; z: number };
  style: "wood" | "stone";
};

const MAX_HOUSE_BLOCKS = 150;

export function createHousePlan(
  world: HouseWorld,
  player: { x: number; z: number; yaw: number },
  seed: number,
  occupied?: (x: number, z: number, radius: number) => boolean
): HousePlan | null {
  if (![player.x, player.z, player.yaw, seed].every(Number.isFinite)) return null;
  const rng = makeRng(seed);
  const facingX = -Math.sin(player.yaw);
  const facingZ = -Math.cos(player.yaw);
  const forwardX = Math.abs(facingX) > Math.abs(facingZ) ? Math.sign(facingX) : 0;
  const forwardZ = forwardX === 0 ? Math.sign(facingZ) : 0;
  const sideX = -forwardZ;
  const sideZ = forwardX;
  const width = 4 + Math.floor(rng() * 2);
  const depth = 4 + Math.floor(rng() * 2);
  const wallHeight = 3 + Math.floor(rng() * 2);
  const roofLayers = 1 + Math.floor(rng() * 2);
  const style = rng() < 0.5 ? "wood" : "stone";
  const floorId = style === "wood" ? BLOCK_ID.planks : BLOCK_ID.cobblestone;
  const wallId = style === "wood" ? BLOCK_ID.planks : BLOCK_ID.stone;
  const cornerId = style === "wood" ? BLOCK_ID.oak_log : BLOCK_ID.cobblestone;
  const roofId = style === "wood" ? BLOCK_ID.oak_log : BLOCK_ID.cobblestone;
  const offsets = [0, -4, 4, -8, 8];
  const start = Math.floor(rng() * offsets.length);
  const halfWidth = Math.floor(width / 2);
  const halfDepth = Math.floor(depth / 2);
  const radius = Math.hypot(width, depth) * 0.5;

  for (let distance = 7; distance <= 11; distance += 2) {
    for (let candidate = 0; candidate < offsets.length; candidate++) {
      const side = offsets[(candidate + start) % offsets.length];
      const centerX = Math.round(player.x + forwardX * distance + sideX * side);
      const centerZ = Math.round(player.z + forwardZ * distance + sideZ * side);
      if (occupied?.(centerX, centerZ, radius)) continue;
      const xAt = (column: number): number => centerX + sideX * (column - halfWidth);
      const zAt = (row: number): number => centerZ - forwardZ * (row - halfDepth);
      let floorY = -Infinity;
      let lowestY = Infinity;
      let flat = true;
      for (let column = 0; column < width; column++) {
        for (let row = 0; row < depth; row++) {
          const y = world.surfaceColumnTop(xAt(column), zAt(row));
          if (!Number.isFinite(y)) {
            flat = false;
            break;
          }
          floorY = Math.max(floorY, y + 1);
          lowestY = Math.min(lowestY, y + 1);
        }
        if (!flat) break;
      }
      if (!flat || floorY - lowestY > 1 || floorY + wallHeight + roofLayers >= WORLD_HEIGHT) continue;

      const blocks: HousePlan["blocks"] = [];
      const add = (column: number, y: number, row: number, id: BlockId): void => {
        blocks.push({ x: xAt(column), y, z: zAt(row), id });
      };
      for (let column = 0; column < width; column++) {
        for (let row = 0; row < depth; row++) {
          const groundY = world.surfaceColumnTop(xAt(column), zAt(row));
          if (groundY + 1 < floorY) add(column, groundY + 1, row, BLOCK_ID.cobblestone);
          add(column, floorY, row, floorId);
          for (let level = 1; level <= wallHeight; level++) {
            const boundaryX = column === 0 || column === width - 1;
            const boundaryZ = row === 0 || row === depth - 1;
            if (!boundaryX && !boundaryZ) continue;
            if (row === 0 && column === halfWidth && level <= 2) continue;
            if (level === 2 && boundaryX && row === halfDepth) {
              add(column, floorY + level, row, BLOCK_ID.glass);
              continue;
            }
            const corner = boundaryX && boundaryZ;
            add(column, floorY + level, row, corner ? cornerId : wallId);
          }
        }
      }
      for (let layer = 0; layer < roofLayers; layer++) {
        for (let column = layer; column < width - layer; column++) {
          for (let row = layer; row < depth - layer; row++) {
            add(column, floorY + wallHeight + 1 + layer, row, roofId);
          }
        }
      }
      if (blocks.length > MAX_HOUSE_BLOCKS) continue;
      let clear = true;
      for (const block of blocks) {
        if (world.getBlock(block.x, block.y, block.z) !== BLOCK_ID.air) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      return { blocks, center: { x: centerX, z: centerZ }, style };
    }
  }
  return null;
}
export function placeHousePlan(
  plan: HousePlan,
  world: HouseWorld & { setBlock(x: number, y: number, z: number, id: number): void },
  inventory: GameInventory
): HousePlan | null {
  const counts = new Map<string, number>();
  const savedCounts = inventory.toJSON().chunkEdits;
  for (const block of plan.blocks) {
    if (world.getBlock(block.x, block.y, block.z) !== BLOCK_ID.air) return null;
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
