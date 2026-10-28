import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { CHUNK_SIZE, getBlockIndex } from "../../src/shared/chunk";
import { generateBlock, generateChunk, surfaceHeight } from "../../src/shared/worldgen";

describe("world generation", () => {
  it("is deterministic for a seed and coordinates", () => {
    expect(generateChunk(-1, 1, 2, 12345)).toEqual(generateChunk(-1, 1, 2, 12345));
    expect(generateChunk(-1, 1, 2, 12345)).not.toEqual(generateChunk(-1, 1, 2, 54321));
  });

  it("keeps bedrock at y=0 and continuous cells across vertical chunk bounds", () => {
    const lower = generateChunk(0, 0, 0, 17);
    const upper = generateChunk(0, 1, 0, 17);
    expect(lower[getBlockIndex(4, 0, 4)]).toBe(BLOCK_ID.bedrock);
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(lower[getBlockIndex(x, 15, z)]).toBe(generateBlock(x, 15, z, 17));
        expect(upper[getBlockIndex(x, 0, z)]).toBe(generateBlock(x, 16, z, 17));
      }
    }
  });

  it("grows crowns of at least two distinct shapes per seed", () => {
    const shapes = new Set<string>();
    outer: for (let z = 0; z < 96 && shapes.size < 2; z++) {
      for (let x = 0; x < 96 && shapes.size < 2; x++) {
        const surface = surfaceHeight(x, z, 424242);
        for (let y = surface + 1; y <= surface + 9; y++) {
          if (generateBlock(x, y, z, 424242) !== BLOCK_ID.oak_log) continue;
          let trunkTop = y;
          while (generateBlock(x, trunkTop + 1, z, 424242) === BLOCK_ID.oak_log) trunkTop++;
          const crownBase = trunkTop - 2;
          let baseRadius = 0;
          while (baseRadius < 3 && generateBlock(x + baseRadius + 1, crownBase, z, 424242) === BLOCK_ID.oak_leaves) baseRadius++;
          const upperWide = generateBlock(x + 2, trunkTop, z, 424242) === BLOCK_ID.oak_leaves;
          shapes.add(`${baseRadius}:${upperWide ? 1 : 0}`);
          break;
        }
      }
    }
    expect(shapes.size).toBeGreaterThanOrEqual(2);
  });

  it("keeps the legacy v1 tree layout distinct from v2 for the same seed", () => {
    let differs = false;
    for (let z = 0; z < 96 && !differs; z++) {
      for (let x = 0; x < 96 && !differs; x++) {
        const surface = surfaceHeight(x, z, 424242);
        for (let y = surface + 1; y <= surface + 9 && !differs; y++) {
          if (generateBlock(x, y, z, 424242, 1) !== generateBlock(x, y, z, 424242, 2)) differs = true;
        }
      }
    }
    expect(differs).toBe(true);
  });

  it("is deterministic per version", () => {
    expect(generateChunk(0, 1, 0, 17, 1)).toEqual(generateChunk(0, 1, 0, 17, 1));
    expect(generateChunk(0, 1, 0, 17, 2)).toEqual(generateChunk(0, 1, 0, 17, 2));
  });

  it("pins surface height for the trailer seed and a legacy seed", () => {
    expect(surfaceHeight(0, 0, 424242)).toBe(61);
    expect(surfaceHeight(3, 5, 424242)).toBe(60);
    expect(surfaceHeight(-1, 2, 17)).toBe(56);
    expect(generateBlock(0, 61, 0, 424242, 2)).toBe(BLOCK_ID.grass);
  });
});
