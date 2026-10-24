import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { CHUNK_SIZE, CHUNK_VOLUME, getBlockIndex } from "../../src/shared/chunk";
import { meshChunk } from "../../src/shared/mesher";

const atlas: Record<string, { id: number; uv: readonly [number, number, number, number] }> = {
  stone: { id: 0, uv: [0, 0, 1, 1] },
  grass_top: { id: 1, uv: [0, 0, 1, 1] },
  grass_side: { id: 2, uv: [0, 0, 1, 1] },
};

describe("greedy chunk mesher", () => {
  it("emits six faces for one block", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    data[getBlockIndex(1, 1, 1)] = BLOCK_ID.stone;
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock: () => 0, atlas });
    expect(mesh.positions.length / 3).toBe(24);
    expect(mesh.indices.length).toBe(36);
    expect(mesh.groups.reduce((sum, group) => sum + group.count, 0)).toBe(36);
  });

  it("merges coplanar matching faces without hiding outer sides", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    data[getBlockIndex(1, 1, 1)] = BLOCK_ID.stone;
    data[getBlockIndex(2, 1, 1)] = BLOCK_ID.stone;
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock: () => 0, atlas });
    expect(mesh.positions.length / 3).toBe(24);
    expect(mesh.indices.length).toBe(36);
    expect(Math.max(...mesh.uvs)).toBe(2);
  });
  it("keeps geometry chunk-local at large world coordinates", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    data[getBlockIndex(1, 1, 1)] = BLOCK_ID.stone;
    const mesh = meshChunk({ data, cx: 50000, cy: 0, cz: -50000, getBlock: () => 0, atlas });
    const xCoordinates = Array.from({ length: mesh.positions.length / 3 }, (_value, index) => mesh.positions[index * 3]);
    expect(Math.min(...xCoordinates)).toBe(1);
    expect(Math.max(...xCoordinates)).toBe(2);
  });
});
