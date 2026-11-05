import { describe, expect, it } from "vitest";
import { TERRAIN_MATERIAL, terrainMaterialFor } from "../../src/shared/terrain-materials";

describe("headquarters terrain materials", () => {
  it("keeps opaque blocks merged and routes hero glazing to glass", () => {
    expect(terrainMaterialFor("hero_floor")).toBe(TERRAIN_MATERIAL.opaque);
    expect(terrainMaterialFor("hero_wall")).toBe(TERRAIN_MATERIAL.opaque);
    expect(terrainMaterialFor("neon_block")).toBe(TERRAIN_MATERIAL.opaque);
    expect(terrainMaterialFor("hero_glass")).toBe(TERRAIN_MATERIAL.glass);
  });
});
