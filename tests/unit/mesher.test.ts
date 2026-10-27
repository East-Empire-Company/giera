import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { CHUNK_SIZE, CHUNK_VOLUME, getBlockIndex } from "../../src/shared/chunk";
import { meshChunk, smoothGroundOffset, smoothVertexHeight } from "../../src/shared/mesher";

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

describe("smooth terrain", () => {
  const smoothAtlas = { ...atlas, dirt: { id: 3, uv: [0, 0, 1, 1] as const }, grass_top: atlas.grass_top, grass_side: atlas.grass_side };
  it("rounds the corner between a step of grass columns instead of leaving a cliff edge", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) {
      const top = x < 2 ? 3 : 4;
      for (let y = 0; y < top; y++) data[getBlockIndex(x, y, z)] = BLOCK_ID.grass;
    }
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock: () => 0, atlas: smoothAtlas });
    const ys = new Set<number>();
    for (let i = 0; i < mesh.positions.length / 3; i++) if (mesh.positions[i * 3] === 2 && mesh.positions[i * 3 + 2] === 2) ys.add(mesh.positions[i * 3 + 1]);
    expect([...ys].some((y) => y > 3 && y < 4)).toBe(true);
  });

  it("leaves flat grass unchanged", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) data[getBlockIndex(x, 0, z)] = BLOCK_ID.grass;
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock: () => 0, atlas: smoothAtlas });
    const tops = new Set<number>();
    for (let i = 0; i < mesh.positions.length / 3; i++) if (mesh.normals[i * 3 + 1] === 1) tops.add(mesh.positions[i * 3 + 1]);
    expect([...tops]).toEqual([1]);
  });
});

describe("smooth ground height", () => {
  const stepWorld = (x: number, y: number, z: number): number => {
    const top = x < 2 ? 3 : 4;
    return y >= 0 && y < top ? BLOCK_ID.grass : 0;
  };
  it("matches the voxel top away from steps and blends across them", () => {
    expect(smoothGroundOffset(stepWorld, 0.5, 0.5, 3)).toBeCloseTo(0, 6);
    expect(smoothGroundOffset(stepWorld, 1.9, 0.5, 3)).toBeGreaterThan(0);
  });
  it("is zero over non-smooth blocks and keeps vertices level without neighbours", () => {
    expect(smoothGroundOffset(() => BLOCK_ID.stone, 0.5, 0.5, 1)).toBe(0);
    expect(smoothVertexHeight(() => 0, 5, 5, 5)).toBe(5);
  });
});
