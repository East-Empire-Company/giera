import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { composeAtlas, packTiles } from "../../scripts/build-atlas";
import atlasManifest from "../../src/shared/atlas-manifest.json";
import * as atlasBuilder from "../../scripts/build-atlas";


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

  it("exposes runtime UV rectangles for all city material tiles", () => {
    for (const name of ["asphalt", "paving", "brick", "plaster", "roof_tile"] as const) {
      const tile = atlasManifest.tiles[name];
      expect(tile).toBeDefined();
      expect(tile!.uv).toHaveLength(4);
      expect(tile!.uv[0]).toBeGreaterThanOrEqual(0);
      expect(tile!.uv[1]).toBeGreaterThanOrEqual(0);
      expect(tile!.uv[2]).toBeLessThanOrEqual(1);
      expect(tile!.uv[3]).toBeLessThanOrEqual(1);
      expect(tile!.uv[2]).toBeGreaterThan(tile!.uv[0]);
      expect(tile!.uv[3]).toBeGreaterThan(tile!.uv[1]);
    }
  });
  it("accepts the configured 32-tile atlas capacity and rejects overflow", () => {
    const runtimeExports = atlasBuilder as unknown as Record<string, unknown>;
    const candidate = runtimeExports["atlasGridDimensions"];
    expect(typeof candidate).toBe("function");
    if (typeof candidate !== "function") return;
    const atlasGridDimensions = candidate as (
      tileCount: number,
      resolution: number,
      gutter: number,
    ) => { columns: number; rows: number; cell: number; width: number; height: number };
    expect(atlasGridDimensions(25, 512, 8)).toEqual({
      columns: 4,
      rows: 7,
      cell: 528,
      width: 2112,
      height: 3696,
    });
    expect(() => atlasGridDimensions(33, 512, 8)).toThrow(RangeError);
  });


  it("rejects images wider than atlas capacity", () => {
    expect(() => packTiles([{ name: "large", width: 1024, height: 16 }])).toThrow(RangeError);
  });
  it("packs oak log ends from the pixel tile with flat tangent normals", async () => {
    const tile = atlasManifest.tiles.oak_log_top;
    const x = Math.round(tile.uv[0] * atlasManifest.width - 0.5);
    const y = Math.round((1 - tile.uv[3]) * atlasManifest.height - 0.5);
    const [expected, actual, normalPixels] = await Promise.all([
      sharp(`public/${tile.path}`).resize(atlasManifest.tileRes, atlasManifest.tileRes, { kernel: "nearest" }).removeAlpha().raw().toBuffer(),
      sharp("public/assets/textures/atlas.webp")
        .extract({ left: x, top: y, width: atlasManifest.tileRes, height: atlasManifest.tileRes })
        .removeAlpha()
        .raw()
        .toBuffer(),
      sharp("public/assets/textures/atlas-normal.webp")
        .extract({ left: x, top: y, width: atlasManifest.tileRes, height: atlasManifest.tileRes })
        .png()
        .toBuffer(),
    ]);
    const normal = await sharp(normalPixels).stats();
    expect(normal.channels.slice(0, 3).map(({ min, max }) => [min, max])).toEqual([[128, 128], [128, 128], [255, 255]]);
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference += Math.abs(expected[i] - actual[i]);
    expect(difference / expected.length).toBeLessThan(8);
  });

  it("preserves neutral AO and roughness in generated HQ atlas tiles", async () => {
    for (const name of ["hero_floor", "hero_wall", "neon_block"] as const) {
      const tile = atlasManifest.tiles[name];
      const x = Math.round(tile.uv[0] * atlasManifest.width - 0.5) + 16;
      const y = Math.round((1 - tile.uv[3]) * atlasManifest.height - 0.5) + 16;
      const pixel = await sharp("public/assets/textures/atlas-orm.webp")
        .extract({ left: x, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer();
      expect(pixel[0], `${name} AO`).toBeGreaterThan(250);
      expect(pixel[1], `${name} roughness`).toBeGreaterThan(225);
      expect(pixel[1], `${name} roughness`).toBeLessThan(235);
      expect(pixel[2], `${name} metalness`).toBe(0);
    }
  });

  it("preserves transparent and opaque pixels in the leaf atlas tile", async () => {
    const tile = atlasManifest.tiles.ginkgo_leaves;
    const x = Math.round(tile.uv[0] * atlasManifest.width - 0.5);
    const y = Math.round((1 - tile.uv[3]) * atlasManifest.height - 0.5);
    const pixels = await sharp("public/assets/textures/atlas.webp")
      .extract({ left: x, top: y, width: atlasManifest.tileRes, height: atlasManifest.tileRes })
      .ensureAlpha()
      .raw()
      .toBuffer();
    let transparent = 0;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 128) transparent++;
      if (pixels[i] > 250) opaque++;
    }
    expect(transparent).toBeGreaterThan(1000);
    expect(opaque).toBeGreaterThan(1000);
  });
});

