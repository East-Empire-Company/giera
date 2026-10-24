import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCKS } from "../../src/shared/blocks";
import manifest from "../../src/shared/asset-manifest.json";
import atlasManifest from "../../src/shared/atlas-manifest.json";

describe("runtime asset manifest", () => {
  it("provides local bitmap files for every textured block face", () => {
    const tileNames = new Set<string>();
    for (const block of BLOCKS) {
      for (const tile of Object.values(block.tiles)) if (tile) tileNames.add(tile);
    }
    for (const tile of tileNames) expect(manifest.tiles).toHaveProperty(tile);
    for (const path of Object.values(manifest.tiles)) expect(existsSync(join("public", path))).toBe(true);
  });

  it("keeps local character, sky, particle and UI assets available", () => {
    const paths = [
      ...Object.values(manifest.models),
      ...Object.values(manifest.sky),
      ...Object.values(manifest.particles),
      ...Object.values(manifest.ui),
      ...Object.values(manifest.icons),
      ...Object.values(manifest.normalMaps),
      ...Object.values(manifest.overlays),
      ...Object.values(manifest.fonts),
    ];
    for (const path of paths) expect(existsSync(join("public", path))).toBe(true);
  });
  it("records atlas rectangles for every downloaded block tile", () => {
    expect(existsSync("public/assets/textures/atlas.png")).toBe(true);
    const ids = Object.values(atlasManifest.tiles).map((tile) => tile.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tile of Object.keys(manifest.tiles)) expect(atlasManifest.tiles).toHaveProperty(tile);
  });
});
