import { BLOCK_ID } from "./blocks";
import { CHUNK_SIZE, CHUNK_VOLUME, getBlockIndex, WORLD_HEIGHT } from "./chunk";

const WATER_LEVEL = 40;

function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ seed;
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(x ^ Math.imul(y, 0x45d9f3b), z, seed ^ Math.imul(y, 0x27d4eb2d));
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const tz = smooth(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const north = a + (b - a) * tx;
  const south = c + (d - c) * tx;
  return north + (south - north) * tz;
}

function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);
  const n000 = hash3(x0, y0, z0, seed);
  const n100 = hash3(x0 + 1, y0, z0, seed);
  const n010 = hash3(x0, y0 + 1, z0, seed);
  const n110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const n001 = hash3(x0, y0, z0 + 1, seed);
  const n101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const n011 = hash3(x0, y0 + 1, z0 + 1, seed);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = n000 + (n100 - n000) * tx;
  const x10 = n010 + (n110 - n010) * tx;
  const x01 = n001 + (n101 - n001) * tx;
  const x11 = n011 + (n111 - n011) * tx;
  const z0Value = x00 + (x10 - x00) * ty;
  const z1Value = x01 + (x11 - x01) * ty;
  return z0Value + (z1Value - z0Value) * tz;
}

export function surfaceHeight(x: number, z: number, seed: number): number {
  const continent = (valueNoise2(x * 0.012, z * 0.012, seed) - 0.5) * 32;
  const detail = (valueNoise2(x * 0.045, z * 0.045, seed ^ 0x51ed270b) - 0.5) * 10;
  return Math.max(32, Math.min(72, Math.round(52 + continent + detail)));
}

function treeHeight(x: number, z: number, seed: number): number {
  return 5 + Math.floor(hash2(x, z, seed ^ 0x6c8e9cf5) * 3);
}

function treeBlock(x: number, y: number, z: number, seed: number): number {
  for (let centerZ = z - 2; centerZ <= z + 2; centerZ++) {
    for (let centerX = x - 2; centerX <= x + 2; centerX++) {
      if (hash2(centerX, centerZ, seed ^ 0x4f1bbcdc) < 0.965) continue;
      const base = surfaceHeight(centerX, centerZ, seed);
      if (base <= WATER_LEVEL + 1) continue;
      const height = treeHeight(centerX, centerZ, seed);
      const dx = Math.abs(x - centerX);
      const dz = Math.abs(z - centerZ);
      if (dx === 0 && dz === 0 && y > base && y <= base + height) return BLOCK_ID.oak_log;
      const crown = y - (base + height - 2);
      const radius = crown <= 1 ? 2 : crown === 2 ? 1 : 0;
      if (crown >= 0 && crown <= 2 && Math.max(dx, dz) <= radius && !(crown === 0 && dx === 0 && dz === 0)) return BLOCK_ID.oak_leaves;
    }
  }
  return BLOCK_ID.air;
}

export function generateBlock(x: number, y: number, z: number, seed: number): number {
  if (y < 0 || y >= WORLD_HEIGHT) return BLOCK_ID.air;
  if (y === 0) return BLOCK_ID.bedrock;
  const height = surfaceHeight(x, z, seed);
  let block: number = BLOCK_ID.air;
  if (y <= height) {
    const isBeach = height <= WATER_LEVEL + 2;
    if (y === height) block = isBeach ? BLOCK_ID.sand : BLOCK_ID.grass;
    else if (y > height - (isBeach ? 4 : 4)) block = isBeach ? BLOCK_ID.sand : BLOCK_ID.dirt;
    else if (y < height - 4 && valueNoise3(x * 0.075, y * 0.08, z * 0.075, seed ^ 0x13a5ba1d) > 0.72) block = BLOCK_ID.air;
    else if (y < 52 && hash3(x, y, z, seed ^ 0x7f4a7c15) > 0.993) block = BLOCK_ID.coal_ore;
    else if (y < 32 && hash3(x, y, z, seed ^ 0x2b992ddf) > 0.996) block = BLOCK_ID.iron_ore;
    else if (y < 20 && hash3(x, y, z, seed ^ 0x3c6ef372) > 0.9985) block = BLOCK_ID.gold_ore;
    else block = BLOCK_ID.stone;
  } else if (y <= WATER_LEVEL) {
    block = BLOCK_ID.water;
  }
  if (y >= height + 1 && y <= height + 9) {
    const placed = treeBlock(x, y, z, seed);
    if (placed !== BLOCK_ID.air) block = placed;
  }
  return block;
}

export function generateChunk(cx: number, cy: number, cz: number, seed: number): Uint8Array {
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(cz) || !Number.isInteger(seed)) throw new RangeError("Chunk coordinates and seed must be integers");
  const data = new Uint8Array(CHUNK_VOLUME);
  const originX = cx * CHUNK_SIZE;
  const originY = cy * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        data[getBlockIndex(x, y, z)] = generateBlock(originX + x, originY + y, originZ + z, seed);
      }
    }
  }
  return data;
}
