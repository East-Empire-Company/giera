import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { CHUNK_SIZE, getBlockIndex } from "../../src/shared/chunk";
import { generateBlock, generateChunk } from "../../src/shared/worldgen";

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
});
