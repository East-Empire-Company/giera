export const CHUNK_SIZE = 16;
export const CHUNK_VOLUME = CHUNK_SIZE ** 3;
export const WORLD_HEIGHT = 128;

export type ChunkPosition = { cx: number; cy: number; cz: number };

export function getBlockIndex(x: number, y: number, z: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) {
    throw new RangeError(`Block coordinates outside chunk: ${x},${y},${z}`);
  }
  return x + CHUNK_SIZE * (z + CHUNK_SIZE * y);
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !Number.isInteger(cz)) throw new RangeError("Chunk coordinates must be integers");
  return `${cx},${cy},${cz}`;
}

export function encodeRLE(data: Uint8Array): Uint8Array {
  if (data.length !== CHUNK_VOLUME) throw new RangeError(`Expected ${CHUNK_VOLUME} block IDs`);
  let pairCount = 0;
  for (let start = 0; start < data.length;) {
    let end = start + 1;
    while (end < data.length && data[end] === data[start] && end - start < 255) end++;
    pairCount++;
    start = end;
  }
  const encoded = new Uint8Array(pairCount * 2);
  let offset = 0;
  for (let start = 0; start < data.length;) {
    let end = start + 1;
    while (end < data.length && data[end] === data[start] && end - start < 255) end++;
    encoded[offset++] = data[start];
    encoded[offset++] = end - start;
    start = end;
  }
  return encoded;
}

export function decodeRLE(bytes: Uint8Array, expectedLength = CHUNK_VOLUME): Uint8Array {
  if (!Number.isInteger(expectedLength) || expectedLength < 0 || bytes.length % 2 !== 0) throw new RangeError("Malformed RLE frame");
  const decoded = new Uint8Array(expectedLength);
  let outputOffset = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const value = bytes[i];
    const count = bytes[i + 1];
    if (count === 0 || outputOffset + count > expectedLength) throw new RangeError("RLE frame exceeds expected length");
    decoded.fill(value, outputOffset, outputOffset + count);
    outputOffset += count;
  }
  if (outputOffset !== expectedLength) throw new RangeError("RLE frame ended before expected length");
  return decoded;
}
