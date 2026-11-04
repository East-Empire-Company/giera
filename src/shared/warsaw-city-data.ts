import { BLOCK_ID } from "./blocks";
import {
  WARSAW_CITY_DEPTH,
  WARSAW_CITY_PACKED_DATA,
  WARSAW_CITY_PALETTE_BLOCK_IDS,
  WARSAW_CITY_PALETTE_TINT_IDS,
  WARSAW_CITY_VERTICAL_OFFSET,
  WARSAW_CITY_WIDTH,
  WARSAW_CITY_WORLD_X,
  WARSAW_CITY_WORLD_Z,
} from "./warsaw-city-data.generated";

export const NO_CITY_TINT = 255;

export type WarsawTileData = {
  counts: Uint16Array;
  ground: Uint8Array;
  runs: Uint16Array;
};

export type WarsawCityData = {
  width: number;
  depth: number;
  ground: Uint8Array;
  offsets: Uint32Array;
  runs: Uint16Array;
};

export type WarsawPaletteEntry = readonly [red: number, green: number, blue: number, materialId: number];
export type WarsawTintColor = readonly [red: number, green: number, blue: number];

export type WarsawPaletteMapping = {
  blockIds: Uint8Array;
  tintIds: Uint8Array;
  tintPalettes: Record<number, WarsawTintColor[]>;
};

type ColorPoint = {
  red: number;
  green: number;
  blue: number;
  sourceIndex: number;
  weight: number;
};

type TintCluster = {
  color: WarsawTintColor;
  sourceIndex: number;
  points: ColorPoint[];
};

const MATERIAL_BLOCKS = [
  BLOCK_ID.stone,
  BLOCK_ID.plaster,
  BLOCK_ID.glass,
  BLOCK_ID.oak_leaves,
  BLOCK_ID.water,
  BLOCK_ID.stone,
  BLOCK_ID.stone,
  BLOCK_ID.plaster,
  BLOCK_ID.grass,
  BLOCK_ID.asphalt,
  BLOCK_ID.dirt,
  BLOCK_ID.stone,
  BLOCK_ID.roof_tile,
  BLOCK_ID.plaster,
  BLOCK_ID.stone,
  BLOCK_ID.stone,
  BLOCK_ID.stone,
  BLOCK_ID.stone,
  BLOCK_ID.stone,
  BLOCK_ID.stone,
  BLOCK_ID.brick,
  BLOCK_ID.glass,
  BLOCK_ID.brick,
] as const;

const SOLID_BLOCKS: Record<string, number> = {
  "96,100,108": BLOCK_ID.asphalt,
  "112,112,120": BLOCK_ID.asphalt,
  "136,88,80": BLOCK_ID.asphalt,
  "104,108,116": BLOCK_ID.asphalt,
  "200,192,184": BLOCK_ID.paving,
  "180,180,176": BLOCK_ID.paving,
  "144,136,128": BLOCK_ID.paving,
  "216,204,180": BLOCK_ID.paving,
  "136,128,120": BLOCK_ID.paving,
  "168,164,156": BLOCK_ID.paving,
  "184,176,168": BLOCK_ID.paving,
  "208,200,184": BLOCK_ID.paving,
  "184,136,88": BLOCK_ID.paving,
  "188,184,176": BLOCK_ID.plaster,
  "168,160,152": BLOCK_ID.plaster,
  "220,216,208": BLOCK_ID.plaster,
  "108,80,56": BLOCK_ID.oak_log,
  "108,88,72": BLOCK_ID.planks,
};

export function decodeWarsawTile(bytes: Uint8Array, N: number): WarsawTileData {
  if (!Number.isInteger(N) || N < 0) throw new RangeError(`Invalid Warsaw tile size: ${N}`);
  const side = N + 2;
  const columnCount = side * side;
  const countsBytes = columnCount * 2;
  const groundOffset = countsBytes;
  const runsOffset = columnCount * 3;
  if (bytes.byteLength < runsOffset) throw new RangeError("Invalid Warsaw tile length");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const counts = new Uint16Array(columnCount);
  let runCount = 0;
  for (let i = 0; i < columnCount; i++) {
    const count = view.getUint16(i * 2, true);
    counts[i] = count;
    runCount += count;
  }

  const expectedLength = runsOffset + runCount * 6;
  if (bytes.byteLength !== expectedLength) throw new RangeError("Invalid Warsaw tile length");

  const ground = bytes.slice(groundOffset, runsOffset);
  const runs = new Uint16Array(runCount * 3);
  for (let i = 0; i < runs.length; i++) runs[i] = view.getUint16(runsOffset + i * 2, true);
  return { counts, ground, runs };
}

type VarintCursor = { position: number };

function readVarint(bytes: Uint8Array, cursor: VarintCursor): number {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 8; count++) {
    if (cursor.position >= bytes.length) throw new RangeError("Truncated Warsaw city data");
    const byte = bytes[cursor.position++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new RangeError("Invalid Warsaw city varint");
    if ((byte & 0x80) === 0) return value;
    multiplier *= 128;
  }
  throw new RangeError("Invalid Warsaw city varint");
}

export function decodeWarsawCityData(base64: string, width: number, depth: number): WarsawCityData {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(depth) || depth < 1 || !Number.isSafeInteger(width * depth)) {
    throw new RangeError("Invalid Warsaw city dimensions");
  }
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new RangeError("Invalid Warsaw city base64 data");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const columnCount = width * depth;
  const ground = new Uint8Array(columnCount);
  const offsets = new Uint32Array(columnCount + 1);
  const cursor = { position: 0 };
  for (let column = 0; column < columnCount; column++) {
    const height = readVarint(bytes, cursor);
    const runCount = readVarint(bytes, cursor);
    if (height > 255 || runCount > 0xffffffff - offsets[column]) throw new RangeError("Invalid Warsaw city column");
    ground[column] = height;
    for (let run = 0; run < runCount; run++) {
      const z = readVarint(bytes, cursor);
      const length = readVarint(bytes, cursor);
      const paletteIndex = readVarint(bytes, cursor);
      if (z > 0xffff || length < 1 || length > 0xffff || z + length > 0x10000 || paletteIndex > 0xffff) {
        throw new RangeError("Invalid Warsaw city run");
      }
    }
    offsets[column + 1] = offsets[column] + runCount;
  }
  if (cursor.position !== bytes.length) throw new RangeError("Unexpected trailing Warsaw city data");

  const runs = new Uint16Array(offsets[columnCount] * 3);
  cursor.position = 0;
  for (let column = 0; column < columnCount; column++) {
    readVarint(bytes, cursor);
    const runCount = readVarint(bytes, cursor);
    let runOffset = offsets[column] * 3;
    for (let run = 0; run < runCount; run++) {
      runs[runOffset++] = readVarint(bytes, cursor);
      runs[runOffset++] = readVarint(bytes, cursor);
      runs[runOffset++] = readVarint(bytes, cursor);
    }
  }

  return { width, depth, ground, offsets, runs };
}

let decodedWarsawCityData: WarsawCityData | undefined;

export function getWarsawCityData(): WarsawCityData {
  decodedWarsawCityData ??= decodeWarsawCityData(WARSAW_CITY_PACKED_DATA, WARSAW_CITY_WIDTH, WARSAW_CITY_DEPTH);
  return decodedWarsawCityData;
}

function warsawColumnIndex(x: number, z: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return -1;
  const localX = x - WARSAW_CITY_WORLD_X;
  const localZ = z - WARSAW_CITY_WORLD_Z;
  if (localX < 0 || localX >= WARSAW_CITY_WIDTH || localZ < 0 || localZ >= WARSAW_CITY_DEPTH) return -1;
  return localZ * WARSAW_CITY_WIDTH + localX;
}

export function lookupWarsawGroundHeight(x: number, z: number): number | null {
  const column = warsawColumnIndex(x, z);
  if (column < 0) return null;
  return getWarsawCityData().ground[column]! + WARSAW_CITY_VERTICAL_OFFSET - 1;
}

export function lookupWarsawPaletteIndex(x: number, y: number, z: number): number {
  if (!Number.isInteger(y)) return -1;
  const column = warsawColumnIndex(x, z);
  if (column < 0) return -1;
  const sourceY = y - WARSAW_CITY_VERTICAL_OFFSET;
  if (sourceY < 0) return -1;

  const city = getWarsawCityData();
  let low = city.offsets[column]!;
  let high = city.offsets[column + 1]! - 1;
  while (low <= high) {
    const run = (low + high) >>> 1;
    const runOffset = run * 3;
    const startY = city.runs[runOffset]!;
    const endY = startY + city.runs[runOffset + 1]!;
    if (sourceY < startY) high = run - 1;
    else if (sourceY >= endY) low = run + 1;
    else return city.runs[runOffset + 2]!;
  }
  return -1;
}

export function lookupWarsawVoxel(x: number, y: number, z: number): { blockId: number; tintId: number } | null {
  const paletteIndex = lookupWarsawPaletteIndex(x, y, z);
  if (paletteIndex < 0) return null;
  return {
    blockId: WARSAW_CITY_PALETTE_BLOCK_IDS[paletteIndex]!,
    tintId: WARSAW_CITY_PALETTE_TINT_IDS[paletteIndex]!,
  };
}

export function lookupWarsawConnectorHeight(x: number, z: number): number | null {
  if (!Number.isInteger(x) || !Number.isInteger(z)) return null;
  return x >= 4 && x <= 7 && z >= -16 && z <= 4 ? 60 : null;
}

function sourceBlock(entry: WarsawPaletteEntry, index: number): number {
  const [red, green, blue, materialId] = entry;
  if (![red, green, blue, materialId].every(Number.isInteger) || red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) {
    throw new RangeError(`Invalid source palette entry at index ${index}`);
  }
  if (!Object.hasOwn(MATERIAL_BLOCKS, materialId)) throw new RangeError(`Unknown source material ID ${materialId} at palette index ${index}`);
  return materialId === 0 ? (SOLID_BLOCKS[`${red},${green},${blue}`] ?? BLOCK_ID.stone) : MATERIAL_BLOCKS[materialId];
}

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function srgbByte(value: number): number {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(channel * 255)));
}

function uniquePoints(
  blockId: number,
  palette: readonly WarsawPaletteEntry[],
  usage: ArrayLike<number>,
): { points: ColorPoint[]; pointByEntry: Int32Array } {
  const points: ColorPoint[] = [];
  const colorIndices = new Map<string, number>();
  const pointByEntry = new Int32Array(palette.length).fill(-1);
  for (let index = 0; index < palette.length; index++) {
    const weight = usage[index];
    if (!weight) continue;
    if (!Number.isSafeInteger(weight) || weight < 0) throw new RangeError(`Invalid source palette usage at index ${index}`);
    const entry = palette[index];
    if (sourceBlock(entry, index) !== blockId) continue;
    const key = `${entry[0]},${entry[1]},${entry[2]}`;
    const existing = colorIndices.get(key);
    if (existing !== undefined) {
      points[existing].weight += weight;
      pointByEntry[index] = existing;
      continue;
    }
    const pointIndex = points.length;
    colorIndices.set(key, pointIndex);
    points.push({
      red: linearChannel(entry[0]),
      green: linearChannel(entry[1]),
      blue: linearChannel(entry[2]),
      sourceIndex: index,
      weight,
    });
    pointByEntry[index] = pointIndex;
  }
  return { points, pointByEntry };
}

function channel(point: ColorPoint, axis: number): number {
  return axis === 0 ? point.red : axis === 1 ? point.green : point.blue;
}

function medianCut(points: ColorPoint[], limit: number): TintCluster[] {
  const boxes = [points];
  while (boxes.length < limit) {
    let selected = -1;
    let selectedRange = -1;
    let selectedWeight = -1;
    let selectedSourceIndex = Infinity;
    let selectedAxis = 0;
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
      const box = boxes[boxIndex];
      if (box.length < 2) continue;
      let axis = 0;
      let range = -1;
      for (let candidate = 0; candidate < 3; candidate++) {
        const values = box.map((point) => channel(point, candidate));
        const candidateRange = Math.max(...values) - Math.min(...values);
        if (candidateRange > range) {
          range = candidateRange;
          axis = candidate;
        }
      }
      const weight = box.reduce((sum, point) => sum + point.weight, 0);
      const sourceIndex = Math.min(...box.map((point) => point.sourceIndex));
      if (range > selectedRange || (range === selectedRange && weight > selectedWeight) ||
        (range === selectedRange && weight === selectedWeight && sourceIndex < selectedSourceIndex)) {
        selected = boxIndex;
        selectedRange = range;
        selectedWeight = weight;
        selectedSourceIndex = sourceIndex;
        selectedAxis = axis;
      }
    }
    if (selected < 0 || selectedRange <= 0) break;

    const box = boxes[selected].slice().sort((a, b) => channel(a, selectedAxis) - channel(b, selectedAxis) || a.sourceIndex - b.sourceIndex);
    const totalWeight = box.reduce((sum, point) => sum + point.weight, 0);
    const halfWeight = totalWeight / 2;
    let accumulated = 0;
    let split = 1;
    for (let i = 0; i < box.length - 1; i++) {
      accumulated += box[i].weight;
      split = i + 1;
      if (accumulated >= halfWeight) break;
    }
    boxes.splice(selected, 1, box.slice(0, split), box.slice(split));
  }

  return boxes.map((box) => {
    const totalWeight = box.reduce((sum, point) => sum + point.weight, 0);
    const red = box.reduce((sum, point) => sum + point.red * point.weight, 0) / totalWeight;
    const green = box.reduce((sum, point) => sum + point.green * point.weight, 0) / totalWeight;
    const blue = box.reduce((sum, point) => sum + point.blue * point.weight, 0) / totalWeight;
    return {
      color: [srgbByte(red), srgbByte(green), srgbByte(blue)] as const,
      sourceIndex: Math.min(...box.map((point) => point.sourceIndex)),
      points: box,
    };
  }).sort((a, b) => a.sourceIndex - b.sourceIndex);
}

export function mapWarsawPalette(
  palette: readonly WarsawPaletteEntry[],
  usage: ArrayLike<number>,
): WarsawPaletteMapping {
  if (usage.length !== palette.length) throw new RangeError("Source palette usage length does not match palette");
  const blockIds = new Uint8Array(palette.length);
  const tintIds = new Uint8Array(palette.length).fill(NO_CITY_TINT);
  const tintPalettes: Record<number, WarsawTintColor[]> = {};
  const families = new Set<number>();

  for (let index = 0; index < palette.length; index++) {
    blockIds[index] = sourceBlock(palette[index], index);
    if (usage[index] > 0) families.add(blockIds[index]);
  }

  for (const blockId of families) {
    const { points, pointByEntry } = uniquePoints(blockId, palette, usage);
    const clusters = medianCut(points, 16);
    tintPalettes[blockId] = clusters.map(({ color }) => color);
    const pointTint = new Uint8Array(points.length).fill(NO_CITY_TINT);
    clusters.forEach((cluster, tintId) => {
      for (const point of cluster.points) pointTint[points.indexOf(point)] = tintId;
    });
    for (let index = 0; index < palette.length; index++) {
      if (blockIds[index] !== blockId || pointByEntry[index] < 0) continue;
      tintIds[index] = pointTint[pointByEntry[index]];
    }
  }

  return { blockIds, tintIds, tintPalettes };
}
