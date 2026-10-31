export const BLOCK_ID = {
  air: 0,
  bedrock: 1,
  stone: 2,
  cobblestone: 3,
  dirt: 4,
  grass: 5,
  sand: 6,
  oak_log: 7,
  oak_leaves: 8,
  planks: 9,
  glass: 10,
  water: 11,
  coal_ore: 12,
  iron_ore: 13,
  gold_ore: 14,
} as const;

export type BlockId = (typeof BLOCK_ID)[keyof typeof BLOCK_ID];
export type BlockTiles = { top: string | null; bottom: string | null; side: string | null };
export type BlockDef = {
  id: BlockId;
  name: string;
  tiles: BlockTiles;

  hardness: number;
  solid: boolean;
  liquid: boolean;
};

const stoneTiles: BlockTiles = { top: "stone", bottom: "stone", side: "stone" };

export const BLOCK_BY_ID: Record<BlockId, BlockDef> = {
  0: { id: BLOCK_ID.air, name: "Powietrze", tiles: { top: null, bottom: null, side: null }, hardness: 0, solid: false, liquid: false },
  1: { id: BLOCK_ID.bedrock, name: "Skała macierzysta", tiles: stoneTiles, hardness: Infinity, solid: true, liquid: false },
  2: { id: BLOCK_ID.stone, name: "Kamień", tiles: stoneTiles, hardness: 3, solid: true, liquid: false },
  3: { id: BLOCK_ID.cobblestone, name: "Bruk", tiles: { top: "cobblestone", bottom: "cobblestone", side: "cobblestone" }, hardness: 2, solid: true, liquid: false },
  4: { id: BLOCK_ID.dirt, name: "Ziemia", tiles: { top: "dirt", bottom: "dirt", side: "dirt" }, hardness: 0.6, solid: true, liquid: false },
  5: { id: BLOCK_ID.grass, name: "Trawa", tiles: { top: "grass_top", bottom: "dirt", side: "grass_side" }, hardness: 0.7, solid: true, liquid: false },
  6: { id: BLOCK_ID.sand, name: "Piasek", tiles: { top: "sand", bottom: "sand", side: "sand" }, hardness: 0.5, solid: true, liquid: false },
  7: { id: BLOCK_ID.oak_log, name: "Drewno dębowe", tiles: { top: "oak_log_top", bottom: "oak_log_top", side: "oak_log_side" }, hardness: 2, solid: true, liquid: false },
  8: { id: BLOCK_ID.oak_leaves, name: "Liście", tiles: { top: "ginkgo_leaves", bottom: "ginkgo_leaves", side: "ginkgo_leaves" }, hardness: 0.25, solid: true, liquid: false },
  9: { id: BLOCK_ID.planks, name: "Deski", tiles: { top: "oak_planks", bottom: "oak_planks", side: "oak_planks" }, hardness: 1.5, solid: true, liquid: false },
  10: { id: BLOCK_ID.glass, name: "Szkło", tiles: { top: "glass", bottom: "glass", side: "glass" }, hardness: 0.3, solid: true, liquid: false },
  11: { id: BLOCK_ID.water, name: "Woda", tiles: { top: "water", bottom: "water", side: "water" }, hardness: 0, solid: false, liquid: true },
  12: { id: BLOCK_ID.coal_ore, name: "Ruda węgla", tiles: { top: "default_mineral_coal", bottom: "default_mineral_coal", side: "default_mineral_coal" }, hardness: 3.2, solid: true, liquid: false },
  13: { id: BLOCK_ID.iron_ore, name: "Ruda żelaza", tiles: { top: "default_mineral_iron", bottom: "default_mineral_iron", side: "default_mineral_iron" }, hardness: 3.6, solid: true, liquid: false },
  14: { id: BLOCK_ID.gold_ore, name: "Ruda złota", tiles: { top: "default_mineral_gold", bottom: "default_mineral_gold", side: "default_mineral_gold" }, hardness: 4, solid: true, liquid: false },
};

export const BLOCKS = Object.values(BLOCK_BY_ID);

export function getBlockDef(id: number): BlockDef {
  if (!Number.isInteger(id) || !Object.hasOwn(BLOCK_BY_ID, id)) throw new RangeError(`Unknown block id: ${id}`);
  return BLOCK_BY_ID[id as BlockId];
}
