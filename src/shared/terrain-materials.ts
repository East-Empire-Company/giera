/**
 * Draw buckets for chunk terrain. Every opaque tile shares one merged material (its atlas rectangle
 * rides on a per-vertex attribute); only tiles needing their own shader keep a bucket.
 */
export const TERRAIN_MATERIAL = {
  opaque: 0,
  leaves: 1,
  coal: 2,
  gold: 3,
  iron: 4,
  water: 5,
  glass: 6,
} as const;

export const TERRAIN_MATERIAL_COUNT = 7;

const BUCKET_BY_TILE: Record<string, number> = {
  ginkgo_leaves: TERRAIN_MATERIAL.leaves,
  default_mineral_coal: TERRAIN_MATERIAL.coal,
  default_mineral_gold: TERRAIN_MATERIAL.gold,
  default_mineral_iron: TERRAIN_MATERIAL.iron,
  water: TERRAIN_MATERIAL.water,
  glass: TERRAIN_MATERIAL.glass,
};

export function terrainMaterialFor(tileName: string): number {
  return BUCKET_BY_TILE[tileName] ?? TERRAIN_MATERIAL.opaque;
}