import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { CHUNK_SIZE, CHUNK_VOLUME, getBlockIndex } from "../../src/shared/chunk";
import { meshChunk, roundLeafVertex, smoothGroundOffset, smoothVertexHeight, type ChunkMesh } from "../../src/shared/mesher";
import { NO_CITY_TINT } from "../../src/shared/warsaw-city-data";
import { WARSAW_CITY_TINT_PALETTES } from "../../src/shared/warsaw-city-data.generated";

const atlas: Record<string, { id: number; uv: readonly [number, number, number, number] }> = {
  stone: { id: 0, uv: [0, 0, 1, 1] },
  grass_top: { id: 1, uv: [0, 0, 1, 1] },
  grass_side: { id: 2, uv: [0, 0, 1, 1] },
};

function cityTintMultiplier(rgb: readonly number[]): number[] {
  const linear = rgb.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return linear.map((channel) => 0.4 + 0.6 * channel / luminance);
}

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

describe("city vertex tint", () => {
  it("applies linear palette colors and keeps differently tinted faces separate", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    const first = getBlockIndex(1, 1, 1);
    const second = getBlockIndex(2, 1, 1);
    data[first] = BLOCK_ID.plaster;
    data[second] = BLOCK_ID.plaster;
    const cityTintIds = new Uint8Array(CHUNK_VOLUME).fill(NO_CITY_TINT);
    cityTintIds[first] = 0;
    cityTintIds[second] = 1;
    const plasterAtlas = { ...atlas, plaster: { id: 3, uv: [0, 0, 1, 1] as const } };
    const mesh = meshChunk({
      data,
      cx: 0,
      cy: 0,
      cz: 0,
      getBlock: () => BLOCK_ID.air,
      atlas: plasterAtlas,
      cityTintIds,
      cityTintPalettes: WARSAW_CITY_TINT_PALETTES,
    });

    const topFaces: { minX: number; maxX: number; color: number[] }[] = [];
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 4) {
      const start = vertex * 3;
      if (![0, 1, 2, 3].every((offset) => mesh.normals[(vertex + offset) * 3 + 1] === 1)) continue;
      const y = [0, 1, 2, 3].map((offset) => mesh.positions[(vertex + offset) * 3 + 1]);
      const z = [0, 1, 2, 3].map((offset) => mesh.positions[(vertex + offset) * 3 + 2]);
      if (!y.every((value) => value === 2) || !z.every((value) => value >= 1 && value <= 2)) continue;
      const x = [0, 1, 2, 3].map((offset) => mesh.positions[(vertex + offset) * 3]);
      topFaces.push({
        minX: Math.min(...x),
        maxX: Math.max(...x),
        color: [mesh.colors[start], mesh.colors[start + 1], mesh.colors[start + 2]],
      });
    }

    expect(topFaces).toHaveLength(2);
    const sortedTopFaces = topFaces.sort((a, b) => a.minX - b.minX);
    expect(sortedTopFaces.map(({ minX, maxX }) => [minX, maxX])).toEqual([[1, 2], [2, 3]]);
    for (const [index, face] of sortedTopFaces.entries()) {
      cityTintMultiplier(WARSAW_CITY_TINT_PALETTES[BLOCK_ID.plaster]![index]!).forEach((channel, channelIndex) => {
        expect(face.color[channelIndex]).toBeCloseTo(channel, 5);
      });
    }
  });
  it("merges coplanar faces from blocks with the same city tint", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    const first = getBlockIndex(1, 1, 1);
    const second = getBlockIndex(2, 1, 1);
    data[first] = BLOCK_ID.plaster;
    data[second] = BLOCK_ID.plaster;
    const cityTintIds = new Uint8Array(CHUNK_VOLUME).fill(NO_CITY_TINT);
    cityTintIds[first] = 0;
    cityTintIds[second] = 0;
    const mesh = meshChunk({
      data,
      cx: 0,
      cy: 0,
      cz: 0,
      getBlock: () => BLOCK_ID.air,
      atlas: { ...atlas, plaster: { id: 3, uv: [0, 0, 1, 1] } },
      cityTintIds,
      cityTintPalettes: WARSAW_CITY_TINT_PALETTES,
    });
    const topFaces = [];
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 4) {
      const y = [0, 1, 2, 3].map((offset) => mesh.positions[(vertex + offset) * 3 + 1]);
      const z = [0, 1, 2, 3].map((offset) => mesh.positions[(vertex + offset) * 3 + 2]);
      if (y.every((value) => value === 2) && z.every((value) => value >= 1 && value <= 2)) {
        const x = [0, 1, 2, 3].map((offset) => mesh.positions[(vertex + offset) * 3]);
        topFaces.push([Math.min(...x), Math.max(...x)]);
      }
    }
    expect(topFaces).toEqual([[1, 3]]);
  });

  it("multiplies city tint by ambient occlusion", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    const center = getBlockIndex(1, 1, 1);
    data[center] = BLOCK_ID.plaster;
    data[getBlockIndex(0, 2, 2)] = BLOCK_ID.stone;
    data[getBlockIndex(2, 2, 0)] = BLOCK_ID.stone;
    const cityTintIds = new Uint8Array(CHUNK_VOLUME).fill(NO_CITY_TINT);
    cityTintIds[center] = 0;
    const inputs = {
      data,
      cx: 0,
      cy: 0,
      cz: 0,
      getBlock: () => BLOCK_ID.air,
      atlas: { ...atlas, plaster: { id: 3, uv: [0, 0, 1, 1] as const } },
    };
    const plain = meshChunk(inputs);
    const tinted = meshChunk({ ...inputs, cityTintIds, cityTintPalettes: WARSAW_CITY_TINT_PALETTES });
    let shadedVertex = -1;
    for (let vertex = 0; vertex < plain.positions.length / 3; vertex++) {
      if (
        plain.positions[vertex * 3 + 1] === 2
        && plain.normals[vertex * 3 + 1] === 1
        && plain.colors[vertex * 3]! < 1
      ) {
        shadedVertex = vertex * 3;
        break;
      }
    }
    expect(shadedVertex).toBeGreaterThanOrEqual(0);
    const tintMultiplier = cityTintMultiplier(WARSAW_CITY_TINT_PALETTES[BLOCK_ID.plaster]![0]!);
    for (let channel = 0; channel < 3; channel++) {
      expect(tinted.colors[shadedVertex + channel]).toBeCloseTo(plain.colors[shadedVertex + channel]! * tintMultiplier[channel]!, 6);
    }
  });

  it.each([BLOCK_ID.grass, BLOCK_ID.dirt, BLOCK_ID.sand])("keeps source-marked city block %i top faces at voxel height on chunk edges", (blockId) => {
    const data = new Uint8Array(CHUNK_VOLUME);
    const edgeBlock = getBlockIndex(CHUNK_SIZE - 1, 3, 8);
    data[edgeBlock] = blockId;
    const cityTintIds = new Uint8Array(CHUNK_VOLUME).fill(NO_CITY_TINT);
    cityTintIds[edgeBlock] = 0;
    const getBlock = (x: number, y: number, z: number) => {
      if (x === CHUNK_SIZE && z === 8 && y >= 0 && y < 3) return blockId;
      return BLOCK_ID.air;
    };
    const edgeAtlas = { ...atlas, dirt: { id: 3, uv: [0, 0, 1, 1] as const }, sand: { id: 4, uv: [0, 0, 1, 1] as const } };
    const palette = { [blockId]: [[120, 120, 120] as const] };
    const cityMesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock, atlas: edgeAtlas, cityTintIds, cityTintPalettes: palette });
    const ordinaryMesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock, atlas: edgeAtlas });
    const topHeights = (mesh: ChunkMesh) => {
      const heights: number[] = [];
      for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 4) {
        if (![0, 1, 2, 3].every((offset) => mesh.normals[(vertex + offset) * 3 + 1] > 0)) continue;
        for (let offset = 0; offset < 4; offset++) {
          if (mesh.positions[(vertex + offset) * 3] === CHUNK_SIZE - 1 || mesh.positions[(vertex + offset) * 3] === CHUNK_SIZE) {
            heights.push(mesh.positions[(vertex + offset) * 3 + 1]);
          }
        }
      }
      return heights;
    };
    expect(topHeights(cityMesh).length).toBeGreaterThan(0);
    expect(topHeights(cityMesh).every((height) => height === 4)).toBe(true);
    expect(topHeights(ordinaryMesh).some((height) => height !== 4)).toBe(true);
  });
});

describe("anisotropy quad-flip", () => {
  it("keeps the unflipped diagonal for a fully-exposed face (all ao = 1)", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    data[getBlockIndex(1, 1, 1)] = BLOCK_ID.stone;
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock: () => 0, atlas });
    const indices = Array.from(mesh.indices);
    expect(indices.slice(0, 6)).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("flips the top-face diagonal when the opposite corners have lower AO", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    data[getBlockIndex(1, 1, 1)] = BLOCK_ID.stone;
    data[getBlockIndex(0, 2, 2)] = BLOCK_ID.stone;
    data[getBlockIndex(2, 2, 0)] = BLOCK_ID.stone;
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock: () => 0, atlas });
    const vertexAt = (x: number, z: number): number => {
      for (let i = 0; i < mesh.positions.length / 3; i++) {
        if (mesh.positions[i * 3] === x && mesh.positions[i * 3 + 1] === 2 && mesh.positions[i * 3 + 2] === z && mesh.normals[i * 3 + 1] === 1) return i;
      }
      throw new Error(`Missing top face vertex ${x},${z}`);
    };
    const v0 = vertexAt(1, 1);
    const v1 = vertexAt(1, 2);
    const v2 = vertexAt(2, 2);
    const v3 = vertexAt(2, 1);
    const target = new Set([v0, v1, v2, v3]);
    const triangles: number[][] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const triangle = Array.from(mesh.indices.slice(i, i + 3));
      if (triangle.every((index) => target.has(index))) triangles.push(triangle.sort((a, b) => a - b));
    }
    expect(triangles).toEqual([[v0, v1, v3].sort((a, b) => a - b), [v1, v2, v3].sort((a, b) => a - b)]);
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
  it("keeps the four-corner mean after two deform iterations", () => {
    const heightAt = (x: number, z: number): number => (x === 1 && z === 0 ? 4 : 3);
    const getBlock = (x: number, y: number, z: number): number =>
      y >= 0 && y < heightAt(x, z) ? BLOCK_ID.grass : 0;
    expect(smoothVertexHeight(getBlock, 1, 4, 1)).toBeCloseTo(3.25);
  });
  it("shares smooth normals across adjacent terrain top faces", () => {
    const heightAt = (x: number, z: number): number => (x === 2 && z === 2 ? 4 : 3);
    const getBlock = (x: number, y: number, z: number): number =>
      y >= 0 && y < heightAt(x, z) ? BLOCK_ID.grass : 0;
    const data = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < heightAt(x, z); y++) data[getBlockIndex(x, y, z)] = BLOCK_ID.grass;
    }
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock, atlas: smoothAtlas });
    const normalsByPosition = new Map<string, number[][]>();
    for (const group of mesh.groups) {
      if (group.tile !== smoothAtlas.grass_top.id) continue;
      for (let offset = group.start; offset < group.start + group.count; offset += 6) {
        const vertices = new Set([mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2], mesh.indices[offset + 5]]);
        for (const vertex of vertices) {
          const start = vertex * 3;
          const key = `${mesh.positions[start].toFixed(4)},${mesh.positions[start + 1].toFixed(4)},${mesh.positions[start + 2].toFixed(4)}`;
          const normal = [mesh.normals[start], mesh.normals[start + 1], mesh.normals[start + 2]];
          const values = normalsByPosition.get(key) ?? [];
          values.push(normal);
          normalsByPosition.set(key, values);
        }
      }
    }
    const shared = [...normalsByPosition.values()].filter((normals) => normals.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const normals of shared) {
      const first = normals[0];
      for (const normal of normals.slice(1)) {
        expect(Math.hypot(normal[0] - first[0], normal[1] - first[1], normal[2] - first[2])).toBeLessThan(1e-5);
      }
    }
  });

  it("keeps smooth terrain normals continuous across chunk borders", () => {
    const heightAt = (x: number, z: number): number => (x === 17 && z === 2 ? 4 : 3);
    const getBlock = (x: number, y: number, z: number): number =>
      y >= 0 && y < heightAt(x, z) ? BLOCK_ID.grass : 0;
    const makeChunk = (cx: number): ChunkMesh => {
      const data = new Uint8Array(CHUNK_VOLUME);
      for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = 0; y < heightAt(cx * CHUNK_SIZE + x, z); y++) data[getBlockIndex(x, y, z)] = BLOCK_ID.grass;
      }
      return meshChunk({ data, cx, cy: 0, cz: 0, getBlock, atlas: smoothAtlas });
    };
    const collectBoundary = (mesh: ChunkMesh, cx: number): Map<string, number[]> => {
      const found = new Map<string, number[]>();
      for (const group of mesh.groups) {
        if (group.tile !== smoothAtlas.grass_top.id) continue;
        for (let offset = group.start; offset < group.start + group.count; offset += 6) {
          const vertices = new Set([mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2], mesh.indices[offset + 5]]);
          for (const vertex of vertices) {
            const start = vertex * 3;
            const x = mesh.positions[start] + cx * CHUNK_SIZE;
            const z = mesh.positions[start + 2];
            if (x !== CHUNK_SIZE || z !== 2) continue;
            const key = `${x},${mesh.positions[start + 1].toFixed(4)},${z}`;
            found.set(key, [mesh.normals[start], mesh.normals[start + 1], mesh.normals[start + 2]]);
          }
        }
      }
      return found;
    };
    const left = collectBoundary(makeChunk(0), 0);
    const right = collectBoundary(makeChunk(1), 1);
    const sharedKeys = [...left.keys()].filter((key) => right.has(key));
    expect(sharedKeys.length).toBeGreaterThan(0);
    for (const key of sharedKeys) {
      const a = left.get(key)!;
      const b = right.get(key)!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-5);
    }
  });

  it("makes a neighbour border normal depend on exactly the two columns nearest the border", () => {
    const plateau = (bumpX: number | null) => (x: number, y: number, z: number): number => {
      const raised = bumpX !== null && x === bumpX && z >= 4 && z <= 12;
      const top = raised ? 4 : 3;
      return y >= 0 && y < top ? BLOCK_ID.grass : 0;
    };
    const borderNormals = (getBlock: (x: number, y: number, z: number) => number): string[] => {
      const data = new Uint8Array(CHUNK_VOLUME);
      for (let x = 0; x < CHUNK_SIZE; x++) for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let y = 0; y < 3; y++) data[getBlockIndex(x, y, z)] = BLOCK_ID.grass;
      }
      const mesh = meshChunk({ data, cx: 1, cy: 0, cz: 0, getBlock, atlas: smoothAtlas });
      const rows: string[] = [];
      for (const group of mesh.groups) {
        if (group.tile !== smoothAtlas.grass_top.id) continue;
        for (let offset = group.start; offset < group.start + group.count; offset++) {
          const vertex = mesh.indices[offset];
          const start = vertex * 3;
          if (mesh.positions[start] !== 0) continue;
          rows.push(`${mesh.positions[start + 2]}|${[mesh.normals[start], mesh.normals[start + 1], mesh.normals[start + 2]].map((v) => v.toFixed(4)).join(",")}`);
        }
      }
      return rows.sort();
    };

    const flat = borderNormals(plateau(null));
    expect(flat.length).toBeGreaterThan(0);
    // Neighbour chunk owns world x 0..15; x=15 and x=14 reach this chunk's x=16 border vertices, x=13 does not.
    expect(borderNormals(plateau(15))).not.toEqual(flat);
    expect(borderNormals(plateau(14))).not.toEqual(flat);
    expect(borderNormals(plateau(13))).toEqual(flat);
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

describe("rounded leaf canopies", () => {
  const cube = (x: number, y: number, z: number): number => (x >= 0 && x < 3 && y >= 0 && y < 3 && z >= 0 && z < 3 ? BLOCK_ID.oak_leaves : 0);
  it("pulls an exposed corner vertex inward and leaves an enclosed vertex alone", () => {
    const corner = roundLeafVertex(cube, 0, 0, 0, -1, 0, 0);
    expect(corner.x).toBeGreaterThan(0);
    expect(corner.y).toBeGreaterThan(0);
    expect(Math.hypot(corner.nx, corner.ny, corner.nz)).toBeCloseTo(1, 6);
    expect(roundLeafVertex(cube, 1, 1, 1, 0, 0, 0)).toMatchObject({ x: 1, y: 1, z: 1 });
    expect(roundLeafVertex(() => 0, 5, 5, 5, 0, 1, 0)).toMatchObject({ x: 5, y: 5, z: 5 });
  });
  it("keeps the canopy mesh un-merged so every vertex can round", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    for (let x = 1; x < 4; x++) data[getBlockIndex(x, 1, 1)] = BLOCK_ID.oak_leaves;
    const leafAtlas = { ...atlas, ginkgo_leaves: { id: 4, uv: [0, 0, 1, 1] as const } };
    const mesh = meshChunk({ data, cx: 0, cy: 0, cz: 0, getBlock: () => 0, atlas: leafAtlas });
    expect(mesh.positions.length / 3).toBe(14 * 4);
  });
});
