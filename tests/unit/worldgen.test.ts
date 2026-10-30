import { describe, expect, it } from "vitest";
import { BLOCK_ID } from "../../src/shared/blocks";
import { CHUNK_SIZE, getBlockIndex } from "../../src/shared/chunk";
import { generateBlock, generateChunk, surfaceHeight } from "../../src/shared/worldgen";
import { MAX_TYCOON_SLOTS, tycoonSlotOrigin } from "../../src/shared/tycoon-slots";

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

  it("returns current terrain consistently from block and chunk access", () => {
    const seed = 424242;
    for (const [x, y, z] of [[0, 61, 0], [-1, 45, -17], [16, 40, 5]] as const) {
      const chunk = generateChunk(
        Math.floor(x / CHUNK_SIZE),
        Math.floor(y / CHUNK_SIZE),
        Math.floor(z / CHUNK_SIZE),
        seed,
      );
      const localX = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localY = ((y % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const localZ = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      expect(chunk[getBlockIndex(localX, localY, localZ)]).toBe(generateBlock(x, y, z, seed));
    }
  });

  it("pins the tycoon floor height and keeps it dry across seeds", () => {
    for (const seed of [17, 424242, 1337]) {
      for (let z = 4; z <= 20; z++) {
        for (let x = 4; x <= 20; x++) {
          expect(surfaceHeight(x, z, seed)).toBe(60);
          expect(generateBlock(x, 60, z, seed)).toBe(BLOCK_ID.grass);
          expect(generateBlock(x, 40, z, seed)).not.toBe(BLOCK_ID.water);
        }
      }
    }
  });

  it("gives every tycoon slot a flat, tree-free pad", () => {
    for (const worldSeed of [17, 424242, 1337, 20261030]) {
      for (let slot = 1; slot < MAX_TYCOON_SLOTS; slot++) {
        const at = tycoonSlotOrigin(slot);
        const floor = surfaceHeight(at.x, at.z, worldSeed);
        for (let dz = -4; dz <= 3; dz++) {
          for (let dx = -4; dx <= 4; dx++) {
            const x = at.x + dx;
            const z = at.z + dz;
            expect(surfaceHeight(x, z, worldSeed), `slot ${slot} terrain at ${x},${z} (seed ${worldSeed})`).toBe(floor);
            for (let y = floor + 1; y <= floor + 8; y++) {
              const block = generateBlock(x, y, z, worldSeed);
              expect([BLOCK_ID.air, BLOCK_ID.water], `slot ${slot} obstruction ${block} at ${x},${y},${z}`).toContain(block);
            }
          }
        }
      }
    }
  });

  it("keeps the starting footprint tree-free across seeds", () => {
    for (const worldSeed of [17, 424242, 1337]) {
      for (let plotZ = 1; plotZ <= 10; plotZ++) {
        for (let plotX = -10; plotX <= 3; plotX++) {
          const surface = surfaceHeight(plotX, plotZ, worldSeed);
          for (let blockY = surface + 1; blockY <= surface + 9; blockY++) {
            const id = generateBlock(plotX, blockY, plotZ, worldSeed);
            expect(id).not.toBe(BLOCK_ID.oak_log);
            expect(id).not.toBe(BLOCK_ID.oak_leaves);
          }
        }
      }
    }
  });
  it("keeps tycoon approach and tree buffer clear across seeds", () => {
    for (const seed of [17, 424242, 1337]) {
      for (let step = 0; step <= 9; step++) {
        const x = 3 + step;
        const z = 5 + Math.round((step * 7) / 9);
        expect(surfaceHeight(x, z, seed)).toBe(60);
      }
      for (let z = -1; z <= 25; z++) {
        for (let x = -1; x <= 25; x++) {
          const surface = surfaceHeight(x, z, seed);
          for (let y = surface + 1; y <= surface + 9; y++) {
            const id = generateBlock(x, y, z, seed);
            expect(id).not.toBe(BLOCK_ID.oak_log);
            expect(id).not.toBe(BLOCK_ID.oak_leaves);
          }
        }
      }
    }
  });

  it("creates lowlands, open plains, and mountains from a seed", () => {
    const seed = 424242;
    let waterColumns = 0;
    let plainColumns = 0;
    let mountainColumns = 0;
    for (let z = -512; z <= 512; z += 16) {
      for (let x = -512; x <= 512; x += 16) {
        const height = surfaceHeight(x, z, seed);
        if (height < 40) {
          waterColumns++;
          expect(generateBlock(x, 40, z, seed)).toBe(BLOCK_ID.water);
        }
        if (height >= 53 && height <= 57 && (Math.abs(x - 12) > 24 || Math.abs(z - 12) > 24)) plainColumns++;
        if (height >= 72) mountainColumns++;
      }
    }
    expect(waterColumns).toBeGreaterThan(0);
    expect(plainColumns).toBeGreaterThan(0);
    expect(mountainColumns).toBeGreaterThan(0);
  });

  it("creates clearings and wooded pockets in current terrain", () => {
    const seed = 424242;
    let openPatches = 0;
    let woodedPatches = 0;
    for (let startZ = -64; startZ < 64; startZ += 16) {
      for (let startX = -64; startX < 64; startX += 16) {
        let trees = 0;
        for (let z = startZ; z < startZ + 16; z++) {
          for (let x = startX; x < startX + 16; x++) {
            const surface = surfaceHeight(x, z, seed);
            if (generateBlock(x, surface + 1, z, seed) === BLOCK_ID.oak_log) trees++;
          }
        }
        if (trees === 0) openPatches++;
        if (trees >= 12) woodedPatches++;
      }
    }
    expect(openPatches).toBeGreaterThanOrEqual(10);
    expect(woodedPatches).toBeGreaterThanOrEqual(1);
  });

});
