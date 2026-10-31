import { BLOCK_ID } from "./blocks";
import { CHUNK_SIZE, CHUNK_VOLUME, getBlockIndex, WORLD_HEIGHT } from "./chunk";
import { MAX_TYCOON_SLOTS, tycoonSlotOrigin } from "./tycoon-slots";

const MAX_SURFACE_HEIGHT = Math.round(32 + 23 + 3 / 2 + 24 + 14);
const MAX_TREE_BLOCKS_ABOVE_SURFACE = 9;
export const MAX_GENERATED_BLOCK_Y = Math.min(WORLD_HEIGHT - 1, MAX_SURFACE_HEIGHT + MAX_TREE_BLOCKS_ABOVE_SURFACE);

const WATER_LEVEL = 40;
const TYCOON_CENTER_X = 12;
const TYCOON_CENTER_Z = 12;
const TYCOON_SURFACE_HEIGHT = 60;
const TYCOON_CORE_HALF_SIZE = 8;
const TYCOON_TRANSITION_DISTANCE = 16;
const TYCOON_TREE_BUFFER = 5;
const TREE_CROWN_MAX_RADIUS = 2;
const TYCOON_TREE_CLEARANCE = TYCOON_CORE_HALF_SIZE + TYCOON_TREE_BUFFER + TREE_CROWN_MAX_RADIUS;
const SLOT_PAD_HALF_SIZE = 5;
const SLOT_PAD_TRANSITION = 6;
const SLOT_PAD_TREE_CLEARANCE = SLOT_PAD_HALF_SIZE + TYCOON_TREE_BUFFER + TREE_CROWN_MAX_RADIUS;

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
function smoothstep(edge0: number, edge1: number, value: number): number {
  return smooth(Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0))));
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

function naturalSurfaceHeight(x: number, z: number, seed: number): number {
  const continent = valueNoise2(x * 0.007, z * 0.007, seed ^ 0x68bc21eb);
  const region = valueNoise2(x * 0.024, z * 0.024, seed ^ 0x02e5be93);
  const land = smoothstep(0.22, 0.5, continent);
  const lake = 1 - smoothstep(0.16, 0.36, region);
  const mountain = smoothstep(0.64, 0.86, region);
  const plainsHeight = 32 + land * 23 + (region - 0.5) * 3;
  const height = plainsHeight - lake * land * 22 + mountain * land * (24 + region * 14);
  return Math.max(32, Math.min(WORLD_HEIGHT - 1, Math.round(height)));
}

function slotPadHeight(slot: number, seed: number): number {
  const at = tycoonSlotOrigin(slot);
  return Math.max(WATER_LEVEL + 1, naturalSurfaceHeight(at.x, at.z, seed));
}

function slotPadWeight(x: number, z: number, slot: number): number {
  const at = tycoonSlotOrigin(slot);
  const dx = Math.abs(x - at.x) - SLOT_PAD_HALF_SIZE;
  const dz = Math.abs(z - at.z) - SLOT_PAD_HALF_SIZE;
  if (dx <= 0 && dz <= 0) return 1;
  const distance = Math.hypot(Math.max(0, dx), Math.max(0, dz));
  return distance >= SLOT_PAD_TRANSITION ? 0 : 1 - smooth(distance / SLOT_PAD_TRANSITION);
}

export function surfaceHeight(x: number, z: number, seed: number): number {
  const natural = naturalSurfaceHeight(x, z, seed);
  let weight = 0;
  let target = TYCOON_SURFACE_HEIGHT;

  const dx = Math.abs(x - TYCOON_CENTER_X) - TYCOON_CORE_HALF_SIZE;
  const dz = Math.abs(z - TYCOON_CENTER_Z) - TYCOON_CORE_HALF_SIZE;
  if (dx <= 0 && dz <= 0) {
    weight = 1;
  } else {
    const distance = Math.hypot(Math.max(0, dx), Math.max(0, dz));
    if (distance < TYCOON_TRANSITION_DISTANCE) weight = 1 - smooth(distance / TYCOON_TRANSITION_DISTANCE);
  }

  for (let slot = 1; slot < MAX_TYCOON_SLOTS; slot++) {
    const slotWeight = slotPadWeight(x, z, slot);
    if (slotWeight <= weight) continue;
    weight = slotWeight;
    target = slotPadHeight(slot, seed);
  }

  if (weight === 0) return natural;
  return Math.round(natural + (target - natural) * weight);
}

function treeHeight(x: number, z: number, seed: number): number {
  return 5 + Math.floor(hash2(x, z, seed ^ 0x6c8e9cf5) * 3);
}

const CROWN_ROUND = [2, 2, 1];
const CROWN_TALL = [1, 1, 1, 1];
const CROWN_WIDE = [2, 2, 2];

const STARTING_CLEARING_MIN_X = -13;
const STARTING_CLEARING_MAX_X = 6;
const STARTING_CLEARING_MIN_Z = -2;
const STARTING_CLEARING_MAX_Z = 13;
const TREE_FIELD_SCALE = 0.022;
const TREE_FIELD_SALT = 0x72d5a1b3;


function hasTreeSite(x: number, z: number, seed: number): boolean {
  if (x >= STARTING_CLEARING_MIN_X && x <= STARTING_CLEARING_MAX_X && z >= STARTING_CLEARING_MIN_Z && z <= STARTING_CLEARING_MAX_Z) return false;
  if (Math.abs(x - TYCOON_CENTER_X) <= TYCOON_TREE_CLEARANCE && Math.abs(z - TYCOON_CENTER_Z) <= TYCOON_TREE_CLEARANCE) return false;
  for (let slot = 1; slot < MAX_TYCOON_SLOTS; slot++) {
    const at = tycoonSlotOrigin(slot);
    if (Math.abs(x - at.x) <= SLOT_PAD_TREE_CLEARANCE && Math.abs(z - at.z) <= SLOT_PAD_TREE_CLEARANCE) return false;
  }

  const chance = hash2(x, z, seed ^ 0x4f1bbcdc);
  if (chance < 0.945) return false;
  const forest = valueNoise2(x * TREE_FIELD_SCALE, z * TREE_FIELD_SCALE, seed ^ TREE_FIELD_SALT);
  return forest >= 0.58 || (forest >= 0.3 && chance >= 0.98);
}

function treeBlock(x: number, y: number, z: number, seed: number): number {
  for (let centerZ = z - 2; centerZ <= z + 2; centerZ++) {
    for (let centerX = x - 2; centerX <= x + 2; centerX++) {
      if (!hasTreeSite(centerX, centerZ, seed)) continue;
      const base = surfaceHeight(centerX, centerZ, seed);
      if (base <= WATER_LEVEL + 1) continue;
      const dx = Math.abs(x - centerX);
      const dz = Math.abs(z - centerZ);
      const shape = hash2(centerX, centerZ, seed ^ 0x2545f491);
      const height = treeHeight(centerX, centerZ, seed) + (shape < 0.22 ? 2 : shape > 0.82 ? -1 : 0);
      if (dx === 0 && dz === 0 && y > base && y <= base + height) return BLOCK_ID.oak_log;
      const crown = y - (base + height - 2);
      const profile = shape < 0.22 ? CROWN_TALL : shape > 0.82 ? CROWN_WIDE : CROWN_ROUND;
      const radius = crown >= 0 && crown < profile.length ? profile[crown] : -1;
      if (radius >= 0 && Math.max(dx, dz) <= radius && !(crown === 0 && dx === 0 && dz === 0)) return BLOCK_ID.oak_leaves;
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
