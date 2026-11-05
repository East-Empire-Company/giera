import { BLOCK_ID, type BlockId } from "./blocks";

export type BaseBlockOp = {
  x: number;
  y: number;
  z: number;
  id: BlockId;
  kind: "air" | "surface" | "verify";
};

export const HQ_FOOTPRINT = { minX: -7, maxX: 5, minZ: 0, maxZ: 8 } as const;
export const HQ_ELEVATOR = { x: 1, z: 2, groundCallZ: 1, upperCallZ: 3, upperY: 5 } as const;
export const HQ_DISPENSERS = [
  { id: "floor", stage: 4, kind: "block", item: "hero_floor", count: 8, x: -5, z: 7 },
  { id: "wall", stage: 4, kind: "block", item: "hero_wall", count: 8, x: -3, z: 7 },
  { id: "glass", stage: 4, kind: "block", item: "hero_glass", count: 8, x: -1, z: 7 },
  { id: "neon", stage: 4, kind: "block", item: "neon_block", count: 8, x: 1, z: 7 },
  { id: "pickaxe", stage: 5, kind: "gear", item: "star_pickaxe", count: 1, x: -6, z: 2 },
  { id: "axe", stage: 5, kind: "gear", item: "star_axe", count: 1, x: -6, z: 4 },
  { id: "sword", stage: 5, kind: "gear", item: "pulse_sword", count: 1, x: -6, z: 7 },
] as const;

export function baseStagePlan(stage: number): readonly BaseBlockOp[] {
  const ops: BaseBlockOp[] = [];
  const add = (x: number, y: number, z: number, id: BlockId, kind: BaseBlockOp["kind"] = "air"): void => {
    ops.push({ x, y, z, id, kind });
  };

  if (stage === 0) {
    for (let z = 0; z <= 8; z++) {
      for (let x = -7; x <= 5; x++) add(x, 0, z, BLOCK_ID.hero_floor, "surface");
    }
  }

  if (stage === 1 || stage === 2) {
    const minWallY = stage === 1 ? 1 : 5;
    const maxWallY = stage === 1 ? 3 : 7;
    for (let y = minWallY; y <= maxWallY; y++) {
      for (let z = 0; z <= 8; z++) {
        for (let x = -7; x <= 5; x++) {
          if (x !== -7 && x !== 5 && z !== 0 && z !== 8) continue;
          if (stage === 1 && z === 0 && (x === -1 || x === 0) && y <= 2) continue;
          const window = y === minWallY + 1 && (x + z) % 3 === 0 && !(x === -7 && z === 0) && !(x === 5 && z === 8);
          add(x, y, z, window ? BLOCK_ID.hero_glass : BLOCK_ID.hero_wall, "verify");
        }
      }
    }
  }

  if (stage === 2) {
    for (const [x, z] of [[-6, 1], [4, 1], [-6, 7], [4, 7]] as const) {
      for (let y = 1; y <= 3; y++) add(x, y, z, BLOCK_ID.hero_wall, "verify");
    }
    for (let z = 0; z <= 8; z++) {
      for (let x = -7; x <= 5; x++) {
        if (x !== HQ_ELEVATOR.x || z !== HQ_ELEVATOR.z) add(x, 4, z, BLOCK_ID.hero_floor, "verify");
        add(x, 8, z, BLOCK_ID.roof_tile, "verify");
      }
    }
  }

  return ops;
}
