import { describe, expect, it } from "vitest";
import { BLOCK_ID, getBlockDef } from "../../src/shared/blocks";
import { decodeWarsawCityData, decodeWarsawTile, getWarsawCityData, lookupWarsawConnectorHeight, lookupWarsawGroundHeight, lookupWarsawVoxel, mapWarsawPalette } from "../../src/shared/warsaw-city-data";
import {
  WARSAW_CITY_DEPTH,
  WARSAW_CITY_PACKED_DATA,
  WARSAW_CITY_PALETTE_BLOCK_IDS,
  WARSAW_CITY_PALETTE_TINT_IDS,
  WARSAW_CITY_WIDTH,
} from "../../src/shared/warsaw-city-data.generated";

const level1Slice = Uint8Array.from(Buffer.from("AgACAAIAAgACAAIAAgACAAIAAgACAAIAAgACAAIAAgAqKioqKioqKioqKioqKioqAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEAAAApABkAKQABAAEA", "base64"));
const foliageSlice = Uint8Array.from(Buffer.from("AAAAAAAAAQAAAAAAAQABAAAAAAABAAEAAAAAAAEAAQApKSoqKSkqKikpKiopKSoqLAADADkALAADADQALAAFADQALAACADMALAAFADMALQAEADMALAAFADMA", "base64"));

type PaletteEntry = readonly [number, number, number, number];

function mapUsedPalette(palette: readonly PaletteEntry[]) {
  return mapWarsawPalette(palette, new Uint32Array(palette.length).fill(1));
}

describe("Warsaw source data", () => {
  it("decodes a pinned level-1 tile slice into row-major runs", () => {
    const decoded = decodeWarsawTile(level1Slice, 2);

    expect([...decoded.counts]).toEqual(Array(16).fill(2));
    expect([...decoded.ground]).toEqual(Array(16).fill(42));
    expect([...decoded.runs]).toEqual(Array.from({ length: 16 }, () => [0, 41, 25, 41, 1, 1]).flat());
  });

  it("decodes a pinned 1f foliage slice with the same column layout", () => {
    const decoded = decodeWarsawTile(foliageSlice, 2);

    expect([...decoded.counts]).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);
    expect([...decoded.ground]).toEqual([41, 41, 42, 42, 41, 41, 42, 42, 41, 41, 42, 42, 41, 41, 42, 42]);
    expect([...decoded.runs]).toEqual([44, 3, 57, 44, 3, 52, 44, 5, 52, 44, 2, 51, 44, 5, 51, 45, 4, 51, 44, 5, 51]);
  });

  it("maps every pinned source material ID to its block family", () => {
    const expected = [2, 18, 10, 8, 11, 2, 2, 18, 5, 15, 4, 2, 19, 18, 2, 2, 2, 2, 2, 2, 17, 10, 17];
    const palette = expected.map((_, id) => [31 + id, 71 + id, 131 + id, id] as const);

    expect([...mapUsedPalette(palette).blockIds]).toEqual(expected);
  });

  it("maps exact source SOLID tuples to city material families", () => {
    const cases: readonly [PaletteEntry, number][] = [
      [[96, 100, 108, 0], 15], [[112, 112, 120, 0], 15], [[136, 88, 80, 0], 15], [[104, 108, 116, 0], 15],
      [[200, 192, 184, 0], 16], [[180, 180, 176, 0], 16], [[144, 136, 128, 0], 16], [[216, 204, 180, 0], 16],
      [[136, 128, 120, 0], 16], [[168, 164, 156, 0], 16], [[184, 176, 168, 0], 16], [[208, 200, 184, 0], 16], [[184, 136, 88, 0], 16],
      [[188, 184, 176, 0], 18], [[168, 160, 152, 0], 18], [[220, 216, 208, 0], 18],
      [[108, 80, 56, 0], 7], [[108, 88, 72, 0], 9],
      [[1, 2, 3, 0], 2],
    ];
    const mapped = mapUsedPalette(cases.map(([entry]) => entry));

    expect([...mapped.blockIds]).toEqual(cases.map(([, blockId]) => blockId));
  });

  it("maps palette indices used by pinned level-1 and 1f data", () => {
    const palette: PaletteEntry[] = Array.from({ length: 58 }, () => [0, 0, 0, 0]);
    palette[1] = [200, 192, 184, 0];
    palette[25] = [120, 92, 68, 10];
    palette[51] = [140, 180, 80, 3];
    palette[52] = [120, 160, 72, 3];
    palette[57] = [88, 132, 76, 3];
    const usage = new Uint32Array(palette.length);
    for (const index of [1, 25, 51, 52, 57]) usage[index] = 1;
    const mapped = mapWarsawPalette(palette, usage);

    expect([mapped.blockIds[1], mapped.blockIds[25], mapped.blockIds[51], mapped.blockIds[52], mapped.blockIds[57]])
      .toEqual([16, BLOCK_ID.dirt, BLOCK_ID.oak_leaves, BLOCK_ID.oak_leaves, BLOCK_ID.oak_leaves]);
    expect([mapped.tintIds[1], mapped.tintIds[25], mapped.tintIds[51], mapped.tintIds[52], mapped.tintIds[57]])
      .toEqual([0, 0, 0, 1, 2]);
    expect(mapped.tintPalettes[16]).toEqual([[200, 192, 184]]);
    expect(mapped.tintPalettes[BLOCK_ID.dirt]).toEqual([[120, 92, 68]]);
    expect(mapped.tintPalettes[BLOCK_ID.oak_leaves]).toEqual([[140, 180, 80], [120, 160, 72], [88, 132, 76]]);
  });


  it("caps each material tint palette at 16 colors deterministically", () => {
    const palette = Array.from({ length: 24 }, (_, i) => [i * 7, i * 9, i * 11, 8] as const);
    const usage = Uint32Array.from(palette, (_, i) => i + 1);
    const first = mapWarsawPalette(palette, usage);
    const second = mapWarsawPalette(palette, usage);

    expect(first).toEqual(second);
    expect(first.tintPalettes[BLOCK_ID.grass]).toHaveLength(16);
    expect([...first.tintIds].every((id) => id < 16 || id === 255)).toBe(true);
  });

  it("reserves tint ID 255 for unused source palette entries", () => {
    const mapped = mapWarsawPalette([[20, 80, 140, 8], [30, 90, 150, 8]], Uint32Array.of(1, 0));

    expect(mapped.tintIds[1]).toBe(255);
    expect(mapped.tintIds[0]).toBeLessThan(16);
  });

  it("rejects source palette entries with unknown material IDs", () => {
    expect(() => mapWarsawPalette([[1, 2, 3, 23]], Uint32Array.of(1))).toThrow(/unknown source material/i);
  });

  it("decodes generated crop data once into source-ground and run arrays", () => {
    const city = decodeWarsawCityData(WARSAW_CITY_PACKED_DATA, WARSAW_CITY_WIDTH, WARSAW_CITY_DEPTH);
    const groundTops = Array.from(city.ground, (height) => height - 1).sort((a, b) => a - b);
    let maxSolid = -1;
    for (let i = 0; i < city.runs.length; i += 3) maxSolid = Math.max(maxSolid, city.runs[i] + city.runs[i + 1] - 1);

    expect(city.ground[0]).toBe(42);
    expect([...city.runs.slice(0, 6)]).toEqual([0, 41, 25, 41, 1, 1]);
    expect(city.ground[95 * WARSAW_CITY_WIDTH + 84] - 1).toBe(43);
    expect(groundTops[0]).toBe(41);
    expect((groundTops[4607] + groundTops[4608]) / 2).toBe(43);
    expect(maxSolid).toBe(70);
    expect(city.offsets[city.offsets.length - 1]! * 3).toBe(city.runs.length);
    expect(WARSAW_CITY_PALETTE_BLOCK_IDS).toHaveLength(WARSAW_CITY_PALETTE_TINT_IDS.length);
  });
  it("caches decoded city data for the runtime", () => {
    const city = getWarsawCityData();

    expect(getWarsawCityData()).toBe(city);
    expect(city.width).toBe(WARSAW_CITY_WIDTH);
  });
  it("maps world coordinates to pinned source solids and top height", () => {
    expect(lookupWarsawVoxel(-80, 58, -112)).toEqual({ blockId: BLOCK_ID.paving, tintId: 0 });
    expect(lookupWarsawVoxel(-80, 17, -112)).toEqual({ blockId: BLOCK_ID.dirt, tintId: 0 });
    expect(lookupWarsawVoxel(-80, 59, -112)).toBeNull();
    expect(lookupWarsawGroundHeight(-80, -112)).toBe(58);
    expect(lookupWarsawGroundHeight(-81, -112)).toBeNull();
    expect(lookupWarsawVoxel(-81, 58, -112)).toBeNull();
  });

  it("limits connector height to its four-wide street corridor", () => {
    expect(lookupWarsawConnectorHeight(4, -16)).toBe(60);
    expect(lookupWarsawConnectorHeight(7, 4)).toBe(60);
    expect(lookupWarsawConnectorHeight(3, -16)).toBeNull();
    expect(lookupWarsawConnectorHeight(4, -17)).toBeNull();
    expect(lookupWarsawConnectorHeight(4, 5)).toBeNull();
  });


  it("rejects truncated packed city data", () => {
    expect(() => decodeWarsawCityData("AA==", 1, 1)).toThrow(/truncated/i);
  });

  it("defines all imported city blocks as solid", () => {
    for (const id of [15, 16, 17, 18, 19]) {
      expect(getBlockDef(id).solid).toBe(true);
      expect(getBlockDef(id).liquid).toBe(false);
    }
  });
});
