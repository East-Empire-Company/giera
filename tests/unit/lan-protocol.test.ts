import { describe, expect, it } from "vitest";
import { CHUNK_VOLUME, decodeRLE, encodeRLE } from "../../src/shared/chunk";
import {
  decodeBinaryChunkFrame,
  encodeBinaryChunkFrame,
  isValidPlayerSpeed,
  MAX_PLAYER_SPEED,
} from "../../src/shared/lan-protocol";
import { generateChunk } from "../../src/shared/worldgen";

describe("binary chunk frames", () => {
  it("round-trips real RLE chunk data with coordinates", () => {
    const a = generateChunk(0, 2, 0, 4242);
    const b = generateChunk(-3, 1, 5, 4242);
    const flat = new Uint8Array(CHUNK_VOLUME).fill(2);
    const packets = [
      { cx: 0, cy: 2, cz: 0, rleData: encodeRLE(a) },
      { cx: -3, cy: 1, cz: 5, rleData: encodeRLE(b) },
      { cx: 2147483647, cy: 0, cz: -2147483648, rleData: encodeRLE(flat) },
    ];

    const frame = encodeBinaryChunkFrame(packets);
    expect(frame[0]).toBe(1);
    const decoded = decodeBinaryChunkFrame(frame);

    expect(decoded.map(({ cx, cy, cz }) => [cx, cy, cz])).toEqual([
      [0, 2, 0],
      [-3, 1, 5],
      [2147483647, 0, -2147483648],
    ]);
    expect(Array.from(decodeRLE(decoded[0].rleData))).toEqual(Array.from(a));
    expect(Array.from(decodeRLE(decoded[1].rleData))).toEqual(Array.from(b));
    expect(Array.from(decodeRLE(decoded[2].rleData))).toEqual(Array.from(flat));
  });

  it("round-trips an empty frame", () => {
    expect(decodeBinaryChunkFrame(encodeBinaryChunkFrame([]))).toEqual([]);
  });

  it("decodes a frame that is a view into a larger buffer", () => {
    const frame = encodeBinaryChunkFrame([{ cx: 1, cy: 2, cz: 3, rleData: new Uint8Array([7, 255, 7, 1]) }]);
    const padded = new Uint8Array(frame.length + 5);
    padded.set(frame, 5);
    const [packet] = decodeBinaryChunkFrame(padded.subarray(5));
    expect([packet.cx, packet.cy, packet.cz]).toEqual([1, 2, 3]);
    expect(Array.from(packet.rleData)).toEqual([7, 255, 7, 1]);
  });

  describe("decode errors", () => {
    const valid = () => encodeBinaryChunkFrame([{ cx: 1, cy: 2, cz: 3, rleData: new Uint8Array([5, 10, 0, 20]) }]);

    it.each([0, 1, 2])("rejects a %i-byte buffer", (n) => {
      expect(() => decodeBinaryChunkFrame(new Uint8Array(n))).toThrow(RangeError);
    });

    it("rejects an unknown frame type", () => {
      const frame = valid();
      frame[0] = 2;
      expect(() => decodeBinaryChunkFrame(frame)).toThrow(/Unknown binary frame type: 2/);
    });

    it("rejects a count that promises more chunks than the buffer holds", () => {
      const frame = valid();
      new DataView(frame.buffer).setUint16(1, 2, true);
      expect(() => decodeBinaryChunkFrame(frame)).toThrow(/Corrupt chunk header/);
    });

    it("rejects a truncated header", () => {
      expect(() => decodeBinaryChunkFrame(valid().subarray(0, 3 + 15))).toThrow(/Corrupt chunk header/);
    });

    it("rejects a truncated payload", () => {
      const frame = valid();
      expect(() => decodeBinaryChunkFrame(frame.subarray(0, frame.length - 1))).toThrow(/Corrupt chunk payload/);
    });

    it("rejects a payload length that points past the end of the buffer", () => {
      const frame = valid();
      new DataView(frame.buffer).setUint32(3 + 12, 0xffffffff, true);
      expect(() => decodeBinaryChunkFrame(frame)).toThrow(/Corrupt chunk payload/);
    });
  });
});

describe("isValidPlayerSpeed", () => {
  const origin = { x: 0, y: 40, z: 0 };
  const at = (dx: number, dy: number, dz: number, from = origin) => ({ x: from.x + dx, y: from.y + dy, z: from.z + dz });

  it("pins the speed limit the server enforces", () => {
    expect(MAX_PLAYER_SPEED).toBe(12);
  });

  it("accepts standing still", () => {
    expect(isValidPlayerSpeed(origin, origin, 1)).toBe(true);
  });

  it.each([
    ["x", [1, 0, 0]],
    ["y", [0, 1, 0]],
    ["z", [0, 0, 1]],
  ])("accepts exactly the limit and rejects just over it on the %s axis", (_axis, unit) => {
    const [ux, uy, uz] = unit;
    const exact = MAX_PLAYER_SPEED * 2;
    expect(isValidPlayerSpeed(origin, at(ux * exact, uy * exact, uz * exact), 2)).toBe(true);
    expect(isValidPlayerSpeed(origin, at(ux * (exact + 0.001), uy * (exact + 0.001), uz * (exact + 0.001)), 2)).toBe(false);
    expect(isValidPlayerSpeed(origin, at(-ux * exact, -uy * exact, -uz * exact), 2)).toBe(true);
    expect(isValidPlayerSpeed(origin, at(-ux * (exact + 0.001), -uy * (exact + 0.001), -uz * (exact + 0.001)), 2)).toBe(false);
  });

  it("uses the 3D euclidean distance, not per-axis or manhattan distance", () => {
    expect(isValidPlayerSpeed(origin, at(4, 8, 8), 1)).toBe(true);
    expect(isValidPlayerSpeed(origin, at(4, 8, 9), 1)).toBe(false);
    expect(isValidPlayerSpeed(origin, at(8, 8, 8), 1)).toBe(false);
    expect(isValidPlayerSpeed(origin, at(9, 9, 0), 1)).toBe(false);
    expect(isValidPlayerSpeed(origin, at(8.4, 8.4, 0), 1)).toBe(true);
  });
  it("is relative to the previous position, wherever it is", () => {
    const prev = { x: -1000.5, y: 3, z: 777 };
    expect(isValidPlayerSpeed(prev, at(-12, 0, 0, prev), 1)).toBe(true);
    expect(isValidPlayerSpeed(prev, at(0, 0, 12.5, prev), 1)).toBe(false);
  });

  it("scales the allowance with elapsed time", () => {
    expect(isValidPlayerSpeed(origin, at(6, 0, 0), 0.5)).toBe(true);
    expect(isValidPlayerSpeed(origin, at(6.1, 0, 0), 0.5)).toBe(false);
    expect(isValidPlayerSpeed(origin, at(120, 0, 0), 10)).toBe(true);
    expect(isValidPlayerSpeed(origin, at(121, 0, 0), 10)).toBe(false);
  });

  it.each([0, -1, -0.01, NaN, Infinity, -Infinity])("rejects any move when dt is %s", (dt) => {
    expect(isValidPlayerSpeed(origin, at(0.1, 0, 0), dt)).toBe(false);
    expect(isValidPlayerSpeed(origin, origin, dt)).toBe(false);
  });

  it.each([
    ["curr.x NaN", origin, { x: NaN, y: 40, z: 0 }],
    ["curr.y NaN", origin, { x: 0, y: NaN, z: 0 }],
    ["curr.z NaN", origin, { x: 0, y: 40, z: NaN }],
    ["curr.x Infinity", origin, { x: Infinity, y: 40, z: 0 }],
    ["curr.y -Infinity", origin, { x: 0, y: -Infinity, z: 0 }],
    ["prev.z NaN", { x: 0, y: 40, z: NaN }, origin],
    ["prev.x Infinity", { x: Infinity, y: 40, z: 0 }, origin],
    ["both Infinity", { x: Infinity, y: 40, z: 0 }, { x: Infinity, y: 40, z: 0 }],
  ])("rejects %s", (_name, prev, curr) => {
    expect(isValidPlayerSpeed(prev, curr, 1)).toBe(false);
  });
});
