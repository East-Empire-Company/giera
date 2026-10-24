import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, CHUNK_VOLUME, chunkKey, decodeRLE, encodeRLE, getBlockIndex } from "../../src/shared/chunk";

describe("chunk storage", () => {
  it("indexes cells in x-z-y order and bounds-checks coordinates", () => {
    expect(getBlockIndex(3, 2, 5)).toBe(3 + CHUNK_SIZE * (5 + CHUNK_SIZE * 2));
    expect(() => getBlockIndex(16, 0, 0)).toThrow(RangeError);
  });

  it("round-trips random chunk bytes and splits runs above 255", () => {
    const data = new Uint8Array(CHUNK_VOLUME);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >> 4)) % 15;
    const decoded = decodeRLE(encodeRLE(data));
    expect(decoded).toEqual(data);
    expect(decodeRLE(encodeRLE(new Uint8Array(CHUNK_VOLUME)))).toEqual(new Uint8Array(CHUNK_VOLUME));
  });

  it("uses a three-axis key and rejects malformed RLE frames", () => {
    expect(chunkKey(-2, 3, 8)).toBe("-2,3,8");
    expect(() => decodeRLE(Uint8Array.of(1))).toThrow(RangeError);
    expect(() => decodeRLE(Uint8Array.of(2, 0))).toThrow(RangeError);
  });
});
