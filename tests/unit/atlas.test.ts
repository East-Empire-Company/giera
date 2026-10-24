import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { composeAtlas, packTiles } from "../../scripts/build-atlas";

describe("source-pixel atlas packing", () => {
  it("keeps native image sizes inside a non-overlapping atlas", () => {
    const packed = packTiles([
      { name: "water", width: 128, height: 128 },
      { name: "grass", width: 16, height: 16 },
      { name: "stone", width: 16, height: 16 },
    ]);
    expect(packed.width).toBeGreaterThanOrEqual(128);
    expect(packed.height).toBeGreaterThanOrEqual(128);
    for (let i = 0; i < packed.placements.length; i++) {
      const current = packed.placements[i];
      expect(current.x + current.width).toBeLessThanOrEqual(packed.width);
      expect(current.y + current.height).toBeLessThanOrEqual(packed.height);
      for (let j = i + 1; j < packed.placements.length; j++) {
        const other = packed.placements[j];
        const overlaps = current.x < other.x + other.width && current.x + current.width > other.x && current.y < other.y + other.height && current.y + current.height > other.y;
        expect(overlaps).toBe(false);
      }
    }
  });
  it("preserves earlier pixels when later source tiles contain transparency", async () => {
    const waterPath = "public/assets/textures/tiles/water.png";
    const cobblePath = "public/assets/textures/tiles/cobblestone.png";
    const source = await sharp(waterPath).ensureAlpha().raw().toBuffer();
    const atlas = await composeAtlas([
      { path: waterPath, x: 0, y: 0 },
      { path: cobblePath, x: 128, y: 0 },
    ], 256, 256);
    const output = await sharp(atlas).ensureAlpha().raw().toBuffer();
    expect([...output.slice(0, 4)]).toEqual([...source.slice(0, 4)]);
  });


  it("rejects images wider than atlas capacity", () => {
    expect(() => packTiles([{ name: "large", width: 1024, height: 16 }])).toThrow(RangeError);
  });
});
