import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
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
  it("composites a later opaque pixel over an earlier one and keeps the earlier pixel where the later tile is transparent", async () => {
    const dir = tmpdir();
    const under = `${dir}/giera-atlas-under.png`;
    const over = `${dir}/giera-atlas-over.png`;
    await sharp({ create: { width: 2, height: 1, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toFile(under);
    await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 0, 0]), { raw: { width: 2, height: 1, channels: 4 } }).png().toFile(over);
    const atlas = await composeAtlas([{ path: under, x: 0, y: 0 }, { path: over, x: 0, y: 0 }], 2, 1);
    const output = await sharp(atlas).ensureAlpha().raw().toBuffer();
    expect([...output.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...output.slice(4, 8)]).toEqual([10, 20, 30, 255]);
  });


  it("rejects images wider than atlas capacity", () => {
    expect(() => packTiles([{ name: "large", width: 1024, height: 16 }])).toThrow(RangeError);
  });
});
